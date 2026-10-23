"""Notify on a NEW event or a SIGNIFICANT update only, under one tag; the user's thresholds, mutes, quiet hours,
hourly cap and digest; following (DATAMINR_PLAN B2, B4; owner 2026-10-23)."""
import datetime as dt
import sqlite3

import pytest

import event_watch as ew
import events as ev
from test_events import BASTILLE, T0, atom, off

HQ = {"lat": BASTILLE[0], "lon": BASTILLE[1], "radius": 10.0, "name": "HQ", "label": "office"}


def user(**alerts):
    return {"assets": [HQ], "theaters": [{"lat": 48.86, "lon": 2.35, "reach": 350.0, "name": "Paris Watch", "id": "t1"}],
            "countries": set(), "topics": set(), "alerts": alerts}


@pytest.fixture
def con(tmp_path, monkeypatch):
    c = sqlite3.connect(str(tmp_path / "n.db"))
    ev.ensure_tables(c)
    c.execute("CREATE TABLE event_pushes (user_id TEXT NOT NULL, item_id TEXT NOT NULL, sent_at TEXT, PRIMARY KEY (user_id, item_id))")
    ew._ensure_push_log(c)
    monkeypatch.setattr("openai_gate.refusal", lambda p: "off in tests")
    monkeypatch.setattr(ew, "_attention_tz", lambda uid: None)
    yield c
    c.close()


def brief(con, eid, at, c):
    ev.maybe_rebrief(con, eid, at, concerns=[c], watch={"open": False, "points": [], "countries": set()}, attention_rows=[])


def cards(con, at):
    views = {v["id"]: v for v in ev.recent(con, at)}
    return [{"id": f"ev:{v['id']}", "event_id": v["id"], "kind": "telegram", "live_signal": True, "sev": "high",
             "title": v["headline"], "lat": v["lat"], "lon": v["lon"], "created_at": v["first_seen"]} for v in views.values()], views


def round_(con, c, at, follows=()):
    cs, views = cards(con, at)
    items = ew.personalize(cs, "u1", c, at, views=views, follows=list(follows))
    due = ew.due_cards(con, "u1", items, c, at)
    plan = ew.deliver_plan(con, "u1", due, ew.alert_rules(c), at)
    for t, b, d, card in plan:
        ew.log_push(con, "u1", d, card, at)
    con.commit()
    return plan, items


def test_new_then_quiet_update_then_significant_update_under_one_tag(con):
    c = user()
    m = lambda n: T0 + dt.timedelta(minutes=n)  # noqa: E731
    eid = ev.assign(con, atom(1, act="crowd_movement", pos=off(*BASTILLE, north_m=3000)), m(0))  # 3 km from HQ: Urgent
    brief(con, eid, m(0), c)
    plan, items = round_(con, c, m(1))
    assert len(plan) == 1 and plan[0][2]["id"] == f"ev:{eid}" and plan[0][0] == "New event · Urgent"
    # v2: one more source, not significant: nothing
    ev.assign(con, atom(2, act="crowd_movement", chan="b", text="foule rue de la Roquette", pos=off(*BASTILLE, north_m=3000)), m(5))
    brief(con, eid, m(5), c)
    assert ev.get(con, eid, m(5))["brief"]["version"] == 2
    assert round_(con, c, m(6))[0] == []
    # v3: a graver act (arrests): one push, the same tag, "Update: ..."
    ev.assign(con, atom(3, act="arrest", chan="c", text="interpellations en cours", pos=off(*BASTILLE, north_m=3000)), m(25))
    brief(con, eid, m(25), c)
    plan, items = round_(con, c, m(26))
    assert len(plan) == 1 and plan[0][2]["id"] == f"ev:{eid}" and plan[0][2]["item_id"] == f"ev:{eid}:v3"
    assert plan[0][0] == "Update · Critical alert" and "Arrest now reported" in plan[0][1] and plan[0][1].startswith("Update: ")
    card = next(i for i in items if i["event_id"] == eid)
    assert card["title"].startswith("Update: ") and card["update"] is True
    assert round_(con, c, m(27))[0] == []                            # once


def test_updates_inside_twenty_minutes_coalesce_and_a_rise_to_critical_goes_through(con):
    c = user()
    m = lambda n: T0 + dt.timedelta(minutes=n)  # noqa: E731
    eid = ev.assign(con, atom(1, act="crowd_movement", pos=off(*BASTILLE, north_m=3000)), m(0))
    brief(con, eid, m(0), c)
    assert len(round_(con, c, m(1))[0]) == 1
    ev.assign(con, atom(2, act="police_intervention", chan="b", text="charge de police", pos=off(*BASTILLE, north_m=3000)), m(5))
    brief(con, eid, m(5), c)
    assert round_(con, c, m(6))[0] == []                             # 5 min after the first push: waits
    plan = round_(con, c, m(22))[0]                                   # after the window: the latest version
    assert len(plan) == 1 and plan[0][2]["id"] == f"ev:{eid}"
    # a rise to Critical (an explosion seen by a witness near HQ) is not held by the window
    ev.assign(con, atom(3, act="explosion", chan="c", text="je vois une explosion", first_hand=True, pos=off(*BASTILLE, north_m=3000)), m(24))
    brief(con, eid, m(24), c)
    plan = round_(con, c, m(25))[0]
    assert len(plan) == 1 and plan[0][0] == "Update · Critical alert"


def test_a_developing_event_with_five_reports_gives_the_asset_owner_two_pushes(con):
    """THE ACCEPTANCE (B2): new + the corroborated update, not five."""
    c = user()
    m = lambda n: T0 + dt.timedelta(minutes=n)  # noqa: E731
    texts = ["explosion entendue", "blast heard downtown", "detonation forte", "smoke rising now", "loud bang heard"]
    pushes = []
    for i, t in enumerate(texts):
        at = m(i * 6)
        eid = ev.assign(con, atom(i, act="explosion", chan=f"c{i}", text=t, pos=off(*BASTILLE, north_m=5000)), at)
        brief(con, eid, at, c)
        pushes += round_(con, c, at + dt.timedelta(seconds=30))[0]
    pushes += round_(con, c, m(40))[0]
    assert len(pushes) == 2 and {p[2]["id"] for p in pushes} == {f"ev:{eid}"}


def test_thresholds_from_the_assistant_are_read(con):
    c = user(thresholds={"assets": "urgent", "theaters": "flash", "countries": "flash"}, level="near_mine")
    eid = ev.assign(con, atom(1, act="explosion", text="explosion", pos=(49.5, 2.35)), T0)   # in the theater, uncorroborated: Alert
    brief(con, eid, T0, c)
    plan, items = round_(con, c, T0 + dt.timedelta(minutes=1))
    assert plan == [] and items[0]["silent_reason"].startswith("below your threshold")
    c2 = user(thresholds={"theaters": "alert"})
    assert len(round_(con, c2, T0 + dt.timedelta(minutes=1))[0]) == 1


def test_a_followed_event_gets_its_updates_whatever_the_threshold(con):
    c = user(thresholds={"theaters": "flash"})
    eid = ev.assign(con, atom(1, act="crowd_movement", pos=(49.5, 2.35)), T0)
    brief(con, eid, T0, c)
    assert round_(con, c, T0 + dt.timedelta(minutes=1))[0] == []
    ev.follow(con, "u1", eid, now=T0)
    fs = ev.follows_of(con, "u1")
    plan, items = round_(con, c, T0 + dt.timedelta(minutes=2), fs)
    assert len(plan) == 1 and items[0]["followed"]


def test_a_muted_event_gets_no_push_and_an_area_mute_lets_critical_near_an_asset_through(con):
    until = (T0 + dt.timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    eid = ev.assign(con, atom(1, act="arrest", pos=off(*BASTILLE, north_m=500)), T0)       # within 2 km of HQ: Critical
    c = user(mutes=[{"event_id": eid, "until": until}])
    brief(con, eid, T0, c)
    plan, items = round_(con, c, T0 + dt.timedelta(minutes=1))
    assert plan == [] and items[0]["muted"]
    soft = user(mutes=[{"lat": BASTILLE[0], "lon": BASTILLE[1], "radius_km": 5, "until": until}])
    assert len(round_(con, soft, T0 + dt.timedelta(minutes=1))[0]) == 1
    con.execute("DELETE FROM event_pushes")
    con.execute("DELETE FROM push_log")
    hard = user(mutes=[{"lat": BASTILLE[0], "lon": BASTILLE[1], "radius_km": 5, "until": until, "hard": True}])
    assert round_(con, hard, T0 + dt.timedelta(minutes=1))[0] == []


def test_quiet_hours_let_critical_through_only(con):
    q = {"start": "13:00", "end": "07:00", "tz": "UTC"}                 # T0 is 14:00 UTC
    c = user(quiet_hours=q)
    urgent = ev.assign(con, atom(1, act="crowd_movement", pos=off(*BASTILLE, north_m=3000)), T0)
    crit = ev.assign(con, atom(2, act="arrest", chan="b", pos=off(*BASTILLE, north_m=-500), text="arrest"), T0)
    for e in (urgent, crit):
        brief(con, e, T0, c)
    plan, items = round_(con, c, T0 + dt.timedelta(minutes=1))
    assert [p[2]["id"] for p in plan] == [f"ev:{crit}"]
    assert next(i for i in items if i["event_id"] == urgent)["silent_reason"] == "quiet hours (Critical only)"
    assert ew.notifies({"kind": "fusion", "sev": "high", "lat": 1, "lon": 1}, c) is False
    assert ew.notifies({"kind": "exit", "sev": "high"}, c) is True


def test_the_seventh_push_in_an_hour_is_bundled(con):
    c = user()
    now = T0
    for i in range(6):
        ew.log_push(con, "u1", {"id": f"x{i}"}, {"id": f"x{i}", "kind": "fusion", "sev": "high"}, now - dt.timedelta(minutes=50 - i))
    due = [{"id": "a", "kind": "fusion", "sev": "high", "title": "Fusion A"}, {"id": "b", "kind": "surge", "sev": "high", "title": "Surge B"},
           {"id": "c", "kind": "live", "sev": "critical", "title": "Critical C"}]
    plan = ew.deliver_plan(con, "u1", due, ew.alert_rules(c), now)
    assert [p[2]["id"] for p in plan] == ["c", "more:a"] and plan[1][0] == "2 more notifications"
    for t, b, d, card in plan:
        ew.log_push(con, "u1", d, card, now)
    assert [p[2]["id"] for p in ew.deliver_plan(con, "u1", due[:2], ew.alert_rules(c), now + dt.timedelta(minutes=5))] == []


def test_the_digest_lists_unpushed_events_once_at_seven(con):
    c = user(tz="Europe/Paris")
    eid = ev.assign(con, atom(1, act="explosion", text="explosion", pos=(49.5, 2.35)), T0)   # Alert: never pushed
    brief(con, eid, T0, c)
    views = {v["id"]: v for v in ev.recent(con, T0 + dt.timedelta(hours=2))}
    seven = dt.datetime(2026, 10, 25, 6, 5, tzinfo=dt.timezone.utc)                       # 07:05 Paris (CET)
    sent = []
    send = lambda uid, t, b, d: sent.append((t, b, d))  # noqa: E731
    v = dict(views[eid])
    v["last_update"] = (seven - dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert ew.send_digest(con, "u1", c, seven, send, views={eid: v}) == 1
    assert sent[0][0] == "Digest · 1 event in your areas" and sent[0][2]["event_ids"] == [eid]
    assert ew.send_digest(con, "u1", c, seven + dt.timedelta(minutes=3), send, views={eid: v}) == 0
    assert ew.send_digest(con, "u1", c, seven + dt.timedelta(hours=12), send, views={eid: v}) == 0  # listed once
    assert ew.digest_slot(ew.alert_rules(c), dt.datetime(2026, 10, 25, 9, 0, tzinfo=dt.timezone.utc)) is None


def test_bad_alert_settings_are_dropped():
    out = ew.validate_alerts({"thresholds": {"assets": "loud", "theaters": "flash", "theater:t1": "alert", "x": "flash"},
                              "mutes": [{"event_id": "ev_1", "until": "2026-10-25T00:00:00Z"}, {"lat": 99, "lon": 0, "until": "2026-10-25T00:00:00Z"},
                                        {"event_id": "ev_2"}],
                              "quiet_hours": {"start": "25:00", "end": "07:00"}, "hourly_cap": 500, "digest": 0, "tz": "Nowhere/City"})
    assert out == {"thresholds": {"theaters": "flash", "theater:t1": "alert"}, "mutes": [{"event_id": "ev_1", "until": "2026-10-25T00:00:00Z"}],
                   "hourly_cap": 60, "digest": False}
