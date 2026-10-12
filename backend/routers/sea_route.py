"""sea_route.py — the safest sea route, over HTTP (backend/sea_route.py does the work).

    POST /api/routes/sea              {origin, destination, speed_kn?, ship_type?, departure?, avoid?, day_value?}
                                      origin/destination: {lat, lon, name?} | {port: "Rotterdam" | "NLRTM"} | {mmsi}
    GET  /api/routes/sea/context      ?mmsi= — is a sea-route plan relevant for this vessel, and why
    GET  /api/routes/sea/ports        ?q= — port search (searoute's port list, UN/LOCODE)
    GET  /api/routes/sea/hazards      the maritime hazard set with sources

Every handler is async; the graph search and the SQLite reads run in a thread.
"""
from __future__ import annotations

import asyncio
import sys
from typing import Callable

from fastapi import APIRouter, Body, HTTPException, Query, Request

import sea_route as sea

router = APIRouter(tags=["sea-route"])

#: Set by main.py: mmsi -> the live AIS record (a copy) or None.
VESSEL_LOOKUP: Callable[[str], dict | None] | None = None


def _me(request: Request) -> dict:
    from main import _require_current_user
    return _require_current_user(request)


def _vessel(mmsi: str) -> dict | None:
    if VESSEL_LOOKUP is not None:
        return VESSEL_LOOKUP(str(mmsi))
    m = sys.modules.get("main")
    if m is not None and hasattr(m, "_AIS_VESSELS"):
        with m._AIS_LOCK:
            v = m._AIS_VESSELS.get(str(mmsi))
            return dict(v) if v else None
    return None


def _concern(v: dict) -> list[str]:
    """Why this vessel is itself of concern (sanctions / Russia links). Blocking."""
    out = []
    try:
        import time
        import russia_loiter_watch as rlw
        for link in rlw.russia_links(v, rlw.default_watch().index(time.time())):
            out.append(link.get("reason") or link.get("kind"))
    except Exception as ex:                                 # noqa: BLE001
        print(f"[sea-route] error: concern lookup: {type(ex).__name__}: {ex}", flush=True)
    if v.get("sanctioned") and not out:
        out.append("on a sanctions list")
    return out


def _point(spec, what: str) -> tuple[float, float, str | None, dict | None]:
    """(lat, lon, name, vessel) from {lat, lon} | {port} | {mmsi}."""
    if not isinstance(spec, dict):
        raise HTTPException(400, f"{what} is an object: {{lat, lon}}, {{port}} or {{mmsi}}")
    if spec.get("mmsi"):
        v = _vessel(str(spec["mmsi"]))
        if not v or v.get("lat") is None:
            raise HTTPException(404, f"Vessel {spec['mmsi']} is not in the live AIS picture")
        return float(v["lat"]), float(v["lon"]), v.get("name") or f"MMSI {spec['mmsi']}", v
    if spec.get("port"):
        hits = sea.search_ports(str(spec["port"]), 1)
        if not hits:
            raise HTTPException(404, f"No port matches {spec['port']!r}")
        p = hits[0]
        return p["lat"], p["lon"], f"{p['name']} ({p['locode']})", None
    try:
        lat, lon = float(spec["lat"]), float(spec["lon"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, f"{what} needs lat and lon, a port or an mmsi")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, f"{what} out of range")
    return lat, lon, spec.get("name"), None


@router.post("/api/routes/sea")
async def plan_sea_route(request: Request, body: dict = Body(...)):
    _me(request)
    o_lat, o_lon, o_name, vessel = _point(body.get("origin"), "origin")
    d_lat, d_lon, d_name, _ = _point(body.get("destination"), "destination")
    avoid = [str(a) for a in (body.get("avoid") or []) if str(a) in sea.PASSAGES]
    speed = body.get("speed_kn")
    try:
        speed = float(speed) if speed not in (None, "") else None
        day_value = float(body["day_value"]) if body.get("day_value") not in (None, "") else None
    except (TypeError, ValueError):
        raise HTTPException(400, "speed_kn and day_value are numbers")
    ship_type = body.get("ship_type") or (vessel or {}).get("ship_type")

    def run():
        return sea.plan((o_lat, o_lon), (d_lat, d_lon), speed_kn=speed, ship_type=ship_type,
                        departure=body.get("departure"), avoid=avoid, day_value=day_value,
                        origin_name=o_name, dest_name=d_name)
    return await asyncio.to_thread(run)


@router.get("/api/routes/sea/context")
async def sea_route_context(request: Request, mmsi: str = Query(..., min_length=1, max_length=20)):
    _me(request)
    v = _vessel(mmsi)

    def run():
        if not v:
            return sea.context(None)
        return sea.context(v, concern=_concern(v))
    out = await asyncio.to_thread(run)
    out["mmsi"] = mmsi
    return out


@router.get("/api/routes/sea/ports")
async def sea_ports(request: Request, q: str = Query("", max_length=60), limit: int = Query(10, ge=1, le=30)):
    _me(request)
    return {"ports": await asyncio.to_thread(sea.search_ports, q, limit)}


@router.get("/api/routes/sea/hazards")
async def sea_hazards(request: Request, kind: str | None = None):
    _me(request)

    def run():
        hz = sea.hazards()
        return [sea._public_hazard(h) for h in hz if (kind is None or h["kind"] == kind)]
    rows = await asyncio.to_thread(run)
    return {"hazards": rows, "count": len(rows), "reviewed": sea.load_config().get("reviewed")}
