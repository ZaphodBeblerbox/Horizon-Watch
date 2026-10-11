"""Overwatch zone generation and the border sweep (overwatch.py).

Scoring, the proposal cap, dedupe, grouping, unique zone ids, proposals
never scanned, the sweep's keep/delete decision and the sweep log that
stops a tile being re-swept."""
import datetime as dt
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import overwatch as ow
from database import OverwatchDeclined, OverwatchSweep, OverwatchSweepTile, WatchZone

UKRAINE = {"id": "ukraine", "name": "Russia–Ukraine war", "countries": ["ua", "ru"],
           "center": [48.5, 35.5], "radius_km": 900}


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    for t in (WatchZone, OverwatchSweep, OverwatchSweepTile, OverwatchDeclined):
        t.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _cand(sub, key, lat, lon, score, side=6.0):
    return {"key": key, "subgroup": sub, "name": key, "lat": lat, "lon": lon, "bbox": ow.box(lat, lon, side),
            "score": score, "parts": {"score": score}, "reason": f"{key} reason", "meta": {}}


# ── scoring ──────────────────────────────────────────────────────────────

def test_score_rewards_proximity_signals_and_visibility():
    near = ow.score(10, 600, 0, 10)["score"]
    far = ow.score(500, 600, 0, 10)["score"]
    assert near > far
    assert ow.score(100, 600, 20, 10)["score"] > ow.score(100, 600, 0, 10)["score"]
    assert ow.score(100, 600, 0, 25)["score"] > ow.score(100, 600, 0, 5)["score"]
    top = ow.score(0, 600, 1000, 99)
    assert top["score"] == 100.0 and top["visibility"] == 25.0      # each part is bounded


def test_beyond_reach_is_not_a_candidate():
    from shapely.geometry import LineString
    line = LineString([(30.0, 50.0), (31.0, 50.0)])
    ctx = ow.Context(UKRAINE, {"countries": ["ru"]}, [("the border", line)], ow.SignalIndex([]))
    near = ow._cand(ctx, "Air bases", "a", "Near", 50.5, 30.5, reach_km=600, visibility=10, what="x")
    far = ow._cand(ctx, "Air bases", "b", "Far", 60.0, 30.5, reach_km=600, visibility=10, what="x")
    assert near is not None and far is None
    assert "km from the border" in near["reason"]


def test_signals_within_25_km_count():
    idx = ow.SignalIndex([{"lat": 50.0, "lon": 30.0, "weight": 3}, {"lat": 50.1, "lon": 30.1, "weight": 1},
                          {"lat": 52.0, "lon": 30.0, "weight": 5}])
    w, n = idx.weight_near(50.0, 30.0)
    assert (w, n) == (4.0, 2)


def test_airbase_filter_by_name_and_country():
    ctx = ow.Context(UKRAINE, {"countries": ["ru", "ua"]}, [], ow.SignalIndex([]))
    rows = [{"ident": "X1", "name": "Millerovo Air Base", "type": "medium_airport", "country_code": "RU",
             "lat": 48.95, "lon": 40.3},
            {"ident": "X2", "name": "Rostov Platov International", "type": "large_airport", "country_code": "RU",
             "lat": 47.49, "lon": 39.92},
            {"ident": "X3", "name": "Ramstein Air Base", "type": "large_airport", "country_code": "DE",
             "lat": 49.4, "lon": 7.6}]
    got = [c["name"] for c in ow.airbase_candidates(ctx, rows)]
    assert got == ["Millerovo Air Base"]


# ── selection: cap, dedupe, updates, declined ────────────────────────────

def test_cap_and_more_available_per_subgroup():
    cands = [_cand("Air bases", f"a{i}", 50 + i * 0.5, 30, 90 - i) for i in range(30)]
    cands += [_cand("Strike targets", f"s{i}", 40 + i * 0.5, 40, 50 - i) for i in range(30)]
    sel = ow.select_proposals(cands, [], cap=10)
    assert len(sel["chosen"]) == 10
    rep = sel["report"]
    assert rep["Air bases"]["proposed"] + rep["Strike targets"]["proposed"] == 10
    assert rep["Strike targets"]["proposed"] >= ow.MIN_PER_SUBGROUP       # never crowded out
    assert rep["Air bases"]["more_available"] == 30 - rep["Air bases"]["proposed"]


def test_dedupe_within_3_km_keeps_the_earlier_subgroup():
    a = _cand("Air bases", "air", 50.0, 30.0, 60)
    h = _cand("Hot right now", "hot", 50.01, 30.01, 95)       # ~1.3 km away, higher score
    far = _cand("Hot right now", "hot2", 51.0, 31.0, 80)
    out = ow.dedupe_candidates([h, a, far])
    keys = {c["key"] for c in out}
    assert keys == {"air", "hot2"}
    assert any("Hot right now" in x for x in next(c for c in out if c["key"] == "air")["also"])


def test_overlap_rule():
    big = ow.box(50.0, 30.0, 8.0)
    inside = ow.box(50.0, 30.03, 3.0)          # 2 km off centre but wholly inside → ≥ 50 % of the smaller
    assert ow.overlap_fraction(big, inside) == pytest.approx(1.0)
    assert ow.same_place(big, inside)
    assert not ow.same_place(ow.box(50.0, 30.0, 4), ow.box(50.0, 30.2, 4))   # ~14 km apart


def test_existing_active_zone_is_already_watched_and_proposal_is_updated():
    c1 = _cand("Air bases", "airport:A", 50.0, 30.0, 80)
    c2 = _cand("Air bases", "airport:B", 52.0, 32.0, 70)
    existing = [{"system_id": "ZONE-001", "status": "active", "bbox": ow.box(50.0, 30.0, 5), "source_key": None},
                {"system_id": "ZONE-002", "status": "proposed", "generated_by": "overwatch",
                 "bbox": ow.box(52.0, 32.0, 6), "source_key": "airport:B"}]
    sel = ow.select_proposals([c1, c2], existing)
    assert [c["key"] for c in sel["chosen"]] == ["airport:B"]
    assert sel["chosen"][0]["update"] == "ZONE-002"
    assert sel["report"]["Air bases"]["already_watched"] == 1


def test_declined_is_not_offered_again():
    sel = ow.select_proposals([_cand("Air bases", "airport:A", 50, 30, 80)], [], declined={"airport:A"})
    assert sel["chosen"] == []


def test_sweep_plan_never_swallows_or_is_swallowed():
    plan = {**_cand("Border sweep", "sweep:ukraine", 51, 30, 100), "bbox": (20.0, 45.0, 40.0, 60.0)}
    site = _cand("Air bases", "airport:A", 50, 30, 80)
    existing_plan = [{"system_id": "ZONE-009", "status": "active", "aoi_class": "sweep_plan",
                      "bbox": (20.0, 45.0, 40.0, 60.0), "source_key": "sweep:other"}]
    sel = ow.select_proposals([plan, site], existing_plan)
    assert {c["key"] for c in sel["chosen"]} == {"sweep:ukraine", "airport:A"}


# ── grouping ─────────────────────────────────────────────────────────────

def test_zone_tree_groups_and_other():
    zones = [{"system_id": "Z1", "metadata": {"group": "Ukraine", "subgroup": "Strike targets"}},
             {"system_id": "Z2", "metadata": {"group": "Ukraine", "subgroup": "Air bases"}},
             {"system_id": "Z3", "metadata": {}},
             {"system_id": "Z4", "metadata": {"group": "Ukraine", "subgroup": "Found by sweep"}}]
    tree = ow.zone_tree(zones)
    assert [g["group"] for g in tree] == ["Ukraine", "Other"]
    assert [s["subgroup"] for s in tree[0]["subgroups"]] == ["Air bases", "Strike targets", "Found by sweep"]
    assert tree[1]["subgroups"][0]["zones"][0]["system_id"] == "Z3"


# ── ids ──────────────────────────────────────────────────────────────────

def test_zone_ids_are_max_plus_one_not_count_plus_one():
    # ZONE-002 deleted: count+1 would have produced ZONE-004 again.
    assert ow.next_zone_ids(["ZONE-001", "ZONE-003", "ZONE-004"], 2) == ["ZONE-005", "ZONE-006"]
    assert ow.next_zone_ids(["ZONE-AB12CD34", None], 1) == ["ZONE-001"]


# ── writing proposals ────────────────────────────────────────────────────

def _zone(db, sid, status="active", owner="u1", enabled=True, meta=None, aoi="custom"):
    b = ow.box(10.0, 10.0, 4)
    db.add(WatchZone(system_id=sid, name=sid, polygon_geojson=json.dumps(ow.bbox_polygon(b)),
                     bbox_min_lon=b[0], bbox_min_lat=b[1], bbox_max_lon=b[2], bbox_max_lat=b[3],
                     status=status, enabled=enabled, owner=owner, aoi_class=aoi,
                     zone_metadata=json.dumps(meta or {}), ml_tasks="[]"))
    db.commit()


def test_proposals_are_owned_unique_and_never_scanned(db):
    _zone(db, "ZONE-001")
    _zone(db, "ZONE-003")
    cands = [_cand("Air bases", "airport:A", 50, 30, 80), _cand("Strike targets", "gppd:B", 52, 32, 70)]
    sel = ow.select_proposals(cands, ow.existing_for(db, "u7"))
    out = ow.apply_selection(db, owner="u7", conflict=UKRAINE, selection=sel, all_keys={"airport:A", "gppd:B"})
    assert out["created"] == ["ZONE-004", "ZONE-005"]
    rows = db.query(WatchZone).filter(WatchZone.system_id.in_(out["created"])).all()
    for z in rows:
        assert z.status == "proposed" and z.enabled is False and z.next_scan_at is None
        assert z.owner == "u7"
        m = json.loads(z.zone_metadata)
        assert m["group"] == "Ukraine" and m["generated_by"] == "overwatch" and m["reason"]
    strike = next(z for z in rows if json.loads(z.zone_metadata)["subgroup"] == "Strike targets")
    assert strike.scan_interval_hours == 72
    air = next(z for z in rows if json.loads(z.zone_metadata)["subgroup"] == "Air bases")
    assert air.scan_interval_hours == 24
    # The scheduler's own query: enabled zones that are due. Proposals are not among them.
    due = db.query(WatchZone).filter(WatchZone.enabled == True).all()   # noqa: E712
    assert not any(z.status == "proposed" for z in due)


def test_rerun_updates_instead_of_duplicating(db):
    cands = [_cand("Air bases", "airport:A", 50, 30, 80)]
    for _ in range(3):
        sel = ow.select_proposals(cands, ow.existing_for(db, "u1"))
        ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={"airport:A"})
    assert db.query(WatchZone).count() == 1


def test_stale_dynamic_proposals_are_pruned(db):
    sel = ow.select_proposals([_cand("Front hotspots", "front:1", 48, 37, 90)], [])
    ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={"front:1"})
    sel = ow.select_proposals([_cand("Front hotspots", "front:2", 47, 36, 90)], ow.existing_for(db, "u1"))
    out = ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={"front:2"})
    assert len(out["pruned"]) == 1
    keys = [json.loads(z.zone_metadata)["source_key"] for z in db.query(WatchZone).all()]
    assert keys == ["front:2"]


def test_accept_and_decline(db):
    cands = [_cand("Air bases", "airport:A", 50, 30, 80), _cand("Strike targets", "gppd:B", 52, 32, 70),
             {**_cand("Border sweep", "sweep:ukraine", 51, 30, 100), "bbox": (25.0, 48.0, 35.0, 53.0)}]
    sel = ow.select_proposals(cands, [])
    ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={c["key"] for c in cands})
    other = ow.proposals_query(db, "someone-else", conflict="ukraine")
    assert other == []                                     # personal
    air = ow.proposals_query(db, "u1", subgroup="Air bases")
    res = ow.accept(db, "u1", air)
    z = db.query(WatchZone).filter(WatchZone.system_id == res["activated"][0]).first()
    assert z.enabled is True and z.status == "active" and z.next_scan_at is not None
    plan = ow.proposals_query(db, "u1", subgroup="Border sweep")
    res = ow.accept(db, "u1", plan)
    assert res["sweeps"] and res["activated"] == []
    p = db.query(WatchZone).filter(WatchZone.aoi_class == "sweep_plan").first()
    assert p.enabled is False                              # the plan itself is never scanned
    res = ow.decline(db, "u1", ow.proposals_query(db, "u1", conflict="ukraine"))
    assert len(res["declined"]) == 1
    assert ow.declined_keys(db, "u1", "ukraine") == {"gppd:B"}


def test_undo_decline_does_not_remember(db):
    sel = ow.select_proposals([_cand("Air bases", "airport:A", 50, 30, 80)], [])
    ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={"airport:A"})
    ow.decline(db, "u1", ow.proposals_query(db, "u1", conflict="ukraine"), remember=False)
    assert ow.declined_keys(db, "u1", "ukraine") == set()


# ── conflicts ────────────────────────────────────────────────────────────

def test_resolve_conflict_aliases():
    cs = [UKRAINE, {"id": "sudan", "name": "Sudan civil war", "countries": ["sd"]}]
    for said in ("ukraine", "Ukraine war", "the war in Ukraine", "Russia–Ukraine war", "russia-ukraine"):
        assert ow.resolve_conflict(said, cs)["id"] == "ukraine", said
    assert ow.resolve_conflict("sudan civil war", cs)["id"] == "sudan"
    assert ow.resolve_conflict("atlantis", cs) is None


def test_ukraine_theatre_bands_and_tiles():
    th = ow.theatre_for(UKRAINE)
    assert {"by", "md"} <= set(th["countries"])
    assert {b["stager"] + ">" + b["facing"] for b in th["sweep_bands"]} == {"by>ua", "ru>ua", "ru>ee", "ru>lv"}
    tiles = ow.plan_sweep_tiles(th)
    assert tiles and len({t["tile_id"] for t in tiles}) == len(tiles)
    by = [t for t in tiles if t["band"] == "by>ua"]
    assert by and all(ow.SWEEP_BAND_MIN_KM <= t["border_km"] <= ow.SWEEP_BAND_MAX_KM + 25 for t in by)
    assert all(t["lat"] >= 49.8 for t in tiles if t["band"] == "ru>ua")
    w, s, e, n = tiles[0]["bbox"]
    assert abs((n - s) * ow.KM_PER_DEG - ow.SWEEP_TILE_KM) < 0.5


# ── the sweep decision ───────────────────────────────────────────────────

def _region(lat, lon, pixels, t, direction="appeared"):
    return {"centroid_lat": lat, "centroid_lon": lon, "pixels": pixels, "t_peak": t if direction == "appeared" else -t,
            "change_direction": direction}


def _job(dets, **kw):
    return {"status": "completed", "detections": dets, "m_per_px": 20.0, "stack_before": 3, "stack_after": 3,
            "changed_fraction": 0.01, "suspect_wholesale_shift": False, **kw}


def test_sweep_keeps_a_new_scatterer_cluster():
    # three ~1-1.6 ha bright regions within a kilometre: a vehicle/tent cluster
    dets = [_region(52.00, 29.00, 30, 4.5), _region(52.004, 29.004, 40, 3.6), _region(52.002, 29.008, 25, 3.2)]
    v = ow.evaluate_sweep_result(_job(dets))
    assert v["result"] == "found" and v["keep"] is True
    assert v["findings"][0]["kind"] == "new tent/vehicle cluster"
    assert "look alike" in v["summary"]        # never claims to identify a field hospital


def test_sweep_deletes_when_nothing_qualifies():
    dets = [_region(52.0, 29.0, 26, 2.0), _region(52.1, 29.1, 10, 6.0),        # weak; too small
            _region(52.15, 29.15, 50, 5.0),                                     # one 2 ha region, not strong
            _region(52.3, 29.3, 600, 30.0),                                     # 24 ha in one piece: a field
            _region(52.2, 29.2, 80, 4.0, "removed")]                            # darkening below the cleared bar
    v = ow.evaluate_sweep_result(_job(dets))
    assert v["result"] == "clean" and v["keep"] is False


def test_sweep_wholesale_shift_and_widespread_are_inconclusive():
    assert ow.evaluate_sweep_result(_job([], suspect_wholesale_shift=True))["result"] == "inconclusive"
    many = [_region(50 + i * 0.05, 30, 100, 9.0) for i in range(ow.WIDESPREAD_CLUSTERS + 3)]
    v = ow.evaluate_sweep_result(_job(many))
    assert v["result"] == "inconclusive" and v["keep"] is False


def test_sweep_no_data_and_large_clearing():
    v = ow.evaluate_sweep_result({"status": "error", "error": "no Sentinel-1 acquisitions catalogued",
                                  "recoverable": True})
    assert v["result"] == "no_data" and not v["keep"]
    big_clear = [_region(52.0, 29.0, 400, 6.0, "removed")]                     # 16 ha, strong
    v = ow.evaluate_sweep_result(_job(big_clear))
    assert v["result"] == "found" and v["findings"][0]["kind"] == "new cleared/disturbed ground"


def test_sweep_title_names_country_distance_and_town():
    from shapely.geometry import LineString
    border = LineString([(28.0, 51.5), (31.0, 51.5)])
    tile = {"stager": "by", "border_km": 40}
    places = [{"kind": "town", "name": "Mozyr", "lat": 52.05, "lon": 29.25}]
    t = ow.sweep_finding_title({"kind": "new tent/vehicle cluster", "lat": 51.8, "lon": 29.2}, tile, places, border)
    assert t.startswith("Possible new vehicle or tent concentration 33 km inside Belarus near Mozyr")
    assert t.endswith("found by sweep")


# ── the sweep log ────────────────────────────────────────────────────────

def test_sweep_log_prevents_re_sweep(db):
    now = dt.datetime(2026, 10, 11, 12)
    s = ow.start_sweep(db, "u1", "ukraine", ["T1_1", "T1_2", "T1_3"])
    tile = {"tile_id": "T1_1", "band": "by>ua", "bbox": (29.0, 51.0, 29.3, 51.2)}
    ow.record_tile(db, s, tile, {"result": "clean", "summary": "nothing new"}, None, now=now)
    ow.record_tile(db, s, {**tile, "tile_id": "T1_2"}, {"result": "no_data", "summary": "x"}, None, now=now)
    log = ow.sweep_log(db, conflict_id="ukraine", owner="u1")
    order = ["T1_1", "T1_2", "T1_3"]
    assert ow.next_tiles(order, log, now + dt.timedelta(hours=1), n=3) == ["T1_3"]
    # a failed look is retried sooner than a clean one
    assert ow.next_tiles(order, log, now + dt.timedelta(days=4), n=3) == ["T1_2", "T1_3"]
    assert ow.next_tiles(order, log, now + dt.timedelta(days=15), n=3) == order
    st = ow.sweep_status(db, s)
    assert st["status"] == "running" and st["tiles_total"] == 3 and st["results"] == {"clean": 1, "no_data": 1}


def test_sweep_order_puts_suspicious_tiles_first():
    tiles = [{"tile_id": "A", "lat": 50.0, "lon": 30.0, "border_km": 30},
             {"tile_id": "B", "lat": 51.0, "lon": 30.0, "border_km": 100},
             {"tile_id": "C", "lat": 52.0, "lon": 30.0, "border_km": 20}]
    sig = ow.SignalIndex([{"lat": 51.0, "lon": 30.0, "weight": 3}])
    assert [t["tile_id"] for t in ow.order_tiles(tiles, sig)] == ["B", "C", "A"]


def test_scan_budget_defers_the_rest():
    now, later = ow.scan_budget(list(range(20)), 12)
    assert now == list(range(12)) and later == list(range(12, 20))


def test_sweep_ignores_cropland_water_and_needs_landcover():
    dets = [{**_region(52.00, 29.00, 30, 9.5), "landcover": 40}, {**_region(52.004, 29.004, 40, 9.0), "landcover": 40},
            {**_region(52.002, 29.008, 25, 9.0), "landcover": 80}]
    v = ow.evaluate_sweep_result(_job(dets, landcover_available=True))
    assert v["result"] == "clean" and "on cropland" in v["summary"]
    on_grass = [{**d, "landcover": 30} for d in dets]
    v = ow.evaluate_sweep_result(_job(on_grass, landcover_available=True))
    assert v["result"] == "found" and v["findings"][0]["landcover"] == "grassland"
    v = ow.evaluate_sweep_result(_job(on_grass, landcover_available=False))
    assert v["result"] == "inconclusive" and not v["keep"]


def test_annotate_landcover_majority_class():
    import numpy as np
    cls = np.full((10, 10), 40, dtype=np.uint8)
    cls[0:5, 0:5] = 10
    out = {"detections": [{"bbox_px": [0, 0, 3, 3]}, {"bbox_px": [6, 6, 9, 9]}]}
    ow.annotate_landcover(out, cls)
    assert [d["landcover"] for d in out["detections"]] == [10, 40]
    assert ow.annotate_landcover({"detections": []}, None)["landcover_available"] is False


def test_ground_bases_only_on_a_sides_territory():
    from shapely.geometry import LineString
    th = ow.theatre_for(UKRAINE)
    border = LineString([(28.0, 48.0), (29.0, 47.0)])
    ctx = ow.Context(UKRAINE, th, [("the Ukraine–Moldova border", border)], ow.SignalIndex([]))
    osm = [{"kind": "military", "military": "training_area", "name": "Range in Ukraine", "lat": 47.9, "lon": 28.9, "osm": "way/1"},
           {"kind": "military", "military": "training_area", "name": "Range in Romania", "lat": 47.6, "lon": 27.0, "osm": "way/2"},
           {"kind": "military", "military": "office", "name": "HQ office", "lat": 47.9, "lon": 28.95, "osm": "way/3"},
           {"kind": "military", "military": "", "name": "Колишній полігон", "lat": 47.85, "lon": 28.9, "osm": "way/4"}]
    assert [c["name"] for c in ow.ground_base_candidates(ctx, osm)] == ["Range in Ukraine"]


# ── what each zone is scanned for (2026-10-11: "we detect nothing") ──────

def test_generated_zones_get_tasks_per_subgroup(db):
    cands = [_cand("Air bases", "airport:A", 50, 30, 80), _cand("Strike targets", "gppd:B", 52, 32, 70),
             _cand("Naval & ports", "port:C", 46, 31, 60),
             {**_cand("Border sweep", "sweep:ukraine", 51, 30, 100), "bbox": (25.0, 48.0, 35.0, 53.0)}]
    sel = ow.select_proposals(cands, [])
    ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={c["key"] for c in cands})
    by_sub = {json.loads(z.zone_metadata)["subgroup"]: json.loads(z.ml_tasks) for z in db.query(WatchZone).all()}
    assert "radar_change" in by_sub["Air bases"] and "object_detection" in by_sub["Air bases"]
    assert "radar_change" in by_sub["Strike targets"]
    assert "ship_detection" in by_sub["Naval & ports"]
    assert by_sub["Border sweep"] == []                    # the plan is swept, never scanned


def test_backfill_touches_only_empty_overwatch_zones(db):
    sel = ow.select_proposals([_cand("Front hotspots", "front:1", 48, 37, 70)], [])
    ow.apply_selection(db, owner="u1", conflict=UKRAINE, selection=sel, all_keys={"front:1"})
    z = db.query(WatchZone).first()
    z.ml_tasks = "[]"                                       # as the zones in production were made
    db.add(WatchZone(system_id="ZONE-900", name="Hand drawn", polygon_geojson="{}", bbox_min_lon=0, bbox_min_lat=0,
                     bbox_max_lon=1, bbox_max_lat=1, ml_tasks="[]", zone_metadata="{}"))
    db.add(WatchZone(system_id="ZONE-901", name="Own tasks", polygon_geojson="{}", bbox_min_lon=0, bbox_min_lat=0,
                     bbox_max_lon=1, bbox_max_lat=1, ml_tasks='["ship_detection"]',
                     zone_metadata=json.dumps({"generated_by": "overwatch", "subgroup": "Air bases"})))
    db.commit()
    changed = ow.backfill_tasks(db)
    assert changed == [z.system_id]
    assert "radar_change" in json.loads(db.query(WatchZone).filter_by(system_id=z.system_id).first().ml_tasks)
    assert db.query(WatchZone).filter_by(system_id="ZONE-900").first().ml_tasks == "[]"
    assert json.loads(db.query(WatchZone).filter_by(system_id="ZONE-901").first().ml_tasks) == ["ship_detection"]
    assert ow.backfill_tasks(db) == []                      # idempotent
