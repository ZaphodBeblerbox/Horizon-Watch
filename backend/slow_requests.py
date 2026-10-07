"""slow_requests.py — log requests that take 5 s or more (kept apart from main.py so
loop_blame does not mistake it, the outermost frame of every request, for a culprit)."""


class SlowRequestLog:
    """Log every request that takes 5 s or more: method, path, status, bytes.

    The loop-lag watchdog says the loop was blocked and by which frames, but
    a stall inside FastAPI's response encoding has none of our frames on the
    stack — this names the endpoint. Pure ASGI, so it costs a clock read.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        import time as _t
        t0 = _t.monotonic()
        meta = {"status": None, "bytes": 0}

        async def _send(msg):
            if msg["type"] == "http.response.start":
                meta["status"] = msg.get("status")
            elif msg["type"] == "http.response.body":
                meta["bytes"] += len(msg.get("body") or b"")
            await send(msg)
        try:
            await self.app(scope, receive, _send)
        finally:
            dt = _t.monotonic() - t0
            if dt >= 5:
                print(f"[slow-request] {scope.get('method')} {scope.get('path')} {meta['status']} "
                      f"{meta['bytes']}B in {dt:.1f}s", flush=True)
