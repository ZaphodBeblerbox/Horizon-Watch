"""
event_bus.py — Lightweight async pub/sub for internal pipeline events.

Usage (from async context):
    await event_bus.publish(Events.ALERT_CREATED, {...})

Usage (from executor/sync thread):
    event_bus.publish_sync(Events.ALERT_CREATED, {...})

publish_sync uses asyncio.run_coroutine_threadsafe, so the event loop
must be registered via event_bus.set_loop(loop) during startup.
"""

from __future__ import annotations
import asyncio
from collections import defaultdict
from datetime import datetime
from typing import Callable


class EventBus:
    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._queue: asyncio.Queue | None = None
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        #: Browser connections holding an SSE stream open. See add_listener.
        self._listeners: list[asyncio.Queue] = []

    # ── Setup ──────────────────────────────────────────────────────────────

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """Called once from startup_event() to register the running loop."""
        self._loop = loop

    def subscribe(self, event_type: str, handler: Callable):
        self._subscribers[event_type].append(handler)
        print(f"[event-bus] {handler.__name__} -> {event_type}")

    # ── Publish ────────────────────────────────────────────────────────────

    async def publish(self, event_type: str, payload: dict):
        if self._queue is None:
            return
        await self._queue.put({
            "type":      event_type,
            "payload":   payload,
            "timestamp": datetime.utcnow().isoformat(),
        })

    def publish_sync(self, event_type: str, payload: dict):
        """Thread-safe publish from executor threads. Requires set_loop() first."""
        if self._loop is None or not self._loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(
            self.publish(event_type, payload), self._loop
        )

    # ── Processing loop ────────────────────────────────────────────────────

    async def start(self):
        self._queue = asyncio.Queue()
        self._running = True
        print("[event-bus] started")
        while self._running:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=1.0)
                event_type = event["type"]
                # Browsers first: a subscriber that takes a second to run
                # must not make the UI a second late.
                self._fan_out(event)
                for handler in list(self._subscribers.get(event_type, [])):
                    try:
                        if asyncio.iscoroutinefunction(handler):
                            await handler(event["payload"])
                        else:
                            handler(event["payload"])
                    except Exception as ex:
                        print(f"[event-bus] {handler.__name__} failed on {event_type}: {ex}")
            except asyncio.TimeoutError:
                continue
            except Exception as ex:
                print(f"[event-bus] loop error: {ex}")

    def stop(self):
        self._running = False

    # ── Live listeners (the SSE stream) ────────────────────────────────────
    #
    # SEPARATE FROM subscribe(), and deliberately. A subscriber is a piece of
    # this backend that DOES something with an event and is allowed to be
    # slow. A listener is a browser holding a connection open, and there may
    # be several of them, some on bad networks, some that have gone away
    # without saying so. Feeding those through the same handler list would
    # let one stalled reader hold up the pipeline that writes alerts.
    #
    # So listeners get their own bounded queues, and a listener that cannot
    # keep up loses events rather than slowing anything down. That is the
    # right trade for this data: the stream is a nudge to refetch, not the
    # record itself, and the record is always in the API.

    def add_listener(self, maxsize: int = 100) -> "asyncio.Queue":
        q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self._listeners.append(q)
        return q

    def remove_listener(self, q: "asyncio.Queue") -> None:
        try:
            self._listeners.remove(q)
        except ValueError:
            pass

    def _fan_out(self, event: dict) -> None:
        for q in list(self._listeners):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # A reader that is this far behind has already lost the
                # thread; dropping the oldest keeps it current rather than
                # replaying a backlog it no longer needs.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass
            except Exception:
                pass


# ── Singleton ──────────────────────────────────────────────────────────────
event_bus = EventBus()


# ── Event type constants ───────────────────────────────────────────────────
class Events:
    ALERT_CREATED          = "alert.created"
    SIGNAL_CREATED         = "signal.created"
    ARTICLE_CREATED        = "news_article.created"
    FUSION_CREATED         = "fusion.created"
    SURGE_CREATED          = "surge.created"
    ONTOLOGY_LINK_CREATED  = "ontology_link.created"
    THREAT_REGION_DIRTY    = "threat_region.dirty"
    REGIONAL_SCAN_COMPLETE = "regional_scan.complete"
