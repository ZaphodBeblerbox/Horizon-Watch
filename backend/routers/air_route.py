"""air_route.py — the safest flight path, over HTTP (backend/air_route.py does the work).

    POST /api/routes/air                {from, to, mode: plan|assess}  — between two airports (ICAO/IATA or {lat, lon})
                                        {icao: <hex>, mode}            — a live aircraft (ADS-B cache; route via hexdb.io)
    GET  /api/routes/air/context        ?icao=<hex> | ?from&to — is this flight's path relevant, and why (the automatic offer)
    GET  /api/routes/air/airports       ?q= — airport search for the from/to fields
    GET  /api/routes/air/hazards        the hazard list (no geometry) with sources, dates and the curation warnings

Every handler is async; the hazard build, the grid search and the SQLite reads
run in a thread, the hexdb.io route lookup in a thread with its own cache.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Body, HTTPException, Query, Request

import air_route as ar

router = APIRouter(prefix="/api/routes/air", tags=["routes-air"])


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _live(icao: str) -> dict | None:
    try:
        from main import _GLOBAL_ADSB_CACHE
    except Exception:                                        # noqa: BLE001
        return None
    h = (icao or "").strip()
    ac = _GLOBAL_ADSB_CACHE.get(h.upper()) or _GLOBAL_ADSB_CACHE.get(h.lower())
    if not ac or ac.get("lat") is None or ac.get("lon") is None:
        return None
    return dict(ac)


async def _route_of(icao: str) -> dict | None:
    try:
        from services.flight_route_service import get_route
        return await asyncio.wait_for(asyncio.to_thread(get_route, icao), timeout=12)
    except Exception:                                        # noqa: BLE001
        return None


async def _for_aircraft(icao: str, mode: str) -> dict:
    ac = _live(icao)
    if not ac:
        raise HTTPException(404, f"Aircraft {icao} is not in the live ADS-B picture right now")
    route = await _route_of(icao)
    return await asyncio.to_thread(ar.assess_live, ac, route, None, mode)


@router.post("")
async def air_plan(request: Request, body: dict = Body(...)):
    _me(request)
    mode = "assess" if body.get("mode") == "assess" else "plan"
    if body.get("icao"):
        return await _for_aircraft(str(body["icao"]), mode)
    frm, to = body.get("from"), body.get("to")
    if not frm or not to:
        raise HTTPException(400, "from and to are required (airport codes or {lat, lon}), or icao for a live aircraft")
    try:
        return await asyncio.to_thread(ar.plan_between, frm, to, mode)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/context")
async def air_context(request: Request, icao: str | None = Query(None), frm: str | None = Query(None, alias="from"),
                      to: str | None = Query(None)):
    _me(request)
    if icao:
        try:
            res = await _for_aircraft(icao, "assess")
        except HTTPException as e:
            return {"relevant": False, "reason": e.detail}
    elif frm and to:
        try:
            res = await asyncio.to_thread(ar.plan_between, frm, to, "assess")
        except ValueError as e:
            return {"relevant": False, "reason": str(e)}
    else:
        raise HTTPException(400, "icao, or from and to")
    out = ar.context_reason(res)
    out["direct"] = {k: res["candidates"][0]["score"][k] for k in ("distance_km", "minutes", "exposure", "max_weight")}
    out["aircraft"] = res.get("aircraft")
    return out


@router.get("/airports")
async def air_airports(request: Request, q: str = Query(""), limit: int = Query(10)):
    _me(request)
    return {"airports": await asyncio.to_thread(ar.airport_search, q, limit)}


@router.get("/hazards")
async def air_hazards(request: Request):
    _me(request)
    data = await asyncio.to_thread(ar.hazard_set)
    return {"hazards": [{k: v for k, v in ar._public_hazard(h).items() if k != "rings"} for h in data["hazards"]],
            "warnings": data["warnings"], "notes": data["notes"], "built_at": data["built_at"], "reviewed": data["reviewed"]}
