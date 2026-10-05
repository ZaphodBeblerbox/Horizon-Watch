"""chokepoint_flow: share against its own baseline, and honest about when it cannot say."""
from chokepoint_flow import assess, cells_for_bounds


def _days(n):
    return [f"2026-09-{d:02d}" for d in range(1, n + 1)]


def test_uptime_swings_do_not_read_as_a_change():
    # Global total varies 10x with uptime; the box keeps a steady 2% of it.
    days = _days(15)
    glob = {d: (100_000 if i % 2 else 1_000_000) for i, d in enumerate(days)}
    box = {d: glob[d] * 0.02 for d in days}
    r = assess("Danish Straits", box, glob)
    assert r["measurable"] and r["verdict"] == "within normal range"


def test_a_real_drop_in_share_is_called_below_normal():
    days = _days(15)
    glob = {d: 1_000_000 for d in days}
    box = {d: 20_000 + (i % 3) * 200 for i, d in enumerate(days)}
    box[days[-1]] = 10_000
    r = assess("Danish Straits", box, glob)
    assert r["verdict"] == "below normal"
    assert "Danish Straits" in r["summary"] and "below" in r["summary"]


def test_no_coverage_is_unmeasurable_not_a_closure():
    days = _days(15)
    r = assess("Strait of Hormuz", {}, {d: 1_000_000 for d in days})
    assert r["measurable"] is False and r["verdict"] is None
    assert "not a closure" in r["reason"]


def test_a_noisy_baseline_calls_no_change():
    days = _days(15)
    glob = {d: 1_000_000 for d in days}
    box = {d: (40_000 if i % 2 else 2_000) for i, d in enumerate(days)}
    r = assess("Suez Canal", box, glob)
    assert r["measurable"] is False and "variable" in r["reason"]


def test_thin_days_are_dropped_before_comparing():
    days = _days(15)
    glob = {d: 1_000_000 for d in days}
    glob[days[-1]] = 5_000                  # a few minutes of feed
    box = {d: 20_000 for d in days}
    box[days[-1]] = 0
    r = assess("Danish Straits", box, glob)
    assert r["day"] == days[-2] and r["verdict"] == "within normal range"


def test_cells_follow_the_floor_keying():
    assert cells_for_bounds([25.5, 54.5, 27.0, 58.0]) == (25, 54, 26, 57)
    assert cells_for_bounds([-35.5, 17.0, -33.2, 20.5]) == (-36, 17, -34, 20)
