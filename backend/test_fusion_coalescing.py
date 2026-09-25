"""
A burst must not cost one full evaluation per signal.

This is the defect that took production down: _evaluate_fusion calls
_update_fusion for any already-fused bucket, which opens a DB session,
runs score_cluster (two more queries) and can call the narrative model —
and it ran once per arriving signal. GDELT arrives in bursts of hundreds
into the same geo bucket, so the event loop saturated and the process
answered no HTTP at all while still happily logging.

What must stay true: bursts coalesce, and nothing deferred is lost.
"""
import datetime
import io
import contextlib

import fusion_engine as fe


def _engine():
    """An engine whose evaluation is counted rather than performed."""
    eng = fe.FusionEngine()
    calls = []
    eng._evaluate_fusion = lambda geo_key: calls.append(geo_key)
    return eng, calls


def _send(eng, n, start=0, domain_alternate=True):
    sig = lambda i: {
        "signal_id": f"SIG-{i:05d}",
        "domain": ("GDELT" if i % 2 else "NEWS") if domain_alternate else "GDELT",
        "severity": "info", "lat": 25.3, "lon": 56.4,
        "location_name": "Khor Fakkan", "region_id": None, "country": "AE",
        "rule_id": "r", "rule_name": "t", "summary": "s",
        "timestamp": datetime.datetime.utcnow(),
    }
    with contextlib.redirect_stdout(io.StringIO()):
        for i in range(start, start + n):
            eng.on_signal(sig(i))


def test_a_burst_evaluates_once_not_once_per_signal():
    eng, calls = _engine()
    _send(eng, 300)
    # One immediate evaluation for the first signal into a quiet bucket;
    # the other 299 are throttled. Before the fix this was 300.
    assert len(calls) == 1, f"expected 1 evaluation, got {len(calls)}"


def test_the_first_signal_into_a_quiet_bucket_is_not_delayed():
    # The throttle must not add latency to the normal case — a single
    # signal arriving into an idle bucket still evaluates immediately.
    eng, calls = _engine()
    _send(eng, 1)
    assert len(calls) == 1


def test_a_throttled_burst_is_deferred_not_dropped():
    eng, calls = _engine()
    _send(eng, 300)
    assert eng._dirty, "burst left nothing for the drain to pick up"

    # Inside the throttle window the drain must not fire early.
    assert eng.drain_pending_evaluations() == 0
    assert len(calls) == 1

    # Once the window has passed, the deferred bucket is evaluated.
    for k in eng._last_eval:
        eng._last_eval[k] -= fe.EVAL_MIN_INTERVAL_S + 1
    assert eng.drain_pending_evaluations() == 1
    assert len(calls) == 2
    assert not eng._dirty


def test_the_drain_survives_one_poisoned_bucket():
    # A single bad geo_key must not freeze fusion for every other one.
    eng, calls = _engine()
    _send(eng, 5)
    eng._dirty["zone:BAD"] = True
    eng._dirty["zone:GOOD"] = True
    eng._last_eval["zone:BAD"] = 0.0
    eng._last_eval["zone:GOOD"] = 0.0

    def explode(geo_key):
        if geo_key == "zone:BAD":
            raise RuntimeError("boom")
        calls.append(geo_key)
    eng._evaluate_fusion = explode

    with contextlib.redirect_stdout(io.StringIO()):
        eng.drain_pending_evaluations()
    assert "zone:GOOD" in calls


def test_expiry_does_not_leave_coalescing_state_behind():
    # _dirty/_last_eval are keyed by geo_key and nothing else removes an
    # entry, so every country ever seen would keep one forever.
    eng, _ = _engine()
    _send(eng, 3)
    key = next(iter(eng.active_signals))
    eng._dirty[key] = True
    # Age every signal out of the window.
    for s in eng.active_signals[key]:
        s["timestamp"] -= datetime.timedelta(hours=eng.fusion_window_hours + 1)
    with contextlib.redirect_stdout(io.StringIO()):
        eng.expire_old_signals()
    assert key not in eng._dirty
    assert key not in eng._last_eval
