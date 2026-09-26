"""A fusion bucket is bounded by count, not only by age.

The time window bounds how OLD a bucket's contents are and says nothing
about how many there are. A country-level key collects everything GDELT
reports for that country inside the window — CTY:us reached 10,012 entries
in production — and the de-duplicating scan runs once per arriving signal,
so a burst of n signals costs O(n²). The process stays alive, keeps
logging, and answers no HTTP at all.
"""
import datetime
import importlib

import pytest


@pytest.fixture
def engine():
    fe = importlib.import_module("fusion_engine")
    importlib.reload(fe)
    return fe


def _sig(i, domain="GDELT"):
    return {
        "signal_id": f"SIG-{i:05d}",
        "domain": domain,
        "timestamp": datetime.datetime.utcnow(),
        "severity": "medium",
        "confidence": 0.8,
    }


def test_a_bucket_stops_growing_at_the_cap(engine):
    eng = engine.FusionEngine() if hasattr(engine, "FusionEngine") else engine.fusion_engine
    key = "CTY:xx"
    for i in range(engine.MAX_BUCKET + 250):
        eng._add_signal(key, _sig(i))
    held = len(eng.active_signals[key])
    assert held == engine.MAX_BUCKET, f"bucket grew to {held}"


def test_the_cap_keeps_the_newest(engine):
    """Dropping the newest would make the bucket describe the past."""
    eng = engine.FusionEngine() if hasattr(engine, "FusionEngine") else engine.fusion_engine
    key = "CTY:yy"
    total = engine.MAX_BUCKET + 100
    for i in range(total):
        eng._add_signal(key, _sig(i))
    ids = {s["signal_id"] for s in eng.active_signals[key]}
    assert f"SIG-{total - 1:05d}" in ids          # newest survives
    assert f"SIG-{0:05d}" not in ids              # oldest evicted


def test_the_domain_cache_matches_the_capped_bucket(engine):
    """_evaluate_fusion refuses a single-domain bucket in O(1) using this
    cache; if it still described evicted signals it would claim domains the
    bucket no longer holds."""
    eng = engine.FusionEngine() if hasattr(engine, "FusionEngine") else engine.fusion_engine
    key = "CTY:zz"
    for i in range(engine.MAX_BUCKET + 50):
        eng._add_signal(key, _sig(i, domain="GDELT"))
    eng._add_signal(key, _sig(999999, domain="AIS"))
    doms = eng._bucket_domains[key]
    actual = {s["domain"] for s in eng.active_signals[key]}
    assert doms == actual


def test_arrivals_are_logged_as_a_rate_not_per_signal(engine):
    """One line per arriving signal is log-rate backpressure, which is the
    outage, not a diagnostic."""
    import inspect
    src = inspect.getsource(engine)
    ingest = src[src.index("def on_signal"):src.index("def _count_signal")]
    assert "_count_signal" in ingest
    assert "Signal received:" not in ingest, "per-signal print is back"
    assert engine.SIGNAL_LOG_INTERVAL_S >= 5
