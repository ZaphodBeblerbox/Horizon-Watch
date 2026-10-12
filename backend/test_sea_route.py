"""The safest sea route (sea_route.py): real routes on the marine network,
passage closures that yield the Cape, exposure ranking, the configured
hazards and their sources, and the vessel context."""
import datetime as dt
import sqlite3

import pytest

import sea_route as sea

SINGAPORE = (1.264, 103.84)
ROTTERDAM = (51.95, 4.05)
JEDDAH = (21.48, 39.17)
PIRAEUS = (37.94, 23.63)


def _cfg_hazards(weights=None):
    """The configured zones only (no live data), weights overridable."""
    cfg = sea.load_config()
    out = []
    for z in cfg["zones"]:
        w = (weights or {}).get(z["id"], z["weight"])
        out.append({"id": z["id"], "kind": z["kind"], "name": z["name"], "weight": w, "base_weight": w, "why": z["why"],
                    "sources": z["sources"], "date": z["reviewed"], "shape": "polygon", "ring": z["ring"],
                    "bbox": sea.ring_bbox(z["ring"]), "live": False})
    return out


# ── routing ────────────────────────────────────────────────────────────────

def test_singapore_rotterdam_via_suez_is_shortest():
    r = sea.sea_route(SINGAPORE, ROTTERDAM, sea.BASE_RESTRICTIONS)
    assert r and "suez" in r["passages"] and "babalmandab" in r["passages"]
    assert 8000 < r["distance_nm"] < 8800                     # published ~8,300 nm


def test_closing_bab_el_mandeb_gives_the_cape():
    r = sea.sea_route(SINGAPORE, ROTTERDAM, sea.BASE_RESTRICTIONS + ["babalmandab"])
    assert r and "south_africa" in r["passages"] and "suez" not in r["passages"]
    assert sea.route_label(r) == "Via the Cape of Good Hope"
    assert 11300 < r["distance_nm"] < 12300                   # published ~11,700 nm
    assert min(p[0] for p in r["coords"]) < -33               # rounds the Cape


def test_jeddah_piraeus_via_suez():
    r = sea.sea_route(JEDDAH, PIRAEUS, sea.BASE_RESTRICTIONS)
    assert r and r["passages"] == ["suez"] and 1200 < r["distance_nm"] < 1450


def test_closures_that_leave_no_path_return_none():
    # Jeddah is inside the Red Sea: closing both ends leaves no way out (searoute would draw a straight line)
    assert sea.sea_route(JEDDAH, PIRAEUS, sea.BASE_RESTRICTIONS + ["suez", "babalmandab"]) is None


# ── scoring ────────────────────────────────────────────────────────────────

def test_cape_recommended_when_red_sea_is_hot():
    p = sea.plan(SINGAPORE, ROTTERDAM, speed_kn=14, hz=_cfg_hazards({"red-sea-strike": 0.9}))
    assert p["ok"]
    labels = [c["label"] for c in p["candidates"]]
    assert "Via Suez" in labels and "Via the Cape of Good Hope" in labels
    rec = p["candidates"][0]
    assert rec["recommended"] and rec["label"] == "Via the Cape of Good Hope"
    suez = next(c for c in p["candidates"] if c["label"] == "Via Suez")
    assert suez["exposure"]["risk_hours"] > rec["exposure"]["risk_hours"]
    assert suez["exposure"]["zones"][0]["id"] == "red-sea-strike"
    assert 8 < rec["extra_days"] < 13 and 3000 < rec["extra_nm"] < 3800
    assert p["tradeoff"].startswith("Via the Cape of Good Hope: +")
    assert "Red Sea strike zone" in p["tradeoff"] and "Bab-el-Mandeb" in p["tradeoff"]
    assert p["sources"] and all(s.get("label") for s in p["sources"])


def test_suez_recommended_when_red_sea_is_quiet_or_days_are_dear():
    p = sea.plan(SINGAPORE, ROTTERDAM, speed_kn=14, hz=_cfg_hazards({"red-sea-strike": 0.05, "somali-piracy": 0.05}))
    assert p["candidates"][0]["label"] == "Via Suez"
    assert "is recommended" in p["tradeoff"]
    hot = _cfg_hazards({"red-sea-strike": 0.9})
    assert sea.plan(SINGAPORE, ROTTERDAM, speed_kn=14, hz=hot, day_value=50)["candidates"][0]["label"] == "Via Suez"


def test_exposure_counts_hours_at_speed():
    hz = _cfg_hazards()
    r = sea.sea_route(SINGAPORE, ROTTERDAM, sea.BASE_RESTRICTIONS)
    slow, fast = sea.exposure(r["coords"], hz, 10), sea.exposure(r["coords"], hz, 20)
    assert slow["risk_hours"] == pytest.approx(fast["risk_hours"] * 2, rel=0.02)
    rs = next(z for z in slow["zones"] if z["id"] == "red-sea-strike")
    assert 900 < rs["nm"] < 1700                              # the strike zone spans ~1,300 nm of the route


def test_overlapping_gnss_cells_count_once():
    cell = lambda i, lon: {"id": f"g{i}", "kind": "gnss", "group": "gnss", "name": "GPS interference", "weight": 0.2,
                           "shape": "circle", "lat": 0.0, "lon": lon, "radius_km": 80.0,
                           "bbox": (-1, 1, lon - 1, lon + 1)}
    coords = [[0.0, 10.0], [0.0, 10.5]]
    one = sea.exposure(coords, [cell(1, 10.2)], 10)
    two = sea.exposure(coords, [cell(1, 10.2), cell(2, 10.3)], 10)
    assert two["risk_hours"] == pytest.approx(one["risk_hours"])
    assert two["zones"][0]["members"] == ["g1", "g2"]


def test_jeddah_piraeus_has_no_needless_cape():
    p = sea.plan(JEDDAH, PIRAEUS, hz=_cfg_hazards({"red-sea-strike": 0.9}))
    assert p["candidates"][0]["label"] == "Via Suez"
    assert all(c["distance_nm"] < 2000 for c in p["candidates"])


# ── hazards ────────────────────────────────────────────────────────────────

def test_configured_zones_have_geometry_weight_why_source_date():
    cfg = sea.load_config()
    ids = {z["id"] for z in cfg["zones"]}
    assert {"red-sea-strike", "somali-piracy", "gulf-of-guinea", "hormuz-gulf", "black-sea-war"} <= ids
    for z in cfg["zones"]:
        assert len(z["ring"]) >= 4 and z["ring"][0] == z["ring"][-1]
        assert 0 < z["weight"] <= 1 and len(z["why"]) > 40
        assert z["sources"] and all(s["label"] and s["date"] for s in z["sources"])
        assert z["reviewed"]
    assert sea.in_ring(13.0, 43.3, next(z for z in cfg["zones"] if z["id"] == "red-sea-strike")["ring"])  # Bab-el-Mandeb


def test_live_zone_weight_rises_with_attacks_on_shipping(tmp_path):
    db = tmp_path / "t.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE geoconfirmed_placemarks (id TEXT, date TEXT, latitude REAL, longitude REAL, title TEXT, name TEXT)")
    con.execute("CREATE TABLE alerts (alert_id TEXT, created_at TEXT, lat REAL, lon REAL, title TEXT, source TEXT, severity TEXT, "
                "alert_type TEXT, entity_id TEXT, raw_json TEXT)")
    con.execute("CREATE TABLE ucdp_candidate (date TEXT, lat REAL, lon REAL)")
    now = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
    for i in range(4):
        con.execute("INSERT INTO geoconfirmed_placemarks VALUES (?,?,?,?,?,?)",
                    (f"g{i}", (now - dt.timedelta(days=i)).strftime("%Y-%m-%d"), 14.5 + i * 0.1, 42.0, f"Houthi missile strikes tanker {i}", ""))
    con.execute("INSERT INTO geoconfirmed_placemarks VALUES ('far', ?, 40.0, 10.0, 'elsewhere', '')", (now.strftime("%Y-%m-%d"),))
    con.execute("INSERT INTO alerts VALUES ('a1', ?, 25.5, 56.6, 'GPS', 'gps', 'high', 'gps_interference', 'gps:51:113', '{\"pct\": 40, \"aircraft\": 20}')",
                ((now - dt.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),))
    con.commit()
    con.close()
    hz = sea.build_hazards(now=now, db_path=str(db))
    rs = next(h for h in hz if h["id"] == "red-sea-strike")
    assert rs["stats"]["events_30d"] == 4 and rs["stats"]["shipping_30d"] == 4
    assert rs["weight"] > rs["base_weight"]
    assert any("recorded events" in s["label"] for s in rs["sources"])
    g = [h for h in hz if h["kind"] == "gnss"]
    assert len(g) == 1 and g[0]["weight"] == 0.2 and g[0]["sources"][0]["label"].startswith("Our ADS-B")


# ── context ────────────────────────────────────────────────────────────────

def test_context_destination_through_strike_zone():
    v = {"mmsi": "1", "name": "TEST", "lat": 5.0, "lon": 80.0, "speed": 14, "heading": 290,
         "destination": "NL RTM", "ship_type": "Tanker"}
    c = sea.context(v, hz=_cfg_hazards({"red-sea-strike": 0.9}))
    assert c["relevant"] and c["offer"] == "Plan a safer sea route"
    assert c["destination"]["locode"] == "NLRTM"
    assert any("Red Sea strike zone" in r for r in c["reasons"])
    assert c["default_speed_kn"] == 13.0


def test_context_heading_into_zone_without_destination():
    v = {"mmsi": "2", "name": "T2", "lat": 14.0, "lon": 55.0, "speed": 14, "heading": 260, "destination": ""}
    c = sea.context(v, hz=_cfg_hazards({"red-sea-strike": 0.9}))
    assert c["relevant"] and any("present heading" in r or "inside" in r for r in c["reasons"])


def test_context_irrelevant_in_the_open_atlantic():
    v = {"mmsi": "3", "name": "T3", "lat": 50.0, "lon": -30.0, "speed": 14, "heading": 270, "destination": "US NYC"}
    c = sea.context(v, hz=_cfg_hazards())
    assert not c["relevant"] and c["offer"] is None


def test_context_vessel_of_concern_and_missing_vessel():
    v = {"mmsi": "4", "name": "T4", "lat": 50.0, "lon": -30.0, "speed": 0, "destination": ""}
    assert sea.context(v, hz=[], concern=["Russian flag"])["relevant"]
    assert not sea.context(None)["relevant"]


def test_ports_and_destinations():
    assert sea.search_ports("NLRTM")[0]["name"] == "Rotterdam"
    assert sea.search_ports("piraeus")[0]["locode"] == "GRPIR"
    assert sea.resolve_destination("EGSUZ>SGSIN")["locode"] == "SGSIN"
    assert sea.resolve_destination("FOR ORDERS") is None
    assert sea.default_speed("Container ship") == 17.0 and sea.default_speed(None) == sea.DEFAULT_SPEED
