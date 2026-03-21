"""routers/briefings.py — /api/briefing/* endpoints."""

from __future__ import annotations
import asyncio
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["briefings"])


@router.get("/api/briefing/latest")
def get_latest_briefing():
    """Return the most recent briefing and rate-limit metadata."""
    import main as _m
    with _m._BRIEFING_LOCK:
        latest = _m._BRIEFING_STORE[-1] if _m._BRIEFING_STORE else None
    if latest is None:
        return {"briefing": None, "can_regenerate": True, "next_regen_secs": 0}
    try:
        generated_ts = datetime.fromisoformat(
            latest["generated_at"].replace("Z", "+00:00")
        ).timestamp()
    except Exception:
        generated_ts = 0.0
    secs_since      = time.time() - generated_ts
    can_regenerate  = secs_since >= _m._BRIEFING_RATE_LIMIT_S
    next_regen_secs = max(0, int(_m._BRIEFING_RATE_LIMIT_S - secs_since))
    return {
        "briefing":        latest,
        "can_regenerate":  can_regenerate,
        "next_regen_secs": next_regen_secs,
    }


@router.post("/api/briefing/generate")
async def generate_briefing_endpoint():
    """Manually trigger briefing generation. Rate-limited to once per 2 hours."""
    import main as _m
    with _m._BRIEFING_LOCK:
        if _m._BRIEFING_STORE:
            last = _m._BRIEFING_STORE[-1]
            try:
                last_ts    = datetime.fromisoformat(last["generated_at"].replace("Z", "+00:00")).timestamp()
                secs_since = time.time() - last_ts
                if secs_since < _m._BRIEFING_RATE_LIMIT_S:
                    wait_min = int((_m._BRIEFING_RATE_LIMIT_S - secs_since) / 60) + 1
                    raise HTTPException(
                        status_code=429,
                        detail=f"Rate limited — try again in {wait_min} min",
                    )
            except HTTPException:
                raise
            except Exception:
                pass

    loop     = asyncio.get_event_loop()
    briefing = await loop.run_in_executor(_m._executor, lambda: _m._generate_briefing_sync(manual=True))
    if not briefing:
        raise HTTPException(status_code=500, detail="Briefing generation failed — check backend logs")
    secs_since = time.time() - datetime.fromisoformat(briefing["generated_at"].replace("Z", "+00:00")).timestamp()
    return {
        "briefing":        briefing,
        "ok":              True,
        "can_regenerate":  False,
        "next_regen_secs": max(0, int(_m._BRIEFING_RATE_LIMIT_S - secs_since)),
    }
