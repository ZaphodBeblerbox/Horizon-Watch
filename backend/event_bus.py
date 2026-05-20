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
