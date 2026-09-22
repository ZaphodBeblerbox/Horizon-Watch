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
