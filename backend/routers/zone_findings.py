"""routers/zone_findings.py — a watch zone's automatic findings, as boxes.

GET /api/watch-zones/{system_id}/findings         every finding with its box
GET /api/watch-zones/{system_id}/findings/crop     a cut-out of the newest
                                                   image around one box

WHO MAY READ THEM. The zone's owner (and a superadmin), as for the zone
itself — and anybody a notification about this zone was sent to: a sweep
find or a radar change is broadcast as an alert, and the person who taps it
must be able to see what it was about. Nothing else of the zone is opened
by that.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api/watch-zones", tags=["imagery"])


def _zone_for(request: Request, system_id: str):
    from database import Alert, WatchZone, get_db
    from main import _zone_user, _zones_visible
    user = _zone_user(request)
    with get_db() as db:
        q = db.query(WatchZone).filter(WatchZone.system_id == system_id)
        z = q.first()
        if z is None:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        if user.get("is_super_admin") or _zones_visible(q, user).first() is not None:
            return z.id
        notified = (db.query(Alert.id)
                    .filter(Alert.alert_type == "Imagery signal", Alert.entity_id == system_id).first())
        if notified is None:
            raise HTTPException(status_code=404, detail=f"Watch zone {system_id} not found")
        return z.id


def _findings_sync(zone_pk: int, scan_id: str | None, days: int) -> dict:
    import zone_findings
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        return zone_findings.zone_findings(db, z, scan_id=scan_id, days=days)


def _crop_sync(zone_pk: int, box: list, prefer: str | None) -> dict | None:
    import zone_findings
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        return zone_findings.crop_for(db, z, box, prefer=prefer)


@router.get("/{system_id}/findings")
async def zone_findings_list(request: Request, system_id: str, scan_id: str | None = None,
                             days: int = Query(30, ge=1, le=365)):
    import asyncio
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    return await asyncio.to_thread(_findings_sync, pk, scan_id, days)


@router.get("/{system_id}/findings/crop")
async def zone_finding_crop(request: Request, system_id: str, box: str, prefer: str | None = None):
    """box = "west,south,east,north" in degrees."""
    import asyncio
    try:
        b = [float(x) for x in box.split(",")]
        assert len(b) == 4 and b[2] > b[0] and b[3] > b[1]
    except (ValueError, AssertionError):
        raise HTTPException(status_code=422, detail="box must be west,south,east,north")
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    out = await asyncio.to_thread(_crop_sync, pk, b, (prefer or "").upper() or None)
    if out is None:
        return {"image_b64": None, "why": "No image of this area is held yet — the first pass is on its way."}
    return out
