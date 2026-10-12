"""
asset_warnings.py — a WARNING sent by hand to a person in the field.

THE OWNER, 2026-10-12: "I notice something off near an asset that's
moving: that warning must go above everything else: different noise,
different vibration, so it gets noticed."

    POST /api/warnings                 send one {to_user_id | asset_id, message, severity, route?}
    GET  /api/warnings/inbox           mine, not yet acknowledged (the takeover polls this)
    POST /api/warnings/{id}/ack        "Acknowledge" — back to whoever sent it
    POST /api/warnings/{id}/cancel     the sender withdraws it
    GET  /api/warnings/sent            what was sent about an asset or a person, and whether it was seen

WHAT ARRIVES. The person's devices get a push at once (main._send_push,
Urgency high, its own tag, requireInteraction and a long vibration where
the device has one — public/sw-push.js), even on a device with the app
open; an open app also gets it on the live stream (position_stream) and
from its own poll, and takes the whole screen in red with its own alarm
until "Acknowledge" (src/warnings/). It is not a notification-feed card:
the takeover is its card, and Do Not Disturb, muted sounds and the
relevance rules do not apply to it.

WHAT A WEB APP CANNOT DO, said in the UI too: an iPhone's silent switch and
Focus silence a web push and a web page alike, and iOS web pages cannot
vibrate at all.

UNSEEN, IT IS SENT AGAIN: every RESEND_S (default 2 min) while it is not
acknowledged, up to MAX_SENDS pushes (main._warning_resend_loop).

WHO MAY SEND. Whoever may see the person (position_stream.can_see_user:
their organisation, people linked to its assets, admins). With an asset,
the asset must be one the sender can see and the warning goes to the person
linked to it.

FOR WHAT COMES NEXT. send() takes an optional `route` payload (a route plan
id and anything a client needs to open it) and a `kind` ("warning"; later
"evacuate"): "advise evacuation" with a safe house and the safest route is
a warning carrying its route — the same channel, the same takeover, the
same acknowledgement.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import uuid

RESEND_S = int(os.getenv("WARNING_RESEND_S", "120") or 120)
MAX_SENDS = int(os.getenv("WARNING_MAX_SENDS", "5") or 5)
INBOX_HOURS = 24
SEVERITIES = ("warning", "critical")
KINDS = ("warning", "evacuate")
MAX_MESSAGE = 280

DDL = """
CREATE TABLE IF NOT EXISTS warnings (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'warning',
    from_user TEXT NOT NULL, from_name TEXT, to_user TEXT NOT NULL, to_name TEXT,
    asset_id TEXT, asset_name TEXT, message TEXT NOT NULL, severity TEXT NOT NULL,
    lat REAL, lon REAL, route TEXT,
    created_at TEXT NOT NULL, last_sent_at TEXT, sends INTEGER DEFAULT 0,
    seen_at TEXT, acked_at TEXT, cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_warnings_to ON warnings (to_user, created_at);
CREATE INDEX IF NOT EXISTS ix_warnings_asset ON warnings (asset_id, created_at);
"""


def _con(timeout: float = 30):
    # a warning is the one write that must not be lost to a busy database:
    # it waits for the lock (in the threadpool — every endpoint here is a
    # plain def — never on the event loop)
    import owned_assets as oa
    path = oa._db_path()
    con = sqlite3.connect(path, timeout=timeout)
    if path not in _ready:                                   # the table once per database, not on every call
        con.executescript(DDL)
        _ready.add(path)
    con.row_factory = sqlite3.Row
    return con


_ready: set = set()


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _uid(user: dict) -> str:
    return str(user.get("id") or user.get("email"))


def _name(user: dict) -> str:
    return user.get("name") or (user.get("email") or "").split("@")[0] or "Someone"


def public(r) -> dict:
    d = dict(r)
    try:
        d["route"] = json.loads(d["route"]) if d.get("route") else None
    except (TypeError, ValueError):
        d["route"] = None
    d["status"] = ("cancelled" if d.get("cancelled_at") else "acknowledged" if d.get("acked_at")
                   else "seen" if d.get("seen_at") else "sent")
    return d


def get(wid: str) -> dict | None:
    con = _con()
    try:
        r = con.execute("SELECT * FROM warnings WHERE id=?", (wid,)).fetchone()
    finally:
        con.close()
    return public(r) if r else None


# ── delivery ──────────────────────────────────────────────────────────────

def _default_push(uid: str, title: str, body: str, data: dict) -> list:
    import main as m
    # skip_open False: a device with the app open is told too — its service
    # worker hands it to the page, which takes the screen
    return m._send_push(uid, title, body, data, skip_open=False)


def push_content(w: dict, again: int = 0) -> tuple[str, str, dict]:
    """(title, body, data) of the push — the title is what it is, the text who and what."""
    title = ("EVACUATE" if w.get("kind") == "evacuate" else "WARNING") + (f" (reminder {again})" if again else "")
    where = f" — {w['asset_name']}" if w.get("asset_name") else ""
    body = f"{w.get('from_name') or 'Your team'}: {w['message']}{where}"[:220]
    route = w.get("route") if isinstance(w.get("route"), dict) else None
    return title, body, {"id": f"warn:{w['id']}", "kind": "warning", "severity": "critical", "warning_id": w["id"],
                         "asset_id": w.get("asset_id"), "lat": w.get("lat"), "lon": w.get("lon"),
                         "route_plan_id": (route or {}).get("route_plan_id")}


def _stream(to: list[str], event: str, w: dict) -> None:
    """At once, to the open streams of whoever it is for (position_stream)."""
    try:
        import position_stream as ps
        ps.HUB.publish({"type": "warning", "event": event, "to": [str(x) for x in to], "warning": w})
    except Exception:                                        # noqa: BLE001 — the push and the poll still deliver
        pass


def deliver(w: dict, push=None, again: int = 0) -> list:
    title, body, data = push_content(w, again)
    _stream([w["to_user"]], "warning", w)
    try:
        return (push or _default_push)(w["to_user"], title, body, data) or []
    except Exception as e:                                   # noqa: BLE001
        print(f"[warnings] push to {w['to_user']} failed: {type(e).__name__}: {e}", flush=True)
        return []


# ── the actions ───────────────────────────────────────────────────────────

class Refused(Exception):
    """The sender may not do that (answered 404/403 by the router)."""


def send(sender: dict, message: str, to_user_id: str | None = None, asset_id: str | None = None,
         severity: str = "critical", route: dict | None = None, kind: str = "warning",
         push=None, now: _dt.datetime | None = None) -> dict:
    """Send a warning — THE FUNCTION for anything that warns someone (a
    later "advise evacuation" passes kind="evacuate" and its route). Raises
    ValueError on a bad request, Refused when the sender may not."""
    import owned_assets as oa
    import position_stream as ps
    message = " ".join(str(message or "").split())
    if not message:
        raise ValueError("a warning needs a message")
    if len(message) > MAX_MESSAGE:
        raise ValueError(f"a warning is at most {MAX_MESSAGE} characters")
    if severity not in SEVERITIES:
        raise ValueError(f"severity is one of {', '.join(SEVERITIES)}")
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    if route is not None and not isinstance(route, dict):
        raise ValueError("route is an object")
    asset = None
    if asset_id:
        asset = oa.visible_to(str(asset_id), sender)
        if not asset:
            raise Refused("no such asset")
        linked = (asset.get("identifiers") or {}).get("user_id")
        if not linked:
            raise ValueError("nobody is linked to this asset — link a person first")
        if to_user_id and str(to_user_id) != str(linked):
            raise ValueError("that person is not the one linked to this asset")
        to_user_id = str(linked)
    if not to_user_id:
        raise ValueError("send it to a person or an asset")
    users = ps.user_index()
    if str(to_user_id) not in users:
        raise Refused("no such person")
    if not ps.can_see_user(sender, str(to_user_id)):
        raise Refused("no such person")
    now = now or _now()
    pos = None
    if asset and asset.get("lat") is not None:
        pos = (asset["lat"], asset["lon"])
    else:
        last = oa.latest(str(to_user_id))
        pos = (last["lat"], last["lon"]) if last else None
    wid = f"W-{uuid.uuid4().hex[:10]}"
    iso = now.isoformat()
    con = _con()
    try:
        con.execute("INSERT INTO warnings (id, kind, from_user, from_name, to_user, to_name, asset_id, asset_name, message, severity,"
                    " lat, lon, route, created_at, last_sent_at, sends) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                    (wid, kind, _uid(sender), _name(sender), str(to_user_id), users[str(to_user_id)].get("name"),
                     asset["id"] if asset else None, asset["name"] if asset else None, message, severity,
                     pos[0] if pos else None, pos[1] if pos else None, json.dumps(route) if route else None, iso, iso))
        con.commit()
    finally:
        con.close()
    w = get(wid)
    w["push"] = deliver(w, push)
    return w


def inbox(user: dict, now: _dt.datetime | None = None, mark_seen: bool = True) -> list[dict]:
    """Mine, unacknowledged, of the last day — and, read by an app on
    screen (mark_seen), from now on 'seen'."""
    now = now or _now()
    since = (now - _dt.timedelta(hours=INBOX_HOURS)).isoformat()
    con = _con()
    try:
        rows = con.execute("SELECT * FROM warnings WHERE to_user=? AND acked_at IS NULL AND cancelled_at IS NULL AND created_at >= ? "
                           "ORDER BY created_at", (_uid(user), since)).fetchall()
        unseen = [r["id"] for r in rows if not r["seen_at"]] if mark_seen else []
        if unseen:
            con.executemany("UPDATE warnings SET seen_at=? WHERE id=? AND seen_at IS NULL", [(now.isoformat(), i) for i in unseen])
            con.commit()
    finally:
        con.close()
    out = [public(r) for r in rows]
    for w in out:
        if w["id"] in unseen:
            w["seen_at"] = now.isoformat()
            _stream([w["from_user"]], "warning_update", {**w, "status": "seen"})
    return out


def ack(user: dict, wid: str, now: _dt.datetime | None = None, push=None) -> dict:
    """The person warned says they have it; whoever sent it is told."""
    now = now or _now()
    w = get(wid)
    if not w or w["to_user"] != _uid(user):
        raise Refused("no such warning")
    if not w.get("acked_at"):
        con = _con()
        try:
            con.execute("UPDATE warnings SET acked_at=?, seen_at=COALESCE(seen_at, ?) WHERE id=? AND acked_at IS NULL",
                        (now.isoformat(), now.isoformat(), wid))
            con.commit()
        finally:
            con.close()
        w = get(wid)
        _stream([w["from_user"]], "warning_update", w)
        try:
            (push or _default_push)(w["from_user"], "Warning acknowledged",
                                    f"{w.get('to_name') or 'They'} acknowledged: {w['message']}"[:220],
                                    {"id": f"warnack:{wid}", "kind": "system", "asset_id": w.get("asset_id")})
        except Exception:                                    # noqa: BLE001
            pass
    return w


def cancel(user: dict, wid: str, now: _dt.datetime | None = None) -> dict:
    import position_stream as ps
    w = get(wid)
    if not w or (w["from_user"] != _uid(user) and not ps.is_admin(user)):
        raise Refused("no such warning")
    con = _con()
    try:
        con.execute("UPDATE warnings SET cancelled_at=? WHERE id=? AND cancelled_at IS NULL AND acked_at IS NULL",
                    ((now or _now()).isoformat(), wid))
        con.commit()
    finally:
        con.close()
    w = get(wid)
    _stream([w["to_user"]], "warning_update", w)
    return w


def sent(user: dict, asset_id: str | None = None, to_user_id: str | None = None, limit: int = 10) -> list[dict]:
    """Warnings about an asset or to a person, newest first — for whoever may
    see the asset (or the person), so the whole desk sees what was sent and
    whether it was acknowledged."""
    import owned_assets as oa
    import position_stream as ps
    if asset_id:
        if not oa.visible_to(str(asset_id), user):
            raise Refused("no such asset")
        q, args = "asset_id=?", [str(asset_id)]
    elif to_user_id:
        if not ps.can_see_user(user, str(to_user_id)):
            raise Refused("no such person")
        q, args = "to_user=?", [str(to_user_id)]
    else:
        q, args = "from_user=?", [_uid(user)]
    con = _con()
    try:
        rows = con.execute(f"SELECT * FROM warnings WHERE {q} ORDER BY created_at DESC LIMIT ?", (*args, max(1, min(50, limit)))).fetchall()
    finally:
        con.close()
    return [public(r) for r in rows]


def resend_due(now: _dt.datetime | None = None, push=None) -> int:
    """Push again what is still unacknowledged after RESEND_S, up to MAX_SENDS."""
    now = now or _now()
    due_before = (now - _dt.timedelta(seconds=RESEND_S)).isoformat()
    since = (now - _dt.timedelta(hours=INBOX_HOURS)).isoformat()
    con = _con()
    try:
        rows = con.execute("SELECT * FROM warnings WHERE acked_at IS NULL AND cancelled_at IS NULL AND sends < ? "
                           "AND last_sent_at <= ? AND created_at >= ?", (MAX_SENDS, due_before, since)).fetchall()
        for r in rows:
            con.execute("UPDATE warnings SET sends=sends+1, last_sent_at=? WHERE id=?", (now.isoformat(), r["id"]))
        con.commit()
    finally:
        con.close()
    for r in rows:
        w = public(r)
        deliver(w, push, again=int(w.get("sends") or 1))
    return len(rows)


# ── the API ───────────────────────────────────────────────────────────────

from fastapi import APIRouter, Body, HTTPException, Request  # noqa: E402

router = APIRouter(prefix="/api/warnings", tags=["warnings"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


@router.post("")
def api_send(request: Request, body: dict = Body(...)):
    me = _me(request)
    try:
        return send(me, body.get("message"), to_user_id=body.get("to_user_id"), asset_id=body.get("asset_id"),
                    severity=body.get("severity") or "critical", route=body.get("route"), kind=body.get("kind") or "warning")
    except Refused as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/inbox")
def api_inbox(request: Request, seen: int = 1):
    """seen=0 from an app in the background: delivered, not yet seen."""
    return {"warnings": inbox(_me(request), mark_seen=bool(seen)), "resend_s": RESEND_S}


@router.post("/{wid}/ack")
def api_ack(wid: str, request: Request):
    try:
        return ack(_me(request), wid)
    except Refused as e:
        raise HTTPException(404, str(e))


@router.post("/{wid}/cancel")
def api_cancel(wid: str, request: Request):
    try:
        return cancel(_me(request), wid)
    except Refused as e:
        raise HTTPException(404, str(e))


@router.get("/sent")
def api_sent(request: Request, asset_id: str | None = None, user_id: str | None = None, limit: int = 10):
    try:
        return {"warnings": sent(_me(request), asset_id=asset_id, to_user_id=user_id, limit=limit)}
    except Refused as e:
        raise HTTPException(404, str(e))
