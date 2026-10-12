"""position_stream.py — live positions pushed to whoever may see them.

    POST /api/positions/stream-token   a token to open the stream with (60 s to use it)
    GET  /api/positions/stream         Server-Sent Events: a snapshot, then every position

REAL TIME (owner, 2026-10-12: "the location has to update in real time").
The phone sends a position every few seconds while it moves (POST
/api/my-assets/live); each one is pushed here, at once, to every open
stream allowed to see it — no viewer polls for it.

WHO SEES WHAT (can_see / visible_assets), the rules the rest of the app
already has: a person's position goes to themselves, to admins, and to the
team — everyone signed in, as GET /api/my-assets/people shows it, except
that two people in DIFFERENT teams (users.team_id, both set) do not see
each other. An asset moved with them is named only to its owner, admins,
or everyone when it is shared.

AUTH ACROSS SITES. The page is on Vercel and the API on Railway, so the
session is a bearer token the page holds (src/lib/desktopAuth.js) — and
EventSource cannot send headers. The page asks for a stream token with an
ordinary authenticated POST and opens the stream with ?t=. A stream token
lives 60 s, opens only this stream (aud "pos-stream"), and is no session:
the session decoder refuses a token with an audience. A same-site page's
cookie, or a bearer header (fetch-streaming), work too.

ONE PROCESS. Positions arrive by HTTP, and only the web process serves HTTP
(start.sh: the worker binds a loopback port nothing connects to), so the
hub is in memory, in the process that receives them and serves the streams.
publish() is called from the threadpool (POST /live is a plain def) and
hands the event to the event loop with call_soon_threadsafe — the loop
never waits on the database for it. A process with no open stream (the
worker; a web process before anyone opens the map) publishes into nothing.

BEHIND RAILWAY. A comment every 15 s keeps the connection open through the
edge (with a `ping` event, which EventSource — blind to comments — can see:
the page reconnects after 40 s of silence); X-Accel-Buffering: no and no gzip (Starlette leaves
text/event-stream alone) so each event leaves at once. A stream ends
itself after STREAM_MAX_S, and at once when the server is shutting down —
uvicorn waits for open responses before it exits, and an endless stream
would hold a deploy. The client reconnects (src/location/positionStream.js).
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import signal
import threading
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/positions", tags=["positions"])

TOKEN_AUD = "pos-stream"
TOKEN_TTL_S = 60
KEEPALIVE_S = 15.0
STREAM_MAX_S = 30 * 60
QUEUE_MAX = 200
TICK_S = 1.0


# ── who may see whom ──────────────────────────────────────────────────────

def is_admin(user: dict) -> bool:
    return bool(user.get("is_super_admin")) or str(user.get("role") or "").lower() == "admin"


def can_see(viewer: dict, subject_id: str, subject_team: str | None) -> bool:
    if str(viewer.get("id")) == str(subject_id) or is_admin(viewer):
        return True
    vt = viewer.get("team_id")
    return not (vt and subject_team and str(vt) != str(subject_team))


def visible_assets(viewer: dict, assets: list[dict]) -> list[dict]:
    vid = str(viewer.get("id"))
    return [{"id": a["id"]} for a in assets
            if a.get("shared") or str(a.get("owner_id")) == vid or is_admin(viewer)]


# ── the hub ───────────────────────────────────────────────────────────────

class Subscriber:
    def __init__(self, viewer: dict):
        self.viewer = viewer
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
        self.dropped = 0

    def put(self, ev: dict) -> None:
        # a viewer too slow to read loses the OLDEST position, never the newest
        while True:
            try:
                self.queue.put_nowait(ev)
                return
            except asyncio.QueueFull:
                try:
                    self.queue.get_nowait()
                    self.dropped += 1
                except asyncio.QueueEmpty:
                    return


class Hub:
    def __init__(self):
        self._subs: set[Subscriber] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()
        self.published = 0

    def subscribe(self, viewer: dict) -> Subscriber:
        """On the event loop."""
        sub = Subscriber(viewer)
        with self._lock:
            self._loop = asyncio.get_running_loop()
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    def count(self) -> int:
        with self._lock:
            return len(self._subs)

    def publish(self, ev: dict) -> None:
        """From any thread: hand the event to the loop and return at once."""
        with self._lock:
            loop, any_sub = self._loop, bool(self._subs)
        if not any_sub or loop is None or loop.is_closed():
            return
        self.published += 1
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._deliver(ev)
        else:
            try:
                loop.call_soon_threadsafe(self._deliver, ev)
            except RuntimeError:                              # loop closed meanwhile
                pass

    def _deliver(self, ev: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            out = for_viewer(s.viewer, ev)
            if out is not None:
                s.put(out)


HUB = Hub()


def for_viewer(viewer: dict, ev: dict) -> dict | None:
    """The event as this viewer may see it, or None."""
    if not can_see(viewer, ev["user_id"], ev.get("team_id")):
        return None
    out = {k: v for k, v in ev.items() if k not in ("team_id", "assets")}
    out["assets"] = visible_assets(viewer, ev.get("assets") or [])
    return out


def publish_position(user: dict, lat: float, lon: float, accuracy_m, source: str, at: str, moved: list[dict]) -> None:
    """One accepted position, to every stream allowed to see it (POST /live)."""
    HUB.publish({
        "type": "position", "user_id": str(user.get("id") or user.get("email")),
        "name": (user.get("name") or (user.get("email") or "").split("@")[0] or "Someone"),
        "team_id": user.get("team_id"),
        "lat": lat, "lon": lon, "accuracy_m": accuracy_m, "source": source, "at": at,
        "assets": [{"id": m["id"], "owner_id": m.get("owner_id"), "shared": m.get("shared")} for m in moved or []],
    })


# ── tokens ────────────────────────────────────────────────────────────────

def make_token(user_id: str, now: float | None = None, ttl: int = TOKEN_TTL_S) -> str:
    from jose import jwt as _jwt
    import main as m
    now = time.time() if now is None else now
    return _jwt.encode({"sub": str(user_id), "aud": TOKEN_AUD, "exp": int(now + ttl), "iat": int(now)},
                       m.JWT_SECRET, algorithm=m.JWT_ALGORITHM)


def user_from_token(token: str) -> dict | None:
    from jose import jwt as _jwt, JWTError
    import main as m
    try:
        p = _jwt.decode(token, m.JWT_SECRET, algorithms=[m.JWT_ALGORITHM], audience=TOKEN_AUD)
    except JWTError:
        return None
    if p.get("aud") != TOKEN_AUD or not p.get("sub"):
        return None
    return _approved_user(p["sub"])


def _approved_user(uid: str) -> dict | None:
    import main as m
    from database import User, get_db
    with get_db() as db:
        u = db.query(User).filter(User.id == uid).first()
        return m._user_to_dict(u) if u and u.approved else None


def _viewer(request: Request, t: str | None) -> dict | None:
    if t:
        return user_from_token(t)
    import main as m
    return m._get_current_user(request)


# ── what a viewer sees on opening ─────────────────────────────────────────

def _users() -> dict:
    import sqlite3
    import owned_assets as oa
    try:
        con = sqlite3.connect(oa._db_path(), timeout=5)
        rows = con.execute("SELECT id, name, email, team_id FROM users").fetchall()
        con.close()
    except sqlite3.Error:
        return {}
    return {str(r[0]): {"name": r[1] or (r[2] or "").split("@")[0] or "Someone", "team_id": r[3]} for r in rows}


def snapshot(viewer: dict, hours: int = 24) -> list[dict]:
    """Everyone this viewer may see, at their latest position."""
    import owned_assets as oa
    users = _users()
    owners = {}
    try:
        con = oa._con(oa.LIVE_DB_TIMEOUT_S)
        owners = {r[0]: {"owner_id": r[1], "shared": bool(r[2])} for r in con.execute("SELECT id, owner_id, shared FROM owned_assets")}
        con.close()
    except Exception:                                        # noqa: BLE001
        pass
    out = []
    for p in oa.people(hours):
        u = users.get(str(p["user_id"]), {})
        if not can_see(viewer, p["user_id"], u.get("team_id")):
            continue
        assets = [{"id": a, **owners.get(a, {})} for a in p.get("assets") or []]
        out.append({"type": "position", "user_id": str(p["user_id"]), "name": u.get("name", "Someone"),
                    "lat": p["lat"], "lon": p["lon"], "accuracy_m": p.get("accuracy_m"), "source": p.get("source") or "gps",
                    "at": p["at"], "assets": visible_assets(viewer, assets)})
    return out


# ── shutting down ─────────────────────────────────────────────────────────

def _server_exiting() -> bool:
    """uvicorn's should_exit, read through the SIGTERM handler it installed."""
    try:
        h = signal.getsignal(signal.SIGTERM)
        srv = getattr(h, "__self__", None)
        return bool(getattr(srv, "should_exit", False))
    except Exception:                                        # noqa: BLE001
        return False


def _sse(ev: dict, name: str | None = None) -> str:
    return (f"event: {name}\n" if name else "") + f"data: {json.dumps(ev, separators=(',', ':'))}\n\n"


# ── the endpoints ─────────────────────────────────────────────────────────

@router.post("/stream-token")
def stream_token(request: Request):
    import main as m
    user = m._require_current_user(request)
    return {"token": make_token(str(user["id"])), "expires_in": TOKEN_TTL_S}


@router.get("/stream")
async def stream(request: Request, t: str | None = None, max_s: int | None = None):
    viewer = await run_in_threadpool(_viewer, request, t)       # the database, off the loop
    if not viewer:
        raise HTTPException(401, "authentication required (or the stream token has expired — ask for a new one)")
    life = min(STREAM_MAX_S, max(5, max_s)) if max_s else STREAM_MAX_S
    sub = HUB.subscribe(viewer)

    async def events():
        try:
            # 2 KB of comment: an intermediary that buffers the start of a
            # response lets the stream through at once
            yield ":" + " " * 2048 + "\n\nretry: 3000\n\n"
            try:
                snap = await asyncio.wait_for(run_in_threadpool(snapshot, viewer), timeout=10)
            except Exception:                                # noqa: BLE001 — the live events still flow
                snap = []
            yield _sse({"type": "snapshot", "people": snap, "server_time": _dt.datetime.now(_dt.timezone.utc).isoformat()}, "snapshot")
            started = last = time.monotonic()
            while True:
                if _server_exiting():
                    yield _sse({"type": "bye", "why": "server restarting"}, "bye")
                    return
                now = time.monotonic()
                if now - started >= life:
                    yield _sse({"type": "bye", "why": "reconnect"}, "bye")
                    return
                try:
                    ev = await asyncio.wait_for(sub.queue.get(), timeout=TICK_S)
                except asyncio.TimeoutError:
                    if time.monotonic() - last >= KEEPALIVE_S:
                        last = time.monotonic()
                        # a comment keeps the connection open through the edge; the
                        # ping lets the page see a silent, half-open connection
                        yield ": keepalive\n\nevent: ping\ndata: {}\n\n"
                    continue
                last = time.monotonic()
                yield _sse(ev, "position")
        finally:
            HUB.unsubscribe(sub)

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@router.get("/stats")
def stats(request: Request):
    import main as m
    m._require_current_user(request)
    return {"streams": HUB.count(), "published": HUB.published}
