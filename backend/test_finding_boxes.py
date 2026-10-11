"""Every automatic finding carries a box on the ground (finding_boxes.py),
the sweep keeps its cluster's real extent (overwatch.py), and radar change
regions keep theirs (zone_change.py)."""
import finding_boxes as fb
import overwatch as ow
import zone_change as zc

BOUNDS = {"west": 30.0, "south": 50.0, "east": 30.2, "north": 50.1}


def test_fraction_to_degrees_and_back():
    box = fb.frac_to_geo([0.25, 0.5, 0.1, 0.2], BOUNDS)
    assert box == [30.05, 50.03, 30.07, 50.05]                  # y runs down from the north edge
    assert fb.geo_to_frac(box, BOUNDS) == [0.25, 0.5, 0.1, 0.2]
    assert fb.frac_to_geo([0, 0, 1, 1], {"min_lon": 1, "min_lat": 2, "max_lon": 3, "max_lat": 4}) == [1, 2, 3, 4]


def test_area_box_is_the_area_and_says_it_is_an_estimate():
    b = fb.area_box(50.0, 30.0, 10_000)
    w, h = fb.box_size_m(b)
    assert abs(w - 100) < 1 and abs(h - 100) < 1
    f = fb.sweep_finding({"kind": "new tent/vehicle cluster", "lat": 50.0, "lon": 30.0, "appeared_m2": 40_000,
                          "cleared_m2": 0}, 0, zone_id="ZONE-9")
    assert f["box_source"] == "area_estimate" and f["label"] == "Possible tent or vehicle group" and f["tone"] == "red"
    assert f["polygon"]["coordinates"][0][0] == [f["box"][0], f["box"][1]] and f["size"] == "4.0 ha"


def _region(lat, lon, pixels, t, frac, direction="appeared"):
    return {"centroid_lat": lat, "centroid_lon": lon, "pixels": pixels, "t_peak": t if direction == "appeared" else -t,
            "change_direction": direction, "bbox": frac}


def test_sweep_finding_keeps_the_union_of_its_regions_pixel_extents():
    dets = [_region(50.05, 30.05, 30, 4.5, [0.24, 0.48, 0.02, 0.02]),
            _region(50.052, 30.054, 40, 3.6, [0.26, 0.46, 0.03, 0.02]),
            _region(50.051, 30.058, 25, 3.2, [0.28, 0.47, 0.01, 0.03])]
    v = ow.evaluate_sweep_result({"status": "completed", "detections": dets, "m_per_px": 20.0, "changed_fraction": 0.01,
                                  "bounds": BOUNDS})
    f = v["findings"][0]
    assert f["box_source"] == "pixel_extent"
    assert f["box"] == fb.union([fb.frac_to_geo(d["bbox"], BOUNDS) for d in dets])
    # without the scene's bounds (an old result) it falls back, and says so
    v2 = ow.evaluate_sweep_result({"status": "completed", "detections": dets, "m_per_px": 20.0, "changed_fraction": 0.01})
    assert v2["findings"][0]["box_source"] == "area_estimate"


def test_backfill_rebuilds_an_old_sweep_finding_from_its_stored_regions():
    dets = [_region(50.05, 30.05, 30, 4.5, [0.24, 0.48, 0.02, 0.02]),
            _region(50.052, 30.054, 40, 3.6, [0.26, 0.46, 0.03, 0.02]),
            _region(50.051, 30.058, 25, 3.2, [0.28, 0.47, 0.01, 0.03]),
            _region(50.09, 30.19, 40, 9.0, [0.9, 0.05, 0.02, 0.02])]           # another cluster, far away
    old = {"kind": "new tent/vehicle cluster", "lat": 50.051, "lon": 30.054, "appeared_m2": 38_000, "cleared_m2": 0}
    members = ow.sweep_finding_regions(old, dets, 20.0)
    assert len(members) == 3
    box, src = fb.cluster_extent(members, BOUNDS)
    f = fb.sweep_finding(old, 0, regions_box=box)
    assert src == "pixel_extent" and f["box_source"] == "regions" and f["box"] == box
    assert ow.sweep_finding_regions({**old, "lat": 50.5}, dets, 20.0) == []    # nothing near: no made-up box


def test_radar_change_summary_carries_boxes():
    out = {"status": "completed", "bounds": BOUNDS, "m_per_px": 10.0, "changed_fraction": 0.01,
           "detections": [{"centroid_lat": 50.05, "centroid_lon": 30.1, "pixels": 80, "area_m2": 8000, "t_peak": 6.0,
                           "change_direction": "appeared", "bbox": [0.5, 0.5, 0.05, 0.04]}],
           "dates_before": ["2026-09-01"], "dates_after": ["2026-10-10"]}
    block = zc.summarize(out, None)
    assert block["where"][0]["box"] == fb.frac_to_geo([0.5, 0.5, 0.05, 0.04], BOUNDS)
    f = fb.radar_change_finding({**block["where"][0], "centroid_lat": 50.05, "centroid_lon": 30.1,
                                 "geo_box": block["where"][0]["box"]}, None, zone_id="ZONE-5", date="2026-10-10")
    assert f["box_source"] == "pixel_extent" and f["tone"] == "red" and f["date"] == "2026-10-10"


def test_object_finding_uses_the_detector_outline():
    det = {"detection_id": "D1", "centroid_lat": 25.36, "centroid_lon": 56.368, "object_type": "vessel",
           "geo_geometry": {"type": "Polygon", "coordinates": [[[56.3676, 25.36], [56.3697, 25.3569], [56.3692, 25.3566],
                                                                [56.3672, 25.3599], [56.3676, 25.36]]]},
           "attributes": {"change_type": "new"}, "instrument": "OPTICAL"}
    f = fb.object_finding(det, zone_id="ZONE-1")
    assert f["box"] == [56.3672, 25.3566, 56.3697, 25.36] and f["box_source"] == "detector_outline"
    assert f["label"] == "New vessel" and f["tone"] == "red"


def test_crop_window_frames_the_box():
    zone = [30.0, 50.0, 30.2, 50.1]
    box = fb.frac_to_geo([0.5, 0.5, 0.02, 0.02], zone)
    win = fb.crop_window(box, zone, 1000, 500)
    assert win["x0"] < 500 < 520 < win["x1"] and win["y0"] < 250 < 260 < win["y1"]
    bx = win["box"]
    assert abs(win["x0"] + bx[0] * (win["x1"] - win["x0"]) - 500) < 1
    assert fb.crop_window([31, 51, 31.1, 51.1], zone, 1000, 500) is None        # off the frame


# ── the database side: findings of a zone, derived on read ────────────────
import datetime as dt
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import zone_findings
from database import SentinelDetection, SentinelScan, WatchZone


@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    for t in (WatchZone, SentinelScan, SentinelDetection):
        t.__table__.create(eng)
    s = sessionmaker(bind=eng)()
    yield s
    s.close()


def _zone(db, sid, meta):
    z = WatchZone(system_id=sid, name=sid, polygon_geojson="{}", bbox_min_lon=30.0, bbox_min_lat=50.0,
                  bbox_max_lon=30.2, bbox_max_lat=50.1, priority="high", scan_interval_hours=24, enabled=True,
                  created_at=dt.datetime.utcnow(), ml_tasks="[]", alert_threshold="both",
                  zone_metadata=json.dumps(meta), aoi_class="border")
    db.add(z)
    db.flush()
    return z


def _chg(db, z, scan_id, regions, verdict, when, bounds=None):
    summ = {"method": "PWTT", "m_per_px": 20.0, "change": {"verdict": verdict, "until": when[:10]}}
    if bounds:
        summ["bounds"] = bounds
    db.add(SentinelScan(scan_id=scan_id, zone_id=z.id, triggered_by="change-detect", status="completed",
                        created_at=dt.datetime.fromisoformat(when), instrument="SAR", result_summary=json.dumps(summ)))
    for i, r in enumerate(regions):
        db.add(SentinelDetection(detection_id=f"{scan_id}-{i}", scan_id=scan_id, zone_id=z.id, instrument="SAR",
                                 object_type="structural_change", confidence=0.8, centroid_lat=r["centroid_lat"],
                                 centroid_lon=r["centroid_lon"], area_m2=r["pixels"] * 400.0,
                                 attributes=json.dumps({"change_direction": r["change_direction"], "t_peak": r["t_peak"],
                                                        "pixels": r["pixels"], "bbox": r["bbox"]})))
    db.flush()


def test_an_old_sweep_find_gets_its_box_from_the_stored_regions(db):
    dets = [_region(50.05, 30.05, 30, 4.5, [0.24, 0.48, 0.02, 0.02]),
            _region(50.052, 30.054, 40, 3.6, [0.26, 0.46, 0.03, 0.02]),
            _region(50.051, 30.058, 25, 3.2, [0.28, 0.47, 0.01, 0.03])]
    # written before findings kept a box: centroid and areas only
    meta = {"findings": [{"kind": "new tent/vehicle cluster", "lat": 50.051, "lon": 30.054, "appeared_m2": 38000,
                          "cleared_m2": 0, "regions": 3}], "sweep_scan_id": "SW1", "found_at": "2026-10-11T08:00:00"}
    z = _zone(db, "ZONE-77", meta)
    _chg(db, z, "SW1", dets, "changed", "2026-10-11T08:00:00")
    out = zone_findings.zone_findings(db, z, days=3650)
    assert out["counts"] == {"sweep_find": 1, "radar_change": 0, "object": 0}     # the sweep's regions are not repeated
    f = out["findings"][0]
    assert f["box_source"] == "regions" and f["label"] == "Possible tent or vehicle group"
    assert f["box"] == fb.union([fb.frac_to_geo(d["bbox"], (30.0, 50.0, 30.2, 50.1)) for d in dets])
    assert f["date"] == "2026-10-11" and f["zone_id"] == "ZONE-77"


def test_radar_change_lists_only_the_new_significant_regions(db):
    z = _zone(db, "ZONE-5", {})
    strong = _region(50.05, 30.1, 20, 6.0, [0.5, 0.5, 0.05, 0.04])            # 8,000 m² at 20 m/px, |t| 6
    weak = _region(50.02, 30.02, 20, 2.0, [0.1, 0.8, 0.02, 0.02])
    _chg(db, z, "C1", [strong, weak], "changed", "2026-10-01T00:00:00", bounds=BOUNDS)
    _chg(db, z, "C2", [strong], "no_change", "2026-10-07T00:00:00", bounds=BOUNDS)   # the same change again
    out = zone_findings.zone_findings(db, z, days=3650)
    assert [f["scan_id"] for f in out["findings"]] == ["C1"]
    f = out["findings"][0]
    assert f["kind"] == "radar_change" and f["box_source"] == "pixel_extent"
    assert f["box"] == fb.frac_to_geo([0.5, 0.5, 0.05, 0.04], BOUNDS)
    assert zone_findings.zone_findings(db, z, scan_id="C2", days=3650)["findings"] == []
