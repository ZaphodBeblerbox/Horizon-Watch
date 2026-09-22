"""The derived notification block is swapped, never cleared.

The warmer's first version emptied the cache and then spent 14.4
seconds rebuilding it, so every request arriving in that window found
nothing, rebuilt the block itself and paid the full cold cost — a
stampede the warmer caused. Production showed it at once: 46.8s and
20.2s against an otherwise steady 0.45s.
"""
import time
import main


def _stub(monkeypatch, marker, delay=0.0):
    import live_notifications as ln
    monkeypatch.setattr(ln, "gdelt_items", lambda **_k: [])
    monkeypatch.setattr(ln, "geoconfirmed_items", lambda **_k: [])
    monkeypatch.setattr(ln, "frontline_items", lambda **_k: [])
    monkeypatch.setattr(ln, "risk_change_items", lambda _r: [])

    def derived():
        if delay:
            time.sleep(delay)
        return [{"id": marker}]
    monkeypatch.setattr(ln, "derived_items", derived)


def test_a_second_call_is_served_from_cache(monkeypatch):
    main._LIVE_SOURCES_CACHE.clear()
    calls = []
    import live_notifications as ln
    _stub(monkeypatch, "a")
    orig = ln.derived_items
    monkeypatch.setattr(ln, "derived_items", lambda: (calls.append(1), orig())[1])
    main._live_notification_sources(48)
    main._live_notification_sources(48)
    assert len(calls) == 1


def test_force_rebuilds(monkeypatch):
    main._LIVE_SOURCES_CACHE.clear()
    _stub(monkeypatch, "a")
    main._live_notification_sources(48)
    _stub(monkeypatch, "b")
    got = main._live_notification_sources(48, force=True)
    assert got == [{"id": "b"}]


def test_a_rebuild_never_leaves_the_cache_empty(monkeypatch):
    """THE STAMPEDE TEST. During a forced rebuild, a concurrent reader
    must still get the previous block rather than nothing."""
    import threading
    main._LIVE_SOURCES_CACHE.clear()
    _stub(monkeypatch, "old")
    main._live_notification_sources(48)

    _stub(monkeypatch, "new", delay=0.4)
    seen = []

    def rebuild():
        main._live_notification_sources(48, force=True)

    t = threading.Thread(target=rebuild)
    t.start()
    time.sleep(0.15)                      # mid-rebuild
    seen.append(main._live_notification_sources(48))
    t.join()

    assert seen[0] == [{"id": "old"}], "a reader saw an empty cache mid-rebuild"
    assert main._live_notification_sources(48) == [{"id": "new"}]


def test_an_expired_entry_is_rebuilt(monkeypatch):
    main._LIVE_SOURCES_CACHE.clear()
    _stub(monkeypatch, "a")
    main._live_notification_sources(48)
    stamp, val = main._LIVE_SOURCES_CACHE[(48,)]
    main._LIVE_SOURCES_CACHE[(48,)] = (stamp - main._LIVE_SOURCES_TTL_S * 2, val)
    _stub(monkeypatch, "b")
    assert main._live_notification_sources(48) == [{"id": "b"}]


def test_one_failing_source_does_not_lose_the_others(monkeypatch):
    main._LIVE_SOURCES_CACHE.clear()
    import live_notifications as ln
    _stub(monkeypatch, "kept")

    def boom(**_k):
        raise RuntimeError("geoconfirmed down")
    monkeypatch.setattr(ln, "geoconfirmed_items", boom)
    assert main._live_notification_sources(48) == [{"id": "kept"}]


def test_concurrent_cold_callers_build_only_once(monkeypatch):
    """The post-deploy condition, which produced the worst numbers seen.

    Build-then-swap stops the warmer emptying the cache, but does
    nothing about several callers arriving when there is nothing to
    serve yet — without a single-flight guard each starts its own
    rebuild. Measured right after a deploy: 45.3s, 11.1s, 5.7s, 0.5s,
    35.7s, 17.1s, because the front end polls every 20s and every poll
    began another build.
    """
    import threading
    main._LIVE_SOURCES_CACHE.clear()
    builds = []

    import live_notifications as ln
    monkeypatch.setattr(ln, "gdelt_items", lambda **_k: [])
    monkeypatch.setattr(ln, "geoconfirmed_items", lambda **_k: [])
    monkeypatch.setattr(ln, "frontline_items", lambda **_k: [])
    monkeypatch.setattr(ln, "risk_change_items", lambda _r: [])

    def derived():
        builds.append(1)
        time.sleep(0.3)
        return [{"id": "x"}]
    monkeypatch.setattr(ln, "derived_items", derived)

    threads = [threading.Thread(target=lambda: main._live_notification_sources(48))
               for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(builds) == 1, f"{len(builds)} concurrent rebuilds; expected 1"


def test_a_waiter_gets_the_builders_result(monkeypatch):
    import threading
    main._LIVE_SOURCES_CACHE.clear()
    _stub(monkeypatch, "built", delay=0.3)
    out = []
    threads = [threading.Thread(target=lambda: out.append(main._live_notification_sources(48)))
               for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(o == [{"id": "built"}] for o in out), out
