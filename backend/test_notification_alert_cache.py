"""The notification feed's alert scan is shared between users.

Production 2026-10-18: "[notifications] SLOW 38.4s {'scan': 37.52, 'rows':
2400}" in pairs, once per open device. The scan reads and judges 2,000-2,400
alert rows, does not depend on who is asking, and every desktop, phone Home
and phone More polls it every 20-30 s (and event_watch.sweep once per user
per minute). One build now serves everybody for a short TTL; past it the old
answer is served at once while one thread rebuilds.
"""
import threading
import time

import main


def _builder(calls, delay=0.0, marker="a"):
    def build(limit, hours, include_silent, timings):
        calls.append((limit, hours, include_silent))
        if delay:
            time.sleep(delay)
        timings["scan"] = delay
        return [{"id": f"{marker}-{len(calls)}", "title": "t"}]
    return build


def _clear():
    main._NOTIF_ALERTS_CACHE.clear()
    main._NOTIF_ALERTS_REFRESHING.clear()


def test_many_users_inside_the_ttl_cost_one_scan():
    _clear()
    calls = []
    b = _builder(calls)
    for _ in range(20):
        main._notification_alert_cards(60, 48, False, _build=b)
    assert len(calls) == 1


def test_different_windows_are_different_answers():
    _clear()
    calls = []
    b = _builder(calls)
    main._notification_alert_cards(60, 48, False, _build=b)
    main._notification_alert_cards(60, 6, False, _build=b)
    main._notification_alert_cards(40, 48, False, _build=b)
    assert len(calls) == 3


def test_callers_get_their_own_copies():
    """asset_watch rewrites a card it takes over; that must not leak into
    the next user's feed."""
    _clear()
    b = _builder([])
    first = main._notification_alert_cards(60, 48, False, _build=b)
    first[0]["title"] = "near YOUR asset"
    again = main._notification_alert_cards(60, 48, False, _build=b)
    assert again[0]["title"] == "t"


def test_a_stale_answer_is_served_at_once_and_rebuilt_once_in_the_background(monkeypatch):
    _clear()
    calls = []
    main._notification_alert_cards(60, 48, False, _build=_builder(calls))
    # age the entry past the TTL but inside the stale window
    at, rows = main._NOTIF_ALERTS_CACHE[(60, 48, False)]
    main._NOTIF_ALERTS_CACHE[(60, 48, False)] = (at - main._NOTIF_ALERTS_TTL_S - 1, rows)
    slow = _builder(calls, delay=0.3, marker="b")
    t0 = time.monotonic()
    got = [main._notification_alert_cards(60, 48, False, _build=slow) for _ in range(10)]
    assert time.monotonic() - t0 < 0.2, "a stale hit must not wait for the rebuild"
    assert all(g[0]["id"] == "a-1" for g in got)
    for _ in range(100):
        if not main._NOTIF_ALERTS_REFRESHING:
            break
        time.sleep(0.02)
    assert len(calls) == 2, "exactly one background rebuild"
    assert main._notification_alert_cards(60, 48, False, _build=slow)[0]["id"].startswith("b-")


def test_a_cold_start_builds_once_however_many_callers_arrive():
    _clear()
    calls = []
    b = _builder(calls, delay=0.2)
    out = []
    threads = [threading.Thread(target=lambda: out.append(
        main._notification_alert_cards(60, 48, False, _build=b))) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(out) == 8
    assert len(calls) == 1
