"""Bounded, shedding sanctions checks.

A thread pool's work queue is unbounded. Giving the AIS sanctions check
its own threads stops it starving the HTTP pool, but if hits arrive
faster than those threads clear them the backlog grows until the
container is killed — the same outage by a slower route.
"""
import asyncio
import importlib


def _main():
    return importlib.import_module("main")


def test_there_is_a_bound_at_all():
    m = _main()
    assert isinstance(m._SANCTIONS_MAX_INFLIGHT, int)
    assert 0 < m._SANCTIONS_MAX_INFLIGHT <= 1024


def test_it_sheds_instead_of_queueing_when_saturated(monkeypatch):
    m = _main()
    called = {"n": 0}
    monkeypatch.setattr(m, "_check_sanctions_on_update_sync",
                        lambda _v: called.__setitem__("n", called["n"] + 1))
    monkeypatch.setattr(m, "_sanctions_inflight", m._SANCTIONS_MAX_INFLIGHT)

    asyncio.run(m._check_sanctions_on_update({"mmsi": "123456789"}))
    assert called["n"] == 0, "a saturated pool must shed, not queue"


def test_it_runs_normally_when_not_saturated(monkeypatch):
    m = _main()
    called = {"n": 0}
    monkeypatch.setattr(m, "_check_sanctions_on_update_sync",
                        lambda _v: called.__setitem__("n", called["n"] + 1))
    monkeypatch.setattr(m, "_sanctions_inflight", 0)

    asyncio.run(m._check_sanctions_on_update({"mmsi": "123456789"}))
    assert called["n"] == 1


def test_the_counter_is_released_even_when_the_check_raises(monkeypatch):
    # A leaked counter would wedge the detector permanently shut: it
    # would shed everything forever and look exactly like a feed that
    # had gone quiet.
    m = _main()

    def boom(_v):
        raise RuntimeError("sanctions store unavailable")

    monkeypatch.setattr(m, "_check_sanctions_on_update_sync", boom)
    monkeypatch.setattr(m, "_sanctions_inflight", 0)

    try:
        asyncio.run(m._check_sanctions_on_update({"mmsi": "123456789"}))
    except RuntimeError:
        pass
    assert m._sanctions_inflight == 0, "in-flight counter leaked on failure"


def test_a_vessel_with_no_mmsi_is_ignored(monkeypatch):
    m = _main()
    called = {"n": 0}
    monkeypatch.setattr(m, "_check_sanctions_on_update_sync",
                        lambda _v: called.__setitem__("n", called["n"] + 1))
    asyncio.run(m._check_sanctions_on_update({}))
    assert called["n"] == 0


def test_the_feed_has_its_own_pool_not_the_shared_one():
    # The whole point: work whose arrival rate is set by an external
    # feed must not share threads with work a user is waiting on.
    m = _main()
    assert m._sanctions_executor is not m._executor
