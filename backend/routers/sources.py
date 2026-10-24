"""sources.py — a cited source as our own post card (source_card.py).

    GET  /api/source/card?url=      what we hold about it, no model (signed in)
    POST /api/source/summary        {url, title?, text?, source?}: the short "what happened" and the English,
                                    generated on click only, cached per source URL (one model call at most)
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/source", tags=["sources"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


@router.get("/card")
async def source_card(url: str, request: Request):
    import source_card as sc
    _me(request)
    try:
        return await asyncio.get_event_loop().run_in_executor(None, sc.card, url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/summary")
async def source_summary(request: Request):
    import source_card as sc
    me = _me(request)
    body = await request.json()
    url = str(body.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="a source is an http(s) link")
    given = {k: str(body.get(k) or "")[:sc.MAX_TEXT] for k in ("title", "text", "summary", "source")}
    return await asyncio.get_event_loop().run_in_executor(
        None, lambda: sc.summary(url, user_id=str(me.get("id") or "anon"), given=given))
