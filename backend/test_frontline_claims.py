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


# ── movements followed over the days, and sieges (owner, 2026-10-17) ────

def yev(id, hours_ago, lat, lon, place, actor="Houthis", act="assault", **kw):
    """A Yemen ground event; place_type pinned so no geocode cache is read."""
    return ev(id=id, act=act, actor=actor, target_name=f"{place}, Yemen", lat=lat, lon=lon,
              precision="town", place_type="town", country="Yemen", time=iso(hours_ago),
              sources=[{"source": "Telegram", "title": f"{actor} {act} {place}", "url": f"https://t.me/x/{id}"}], **kw)


def by_id(ms):
    return {m["id"]: m for m in ms}


# A → B one day later, ~17 km → C one day later, ~18 km
PATH = [yev("a", 72, 13.60, 44.00, "Al-Ma'afer"), yev("b", 48, 13.70, 44.12, "Jabal Habashi"),
        yev("c", 24, 13.82, 44.24, "Maqbanah")]


def test_chain_reach_scales_with_time_and_is_capped():
    assert fc.chain_reach_km(0) == 15.0
    assert fc.chain_reach_km(86400) == 30.0
    assert fc.chain_reach_km(10 * 86400) == fc.CHAIN_MAX_KM == 60.0


def test_same_side_nearby_next_day_is_one_path_of_legs():
    ms = by_id(fc.build_movements(PATH, []))
    a, b, c = ms["move-a"], ms["move-b"], ms["move-c"]
    assert a["kind"] == "approach" and a["leg"] == 0 and not a["tip"]
    assert "no earlier event by Houthis" in a["from_basis"]
    assert b["kind"] == "leg" and b["leg"] == 1 and c["leg"] == 2
    assert a["path_id"] == b["path_id"] == c["path_id"] and c["path_legs"] == 2 and c["tip"] and not b["tip"]
    # the leg starts where the side was the day before, and says it is inferred
    assert b["from"] == {"lat": 13.60, "lon": 44.00} and c["from"] == {"lat": 13.70, "lon": 44.12}
    d = fc.haversine_km((13.60, 44.00), (13.70, 44.12))
    assert b["from_basis"].startswith("inferred: Houthis at Al-Ma'afer on ")
    assert "at Jabal Habashi on " in b["from_basis"] and f"{d:.0f} km apart" in b["from_basis"]
    assert b["inferred"] is True and b["distance_km"] == round(d, 1) and b["gap_hours"] == 24.0
    # both events carried as evidence, with their sources
    assert [(e["role"], e["event_id"]) for e in b["evidence"]] == [("from", "a"), ("to", "b")]
    assert b["evidence"][0]["sources"][0]["url"] == "https://t.me/x/a"
    assert {s["url"] for s in b["sources"]} == {"https://t.me/x/a", "https://t.me/x/b"}


def test_too_far_or_too_late_or_other_side_does_not_chain():
    far = [PATH[0], yev("f", 48, 14.30, 44.00, "Far")]                                # ~78 km
    late = [yev("a", 24 * 9, 13.60, 44.00, "Al-Ma'afer"), yev("l", 24, 13.70, 44.12, "Jabal Habashi")]   # 8 days
    other = [PATH[0], yev("o", 48, 13.70, 44.12, "Jabal Habashi", actor="Yemeni government forces")]
    for evs in (far, late, other):
        ms = fc.build_movements(evs, [])
        assert len(ms) == 2 and all(m["kind"] == "approach" for m in ms), evs


def test_same_day_needs_to_be_close_but_two_days_reach_further():
    a = yev("a", 48, 13.60, 44.00, "A")
    near_same_day = yev("n", 46, 13.60, 44.22, "N")            # ~24 km, 2 h later: beyond 15 km
    two_days_later = yev("t", 0, 13.60, 44.22, "T")            # ~24 km, 2 days: within 45 km
    assert by_id(fc.build_movements([a, near_same_day], []))["move-n"]["kind"] == "approach"
    assert by_id(fc.build_movements([a, two_days_later], []))["move-t"]["kind"] == "leg"


def test_same_place_again_is_a_stop_not_a_move():
    ms = fc.build_movements([PATH[0], yev("a2", 60, 13.605, 44.005, "Al-Ma'afer"), PATH[1]], [])
    assert {m["id"] for m in ms} == {"move-a", "move-b"}
    assert by_id(ms)["move-a"]["stop_events"] == 2
    # B leaves from A's latest event there, not the first
    b = by_id(ms)["move-b"]
    assert b["evidence"][0]["event_id"] == "a2" and b["gap_hours"] == 12.0


def test_path_before_the_window_is_drawn_back_to_its_start():
    since = NOW - 30 * 3600                                      # only C is inside
    assert set(by_id(fc.build_movements(PATH, [], since=since))) == {"move-a", "move-b", "move-c"}
    assert fc.build_movements(PATH[:2], [], since=since) == []


def test_siege_words_multilingual_and_lifted():
    for t in ("Houthi forces besiege Ta'izz city", "Taiz under siege", "Pokrovsk encircled",
              "Les forces assiègent la ville", "Stadt eingekesselt", "ВСУ в окружении под Покровском",
              "облога міста", "الحوثيون يحاصرون مدينة تعز", "فرض حصار على تعز"):
        assert fc.siege_state({"title": t}) == "siege", t
    for t in ("Government forces break the siege of Taiz", "siege lifted", "فك الحصار عن تعز",
              "прорыв окружения", "Troops broke out of the encirclement"):
        assert fc.siege_state({"title": t}) == "lifted", t
    assert fc.siege_state({"title": "Houthis shell Taiz"}) is None
    assert fc.siege_state({"title": "x", "sources": [{"title": "Taiz besieged"}]}) == "siege"


def test_besieger_is_the_actor_unless_the_words_put_it_inside():
    assert fc.besieger_side({"title": "Houthi forces besiege Taiz"}, "yemen", "red") == "red"
    assert fc.besieger_side({"title": "Taiz, besieged by the Houthis, shelled"}, "yemen", "blue") == "red"
    assert fc.besieger_side({"title": "Government forces in besieged Taiz repel attack"}, "yemen", "blue") == "red"
    assert fc.besieger_side({"title": "Houthis surrounded the city with forces"}, "yemen", "red") == "red"


def test_siege_approaches_avoid_the_sea_and_follow_the_side():
    centre = (13.58, 44.02)
    own = [{"lat": 13.70, "lon": 44.12, "name": "NE"}, {"lat": 13.72, "lon": 44.14, "name": "NE again"},
           {"lat": 13.45, "lon": 44.05, "name": "S"}]
    ap, blocked, checked = fc.siege_approaches(centre, 4.0, own, land_at=lambda la, lo: lo > 43.99)
    assert checked
    brgs = [a["bearing"] for a in ap]
    # the side's own directions first, nearest first, one per direction
    assert [a["basis_kind"] for a in ap[:2]] == ["own_events", "own_events"] and ap[2]["basis_kind"] == "open"
    assert ap[0]["via"]["name"] == "S" and ap[1]["via"]["name"] == "NE"
    assert all(fc._ang(x, y) >= fc.SIEGE_SEP_DEG for i, x in enumerate(brgs) for y in brgs[i + 1:])
    # nothing from the sea: west, south-west, north-west are blocked
    assert {b["compass"] for b in blocked} >= {"west", "south-west", "north-west"}
    assert all(b["why"] == "open sea" for b in blocked)
    assert not any(a["compass"] in ("west", "south-west", "north-west") for a in ap)
    # every arrow converges: starts outside the place, ends inside its edge
    for a in ap:
        assert fc.haversine_km(centre, a["from"]) > 4.0 > fc.haversine_km(centre, a["to"])


def test_siege_approaches_without_a_land_mask_ring_the_place():
    ap, blocked, checked = fc.siege_approaches((13.58, 44.02), 4.0, [])
    assert not checked and not blocked and len(ap) == 8


def test_siege_report_draws_converging_arrows_with_their_basis():
    siege = yev("s", 6, 13.58, 44.02, "Ta'izz", title="Houthi forces besiege Ta'izz city")
    ring = yev("r", 30, 13.45, 44.05, "Al-Ma'afer")                                  # ~15 km south
    ms = fc.build_movements([ring, siege], [], land_at=lambda la, lo: lo > 43.99)
    arrows = [m for m in ms if m["kind"] == "siege"]
    assert len(arrows) >= 3
    assert not any(m["id"] == "move-s" for m in ms)              # no lone arrow for the besieged place
    first = arrows[0]
    assert first["basis_kind"] == "own_events" and first["compass"] == "south"
    assert first["from_basis"].startswith("inferred: Ta'izz reported besieged on ")
    assert "toward Al-Ma'afer, where Houthis fought on" in first["from_basis"]
    assert any("an open approach on land" in m["from_basis"] for m in arrows)
    s = first["siege"]
    assert s["place"] == "Ta'izz" and s["quote"] == "Houthi forces besiege Ta'izz city"
    assert "west" in {b["compass"] for b in s["blocked"]} and "mountains are not read" in s["terrain_note"]
    for m in arrows:
        assert m["side"] == "red" and m["centre"] == {"lat": 13.58, "lon": 44.02}
        assert fc.haversine_km((13.58, 44.02), (m["to"]["lat"], m["to"]["lon"])) < 4.0


def test_siege_lifted_later_draws_no_ring():
    siege = yev("s", 30, 13.58, 44.02, "Ta'izz", title="Houthi forces besiege Ta'izz city")
    lifted = yev("l", 6, 13.58, 44.03, "Ta'izz", actor="Yemeni government forces",
                 title="Government forces break the siege of Ta'izz")
    ms = fc.build_movements([siege, lifted], [], land_at=lambda la, lo: True)
    assert not any(m["kind"] == "siege" for m in ms)


def test_shelling_of_a_besieged_place_places_the_ring():
    sh = yev("sh", 6, 13.58, 44.02, "Ta'izz", act="shelling", title="Houthi shelling of besieged Ta'izz")
    ms = fc.build_movements([sh], [], land_at=lambda la, lo: True)
    assert ms and all(m["kind"] == "siege" for m in ms)
    assert fc.build_movements([yev("sh2", 6, 13.58, 44.02, "Ta'izz", act="shelling")], []) == []


def test_a_siege_outlasts_the_window_until_lifted_and_unnamed_places_read_as_coordinates():
    siege = yev("s", 24 * 10, 13.58, 44.02, "Ta'izz", title="Houthi forces besiege Ta'izz city")
    since = NOW - 7 * 86400
    assert any(m["kind"] == "siege" for m in fc.build_movements([siege], [], since=since, land_at=lambda la, lo: True))
    old = yev("o", 24 * 20, 13.58, 44.02, "Ta'izz", title="Houthi forces besiege Ta'izz city")
    assert fc.build_movements([old], [], since=since, land_at=lambda la, lo: True) == []
    assert fc._place({"target_name": "Yemen", "country": "Yemen", "lat": 13.46, "lon": 44.02}) == "13.46°N 44.02°E"
