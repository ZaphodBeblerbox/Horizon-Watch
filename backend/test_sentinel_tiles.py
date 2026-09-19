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


def test_the_zone_that_collapsed_to_97m_now_scans_at_native_resolution():
    """The headline regression. One thumbnail gave ZONE-001 97 m/px.

    By explicit product decision there is no tile cap: a large area takes
    longer rather than arriving blurred. So the default must be NATIVE, not
    a compromise."""
    plan = st.plan_tiles(ZONE_001)
    assert plan.refused is None, plan.refused
    assert plan.count > 1, "a 199km zone cannot be one native-resolution tile"
    assert plan.degraded_to_m_per_px is None, "coarsened the scan despite no cap"
    assert max(t.m_per_px for t in plan.tiles) == pytest.approx(10.0, rel=0.05)


def test_a_large_area_is_never_silently_capped():
    """A cap trades away the one thing the scan exists to produce. Whatever
    the size, the answer is more tiles and more time — not less resolution."""
    huge = {"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0}
    plan = st.plan_tiles(huge)
    assert plan.refused is None, "refused an area instead of taking longer over it"
    assert plan.degraded_to_m_per_px is None
    assert plan.count > 1000, "suspiciously few tiles for 1.1M km²"
    assert max(t.m_per_px for t in plan.tiles) == pytest.approx(10.0, rel=0.05)


def test_a_100m_ship_stops_being_a_single_pixel():
    """State the win in the units that decide whether detection is possible
    at all. One pixel is not a detection problem, it is an absence of data."""
    old_m_per_px = 97.0                     # measured from the single-image path
    assert 100 / old_m_per_px < 1.5         # was ~1 pixel: undetectable by anything
    now_px = 100 / max(t.m_per_px for t in st.plan_tiles(ZONE_001).tiles)
    assert now_px == pytest.approx(10.0, rel=0.05)


def test_the_plan_states_its_cost_before_anything_is_fetched():
    """With no cap, cost is the user's decision — so it has to be visible
    BEFORE the scan, in requests and in wall-clock, not discovered halfway."""
    plan = st.plan_tiles(ZONE_001)
    assert plan.api_requests == plan.count
    assert plan.estimated_seconds > 0
    line = plan.describe()
    assert "API request" in line
    assert "km²" in line
    assert "m/px" in line


def test_the_estimate_is_expressed_in_minutes_when_it_runs_long():
    """'1200s' is not a number anyone can act on."""
    huge = {"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0}
    assert "min" in st.plan_tiles(huge).describe()


def test_an_explicit_cap_still_works_for_a_caller_that_wants_a_preview():
    """Removing the default is not removing the capability."""
    plan = st.plan_tiles(ZONE_001, max_tiles=24, allow_degrade=True)
    assert plan.count <= 24
    assert plan.degraded_to_m_per_px is not None, "capped without recording the trade"
    assert "coarsened" in plan.describe()


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


def test_an_explicitly_capped_scan_degrades_deliberately_and_says_so():
    """Capping is now opt-in, but when a caller does opt in the trade must
    still be recorded. Trading resolution is acceptable; hiding it is not."""
    huge = {"west": 50.0, "south": 20.0, "east": 60.0, "north": 30.0}
    plan = st.plan_tiles(huge, max_tiles=24, allow_degrade=True)
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


def test_an_explicit_budget_is_never_exceeded():
    for max_tiles in (1, 4, 12, 24):
        plan = st.plan_tiles(ZONE_001, max_tiles=max_tiles, allow_degrade=True)
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
    plan = st.plan_tiles(ZONE_001, max_tiles=24, allow_degrade=True)

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        return []

    out = _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect))
    assert out["m_per_px"] > 0
    assert out["degraded"] is True


# ── progress reporting ────────────────────────────────────────────────────
#
# With no tile cap a scan can legitimately run for minutes, so a bar is not
# cosmetic: a long operation with no progress is indistinguishable from a
# hung one.

import imagery_runtime as ir


def test_progress_is_registered_before_the_first_tile_is_fetched():
    """A scan that shows nothing until its first tile finishes looks hung
    for the whole of that first tile."""
    plan = _plan2()
    seen = {}

    async def fetch(tile):
        seen.setdefault("at_first_fetch", ir.progress("job-a"))
        return {"image": "ok"}

    async def detect(image, bbox):
        return []

    _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect, job_id="job-a"))
    assert seen["at_first_fetch"] is not None, "no bar existed during the first fetch"
    assert seen["at_first_fetch"]["total"] == plan.count
    assert seen["at_first_fetch"]["done"] == 0


def test_progress_advances_and_completes():
    plan = _plan2()

    async def fetch(tile):
        return {"image": "ok"}

    async def detect(image, bbox):
        return [{"centroid_lat": bbox["min_lat"], "centroid_lon": bbox["min_lon"],
                 "confidence": 0.8, "object_type": "vessel"}]

    _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect, job_id="job-b"))
    p = ir.progress("job-b")
    assert p["finished"] is True
    assert p["done"] == p["total"] == plan.count
    assert p["fraction"] == 1.0
    assert p["detections"] >= 1


def test_a_failing_tile_still_advances_the_bar():
    """Freezing the bar on the one tile that broke is the least useful
    moment to stop reporting."""
    plan = _plan2()

    async def fetch(tile):
        return {"error": "Copernicus 502"}

    async def detect(image, bbox):
        return []

    _run(st.run_tiled_scan(plan, fetch_tile=fetch, detect_tile=detect, job_id="job-c"))
    p = ir.progress("job-c")
    assert p["done"] == plan.count, "the bar stalled on a failed tile"


def test_eta_comes_from_observed_rate_not_the_upfront_guess():
    """The plan's estimate is right at step zero and wrong at step forty."""
    plan = st.plan_tiles(ZONE_001)
    ir.start_progress("job-d", plan.count, label="x")
    ir.update_progress("job-d", 1)
    p = ir.progress("job-d")
    assert p["eta_s"] is not None
    assert p["elapsed_s"] >= 0
    ir.finish_progress("job-d")
    assert ir.progress("job-d")["eta_s"] is None, "still predicting a finished job"


def test_live_jobs_are_visible_in_pool_status():
    """The health endpoint is where an operator looks first."""
    ir.start_progress("job-e", 10, label="tiled scan")
    try:
        jobs = ir.status()["jobs"]
        assert any(j["job_id"] == "job-e" for j in jobs)
    finally:
        ir.finish_progress("job-e")
    assert all(j["job_id"] != "job-e" for j in ir.status()["jobs"]), (
        "a finished job is still shown as live"
    )


def test_finished_progress_is_eventually_cleared():
    """The registry must not grow for the life of the process."""
    ir.start_progress("job-f", 1, label="x")
    ir.finish_progress("job-f")
    ir.clear_finished_progress(older_than_s=-1)
    assert ir.progress("job-f") is None
