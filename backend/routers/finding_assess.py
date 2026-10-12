"""routers/finding_assess.py — "Assess with AI": a vision model's second
opinion on one finding (backend/finding_assess.py), ON REQUEST ONLY.

GET  /api/findings/{zone_id}/{finding_id}/assess   the cached verdict if there
                                                   is one, else what a run would
                                                   cost — never calls the model
POST /api/findings/{zone_id}/{finding_id}/assess   run it (or answer from the
                                                   cache, free); only the button
                                                   calls this

Who may: whoever may read the zone's findings (routers/zone_findings._zone_for).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/findings", tags=["imagery"])


def _gather_sync(zone_pk: int, finding_id: str):
    import finding_assess
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        g = finding_assess.gather(db, z, finding_id)
        if g is None:
            raise HTTPException(status_code=404, detail=f"No finding {finding_id} in this area")
        return g


@router.get("/{zone_id}/{finding_id}/assess")
async def assess_preview(request: Request, zone_id: str, finding_id: str):
    import asyncio
    import finding_assess
    from routers.zone_findings import _zone_for
    pk = await asyncio.to_thread(_zone_for, request, zone_id)
    g = await asyncio.to_thread(_gather_sync, pk, finding_id)
    return finding_assess.preview(g, zone_id)


@router.post("/{zone_id}/{finding_id}/assess")
async def assess_run(request: Request, zone_id: str, finding_id: str):
    import asyncio
    import finding_assess
    from routers.zone_findings import _zone_for
    pk = await asyncio.to_thread(_zone_for, request, zone_id)
    g = await asyncio.to_thread(_gather_sync, pk, finding_id)
    try:
        out = await asyncio.to_thread(finding_assess.run, g, zone_id)
    except finding_assess.AssessRefused as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:                                        # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"The AI assessment failed: {type(e).__name__}: {str(e)[:200]}")
    return {"status": "ready", "assessment": out}
