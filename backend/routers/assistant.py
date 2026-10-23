"""routers/assistant.py — the assistant's endpoints (logic in assistant.py).

    POST /api/assistant/turn     one question in, an answer with citations,
                                 map actions and proposals out
    POST /api/assistant/propose  a form's fields -> a signed proposal (no model)
    POST /api/assistant/confirm  a proposal token -> the request for the
                                 existing endpoint (single use, 10 min)
    GET  /api/assistant/status   model on/off and why, caps, today's counts

    Conversations (assistant_history.py), each user's own only:
    GET    /api/assistant/conversations             list (newest first)
    POST   /api/assistant/conversations             create {mode}
    GET    /api/assistant/conversations/{id}        one, with its messages
    PATCH  /api/assistant/conversations/{id}        rename {title}
    DELETE /api/assistant/conversations/{id}
    POST   /api/assistant/conversations/{id}/messages   a form's proposal, a spoken exchange
    POST   /api/assistant/conversations/{id}/stop       Stop: "Stopped." answers the turn
    PATCH  /api/assistant/conversations/{id}/messages/{mid}  a proposal's state
    /turn with conversation_id + turn_id stores the question and the answer.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


@router.post("/turn")
async def turn(request: Request):
    import assistant
    me = _me(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be a JSON object")
    msgs = body.get("messages") or []
    if msgs and isinstance(msgs[-1], dict) and len(str(msgs[-1].get("content") or "")) > assistant.MAX_INPUT_CHARS:
        raise HTTPException(400, f"at most {assistant.MAX_INPUT_CHARS} characters, please")
    uid = str(me["id"])
    cid = body.get("conversation_id")
    turn_id = str(body.get("turn_id") or "")[:64] or None
    if not cid:
        # the model client is synchronous; the turn runs off the event loop
        return await asyncio.to_thread(assistant.run_turn, uid, me, body)
    import assistant_history as H
    text = ""
    if msgs and isinstance(msgs[-1], dict) and msgs[-1].get("role") == "user":
        text = str(msgs[-1].get("content") or "")

    def run():
        try:
            umid = H.begin_turn(uid, cid, turn_id, text) if turn_id else None
        except H.NotFound:
            raise HTTPException(404, "conversation not found")
        out = assistant.run_turn(uid, me, body)
        try:
            out["message_id"] = H.finish_turn(uid, cid, turn_id, out, mode=out.get("mode"),
                                              skipped=out.get("skipped"))
        except H.NotFound:      # deleted while the turn ran
            out["message_id"] = None
        out["user_message_id"] = umid
        out["conversation_id"] = cid
        out["stopped"] = out["message_id"] is None and bool(turn_id)
        return out
    return await asyncio.to_thread(run)


@router.post("/propose")
async def propose(request: Request):
    """The same proposals as the model's tools, from a plain form."""
    import assistant
    me = _me(request)
    body = await request.json()
    kind = (body or {}).get("kind")
    f = (body or {}).get("fields") or {}
    uid = str(me["id"])

    def run():
        if kind == "theater":
            return assistant.propose_theater(uid, f.get("name"), f.get("place"), f.get("radius_km"))
        if kind == "asset":
            return assistant.propose_asset(uid, f.get("name"), f.get("kind"), f.get("place"), f.get("radius_km"))
        if kind == "interests":
            return assistant.propose_interests(uid, f.get("countries"), f.get("regions"), f.get("topics"),
                                               f.get("here_place"), f.get("here_radius_km"))
        if kind == "alerts":
            return assistant.propose_alerts(uid, f.get("level"))
        raise HTTPException(400, "kind must be theater, asset, interests or alerts")
    out = await asyncio.to_thread(run)
    if "error" in out:
        raise HTTPException(400, out["error"])
    return out


@router.post("/confirm")
async def confirm(request: Request):
    import assistant
    me = _me(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(assistant.confirm, str(me["id"]), (body or {}).get("token"))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/status")
async def status(request: Request):
    import assistant
    me = _me(request)
    return await asyncio.to_thread(assistant.status, str(me["id"]))


# ── conversations ───────────────────────────────────────────────────────────

def _h():
    import assistant_history as H
    return H


async def _call(fn, *a, **k):
    H = _h()
    try:
        return await asyncio.to_thread(fn, *a, **k)
    except H.NotFound as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


async def _json(request: Request) -> dict:
    try:
        b = await request.json()
    except Exception:
        b = {}
    return b if isinstance(b, dict) else {}


@router.get("/conversations")
async def conversations(request: Request, limit: int = 50):
    me = _me(request)
    return {"conversations": await _call(_h().list_for, str(me["id"]), limit)}


@router.post("/conversations")
async def new_conversation(request: Request):
    me = _me(request)
    b = await _json(request)
    return await _call(_h().create, str(me["id"]), b.get("mode") or "chat")


@router.get("/conversations/{cid}")
async def get_conversation(cid: str, request: Request):
    me = _me(request)
    return await _call(_h().get, str(me["id"]), cid)


@router.patch("/conversations/{cid}")
async def patch_conversation(cid: str, request: Request):
    me = _me(request)
    b = await _json(request)
    return await _call(_h().update, str(me["id"]), cid, title=b.get("title"), mode=b.get("mode"),
                       skipped=b.get("skipped"))


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: str, request: Request):
    me = _me(request)
    await _call(_h().delete, str(me["id"]), cid)
    return {"ok": True}


@router.post("/conversations/{cid}/messages")
async def add_messages(cid: str, request: Request):
    me = _me(request)
    b = await _json(request)
    return {"ids": await _call(_h().append, str(me["id"]), cid, b.get("messages") or [])}


@router.post("/conversations/{cid}/stop")
async def stop(cid: str, request: Request):
    me = _me(request)
    b = await _json(request)
    return {"message_id": await _call(_h().mark_stopped, str(me["id"]), cid, str(b.get("turn_id") or "")[:64])}


@router.patch("/conversations/{cid}/messages/{mid}")
async def patch_message(cid: str, mid: int, request: Request):
    me = _me(request)
    b = await _json(request)
    return await _call(_h().set_proposal_state, str(me["id"]), cid, mid, str(b.get("token") or ""),
                       str(b.get("state") or ""), b.get("why"))
