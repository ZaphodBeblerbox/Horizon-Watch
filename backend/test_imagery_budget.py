"""
test_imagery_budget.py — an Esri scan must refuse an impossible area BEFORE
it spends five minutes proving it is impossible.

The regression this pins down, measured on 2026-09-19: a zoom-17 request over
a 0.25 deg box passed the old 10,000-tile guard, fetched 9,292 tiles over
312 seconds, stitched a 609-megapixel image, was refused by PIL's own 179MP
decompression-bomb ceiling, and returned zero detections. The old limit sat
ABOVE the point where the operation could not succeed at all, so the guard
could never fire on the cases that needed it.

Usage:
    cd backend && python3 -m pytest test_imagery_budget.py -q
"""
import os
import sys

import pytest

os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))

import main  # noqa: E402  (heavy import; this test needs the real guard)


# The exact request that burned 312 seconds and returned nothing.
PATHOLOGICAL = {"north": 25.45, "south": 25.20, "east": 56.50, "west": 56.25}


@pytest.fixture
def tile_calls(monkeypatch):
    """Count tile fetches instead of raising on them.

    Raising does not work here: the stitch loop catches per-tile exceptions
    and logs them, so a sentinel exception is swallowed and the test reads
    as a pass for the wrong reason. Counting is the honest instrument.
    """
    calls = []

    def _record(z, x, y):
        calls.append((z, x, y))
        raise RuntimeError("no network in tests")

    monkeypatch.setattr(main, "_fetch_esri_tile", _record)
    return calls


def test_oversized_area_is_refused_before_any_tile_is_fetched(tile_calls):
    out = main._run_overwatch_inference(PATHOLOGICAL, zoom=17, confidence=0.2)
    assert out["count"] == 0
    assert "too large" in out["error"].lower()
    assert tile_calls == [], f"fetched {len(tile_calls)} tile(s) despite the budget refusal"


def test_the_refusal_stays_under_pils_own_ceiling():
    """A budget above PIL's limit is not a budget — it is a slower failure."""
    PIL_BOMB_LIMIT_PX = 178_956_970
    assert main._IMAGERY_MAX_STITCH_PX < PIL_BOMB_LIMIT_PX, (
        "stitch budget exceeds the point where PIL refuses the image outright"
    )


def test_the_refusal_is_actionable_not_just_no(tile_calls):
    """'Draw a smaller region' does not say how much smaller. The message has
    to carry the numbers the user needs to succeed on the next attempt."""
    out = main._run_overwatch_inference(PATHOLOGICAL, zoom=17, confidence=0.2)
    budget = out.get("budget")
    assert budget, "refusal carried no machine-readable budget for the UI"
    assert budget["megapixels"] > budget["max_megapixels"]
    assert budget["tiles"] > 0
    # It must name a workable size and a workable zoom, in words too.
    assert "km across" in out["error"]
    assert f"zoom {budget['suggested_zoom']}" in out["error"]


def test_the_suggested_zoom_would_actually_fit(tile_calls):
    """A suggestion that also fails is worse than no suggestion: it costs the
    user a second round trip to learn nothing."""
    out = main._run_overwatch_inference(PATHOLOGICAL, zoom=17, confidence=0.2)
    suggested = out["budget"]["suggested_zoom"]
    assert suggested < 17, "suggested the same zoom that just failed"

    # Re-running at the suggested zoom must clear the budget. Reaching the
    # tile fetch at all is the proof that it did.
    tile_calls.clear()
    main._run_overwatch_inference(PATHOLOGICAL, zoom=suggested, confidence=0.2)
    assert tile_calls, "the suggested zoom was itself refused by the budget"


def test_a_reasonable_area_is_not_refused(tile_calls):
    """The guard must not become the new failure mode."""
    small = {"north": 25.36, "south": 25.31, "east": 56.40, "west": 56.34}
    main._run_overwatch_inference(small, zoom=16, confidence=0.2)
    assert tile_calls, "a normal-sized scan was refused by the pixel budget"


def test_onnx_leaves_the_machine_a_core_to_answer_on():
    """Moving inference off the event loop does not help if inference then
    takes every core — the loop needs a core, not merely another thread."""
    cores = os.cpu_count() or 4
    if cores > 2:
        assert main._IMAGERY_ONNX_THREADS <= cores - 2, (
            f"ONNX may use {main._IMAGERY_ONNX_THREADS} of {cores} cores — "
            "no headroom left for the event loop"
        )
    assert main._IMAGERY_ONNX_THREADS >= 1
