"""The safest way out (safe_route.py), the "leave now" alert (exit_watch.py)
and the asset track over a range (track_view.py, GET …/track/range).

No network: the routers are replaced by fakes that return fixed lines."""
import asyncio
import datetime as dt
import os
import sqlite3

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import exit_watch as ew
import owned_assets as oa
import safe_route as sr
import track_view as tv

NOW = dt.datetime(2026, 10, 12, 15, 0, tzinfo=dt.timezone.utc)
REP = (48.8674, 2.3636)          # Place de la République
ORIGIN = (48.8650, 2.3600)       # ~380 m south-west of it


def _iso(minutes_ago: float) -> str:
    return (NOW - dt.timedelta(minutes=minutes_ago)).isoformat()


def kettle(minutes_ago=12, lat=REP[0], lon=REP[1], hid="tgs-k"):
    return sr.from_situation({"id": hid, "kind": "kettle", "lat": lat, "lon": lon, "place": "Place de la République",
                              "happening": "Police are kettling protesters at Place de la République",
                              "posted_at": _iso(minutes_ago), "valid_until": (NOW + dt.timedelta(hours=2)).isoformat(),
                              "channel": "paris_luttes", "channel_title": "Paris-luttes", "msg_id": 1,
                              "url": "https://t.me/paris_luttes/1"}, NOW)


# ── hazards ────────────────────────────────────────────────────────────────

def test_a_kettle_is_a_hazard_with_its_source_and_it_decays():
    h = kettle(0)
    assert h["kind"] == "kettle" and h["core_m"] < h["radius_m"]
    assert h["source"] == {"label": "Telegram · Paris-luttes", "url": "https://t.me/paris_luttes/1"}
    assert h["weight"] == pytest.approx(1.0)
    assert kettle(45)["weight"] == pytest.approx(0.5, abs=0.01)          # halves every 45 min
    assert kettle(90)["weight"] < kettle(45)["weight"]
    expired = sr.from_situation({"id": "x", "kind": "kettle", "lat": 1, "lon": 1, "posted_at": _iso(10),
                                 "valid_until": _iso(1)}, NOW)
    assert expired is None                                                  # past its validity: gone


def test_crowd_size_widens_the_ring():
    small = sr.from_situation({"id": "a", "kind": "clashes", "lat": 1, "lon": 1, "posted_at": _iso(5),
                               "happening": "clashes at the square"}, NOW)
    big = sr.from_situation({"id": "b", "kind": "clashes", "lat": 1, "lon": 1, "posted_at": _iso(5),
                             "happening": "clashes, 5 000 manifestants at the square"}, NOW)
    assert sr.crowd_size("5 000 manifestants") == 5000 and sr.crowd_size("des milliers de personnes") == 3000
    assert big["radius_m"] > small["radius_m"] and big["crowd"] == 5000


def test_announced_gathering_ramps_up_before_it_starts():
    def ann(mins_to_start):
        return sr.from_announcement({"id": "tga-1", "what": "marche des lycéens", "lat": 48.853, "lon": 2.369,
                                     "place": "Bastille", "starts_utc": (NOW + dt.timedelta(minutes=mins_to_start)).isoformat(),
                                     "posted_at": _iso(600), "channel": "c", "when_label": "today 15:00"}, NOW)
    assert ann(300) is None                                   # 5 h away: not a hazard yet
    assert ann(120)["weight"] < ann(10)["weight"] <= ann(-60)["weight"]
    assert ann(-60)["kind"] == "march"
    assert sr.announcement_decay(-6 * 60) < 0.5               # long over: fading


def test_hazards_near_reads_the_sources_and_keeps_the_area(tmp_path, monkeypatch):
    import telegram_events as te
    import endangered_places as ep
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE alerts (alert_id TEXT, title TEXT, lat REAL, lon REAL, severity TEXT, created_at TEXT, "
                "source TEXT, alert_type TEXT, region TEXT, status TEXT)")
    con.execute("INSERT INTO alerts VALUES ('a1','Riot police fire tear gas at protesters',48.866,2.362,'high',?, 'news','signal','Paris','open')",
                ((NOW - dt.timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S"),))
    con.execute("INSERT INTO alerts VALUES ('a2','Tanker loitering near cable',48.866,2.362,'high',?, 'ais','signal','Paris','open')",
                ((NOW - dt.timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S"),))
    con.commit(); con.close()
    sit = {"id": "tgs-k", "kind": "kettle", "lat": REP[0], "lon": REP[1], "place": "République", "happening": "kettle",
           "posted_at": _iso(12), "valid_until": (NOW + dt.timedelta(hours=1)).isoformat(), "channel": "c"}
    far = {**sit, "id": "tgs-far", "lat": 45.76, "lon": 4.83}           # Lyon
    monkeypatch.setattr(te, "situations", lambda: [sit, far])
    monkeypatch.setattr(te, "announcements", lambda days_ahead=1: [])
    monkeypatch.setattr(ep, "load_places", lambda: {"places": []})
    hz = sr.hazards_near(*ORIGIN, 5, NOW)
    ids = [h["id"] for h in hz]
    assert ids[0] == "tgs-k" and "alert:a1" in ids
    assert "tgs-far" not in ids and "alert:a2" not in ids               # Lyon is not near; a tanker is not unrest
    assert all(h["distance_m"] < 5000 for h in hz)


# ── scoring ───────────────────────────────────────────────────────────────

def _line(*pts, n=20):
    out = []
    for a, b in zip(pts, pts[1:]):
        for k in range(n):
            out.append([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    out.append(list(pts[-1]))
    return out


def _route(coords, minutes, name="Rue A", router="osrm"):
    return {"coords": coords, "distance_m": round(sr.length_m(coords)), "duration_s": minutes * 60,
            "steps": [{"text": "Head north.", "distance_m": 10, "street": None},
                      {"text": f"Turn onto {name}.", "distance_m": 300, "street": name}],
            "router": router, "mode": "foot", "dest": {"name": "x"}}


DEST = (48.8740, 2.3720)               # north-east, beyond the square
THROUGH = _line(ORIGIN, REP, DEST)     # straight across the kettle
AROUND = _line(ORIGIN, (48.8625, 2.3640), (48.8650, 2.3760), DEST)   # south-east first, then north: wide of the square


def test_exposure_prefers_the_route_that_keeps_away():
    h = kettle()
    a = sr.score(_route(THROUGH, 15), [h])
    b = sr.score(_route(AROUND, 19), [h])
    assert h["id"] in a["through_core"] and not b["through_core"]
    assert b["exposure"] < a["exposure"]
    safest, fastest = sr.pick([a, b])
    assert safest is b and fastest is a


def test_never_through_a_core_even_when_it_is_the_only_route():
    h = kettle()
    only = sr.score(_route(THROUGH, 15), [h])
    safest, fastest = sr.pick([only])
    assert safest is None and fastest is only


def test_a_core_you_start_in_only_counts_if_you_go_back_in():
    h = kettle()
    out = sr.score(_route(_line(REP, (48.8600, 2.3500)), 12), [h])        # straight out of it
    assert not out["through_core"]
    back = sr.score(_route(_line(REP, (48.8600, 2.3500), REP, (48.875, 2.38)), 30), [h])
    assert h["id"] in back["through_core"]


def test_plan_shows_safest_and_fastest_and_says_why():
    h = kettle()
    calls = []

    async def fake_valhalla(origin, dest, mode, exclude=None, alternates=1):
        calls.append(("valhalla", bool(exclude)))
        return [_route(AROUND, 19, "Rue de Malte", "valhalla")] if exclude else []

    async def fake_osrm(origin, dest, mode):
        calls.append(("osrm", False))
        return [_route(THROUGH, 15, "Boulevard Magenta")]

    async def no_pois(lat, lon):
        return []
    r = asyncio.run(sr.plan(*ORIGIN, "foot", hazards=[h], now=NOW, fetch_valhalla=fake_valhalla,
                            fetch_osrm=fake_osrm, fetch_pois=no_pois))
    assert r["status"] == "ok"
    assert r["safest"]["router"] == "valhalla" and r["fastest"]["router"] == "osrm"
    assert r["safest"]["through_core"] == [] and r["fastest"]["through_core"] == [h["id"]]
    assert r["leave_via"] == "Rue de Malte"
    assert "Place de la République" in r["explanation"] and "kettle reported 12 min ago" in r["explanation"]
    assert "4 min longer" in r["explanation"]
    assert ("valhalla", True) in calls                                     # the hazards were sent as exclusions
    assert r["links"]["google"].startswith("https://www.google.com/maps/dir/") and "maps.apple.com" in r["links"]["apple"]
    assert "OpenStreetMap" in r["attribution"]


def test_destinations_lie_away_from_the_trouble():
    h = kettle()
    ds = sr.candidate_destinations(*ORIGIN, [h], [], "foot")
    assert ds
    toward = sr.bearing(*ORIGIN, h["lat"], h["lon"])
    for d in ds:
        assert abs(((d["bearing"] - toward) + 180) % 360 - 180) > 60
        assert sr.clearance(d["lat"], d["lon"], [h]) >= 200


def test_refuge_on_the_far_side_is_skipped():
    h = kettle()
    beyond = {"name": "Hôpital beyond", "kind": "hospital", "lat": 48.8720, "lon": 2.3700}
    behind = {"name": "Commissariat", "kind": "police station", "lat": 48.8580, "lon": 2.3500}
    ds = sr.candidate_destinations(*ORIGIN, [h], [beyond, behind], "foot")
    names = [d["name"] for d in ds]
    assert "Commissariat" in names and "Hôpital beyond" not in names


def test_still_safe_flags_a_new_hazard_on_the_way():
    assert sr.still_safe(AROUND, [kettle()])["safe"]
    blocked = kettle(hid="tgs-new", lat=48.8650, lon=2.3760)
    r = sr.still_safe(AROUND, [kettle(), blocked])
    assert not r["safe"] and "tgs-new" in r["through_core"]


def test_polyline6_decodes():
    # Valhalla's own example shape (two points)
    pts = sr.decode_polyline("_izlhA~rlgdF_{geC~ywl@")
    assert pts[0] == pytest.approx([38.5, -120.2]) and pts[1] == pytest.approx([40.7, -120.95])


# ── leave now ─────────────────────────────────────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    monkeypatch.setattr(oa, "_last_prune", 0.0)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE users (id TEXT, name TEXT, email TEXT, role TEXT, is_super_admin INTEGER, team_id TEXT)")
    con.executemany("INSERT INTO users VALUES (?,?,?,?,?,?)", [
        ("anna", "Anna", "anna@x", "analyst", 0, None), ("boss", "Boss", "boss@x", "analyst", 0, None),
        ("root", "Root", "root@x", "admin", 0, None), ("eve", "Eve", "eve@x", "analyst", 0, None)])
    con.commit(); con.close()
    return path


def test_proximity_alert_once_per_hazard_per_user(db):
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": ORIGIN[0], "lon": ORIGIN[1], "identifiers": {"user_id": "anna"}})
    oa.record_position("anna", ORIGIN[0], ORIGIN[1], 8, "gps", now=NOW - dt.timedelta(minutes=1))
    k = kettle()
    far = kettle(hid="tgs-far", lat=48.80, lon=2.30)
    plans = []

    def hazards(lat, lon, km, now):
        out = []
        for h in (k, far):
            out.append({**h, "distance_m": round(sr.metres(lat, lon, h["lat"], h["lon"]))})
        return out

    async def plan(lat, lon, mode, hazards=None, now=None):
        plans.append(1)
        return {"leave_via": "Rue de Malte", "explanation": "Avoids Place de la République — kettle reported 12 min ago — by 650 m; 4 min longer."}
    assert asyncio.run(ew.check(NOW, plan, hazards)) == 1
    assert asyncio.run(ew.check(NOW + dt.timedelta(minutes=1), plan, hazards)) == 0     # told once
    assert len(plans) == 1

    mine = ew.notifications_for("anna", NOW)
    assert len(mine) == 1
    c = mine[0]
    assert c["title"] == "Unrest near you — leave via Rue de Malte (safest route ready)"
    assert "Kettle at Place de la République" in c["reason"] and "from you" in c["reason"] and "Paris-luttes" in c["reason"]
    assert c["kind"] == "exit" and c["sev"] == "critical" and c["asset_id"] == a["id"]
    assert ew.notifications_for("boss", NOW)[0]["title"].startswith("Unrest near Anna — leave via Rue de Malte")
    assert ew.notifications_for("root", NOW)                     # an admin sees it
    assert ew.notifications_for("eve", NOW) == []                # a stranger does not

    import event_watch as evw
    assert evw.notifies(c, {}) and "Leave now" in evw.label_for(c)


def test_no_alert_for_a_far_hazard_or_a_coarse_position(db):
    oa.record_position("anna", ORIGIN[0], ORIGIN[1], 5000, "ip", now=NOW - dt.timedelta(minutes=1))

    def hazards(lat, lon, km, now):
        return [{**kettle(), "distance_m": 300}]

    async def plan(*a, **k):
        return {}
    assert asyncio.run(ew.check(NOW, plan, hazards)) == 0        # a city-level fix never raises one
    assert not ew.relevant({**kettle(), "distance_m": 2500}, NOW)


def test_send_reaches_only_the_person(db):
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": ORIGIN[0], "lon": ORIGIN[1], "identifiers": {"user_id": "anna"}})
    ew.send("anna", ORIGIN[0], ORIGIN[1], {"hazards": [{**kettle(), "distance_m": 380}], "leave_via": "Rue de Malte"},
            {"id": "boss", "name": "Boss"}, a["id"], NOW)
    got = ew.notifications_for("anna", NOW)
    assert got and got[0]["title"] == "Boss sent you the safest way out — leave via Rue de Malte"
    assert ew.notifications_for("boss", NOW) == []


# ── the track ─────────────────────────────────────────────────────────────

def _walk(n=3000, stop_at=(1000, 1020)):
    pts, lat, lon = [], 48.85, 2.35
    for i in range(n):
        if not (stop_at[0] <= i < stop_at[1]):
            lat += 0.0004 * (1 if (i // 200) % 2 == 0 else -0.6)
            lon += 0.0005 * (1 if (i // 300) % 2 == 0 else -0.8)
        pts.append({"at": (NOW - dt.timedelta(minutes=n - i)).isoformat(), "lat": lat, "lon": lon, "accuracy_m": 8})
    return pts


def test_track_thinning_keeps_shape_stops_and_ends():
    pts = _walk()
    v = tv.view(pts, "7d", 200)
    assert v["raw_count"] == 3000 and v["kept"] <= 200
    assert v["start"]["at"] == pts[0]["at"] and v["end"]["at"] == pts[-1]["at"]
    assert len(v["stops"]) == 1
    s = v["stops"][0]
    assert s["minutes"] >= 10 and s["arrived"] == pts[999]["at"] or s["arrived"] == pts[1000]["at"]
    kept_at = {p["at"] for p in v["points"]}
    assert s["arrived"] in kept_at and s["departed"] in kept_at            # a stop is never smoothed away
    assert tv.view(pts[:50], "1h", 500)["kept"] == 50                       # short: untouched


@pytest.fixture
def client(db, monkeypatch):
    from routers import my_assets

    def me(request):
        uid = request.headers.get("x-test-user")
        if not uid:
            raise HTTPException(401, "authentication required")
        return {"id": uid, "name": uid.title(), "role": "admin" if uid == "root" else "analyst"}
    monkeypatch.setattr(my_assets, "_me", me)
    app = FastAPI()
    app.include_router(my_assets.router)
    return TestClient(app)


def test_track_endpoint_visibility_and_range(client):
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": 48.85, "lon": 2.35, "identifiers": {"user_id": "anna"}})
    now = dt.datetime.now(dt.timezone.utc)
    for i, p in enumerate(_walk(600, (100, 120))):
        oa.record_position("anna", p["lat"], p["lon"], 8, "gps", now=now - dt.timedelta(minutes=600 - i))
    h = lambda u: {"x-test-user": u}                                         # noqa: E731
    r = client.get(f"/api/my-assets/{a['id']}/track/range?range=24h&max_points=100", headers=h("boss"))
    assert r.status_code == 200
    d = r.json()
    assert d["kept"] <= 100 and d["raw_count"] >= 500 and d["stops"] and d["start"] and d["end"]
    assert client.get(f"/api/my-assets/{a['id']}/track/range?range=1h", headers=h("boss")).json()["raw_count"] <= 61
    assert client.get(f"/api/my-assets/{a['id']}/track/range", headers=h("eve")).status_code == 404   # not shared
    assert client.get(f"/api/my-assets/{a['id']}/track/range", headers=h("root")).status_code == 200  # admin
    assert client.get(f"/api/my-assets/{a['id']}/track/range?range=2y", headers=h("boss")).status_code == 400
    oa.update(a["id"], "boss", {"shared": True})
    assert client.get(f"/api/my-assets/{a['id']}/track/range", headers=h("eve")).status_code == 200
    # a person's own track: themself and admins; not someone outside their organisation
    # (position_stream.can_see_user — the live stream's rule)
    assert client.get("/api/my-assets/people/anna/track?range=6h", headers=h("anna")).json()["kept"] > 0
    assert client.get("/api/my-assets/people/anna/track?range=6h", headers=h("root")).status_code == 200
    assert client.get("/api/my-assets/people/anna/track?range=6h", headers=h("eve")).status_code == 404


def test_unnamed_walkway_steps_fold_into_one():
    steps = [{"text": "Walk south on Rue du Temple.", "distance_m": 120, "street": "Rue du Temple"},
             {"text": "Turn left onto the walkway.", "distance_m": 10, "street": None},
             {"text": "Turn right onto the walkway.", "distance_m": 15, "street": None},
             {"text": "Take the stairs.", "distance_m": 5, "street": None},
             {"text": "Turn right onto Rue de Rivoli.", "distance_m": 300, "street": "Rue de Rivoli"}]
    out = sr.fold_steps(steps)
    assert [s["text"] for s in out] == ["Walk south on Rue du Temple.", "Continue along the footpaths and crossings.",
                                        "Turn right onto Rue de Rivoli."]
    assert out[1]["distance_m"] == 30


# ── the generic core: providers, modes, saved plans, contexts ─────────────

def test_providers_are_registered_by_name():
    assert set(sr.PROVIDERS) >= {"unrest", "endangered_calls", "violence", "strikes", "roadblocks"}
    assert sr.call_hazard_kind("barrage_filtrant") == "roadblock" and sr.call_hazard_kind("operation_escargot") == "roadblock"
    assert sr.call_hazard_kind("piquet_de_greve") == "strike" and sr.call_hazard_kind("rassemblement") == "call"


def test_hazards_near_asks_only_the_providers_named(monkeypatch):
    called = []
    for name in list(sr.PROVIDERS):
        monkeypatch.setitem(sr.PROVIDERS, name, {**sr.PROVIDERS[name], "fn": (lambda n: lambda box, inside, now: called.append(n) or [])(name)})
    sr.hazards_near(*ORIGIN, 3, NOW, ["roadblocks", "strikes"])
    assert called == ["roadblocks", "strikes"]


def test_truck_never_crosses_a_called_roadblock_but_a_walker_may_pass_near():
    rb = sr.make_hazard(hid="ep:1", kind="roadblock", lat=REP[0], lon=REP[1], weight=0.5, at=None, place="Rond-point", what="Filtering roadblock",
                        source="17octobregiletjaune.net")
    truck = sr.for_mode([rb], sr.mode_of("truck"))[0]
    foot = sr.for_mode([rb], sr.mode_of("foot"))[0]
    assert truck["core_m"] == truck["radius_m"] and truck["weight"] > foot["weight"]
    # a line passing 200 m from it: inside the ring, outside the usual core
    near = _line((48.8656, 2.3560), (48.8656, 2.3720))
    assert sr.score(_route(near, 10), [truck])["through_core"] == ["ep:1"]
    assert sr.score(_route(near, 10), [foot])["through_core"] == []


def test_a_polygon_hazard_is_held_by_the_circle_that_covers_it():
    poly = [[48.866, 2.360], [48.868, 2.360], [48.868, 2.366], [48.866, 2.366]]
    h = sr.make_hazard(hid="p", kind="kettle", lat=0, lon=0, weight=1, at=None, place="cordon", what="cordon", source="x", polygon=poly)
    assert h["lat"] == pytest.approx(48.867) and h["radius_m"] > sr.metres(48.867, 2.363, 48.868, 2.366)
    assert h["polygon"] == poly


async def _fv(origin, dest, mode, exclude=None, alternates=1):
    return [_route(AROUND, 19, "Rue de Malte", "valhalla")] if exclude else []


async def _fo(origin, dest, mode):
    return [_route(THROUGH, 15, "Boulevard Magenta")]


async def _np(lat, lon):
    return []


def test_every_candidate_says_why():
    r = asyncio.run(sr.plan(*ORIGIN, "foot", hazards=[kettle()], now=NOW, fetch_valhalla=_fv, fetch_osrm=_fo, fetch_pois=_np))
    roles = {c["role"]: c for c in r["candidates"]}
    assert roles["safest"]["why"].startswith("Avoids Place de la République")
    assert "not advised" in roles["fastest"]["why"]
    assert r["candidates"][0]["role"] == "safest" and any(c["role"] == "fastest" for c in r["candidates"])


@pytest.fixture
def routes_client(db, monkeypatch):
    from routers import routes
    users = {"anna": {"id": "anna", "name": "Anna"}, "boss": {"id": "boss", "name": "Boss"},
             "root": {"id": "root", "name": "Root", "role": "admin"}, "eve": {"id": "eve", "name": "Eve"}}

    def me(request):
        uid = request.headers.get("x-test-user")
        if uid not in users:
            raise HTTPException(401, "authentication required")
        return users[uid]
    monkeypatch.setattr(routes, "_me", me)
    hz = {"list": [{**kettle(), "distance_m": 380}]}
    monkeypatch.setattr(sr, "hazards_near", lambda lat, lon, km=5, now=None, providers=None: [dict(h) for h in hz["list"]])
    monkeypatch.setattr(sr, "valhalla", _fv)
    monkeypatch.setattr(sr, "osrm", _fo)
    monkeypatch.setattr(sr, "refuge_pois", _np)
    sr._plan_cache.clear()
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app), hz


def test_plan_is_saved_rechecked_rerouted_and_sent(routes_client):
    c, hz = routes_client
    a = oa.create("boss", {"name": "Anna", "kind": "person", "lat": ORIGIN[0], "lon": ORIGIN[1], "identifiers": {"user_id": "anna"}})
    oa.record_position("anna", ORIGIN[0], ORIGIN[1], 8, "gps")
    h = lambda u: {"x-test-user": u}                                         # noqa: E731
    r = c.post("/api/routes/plan", json={"from": {"asset_id": a["id"]}, "mode": "foot", "purpose": "exit"}, headers=h("boss"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["id"].startswith("RP-") and d["safest"]["leave_via"] == "Rue de Malte" and d["subject"]["can_send"]
    pid = d["id"]
    # still safe: the saved plan comes back as it was
    g = c.get(f"/api/routes/{pid}", headers=h("boss")).json()
    assert g["check"]["safe"] and not g["rerouted"]
    assert c.get(f"/api/routes/{pid}", headers=h("eve")).status_code == 404            # a stranger
    assert c.get(f"/api/routes/{pid}", headers=h("anna")).status_code == 200           # the person it is for
    # a new danger appears on the safe way: re-planned
    hz["list"].append({**kettle(hid="tgs-new", lat=48.8650, lon=2.3760), "distance_m": 900})
    sr._plan_cache.clear()
    g = c.get(f"/api/routes/{pid}", headers=h("boss")).json()
    assert g["rerouted"] and "tgs-new" in g["check"]["through_core"] and g["changed_because"].startswith("New danger")
    assert rp_status(pid) in ("rerouted", "no_safe_route")
    # sent to the person: a card that opens this plan
    s = c.post(f"/api/routes/{pid}/send", json={"asset_id": a["id"]}, headers=h("boss"))
    assert s.status_code == 200 and s.json()["sent"]
    card = ew.notifications_for("anna")[0]
    assert card["route_plan_id"] == pid and card["title"].startswith("Boss sent you the safest way out")
    assert c.post(f"/api/routes/{pid}/send", json={}, headers=h("eve")).status_code == 404


def rp_status(pid):
    import route_plans as rp
    return rp.get(pid)["status"]


def test_plan_to_a_destination_and_the_access_approach(routes_client):
    c, _ = routes_client
    h = {"x-test-user": "boss"}
    r = c.post("/api/routes/plan", json={"from": {"lat": ORIGIN[0], "lon": ORIGIN[1]}, "to": {"lat": DEST[0], "lon": DEST[1], "name": "Depot"},
                                         "mode": "truck", "depart_at": "2026-10-17T07:00:00+02:00"}, headers=h)
    d = r.json()
    assert r.status_code == 200 and d["mode"] == "truck" and d["destinations"][0]["name"] == "Depot"
    assert dt.datetime.fromisoformat(d["depart_at"]) == dt.datetime(2026, 10, 17, 5, 0, tzinfo=dt.timezone.utc)
    site = oa.create("boss", {"name": "Depot", "kind": "warehouse", "lat": DEST[0], "lon": DEST[1]})
    r = c.post("/api/routes/plan", json={"to": {"asset_id": site["id"]}, "mode": "truck", "purpose": "access"}, headers=h)
    assert r.status_code == 200 and r.json()["subject"]["name"].startswith("approach from the"), r.text
    assert c.post("/api/routes/plan", json={"from": {"lat": 99, "lon": 0}}, headers=h).status_code == 400
    m = c.get("/api/routes/modes").json()
    assert {x["name"] for x in m["modes"]} >= {"foot", "car", "truck"} and len(m["providers"]) >= 5


def test_context_says_when_a_route_plan_is_relevant(routes_client):
    c, hz = routes_client
    h = {"x-test-user": "boss"}
    person = oa.create("boss", {"name": "Anna", "kind": "person", "lat": ORIGIN[0], "lon": ORIGIN[1]})
    d = c.get(f"/api/routes/context?asset_id={person['id']}", headers=h).json()
    assert d["relevant"] and d["contexts"][0]["kind"] == "exit" and "Kettle at Place de la République" in d["contexts"][0]["reason"]
    site = oa.create("boss", {"name": "Depot", "kind": "warehouse", "lat": ORIGIN[0], "lon": ORIGIN[1]})
    hz["list"] = [{**sr.make_hazard(hid="ep:9", kind="roadblock", lat=ORIGIN[0], lon=ORIGIN[1] + 0.005, weight=0.5, at=None,
                                    place="Rond-point de la Porte", what="Filtering roadblock", source="call map"), "distance_m": 370}]
    import endangered_places as ep
    from routers import routes
    routes_ep = ep.load_places
    try:
        ep.load_places = lambda: {"places": []}
        d = c.get(f"/api/routes/context?asset_id={site['id']}", headers=h).json()
    finally:
        ep.load_places = routes_ep
    assert d["contexts"][0]["kind"] == "access" and d["contexts"][0]["mode"] == "truck"
    hz["list"] = []
    assert c.get(f"/api/routes/context?asset_id={person['id']}", headers=h).json() == {**d, "relevant": False, "contexts": [],
                                                                                         "asset_id": person["id"]}


def test_nearest_reachable_picks_the_least_exposed_safe_house():
    near_house = {"name": "Safe house A (past the kettle)", "lat": 48.8690, "lon": 2.3660, "id": "SH-A"}
    far_house = {"name": "Safe house B", "lat": DEST[0], "lon": DEST[1], "id": "SH-B"}

    async def fv(origin, dest, mode, exclude=None, alternates=1):
        if dest["name"].startswith("Safe house A"):
            return [{**_route(_line(ORIGIN, REP, (48.8690, 2.3660)), 8), "dest": dest}]       # only through the square
        return [{**_route(AROUND, 19, "Rue de Malte", "valhalla"), "dest": dest}]

    async def fo(origin, dest, mode):
        return []
    r = asyncio.run(sr.nearest_reachable(*ORIGIN, [near_house, far_house], "foot", hazards=[kettle()], now=NOW,
                                         fetch_valhalla=fv, fetch_osrm=fo, fetch_pois=_np))
    assert r["destination"]["id"] == "SH-B" and r["route"]["leave_via"] == "Rue de Malte"
    assert [t["score"] is None for t in r["tried"]] == [True, False]       # A is nearer but only through the core
