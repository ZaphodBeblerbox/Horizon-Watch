"""shared_cache.py — one build serves everyone: single flight, stale while
revalidate, build then swap.

WHY (2026-10-19). With three phones open the API stopped answering: Railway's
edge saw 60-115 requests in flight from four clients, every endpoint slow
together, /api/health/live 111 s inside the server. Not a crash — no OOM,
no restart, no event-loop stall long enough for [loop-lag]. The CPU went to
derived data rebuilt on request paths: a cache that expires is rebuilt by
EVERY caller that finds it expired, at once, each one slowed by the others
under the GIL, while new requests keep arriving and the thread pool fills.

The rule this module enforces, per key:
  · fresh (younger than `ttl`): served from memory;
  · stale (younger than `max_stale`): served from memory at once, and ONE
    background thread rebuilds it (never a second while one runs);
  · missing or too old: ONE caller builds; everyone else asking for the
    same key waits for that build and takes its result.
A build that fails keeps the previous value (and is retried at the next
stale read), so a failing source never blanks a layer.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Hashable


class SharedCache:
    def __init__(self, name: str, ttl: float, max_stale: float, clock: Callable[[], float] = time.monotonic,
                 max_entries: int = 16):
        if max_stale < ttl:
            raise ValueError("max_stale must be at least ttl")
        self.name, self.ttl, self.max_stale, self._clock = name, ttl, max_stale, clock
        # BOUNDED (2026-10-23): a key can carry a request's parameter
        # (/api/telegram/posts?hours=1..720, pins or not: 1,440 keys, each a
        # whole list of posts). Past max_entries the oldest entries go.
        self.max_entries = max_entries
        self._entries: dict = {}            # key -> (built_at, value)
        self._lock = threading.Lock()       # guards the dicts below
        self._building: dict = {}           # key -> threading.Event, set when that build ends
        self.builds = 0                     # how many builds ran (tests, diagnostics)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def expire(self) -> None:
        """New data arrived: the next read rebuilds (in the background,
        serving the current value meanwhile) instead of waiting out the ttl."""
        with self._lock:
            stale_at = self._clock() - self.ttl
            for k, (t, v) in list(self._entries.items()):
                self._entries[k] = (min(t, stale_at), v)

    def _prune(self, now: float) -> None:
        """Caller holds the lock. Only past the cap, oldest first: a too-old
        entry is still the fallback when its own rebuild fails."""
        if len(self._entries) > self.max_entries:
            for k, _ in sorted(self._entries.items(), key=lambda kv: kv[1][0])[:len(self._entries) - self.max_entries]:
                del self._entries[k]

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def peek(self, key: Hashable):
        with self._lock:
            hit = self._entries.get(key)
        return hit[1] if hit else None

    def _run_build(self, key: Hashable, build: Callable[[], Any], done: threading.Event):
        try:
            value = build()
            with self._lock:
                now = self._clock()
                self._entries[key] = (now, value)
                self.builds += 1
                self._prune(now)
            return value
        finally:
            with self._lock:
                self._building.pop(key, None)
            done.set()

    def get(self, key: Hashable, build: Callable[[], Any]):
        now = self._clock()
        with self._lock:
            hit = self._entries.get(key)
            age = now - hit[0] if hit else None
            if hit and age < self.ttl:
                return hit[1]
            running = self._building.get(key)
            if hit and age < self.max_stale:
                if running is None:
                    done = threading.Event()
                    self._building[key] = done

                    def _bg():
                        try:
                            self._run_build(key, build, done)
                        except Exception as e:      # noqa: BLE001 — keep serving the previous value
                            print(f"[{self.name}] error: background build: {type(e).__name__}: {e}", flush=True)
                    threading.Thread(target=_bg, name=f"{self.name}-build", daemon=True).start()
                return hit[1]
            if running is None:
                done = threading.Event()
                self._building[key] = done
                mine = True
            else:
                done, mine = running, False
        if mine:
            try:
                return self._run_build(key, build, done)
            except Exception:
                if hit:                             # too old, but better than nothing
                    return hit[1]
                raise
        done.wait()
        with self._lock:
            after = self._entries.get(key)
        if after:
            return after[1]
        # the build we waited on failed: build ourselves (rare; keeps the error visible)
        return self.get(key, build)
