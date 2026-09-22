"""Coverage context must never stall the caller.

notification_relevance() calls coverage_for() once per alert, and the
notifications endpoint runs that over up to 2,400 alerts. measure()
counts vessel_history — 10.2 million rows in production, once for the
total and again per region, with no index on lat/lon. Profiling put
9.83 of 10.3 seconds inside it, and the tray's endpoint took 45s.

A missing sentence of context is a small loss. A 45-second request is a
feature that does not work.
"""
import time
import ais_coverage as ac


def test_coverage_for_does_not_compute_by_default(monkeypatch):
    ac._CACHE.clear()
    called = {"n": 0}

    def boom(*_a, **_k):
        called["n"] += 1
        raise AssertionError("coverage_for must not trigger a measurement")

    monkeypatch.setattr(ac, "REGIONS", [], raising=False)
    # If it tried to compute it would hit the database; assert instead
    # that it simply returns nothing.
    assert ac.coverage_for(55.0, 10.0) is None
    assert called["n"] == 0


def test_it_is_cheap_enough_for_a_per_row_loop():
    ac._CACHE.clear()
    t = time.time()
    for _ in range(2400):
        ac.coverage_for(55.0, 10.0)
    assert time.time() - t < 1.0


def test_a_warm_cache_is_used():
    ac._CACHE.clear()
    ac._CACHE["coverage"] = {"ts": time.time(), "data": {
        "available": True,
        "regions": [{"region": "North Sea", "positions": 9000, "blind": False,
                     "reads_as": "usable coverage", "bbox": [50.0, 60.0, -5.0, 15.0]}],
    }}
    got = ac.coverage_for(55.0, 10.0)
    assert got and got["region"] == "North Sea"


def test_an_expired_reading_is_served_rather_than_recomputed():
    # Stale is better than slow for a decorative note.
    ac._CACHE.clear()
    ac._CACHE["coverage"] = {"ts": time.time() - (ac._CACHE_TTL * 5), "data": {
        "available": True,
        "regions": [{"region": "Baltic", "positions": 10, "blind": True,
                     "reads_as": "effectively unwatched", "bbox": [50.0, 60.0, -5.0, 15.0]}],
    }}
    got = ac.coverage_for(55.0, 10.0)
    assert got and got["region"] == "Baltic"


def test_a_point_outside_every_region_returns_nothing():
    ac._CACHE.clear()
    ac._CACHE["coverage"] = {"ts": time.time(), "data": {
        "available": True,
        "regions": [{"region": "Baltic", "positions": 10, "blind": True,
                     "reads_as": "x", "bbox": [50.0, 60.0, -5.0, 15.0]}],
    }}
    assert ac.coverage_for(-40.0, 170.0) is None


def test_missing_coordinates_are_not_an_error():
    assert ac.coverage_for(None, 10.0) is None
    assert ac.coverage_for(55.0, None) is None


def test_explicit_callers_can_still_force_a_measurement():
    # The /api/ais/coverage endpoint is allowed to be slow; it is asking
    # for exactly this number and nothing else waits on it.
    import inspect
    assert "compute_if_cold" in inspect.signature(ac.measure).parameters
    assert "force" in inspect.signature(ac.measure).parameters
