"""A background loop that fails must say so — once, then periodically.

This codebase has repeatedly lost a whole feature to a swallowed exception:
history stops recording, or an hourly snapshot is written with an empty
event list, and the first anyone knows is that a chart has been flat for a
week. Printing every occurrence is not the fix either — a failure that
repeats per AIS message at ~3,000/min is its own outage, through log-rate
backpressure.
"""
import importlib
import re

import pytest


@pytest.fixture(scope="module")
def m():
    return importlib.import_module("main")


def test_first_occurrence_is_always_reported(m, capsys):
    m._LOOP_ERR_COUNTS.clear()
    m._loop_error("unit-test-a", ValueError("boom"))
    out = capsys.readouterr().out
    assert "unit-test-a" in out
    assert "ValueError" in out and "boom" in out


def test_it_does_not_print_every_time(m, capsys):
    m._LOOP_ERR_COUNTS.clear()
    for _ in range(60):
        m._loop_error("unit-test-b", ValueError("boom"), every=50)
    lines = [l for l in capsys.readouterr().out.splitlines() if "unit-test-b" in l]
    # The 1st and the 50th, not sixty lines.
    assert len(lines) == 2


def test_the_count_is_reported_so_a_persistent_failure_is_visible(m, capsys):
    m._LOOP_ERR_COUNTS.clear()
    for _ in range(50):
        m._loop_error("unit-test-c", RuntimeError("x"), every=50)
    out = capsys.readouterr().out
    assert "occurrence 50" in out


def test_counters_are_per_key(m):
    m._LOOP_ERR_COUNTS.clear()
    m._loop_error("k1", ValueError("a"))
    m._loop_error("k2", ValueError("b"))
    assert m._LOOP_ERR_COUNTS["k1"] == 1
    assert m._LOOP_ERR_COUNTS["k2"] == 1


def test_no_background_loop_still_swallows_silently():
    """The specific sites that were silent stay reported."""
    src = open("main.py").read()
    for fn in ("_record_ais_history", "_record_adsb_history"):
        # find the try/except wrapping that call
        i = src.index(fn)
        window = src[i:i + 400]
        assert "_loop_error" in window, f"{fn} is swallowing again"

    # The threat snapshot writes regardless of this failing, so it is the
    # one that silently records an hour as having had no events.
    i = src.index("save_hourly_snapshot")
    assert "_loop_error" in src[max(0, i - 600):i]
