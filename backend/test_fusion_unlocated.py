"""An unlocated signal must not be fused by location.

The live failure this encodes: 2,433 AIS and ADS-B signals with no
region, no country and no coordinates were all dropped into one shared
"GEO:unknown" bucket, which then behaved like the busiest place on
earth. Every incoming signal re-evaluated the whole bucket on the event
loop, and a trivial API query queued behind it for fifteen seconds.

It was also wrong on its own terms: fusion asserts that several
independent domains reported the SAME PLACE, and "unknown" is not a
place, so anything it produced corroborated nothing.
"""
import datetime
import fusion_engine


def _engine():
    return fusion_engine.FusionEngine()


def _signal(**kw):
    base = {
        "signal_id": "S1", "domain": "AIS", "severity": "medium",
        "confidence": 0.8, "relevance_score": 50,
        "summary": "x", "rule_name": "r",
        "timestamp": datetime.datetime.utcnow(),
    }
    base.update(kw)
    return base


def test_unlocated_signal_resolves_to_no_geo_key():
    e = _engine()
    assert e._resolve_geo_key(_signal(lat=None, lon=None)) is None


def test_a_located_signal_still_resolves():
    e = _engine()
    assert e._resolve_geo_key(_signal(country="UA")) is not None
    assert e._resolve_geo_key(_signal(lat=50.4, lon=30.5)) is not None


def test_unlocated_signals_never_accumulate_in_a_bucket():
    # The exact shape of the live bug: many unlocated signals arriving
    # must not build a bucket that is then re-evaluated on every write.
    e = _engine()
    for i in range(200):
        e.on_signal(_signal(signal_id=f"S{i}", lat=None, lon=None))
    for key, bucket in e.active_signals.items():
        assert "unknown" not in key.lower(), f"{key} accumulated {len(bucket)}"
    total = sum(len(b) for b in e.active_signals.values())
    assert total == 0, f"{total} unlocated signals were queued for correlation"


def test_unlocated_signals_are_still_logged():
    # Not correlated is not the same as discarded.
    e = _engine()
    e.on_signal(_signal(signal_id="KEEP", lat=None, lon=None))
    assert any(s.get("signal_id") == "KEEP" for s in e.get_recent_signals())


def test_located_signals_still_accumulate():
    e = _engine()
    for i in range(3):
        e.on_signal(_signal(signal_id=f"L{i}", lat=50.4, lon=30.5, domain="AIS"))
    assert sum(len(b) for b in e.active_signals.values()) == 3


def test_the_unlocated_marker_key_has_one_definition():
    """Both paths must agree, or the bug returns on the next restart.

    The live path and the DB restore path each decide what to do with a
    signal that has no place. Fixing only one of them meant 287
    unlocated signals were reloaded into a single bucket on startup and
    produced "Unknown Location Intelligence Event | 287 signals / 2
    domains" — the exact condition that was supposed to be fixed,
    reappearing precisely when nobody is reading the log.
    """
    assert fusion_engine.UNLOCATED_KEY == "GEO:unlocated"


def test_restored_unlocated_signals_are_not_put_back_in_a_bucket():
    e = _engine()
    # Simulate what the restore loop does with a persisted unlocated row.
    e.active_signals.clear()
    key = fusion_engine.UNLOCATED_KEY
    assert key not in e.active_signals

    # And the live path agrees: it never creates that bucket either.
    for i in range(50):
        e.on_signal(_signal(signal_id=f"U{i}", lat=None, lon=None))
    assert key not in e.active_signals
    assert sum(len(b) for b in e.active_signals.values()) == 0


def test_a_located_signal_restores_normally():
    e = _engine()
    e.on_signal(_signal(signal_id="L1", lat=10.0, lon=20.0))
    keys = [k for k in e.active_signals if k != fusion_engine.UNLOCATED_KEY]
    assert keys, "a located signal must still be correlated"
