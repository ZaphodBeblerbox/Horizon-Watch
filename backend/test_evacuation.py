"""ADVISE EVACUATION and SAFE HOUSES (owner, 2026-10-12), and removing assets.

  1. safe houses are assets: CRUD, details checked, who may change them;
     anyone's asset removable by its owner or an admin, never a stranger;
     a deleted live person asset is not recreated by the next position;
  2. the destination: closed, full and not-for-this-person houses left out;
     a house only reachable through a danger is not chosen;
  3. multi-hop: the only safe house abroad, the overland way through a danger
     → ground → airport → flight → ground;
  4. the evacuation warning carries the plan; acknowledged back; progress.
"""
import asyncio
import datetime as dt
import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import asset_warnings as aw
import evacuation as ev
import owned_assets as oa
import position_stream as ps
import safe_route as sr
from routers import my_assets

NOW = dt.datetime(2026, 10, 12, 15, 0, tzinfo=dt.timezone.utc)
PARIS = (48.8566, 2.3522)
PARIS_HOUSE = (48.8400, 2.3000)          # 4.4 km south-west
PARIS_HOUSE_2 = (48.8800, 2.4200)        # north-east
GENEVA_HOUSE = (46.2050, 6.1430)
CDG = {"icao": "LFPG", "iata": "CDG", "code": "CDG", "name": "Charles de Gaulle", "city": "Paris", "country": "FR",
       "lat": 49.0090, "lon": 2.5540, "type": "large_airport"}
GVA = {"icao": "LSGG", "iata": "GVA", "code": "GVA", "name": "Geneva Airport", "city": "Geneva", "country": "CH",
       "lat": 46.2381, "lon": 6.1090, "type": "large_airport"}
BARDONNEX = {"id": "fr-ch-bardonnex", "name": "Bardonnex", "countries": ["FRA", "CHE"], "lat": 46.1478, "lon": 6.1199, "schengen": True}

USERS = {
    "owner": {"name": "Olivia", "team_id": None, "company": "Trifecta"},
    "agent": {"name": "Ana", "team_id": None, "company": "Trifecta"},
    "zed": {"name": "Zed", "team_id": None, "company": "Acme"},
    "root": {"name": "Root", "team_id": None, "company": None},
}


def _user(uid):
    u = USERS.get(uid)
    if not u:
        raise HTTPException(401, "authentication required")
    return {"id": uid, "email": f"{uid}@test.local", **u, **({"is_super_admin": True} if uid == "root" else {})}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = os.path.join(tmp_path, "t.db")
    monkeypatch.setattr(oa, "_db_path", lambda: path)
    monkeypatch.setattr(oa, "_last_prune", 0.0)
    monkeypatch.setattr(oa, "MIN_INTERVAL_S", 0)
    monkeypatch.setattr(ps, "_users", lambda: USERS)
    monkeypatch.setattr(ps, "HUB", ps.Hub())
    monkeypatch.setattr(my_assets, "_directory", lambda: [{"id": k, "name": v["name"], "email": f"{k}@test.local",
                                                           "company": v["company"], "team_id": v["team_id"]} for k, v in USERS.items()])
    import asset_watch
    monkeypatch.setattr(asset_watch, "invalidate", lambda uid: None)
    ps.forget_users()
    return path


@pytest.fixture
def pushes(monkeypatch):
    sent = []
    monkeypatch.setattr(aw, "_default_push", lambda uid, title, body, data: sent.append((uid, title, body, data)) or [{"ok": True}])
    return sent


@pytest.fixture
def client(db, monkeypatch):
    me = lambda request: _user(request.headers.get("x-test-user") or "")    # noqa: E731
    monkeypatch.setattr(my_assets, "_me", me)
    monkeypatch.setattr(aw, "_me", me)
    monkeypatch.setattr(ev, "_me", me)
    app = FastAPI()
    app.include_router(my_assets.router)
    app.include_router(aw.router)
    app.include_router(ev.router)
    return TestClient(app)


def H(uid):
    return {"x-test-user": uid}


def house(owner, name, at, **details):
    return oa.create(owner, {"name": name, "kind": "safe_house", "lat": at[0], "lon": at[1], "shared": True,
                             "details": {"status": "open", **details}})


# ── fakes: straight-line routes, hazards given, airports and flights known ──

def line(a, b, n=40):
    return [[a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] for k in range(n + 1)]


def deps(hazards=(), airports=None, air_ok=True, crossings=(BARDONNEX,)):
    async def fo(origin, dest, mode):
        c = line(origin, (dest["lat"], dest["lon"]))
        m = sr.length_m(c)
        return [{"coords": c, "distance_m": round(m), "duration_s": m / 20.0,
                 "steps": [{"text": f"Head to {dest.get('name')}.", "distance_m": round(m), "street": None}],
                 "router": "osrm", "mode": mode, "dest": dest}]

    async def fv(origin, dest, mode, exclude=None, alternates=1):
        return []

    def aps(lat, lon, km, iso2=None, limit=4):
        if airports is not None:
            return airports(lat, lon, km, iso2)
        return [CDG] if lat > 48 else [GVA]

    def air(o, d):
        mins = 65.0
        hard = 0 if air_ok else 12
        return {"recommended": "direct", "tradeoff": "", "warnings": [],
                "candidates": [{"key": "direct", "label": "Direct", "coords": [[o["lat"], o["lon"]], [d["lat"], d["lon"]]], "risk": "clear",
                                "score": {"minutes": mins, "distance_km": 410, "exposure": 0.0, "hard_minutes": hard, "max_weight": 0}}]}
    return ev.Deps(hazards_at=lambda lat, lon, km, now: list(hazards), air_plan=air, airports=aps,
                   crossings=lambda: list(crossings), osm=False, ports=lambda lat, lon, km: [],
                   fetch_valhalla=fv, fetch_osrm=fo)


def clash(at, hid="hz-1", core=8000):
    h = sr.make_hazard(hid=hid, kind="clashes", lat=at[0], lon=at[1], weight=1.0, at=NOW.isoformat(), place="the road",
                       what="clashes", source="test", radius_m=core * 2)
    h["core_m"] = core
    return h


def views(*assets, person=None):
    ok, out = ev.usable(list(assets), person or {"id": "agent", **USERS["agent"]})
    return ok, out


# ── 1. safe houses as assets; removing assets ──────────────────────────────

def test_safe_house_crud_and_details(client):
    r = client.post("/api/my-assets", headers=H("owner"), json={
        "name": "Rue Blanche", "kind": "safe_house", "lat": PARIS_HOUSE[0], "lon": PARIS_HOUSE[1], "shared": True,
        "details": {"capacity": 6, "status": "open", "contact": "Ring twice, ask for M.", "allowed_teams": "Trifecta"}})
    assert r.status_code == 200, r.text
    h = r.json()
    assert h["kind_label"] == "Safe house" and h["details"]["capacity"] == 6 and h["details"]["allowed_teams"] == ["Trifecta"]
    r = client.put(f"/api/my-assets/{h['id']}", headers=H("owner"), json={"details": {**h["details"], "status": "closed"}})
    assert r.json()["details"]["status"] == "closed"
    assert client.post("/api/my-assets", headers=H("owner"), json={"name": "x", "kind": "safe_house", "lat": 1, "lon": 1,
                                                                    "details": {"status": "maybe"}}).status_code == 400
    assert client.post("/api/my-assets", headers=H("owner"), json={"name": "x", "kind": "safe_house", "lat": 1, "lon": 1,
                                                                    "details": {"capacity": "lots"}}).status_code == 400
    # the map layer lists it, with places taken
    got = client.get("/api/evacuations/safe-houses", headers=H("agent")).json()["safe_houses"]
    assert [x["name"] for x in got] == ["Rue Blanche"] and got[0]["status"] == "closed"
    # a stranger cannot change or remove it
    assert client.put(f"/api/my-assets/{h['id']}", headers=H("zed"), json={"name": "mine"}).status_code == 404
    assert client.delete(f"/api/my-assets/{h['id']}", headers=H("zed")).status_code == 403
    assert client.delete(f"/api/my-assets/{h['id']}", headers=H("owner")).json()["ok"]
    assert client.get("/api/evacuations/safe-houses", headers=H("owner")).json()["safe_houses"] == []


def test_an_admin_can_remove_anyones_asset_a_stranger_cannot(client):
    private = oa.create("owner", {"name": "Depot", "kind": "warehouse", "lat": 48.8, "lon": 2.3})
    assert client.delete(f"/api/my-assets/{private['id']}", headers=H("zed")).status_code == 404       # not even visible
    assert client.delete(f"/api/my-assets/{private['id']}", headers=H("root")).status_code == 200
    assert oa.get_any(private["id"]) is None


def test_a_deleted_live_asset_does_not_come_back_until_linked_again(client):
    r = client.post("/api/my-assets/live", headers=H("agent"), json={"lat": 48.85, "lon": 2.35, "accuracy": 10, "source": "gps"})
    assert r.json()["linked"] == 1
    live = oa.linked_to("agent")[0]
    assert live["name"].endswith("(live)")
    assert client.delete(f"/api/my-assets/{live['id']}", headers=H("root")).status_code == 200      # created by the system, removed by an admin
    client.post("/api/my-assets/live", headers=H("agent"), json={"lat": 48.851, "lon": 2.351, "accuracy": 10, "source": "gps"})
    assert oa.linked_to("agent") == []                                                               # not recreated
    car = oa.create("owner", {"name": "Car", "kind": "vehicle_car", "lat": 48.8, "lon": 2.3, "shared": True})
    assert client.put(f"/api/my-assets/{car['id']}/link", headers=H("owner"), json={"user_id": "agent"}).status_code == 200
    assert not oa.live_asset_dismissed("agent")


# ── 2. the destination ─────────────────────────────────────────────────────

def test_usable_leaves_out_closed_full_and_not_allowed(db):
    a = house("owner", "Open", PARIS_HOUSE)
    b = house("owner", "Closed", PARIS_HOUSE_2, status="closed")
    c = house("owner", "Full", PARIS_HOUSE_2, capacity=2, occupancy=2)
    d = house("owner", "Acme only", PARIS_HOUSE_2, allowed_teams=["Acme"])
    e = house("owner", "Ana's", PARIS_HOUSE_2, allowed_users=["agent"])
    ok, out = views(a, b, c, d, e)
    assert sorted(h["name"] for h in ok) == ["Ana's", "Open"]
    assert {x["house"]["name"]: x["reason"] for x in out} == {"Closed": "closed", "Full": "full (2 of 2)", "Acme only": "not for this person"}
    # an evacuation already sent there takes a place
    one = house("owner", "One bed", PARIS_HOUSE, capacity=1)
    ok, out = ev.usable([one], {"id": "agent"}, {one["id"]: 1})
    assert ok == [] and out[0]["reason"].startswith("full")


def test_the_house_behind_a_danger_is_not_chosen(db):
    a = house("owner", "Behind the clashes", PARIS_HOUSE)
    b = house("owner", "Clear way", PARIS_HOUSE_2)
    ok, _ = views(a, b)
    mid = ((PARIS[0] + PARIS_HOUSE[0]) / 2, (PARIS[1] + PARIS_HOUSE[1]) / 2)
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps([clash(mid, core=600)])))
    assert p["status"] == "ok" and p["destination"]["name"] == "Clear way"
    assert {i["kind"] for i in p["itineraries"]} == {"direct"}
    assert all(i["destination"]["name"] != "Behind the clashes" for i in p["itineraries"])


def test_in_country_first_abroad_not_even_tried(db):
    ok, _ = views(house("owner", "Paris", PARIS_HOUSE), house("owner", "Geneva", GENEVA_HOUSE))
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps()))
    assert p["destination"]["name"] == "Paris" and "recommended" in p["itineraries"][0]["tags"]
    assert [t["house"] for t in p["tried"]] == ["Paris"]


# ── 3. multi-hop ──────────────────────────────────────────────────────────

def test_abroad_with_a_dangerous_overland_way_goes_by_air(db):
    ok, _ = views(house("owner", "Geneva", GENEVA_HOUSE))
    on_the_road = ((PARIS[0] + BARDONNEX["lat"]) / 2, (PARIS[1] + BARDONNEX["lon"]) / 2)
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps([clash(on_the_road)])))
    assert p["status"] == "ok"
    rec = p["itineraries"][0]
    assert rec["kind"] == "air" and [l["kind"] for l in rec["legs"]] == ["ground", "air", "ground"]
    assert rec["legs"][1]["from"]["code"] == "CDG" and rec["legs"][1]["to"]["code"] == "GVA"
    assert any("check flights" in a for a in rec["assumptions"])
    assert "check flights" in rec["summary"]
    assert p["safest"]["coords"] == rec["legs"][0]["coords"]            # the current ground leg, for the re-check
    assert p["links"]["google"].startswith("https://www.google.com/maps/dir/")


def test_abroad_both_ways_offered_with_what_is_assumed(db):
    ok, _ = views(house("owner", "Geneva", GENEVA_HOUSE))
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps()))
    kinds = [i["kind"] for i in p["itineraries"]]
    assert set(kinds) == {"overland", "air"}
    over = next(i for i in p["itineraries"] if i["kind"] == "overland")
    assert [l["kind"] for l in over["legs"]] == ["ground", "border", "ground"]
    assert "Bardonnex" in over["summary"] and any("our own signals" in a for a in over["assumptions"])
    tags = {t for i in p["itineraries"] for t in i.get("tags", [])}
    assert {"recommended", "fastest", "lowest exposure"} <= tags


def test_air_through_a_do_not_operate_area_is_not_offered(db):
    ok, _ = views(house("owner", "Geneva", GENEVA_HOUSE))
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps(air_ok=False)))
    assert [i["kind"] for i in p["itineraries"]] == ["overland"]


def test_no_safe_way_shelters_then_replans(db):
    ok, _ = views(house("owner", "Geneva", GENEVA_HOUSE))
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps(air_ok=False, crossings=())))
    assert p["status"] == "shelter" and p["itineraries"][0]["kind"] == "shelter"
    assert "re-plan" in p["explanation"]


def test_country_codes_france_is_known():
    assert ev.country_at(*PARIS)["iso3"] == "FRA"                     # "-99" in the geojson
    assert ev.country_at(*GENEVA_HOUSE)["iso3"] == "CHE"


# ── 4. advise, acknowledge, progress ──────────────────────────────────────

def _agent_asset():
    a = oa.create("owner", {"name": "Ana", "kind": "person", "lat": PARIS[0], "lon": PARIS[1], "shared": True})
    oa.link_user(a["id"], "agent")
    oa.record_position("agent", PARIS[0], PARIS[1], 8, "gps")
    return oa.get_any(a["id"])


def test_advise_sends_an_evacuate_warning_with_the_plan_and_it_is_acknowledged(client, pushes, monkeypatch):
    house("owner", "Rue Blanche", PARIS_HOUSE)
    a = _agent_asset()
    d = deps()
    real = ev.build
    monkeypatch.setattr(ev, "build", lambda *x, **k: real(*x, **{**k, "deps": d}))
    r = client.post("/api/evacuations", headers=H("owner"), json={"asset_id": a["id"]})
    assert r.status_code == 200, r.text
    w, plan = r.json()["warning"], r.json()["plan"]
    assert w["kind"] == "evacuate" and w["to_user"] == "agent"
    assert w["route"]["route_plan_id"] == plan["id"] and w["route"]["safe_house"] == "Rue Blanche"
    assert w["route"]["legs"][0]["mode"] == "car"
    assert w["message"].startswith("Evacuate now to Rue Blanche — drive about")
    assert pushes[-1][1] == "EVACUATE" and pushes[-1][3]["route_plan_id"] == plan["id"]
    # the person sees it, the plan opens for them
    import route_plans as rp
    assert rp.visible(rp.get(plan["id"]), _user("agent"))
    # progress: half-way along the route
    leg = plan["itineraries"][0]["legs"][0]
    mid = leg["coords"][len(leg["coords"]) // 2]
    oa.record_position("agent", mid[0], mid[1], 8, "gps")
    pr = client.get(f"/api/evacuations/{w['id']}/progress", headers=H("owner")).json()["progress"]
    assert not pr["off_route"] and 0.3 < pr["done_fraction"] < 0.7 and pr["remaining_s"] > 0
    # off the route
    oa.record_position("agent", mid[0] + 0.02, mid[1], 8, "gps")
    pr = client.get(f"/api/evacuations/latest?asset_id={a['id']}", headers=H("owner")).json()
    assert pr["progress"]["off_route"] and pr["warning"]["id"] == w["id"]
    # acknowledged back
    assert client.post(f"/api/warnings/{w['id']}/ack", headers=H("agent")).json()["status"] == "acknowledged"
    assert client.get(f"/api/evacuations/{w['id']}/progress", headers=H("owner")).json()["warning"]["acked_at"]
    # the place is taken
    assert client.get("/api/evacuations/safe-houses", headers=H("owner")).json()["safe_houses"][0]["reserved"] == 1


def test_only_the_owner_or_an_admin_advises(client, pushes):
    house("owner", "Rue Blanche", PARIS_HOUSE)
    a = _agent_asset()
    r = client.post("/api/evacuations", headers=H("agent"), json={"asset_id": a["id"]})       # can see it (shared), not theirs
    assert r.status_code == 403
    assert client.post("/api/evacuations", headers=H("zed"), json={"asset_id": a["id"]}).status_code == 403
    assert not pushes


def test_progress_of_an_arrival():
    plan = {"recommended": "k", "itineraries": [{"key": "k", "destination": {"lat": 1.0, "lon": 1.01}, "legs": [
        {"kind": "ground", "mode": "car", "label": "Drive", "coords": line((1.0, 1.0), (1.0, 1.01)), "distance_m": 1113,
         "duration_s": 120, "to": {"lat": 1.0, "lon": 1.01}}]}]}
    pr = ev.progress(plan, {"lat": 1.0, "lon": 1.0099}, now=NOW)
    assert pr["arrived"] and pr["remaining_s"] < 5


def test_any_building_can_be_declared_a_safe_house(client):
    r = client.post("/api/my-assets", headers=H("owner"), json={
        "name": "Hotel Lutetia", "kind": "office", "lat": PARIS_HOUSE_2[0], "lon": PARIS_HOUSE_2[1], "shared": True,
        "details": {"safe_house": True, "capacity": 20, "status": "open"}})
    a = r.json()
    assert a["kind"] == "office" and a["is_safe_house"] and a["details"]["capacity"] == 20
    got = client.get("/api/evacuations/safe-houses", headers=H("agent")).json()["safe_houses"]
    assert [(x["name"], x["kind"], x["declared"]) for x in got] == [("Hotel Lutetia", "office", True)]
    # a car cannot be one (it moves); undeclaring takes it off the list
    car = oa.create("owner", {"name": "Car", "kind": "vehicle_car", "lat": 48.8, "lon": 2.3, "shared": True, "details": {"safe_house": True}})
    assert not car["is_safe_house"]
    client.put(f"/api/my-assets/{a['id']}", headers=H("owner"), json={"details": {"capacity": 20}})
    assert client.get("/api/evacuations/safe-houses", headers=H("agent")).json()["safe_houses"] == []


def test_a_declared_building_is_an_evacuation_destination(db):
    office = oa.create("owner", {"name": "Office declared", "kind": "office", "lat": PARIS_HOUSE[0], "lon": PARIS_HOUSE[1], "shared": True,
                                 "details": {"safe_house": True}})
    ok, _ = ev.usable(ev.visible_houses(_user("agent")), {"id": "agent"})
    p = asyncio.run(ev.build(PARIS, ok, "car", now=NOW, deps=deps()))
    assert p["destination"]["name"] == "Office declared"
