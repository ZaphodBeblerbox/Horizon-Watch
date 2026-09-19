"""
imagery_runtime.py — the one place imagery CPU work is allowed to run.

WHY THIS EXISTS. Imagery was the confirmed cause of a production event-loop
freeze, and the fix applied at the time only covered the Sentinel scanner.
Four other call sites still handed multi-minute ONNX inference to
`run_in_executor(None, ...)` — the DEFAULT executor, which is the very same
thread pool AnyIO/FastAPI uses to run every `def` (non-async) endpoint in the
app. A single large Overwatch scan (the code itself warns above 1000 tiles
that it "will take several minutes") could occupy those threads and starve
every sync endpoint in the process. The symptom is not "imagery is slow", it
is "everything 502s at once", which is exactly the signature that was chased
before.

So: ONE pool, ONE worker, for every CPU-bound imagery operation in the
backend — Esri/Overwatch inference, Sentinel optical detection, SAR
detection, PIL decode/encode, GeoTIFF parsing, numpy work.

WHY A SINGLE WORKER, deliberately. ONNX Runtime releases the GIL only
partially, and it is itself internally multi-threaded. Two concurrent
inferences on one box do not go twice as fast; they contend, and the
measured effect last round was health-probe stalls of 12.2s and 3.1s
DURING inference even after the work was moved off the loop. One worker
makes imagery cost predictable: a scan either has the pool or it waits.

WHY THE POOL IS THE SERIALISER rather than an asyncio.Semaphore.
`sentinel_scanner.run_scan()` is synchronous and drives its own
`asyncio.run()` from inside a `_scan_executor` worker thread. An
asyncio.Semaphore is bound to the loop that created it, so one created on
the main loop would not govern that nested loop at all. A
ThreadPoolExecutor with max_workers=1 governs every caller regardless of
which loop (or no loop) they are on. Admission control is therefore
thread-level, not task-level.

BACKPRESSURE, not an unbounded queue. If imagery is busy, a new request is
refused immediately with a real reason rather than queued behind several
minutes of inference until the client times out. A queue that nobody is
still waiting on is just a way to keep a CPU busy on work whose answer will
be discarded.

TIMEOUTS ARE HONEST. A Python thread cannot be killed. When a job exceeds
its deadline the caller is released and told so, but the slot stays held
until the thread actually finishes — releasing it early would let a second
job pile onto a core that is still fully occupied, which is the failure this
module exists to prevent.
"""
from __future__ import annotations

import asyncio
import functools
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor

# One worker, for the reasons in the module docstring. Configurable only so a
# beefier deployment can raise it deliberately — the default is the safe one.
_MAX_WORKERS = max(1, int(os.getenv("IMAGERY_CPU_WORKERS", "1")))

# How many callers may be waiting for the pool before new ones are refused.
# Small on purpose: imagery jobs are minutes long, so a deep queue only
# produces answers nobody is waiting for any more.
_MAX_QUEUE = max(1, int(os.getenv("IMAGERY_MAX_QUEUE", "2")))

# Default deadline for a single CPU job. A full Esri scan of a large box
# genuinely can take minutes, so this is generous; it exists to stop a wedged
# job holding the pool for ever, not to bound normal work.
DEFAULT_TIMEOUT_S = float(os.getenv("IMAGERY_JOB_TIMEOUT_S", "900"))

_POOL = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="imagery-cpu")

_lock = threading.Lock()
_pending = 0            # submitted-but-not-finished jobs (running + waiting)
_current: str | None = None
_started_at: float | None = None

# PROGRESS. Scans are uncapped by design, so one can legitimately run for
# minutes — a zone-sized AOI is 60 tiles at roughly 4.5s each. A long
# operation with no progress is indistinguishable from a hung one, and this
# codebase has already learned that rendering "no information" the same as
# "nothing happening" is how features quietly appear broken.
_progress: dict[str, dict] = {}


class ImageryBusy(RuntimeError):
    """The imagery pool is saturated. A real, reportable condition — not a bug."""


class ImageryTimeout(RuntimeError):
    """A job exceeded its deadline. The thread may still be running."""


def start_progress(job_id: str, total: int, *, label: str = "") -> None:
    """Register a multi-step job so a UI can draw a bar for it."""
    with _lock:
        _progress[job_id] = {
            "job_id": job_id, "label": label,
            "done": 0, "total": max(0, int(total)),
            "detections": 0, "started_at": time.monotonic(),
            "finished": False, "note": None,
        }


def update_progress(job_id: str, done: int, *, detections: int | None = None,
                    note: str | None = None) -> None:
    with _lock:
        p = _progress.get(job_id)
        if not p:
            return
        p["done"] = int(done)
        if detections is not None:
            p["detections"] = int(detections)
        if note is not None:
            p["note"] = note


def finish_progress(job_id: str, *, note: str | None = None) -> None:
    with _lock:
        p = _progress.get(job_id)
        if p:
            p["finished"] = True
            p["done"] = p["total"]
            if note is not None:
                p["note"] = note


def _render_progress(p: dict) -> dict:
    elapsed = time.monotonic() - p["started_at"]
    frac = (p["done"] / p["total"]) if p["total"] else 0.0
    # Remaining time from OBSERVED rate, not from the up-front guess: the
    # estimate a plan made before fetching is the right thing to show at
    # step zero and the wrong thing to keep showing at step forty.
    eta = None
    if p["done"] > 0 and not p["finished"]:
        eta = round((elapsed / p["done"]) * (p["total"] - p["done"]), 1)
    return {**{k: v for k, v in p.items() if k != "started_at"},
            "fraction": round(frac, 3),
            "elapsed_s": round(elapsed, 1),
            "eta_s": eta}


def progress(job_id: str | None = None):
    """Progress for one job, or every live job."""
    with _lock:
        if job_id is not None:
            p = _progress.get(job_id)
            return _render_progress(p) if p else None
        return [_render_progress(p) for p in _progress.values()]


def clear_finished_progress(older_than_s: float = 300.0) -> None:
    """Drop finished jobs so the registry cannot grow without bound."""
    now = time.monotonic()
    with _lock:
        for k in [k for k, p in _progress.items()
                  if p["finished"] and now - p["started_at"] > older_than_s]:
            del _progress[k]


def status() -> dict:
    """What the pool is doing right now — for /api/health/detailed and the UI."""
    with _lock:
        live = [_render_progress(p) for p in _progress.values() if not p["finished"]]
        return {
            "workers": _MAX_WORKERS,
            "pending": _pending,
            "max_queue": _MAX_QUEUE,
            "busy": _pending > 0,
            "current": _current,
            "running_for_s": round(time.monotonic() - _started_at, 1) if _started_at else None,
            "jobs": live,
        }


def _admit(label: str) -> None:
    global _pending, _current, _started_at
    with _lock:
        if _pending >= _MAX_WORKERS + _MAX_QUEUE:
            raise ImageryBusy(
                f"imagery pool saturated ({_pending} job(s) in flight, "
                f"current={_current!r}) — try again when the running scan finishes"
            )
        _pending += 1
        if _current is None:
            _current = label
            _started_at = time.monotonic()


def _retire(label: str) -> None:
    global _pending, _current, _started_at
    with _lock:
        _pending = max(0, _pending - 1)
        if _pending == 0:
            _current = None
            _started_at = None
        elif _current == label:
            _current = f"(after {label})"


def _on_pool_thread() -> bool:
    return threading.current_thread().name.startswith("imagery-cpu")


def submit(fn, *args, label: str = "imagery", **kwargs):
    """Submit CPU work to the imagery pool. Returns a concurrent.futures.Future.

    Raises ImageryBusy immediately if the pool is saturated. The slot is
    released when the thread genuinely finishes, never before.
    """
    # RE-ENTRANCY. With max_workers=1, a pool thread that submits to the pool
    # and waits for the result would wait for itself — a permanent deadlock,
    # and a very easy one to introduce later by calling one imagery helper
    # from inside another. Already holding the worker means already holding
    # the right to use the CPU, so run inline instead.
    if _on_pool_thread():
        f: Future = Future()
        try:
            f.set_result(fn(*args, **kwargs))
        except BaseException as e:      # noqa: BLE001 — propagated via the future
            f.set_exception(e)
        return f

    _admit(label)
    try:
        fut = _POOL.submit(functools.partial(fn, *args, **kwargs))
    except BaseException:
        _retire(label)
        raise
    fut.add_done_callback(lambda _f, _l=label: _retire(_l))
    return fut


async def run_cpu(fn, *args, label: str = "imagery",
                  timeout: float | None = None, **kwargs):
    """Await CPU-bound imagery work on the dedicated pool.

    Uses get_running_loop(), not get_event_loop(): the latter raises inside an
    AnyIO worker thread, which was a real bug in this codebase before.
    """
    loop = asyncio.get_running_loop()
    fut = submit(fn, *args, label=label, **kwargs)
    # shield: on timeout we stop waiting, but we must NOT cancel the thread's
    # future, because the slot's release is tied to its completion.
    aio_fut = asyncio.wrap_future(fut, loop=loop)
    try:
        return await asyncio.wait_for(
            asyncio.shield(aio_fut),
            timeout if timeout is not None else DEFAULT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        raise ImageryTimeout(
            f"imagery job {label!r} exceeded "
            f"{timeout if timeout is not None else DEFAULT_TIMEOUT_S:.0f}s; "
            f"it is still running and the pool stays held until it finishes"
        ) from None


def run_cpu_blocking(fn, *args, label: str = "imagery",
                     timeout: float | None = None, **kwargs):
    """Synchronous equivalent, for callers already on a worker thread
    (sentinel_scanner.run_scan and anything it drives via asyncio.run)."""
    fut = submit(fn, *args, label=label, **kwargs)
    try:
        return fut.result(timeout=timeout if timeout is not None else DEFAULT_TIMEOUT_S)
    except TimeoutError:
        raise ImageryTimeout(
            f"imagery job {label!r} exceeded its deadline; still running"
        ) from None
