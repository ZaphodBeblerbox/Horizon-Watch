"""Announced events (one per place, timed in the place's zone) and live
developments, as read from Telegram, and who is told about them."""
import datetime as dt

import event_watch as ew
import telegram_events as te

POSTED = "2026-10-09T20:00:00+00:00"          # a Friday evening, UTC


# ── telegram_events ─────────────────────────────────────────────────────────

def test_advice_must_name_the_place():
    place = "Place de la Bastille, Paris, France"
    assert te.specific("Avoid Place de la Bastille from 14:30 to 18:00", place)
    assert te.specific("Stay away from the area and stay safe", place) is None
    assert te.specific("", place) is None


def test_start_is_timed_in_the_places_zone():
    ev = te.clean_announcement({"what": "student march", "starts_at": "2026-10-10T15:00", "timezone": "Europe/Paris",
                                "place": "Place de la Bastille, Paris, France", "precision": "site",
                                "country_code": "fr"}, POSTED)
    assert ev["tz"] == "Europe/Paris"
    assert ev["starts_utc"] == "2026-10-10T13:00:00Z"            # CEST is UTC+2


def test_country_with_one_zone_fills_a_missing_timezone():
    ev = te.clean_announcement({"what": "rally", "starts_at": "2026-10-10T15:00", "place": "Bellecour, Lyon, France",
                                "precision": "site", "country_code": "fr"}, POSTED)
    assert ev["tz"] == "Europe/Paris"


def test_unknown_zone_is_not_guessed():
    ev = te.clean_announcement({"what": "rally", "starts_at": "2026-10-10T15:00", "place": "Times Square, New York, USA",
                                "precision": "site", "country_code": "us"}, POSTED)
    assert ev["starts_utc"] is None                               # many zones, none named: no timed reminder


def test_reports_and_past_starts_are_not_announcements():
    base = {"place": "Place de la République, Paris, France", "precision": "site", "country_code": "fr",
            "timezone": "Europe/Paris"}
    assert te.clean_announcement({**base, "what": "rally", "starts_at": "2026-10-09T18:00"}, POSTED) is None   # before the post
    assert te.clean_announcement({**base, "what": "press conference", "starts_at": "2026-10-10T11:00"}, POSTED) is None
    assert te.clean_announcement({**base, "what": "rally", "starts_at": "soon"}, POSTED) is None


def test_every_city_in_a_list_is_its_own_event():
    cities = [("Place de la République, Paris, France", "14:00"), ("Place Bellecour, Lyon, France", "14:00"),
              ("Place Royale, Nantes, France", "11:00")]
    kept = [te.clean_announcement({"what": "gilets jaunes rally", "starts_at": f"2026-10-11T{h}", "timezone": "Europe/Paris",
                                   "place": p, "precision": "site", "country_code": "fr"}, POSTED) for p, h in cities]
    assert all(kept) and len({k["place"] for k in kept}) == 3


def test_a_live_development_needs_a_precise_place_and_a_specific_sentence():
    ok = te.clean_situation({"kind": "kettle", "happening": "Police are kettling protesters on Boulevard Saint-Germain",
                             "place": "Boulevard Saint-Germain, Paris, France", "precision": "street", "country_code": "fr",
                             "advice": "Leave Boulevard Saint-Germain by Rue du Bac, northbound"}, POSTED)
    assert ok and ok["valid_until"] == "2026-10-09T23:00:00Z" and ok["advice"]
    assert te.clean_situation({"kind": "kettle", "happening": "Police kettle protesters", "place": "Paris, France",
                               "precision": "region", "country_code": "fr"}, POSTED) is None
    assert te.clean_situation({"kind": "rumour", "happening": "x at Dhubab", "place": "Dhubab, Yemen",
                               "precision": "town", "country_code": "ye"}, POSTED) is None


def test_a_withdrawal_stays_live_longer_than_a_kettle():
    w = te.clean_situation({"kind": "withdrawal", "happening": "PLC forces withdrew from Dhubab",
                            "place": "Dhubab, Taiz, Yemen", "precision": "town", "country_code": "ye"}, POSTED)
    assert w["valid_until"] == "2026-10-10T08:00:00Z"


# ── event_watch ─────────────────────────────────────────────────────────────

BASTILLE = {"lat": 48.8532, "lon": 2.3692, "country_code": "fr"}
CONCERN = {"assets": [{"lat": 48.855, "lon": 2.375, "radius": 5, "name": "Roquette office", "label": "office"}],
           "theaters": [{"lat": 33.0, "lon": 44.0, "reach": 600, "name": "Iraq"}], "countries": {"france"}}


def test_the_nearest_reason_wins():
    reason, strength = ew.why(BASTILLE, CONCERN)
    assert strength == "asset" and "Roquette office" in reason
    assert ew.why({"lat": 43.3, "lon": 5.37, "country_code": "fr"}, CONCERN)[1] == "country"
    assert ew.why({"lat": 33.3, "lon": 44.4, "country_code": "iq"}, CONCERN)[1] == "theater"
    assert ew.why({"lat": 52.5, "lon": 13.4, "country_code": "de"}, CONCERN) is None


def test_regions_come_from_the_frontends_table():
    assert "Mali" in ew.regions_table()["Sahel"]


def _ann(idx, place, lat, lon, start_local, start_utc, posted="2026-10-09T19:00:00Z"):
    return {"id": f"tga-gj-1-{idx}", "post_id": "gj/1", "what": "rally", "organiser": "Gilets jaunes",
            "place": place, "lat": lat, "lon": lon, "country_code": "fr", "starts_at": start_local,
            "starts_utc": start_utc, "tz": "Europe/Paris", "when_label": "Sat 10 Oct, 15:00",
            "expect": f"Crowd at {place.split(',')[0]}", "advice": f"Avoid {place.split(',')[0]}",
            "posted_at": posted, "channel": "gj", "channel_title": "Gilets jaunes", "url": None}


def test_one_card_per_post_then_a_reminder_per_place(monkeypatch):
    anns = [_ann(0, "Place de la Bastille, Paris, France", 48.8532, 2.3692, "2026-10-10T15:00", "2026-10-10T13:00:00Z"),
            _ann(1, "Place Bellecour, Lyon, France", 45.7578, 4.832, "2026-10-10T15:00", "2026-10-10T13:00:00Z"),
            _ann(2, "Alexanderplatz, Berlin, Germany", 52.52, 13.41, "2026-10-10T15:00", "2026-10-10T13:00:00Z")]
    anns[2]["country_code"] = "de"
    monkeypatch.setattr(ew, "concern_of", lambda uid: CONCERN)
    monkeypatch.setattr(ew, "_events", lambda: (anns, []))

    night = dt.datetime(2026, 10, 9, 21, 0, tzinfo=dt.timezone.utc)
    cards = ew.cards_for("u1", night)
    assert [c["id"] for c in cards] == ["ann:gj/1"]               # Berlin does not concern this user
    assert "2 places" in cards[0]["reason"] and cards[0]["sev"] == "high"
    assert cards[0]["title"].startswith("Gilets jaunes: Rally called in 2 places")

    before = dt.datetime(2026, 10, 10, 11, 45, tzinfo=dt.timezone.utc)   # 13:45 Paris
    soon = [c for c in ew.cards_for("u1", before) if c["id"].startswith("soon:")]
    assert len(soon) == 2 and soon[0]["title"].startswith("Today 15:00: rally at Place de la Bastille")
    assert "starts in 75 min" in soon[0]["title"] and soon[0]["advice"] == "Avoid Place de la Bastille"

    after = dt.datetime(2026, 10, 10, 13, 5, tzinfo=dt.timezone.utc)
    assert not [c for c in ew.cards_for("u1", after) if c["id"].startswith("soon:")]


def test_a_date_only_event_is_recalled_that_morning():
    ev = {"starts_at": "2026-10-11", "starts_utc": None, "tz": "Europe/Paris"}
    a, b = ew.remind_window(ev, None)
    assert a.astimezone(dt.timezone.utc).hour == 5 and b.astimezone(dt.timezone.utc).hour == 18   # 07:00 and 20:00 CEST


def test_nobody_with_nothing_watched_is_told(monkeypatch):
    monkeypatch.setattr(ew, "concern_of", lambda uid: {"assets": [], "theaters": [], "countries": set()})
    monkeypatch.setattr(ew, "_events", lambda: ([_ann(0, "Place de la Bastille, Paris, France", 48.85, 2.37,
                                                      "2026-10-10T15:00", "2026-10-10T13:00:00Z")], []))
    assert ew.cards_for("u1", dt.datetime(2026, 10, 9, 21, tzinfo=dt.timezone.utc)) == []


def test_push_goes_once(monkeypatch, tmp_path):
    import sqlite3
    db = tmp_path / "p.db"
    monkeypatch.setattr(ew, "_push_con", lambda: sqlite3.connect(db))
    sqlite3.connect(db).execute("CREATE TABLE event_pushes (user_id TEXT, item_id TEXT, sent_at TEXT, PRIMARY KEY (user_id, item_id))")
    now = dt.datetime.now(dt.timezone.utc)
    card = {"id": "now:x", "title": "Police are kettling protesters on Boulevard Saint-Germain", "kind": "live",
            "advice": "Leave by Rue du Bac", "reason": "in your theater Paris", "created_at": ew._iso(now)}
    monkeypatch.setattr(ew, "cards_for", lambda uid, now=None: [card])
    monkeypatch.setattr(ew, "concern_of", lambda uid: CONCERN)

    class Q:
        def __init__(self, *a): pass
        def distinct(self): return self
        def all(self): return [("u1",)]

    class DB:
        def query(self, *a): return Q()
        def __enter__(self): return self
        def __exit__(self, *a): return False

    import database
    monkeypatch.setattr(database, "get_db", lambda: DB())
    sent = []
    send = lambda uid, title, body, data: sent.append((uid, title, body))  # noqa: E731
    assert ew.sweep(send) == 1 and ew.sweep(send) == 0
    # a closed app shows the app's name and the headline only (owner, 2026-10-10)
    assert sent[0][1] == "Parallax"
    assert sent[0][2] == "Police are kettling protesters on Boulevard Saint-Germain"


def test_push_follows_the_same_rule_as_the_screen():
    # src/state/notificationStore.js interrupts(): what pops up is what is pushed.
    assert ew.interrupts({"sev": "critical", "kind": "signal"})
    assert ew.interrupts({"sev": "moderate", "kind": "live"})
    assert ew.interrupts({"sev": "high", "kind": "announcement"})
    assert not ew.interrupts({"sev": "moderate", "kind": "announcement"})
    assert not ew.interrupts({"sev": "high", "kind": "asset"})
    import re
    src = open("../src/state/notificationStore.js").read()
    body = src[src.index("export function interrupts"):src.index("export function setMuted")]
    for kind in ew.INTERRUPT_KINDS:
        assert f'n.kind === "{kind}"' in body, kind


def test_the_shared_feed_buzzes_only_where_this_user_looks():
    yemen = {"id": "frontline-yemen-1", "kind": "escalate", "sev": "high", "lat": 13.3, "lon": 43.2, "title": "Mokha changed hands"}
    assert not ew.worth_pushing(yemen, CONCERN)
    assert ew.worth_pushing({**yemen, "sev": "critical"}, CONCERN)
    assert ew.worth_pushing({**yemen, "lat": 48.86, "lon": 2.37, "country_code": "fr"}, CONCERN)
    assert ew.worth_pushing({"id": "now:x", "kind": "live", "sev": "high"}, CONCERN)


def test_a_burst_is_two_pushes_and_a_summary():
    cards = [{"id": f"c{i}", "title": f"Place {i} changed hands", "sev": "high", "created_at": f"2026-10-10T00:0{i}:00Z"} for i in range(6)]
    out = ew.bundle(cards)
    assert len(out) == 3 and out[2][0] == "Parallax" and out[2][1].startswith("4 more: Place 2 changed hands")
