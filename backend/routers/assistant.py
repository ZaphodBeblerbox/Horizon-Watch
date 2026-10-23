"""routers/assistant.py — the assistant's endpoints (logic in assistant.py).

    POST /api/assistant/turn     one question in, an answer with citations,
                                 map actions and proposals out
    POST /api/assistant/propose  a form's fields -> a signed proposal (no model)
    POST /api/assistant/confirm  a proposal token -> the request for the
                                 existing endpoint (single use, 10 min)
    GET  /api/assistant/status   model on/off and why, caps, today's counts
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
    # the model client is synchronous; the turn runs off the event loop
    return await asyncio.to_thread(assistant.run_turn, str(me["id"]), me, body)


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
