"""shared_cache.SharedCache: one build serves everyone (2026-10-19 stability)."""
import sqlite3
import threading
import time

import pytest

from shared_cache import SharedCache


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_entries_keyed_by_request_parameters_are_bounded():
    """/api/telegram/posts?hours=N built one whole post list per N (1..720, x2 for pins)
    and kept every one for the life of the process."""
    clk = Clock()
    c = SharedCache("t", ttl=10, max_stale=60, clock=clk, max_entries=8)
    for h in range(100):
        clk.t += 1
        assert c.get(("db", h, False), lambda h=h: [h] * 10) == [h] * 10
    assert len(c) == 8
    assert c.peek(("db", 99, False)) == [99] * 10 and c.peek(("db", 0, False)) is None


def test_concurrent_cold_callers_share_one_build():
    c = SharedCache("t", ttl=10, max_stale=60)
    started = threading.Event()
    release = threading.Event()
    calls = []

    def build():
        calls.append(1)
        started.set()
        release.wait(5)
        return "v"

    out = []
    threads = [threading.Thread(target=lambda: out.append(c.get("k", build))) for _ in range(12)]
    for t in threads:
        t.start()
    started.wait(5)
    time.sleep(0.05)                     # everyone else is now waiting on the one build
    release.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1
    assert out == ["v"] * 12


def test_stale_is_served_at_once_and_rebuilt_once_in_the_background():
    clock = Clock()
    c = SharedCache("t", ttl=10, max_stale=60, clock=clock)
    assert c.get("k", lambda: 1) == 1
    clock.t += 15                        # stale, still servable
    gate = threading.Event()
    calls = []

    def slow_build():
        calls.append(1)
        gate.wait(5)
        return 2

    t0 = time.monotonic()
    assert [c.get("k", slow_build) for _ in range(20)] == [1] * 20     # nobody waits
    assert time.monotonic() - t0 < 0.5
    gate.set()
    for _ in range(100):
        if c.peek("k") == 2:
            break
        time.sleep(0.01)
    assert c.peek("k") == 2 and len(calls) == 1


def test_a_failing_background_build_keeps_the_previous_value():
    clock = Clock()
    c = SharedCache("t", ttl=10, max_stale=60, clock=clock)
    c.get("k", lambda: "good")
    clock.t += 15

    def boom():
        raise RuntimeError("source down")
    assert c.get("k", boom) == "good"
    time.sleep(0.1)
    assert c.peek("k") == "good"


def test_too_old_blocks_for_a_fresh_build_and_cold_errors_propagate():
    clock = Clock()
    c = SharedCache("t", ttl=10, max_stale=60, clock=clock)
    c.get("k", lambda: 1)
    clock.t += 61
    assert c.get("k", lambda: 2) == 2
    with pytest.raises(RuntimeError):
        c.get("other", lambda: (_ for _ in ()).throw(RuntimeError("x")))


def test_expire_serves_current_value_while_rebuilding():
    c = SharedCache("t", ttl=10, max_stale=60)
    c.get("k", lambda: 1)
    c.expire()
    assert c.get("k", lambda: 2) == 1
    for _ in range(100):
        if c.peek("k") == 2:
            break
        time.sleep(0.01)
    assert c.peek("k") == 2


# ── the street reader, which this was built for ─────────────────────────────

def test_street_reader_screens_each_post_once(monkeypatch):
    """A second read of the same window re-runs no gazetteer pattern: in
    production the screen was 2.6-3.5 s per read, every 15 s, per caller."""
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "tools"))
    import synth_telegram
    import street_reports as sr
    con = sqlite3.connect(":memory:")
    synth_telegram.make(con, n=600)
    first = sr.read(con, 6)
    calls = []
    real = sr._hits_in.__wrapped__

    def counting(t):
        calls.append(t)
        return real(t)
    # a text the memo has not seen reaches the raw function
    monkeypatch.setattr(sr._hits_in, "__wrapped__", counting)
    again = sr.read(con, 6)
    assert [s["id"] for s in again] == [s["id"] for s in first]
    assert calls == []
    sr._hits_in("une phrase jamais vue place de la republique")
    assert len(calls) == 1
