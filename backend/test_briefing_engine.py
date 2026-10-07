"""The briefing engine end to end with a stand-in for Claude: research keeps
only URLs the search returned, the writer's JSON becomes a printed issue,
validation repairs what it can, the ledger counts, the deck builds."""
import json
import types
from pathlib import Path

import pytest

from briefing import deck, job, llm
from test_briefing_collect import NOW, UID, db  # noqa: F401  (fixture)


class FakeStream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


def _msg(text, results=()):
    blocks = [types.SimpleNamespace(type="web_search_tool_result",
                                    content=[types.SimpleNamespace(url=u, title="t", page_age=None) for u in results])] if results else []
    blocks.append(types.SimpleNamespace(type="text", text=text))
    usage = types.SimpleNamespace(input_tokens=1000, output_tokens=500, cache_read_input_tokens=4000, cache_creation_input_tokens=0,
                                  server_tool_use=types.SimpleNamespace(web_search_requests=len(results)))
    return types.SimpleNamespace(content=blocks, usage=usage, stop_reason="end_turn")


class FakeClaude:
    def __init__(self):
        self.calls = []
        self.messages = self

    def stream(self, **kw):
        user = kw["messages"][0]["content"]
        self.calls.append(user[:40])
        if "Return findings" in user or "kind 'horizon'" in user:
            body = {"findings": [
                {"claim": "Police confirm a protest blocked Friedrichstraße on 6 October.", "date": "2026-10-06", "url": "https://www.berlin.de/polizei/x",
                 "publisher": "Polizei Berlin", "title": "Meldung", "tier": 1, "interested": False, "kind": "corroboration", "sid": "S-01", "relevance": "near the site"},
                {"claim": "Invented.", "date": "2026-10-06", "url": "https://made-up.example/never-returned", "publisher": "X", "tier": 2}]}
            return FakeStream(_msg(json.dumps(body), results=["https://berlin.de/polizei/x"]))
        if user.startswith("Plan the"):
            return FakeStream(_msg("```json\n" + json.dumps(PLAN) + "\n```"))
        if user.startswith("Write section"):
            return FakeStream(_msg(json.dumps(SECTION)))
        if user.startswith("Write the back matter"):
            return FakeStream(_msg(json.dumps(BACK)))
        if user.startswith("Validation found"):
            return FakeStream(_msg(json.dumps({"meanings": {}, "glossary": [{"term": "XYZ", "meaning": "Ein Beispielkürzel."}], "forecasts": []})))
        raise AssertionError(user[:80])


PLAN = {
    "key_judgments": [{"id": "KJ-1", "title": "Proteste in Sichtweite des Umspannwerks nehmen zu.", "body": "Ein Protest blockierte die Friedrichstraße [S-99, Q-01].",
                       "band": "likely", "low": 60, "high": 75, "confidence": "medium", "change": "neu"}],
    "exposure": {"lead": "", "vectors": [{"id": "V1", "name": "Energieanlagen", "level": 3, "prev": 2, "delta": "▲", "drivers": "Protest [Q-01]", "decision": "Objektschutz"}], "movement": ""},
    "decisions": {"lead": "", "items": [{"id": "E-1", "what": "Zaunkontrolle verdichten", "vector": "V1", "owner": "Werkschutz", "due": "15.10.2026", "urgency": "high", "rationale": "Nähe [Q-01]."}]},
    "sections": [{"id": "s1", "number": "1", "kicker": "ABSCHNITT 1", "title": "Standort Berlin", "lead": "", "vectors": ["V1"],
                  "subsections": [{"title": "Proteste", "covers": "", "sids": [], "qids": ["Q-01"], "figure": "F1"}]}],
    "chronology": {"lead": "", "rows": [{"date": "06.10.", "event": "Protest [Q-01]", "vector": "V1", "tag": "FACT"}], "meaning": "Nähe zählt."},
    "sites": {"OA-1": "Der Protest lag 1 km entfernt [Q-01]."},
    "glossary": [],
}
SECTION = {"lead": "Ein Protest in Sichtweite.", "subsections": [
    {"title": "Proteste", "blocks": [{"type": "figure", "figure": "F1"},
                                    {"type": "p", "tag": "FACT", "text": "Ein Protest blockierte die Friedrichstraße, gemeldet vom XYZ [Q-01]."},
                                    {"type": "p", "tag": "FORECAST", "text": "Es wird weitere Proteste geben."}]}]}
BACK = {"scenarios": {"lead": "", "items": [{"key": "A", "title": "Ruhe", "p": 60, "text": "", "trigger": "", "measure": ""}]},
        "indicators": {"lead": "", "rows": [{"id": "I-1", "name": "Proteste je Woche", "threshold": ">2", "current": "1", "trend": "rising", "lead": "7 Tage"}]},
        "calendar": {"rows": [], "wildcards": []}, "gaps": {"rows": [], "excluded": []},
        "imagery": {"lead": "", "meaning": ""}, "method": {"procedure": "Wie beschrieben.", "checks": [], "weakest": "", "internal": "", "limits": ""}}


@pytest.fixture()
def runs(tmp_path, monkeypatch):
    monkeypatch.setattr(job, "run_dir", lambda rid: (tmp_path / rid).mkdir(exist_ok=True) or (tmp_path / rid))
    return tmp_path


def test_a_model_run_end_to_end(db, runs):  # noqa: F811
    fake = FakeClaude()
    r = job.start(UID, "weekly", "de", end=NOW, db_path=db, background=False, cli=fake)
    assert r["status"] == "done", r.get("error")
    assert r["mode"] == "model" and r["pages"] >= 5
    assert r["qa"]["layout"] == []
    doc = json.loads((runs / r["id"] / "doc.json").read_text())
    regs = [s for s in doc["sources"] if s["id"].startswith("Q-")]
    assert [s["url"] for s in regs] == ["https://www.berlin.de/polizei/x"], "only URLs the search returned are kept"
    assert "S-99" not in json.dumps(doc["key_judgments"]), "a reference to nothing is removed"
    sec = doc["sections"][0]["subsections"][-1]["blocks"]
    assert sec[-1]["type"] != "meaning"  # the fake writer forgot it …
    kinds = {i["kind"] for i in doc["meta"]["qa_issues"]}
    assert "no_meaning" in kinds and "forecast_unfalsifiable" in kinds   # … and validation says so
    assert any(g["term"] == "XYZ" for g in doc["glossary"]), "the repair pass defined the abbreviation"
    assert doc["sites"][0]["text"].startswith("Der Protest")
    led = r["ledger"]
    assert led["calls"] == len(fake.calls) and led["usd"] > 0 and led["tokens_cached"] > 0
    assert (runs / r["id"] / "briefing.pdf").exists()
    out = deck.build(doc, runs / "d.pptx")
    assert Path(out).stat().st_size > 20000


def test_without_a_model_the_run_is_a_rehearsal(db, runs, monkeypatch):  # noqa: F811
    monkeypatch.setattr(llm, "client", lambda: (_ for _ in ()).throw(llm.Unavailable("no ANTHROPIC_API_KEY is set")))
    r = job.start(UID, "daily", "en", end=NOW, db_path=db, background=False)
    assert r["status"] == "done" and r["mode"] == "rehearsal" and "ANTHROPIC" in r["reason"]
    doc = json.loads((runs / r["id"] / "doc.json").read_text())
    assert doc["meta"]["rehearsal"] and doc["sites"]


def test_the_cap_stops_spending_and_still_delivers(db, runs, monkeypatch):  # noqa: F811
    monkeypatch.setattr(job, "cap_for", lambda c: 0.0)
    r = job.start(UID, "weekly", "fr", end=NOW, db_path=db, background=False, cli=FakeClaude())
    assert r["status"] == "done" and r["mode"] == "rehearsal" and "cap" in r["reason"]
