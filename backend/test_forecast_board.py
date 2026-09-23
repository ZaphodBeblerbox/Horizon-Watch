"""Scenario boards — the spec addendum's four rules, enforced.

  1. the set must include "none of these"      -> residual, computed
  2. a probability without a base rate is a mood -> base rate per bar
  3. falsifiable before it resolves            -> indicators + falsifier
  4. the model shows its own record            -> Brier from resolutions
"""
import sqlite3
import forecast_board as fb
import conflict_model as cm


def _conn():
    c = sqlite3.connect(":memory:")
    fb.ensure_schema(c)
    return c


def _series(counts, start=24000):
    return [{"m": start + i, "events": c, "deaths": c * 2}
            for i, c in enumerate(counts)]


def test_the_residual_is_computed_never_authored():
    # Three named scenarios summing to 100% is a lie; a board that
    # cannot say "something nobody listed" trains people to pick from a
    # menu.
    scen = [{"p": 0.07}, {"p": 0.24}, {"p": 0.13}]
    assert round(max(0.0, 1.0 - sum(s["p"] for s in scen)), 2) == 0.56


def test_a_proposal_moves_the_residual():
    c = _conn()
    fb.add_proposal(c, board="FB-X", label="Cross-border raid", p=0.2)
    rows = fb._proposals(c, "FB-X")
    assert len(rows) == 1 and rows[0]["p"] == 0.2
    # The board recomputes 1 - sum, so adding 0.2 must take 0.2 off the
    # residual rather than leaving it stale.
    assert round(1.0 - sum(r["p"] for r in rows), 3) == 0.8


def test_a_proposal_is_tagged_as_the_analysts_and_has_no_measured_base_rate():
    c = _conn()
    fb.add_proposal(c, board="FB-X", label="Port strike", p=0.3, author="marc")
    r = fb._proposals(c, "FB-X")[0]
    assert r["origin"] == "analyst" and r["mine"] is True
    # An authored scenario has no history to measure a base rate from,
    # and inventing one would be the laundering the spec forbids.
    assert r["base"] is None


def test_certainty_is_refused():
    c = _conn()
    assert fb.add_proposal(c, board="B", label="x", p=0.0)["ok"] is False
    assert fb.add_proposal(c, board="B", label="x", p=1.0)["ok"] is False
    assert fb.add_proposal(c, board="B", label="x", p=0.5)["ok"] is True


def test_a_proposal_needs_a_description():
    c = _conn()
    assert fb.add_proposal(c, board="B", label="   ", p=0.3)["ok"] is False


def test_a_missing_falsifier_is_recorded_as_missing_not_hidden():
    c = _conn()
    fb.add_proposal(c, board="B", label="x", p=0.3, falsifier="")
    assert fb._proposals(c, "B")[0]["falsifier"] is None


def test_the_record_says_nothing_rather_than_implying_a_score():
    c = _conn()
    r = fb.record(c)
    assert r["n"] == 0 and r["brier"] is None
    assert "never be wrong" in r["calibration"]


def test_resolutions_are_the_only_thing_that_moves_the_record():
    c = _conn()
    for i in range(10):
        fb.resolve(c, scenario_id=f"SC-{i}", board="B", p=0.7,
                   origin="model", outcome=1 if i < 7 else 0)
    r = fb.record(c, "B")
    assert r["n"] == 10
    # Called 0.7, happened 0.7 of the time: perfectly calibrated here.
    assert abs(r["overconfident"]) < 0.01
    assert "70%" in r["calibration"]


def test_analyst_and_model_records_are_kept_apart():
    # An analyst's 30% and a model's 30% are different objects with
    # different track records; averaging destroys the calibration line.
    c = _conn()
    fb.resolve(c, scenario_id="M1", board="B", p=0.9, origin="model", outcome=1)
    fb.resolve(c, scenario_id="A1", board="B", p=0.9, origin="analyst", outcome=0)
    r = fb.record(c, "B")
    assert set(r["by_origin"]) == {"model", "analyst"}
    assert r["by_origin"]["model"]["brier"] < r["by_origin"]["analyst"]["brier"]


def test_resolving_twice_corrects_rather_than_double_counts():
    c = _conn()
    fb.resolve(c, scenario_id="S1", board="B", p=0.5, origin="model", outcome=0)
    fb.resolve(c, scenario_id="S1", board="B", p=0.5, origin="model", outcome=1)
    assert fb.record(c, "B")["n"] == 1


def test_the_base_rate_is_measured_from_the_locales_own_history():
    # 7% means nothing; 7% against a 2% base rate is the model departing
    # from history and owing you a reason.
    steady = _series([10] * 80)
    assert fb.historical_base_rate(steady) == 0.0
    rising = _series([i for i in range(80)])
    assert fb.historical_base_rate(rising) > 0.5


def test_every_scenario_can_be_falsified_before_it_resolves():
    f = fb.falsifier_for(_series([6] * 40), "state-based conflict")
    assert "consecutive months" in f
    assert any(ch.isdigit() for ch in f)


def test_indicators_say_what_to_watch_and_where():
    inds = fb.indicators_for(_series([5] * 40), "state-based conflict")
    assert inds
    for label, source, direction, weight in inds:
        assert label and source
        assert direction in ("up", "down")
        assert 0 < weight <= 1


def test_an_unskilled_model_is_not_shown_as_a_forecast(monkeypatch):
    # Rule 4's point: an unskilled forecast presented as a forecast
    # launders a guess into a number.
    c = _conn()
    monkeypatch.setattr(fb, "fitted", lambda _c, **_k: {
        "panel": {}, "fit": {"available": True, "skilful": False, "skill": -0.02}})
    out = fb.get_board(c, "FB-X")
    assert out["available"] is False
    assert "does not beat the base rate" in out["error"]


def test_an_unavailable_model_reports_why():
    c = _conn()
    import forecast_board as m
    saved = m.fitted
    m.fitted = lambda _c, **_k: {"panel": {}, "fit": {"available": False, "reason": "no data"}}
    try:
        out = m.get_board(c, "FB-X")
        assert out["available"] is False and "no data" in out["error"]
    finally:
        m.fitted = saved


# ── predictions as signals for the briefing ───────────────────────────

def test_a_forecast_on_its_base_rate_is_not_a_signal():
    """The tick's argument, applied at write time.

    If every locale published every quarter the briefing would fill with
    restatements of the obvious and the real departures would be lost in
    them.
    """
    ok, why = fb.signal_worthy(0.55, 0.55)
    assert ok is False
    assert "history already said" in why


def test_a_material_departure_is_a_signal_and_says_which_way():
    ok, why = fb.signal_worthy(0.62, 0.30)
    assert ok is True and "above" in why
    ok2, why2 = fb.signal_worthy(0.30, 0.62)
    assert ok2 is True and "below" in why2


def test_a_tripling_of_a_tiny_probability_is_still_nothing():
    # 1% to 4% is a large relative move and not worth a line.
    assert fb.signal_worthy(0.04, 0.01)[0] is False


def test_an_authored_scenario_publishes_on_the_analysts_say_so():
    ok, why = fb.signal_worthy(0.4, None)
    assert ok is True and "no measured base rate" in why


def test_published_signals_are_marked_as_forecasts_not_observations(monkeypatch):
    """The whole risk of this integration.

    The briefing pipeline treats alerts as things that happened. A
    probability dropped into that stream unmarked becomes, two hands
    later, a fact.
    """
    c = _conn()
    seen = []
    monkeypatch.setattr(fb, "fitted", lambda _c, **_k: {
        "panel": {("Testland", "state-based conflict"): _series([5] * 60)},
        "fit": {"available": True, "skilful": True, "skill": 0.18,
                "model": _AlwaysHigh()},
    })
    out = fb.publish_signals(c, lambda a: seen.append(a))
    assert out["written"] == 1, out
    a = seen[0]
    assert a["title"].startswith("Forecast —")
    assert a["raw"]["is_forecast"] is True
    assert "not-an-observation" in a["tags"]
    assert a["source"] == "forecast"
    assert a["raw"]["falsifier"]
    assert "not an observation" in a["raw"]["caveat"]


def test_the_alert_id_is_deterministic_so_republishing_updates(monkeypatch):
    c = _conn()
    a, b = [], []
    panel = {("Testland", "state-based conflict"): _series([5] * 60)}
    monkeypatch.setattr(fb, "fitted", lambda _c, **_k: {
        "panel": panel, "fit": {"available": True, "skilful": True,
                                "skill": 0.18, "model": _AlwaysHigh()}})
    fb.publish_signals(c, lambda x: a.append(x))
    fb.publish_signals(c, lambda x: b.append(x))
    assert a[0]["id"] == b[0]["id"]


def test_an_unskilled_model_publishes_nothing(monkeypatch):
    c = _conn()
    seen = []
    monkeypatch.setattr(fb, "fitted", lambda _c, **_k: {
        "panel": {}, "fit": {"available": True, "skilful": False, "skill": 0.0}})
    out = fb.publish_signals(c, lambda a: seen.append(a))
    assert out["written"] == 0 and seen == []


def test_the_model_is_classified_c_and_the_analyst_b():
    # So a briefing can tell machine from analyst without reading prose.
    import provenance
    assert provenance.provenance_for_alert_source("forecast") == ("C", "T2")
    assert provenance.provenance_for_alert_source("forecast_analyst") == ("B", "T2")


class _AlwaysHigh:
    """A stand-in classifier that is confident, so the departure is real.

    Returns a numpy array because that is what sklearn returns and the
    caller slices it as one; a list of lists passes a naive test and
    fails against the real model.
    """
    def predict_proba(self, rows):
        import numpy as np
        return np.array([[0.1, 0.9] for _ in rows])


def _rules_conn():
    c = sqlite3.connect(":memory:")
    fb.ensure_schema(c)
    c.execute("CREATE TABLE rule_configs (id INTEGER PRIMARY KEY, name TEXT,"
              " rule_name TEXT, trigger_type TEXT, severity TEXT, icon_type TEXT,"
              " enabled INT, params TEXT, created_at TEXT, updated_at TEXT)")
    return c


def test_watching_creates_a_rule_per_indicator():
    c = _rules_conn()
    out = fb.watch(c, scenario_id="SC-1", board="FB-X", label="Escalation",
                   indicators=[["Rail throughput above baseline", "UCDP", "up", 0.4],
                               ["Tone falling", "GDELT", "down", 0.2]])
    assert out["created"] == 2
    assert c.execute("SELECT COUNT(*) FROM rule_configs").fetchone()[0] == 2


def test_the_rule_fires_on_the_detector_not_on_the_forecast():
    """A probability changing is not something anyone can act on."""
    import json
    c = _rules_conn()
    fb.watch(c, scenario_id="SC-1", board="FB-X", label="Escalation",
             indicators=[["Rail throughput above baseline", "UCDP", "up", 0.4]])
    name, params = c.execute(
        "SELECT trigger_type, params FROM rule_configs").fetchone()
    assert name == "forecast_indicator"
    p = json.loads(params)
    assert p["observable"] == "Rail throughput above baseline"
    assert p["source"] == "UCDP"
    # So a rule firing months later can still say which forecast asked
    # for it.
    assert p["scenario"] == "SC-1" and "Escalation" in p["why"]


def test_pressing_watch_twice_does_not_duplicate_rules():
    c = _rules_conn()
    inds = [["Rail throughput above baseline", "UCDP", "up", 0.4]]
    fb.watch(c, scenario_id="SC-1", board="FB-X", indicators=inds)
    second = fb.watch(c, scenario_id="SC-1", board="FB-X", indicators=inds)
    assert second["created"] == 0 and second["already_watched"] == 1
    assert c.execute("SELECT COUNT(*) FROM rule_configs").fetchone()[0] == 1


def test_a_malformed_indicator_is_skipped_not_stored():
    c = _rules_conn()
    out = fb.watch(c, scenario_id="SC-1", board="FB-X",
                   indicators=[["ok", "UCDP", "up", 0.4], ["too", "short"], [], None, ["  ", "x", "up", 1]])
    assert out["created"] == 1
    assert c.execute("SELECT COUNT(*) FROM rule_configs").fetchone()[0] == 1
