"""The safest flight path (air_route.py): great circles, the curated
conflict-zone file, exposure scoring, the grid detour, live-aircraft
projection and the words. No network; the database is a temporary one."""
import datetime as dt
import math
import sqlite3

import pytest
import shapely
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import box

import air_route as ar

NOW = dt.datetime(2026, 10, 12, 15, 0, tzinfo=dt.timezone.utc)
FRA = (50.0267, 8.5584)
DXB = (25.2498, 55.3710)


def square(hid, lat0, lon0, lat1, lon1, weight=1.0, kind="czib", **kw):
    return ar._haz(id=hid, kind=kind, name=kw.pop("name", hid), adj=kw.pop("adj", hid.title()),
                   geom=box(lon0, lat0, lon1, lat1), weight=weight, why="test", sources=[{"issuer": "EASA", "ref": f"CZIB-{hid}"}], **kw)


# ── great circles ──────────────────────────────────────────────────────────

def test_great_circle_distances_match_published_values():
    assert ar.gc_km(*FRA, *DXB) == pytest.approx(4844, abs=15)          # FRA–DXB ≈ 4,840 km
    assert ar.gc_km(51.4700, -0.4543, 40.6413, -73.7781) == pytest.approx(5540, abs=15)   # LHR–JFK


def test_great_circle_midpoint_and_polar_route():
    seg = ar.gc_segment((0, 0), (0, 90), ar.gc_km(0, 0, 0, 90) / 10 * 1.0001)   # 10 equal steps
    mid = seg[len(seg) // 2]
    assert mid[0] == pytest.approx(0, abs=1e-6) and mid[1] == pytest.approx(45, abs=0.5)
    # 45°N 0°E to 45°N 180°E goes over the pole, not along the parallel
    assert max(p[0] for p in ar.gc_segment((45, 0), (45, 180), 100)) > 89
    # a densified path is as long as its great circle
    assert ar.length_km(ar.densify([list(FRA), list(DXB)], 50)) == pytest.approx(ar.gc_km(*FRA, *DXB), rel=1e-3)


def test_destination_and_bearing_round_trip():
    lat, lon = ar.destination(50.0, 8.0, 90.0, 1000.0)
    assert ar.gc_km(50.0, 8.0, lat, lon) == pytest.approx(1000.0, abs=0.5)
    assert ar.bearing(50.0, 8.0, lat, lon) == pytest.approx(90.0, abs=0.5)


def test_antimeridian_is_continuous_when_unwrapped():
    seg = ar.unwrap(ar.gc_segment((35.0, 170.0), (35.0, -170.0), 100))
    assert all(abs(b[1] - a[1]) < 5 for a, b in zip(seg, seg[1:]))


# ── the curated file ───────────────────────────────────────────────────────

def test_hazard_config_loads_with_sources_and_dates():
    cfg = ar.load_config()
    assert cfg["reviewed"] and cfg["review_every_days"]
    zones = cfg["zones"]
    assert {"czib-iran", "czib-iraq", "czib-ukraine", "czib-russia-west", "czib-sudan", "czib-libya", "czib-yemen"} <= {z["id"] for z in zones}
    for z in zones:
        assert z["why"] and z["sources"], z["id"]
        for s in z["sources"]:
            assert s["issuer"] and s["ref"] and s["url"].startswith("https://"), z["id"]
        easa = [s for s in z["sources"] if s["issuer"] == "EASA" and s["ref"].startswith(("CZIB", "2025"))]
        for s in easa:
            assert ar._date(s.get("revised") or s.get("issued")), z["id"]
            assert ar._date(s["valid_until"]), z["id"]
    hz = ar.config_hazards(cfg)
    assert len(hz) == len(zones) + len(cfg["sam_envelopes"])
    by = {h["id"]: h for h in hz}
    # the geometry is real: Tehran is in Iran's zone, Frankfurt in none
    assert shapely.contains_xy(by["czib-iran"]["geom"], 51.39, 35.69)
    assert not any(shapely.contains_xy(h["geom"], FRA[1], FRA[0]) for h in hz)
    # Russia is clipped at 60°E and leaves Kaliningrad out
    assert shapely.contains_xy(by["czib-russia-west"]["geom"], 37.6, 55.75)
    assert not shapely.contains_xy(by["czib-russia-west"]["geom"], 82.9, 55.0)
    assert not shapely.contains_xy(by["czib-russia-west"]["geom"], 20.5, 54.7)


def test_a_lapsed_bulletin_and_a_stale_file_are_said():
    cfg = {"reviewed": "2026-09-01", "review_every_days": 14,
           "zones": [{"name": "X", "sources": [{"ref": "CZIB-OLD", "valid_until": "2026-10-01"}]}]}
    w = ar.config_warnings(cfg, NOW.date())
    assert any("last reviewed 2026-09-01" in x for x in w)
    assert any("CZIB-OLD" in x and "lapsed" in x for x in w)
    assert ar.config_warnings({**cfg, "reviewed": "2026-10-10", "zones": []}, NOW.date()) == []


# ── scoring ────────────────────────────────────────────────────────────────

def test_a_path_through_a_hazard_scores_worse():
    h = [square("zone", 40, 20, 46, 30)]
    through = ar.score_path([[43, 10], [43, 40]], h)
    around = ar.score_path([[50, 10], [50, 40]], h)
    assert through["exposure"] > 0 and around["exposure"] == 0
    assert through["hard_minutes"] > 0
    x = through["crossings"][0]
    # ~800 km of the zone at 850 km/h ≈ 57 min, all at weight 1
    assert x["minutes"] == pytest.approx(ar.minutes(ar.gc_km(43, 20, 43, 30)), rel=0.1)
    assert x["weighted_minutes"] == pytest.approx(x["minutes"], rel=0.05)


def test_below_flight_level_bulletins_count_little_at_cruise_and_fully_near_an_airport():
    h = [square("libya", 25, 10, 33, 25, level="below_fl", below_fl=320)]
    cruise = ar.score_path([[29, 0], [29, 35]], h)
    term = ar.score_path([[29, 0], [29, 35]], h, terminals=[(29, 0), (29, 35)])
    near = ar.score_path([[29, 12], [29, 35]], h, terminals=[(29, 12)])
    assert cruise["crossings"][0]["max_weight"] == pytest.approx(ar.BELOW_FL_CRUISE_FACTOR)
    assert term["exposure"] == pytest.approx(cruise["exposure"])           # terminals far from the zone change nothing
    assert near["exposure"] > cruise["exposure"]                           # climbing out inside it counts fully


def test_terminal_exception_lowers_a_zone_near_the_airport():
    gulf = [square("gulf", 24, 50, 30, 56, weight=0.9, terminal_exception=True)]
    far = ar.score_path([[27, 45], [27, 60]], gulf)
    arriving = ar.score_path([[27, 45], [25.25, 55.37]], gulf, terminals=[(25.25, 55.37)], endpoints=[(25.25, 55.37)])
    near_pts = [c for c in arriving["crossings"]]
    assert far["crossings"][0]["max_weight"] == pytest.approx(0.9)
    assert near_pts and arriving["exposure"] < ar.score_path([[27, 45], [25.25, 55.37]], gulf)["exposure"]


# ── the detour ─────────────────────────────────────────────────────────────

def test_the_detour_avoids_the_polygon():
    wall = square("wall", 30, 20, 50, 26)            # across the direct path, open to the north and south
    h = [wall]
    o, d = (40.0, 10.0), (40.0, 36.0)
    wp = ar.grid_route(o, d, h, lam=4.0, strict=True)
    assert wp and wp[0] == [40.0, 10.0] and wp[-1] == [40.0, 36.0]
    pts = ar.densify(wp, 10)
    inside = shapely.contains_xy(wall["geom"], [p[1] for p in pts], [p[0] for p in pts])
    assert not inside.any()
    assert len(wp) <= 8                                 # string-pulled to a few waypoints
    direct = ar.score_path([list(o), list(d)], h)
    detour = ar.score_path(wp, h)
    assert detour["exposure"] == 0 < direct["exposure"]
    assert detour["distance_km"] > direct["distance_km"]


def test_plan_offers_the_detour_and_says_the_trade_off():
    h = [square("iraq", 28, 38, 37, 48, adj="Iraqi", name="Iraq (FIR Baghdad)"),
         square("iran", 26, 48, 39, 62, adj="Iranian", name="Iran (FIR Tehran)")]
    data = {"hazards": h, "warnings": [], "notes": {}}
    res = ar.plan({"lat": FRA[0], "lon": FRA[1], "code": "FRA"}, {"lat": DXB[0], "lon": DXB[1], "code": "DXB"}, data)
    keys = [c["key"] for c in res["candidates"]]
    assert keys[0] == "direct" and len(keys) >= 2
    direct = res["candidates"][0]
    best = next(c for c in res["candidates"] if c["key"] == res["recommended"])
    assert best["key"] != "direct" and best["score"]["exposure"] < direct["score"]["exposure"]
    assert best["extra_minutes"] > 0 and best["risk"] in ("clear", "low", "elevated")
    assert direct["risk"] == "high"
    assert "Avoiding Iraqi and Iranian airspace adds" in res["tradeoff"] and "the direct path crosses" in res["tradeoff"]
    assert {x["id"] for x in res["hazards"]} >= {"iraq", "iran"} and res["hazards"][0]["rings"]
    # assess: the direct path only
    assert [c["key"] for c in ar.plan({"lat": FRA[0], "lon": FRA[1]}, {"lat": DXB[0], "lon": DXB[1]}, data, "assess")["candidates"]] == ["direct"]


def test_a_clear_path_gets_no_detour():
    data = {"hazards": [square("far", -10, 100, -5, 110)], "warnings": [], "notes": {}}
    res = ar.plan({"lat": FRA[0], "lon": FRA[1]}, {"lat": 51.47, "lon": -0.45}, data)
    assert [c["key"] for c in res["candidates"]] == ["direct"] and res["candidates"][0]["risk"] == "clear"
    assert "crosses no conflict-zone bulletin area" in res["tradeoff"]


# ── events, GPS ────────────────────────────────────────────────────────────

def test_events_are_classified_for_altitude_and_tactical_drones_left_out():
    assert ar.classify_event("Russian Iskander-M missile strike on Kharkiv") == "missile"
    assert ar.classify_event("Air defence intercepts Shahed drones over Kyiv") == "air_defence"
    assert ar.classify_event("Russian airstrike with glide bombs on Kostiantynivka") == "airstrike"
    assert ar.classify_event("FPV strike hits a motorcycle near Pokrovsk") is None
    assert ar.classify_event("Damaged truck after an alleged strike") is None


def test_strike_zones_decay_and_merge():
    rules = ar.load_config()["event_rules"]
    ev = [{"lat": 50.45, "lon": 30.52, "cls": "missile", "at": NOW - dt.timedelta(hours=2), "title": "Missile strike — Kyiv, Ukraine", "source": "GeoConfirmed"},
          {"lat": 50.40, "lon": 30.60, "cls": "missile", "at": NOW - dt.timedelta(hours=30), "title": "Missile debris — Kyiv, Ukraine", "source": "GeoConfirmed"},
          {"lat": 46.0, "lon": 34.0, "cls": "missile", "at": NOW - dt.timedelta(days=9), "title": "old", "source": "GeoConfirmed"}]
    hz = ar.event_hazards(ev, rules, NOW)
    assert len(hz) == 1 and hz[0]["stats"]["events"] == 2 and "Kyiv" in hz[0]["name"]
    assert 0.5 < hz[0]["weight"] <= 1.0
    assert ar.event_decay(48) == pytest.approx(0.5) and ar.event_decay(24 * 8) == 0


def test_gps_cells_need_a_real_share_of_aircraft():
    assert ar.gps_level({"pct": 10.0, "degraded": 3}) is None
    assert ar.gps_level({"pct": 18.0, "degraded": 6})["level"] == "degraded"
    assert ar.gps_level({"pct": 40.0, "degraded": 12})["level"] == "severe"
    cells = [{"lat": 55.0, "lon": 20.0, "pct": 40.0, "degraded": 30, "aircraft": 75, "cell_deg": 0.5, "at": "2026-10-12"},
             {"lat": 55.5, "lon": 20.0, "pct": 30.0, "degraded": 12, "aircraft": 40, "cell_deg": 0.5, "at": "2026-10-12"}]
    hz = ar.gps_hazards(cells, {"severe_weight": 0.35}, lambda la, lo: "Kaliningrad")
    assert len(hz) == 1 and hz[0]["stats"]["peak_degraded"] == 30 and hz[0]["name"] == "GPS interference near Kaliningrad"


# ── a live aircraft ────────────────────────────────────────────────────────

def test_live_aircraft_heading_is_projected_and_the_crossing_explained():
    ac = {"hex": "4b1805", "flight": "TST123 ", "lat": 50.0, "lon": 8.0, "track": 90.0, "gs": 450, "alt_baro": 36000}
    path = ar.projection(ac)
    assert ar.gc_km(*path[0], *path[1]) == pytest.approx(450 * 1.852 * 2, rel=0.01)
    assert path[1][1] > 25                                  # due east
    data = {"hazards": [square("ukraine", 44, 22, 52.5, 40, adj="Ukrainian", name="Ukraine (FIRs)")], "warnings": [], "notes": {}}
    res = ar.assess_live(ac, None, data)
    assert res["projection"] == "heading" and [c["key"] for c in res["candidates"]] == ["direct"]
    assert res["aircraft"]["flight"] == "TST123"
    why = ar.context_reason(res)
    assert why["relevant"] and "TST123, on its current heading, is projected to cross 1 EASA conflict-zone bulletin area" in why["reason"]
    assert why["label"] == "Check this flight's route"
    calm = ar.assess_live({**ac, "track": 270.0}, None, data)
    assert ar.context_reason(calm)["relevant"] is False


@pytest.fixture()
def db(tmp_path):
    p = tmp_path / "air.db"
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE airports (ident TEXT, icao_code TEXT, iata_code TEXT, airport_name TEXT, airport_type TEXT, "
                "country_code TEXT, municipality TEXT, latitude REAL, longitude REAL)")
    con.executemany("INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?)", [
        ("EDDF", "EDDF", "FRA", "Frankfurt Main Airport", "large_airport", "DE", "Frankfurt am Main", *FRA),
        ("OMDB", "OMDB", "DXB", "Dubai International Airport", "large_airport", "AE", "Dubai", *DXB),
        ("EDFE", "EDFE", None, "Frankfurt-Egelsbach", "small_airport", "DE", "Egelsbach", 49.96, 8.64)])
    con.commit()
    con.close()
    return str(p)


def test_live_aircraft_with_a_known_destination_routes_from_where_it_is(db):
    ac = {"hex": "896180", "flight": "UAE46", "lat": 45.0, "lon": 20.0, "track": 120.0, "gs": 480, "alt_baro": 37000}
    data = {"hazards": [square("iran", 25, 48, 39, 62, adj="Iranian", name="Iran (FIR Tehran)")], "warnings": [], "notes": {}}
    res = ar.assess_live(ac, {"departure": "EDDF", "destination": "OMDB"}, data, db=db)
    assert res["projection"] == "destination" and res["candidates"][0]["coords"][0] == [45.0, 20.0]
    assert res["aircraft"]["destination_airport"]["iata"] == "DXB" and res["flown"][0] == pytest.approx([FRA[0], FRA[1]], abs=0.01)
    assert any(c["key"] != "direct" for c in res["candidates"])
    assert "on its way to Dubai" in ar.context_reason(res)["reason"]


def test_airports_resolve_by_iata_icao_and_search(db):
    assert ar.airport("fra", db)["icao"] == "EDDF"
    assert ar.airport("OMDB", db)["iata"] == "DXB"
    assert ar.airport("ZZZZ", db) is None
    assert [a["iata"] for a in ar.airport_search("Frank", db=db)] == ["FRA"]       # the small field is not offered
    assert ar.resolve_point({"lat": 1, "lon": 2}) == {"lat": 1.0, "lon": 2.0, "name": None, "code": None}


def test_the_http_endpoints(monkeypatch, db):
    import routers.air_route as rr
    monkeypatch.setattr(rr, "_me", lambda request: {"id": 1})
    data = {"hazards": [square("iran", 25, 48, 39, 62, adj="Iranian", name="Iran (FIR Tehran)")], "warnings": ["w"], "notes": {}, "built_at": "x", "reviewed": "y"}
    monkeypatch.setattr(ar, "hazard_set", lambda **kw: data)
    monkeypatch.setattr(ar, "_db_path", lambda: db)
    ar._PLAN_CACHE.clear()
    app = FastAPI()
    app.include_router(rr.router)
    c = TestClient(app)
    r = c.post("/api/routes/air", json={"from": "FRA", "to": "DXB"})
    assert r.status_code == 200 and r.json()["kind"] == "air" and r.json()["warnings"] == ["w"]
    assert c.post("/api/routes/air", json={"from": "FRA", "to": "NOPE"}).status_code == 404
    assert c.post("/api/routes/air", json={"from": "FRA"}).status_code == 400
    ctx = c.get("/api/routes/air/context", params={"from": "FRA", "to": "DXB"}).json()
    assert ctx["relevant"] is True and "crosses" in ctx["reason"]
    assert c.get("/api/routes/air/airports", params={"q": "dubai"}).json()["airports"][0]["icao"] == "OMDB"
    monkeypatch.setattr(rr, "_live", lambda icao: None)
    assert c.get("/api/routes/air/context", params={"icao": "abcdef"}).json()["relevant"] is False
