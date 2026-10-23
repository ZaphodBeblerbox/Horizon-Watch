"""protests.py — the Protests layer's three frames (owner, 2026-10-23)."""
import datetime as dt

import pytest

import protests as pr
import user_concern as uc

NOW = dt.datetime(2026, 10, 24, 13, 0, tzinfo=dt.timezone.utc)        # Saturday 15:00 in Paris
REP = (48.8674, 2.3636)
BASTILLE = (48.8532, 2.3692)
NATION = (48.8483, 2.3958)


def t(minutes_ago):
    return (NOW - dt.timedelta(minutes=minutes_ago)).isoformat()


def sig(act, minutes_ago, lat=REP[0], lon=REP[1], live=True, cc="fr", sid=None, place="Place de la République", text="x"):
    return {"id": sid or f"ls-{act}-{minutes_ago}-{lat}", "act": act, "title": f"{act} at {place}", "lines": [],
            "place": place, "country_code": cc, "lat": lat, "lon": lon, "event_time": t(minutes_ago),
            "first_event_time": t(minutes_ago), "live": live, "muted": False, "media": None, "all_media": [],
            "corroboration": {"level": "eyewitness", "n_sources": 1, "line": "Eyewitness, unverified"},
            "sources": [{"channel_title": "GJ 2026 IDF", "posted_at": t(minutes_ago), "url": "https://t.me/GJ2026IDF/1"}],
            "messages": [{"text": text, "event_time": t(minutes_ago), "posted_at": t(minutes_ago), "channel_title": "GJ 2026 IDF",
                          "url": "https://t.me/GJ2026IDF/1"}], "direction": None}


def protest(key, start_min_ago, place="Place de la République, Paris, France", lat=REP[0], lon=REP[1], last_report_min=None,
            basis="evidence", approx=False, pid="p1", since=None, until=None, title="Rally at Place de la République"):
    st = {"key": key, "basis": basis, "since": since or t(start_min_ago), "until": until,
          "last_report_at": t(last_report_min) if last_report_min is not None else None}
    return {"id": pid, "title": title, "place": place, "city": "Paris", "country_code": "fr", "lat": lat, "lon": lon,
            "starts_utc": t(start_min_ago), "start_approx": approx, "starts_label": "Tomorrow 14:00", "status": st,
            "status_label": f"{key}", "announced_at": t(start_min_ago + 600), "sources": [{"channel": "giletsjaunes2026",
            "msg_id": 9, "channel_title": "Gilets jaunes", "posted_at": t(2000), "url": "https://t.me/giletsjaunes2026/9"}],
            "n_sources": 1, "evidence": [], "media": [], "crowd": {"label": "organisers 10,000"}, "crowd_tracks": []}


def build(**kw):
    args = {"signals_day": [], "street_day": [], "protests": [], "announcements": [], "now": NOW}
    args.update(kw)
    return pr.build(**args)


# ── live now ────────────────────────────────────────────────────────────────

def test_live_has_the_protest_acts_and_never_the_military_or_a_war_theatre():
    out = build(signals_day=[sig("crowd_movement", 5), sig("police_intervention", 8, lat=BASTILLE[0], lon=BASTILLE[1]),
                             sig("troops_sighted", 3, lat=NATION[0], lon=NATION[1]),
                             sig("police_intervention", 4, lat=49.7, lon=37.6, cc="ua", place="Kupyansk")])
    kinds = sorted(i["kind"] for i in out["live"] if not i["kind"].endswith("_track"))
    assert kinds == ["crowd", "police"]
    assert all(i["country_code"] == "fr" for i in out["live"])


def test_an_announced_protest_is_live_only_with_a_fresh_report():
    out = build(protests=[protest("ongoing", 60, last_report_min=10, pid="a"),
                          protest("ongoing", 60, last_report_min=None, basis="clock", pid="b", lat=BASTILLE[0], lon=BASTILLE[1])])
    ids = [i["id"] for i in out["live"]]
    assert "pr-a-live" in ids and "pr-b-live" not in ids


def test_crowd_and_police_tracks_are_their_own_items_with_heading_and_last_seen():
    crowd = [sig("crowd_movement", 50, *BASTILLE, sid="c1"), sig("crowd_movement", 25, lat=48.8505, lon=2.3820, sid="c2"),
             sig("crowd_movement", 4, *NATION, sid="c3")]
    police = [{"id": "tgr-police_arrival-a-1", "tactic": "police_arrival", "title": "Police moving in at Place de la Nation",
               "place": "Place de la Nation", "city": "Paris", "country_code": "fr", "lat": NATION[0] + 0.001, "lon": NATION[1],
               "first_at": t(30), "at": t(30), "current": True, "sources": [], "n_channels": 1},
              {"id": "tgr-kettle-a-2", "tactic": "kettle", "title": "Kettle at Place de la Nation", "place": "Place de la Nation",
               "city": "Paris", "country_code": "fr", "lat": NATION[0] - 0.004, "lon": NATION[1] + 0.002, "first_at": t(6), "at": t(6),
               "current": True, "sources": [], "n_channels": 2}]
    out = build(signals_day=crowd, street_day=police)
    ct = [i for i in out["live"] if i["kind"] == "crowd_track"]
    assert len(ct) == 1 and len(ct[0]["track"]["points"]) == 3 and ct[0]["track"]["bearing"] is not None
    assert ct[0]["when"].startswith("last seen ") and "min ago" in ct[0]["when"]
    assert any(i["kind"] == "police_track" for i in out["live"])
    assert any(i["kind"] == "police" for i in out["live"]) and any(i["kind"] == "crowd" for i in out["live"])


def test_two_readings_of_one_incident_are_one_item():
    a = sig("police_intervention", 6, sid="a")
    b = sig("police_intervention", 3, lat=REP[0] + 0.0005, sid="b", text="les CRS chargent encore")
    out = build(signals_day=[a, b])
    pol = [i for i in out["live"] if i["kind"] == "police"]
    assert len(pol) == 1 and len(pol[0]["messages"]) == 2


# ── today ───────────────────────────────────────────────────────────────────

def test_today_is_since_local_midnight_of_the_place():
    late_night = dt.datetime(2026, 10, 24, 0, 30, tzinfo=dt.timezone.utc)      # 02:30 in Paris
    yesterday_paris = sig("arrest", 0, live=False)
    yesterday_paris["event_time"] = yesterday_paris["first_event_time"] = "2026-10-23T21:30:00+00:00"   # 23:30 Paris, 3 h before
    today_paris = sig("arrest", 0, live=False, sid="x2", lat=BASTILLE[0], lon=BASTILLE[1])
    today_paris["event_time"] = today_paris["first_event_time"] = "2026-10-23T22:30:00+00:00"          # 00:30 Paris
    out = pr.build(signals_day=[yesterday_paris, today_paris], street_day=[], protests=[], announcements=[], now=late_night)
    assert [i["id"] for i in out["today"]] == ["pr-x2"]


def test_a_protest_that_took_place_today_says_what_and_when_with_arrests_folded_in():
    p = protest("ended", 300, until=t(90), pid="r")
    arrest = sig("arrest", 120, lat=REP[0] + 0.002, live=False, text="12 interpellations place de la République")
    out = build(protests=[p, protest("no_show", 400, basis="clock", pid="ns", lat=BASTILLE[0], lon=BASTILLE[1])],
                signals_day=[arrest])
    today = out["today"]
    assert [i["id"] for i in today] == ["pr-r-today"]
    line = today[0]["line"]
    assert "Rally at Place de la République" in line and "–" in line and "12 arrests" in line and "organisers 10,000" in line


def test_today_is_not_a_recap_of_an_earlier_day():
    old = protest("ended", 60 * 30, until=t(60 * 28), pid="old")
    assert build(protests=[old])["today"] == []


# ── upcoming ────────────────────────────────────────────────────────────────

def test_upcoming_needs_a_future_date_and_a_named_place():
    tomorrow = protest("planned", -60 * 23, place="Place de la Bastille, Paris, France", lat=BASTILLE[0], lon=BASTILLE[1], pid="u1",
                       basis="clock", title="Rally at Place de la Bastille")
    bare = protest("planned", -60 * 20, place="Place, France", pid="u2", basis="clock")
    country = protest("planned", -60 * 20, place="France", pid="u3", basis="clock")
    far = protest("planned", -60 * 24 * 10, pid="u4", basis="clock")
    out = build(protests=[tomorrow, bare, country, far])
    assert [i["id"] for i in out["upcoming"]] == ["pr-u1-upcoming"]
    assert out["upcoming"][0]["when"] == "Tomorrow 14:00"


def test_an_announcement_with_a_date_only_says_time_not_given_and_who_called_it():
    a = {"id": "tga-x-1-0", "what": "gilets jaunes rally", "place": "Place de la Nation, Paris, France", "country_code": "fr",
         "lat": NATION[0], "lon": NATION[1], "starts_at": "2026-10-25", "starts_utc": None, "organiser": "Gilets jaunes IDF",
         "cause": "fuel prices", "channel": "x", "msg_id": 1, "channel_title": "Gilets jaunes", "posted_at": t(300),
         "url": "https://t.me/x/1", "also_reported_by": []}
    past = {**a, "id": "tga-x-2-0", "msg_id": 2, "starts_at": "2026-10-20"}
    out = build(announcements=[a, past])
    assert len(out["upcoming"]) == 1
    u = out["upcoming"][0]
    assert "time not given" in u["when"] and "called by Gilets jaunes IDF" in u["line"] and "fuel prices" in u["line"]


def test_card_text_has_no_emoji_links_or_handles():
    assert pr.clean_message("🔥 Ça gaze à Répu !! https://t.me/x/1 @GJ2026IDF #manif") == "Ça gaze à Répu!!"


# ── per user ────────────────────────────────────────────────────────────────

def test_a_paris_user_sees_paris_not_rome_and_is_told_what_else_there_is(monkeypatch):
    rome = sig("crowd_movement", 5, lat=41.9, lon=12.48, cc="it", sid="rome", place="Piazza del Popolo")
    snap = build(signals_day=[rome], protests=[protest("ended", 300, until=t(90), pid="r"),
                                                protest("planned", -60 * 23, place="Place de la Bastille, Paris, France",
                                                        lat=BASTILLE[0], lon=BASTILLE[1], pid="u1", basis="clock")])
    snap["generated_at"] = NOW.isoformat()
    monkeypatch.setattr(pr, "snapshot", lambda: snap)
    paris = uc.Scope({"assets": [], "theaters": [{"lat": 48.86, "lon": 2.354, "reach": 350.0, "name": "Paris Watch"}],
                      "countries": set(), "topics": set()})
    import profile_filter as pf
    monkeypatch.setattr(pf, "scope", lambda user: paris)
    out = pr.for_user({"id": "u"}, "live")
    assert out["items"] == [] and out["counts"] == {"live": 0, "today": 1, "upcoming": 1}
    assert out["note"] == "Nothing live in your areas right now. 1 protest today, 1 upcoming."
    assert out["profile"]["hidden"] >= 1
    # nothing is changed in the shared build
    assert any(i["id"] == "pr-rome" for i in snap["live"])


def test_built_once_for_everybody(monkeypatch):
    calls = []
    monkeypatch.setattr(pr, "compute", lambda now=None: calls.append(1) or {"live": [], "today": [], "upcoming": []})
    pr._CACHE.clear()
    for _ in range(5):
        pr.for_user(None, "today")
    assert len(calls) == 1
    pr._CACHE.clear()
