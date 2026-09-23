"""
The single-domain guard in _evaluate_fusion.

A bucket with one domain can never clear the domain-diversity floor, and
in production CTY:us reached 10,012 GDELT signals — 4.26ms of event-loop
time and two log lines per arriving signal to reach a verdict that was
never in doubt. The guard must reach that verdict without doing the work,
and must NOT change which buckets fuse.
"""
import datetime
import fusion_engine as fe


def _sig(sid, domain, rel=50):
    return {"signal_id": sid, "domain": domain, "relevance_score": rel,
            "severity": "medium", "confidence": 0.8, "source": domain.lower(),
            "timestamp": datetime.datetime.utcnow(), "summary": "x"}


def _engine():
    e = fe.FusionEngine.__new__(fe.FusionEngine)
    e.active_signals = {}
    e._bucket_domains = {}
    e.fusion_window_hours = 48
    e.min_signals = 3
    e.min_domains = 2
    e.active_fusions = {}
    return e


def test_a_single_domain_bucket_is_refused_without_scoring():
    e = _engine()
    for i in range(50):
        e._add_signal("CTY:us", _sig(f"S{i}", "GDELT"))
    assert e._domain_count("CTY:us", e.active_signals["CTY:us"]) == 1

    called = []
    import correlation_scoring as _cs
    real = _cs.domain_diversity_score
    _cs.domain_diversity_score = lambda pool: (called.append(1), real(pool))[1]
    try:
        e._evaluate_fusion("CTY:us")
    finally:
        _cs.domain_diversity_score = real
    # The whole point: the scorer is never reached.
    assert called == []


def test_a_multi_domain_bucket_still_goes_through_the_real_path():
    # The guard must not become a new, quieter way to suppress fusion.
    e = _engine()
    for i in range(10):
        e._add_signal("CTY:mx", _sig(f"G{i}", "GDELT"))
    for i in range(10):
        e._add_signal("CTY:mx", _sig(f"N{i}", "NEWS"))
    assert e._domain_count("CTY:mx", e.active_signals["CTY:mx"]) == 2

    called = []
    import correlation_scoring as _cs
    real = _cs.domain_diversity_score
    _cs.domain_diversity_score = lambda pool: (called.append(1), real(pool))[1]
    try:
        # This runs on into _create_fusion, which needs far more of a real
        # engine than this stub is. That is fine and is not what is under
        # test: the contract is that the guard LETS IT THROUGH to scoring,
        # so reaching the scorer is the assertion, and anything after it
        # is the rest of the system's business.
        try:
            e._evaluate_fusion("CTY:mx")
        except AttributeError:
            pass
    finally:
        _cs.domain_diversity_score = real
    assert called, "a multi-domain bucket must still be scored"


def test_the_domain_cache_tracks_additions():
    e = _engine()
    e._add_signal("K", _sig("a", "AIS"))
    assert e._bucket_domains["K"] == {"AIS"}
    e._add_signal("K", _sig("b", "NEWS"))
    assert e._bucket_domains["K"] == {"AIS", "NEWS"}


def test_domain_count_works_without_a_cache_entry():
    # The restore path appends to active_signals directly, so the cache
    # can legitimately be absent and the count must not silently read 0.
    e = _engine()
    e.active_signals["R"] = [_sig("a", "AIS"), _sig("b", "NEWS")]
    assert "R" not in e._bucket_domains
    assert e._domain_count("R", e.active_signals["R"]) == 2


def test_domain_count_stops_at_two():
    # It only ever needs to distinguish "can never fuse" from "might".
    e = _engine()
    sigs = [_sig(f"s{i}", f"D{i}") for i in range(500)]
    e.active_signals["B"] = sigs
    assert e._domain_count("B", sigs) == 2


def test_expiry_keeps_the_cache_honest():
    # A stale cache is the worst failure here: it would silently suppress
    # fusion for a bucket that had become multi-domain.
    e = _engine()
    old = _sig("old", "NEWS")
    old["timestamp"] = datetime.datetime.utcnow() - datetime.timedelta(hours=99)
    e._add_signal("K", old)
    e._add_signal("K", _sig("new", "AIS"))
    e.expire_old_signals()
    assert e._bucket_domains.get("K") == {"AIS"}


def test_dedup_survives_the_single_pass_rewrite():
    e = _engine()
    e._add_signal("K", _sig("same", "AIS"))
    e._add_signal("K", _sig("same", "AIS"))
    assert len(e.active_signals["K"]) == 1
