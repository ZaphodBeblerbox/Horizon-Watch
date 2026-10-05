"""
The day's outlook, and the rules that keep it a forecast.

WHAT THIS REPLACED. "Escalation in non-state conflict · 90% · above its own
base rate of 33%." A category, a quarter-long window, and nothing that
could ever be shown to have been wrong. Every test here guards one of the
properties that distinguishes the new thing from that.
"""
import datetime

import outlook


SIGNALS = [
    {"headline": "Over 70 dead in fighting around Yemen's Taiz in 24 hours",
     "location": "Lahj, Yemen", "source": "gdelt", "severity_tier": "critical",
     "lat": 13.1, "lon": 44.9, "url": "https://x.test/1"},
    {"headline": "Convoy ambushed on the Tillaberi road",
     "location": "Tillaberi, Niger", "source": "acled", "severity_tier": "significant"},
]


def _statement(**kw):
    base = {
        "place": "Yemen", "actor": "Houthi forces",
        "statement": "Houthi forces may intensify operations around Taiz",
        "because": "Over 70 deaths in 24 hours",
        "criterion": "A wire service reports territorial change in Taiz governorate",
        "resolves_by": (datetime.date.today() + datetime.timedelta(days=7)).isoformat(),
        "probability": 70,
        "citations": ["Over 70 dead in fighting around Yemen's Taiz in 24 hours"],
    }
    base.update(kw)
    return base


# ── citations ───────────────────────────────────────────────────────────

def test_a_statement_citing_nothing_is_dropped():
    """The line that makes this worth having. Without a citation it is
    indistinguishable from the thing it replaced."""
    out = outlook.validate([_statement(citations=[])], SIGNALS)
    assert out["outlook"] == []
    assert out["uncited_dropped"] == 1


def test_a_citation_that_was_never_given_is_dropped():
    out = outlook.validate([_statement(citations=["Carrier group enters the Red Sea"])], SIGNALS)
    assert out["outlook"] == []
    # Counted, so a model that fabricates often is visible rather than
    # quietly filtered.
    assert out["fabricated_citations"] == 1


def test_a_citation_comes_back_with_its_source_and_position():
    out = outlook.validate([_statement()], SIGNALS)
    c = out["outlook"][0]["citations"][0]
    assert c["source"] == "gdelt" and c["lat"] == 13.1 and c["url"] == "https://x.test/1"


# ── falsifiability ──────────────────────────────────────────────────────

def test_a_statement_with_no_criterion_is_not_a_forecast():
    out = outlook.validate([_statement(criterion="soon")], SIGNALS)
    assert out["outlook"] == []
    assert out["uncheckable_dropped"] == 1


def test_an_unfalsifiable_statement_is_dropped():
    """'May face increased scrutiny' carries a probability while meaning
    nothing: no observation settles it either way."""
    for hollow in ("RSF may face increased scrutiny after the crash",
                   "Israel may come under pressure over Gaza",
                   "Sudan may face mounting criticism",
                   "Kenya may see increased attention on road safety",
                   "The government may be urged to act"):
        out = outlook.validate([_statement(statement=hollow)], SIGNALS)
        assert out["outlook"] == [], hollow
        assert out["hollow_dropped"] == 1, hollow


def test_a_physical_action_is_kept():
    for real in ("Houthi forces may intensify operations around Taiz",
                 "RSF may attempt to retake Babanusa",
                 "Iran may close the Strait of Hormuz to tanker traffic",
                 "A convoy may be ambushed on the Tillaberi road"):
        out = outlook.validate([_statement(statement=real)], SIGNALS)
        assert len(out["outlook"]) == 1, real


# ── the probability and the date ────────────────────────────────────────

def test_a_probability_is_clamped_away_from_certainty():
    # A model that says 0 or 100 from a handful of wire reports is not
    # expressing certainty, it is failing to express doubt.
    assert outlook._clean_probability(0) == 5
    assert outlook._clean_probability(100) == 95
    assert outlook._clean_probability(62) == 62
    assert outlook._clean_probability("nonsense") is None


def test_a_resolution_date_must_be_ahead_and_near():
    today = datetime.date.today()
    assert outlook._clean_date((today - datetime.timedelta(days=1)).isoformat()) is None
    # A forecast resolving in six months cannot be scored this quarter.
    far = outlook._clean_date((today + datetime.timedelta(days=200)).isoformat())
    assert far == (today + datetime.timedelta(days=14)).isoformat()
    soon = (today + datetime.timedelta(days=5)).isoformat()
    assert outlook._clean_date(soon) == soon


def test_no_signals_means_no_model_call(monkeypatch):
    import openai_gate
    called = []
    monkeypatch.setattr(openai_gate, "get_client", lambda *a, **k: called.append(1) or None)
    out = outlook.build_outlook([])
    assert out["ok"] and out["outlook"] == []
    assert "no outlook to give" in out["note"]
    # An empty outlook is a true statement about a quiet day, and asking a
    # model for it would be paying to be told nothing.
    assert not called


def test_a_certainty_is_dropped_too():
    """The other way a forecast carries no information.

    "Road accidents may continue to claim lives in Kenya" is not
    unfalsifiable — it is certain, and a 60% on a certainty says nothing.
    A forecast has to be about a CHANGE.
    """
    for certain in ("Road accidents may continue to claim lives in Kenya",
                    "Fighting around Taiz may escalate further",
                    "Yemen may see further casualties",
                    "Violence may persist in Darfur"):
        out = outlook.validate([_statement(statement=certain)], SIGNALS)
        assert out["outlook"] == [], certain
        assert out["hollow_dropped"] == 1, certain


def test_a_specific_act_survives_the_word_further():
    """The guard must not be a keyword ban.

    "IDF may conduct further strikes in Gaza targeting Hamas operatives"
    names an actor, a place and a target — it is a forecast that happens to
    contain "further". "Fighting may escalate further" is not.
    """
    for real in ("IDF may conduct further strikes in Gaza targeting Hamas operatives",
                 "Aid trucks may be attacked again in South Kordofan",
                 "Houthi forces may seize the port at Hodeidah"):
        out = outlook.validate([_statement(statement=real)], SIGNALS)
        assert len(out["outlook"]) == 1, real
