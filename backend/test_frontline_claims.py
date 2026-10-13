"""frontline_claims.py — claim geometry, confirm/expire rules, origin
inference with and without a hint per theatre, unit type → SIDC."""
import datetime as dt
import time

import pytest
from shapely.geometry import Polygon

import frontline_claims as fc

NOW = time.time()


def iso(hours_ago):
    return dt.datetime.fromtimestamp(NOW - hours_ago * 3600, dt.timezone.utc).isoformat()


def ev(**kw):
    base = {"id": "e1", "act": "control_change", "actor": "Russian forces", "actor_side": None,
            "target_name": "Novoselivka", "lat": 48.10, "lon": 37.60, "precision": "village",
            "time": iso(2), "sources": ["https://t.me/example/1"], "casualties": None,
            "unit_type": None, "origin_hint": None}
    base.update(kw)
    return base


# A square "occupied area" east of 37.5°E, with a retaken patch west of it.
OCC = Polygon([(37.5, 47.5), (39.5, 47.5), (39.5, 48.8), (37.5, 48.8)])
DIS = Polygon([(37.0, 47.9), (37.45, 47.9), (37.45, 48.3), (37.0, 48.3)])


# ── claims ───────────────────────────────────────────────────────────────

def test_claim_buffer_sized_by_place_type():
    c = fc.build_claims([ev()], NOW)[0]
    assert c["radius_km"] == 1.5 and c["place_type"] == "village"
    ring = c["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 49
    d = fc.haversine_km((c["lat"], c["lon"]), (ring[0][1], ring[0][0]))
    assert abs(d - 1.5) < 0.05
    town = fc.build_claims([ev(precision="town")], NOW)[0]
    assert town["radius_km"] == 4.0


def test_claim_label_and_side_colour():
    c = fc.build_claims([ev()], NOW)[0]
    assert c["theatre"] == "ukraine" and c["side"] == "red"
    assert c["colour"] == fc.SIDE_COLOURS["red"]
    assert c["status"] == "claimed"
    assert c["label"].startswith("CLAIMED — unverified, by Russian forces")


def test_claim_confirmed_when_inside_occupied_polygon():
    c = fc.build_claims([ev(lat=48.2, lon=38.0)], NOW, occ=OCC, dis=DIS)[0]
    assert c["status"] == "confirmed"
    out = fc.build_claims([ev(lat=48.2, lon=36.9)], NOW, occ=OCC, dis=DIS)[0]
    assert out["status"] == "claimed"


def test_ukrainian_claim_confirmed_in_retaken_area():
    c = fc.build_claims([ev(actor="Ukrainian 47th brigade", lat=48.1, lon=37.2)], NOW, occ=OCC, dis=DIS)[0]
    assert c["side"] == "blue" and c["status"] == "confirmed"


def test_claim_expires_after_seven_days_and_drops_after_thirty():
    c = fc.build_claims([ev(time=iso(24 * 8), lon=36.8)], NOW, occ=OCC, dis=DIS)[0]
    assert c["status"] == "expired" and c["opacity"] < 0.5
    assert fc.build_claims([ev(time=iso(24 * 31))], NOW) == []


def test_claim_contradicted_by_later_other_side():
    a = ev(id="a", time=iso(30))
    b = ev(id="b", actor="Ukrainian forces", time=iso(5))
    claims = {c["event_ids"][0]: c for c in fc.build_claims([a, b], NOW)}
    assert claims["a"]["status"] == "contradicted"
    assert claims["b"]["status"] == "claimed"


def test_same_place_same_side_merges_sources():
    a = ev(id="a", time=iso(10), sources=["s1"])
    b = ev(id="b", time=iso(4), sources=["s2"], lat=48.105)
    claims = fc.build_claims([a, b], NOW)
    assert len(claims) == 1 and claims[0]["sources"] == ["s1", "s2"]


def test_theatre_without_official_line_says_so():
    c = fc.build_claims([ev(actor="Houthi forces", target_name="Hazm", lat=16.16, lon=44.78, precision="town")], NOW)[0]
    assert c["theatre"] == "yemen" and c["side"] == "red"
    assert "no open control map" in c["status_note"]
    s = fc.build_claims([ev(actor="Saudi-led coalition", lat=16.16, lon=44.78)], NOW)[0]
    assert s["side"] == "blue"


# ── origins ──────────────────────────────────────────────────────────────

def test_origin_hint_wins_and_is_not_assumed():
    e = ev(act="drone", target_name="Kyiv", lat=50.45, lon=30.52, origin_hint={"lat": 52.0, "lon": 34.0, "name": "X"})
    o = fc.infer_origin(e, "ukraine", "red")
    assert o["assumed"] is False and (o["lat"], o["lon"]) == (52.0, 34.0)


def test_named_hint_matches_a_launch_area():
    e = ev(act="drone", lat=50.45, lon=30.52, origin_hint="from the Bryansk direction")
    o = fc.infer_origin(e, "ukraine", "red")
    assert o["name"] == "Bryansk" and o["assumed"] is False


def test_russian_drone_without_hint_assumed_from_nearest_area_or_front():
    kyiv = ev(act="drone", actor="Russia", target_name="Kyiv", lat=50.45, lon=30.52)
    o = fc.infer_origin(kyiv, "ukraine", "red")
    assert o["assumed"] is True and o["source"]
    # with an occupied area close to the target, the front line is nearer
    zap = ev(act="drone", actor="Russia", target_name="Pokrovsk", lat=48.28, lon=37.18)
    o2 = fc.infer_origin(zap, "ukraine", "red", occ=OCC)
    assert o2["name"] == "Russian-held ground"
    assert fc.haversine_km((o2["lat"], o2["lon"]), (48.28, 37.18)) < 40


def test_houthi_missile_at_riyadh_from_northern_yemen():
    e = ev(act="missile", actor="Houthis", target_name="Riyadh", lat=24.71, lon=46.68, title="ballistic missile")
    th, side = fc.theatre_and_side(e)
    assert th == "yemen" and side == "red"
    o = fc.infer_origin(e, th, side)
    assert o["assumed"] and o["name"] in ("Sa'dah", "Sanaa", "Hodeidah", "Dhamar")
    assert "UN Panel" in o["source"] or "CENTCOM" in o["source"]


def test_iranian_missile_at_israel():
    e = ev(act="missile", actor="IRGC", target_name="Tel Aviv", lat=32.08, lon=34.78, title="ballistic")
    o = fc.infer_origin(e, *fc.theatre_and_side(e))
    assert o["assumed"] and o["name"] in ("Kermanshah", "Tabriz", "Isfahan", "Shiraz")


def test_missile_kind_and_apogee():
    assert fc.missile_kind({"title": "Iskander-M strike"}) == "ballistic"
    assert fc.missile_kind({"weapon": "Kh-101"}) == "cruise"
    assert fc.missile_kind({"title": "missile attack"}) == "missile"
    assert fc.apogee_km("ballistic", 1000) == 250.0
    assert fc.apogee_km("cruise", 1000) == 25.0
    assert fc.apogee_km("drone", 500) < 3


def test_trajectory_carries_assumed_origin_and_flight_time():
    t = fc.build_trajectories([ev(act="drone", actor="Russia", target_name="Kyiv", lat=50.45, lon=30.52)])[0]
    assert t["kind"] == "drone" and t["from"]["assumed"] is True
    assert t["flight_minutes"] == pytest.approx(t["range_km"] / 180 * 60, rel=0.01)
    assert "Shahed" in t["kind_label"]


# ── movements and SIDCs ──────────────────────────────────────────────────

def test_movement_starts_on_nearest_russian_held_ground():
    m = fc.build_movements([ev(lat=48.2, lon=37.3, unit_type="airborne")], [], occ=OCC)[0]
    assert m["from"] and abs(m["from"]["lon"] - 37.5) < 0.01
    assert "Russian-held" in m["from_basis"]
    assert m["sidc"] == "SHGPUCIA-------"


def test_movement_from_previous_claim():
    prior = fc.build_claims([ev(id="p", lat=48.20, lon=37.70, time=iso(40))], NOW)
    m = fc.build_movements([ev(id="n", lat=48.20, lon=37.40, time=iso(2))], prior, occ=OCC)[0]
    assert "previous claim" in m["from_basis"]


def test_movement_in_theatre_without_line_uses_rear_area():
    m = fc.build_movements([ev(actor="Houthis", lat=15.6, lon=44.8, act="assault")], [])[0]
    assert m["from"] and "rear area" in m["from_basis"]


@pytest.mark.parametrize("unit,side,act,want", [
    ("infantry", "blue", None, "SFGPUCI--------"),
    ("armoured", "red", None, "SHGPUCA--------"),
    ("airborne", "blue", None, "SFGPUCIA-------"),
    ("artillery", "red", None, "SHGPUCF--------"),
    ("air force", "blue", None, "SFAPMFA--------"),
    ("naval", "red", None, "SHSPCL---------"),
    ("drones", "red", None, "SHAPMFQ--------"),
    ("marines", "blue", None, "SFGPUCIN-------"),
    (None, "red", "airstrike", "SHAPMFA--------"),
    (None, "unknown", None, "SUGPU----------"),
])
def test_sidc(unit, side, act, want):
    s = fc.sidc_for(unit, side, act)
    assert s == want and len(s) == 15


def test_overlay_reads_synthetic_file(tmp_path, monkeypatch):
    import json
    p = tmp_path / "syn.json"
    p.write_text(json.dumps([{"id": "s1", "act": "drone", "actor": "Houthis", "target_name": "Riyadh",
                              "lat": 24.71, "lon": 46.68, "minutes_ago": 30, "sources": []}]))
    monkeypatch.setenv("FRONTLINE_CLAIMS_SYNTHETIC", str(p))
    d = fc.overlay(24, now=time.time())
    assert d["synthetic"] is True
    assert any(t.get("synthetic") is True and t["event_id"] == "s1" for t in d["trajectories"])


def test_ukrainian_drone_into_russia_from_ukrainian_held_ground():
    e = ev(act="drone", actor="Ukraine", target_name="Belgorod", lat=50.60, lon=36.59, title="drone attack on Belgorod")
    o = fc.infer_origin(e, "ukraine", "blue", occ=OCC)
    assert o["assumed"] and "Ukrainian" in o["name"]
    assert fc.haversine_km((o["lat"], o["lon"]), (50.60, 36.59)) < 80


def test_fpv_drone_is_tactical_not_a_trajectory():
    e = ev(act="drone", actor="Ukraine", title="Russian vehicle hit by Ukrainian FPV drones", lat=48.09, lon=37.01)
    assert fc.is_tactical_drone(e)
    assert fc.build_trajectories([e], occ=OCC) == []
    shahed = ev(act="drone", actor="Russia", title="Shahed drones attack Kyiv", lat=50.45, lon=30.52)
    assert not fc.is_tactical_drone(shahed) and fc.build_trajectories([shahed], occ=OCC)
