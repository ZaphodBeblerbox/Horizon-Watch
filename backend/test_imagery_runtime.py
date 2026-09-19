"""
test_imagery_runtime.py — the properties that keep imagery from taking the
app down. Each test here corresponds to a failure that actually happened or
that the single-worker design would otherwise make possible.
"""
import asyncio
import threading
import time

import pytest

import imagery_runtime as ir


def _reset():
    """Tests assert on global pool counters; make each start from quiet."""
    deadline = time.monotonic() + 10
    while ir.status()["pending"] and time.monotonic() < deadline:
        time.sleep(0.02)
    assert ir.status()["pending"] == 0, "pool did not drain between tests"


def test_work_runs_on_the_imagery_pool_not_the_default_executor():
    """The whole point: imagery CPU work must land on a NAMED, dedicated
    thread, never on the shared pool FastAPI uses for sync endpoints."""
    _reset()
    name = ir.submit(lambda: threading.current_thread().name, label="probe").result(timeout=10)
    assert name.startswith("imagery-cpu"), f"ran on {name!r}, not the imagery pool"


def test_jobs_serialise_so_two_inferences_never_contend():
    """max_workers=1 is a deliberate design choice (GIL/ONNX contention), so
    prove overlap is actually impossible rather than merely unlikely."""
    _reset()
    overlap = []
    active = []
    lock = threading.Lock()

    def job():
        with lock:
            active.append(1)
            if len(active) > 1:
                overlap.append(1)
        time.sleep(0.15)
        with lock:
            active.pop()

    futs = [ir.submit(job, label=f"job{i}") for i in range(3)]
    for f in futs:
        f.result(timeout=20)
    assert not overlap, "two imagery jobs ran concurrently"


def test_saturation_is_refused_immediately_not_queued_for_ever():
    """Backpressure: a caller that cannot be served soon is told so, rather
    than waiting minutes behind inference for an answer nobody still wants."""
    _reset()
    release = threading.Event()
    held = []
    try:
        # Fill the worker plus the whole queue.
        for i in range(ir._MAX_WORKERS + ir._MAX_QUEUE):
            held.append(ir.submit(release.wait, timeout=30, label=f"hold{i}"))
        t0 = time.monotonic()
        with pytest.raises(ir.ImageryBusy) as excinfo:
            ir.submit(lambda: None, label="one-too-many")
        assert time.monotonic() - t0 < 0.5, "refusal should be immediate, not a wait"
        # The refusal has to say something real, per the project's rule that
        # absence must never be rendered as silence.
        assert "saturated" in str(excinfo.value)
    finally:
        release.set()
        for f in held:
            f.result(timeout=30)
    _reset()


def test_a_refused_job_does_not_leak_a_slot():
    """A rejection must not consume capacity — otherwise the pool bleeds
    slots under load and eventually refuses everything for ever."""
    _reset()
    before = ir.status()["pending"]
    release = threading.Event()
    held = [ir.submit(release.wait, timeout=30, label=f"h{i}")
            for i in range(ir._MAX_WORKERS + ir._MAX_QUEUE)]
    try:
        for _ in range(5):
            with pytest.raises(ir.ImageryBusy):
                ir.submit(lambda: None, label="rejected")
        assert ir.status()["pending"] == ir._MAX_WORKERS + ir._MAX_QUEUE
    finally:
        release.set()
        for f in held:
            f.result(timeout=30)
    _reset()
    assert ir.status()["pending"] == before


def test_reentrant_call_from_a_pool_thread_does_not_deadlock():
    """With one worker, a nested submit that waited on itself would hang the
    pool permanently. Nested work must run inline instead."""
    _reset()

    def inner():
        return "inner-ok"

    def outer():
        # This is the shape that would deadlock without the guard.
        return ir.submit(inner, label="nested").result(timeout=5)

    assert ir.submit(outer, label="outer").result(timeout=10) == "inner-ok"


def test_exceptions_propagate_rather_than_vanishing():
    """A swallowed exception in a background imagery job is how a whole
    feature silently stops working — this project has been bitten by exactly
    that pattern before."""
    _reset()

    def boom():
        raise ValueError("detector exploded")

    with pytest.raises(ValueError, match="detector exploded"):
        ir.submit(boom, label="boom").result(timeout=10)
    _reset()
    assert ir.status()["pending"] == 0, "a failed job must still release its slot"


def test_timeout_releases_the_caller_but_keeps_the_slot_held():
    """A thread cannot be killed. The caller is freed, but the slot must stay
    held until the work genuinely finishes — releasing early would stack a
    second job onto a core that is still fully busy."""
    _reset()
    release = threading.Event()

    async def scenario():
        with pytest.raises(ir.ImageryTimeout):
            await ir.run_cpu(release.wait, timeout=0.2, label="slow")
        # Caller is free, but the job is still in flight and still counted.
        assert ir.status()["pending"] == 1, "slot was released while work continued"
        release.set()

    asyncio.run(scenario())
    _reset()
    assert ir.status()["pending"] == 0


def test_event_loop_stays_responsive_while_a_long_job_runs():
    """The regression that matters. While imagery burns CPU, the loop must
    keep servicing other work — this is the 'everything 502s at once'
    signature, reproduced as a test."""
    _reset()
    release = threading.Event()

    async def scenario():
        job = asyncio.create_task(ir.run_cpu(release.wait, timeout=30, label="long"))
        await asyncio.sleep(0.05)          # let it get going

        # Stand in for health probes arriving during inference.
        latencies = []
        for _ in range(10):
            t0 = time.monotonic()
            await asyncio.sleep(0)
            latencies.append(time.monotonic() - t0)

        release.set()
        await job
        return max(latencies)

    worst = asyncio.run(scenario())
    assert worst < 0.1, f"event loop stalled {worst:.3f}s during an imagery job"


def test_status_reports_what_is_running_for_the_health_endpoint():
    """Operators need to distinguish 'imagery is busy' from 'imagery is
    broken'. The status has to name the job, not just say busy."""
    _reset()
    release = threading.Event()
    f = ir.submit(release.wait, timeout=30, label="named-scan")
    try:
        deadline = time.monotonic() + 5
        while ir.status()["current"] is None and time.monotonic() < deadline:
            time.sleep(0.01)
        st = ir.status()
        assert st["busy"] is True
        assert st["current"] == "named-scan"
        assert st["running_for_s"] is not None
    finally:
        release.set()
        f.result(timeout=30)
    _reset()
    assert ir.status()["busy"] is False
