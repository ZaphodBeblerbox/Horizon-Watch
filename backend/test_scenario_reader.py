"""
The scenario reader's guards.

The model is not tested here. What IS tested is every rule that stands
between a model's answer and something an analyst would forecast from —
because a fabricated signal in a scenario reading is the one failure that
would make the whole feature untrustworthy.
"""
import json
import scenario_reader as sr


class _Resp:
    """The shape openai returns, enough of it to drive the reader."""
    def __init__(self, payload):
        self.choices = [type("C", (), {"message": type("M", (), {
            "content": json.dumps(payload)})()})()]
        self.usage = None


def _patch(monkeypatch, payload):
    import openai_gate

    class _Client:
        class chat:
            class completions:
                @staticmethod
                def create(**_):
                    return _Resp(payload)

    monkeypatch.setattr(openai_gate, "get_client", lambda *_a, **_k: _Client)
    monkeypatch.setattr(openai_gate, "model_for", lambda *_a, **_k: "gpt-4o-mini")


SIGNALS = [
    {"headline": "Tanker dark for 9h off Hodeidah", "location": "Hodeidah, Yemen",
     "severity_tier": "critical", "source": "ais"},
    {"headline": "New revetment at Al Hudaydah", "location": "Hodeidah, Yemen",
     "severity_tier": "significant", "source": "sentinel"},
]
SCENARIO = {"name": "Red Sea interdiction", "target": "Yemen",
            "target_place": "Hodeidah", "aggressor": "Houthi forces",
            "coa": "hybrid", "analogues": [], "note": ""}


def test_a_quoted_signal_that_was_never_given_is_dropped(monkeypatch):
    """The failure that matters. A reading that cites something which does
    not exist is worse than no reading, because it cannot be checked."""
    _patch(monkeypatch, {
        "bearing": [
            {"headline": "Tanker dark for 9h off Hodeidah", "why": "fits",
             "direction": "supports"},
            {"headline": "Carrier group enters the Red Sea", "why": "invented",
             "direction": "supports"},
        ],
        "indicators": [], "assessment": "x",
    })
    out = sr.read_against_signals(SCENARIO, SIGNALS)
    assert out["ok"]
    assert [b["headline"] for b in out["bearing"]] == ["Tanker dark for 9h off Hodeidah"]
    # Counted, so a model that does this often is visible rather than quiet.
    assert out["fabricated_dropped"] == 1


def test_an_unknown_direction_becomes_ambiguous(monkeypatch):
    # "confirms" is not one of the three. Silently keeping it would let a
    # reader's UI fall through to a default it did not choose.
    _patch(monkeypatch, {
        "bearing": [{"headline": "New revetment at Al Hudaydah", "why": "y",
                     "direction": "confirms"}],
        "indicators": [], "assessment": "",
    })
    out = sr.read_against_signals(SCENARIO, SIGNALS)
    assert out["bearing"][0]["direction"] == "ambiguous"


def test_no_signals_means_no_model_call_and_an_honest_answer(monkeypatch):
    called = []
    import openai_gate
    monkeypatch.setattr(openai_gate, "get_client",
                        lambda *a, **k: called.append(1) or None)
    out = sr.read_against_signals(SCENARIO, [])
    assert out["ok"] and out["count"] == 0
    assert out["bearing"] == [] and out["indicators"] == []
    assert "Yemen" in out["assessment"]
    # Asking a model to read an empty set is how prose about nothing is
    # written. It must not even be asked.
    assert not called


def test_a_draft_says_what_is_still_missing(monkeypatch):
    _patch(monkeypatch, {"name": "Hormuz mining", "target": "Oman",
                         "aggressor": "", "coa": "naval", "analogues": ["Tanker War"],
                         "note": "aggressor not named", "confidence": 0.6})
    d = sr.draft_from_text("Mines in Hormuz against tanker traffic, like the tanker war")
    assert d["ok"]
    # "naval" is not one of the five courses of action, so it is dropped
    # rather than stored as a value nothing else understands.
    assert d["fields"]["coa"] is None
    assert d["fields"]["analogues"] == ["Tanker War"]
    assert "no aggressor was named" in d["needs"]


def test_a_draft_refuses_a_target_that_is_its_own_aggressor(monkeypatch):
    _patch(monkeypatch, {"name": "x", "target": "Iran", "aggressor": "iran",
                         "coa": "missile", "analogues": [], "note": ""})
    d = sr.draft_from_text("something")
    assert "the target and the aggressor came back the same" in d["needs"]


def test_an_empty_paragraph_is_not_sent_to_a_model():
    assert sr.draft_from_text("   ")["ok"] is False
