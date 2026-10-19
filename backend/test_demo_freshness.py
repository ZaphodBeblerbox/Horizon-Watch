"""demo_freshness.py: a demonstration leaves every list 24 h after its last activity (owner, 2026-10-19)."""
import datetime as dt

import demo_freshness as dfr

NOW = dt.datetime(2026, 10, 19, 20, 0, tzinfo=dt.timezone.utc)


def _t(hours_ago: float) -> str:
    return (NOW - dt.timedelta(hours=hours_ago)).isoformat()


def test_what_counts_as_a_demonstration():
    assert dfr.is_demo({"category": "unrest"})
    assert dfr.is_demo({"event_type": "unrest"})
    assert dfr.is_demo({"street_report": True})
    assert dfr.is_demo({"on_ground": True})
    assert dfr.is_demo({"signal_kind": "intent"})
    assert dfr.is_demo({"kind": "protest"})
    assert not dfr.is_demo({"category": "conflict", "event_type": "strike"})
    assert not dfr.is_demo({"kind": "geoconfirmed"})


def test_last_activity_is_the_newest_time():
    p = {"kind": "protest", "starts_utc": _t(30), "status": {"since": _t(30), "last_report_at": _t(5)}}
    assert dfr.last_activity(p) == NOW - dt.timedelta(hours=5)
    assert dfr.last_activity({"posted_at": _t(26), "first_at": _t(40)}) == NOW - dt.timedelta(hours=26)


def test_a_day_old_demonstration_leaves_but_anything_else_stays():
    old_unrest = {"id": "a", "category": "unrest", "posted_at": _t(25)}
    fresh_unrest = {"id": "b", "category": "unrest", "posted_at": _t(23)}
    old_war = {"id": "c", "category": "conflict", "posted_at": _t(60)}
    no_time = {"id": "d", "category": "unrest"}
    assert [x["id"] for x in dfr.keep([old_unrest, fresh_unrest, old_war, no_time], NOW)] == ["b", "c", "d"]


def test_an_old_announcement_for_a_march_still_to_come_stays():
    ann = {"kind": "announcement", "created_at": _t(40), "starts_at": (NOW + dt.timedelta(hours=10)).isoformat()}
    assert not dfr.stale(ann, NOW)
    over = {**ann, "starts_at": _t(26)}
    assert dfr.stale(over, NOW)


def test_a_protest_reported_this_morning_stays_one_from_yesterday_goes():
    today = {"kind": "protest", "starts_utc": _t(30), "status": {"key": "ended", "until": _t(20), "last_report_at": _t(20)}}
    yesterday = {"kind": "protest", "starts_utc": _t(40), "status": {"key": "ended", "until": _t(30), "last_report_at": _t(31)}}
    assert not dfr.stale(today, NOW) and dfr.stale(yesterday, NOW)


def test_a_call_carrying_its_protests_status_follows_the_protest():
    sig = {"signal_kind": "intent", "posted_at": _t(30), "intent": {"starts_utc": _t(28)},
           "protest_status": {"last_report_at": _t(2)}}
    assert not dfr.stale(sig, NOW)
