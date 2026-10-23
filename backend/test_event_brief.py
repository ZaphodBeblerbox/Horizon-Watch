"""The evolving cited brief (DATAMINR_PLAN B3): v1 by code, model rewrites only where watched and when something
changed, at most one per 10 min; code drops uncited facts, numbers not in quotes, places not in the reports."""
import datetime as dt
import json
import sqlite3

import pytest

import attention
import events as ev
from test_events import BASTILLE, T0, atom, off

PARIS = {"open": False, "points": [{"lat": 48.86, "lon": 2.35, "reach": 30.0, "focus": True, "name": "HQ", "kind": "asset"}],
         "countries": {"france"}, "users_with_profile": 1}
NOBODY = {"open": False, "points": [], "countries": set(), "users_with_profile": 1}
USER = {"assets": [{"lat": 48.86, "lon": 2.35, "radius": 30.0, "name": "HQ", "label": "office"}], "theaters": [],
        "countries": set(), "topics": set(), "alerts": {}}


@pytest.fixture
def con(tmp_path, monkeypatch):
    c = sqlite3.connect(str(tmp_path / "b.db"))
    ev.ensure_tables(c)
    monkeypatch.setattr(attention, "STATS", {})
    monkeypatch.setattr("openai_gate.refusal", lambda p: None)
    yield c
    c.close()


def members(con, eid):
    return ev._members_of(con, [eid])[eid]


def run(con, eid, at, fn, watch=PARIS):
    return ev.maybe_rebrief(con, eid, at, brief_fn=fn, concerns=[USER], watch=watch, attention_rows=[])


def test_v1_is_written_by_code_and_costs_nothing(con):
    eid = ev.assign(con, atom(1, quote="explosion"), T0)
    calls = []
    out = run(con, eid, T0, lambda *a: calls.append(a) or ({}, 0))
    b = ev.get(con, eid, T0)["brief"]
    assert out == {"version": 1, "by": "code"} and not calls
    assert b["by"] == "code" and b["summary"].startswith("Explosion at Place de la Bastille") and "First reported" in b["summary"]
    assert b["facts"][0]["cites"] == ["tg:chanA:1"] and b["facts"][0]["sources"][0]["url"] == "https://t.me/chanA/1"


def test_a_change_where_someone_watches_is_rewritten_by_the_model_and_checked(con):
    eid = ev.assign(con, atom(1, text="Explosion at Place de la Bastille, 3 injured", quote="Explosion at Place de la Bastille"), T0)
    run(con, eid, T0, None)
    ev.assign(con, atom(2, chan="b", text="Une détonation entendue, témoins choqués, 3 blessés", first_hand=True), T0 + dt.timedelta(minutes=3))
    raw = {"summary": "An explosion is reported at Place de la Bastille, confirmed by 2 independent sources.",
           "facts": [{"text": "3 people injured at Place de la Bastille", "cites": ["tg:chanA:1"]},       # kept
                     {"text": "An explosion near the Opera", "cites": ["tg:b:2"]},                         # a place not reported
                     {"text": "12 people injured", "cites": ["tg:chanA:1"]},                                # a number not quoted
                     {"text": "Police closed the square", "cites": []},                                    # uncited
                     {"text": "Fire at the square", "cites": ["tg:nope:9"]}],                              # not a member
           "what_changed": "A second source"}
    seen = []
    out = run(con, eid, T0 + dt.timedelta(minutes=4), lambda v, ms, prev: seen.append(prev) or (raw, 0.0006))
    assert out["by"] == "model" and out["significant"] and out["dropped"] == {"uncited": 2, "number": 1, "place": 1}
    b = ev.get(con, eid, T0 + dt.timedelta(minutes=4))["brief"]
    assert b["version"] == 2 and b["by"] == "model" and [f["text"] for f in b["facts"]] == ["3 people injured at Place de la Bastille"]
    assert b["summary"] == raw["summary"] and "Now 2 independent sources" in b["what_changed"]
    assert seen[0].startswith("Explosion at Place de la Bastille")                    # the previous summary went in


def test_a_summary_carrying_a_dropped_number_falls_back_to_the_code(con):
    eid = ev.assign(con, atom(1), T0)
    ms = members(con, eid)
    out = ev.verify_brief({"summary": "12 dead at Place de la Bastille.", "facts": [{"text": "12 dead", "cites": ["tg:chanA:1"]}]},
                          ms, "CODE SUMMARY")
    assert out["summary"] == "CODE SUMMARY" and out["summary_fallback"] and out["dropped"]["number"] == 1


def test_no_model_call_when_nobody_watches(con):
    eid = ev.assign(con, atom(1), T0)
    run(con, eid, T0, None, NOBODY)
    ev.assign(con, atom(2, chan="b", text="autre texte, témoin direct", first_hand=True), T0 + dt.timedelta(minutes=2))
    calls = []
    out = run(con, eid, T0 + dt.timedelta(minutes=3), lambda *a: calls.append(1) or ({}, 0), NOBODY)
    assert not calls and out["by"] == "code" and out["model_skipped"] == "not watched by anyone"
    assert attention.STATS["brief"]["skipped_not_watched"] >= 1


def test_at_most_one_rewrite_per_ten_minutes_then_the_pending_change_is_rewritten(con):
    eid = ev.assign(con, atom(1, act="crowd_movement"), T0)
    run(con, eid, T0, None)
    calls = []
    fn = lambda v, ms, prev: calls.append(1) or ({"summary": "A crowd is reported at Place de la Bastille.", "facts": []}, 0)  # noqa: E731
    ev.assign(con, atom(2, act="arrest", chan="b", text="arrestation à Bastille"), T0 + dt.timedelta(minutes=1))
    assert run(con, eid, T0 + dt.timedelta(minutes=1), fn)["by"] == "model"
    ev.assign(con, atom(3, act="police_intervention", chan="c", text="charge policière place de la Bastille 2 blessés"),
              T0 + dt.timedelta(minutes=4))
    out = run(con, eid, T0 + dt.timedelta(minutes=5), fn)
    assert out["by"] == "code" and out["model_skipped"] == "rewritten under 10 min ago" and len(calls) == 1
    assert run(con, eid, T0 + dt.timedelta(minutes=6), fn) is None                      # nothing new, still inside the gap
    out = run(con, eid, T0 + dt.timedelta(minutes=12), fn)                               # the pending rewrite
    assert out["by"] == "model" and not out["significant"] and len(calls) == 2


def test_the_fallback_template_needs_no_budget(con, monkeypatch):
    monkeypatch.setattr("openai_gate.refusal", lambda p: "'brief' spent its monthly share ($4.00, brief)")
    monkeypatch.setattr("openai_gate.get_client", lambda p: pytest.fail("no client when the share is spent"))
    eid = ev.assign(con, atom(1), T0)
    ev.maybe_rebrief(con, eid, T0, concerns=[USER], watch=PARIS, attention_rows=[])
    ev.assign(con, atom(2, chan="b", text="vu de mes yeux, explosion", first_hand=True), T0 + dt.timedelta(minutes=2))
    out = ev.maybe_rebrief(con, eid, T0 + dt.timedelta(minutes=3), concerns=[USER], watch=PARIS, attention_rows=[])
    assert out["by"] == "code" and "monthly share" in out["model_skipped"]
    assert ev.get(con, eid, T0 + dt.timedelta(minutes=3))["brief"]["version"] == 2


def test_what_is_significant(con):
    base = {"act": "crowd_movement", "rank": ev.rank_of("crowd_movement"), "n": 1, "level": "unverified", "status": "developing",
            "lat": 48.85, "lon": 2.37, "numbers": [], "max_priority": "alert", "members": 1}
    assert ev.changes(base, {**base, "n": 2, "members": 2})[2] is False                    # one more source: a quiet update
    assert ev.changes(base, {**base, "act": "arrest", "rank": ev.rank_of("arrest")})[2]   # a graver act
    assert ev.changes(base, {**base, "level": "corroborated", "n": 2})[2]
    assert ev.changes(base, {**base, "numbers": [12]})[2]
    lat, lon = off(48.85, 2.37, north_m=3000)
    assert ev.changes(base, {**base, "lat": lat, "lon": lon})[2]
    assert ev.changes(base, {**base, "status": "ended"})[2] is False                       # ended is silent
    assert ev.changes(base, {**base, "max_priority": "urgent"})[2]                        # priority rose for someone
    assert ev.casualty_numbers(["12 arrests at Bastille", "3 blessés", "line 14"]) == [3, 12]
    assert json.dumps(ev.changes(base, base)) == json.dumps([[], [], False])
