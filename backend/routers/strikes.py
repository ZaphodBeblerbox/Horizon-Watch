"""routers/strikes.py — the "Strikes & control" map layer (strike_events.py).

GET /api/strikes?bbox=w,s,e,n&since=14d&acts=airstrike,missile&actors=Houthis
GET /api/strikes/campaigns?since=&bbox=&actors=

The build reads several tables and runs the merge; it happens in a worker
thread (asyncio.to_thread) and is cached CACHE_TTL_S, so a request never
blocks the event loop and never queues behind another build.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

import strike_events as se

router = APIRouter(prefix="/api/strikes", tags=["strikes"])

# The compact shape the map needs; the card reads the rest.
_FIELDS = ("id", "act", "act_label", "weapon_stated", "actor", "actor_side", "target_name", "lat", "lon",
           "precision", "country", "time", "last_time", "title", "sources", "source_count", "casualties",
           "unit_type", "origin_hint", "window_days", "age_days", "campaign_id")


def _bbox(s: str | None):
    if not s:
        return None
    try:
        w, so, e, n = (float(x) for x in s.split(","))
        return (w, so, e, n)
    except ValueError:
        return None


def _list(s: str | None):
    return [x.strip() for x in s.split(",") if x.strip()] if s else None


@router.get("")
async def strikes(bbox: str | None = None, since: str | None = Query(None, description="ISO time, or 24h / 7d / 14d"),
                  acts: str | None = None, actors: str | None = None, limit: int = 3000):
    try:
        await asyncio.to_thread(se.refresh)
        evts = se.filter_events(se._CACHE["events"], since=since, bbox=_bbox(bbox),
                                acts=_list(acts), actors=_list(actors))
    except Exception as ex:                                     # noqa: BLE001
        return JSONResponse({"error": f"{type(ex).__name__}: {ex}", "events": []}, status_code=500)
    evts = evts[: max(1, min(int(limit), 10000))]
    return {"events": [{k: e.get(k) for k in _FIELDS} for e in evts], "count": len(evts),
            "windows": se.WINDOW_DAYS, "acts": se.ACT_LABEL, "built_at": se._CACHE["at"]}


@router.get("/campaigns")
async def strike_campaigns(bbox: str | None = None, since: str | None = None, actors: str | None = None):
    try:
        await asyncio.to_thread(se.refresh)
        cs = se.campaigns(since=since, bbox=_bbox(bbox), actors=_list(actors))
    except Exception as ex:                                     # noqa: BLE001
        return JSONResponse({"error": f"{type(ex).__name__}: {ex}", "campaigns": []}, status_code=500)
    return {"campaigns": cs, "count": len(cs)}
