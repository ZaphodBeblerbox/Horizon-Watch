"""
test_sentinel_tiles.py — the tiling has to deliver the resolution it claims,
and say so plainly when it cannot.

The defect being fixed: a whole AOI was rendered into one image of at most
2048px, so ZONE-001 (199 x 111 km) arrived at 97 m/px and a 100m vessel was
a single pixel. The detector was never shown the data.

    cd backend && python3 -m pytest test_sentinel_tiles.py -q
"""
import math

import pytest

import sentinel_tiles as st

# The real zone from the database that motivated all of this.
ZONE_001 = {"west": 55.5, "south": 26.0, "east": 57.5, "north": 27.0}
SMALL_AOI = {"west": 56.34, "south": 25.31, "east": 56.40, "north": 25.36}
MEDIUM_AOI = {"west": 56.2, "south": 25.2, "east": 56.5, "north": 25.5}


def test_small_aoi_is_a_single_native_resolution_tile():
    plan = st.plan_tiles(SMALL_AOI)
    assert plan.refused is None
    assert plan.count == 1
    assert plan.tiles[0].m_per_px == pytest.approx(10.0, rel=0.05)


def test_the_zone_that_collapsed_to_97m_is_transformed_at_the_default_budget():
    """The headline regression. One thumbnail gave ZONE-001 97 m/px.

    At the DEFAULT budget the grid gives 18.2 m/px — a 5.3x improvement, not
    native, because covering 199 x 111 km at 10 m/px needs 60 separate API
    requests and the default deliberately does not spend that unasked. What
    matters is that the trade is recorded rather than hidden."""
    plan = st.plan_tiles(ZONE_001)
    assert plan.refused is None, plan.refused
    assert plan.count > 1, "a 199km zone cannot be one native-resolution tile"
    worst = max(t.m_per_px for t in plan.tiles)
    assert worst < 25.0, f"worst tile is {worst:.1f} m/px — barely better than the 97 m/px it replaced"
    assert worst < 97.0 / 3, "improvement is too small to change what is detectable"
    assert plan.degraded_to_m_per_px is not None, (
        "coarsened below native without recording it — the exact dishonesty "
        "the single-image path was guilty of"
    )


def test_native_resolution_is_reachable_when_the_budget_allows_it():
    """The ceiling is quota, not capability: given the requests, the grid
    delivers the sensor's own resolution."""
    plan = st.plan_tiles(ZONE_001, max_tiles=60)
    assert plan.refused is None
    assert plan.degraded_to_m_per_px is None, "still degraded despite an adequate budget"
    assert max(t.m_per_px for t in plan.tiles) == pytest.approx(10.0, rel=0.05)


def test_a_100m_ship_stops_being_a_single_pixel():
    """State the win in the units that decide whether detection is possible
    at all. One pixel is not a detection problem, it is an absence of data."""
    old_m_per_px = 97.0                     # measured from the single-image path
    assert 100 / old_m_per_px < 1.5         # was ~1 pixel: undetectable by anything

    default_px = 100 / max(t.m_per_px for t in st.plan_tiles(ZONE_001).tiles)
    assert default_px > 5                   # 5.5px: detectable

    native_px = 100 / max(t.m_per_px for t in st.plan_tiles(ZONE_001, max_tiles=60).tiles)
    assert native_px == pytest.approx(10.0, rel=0.05)


def test_no_tile_exceeds_the_api_request_ceiling():
    """A request above 2500px a side is refused outright by Sentinel Hub, so
    a plan that produces one is a plan that cannot run."""
    for aoi in (SMALL_AOI, MEDIUM_AOI, ZONE_001):
        for t in st.plan_tiles(aoi).tiles:
            assert t.width_px <= st.MAX_REQUEST_PX
            assert t.height_px <= st.MAX_REQUEST_PX
            assert t.width_px >= 32 and t.height_px >= 32


def test_tiles_cover_the_whole_aoi_with_no_gaps():
    """A gap is worse than a coarse image: it renders part of the AOI as
    'nothing detected' when it was never looked at."""
    plan = st.plan_tiles(MEDIUM_AOI)
    assert plan.refused is None
    west = min(t.west for t in plan.tiles)
    east = max(t.east for t in plan.tiles)
    south = min(t.south for t in plan.tiles)
    north = max(t.north for t in plan.tiles)
    assert west == pytest.approx(MEDIUM_AOI["west"])
    assert east == pytest.approx(MEDIUM_AOI["east"])
    assert south == pytest.approx(MEDIUM_AOI["south"])
    assert north == pytest.approx(MEDIUM_AOI["north"])
    assert plan.count == plan.cols * plan.rows


def test_tiles_do_not_overlap():
    plan = st.plan_tiles(MEDIUM_AOI)
    seen = {(t.ix, t.iy) for t in plan.tiles}
    assert len(seen) == plan.count
    row0 = sorted([t for t in plan.tiles if t.iy == 0], key=lambda t: t.ix)
    for a, b in zip(row0, row0[1:]):
        assert a.east == pytest.approx(b.west), "columns must abut exactly"


def test_an_unaffordable_area_degrades_deliberately_and_says_so():
    """The old behaviour silently produced a thumbnail and reported findings
    as though resolution were fine. Trading resolution is acceptable; hiding
    that it was traded is not."""
    huge = {"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0}
    plan = st.plan_tiles(huge, max_tiles=24)
    if plan.refused is None:
        assert plan.degraded_to_m_per_px is not None, (
            "coarsened the scan without recording that it did"
        )
        assert plan.degraded_to_m_per_px > st.NATIVE_M_PER_PX
        assert plan.count <= 24
    else:
        assert "km²" in plan.refused


def test_refusal_carries_the_numbers_when_degrading_is_not_allowed():
    huge = {"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0}
    plan = st.plan_tiles(huge, max_tiles=4, allow_degrade=False)
    assert plan.refused
    assert "tiles" in plan.refused and "budget" in plan.refused


def test_budget_is_never_exceeded():
    for max_tiles in (1, 4, 12, 24):
        plan = st.plan_tiles(ZONE_001, max_tiles=max_tiles)
        if plan.refused is None:
            assert plan.count <= max_tiles


def test_inverted_or_empty_bounds_are_refused_not_guessed():
    assert st.plan_tiles({"west": 10, "south": 10, "east": 10, "north": 20}).refused
    assert st.plan_tiles({"west": 20, "south": 10, "east": 10, "north": 20}).refused


# ── seam de-duplication ───────────────────────────────────────────────────

def _det(lat, lon, conf, kind="vessel"):
    return {"centroid_lat": lat, "centroid_lon": lon,
            "confidence": conf, "object_type": kind}


def test_the_same_ship_seen_in_two_tiles_becomes_one_detection():
    """An object on a seam is imaged twice. Reporting it twice would inflate
    every count and manufacture a change between scans."""
    merged = st.merge_detections([_det(25.30, 56.37, 0.7), _det(25.30004, 56.37002, 0.9)])
    assert len(merged) == 1
    assert merged[0]["confidence"] == 0.9, "the better observation must survive"
    assert merged[0]["merged_count"] == 2


def test_two_genuinely_different_ships_are_both_kept():
    far = st.merge_detections([_det(25.30, 56.37, 0.8), _det(25.35, 56.42, 0.8)])
    assert len(far) == 2


def test_different_object_types_at_one_place_are_two_findings():
    """A vessel moored at a storage tank is two things, not one seen twice."""
    out = st.merge_detections([_det(25.30, 56.37, 0.8, "vessel"),
                               _det(25.30, 56.37, 0.8, "storage-tank")])
    assert len(out) == 2


def test_merge_is_stable_across_runs():
    """Unstable ordering would make change detection report churn between two
    identical scans."""
    dets = [_det(25.30, 56.37, 0.8), _det(25.40, 56.40, 0.8), _det(25.50, 56.50, 0.8)]
    a = [(d["centroid_lat"], d["centroid_lon"]) for d in st.merge_detections(list(dets))]
    b = [(d["centroid_lat"], d["centroid_lon"]) for d in st.merge_detections(list(reversed(dets)))]
    assert sorted(a) == sorted(b)
    assert a == [(d["centroid_lat"], d["centroid_lon"]) for d in st.merge_detections(list(dets))]


def test_detections_without_coordinates_are_kept_not_dropped():
    """Dropping an un-geolocated detection would silently lose a real finding."""
    out = st.merge_detections([{"confidence": 0.9, "object_type": "vessel"}])
    assert len(out) == 1


def test_empty_input_is_empty_output():
    assert st.merge_detections([]) == []


# ── running a plan ────────────────────────────────────────────────────────

import asyncio


def _run(coro):
    return asyncio.run(coro)


def _plan2():
    """A deterministic 2-tile plan."""
    return st.plan_tiles({"west": 56.0, "south": 25.0, "east": 56.4, "north": 25.2},
                         max_tiles=24)


def test_a_tiled_scan_collects_detections_from_every_tile():
    plan = _plan2()

    async def fetch(tile):
        return {"image": f"img-{tile.ix}-{tile.iy}"}

    async def detect(image, bbox):
        return [{"centroid_lat": bbox["min_lat"] + 0.001,
                 "centroid_lon": bbox["min_lon"] + 0.001,
                 "confidence": 0.8, "object_type": "vessel"}]

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["status"] == "completed"
    assert out["tiles_ok"] == plan.count
    assert len(out["detections"]) == plan.count
    assert out["coverage_fraction"] == 1.0


def test_a_failed_tile_is_reported_not_silently_skipped():
    """'No detections there' and 'never looked there' must not render the
    same. This project has been bitten by that conflation repeatedly."""
    plan = _plan2()
    assert plan.count >= 2

    async def fetch(tile):
        if tile.ix == 0:
            return {"error": "Copernicus 502"}
        return {"image": "ok"}

    async def detect(image, bbox):
        return []

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["tiles_failed"], "a failed tile vanished from the report"
    assert out["coverage_fraction"] < 1.0
    assert any(f["reason"] == "Copernicus 502" for f in out["tiles_failed"])


def test_a_raising_fetch_is_caught_and_recorded():
    """A background imagery loop that swallows an exception disables a whole
    feature silently — so the exception must become a recorded tile failure,
    never an abandoned scan."""
    plan = _plan2()

    async def fetch(tile):
        raise ConnectionError("network gone")

    async def detect(image, bbox):
        return []

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["status"] == "error"
    assert out["tiles_ok"] == 0
    assert all("ConnectionError" in f["reason"] for f in out["tiles_failed"])


def test_a_detector_failure_on_one_tile_does_not_lose_the_others():
    plan = _plan2()

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        if bbox["min_lon"] < 56.2:
            raise RuntimeError("ONNX blew up")
        return [{"centroid_lat": 25.1, "centroid_lon": 56.3,
                 "confidence": 0.9, "object_type": "vessel"}]

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["tiles_ok"] >= 1
    assert len(out["detections"]) >= 1
    assert any("ONNX blew up" in f["reason"] for f in out["tiles_failed"])


def test_duplicates_across_a_seam_are_merged_in_the_scan_result():
    plan = _plan2()

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        # Every tile reports the same object at the same place.
        return [{"centroid_lat": 25.1, "centroid_lon": 56.2,
                 "confidence": 0.8, "object_type": "vessel"}]

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["raw_detection_count"] == plan.count
    assert len(out["detections"]) == 1, "the seam duplicate survived into the result"


def test_each_detection_records_which_tile_saw_it():
    """Needed to draw the scan's own coverage and to explain a finding."""
    plan = _plan2()

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        return [{"centroid_lat": bbox["min_lat"], "centroid_lon": bbox["min_lon"],
                 "confidence": 0.8, "object_type": "vessel"}]

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert all("tile" in d for d in out["detections"])


def test_a_refused_plan_never_pretends_to_scan():
    plan = st.plan_tiles({"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0},
                         max_tiles=2, allow_degrade=False)
    assert plan.refused

    async def fetch(tile):
        raise AssertionError("fetched despite a refused plan")

    async def detect(image, bbox):
        raise AssertionError("detected despite a refused plan")

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["status"] == "error"
    assert out["detections"] == []


def test_the_result_states_the_resolution_it_actually_achieved():
    """The UI has to be able to say 'scanned at 18 m/px, not native'."""
    plan = st.plan_tiles(ZONE_001)

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        return []

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["m_per_px"] > 0
    assert out["degraded"] is True
