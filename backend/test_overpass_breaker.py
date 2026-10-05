"""
When Overpass is down, stop asking.

Overpass is a volunteer-run public endpoint that rate-limits and goes down
for everyone at once. This app's response was three retries across three
mirrors at 40s each — up to six minutes of certain-to-fail waiting per
caller — while the infrastructure prefetch spawned one thread per surface
signal. The process reached 403 threads, all parked on sockets, the GIL
thrashed, and because /api/health/live is a sync `def` it could not get an
anyio threadpool slot either: the healthcheck timed out on a process that
was otherwise fine.
"""
import time

import main


def _reset():
    main._overpass_fails = 0
    main._overpass_cold_until = 0.0


def test_a_healthy_endpoint_is_never_cold():
    _reset()
    assert main._overpass_is_cold() is False


def test_the_breaker_opens_after_repeated_failures():
    _reset()
    for _ in range(main._OVERPASS_FAIL_THRESHOLD - 1):
        main._overpass_note_failure()
    # Not yet: a couple of failures is a bad minute, not an outage.
    assert main._overpass_is_cold() is False
    main._overpass_note_failure()
    assert main._overpass_is_cold() is True
    _reset()


def test_a_success_closes_it_again():
    _reset()
    for _ in range(main._OVERPASS_FAIL_THRESHOLD):
        main._overpass_note_failure()
    assert main._overpass_is_cold() is True
    main._overpass_note_success()
    assert main._overpass_is_cold() is False
    _reset()


def test_a_cold_breaker_returns_empty_without_a_request(monkeypatch):
    """Every caller already handles an empty result — the map draws no
    infrastructure layer — so failing fast is strictly better than failing
    slowly."""
    _reset()
    for _ in range(main._OVERPASS_FAIL_THRESHOLD):
        main._overpass_note_failure()

    called = []
    monkeypatch.setattr(main.urllib.request, "urlopen",
                        lambda *a, **k: called.append(1))
    out = main._fetch_overpass("[out:json];node(1);out;")
    assert out == {"elements": []}
    assert not called, "a cold breaker must not open a socket"
    _reset()


def test_the_cooloff_expires():
    _reset()
    main._overpass_cold_until = time.time() - 1
    assert main._overpass_is_cold() is False
    _reset()


def test_the_prefetch_pool_is_bounded():
    """One thread per signal, on every pool rebuild, is what produced 403
    threads. Nothing waits on the prefetch, so queueing is free."""
    assert main._prefetch_executor._max_workers <= 8
