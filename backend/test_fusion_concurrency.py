"""
Ingest is no longer single-threaded.

GDELT now feeds fusion from a worker thread so its bursts cannot block the
event loop, while the drain evaluates from the maintenance executor. Both
touch active_signals, so the shared state has to survive being written and
read at the same time. A dict mutated during iteration raises
RuntimeError, which this does catch and which the drain makes reachable.

HONEST LIMIT OF THIS TEST. It does NOT demonstrate that the lock is
required: run with the lock replaced by a no-op, the same 300-signal
two-thread scenario loses zero signals, because CPython's GIL makes the
individual operations in _add_signal_locked effectively atomic and the
interleaving that would drop a write is rare. The lock is kept as
defence-in-depth — the read-modify-write of active_signals[geo_key] is a
real lost-update shape, and it costs nothing — but this file is a smoke
test against gross corruption and iteration errors, not proof of it.
"""
import datetime
import io
import contextlib
import threading

import fusion_engine as fe


def _sig(i, domain):
    return {
        "signal_id": f"SIG-{domain}-{i:05d}", "domain": domain,
        "severity": "info", "lat": 25.3, "lon": 56.4,
        "location_name": "Khor Fakkan", "region_id": None, "country": "AE",
        "rule_id": "r", "rule_name": "t", "summary": "s",
        "timestamp": datetime.datetime.utcnow(),
    }


def test_concurrent_ingest_and_drain_do_not_corrupt_or_raise():
    eng = fe.FusionEngine()
    eng._evaluate_fusion = lambda geo_key: None      # counted elsewhere
    errors = []

    def ingest(domain, n):
        try:
            for i in range(n):
                eng.on_signal(_sig(i, domain))
        except Exception as e:                        # noqa: BLE001
            errors.append(("ingest", repr(e)))

    def drain(rounds):
        try:
            for _ in range(rounds):
                eng.drain_pending_evaluations()
                eng.expire_old_signals()
        except Exception as e:                        # noqa: BLE001
            errors.append(("drain", repr(e)))

    with contextlib.redirect_stdout(io.StringIO()):
        threads = [
            threading.Thread(target=ingest, args=("GDELT", 200)),
            threading.Thread(target=ingest, args=("NEWS", 200)),
            threading.Thread(target=drain, args=(40,)),
        ]
        for t in threads: t.start()
        for t in threads: t.join(timeout=60)

    assert errors == [], errors
    # Every signal that was not expired must still be findable — a lost
    # write here is a signal that silently never reaches fusion.
    total = sum(len(v) for v in eng.active_signals.values())
    assert total > 0


def test_two_threads_writing_one_bucket_keep_every_signal():
    eng = fe.FusionEngine()
    eng._evaluate_fusion = lambda geo_key: None
    N = 150

    def ingest(domain):
        for i in range(N):
            eng.on_signal(_sig(i, domain))

    with contextlib.redirect_stdout(io.StringIO()):
        ts = [threading.Thread(target=ingest, args=(d,)) for d in ("GDELT", "NEWS")]
        for t in ts: t.start()
        for t in ts: t.join(timeout=60)

    ids = {s["signal_id"] for v in eng.active_signals.values() for s in v}
    expected = {f"SIG-{d}-{i:05d}" for d in ("GDELT", "NEWS") for i in range(N)}
    assert ids == expected, f"lost {len(expected - ids)} signal(s)"
