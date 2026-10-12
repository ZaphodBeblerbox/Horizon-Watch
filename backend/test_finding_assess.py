"""finding_assess.py — the AI second opinion on a finding: on request only,
cached, under the budget. The OpenAI client is mocked throughout."""
import base64
import io
import json
import pathlib
import types

import pytest

import finding_assess as fa
import openai_gate


def _png(color=(120, 120, 120)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _g():
    f = {"id": "chg:CHG-1", "kind": "radar_change", "label": "Radar change — new bright returns", "lat": 48.46, "lon": 38.2,
         "area_m2": 14000, "t_peak": 9.3, "box": [38.19, 48.45, 38.21, 48.47], "box_source": "pixel_extent",
         "date": "2026-10-11", "scan_id": "S1", "direction": "added", "sensor": "Sentinel-1 radar"}
    ctx = {"zone_name": "Vuhlehirska power station", "country": "Ukraine", "dates_before": ["2026-07-13"], "dates_after": ["2026-10-11"],
           "nearby": ["11 Oct · geoconfirmed_event · shelling reported"]}
    return {"finding": f, "images": {"radar_after": fa.boxed_png(_png(), [0.4, 0.4, 0.2, 0.2]), "radar_before": _png((40, 40, 40))},
            "ctx": ctx, "facts": fa.facts_text(f, ctx)}


class FakeClient:
    def __init__(self, answer):
        self.calls = []
        outer = self

        class _C:
            def create(self, **kw):
                outer.calls.append(kw)
                return types.SimpleNamespace(
                    choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=json.dumps(answer)))],
                    usage=types.SimpleNamespace(prompt_tokens=7000, completion_tokens=300))
        self.chat = types.SimpleNamespace(completions=_C())


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(fa, "_root_override", tmp_path)
    monkeypatch.setattr(openai_gate, "spent_this_month", lambda: 0.0)
    monkeypatch.setenv("OPENAI_BUDGET_USD", "11")
    import usage_tracker
    monkeypatch.setattr(usage_tracker, "record_call", lambda **kw: None)
    yield


ANSWER = {"verdict": "likely_benign", "confidence": 0.7, "most_likely": "harvest / soil moisture",
          "reasons": ["Bright returns follow field edges."], "would_confirm": ["a second radar pass in 6 days"], "limits": []}


def test_runs_once_then_answers_from_the_cache():
    c = FakeClient(ANSWER)
    g = _g()
    a = fa.run(g, "ZONE-005", client_factory=lambda p: c)
    assert a["verdict"] == "likely_benign" and a["cached"] is False
    assert a["cost_usd"] > 0 and a["tokens_in"] == 7000
    assert a["label"].startswith("AI assessment")
    # the resolution limit is always stated
    assert any("hospital" in x for x in a["limits"])
    # images went as low-detail data URLs, with the facts
    content = c.calls[0]["messages"][1]["content"]
    assert sum(1 for x in content if x["type"] == "image_url") == 2
    assert "1.4 ha" in content[0]["text"] and "Ukraine" in content[0]["text"]
    b = fa.run(_g(), "ZONE-005", client_factory=lambda p: c)
    assert b["cached"] is True and len(c.calls) == 1          # never paid twice


def test_different_images_are_a_different_question():
    c = FakeClient(ANSWER)
    fa.run(_g(), "ZONE-005", client_factory=lambda p: c)
    g2 = _g()
    g2["images"]["optical"] = _png((10, 200, 10))
    fa.run(g2, "ZONE-005", client_factory=lambda p: c)
    assert len(c.calls) == 2


def test_refused_over_budget_without_calling(monkeypatch):
    monkeypatch.setattr(openai_gate, "spent_this_month", lambda: 10.9999)
    c = FakeClient(ANSWER)
    with pytest.raises(fa.AssessRefused, match="budget"):
        fa.run(_g(), "ZONE-005", client_factory=lambda p: c)
    assert c.calls == []


def test_refused_without_a_client_or_images():
    with pytest.raises(fa.AssessRefused):
        fa.run(_g(), "ZONE-005", client_factory=lambda p: None)
    g = _g()
    g["images"] = {}
    with pytest.raises(fa.AssessRefused, match="nothing to look at"):
        fa.run(g, "ZONE-005", client_factory=lambda p: FakeClient(ANSWER))


def test_preview_never_calls_the_model(monkeypatch):
    called = []
    monkeypatch.setattr(openai_gate, "get_client", lambda *a, **k: called.append(1))
    p = fa.preview(_g(), "ZONE-005")
    assert p["status"] == "none" and p["estimate_usd"] > 0 and called == []


def test_a_malformed_answer_becomes_uncertain():
    v = fa.normalise_verdict({"verdict": "definitely!", "confidence": "x"})
    assert v["verdict"] == "uncertain" and v["confidence"] == 0.5 and v["reasons"] and v["would_confirm"]


def test_nothing_runs_it_automatically():
    """Only its router imports it — no loop, no producer, no startup task."""
    here = pathlib.Path(__file__).parent
    users = sorted(str(p.relative_to(here)) for p in here.rglob("*.py")
                   if "venv" not in p.parts and "site-packages" not in p.parts
                   and "finding_assess" in p.read_text(errors="ignore")
                   and p.name not in ("finding_assess.py", "test_finding_assess.py"))
    assert users == ["main.py"]          # main.py only includes routers/finding_assess.py
    assert "finding_assess" in (here / "routers" / "finding_assess.py").read_text()
