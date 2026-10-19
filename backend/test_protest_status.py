"""Announced protests, where they stand now (protest_status.py) and the
media and crowd estimate that go with them (protest_media.py): status
transitions from the clock and from evidence, crowd figures in five
languages, the rule reader for announcements beyond France, media linking
by radius and time, and the vision estimate's cache with a stubbed model.
No network, no model, no database but a temporary one."""
import datetime as dt
from zoneinfo import ZoneInfo

import pytest

import protest_media as pm
import protest_status as ps

NOW = dt.datetime(2026, 10, 18, 13, 0, tzinfo=dt.timezone.utc)      # 15:00 in Paris
PARIS = ZoneInfo("Europe/Paris")
REP = (48.8674, 2.3636)


def _t(minutes):
    """NOW + minutes, ISO."""
    return (NOW + dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def protest(start_min, kind="gather", **kw):
    return {"id": "p1", "kind": kind, "what": "rally", "place": "Place de la République, Paris", "cc": "fr",
            "lat": REP[0], "lon": REP[1], "starts_utc": _t(start_min), "start_approx": False, "sources": [], **kw}


def ev(minutes, d_lat=0.0, dispersal=False, text="du monde place de la République"):
    return {"at": _t(minutes), "lat": REP[0] + d_lat, "lon": REP[1], "kind": "street_report", "dispersal": dispersal,
            "text": text}


# ── the lifecycle ───────────────────────────────────────────────────────────

def test_planned_from_the_clock():
    s = ps.status_of(protest(180), [], NOW, PARIS)
    assert s["key"] == "planned"
    assert s["label"] == "Planned · starts in 3 h"


def test_planned_far_ahead_names_the_day_and_hour():
    s = ps.status_of(protest(60 * 24 * 2), [], NOW, PARIS)
    assert s["key"] == "planned" and s["label"] == "Planned · Tue 20 Oct 15:00"


def test_starting_now_around_the_start():
    s = ps.status_of(protest(5), [], NOW, PARIS)
    assert s["key"] == "starting" and s["label"] == "Starting now · 15:05"


def test_ongoing_from_the_clock_says_no_reports_yet():
    s = ps.status_of(protest(-60), [], NOW, PARIS)
    assert s["key"] == "ongoing" and s["basis"] == "clock"
    assert s["label"] == "Ongoing · since 14:00 (no reports from there yet)"


def test_ongoing_with_fresh_reports():
    s = ps.status_of(protest(-60), [ev(-3)], NOW, PARIS)
    assert s["key"] == "ongoing" and s["basis"] == "evidence"
    assert s["label"] == "Ongoing · since 14:00 (reports 3 min ago)"


def test_evidence_extends_past_the_planned_end():
    # announced yesterday for 18:00 local (16:00 UTC), a rally (2 h 30): over by the clock, but reports keep coming
    p = protest(-60 * 21)
    s = ps.status_of(p, [ev(-60 * 20), ev(-10)], NOW, PARIS)
    assert s["key"] == "ongoing" and s["label"].startswith("Ongoing · since 18:00")


def test_far_evidence_does_not_count():
    s = ps.status_of(protest(-300), [ev(-3, d_lat=0.02)], NOW, PARIS)     # ~2.2 km away
    assert s["key"] == "no_show"


def test_people_already_there_before_the_start():
    s = ps.status_of(protest(40), [ev(-2)], NOW, PARIS)
    assert s["key"] == "starting" and s["label"].startswith("Starting · people already there")


def test_dispersal_shortens_then_ends():
    p = protest(-60)
    s = ps.status_of(p, [ev(-50), ev(-20, dispersal=True)], NOW, PARIS)
    assert s["key"] == "dispersing"
    s = ps.status_of(p, [ev(-55), ev(-50, dispersal=True)], NOW, PARIS)
    assert s["key"] == "ended" and s["label"] == "Ended · 14:00–14:10"


def test_ended_after_the_window_with_old_reports():
    p = protest(-60 * 6, kind="march")                                     # 09:00, 3 h
    s = ps.status_of(p, [ev(-60 * 5), ev(-60 * 3 - 30)], NOW, PARIS)
    assert s["key"] == "ended" and s["label"].startswith("Ended · 09:00–")


def test_dispersing_just_after_the_window():
    p = protest(-200)
    s = ps.status_of(p, [ev(-180), ev(-50)], NOW, PARIS)
    assert s["key"] == "dispersing" and s["label"] == "Dispersing · reports 50 min ago"


def test_no_sign_it_happened():
    s = ps.status_of(protest(-60 * 5), [], NOW, PARIS)
    assert s["key"] == "no_show" and s["label"] == "No sign it happened · planned 10:00"


def test_date_only_is_never_ongoing_by_the_clock():
    p = protest(0, start_approx=True)
    s = ps.status_of(p, [], NOW, PARIS)
    assert s["key"] == "planned" and "no time given" in s["label"]
    s = ps.status_of(p, [ev(-5)], NOW, PARIS)
    assert s["key"] == "ongoing"


def test_default_durations_by_kind():
    assert ps.kind_of("protest march") == "march"
    assert ps.kind_of("student strike") == "strike"
    assert ps.kind_of("concentración") == "gather"
    assert ps.kind_of("sciopero generale") == "strike"
    assert ps.kind_of("bllokim rruge") == "block"
    start, end, _ = ps.window(protest(0, kind="march"))
    assert (end - start).total_seconds() / 60 == ps.DEFAULT_DURATION_MIN["march"]


# ── crowd figures ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,low,high,who", [
    ("On est 2000 à Répu !", 2000, 2000, "people"),
    ("Des milliers de manifestants place de la République", 2000, 9000, "reports"),
    ("2 300 manifestants selon la préfecture de police", 2300, 2300, "police"),
    ("Según los organizadores, 50.000 personas en Plaza de Mayo", 50000, 50000, "organisers"),
    ("Decenas de miles marchan hacia el Congreso", 10000, 50000, "reports"),
    ("Migliaia in piazza del Popolo", 2000, 9000, "reports"),
    ("Secondo la questura 3mila persone al corteo", 3000, 3000, "police"),
    ("Mijëra qytetarë protestojnë para Kryeministrisë", 2000, 9000, "reports"),
    ("Rreth 5000 protestues sipas policisë", 5000, 5000, "police"),
    ("About 10,000 protesters according to organisers", 10000, 10000, "organisers"),
    ("Tens of thousands of people marched", 10000, 50000, "reports"),
])
def test_crowd_figures(text, low, high, who):
    fs = ps.crowd_figures(text)
    assert fs, text
    f = fs[0]
    assert (f["low"], f["high"], f["who"]) == (low, high, who)


@pytest.mark.parametrize("text", [
    "Rendez-vous à 14h place de la République",
    "Le 18 octobre 2026, manif",
    "Billet à 20 euros",
    "En 2019 des manifestants avaient bloqué le périphérique",
    "Marcha a las 17 hs en Plaza de Mayo",
])
def test_not_crowd_figures(text):
    assert [f for f in ps.crowd_figures(text) if f["value"]] == []


def test_two_figures_in_one_sentence_attributed_apart():
    fs = ps.crowd_figures("10 000 manifestants selon les organisateurs, 2 300 selon la police")
    by = {f["who"]: f["value"] for f in fs}
    assert by.get("organisers") == 10000
    assert any(f["who"] == "police" for f in fs) or len(fs) == 1


def test_crowd_estimate_shows_sources_apart_and_a_range():
    figs = [{"low": 10000, "high": 10000, "value": 10000, "who": "organisers", "post": "a/1"},
            {"low": 2300, "high": 2300, "value": 2300, "who": "police", "post": "b/2"}]
    c = ps.crowd_estimate(figs, {"photos": 3, "low": 1500, "high": 3000})
    assert c["by_source_label"] == "organisers 10,000 · police 2,300"
    assert c["label"] == "est. 1,500–10,000 · from 3 photos + 2 reports"
    assert ps.crowd_estimate([], None) is None


def test_one_figure_is_never_bare():
    c = ps.crowd_estimate([{"low": 2000, "high": 2000, "value": 2000, "who": "people", "post": "a/1"}], None)
    assert c["label"] == "est. 1,500–2,500 · from 1 report"


# ── announcements beyond France, by rule ────────────────────────────────────

def _zone(cc):
    return ps.zone_of(cc)


@pytest.mark.parametrize("text,posted,place,start_utc", [
    ("Mañana concentración en Plaza de Mayo a las 17 hs", "2026-10-17T20:00:00Z", "Plaza de Mayo", "2026-10-18T20:00:00Z"),
    ("Domani manifestazione in piazza del Popolo alle 15:30", "2026-10-17T18:00:00Z", "Piazza del Popolo", "2026-10-18T13:30:00Z"),
    ("Protestë nesër në orën 18:00 para Kryeministrisë", "2026-10-17T09:00:00Z", "Kryeministria (Prime Minister's Office)",
     "2026-10-18T16:00:00Z"),
    ("Sciopero e corteo a Milano: appuntamento in piazza Duomo domani alle 10", "2026-10-17T09:00:00Z", "Piazza del Duomo",
     "2026-10-18T08:00:00Z"),
    ("Manif demain 14h place de la République !", "2026-10-17T09:00:00Z", "Place de la République", "2026-10-18T12:00:00Z"),
])
def test_read_announcement(text, posted, place, start_utc):
    a = ps.read_announcement(text, posted, _zone)
    assert a and a["place"]["name"] == place and a["starts_utc"] == start_utc and not a["start_approx"]


def test_a_report_is_not_an_announcement():
    assert ps.read_announcement("Miles de personas en Plaza de Mayo ahora", "2026-10-18T20:00:00Z", _zone) is None
    assert ps.read_announcement("Corteo partito alle 10 da piazza del Popolo", "2026-10-18T12:00:00Z", _zone) is None


def test_build_end_to_end_tirana():
    posted = "2026-10-17T09:00:00Z"
    a = ps.read_announcement("Protestë nesër në orën 14:00 para Kryeministrisë", posted, _zone)
    cand = {"id": "pr-x", "what": a["what"], "kind": a["kind"], "place": "Kryeministria, Tirana", "city": "Tirana", "cc": "al",
            "lat": a["place"]["lat"], "lon": a["place"]["lon"], "starts_utc": a["starts_utc"], "start_approx": False,
            "sources": [{"channel": "ch", "msg_id": 1, "posted_at": posted, "how": "rule", "text": "", "url": None}], "rank": 2}
    now = dt.datetime(2026, 10, 18, 13, 0, tzinfo=dt.timezone.utc)                     # 15:00 in Tirana
    posts = [{"channel": "ch2", "msg_id": 5, "posted_at": "2026-10-18T12:55:00Z",
              "text": "Mijëra qytetarë para Kryeministrisë tani", "role": "group"}]
    evidence = ps.evidence_from_posts(posts, set())
    out = ps.build([cand], evidence, now, ps.zone_of)
    assert len(out) == 1
    p = out[0]
    assert p["status"]["key"] == "ongoing"
    assert p["status_label"] == "Ongoing · since 14:00 (reports 5 min ago)"
    assert p["crowd"]["label"] == "est. 2,000–9,000 · from 1 report"


def test_merge_two_readings_of_one_gathering():
    a = {"id": "a", "lat": REP[0], "lon": REP[1], "starts_utc": _t(60), "sources": [{"channel": "x", "msg_id": 1}], "rank": 0}
    b = {"id": "b", "lat": REP[0] + 0.001, "lon": REP[1], "starts_utc": _t(90), "sources": [{"channel": "y", "msg_id": 2}], "rank": 2}
    c = {"id": "c", "lat": REP[0], "lon": REP[1], "starts_utc": _t(60 * 24), "sources": [{"channel": "z", "msg_id": 3}], "rank": 1}
    out = ps.merge_protests([b, c, a])
    assert [p["id"] for p in out] == ["a", "c"]
    assert len(out[0]["sources"]) == 2


# ── media linking ───────────────────────────────────────────────────────────

def _post(msg, minutes, text="", media="photo", lat=None, lon=None, chan="grp"):
    return {"channel": chan, "msg_id": msg, "channel_title": "Groupe", "posted_at": _t(minutes), "text": text, "media": media,
            "thumb": f"{chan}_{msg}.jpg" if media != "none" else None, "lat": lat, "lon": lon,
            "precision": "site" if lat is not None else None}


def test_media_linked_by_radius_and_time():
    p = protest(-60)
    st = ps.status_of(p, [], NOW, PARIS)
    posts = [
        _post(1, -30, "photo", lat=REP[0] + 0.002, lon=REP[1]),            # ~220 m: in
        _post(2, -30, "photo", lat=REP[0] + 0.02, lon=REP[1]),             # ~2.2 km: out
        _post(3, -60 * 5, "photo", lat=REP[0], lon=REP[1]),                # long before the start: out
        _post(4, -10, "Énorme foule place de la République", media="video"),  # names the place: in
        _post(10, -5, "ça gaze à Répu, place de la République", media="none", chan="g2"),
        _post(11, -4, "", media="video", chan="g2"),                       # captionless footage right after: in
        _post(15, -2, "", media="photo", chan="g2"),                       # too many messages later: out
    ]
    pool = pm.media_pool(posts, NOW)
    got = pm.link_media(p, st, pool, NOW)
    assert [m["id"] for m in got] == ["g2/11", "grp/4", "grp/1"]
    assert got[0]["how"] == "footage sent after a report"
    assert got[0]["video_url"] == "/api/telegram/video/g2/11"
    assert got[2]["thumb_url"] == "/api/telegram/media/grp_1.jpg"


def test_private_chat_video_url():
    assert pm._video_url("c/12345", 7) == "/api/telegram/video/-10012345/7"


# ── the vision estimate ─────────────────────────────────────────────────────

@pytest.fixture()
def vision_db(tmp_path, monkeypatch):
    import telegram_ingest as tg
    monkeypatch.setattr(tg, "_db_path", lambda: str(tmp_path / "t.db"))
    pm.reset_for_tests()
    calls = []

    def stub(img, m):
        calls.append(m["id"])
        if m["id"].endswith("/9"):
            raise RuntimeError("model down")
        return {"crowd_scene": not m["id"].endswith("/8"), "visible_low": 400, "visible_high": 900 if m["id"].endswith("/1") else 600,
                "density": "dense", "note": "packed square"}

    monkeypatch.setattr(pm, "_model_call", stub)
    yield calls
    pm.reset_for_tests()
    monkeypatch.setattr(pm, "_model_call", None)


def _media(n):
    return {"id": f"grp/{n}", "type": "photo", "thumb_url": f"/api/telegram/media/grp_{n}.jpg", "thumb": f"grp_{n}.jpg",
            "at": _t(-n), "distance_m": 50, "chat": "Groupe", "text": ""}


def test_vision_is_cached_per_media_and_never_waits(vision_db):
    p = {"id": "p1", "status": {"key": "ongoing"}}
    media = [_media(1), _media(2)]
    first = pm.vision_for(p, media, start_thread=False)
    assert first == {"photos": 0, "low": None, "high": None, "pending": 2}       # queued, not waited for
    while not pm._q.empty():
        pm.run_one(pm._q.get_nowait(), img=b"jpeg")
    assert sorted(vision_db) == ["grp/1", "grp/2"]
    v = pm.vision_for(p, media, start_thread=False)
    assert v["photos"] == 2 and v["low"] == 400 and v["high"] == 900
    pm.vision_for(p, media, start_thread=False)
    assert len(vision_db) == 2                                                  # the cache answers; no new call
    # and the cache survives a restart (it is in SQLite)
    pm._cache.clear()
    pm._loaded[0] = False
    assert pm.vision_for(p, media, start_thread=False)["photos"] == 2


def test_vision_bounded_per_protest(vision_db):
    p = {"id": "p2", "status": {"key": "ongoing"}}
    v = pm.vision_for(p, [_media(i) for i in range(1, 7)], start_thread=False)
    assert v["pending"] == pm.PER_PROTEST_IMAGES


def test_vision_failure_and_non_crowd_degrade(vision_db):
    p = {"id": "p3", "status": {"key": "ongoing"}}
    media = [_media(8), _media(9)]
    pm.vision_for(p, media, start_thread=False)
    while not pm._q.empty():
        pm.run_one(pm._q.get_nowait(), img=b"jpeg")
    assert pm.cached("grp/9")["error"].startswith("RuntimeError")
    assert pm.vision_for(p, media, start_thread=False) is None                  # a meme and a failure: no photo basis
    c = ps.crowd_estimate([{"low": 2000, "high": 9000, "value": None, "who": "reports", "post": "a/1"}], None)
    assert c["label"] == "est. 2,000–9,000 · from 1 report"


def test_no_vision_for_a_planned_protest(vision_db):
    p = {"id": "p4", "status": {"key": "planned"}}
    assert pm.vision_for(p, [_media(1)], start_thread=False) is None
    assert pm._q.empty()


# ── calls to gather expire with their protest (owner, 2026-10-19) ───────────

def _sig(kind="intent", when_kind="time", start_min=None, posted_min=-30, chan="grp", msg=1, lat=REP[0], lon=REP[1]):
    return {"id": f"s{msg}", "kind": kind, "lat": lat, "lon": lon, "country_code": "fr", "last_at": _t(posted_min),
            "intent": None if kind == "at" else {"act": "gather", "when_kind": when_kind, "posted_at": _t(posted_min),
                                                 "starts_utc": _t(start_min) if start_min is not None else None},
            "sources": [{"channel": chan, "msg_id": msg}]}


def _prot(key, chan="grp", msg=1, lat=REP[0], lon=REP[1]):
    return {"id": "p", "lat": lat, "lon": lon, "status": {"key": key}, "status_label": key,
            "sources": [{"channel": chan, "msg_id": msg}], "tz": "Europe/Paris"}


def test_call_end_by_clock():
    assert ps.call_end(None, None, _t(0)) == NOW + dt.timedelta(hours=12)                    # no time said
    assert ps.call_end(_t(60), "time", _t(0), "march") == NOW + dt.timedelta(minutes=60 + 180 + 60)
    end = ps.call_end(_t(60 * 24), "date", _t(0), None, PARIS)                               # a day: its end, there
    assert end.astimezone(PARIS).strftime("%Y-%m-%d %H:%M") == "2026-10-19 23:59"


def test_call_lives_with_its_protest():
    sigs = [_sig(start_min=-60 * 5, msg=1), _sig(start_min=-60 * 5, msg=2, chan="other")]
    # msg 1 is behind a protest still ongoing (past its default length: reports keep it) → kept, with its status;
    # msg 2 is at the same place as that ongoing protest → part of it
    out = ps.live_signals(sigs, NOW, [_prot("ongoing", msg=1)])
    assert [s["id"] for s in out] == ["s1", "s2"]
    assert out[0]["protest_status"]["key"] == "ongoing"
    # once it has ended, or never happened: gone (msg 2's own clock ran out too)
    assert ps.live_signals(sigs, NOW, [_prot("ended", msg=1)]) == []
    assert ps.live_signals(sigs, NOW, [_prot("no_show", msg=1)]) == []


def test_calls_without_a_protest_expire_by_their_clock():
    far = (REP[0] + 0.05, REP[1])
    fresh = _sig(when_kind=None, posted_min=-60 * 3, msg=3, lat=far[0], lon=far[1])                 # no time, 3 h old
    stale = _sig(when_kind=None, posted_min=-60 * 13, msg=4, lat=far[0], lon=far[1])                # no time, 13 h old
    timed_over = _sig(start_min=-60 * 5, msg=5, lat=far[0], lon=far[1])                             # 10:00 rally, over
    tomorrow = _sig(when_kind="date", start_min=60 * 24, posted_min=-60 * 30, msg=6, lat=far[0], lon=far[1])
    old_pos = _sig(kind="at", posted_min=-60 * 7, msg=7)
    new_pos = _sig(kind="at", posted_min=-20, msg=8)
    out = ps.live_signals([fresh, stale, timed_over, tomorrow, old_pos, new_pos], NOW, [])
    assert [s["id"] for s in out] == ["s3", "s6", "s8"]


def test_demo_situation_calls_follow_the_lifecycle():
    import demo_situation as ds
    call = {"post": "grp/1", "place": {"lat": REP[0], "lon": REP[1]}, "start_at": _t(-60 * 5), "when": _t(-60 * 5),
            "at": _t(-60 * 20), "act": "gather"}
    assert ds.call_live(call, NOW, [_prot("ongoing")]) is True
    assert ds.call_live(call, NOW, [_prot("ended")]) is False
    assert ds.call_live(call, NOW, []) is False                                    # 10:00 + 2 h 30 + 1 h: over
    assert ds.call_live({**call, "start_at": _t(30), "when": _t(30)}, NOW, []) is True


def test_while_ongoing_the_card_has_the_crowd_track_and_says_where_police_tracks_are():
    BAS = (48.8532, 2.3692)
    p = protest(-60, kind="march")
    ev_ = [{**ev(-40, text="le cortège part de République et se dirige vers Bastille"), "title": "départ"},
           {"at": _t(-10), "lat": BAS[0], "lon": BAS[1], "kind": "post", "text": "on est à Bastille, le cortège arrive", "title": "Bastille"}]
    near = ps.near_evidence({**p, "radius_m": 2500}, ev_, NOW)
    hub = ps.hub_tracks({**p, "radius_m": 2500}, {"key": "ongoing"}, near, NOW, PARIS)
    assert len(hub["crowd"]) == 1 and len(hub["crowd"][0]["points"]) == 2
    assert hub["crowd"][0]["hhmm"] == "14:50"
    assert hub["police"] == [] and hub["police_note"]                    # police_tracks.py not deployed here
    assert ps.hub_tracks(p, {"key": "ended"}, near, NOW, PARIS)["crowd"] == []


def test_finished_protests_leave_the_hazards():
    import demonstrations as dm
    hz = [{"id": "tga-grp-1-0"}, {"id": "tga-grp-2-0"}, {"id": "tgs-x"}]
    prots = [{**_prot("ended", msg=1), "starts_utc": _t(-300)}, {**_prot("ongoing", msg=2), "starts_utc": _t(-60)}]
    out = dm.status_hazards(hz, prots)
    assert [h["id"] for h in out] == ["tga-grp-2-0", "tgs-x"]
    assert out[0]["protest_status"]["key"] == "ongoing"
