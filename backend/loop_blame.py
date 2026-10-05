"""
loop_blame.py — when the event loop stalls, name the function that did it.

WHY THIS EXISTS. The loop-lag watchdog in main.py measures stalls
accurately and has done so for months, but it can only ever report the
size of a block, never its cause: the coroutine that would record the
cause is itself the thing that cannot run. Every diagnosis so far has
therefore been by inference — fusion rescoring, SQLite contention,
shapely rebuilds — and each one was only partly right. On macOS py-spy
needs root, so the usual escape hatch is closed on a developer laptop,
which is exactly where this gets debugged.

HOW. A plain OS thread, outside the loop entirely, samples the MAIN
thread's Python stack on a fixed interval and keeps a short ring buffer
of (timestamp, stack) pairs. A blocked loop does not block this thread:
a C-level call (socket read, sqlite3 step, file I/O) releases the GIL
outright, and a CPU-bound Python loop still yields every few
milliseconds at the interpreter's switch interval. So when the watchdog
finally wakes and reports a 19s stall, the samples covering those 19
seconds are already on the shelf, and the deepest frame they share is
the answer.

WHAT IT COSTS. One thread, one `sys._current_frames()` call every
250 ms, and a bounded deque. It is cheap enough to leave running, which
matters because the stalls that matter appear under real load and not in
a profiler.
"""
from __future__ import annotations

import collections
import os
import sys
import threading
import time
import traceback

SAMPLE_INTERVAL_S = 0.25
#: Two minutes of samples. Longer than any stall worth attributing, and
#: small enough that the buffer is never a memory question.
RING = int(120 / SAMPLE_INTERVAL_S)

_samples: collections.deque = collections.deque(maxlen=RING)
_main_id: int | None = None
_started = False


def start() -> None:
    """Begin sampling. Safe to call twice; the second call does nothing."""
    global _started, _main_id
    if _started:
        return
    _started = True
    _main_id = threading.main_thread().ident

    def _sampler() -> None:
        while True:
            try:
                frame = sys._current_frames().get(_main_id)
                if frame is not None:
                    _samples.append((time.monotonic(), traceback.extract_stack(frame)))
            except Exception:
                # A diagnostic that can take the process down is worse than
                # no diagnostic at all.
                pass
            time.sleep(SAMPLE_INTERVAL_S)

    threading.Thread(target=_sampler, name="loop-blame", daemon=True).start()


#: Our own code lives here. A frame inside this tree is the answer; a frame
#: in sqlalchemy or asyncio is only ever the mechanism.
_OURS = os.path.dirname(os.path.abspath(__file__))


def _interesting(stack) -> str | None:
    """The deepest frame that is OURS.

    Reporting the deepest frame overall was true but useless: every stall
    came back as `do_execute()` or `fetchall()`, which says "SQL" and names
    no caller. The question is always which of ours asked for it, so the
    search is for the deepest frame under this directory, and the
    library frame is kept only as a fallback when nothing of ours is on
    the stack at all.
    """
    fallback = None
    for fr in reversed(stack):
        f = fr.filename
        if "/asyncio/" in f or f.endswith("selectors.py") or "/threading.py" in f:
            continue
        label = f"{f.rsplit('/', 1)[-1]}:{fr.lineno} in {fr.name}()"
        if fallback is None:
            fallback = label
        if f.startswith(_OURS) and "loop_blame.py" not in f:
            return label
    return fallback


def deep_blame(since: float, until: float) -> str:
    """The full chain of OUR frames from the longest-held sample.

    For a stall measured in minutes, the top-three summary names the leaf
    and not the path that reached it — and the path is the fix. This prints
    one representative stack, ours only, outermost first.
    """
    window = [s for t, s in _samples if since <= t <= until]
    if not window:
        return ""
    stack = window[len(window) // 2]
    ours = [f"{fr.filename.rsplit('/', 1)[-1]}:{fr.lineno} {fr.name}()"
            for fr in stack
            if fr.filename.startswith(_OURS) and "loop_blame.py" not in fr.filename]
    return " -> ".join(ours[-8:]) if ours else ""


def blame(since: float, until: float, limit: int = 3) -> str:
    """Attribute the window [since, until] to the frames seen most in it."""
    window = [s for t, s in _samples if since <= t <= until]
    if not window:
        return "no samples (sampler not started, or the stall predates it)"
    counts: collections.Counter = collections.Counter()
    for stack in window:
        name = _interesting(stack)
        if name:
            counts[name] += 1
    if not counts:
        return f"{len(window)} samples, none attributable"
    total = sum(counts.values())
    parts = [f"{n} {100 * c / total:.0f}%" for n, c in counts.most_common(limit)]
    return f"{len(window)} samples — " + " | ".join(parts)
