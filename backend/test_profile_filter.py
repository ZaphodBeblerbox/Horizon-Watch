"""A user sees what concerns them (user_concern.py, profile_filter.py;
owner, 2026-10-22: "Jakob in Berlin" never sees protests in Paris).

Fixture profiles are put straight into the concern cache: no DB, no network."""
import threading
import time

import pytest
from fastapi.testclient import TestClient

import main
import profile_filter as pf
import user_concern as uc

BERLIN = (52.52, 13.405)
PARIS = (48.8566, 2.3522)
LONDON = (51.5074, -0.1278)


def _profile(uid, assets=(), theaters=(), countries=(), topics=(), only_mine=None):
    c = {"assets": list(assets), "theaters": list(theaters), "countries": {x.lower() for x in countries},
         "topics": set(topics), "only_mine": only_mine}
    uc._concern_cache[uid] = (time.time() + 10_000, c)
    return {"id": uid, "settings": {"interests": {} if only_mine is None else {"onlyMine": only_mine}}}


def _theater(name, ll, reach=350.0):
    return {"lat": ll[0], "lon": ll[1], "reach": reach, "name": name}


def _asset(name, ll, radius=25.0):
    return {"lat": ll[0], "lon": ll[1], "radius": radius, "name": name, "label": "office"}


@pytest.fixture(autouse=True)
def _clean():
    uc._concern_cache.clear()
    yield
    uc._concern_cache.clear()


def sig(ll, sev="high", **kw):
    return {"id": f"s{ll[0]:.1f}", "lat": ll[0], "lon": ll[1], "severity": sev, "headline": "Protest", **kw}


# ── the rule ────────────────────────────────────────────────────────────────

def test_berlin_theater_hides_a_paris_protest_and_shows_berlin():
    u = _profile("jakob", theaters=[_theater("Berlin", BERLIN)])
    assert uc.concerns(u, *PARIS)[0] is False
    ok, why = uc.concerns(u, *BERLIN)
    assert ok and "Berlin" in why


def test_paris_theater_sees_paris_only():
    u = _profile("lea", theaters=[_theater("Paris", PARIS)])
    assert uc.concerns(u, *PARIS)[0] and not uc.concerns(u, *BERLIN)[0]


def test_an_asset_counts_within_its_radius():
    u = _profile("a", assets=[_asset("Office", PARIS, 10)])
    assert uc.concerns(u, 48.86, 2.36)[0]
    assert not uc.concerns(u, *LONDON)[0]


def test_a_country_of_interest_shows_it_wherever_in_the_country():
    u = _profile("c", countries=["France"])
    assert uc.concerns(u, 43.30, 5.37, "fr")[0]            # Marseille, no theater near
    assert not uc.concerns(u, *BERLIN, "de")[0]


def test_a_new_account_sees_everything_with_a_hint():
    u = _profile("new")
    assert uc.concerns(u, *PARIS) == (True, "no profile yet")
    sc = uc.scope_for(u)
    assert sc.active is False and sc.block()["hint"]


def test_the_switch_off_shows_everything():
    u = _profile("off", theaters=[_theater("Berlin", BERLIN)], only_mine=False)
    assert uc.concerns(u, *PARIS)[0]
    assert uc.scope_for(u).block()["filtered"] is False


def test_the_switch_in_the_session_beats_the_cache():
    _profile("sw", theaters=[_theater("Berlin", BERLIN)])
    u = {"id": "sw", "settings": {"interests": {"onlyMine": False}}}
    assert uc.concerns(u, *PARIS)[0]


def test_unlocated_items_are_not_let_through_for_lacking_a_place():
    u = _profile("u", theaters=[_theater("Berlin", BERLIN)], countries=["Germany"], topics=["cyber"])
    sc = uc.scope_for(u)
    assert not sc.concerns({"headline": "Calls to gather", "severity": "high"})[0]
    assert sc.concerns({"headline": "x", "country_code": "de"})[0]                      # a watched country
    assert sc.concerns({"title": "front moved", "region": "Germany"})[0]               # a card that names it in words
    assert not sc.concerns({"title": "front moved", "region": "Ukraine", "kind": "escalate"})[0]
    assert not sc.concerns({"headline": "x", "country_code": "fr"})[0]
    assert sc.concerns({"headline": "Ransomware outage hits banks", "severity": "critical"})[0]   # critical + topic
    assert not sc.concerns({"headline": "Ransomware outage hits banks", "severity": "moderate"})[0]
    assert sc.concerns({"headline": "Global thing", "severity": "critical", "scope": "global"})[0]
    assert not sc.concerns({"headline": "Global thing", "severity": "high", "scope": "global"})[0]


def test_event_watch_still_answers_the_same():
    import event_watch as ew
    c = uc.concern_of("none-such") if False else {"assets": [], "theaters": [_theater("Paris", PARIS)], "countries": set()}
    assert ew.why({"lat": PARIS[0], "lon": PARIS[1]}, c)[1] == "theater"      # old dicts without topics still work
    assert ew.concern_of is uc.concern_of and ew.why is uc.why


# ── the lists ───────────────────────────────────────────────────────────────

def test_lists_are_copied_not_mutated_and_counted():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    shared = {"posts": [sig(BERLIN), sig(PARIS), sig(PARIS)], "generated": 1}
    out = pf.lists(shared, u, "posts")
    assert len(out["posts"]) == 1 and len(shared["posts"]) == 3
    assert out["profile"]["hidden"] == 2 and out["profile"]["filtered"]


def test_paged_reads_on_until_a_page_is_filled():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    pages = {None: {"posts": [sig(PARIS)] * 5, "next": "p2"}, "p2": {"posts": [sig(PARIS)] * 5, "next": "p3"},
             "p3": {"posts": [sig(BERLIN)] * 2, "next": None}}
    out = pf.paged(u, lambda b, n: pages[b], None, 5, "posts")
    assert len(out["posts"]) == 2 and out["next"] is None and out["profile"]["hidden"] == 10


def test_filled_applies_the_limit_after_the_filter():
    """/api/alerts and /api/signals cut `limit` in SQL before the filter: a Berlin-only
    profile got 2 of the newest 100. filled() reads wider pages until `limit` are kept."""
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    rows = ([sig(PARIS)] * 98 + [sig(BERLIN)] * 2) * 10           # 1000 rows, 20 in Berlin
    calls = []

    def fetch(off, n):
        calls.append((off, n))
        return rows[off:off + n]
    out = pf.filled(u, fetch, 15, wide=200)
    assert len(out) == 15 and all(r["lat"] == BERLIN[0] for r in out)
    assert calls[0] == (0, 200) and len(calls) <= 5
    # no profile: one read of exactly `limit`, as before
    calls.clear()
    assert len(pf.filled(_profile("new"), fetch, 15)) == 15 and calls == [(0, 15)]
    # a reader that drops rows itself says how many it read, so the end is not misjudged
    calls.clear()
    got = pf.filled(u, lambda off, n: (fetch(off, n)[1:], len(rows[off:off + n])), 15, wide=200)
    assert len(got) == 15 and calls[1][0] == 200
    # bounded: a profile nothing matches stops after max_pages
    calls.clear()
    assert pf.filled(_profile("t", theaters=[_theater("Tokyo", (35.68, 139.69))]), fetch, 15, wide=100, max_pages=3) == []
    assert len(calls) == 3


def test_notifications_keep_personal_cards_and_filter_the_rest():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    cards = [{"id": "a", "kind": "signal", "sev": "high", "lat": PARIS[0], "lon": PARIS[1], "title": "Paris"},
             {"id": "b", "kind": "signal", "sev": "high", "lat": BERLIN[0], "lon": BERLIN[1], "title": "Berlin"},
             {"id": "c", "kind": "message", "sev": "high", "title": "Hi"},
             {"id": "ann:1", "kind": "announcement", "sev": "high", "title": "Mine"}]
    assert [x["id"] for x in pf.notifications(cards, u)] == ["b", "c", "ann:1"]


def test_demonstrations_snapshot_is_filtered_by_copy():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    snap = {"demonstrations": [sig(PARIS), sig(BERLIN)],
            "tracks": [{"id": "t", "last": {"lat": PARIS[0], "lon": PARIS[1]}}],
            "protests": [sig(PARIS)], "note": "n"}
    out = pf.demonstrations(snap, u)
    assert len(out["demonstrations"]) == 1 and out["tracks"] == [] and out["protests"] == []
    assert len(snap["tracks"]) == 1 and out["note"] == "n"


def test_city_situation_is_kept_by_its_centre():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    ans = {"cities": [{"city": "paris", "center": {"lat": PARIS[0], "lon": PARIS[1]}},
                      {"city": "berlin", "center": {"lat": BERLIN[0], "lon": BERLIN[1]}}]}
    assert [c["city"] for c in pf.situation(ans, u)["cities"]] == ["berlin"]


def test_street_reports_recount_located():
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    out = pf.street({"reports": [sig(PARIS), sig(BERLIN)], "located": 2}, u)
    assert out["located"] == 1 and len(out["reports"]) == 1


def test_a_failing_item_never_blanks_the_list(capsys):
    u = _profile("j", theaters=[_theater("Berlin", BERLIN)])
    sc = uc.scope_for(u)
    kept, _ = sc.filter([1, sig(BERLIN)], key=lambda x: x if isinstance(x, dict) else 1 / 0)
    assert len(kept) == 2 and "error: judging an item" in capsys.readouterr().out


def test_no_session_filters_nothing():
    assert pf.lists({"posts": [sig(PARIS)]}, None, "posts")["posts"]


# ── the endpoints ───────────────────────────────────────────────────────────

POSTS = [sig(BERLIN, id="berlin-1"), sig(PARIS, id="paris-1")]
JAKOB = {"id": "jakob", "email": "j@x", "name": "J", "role": "analyst", "settings": {}}
LEA = {"id": "lea", "email": "l@x", "name": "L", "role": "analyst", "settings": {}}


@pytest.fixture
def api(monkeypatch):
    import telegram_ingest as tg
    import telegram_events as te
    _profile("jakob", theaters=[_theater("Berlin", BERLIN)])
    _profile("lea", theaters=[_theater("Paris", PARIS)])
    who = {"u": JAKOB}
    monkeypatch.setattr(main, "_get_current_user", lambda request: who["u"])
    monkeypatch.setattr(main, "_require_current_user", lambda request: who["u"])
    monkeypatch.setattr(tg, "published", lambda hours=72, pins=False: [dict(p) for p in POSTS])
    monkeypatch.setattr(tg, "statements", lambda hours=72: [])
    monkeypatch.setattr(tg, "feed", lambda before=None, limit=40: {"posts": [dict(p) for p in POSTS], "next": None})
    monkeypatch.setattr(tg, "upcoming", lambda days=30: [dict(p) for p in POSTS])
    monkeypatch.setattr(tg, "live_incidents", lambda now=None: [dict(p) for p in POSTS])
    monkeypatch.setattr(te, "situations", lambda: [dict(p) for p in POSTS])
    return TestClient(main.app), who


@pytest.mark.parametrize("path,key", [
    ("/api/telegram/posts", "posts"), ("/api/telegram/feed", "posts"), ("/api/telegram/situations", "situations"),
    ("/api/telegram/incidents/live", "incidents"), ("/api/telegram/upcoming", "upcoming")])
def test_each_telegram_endpoint_shows_each_user_only_their_city(api, path, key):
    client, who = api
    who["u"] = JAKOB
    assert [p["id"] for p in client.get(path).json()[key]] == ["berlin-1"]
    who["u"] = LEA
    r = client.get(path).json()
    assert [p["id"] for p in r[key]] == ["paris-1"] and r["profile"]["hidden"] == 1


def test_switch_off_returns_everything_through_the_endpoint(api):
    client, who = api
    who["u"] = {**JAKOB, "settings": {"interests": {"onlyMine": False}}}
    r = client.get("/api/telegram/posts").json()
    assert len(r["posts"]) == 2 and r["profile"]["filtered"] is False


def test_demonstration_endpoints_filter(api, monkeypatch):
    import demonstrations as dm
    import demo_situation as ds
    import street_reports as srp
    client, who = api
    monkeypatch.setattr(dm, "snapshot", lambda now=None: {"demonstrations": [dict(p) for p in POSTS], "tracks": [], "protests": []})
    monkeypatch.setattr(srp, "snapshot", lambda hours=6: {"reports": [dict(p) for p in POSTS], "located": 2})

    async def situation(now=None, city=None):
        return {"cities": [{"city": "berlin", "center": {"lat": BERLIN[0], "lon": BERLIN[1]}},
                           {"city": "paris", "center": {"lat": PARIS[0], "lon": PARIS[1]}}]}
    monkeypatch.setattr(ds, "situation", situation)
    who["u"] = LEA
    assert [p["id"] for p in client.get("/api/routes/demonstrations").json()["demonstrations"]] == ["paris-1"]
    assert [p["id"] for p in client.get("/api/routes/demonstrations/street").json()["reports"]] == ["paris-1"]
    assert [c["city"] for c in client.get("/api/routes/demonstrations/situation").json()["cities"]] == ["paris"]


def test_surface_pool_endpoint_filters_after_the_shared_pool(api, monkeypatch):
    client, who = api
    pool = [{"id": "e1", "lat": BERLIN[0], "lon": BERLIN[1], "headline": "b", "source": "x"},
            {"id": "e2", "lat": PARIS[0], "lon": PARIS[1], "headline": "p", "source": "x"}]
    monkeypatch.setattr(main, "_SURFACE_POOL", pool)
    monkeypatch.setattr(main, "_SURFACE_POOL_UPDATED_AT", "now")
    import telegram_ingest as tg
    monkeypatch.setattr(tg, "logged_in", lambda: False)
    who["u"] = JAKOB
    r = client.get("/api/surface").json()
    assert [i["id"] for i in r["items"]] == ["e1"] and r["profile"]["hidden"] == 1
    assert len(pool) == 2                                       # the shared pool is untouched


def test_the_scope_endpoint_says_what_is_held_back(api, monkeypatch):
    client, who = api
    monkeypatch.setattr(main, "_SURFACE_POOL", [sig(PARIS), sig(BERLIN)])
    who["u"] = JAKOB
    r = client.get("/api/profile/scope").json()
    assert r["filtered"] and r["counts"] == {"telegram": 1, "signals": 1} and r["hidden"] == 2
    _profile("blank")
    who["u"] = {"id": "blank", "settings": {}}
    r = client.get("/api/profile/scope").json()
    assert r["filtered"] is False and r["hint"] and r["hidden"] == 0


# ── one build for everybody ────────────────────────────────────────────────

def test_shared_cache_is_built_once_for_six_concurrent_users():
    """The filter runs after the build: six users, one build, six answers."""
    from shared_cache import SharedCache
    cache = SharedCache("t", ttl=30, max_stale=60)
    builds = []

    def build():
        builds.append(1)
        time.sleep(0.15)
        return {"posts": [sig(BERLIN), sig(PARIS)]}

    users = [_profile(f"u{i}", theaters=[_theater("Berlin" if i % 2 else "Paris", BERLIN if i % 2 else PARIS)]) for i in range(6)]
    got = {}

    def one(u):
        got[u["id"]] = pf.lists(cache.get("k", build), u, "posts")["posts"]

    ts = [threading.Thread(target=one, args=(u,)) for u in users]
    [t.start() for t in ts]
    [t.join(5) for t in ts]
    assert len(builds) == 1
    assert all(len(v) == 1 for v in got.values())
    assert {got[f"u{i}"][0]["lat"] for i in range(6)} == {BERLIN[0], PARIS[0]}
    assert len(cache.peek("k")["posts"]) == 2                    # nobody mutated the shared answer
