"""routers/zone_findings.py — a watch zone's automatic findings, as boxes.

GET /api/watch-zones/{system_id}/findings         every finding with its box
GET /api/watch-zones/{system_id}/findings/crop     a cut-out around one box:
                                                   of the radar comparison's own
                                                   images (scan_id given and held),
                                                   else of the newest image
GET  /api/watch-zones/{system_id}/radar-images/{scan_id}
                                                   the Before / After / Change
                                                   images of a radar comparison,
                                                   with their bounds — or why not
POST /api/watch-zones/{system_id}/radar-images/{scan_id}
                                                   fetch that comparison's frames
                                                   again and keep its images
                                                   (costs one Sentinel Hub
                                                   request per date)

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


def _crop_sync(zone_pk: int, box: list, prefer: str | None, scan_id: str | None = None) -> dict | None:
    import radar_images
    import zone_findings
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        if scan_id:
            # The radar comparison's own images, when held: what radar saw
            # before and after, cut out on the same window.
            if radar_images.has(scan_id) and _scan_of_zone(db, z, scan_id):
                out = radar_images.crop(scan_id, box)
                if out:
                    return out
            src = zone_findings.radar_source(db, z, scan_id)
            out = zone_findings.crop_for(db, z, box, prefer=prefer)
            if out is not None and src is not None:
                out["radar_images"] = "missing"
                out["radar_requests"] = src["requests"]
            return out
        return zone_findings.crop_for(db, z, box, prefer=prefer)


def _scan_of_zone(db, zone, scan_id: str) -> bool:
    from database import SentinelScan
    return db.query(SentinelScan.id).filter(SentinelScan.scan_id == scan_id,
                                            SentinelScan.zone_id == zone.id).first() is not None


def _radar_state_sync(zone_pk: int, scan_id: str, which: tuple) -> dict:
    import radar_images
    import zone_findings
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        if not _scan_of_zone(db, z, scan_id):
            raise HTTPException(status_code=404, detail=f"No scan {scan_id} in this area")
        src = zone_findings.radar_source(db, z, scan_id)
    held = radar_images.load(scan_id, which)
    if held is not None:
        return {"status": "ready", **held}
    j = radar_images.job(scan_id)
    if j and j["status"] == "running":
        return {"status": "running", "done": j["done"], "total": j["total"]}
    base = {"status": "missing", "regenerable": src is not None,
            "requests": src["requests"] if src else 0,
            "dates_before": src["dates_before"] if src else None,
            "dates_after": src["dates_after"] if src else None,
            "bounds": src["bounds"] if src else None}
    if j and j["status"] == "error":
        return {**base, "status": "error", "error": j.get("error")}
    if src is None:
        base["why"] = ("This comparison did not record which radar dates it used, so its images cannot be "
                       "fetched again — the next radar pass over this area keeps them.")
    else:
        base["why"] = ("This comparison ran before its images were kept. They can be fetched again from "
                       f"Sentinel Hub: {src['requests']} requests ({len(src['dates_before'])} before, "
                       f"{len(src['dates_after'])} after).")
    return base


def _radar_source_sync(zone_pk: int, scan_id: str) -> tuple:
    import zone_findings
    from database import WatchZone, get_db
    with get_db() as db:
        z = db.query(WatchZone).filter(WatchZone.id == zone_pk).first()
        if not _scan_of_zone(db, z, scan_id):
            raise HTTPException(status_code=404, detail=f"No scan {scan_id} in this area")
        return zone_findings.radar_source(db, z, scan_id), z.system_id


@router.get("/{system_id}/findings")
async def zone_findings_list(request: Request, system_id: str, scan_id: str | None = None,
                             days: int = Query(30, ge=1, le=365)):
    import asyncio
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    return await asyncio.to_thread(_findings_sync, pk, scan_id, days)


@router.get("/{system_id}/findings/crop")
async def zone_finding_crop(request: Request, system_id: str, box: str, prefer: str | None = None,
                            scan_id: str | None = None):
    """box = "west,south,east,north" in degrees; scan_id = the radar
    comparison the finding came from (its own images are used when held)."""
    import asyncio
    try:
        b = [float(x) for x in box.split(",")]
        assert len(b) == 4 and b[2] > b[0] and b[3] > b[1]
    except (ValueError, AssertionError):
        raise HTTPException(status_code=422, detail="box must be west,south,east,north")
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    out = await asyncio.to_thread(_crop_sync, pk, b, (prefer or "").upper() or None, scan_id or None)
    if out is None:
        return {"image_b64": None, "why": "No image of this area is held yet — the first pass is on its way."}
    return out


@router.get("/{system_id}/radar-images/{scan_id}")
async def zone_radar_images(request: Request, system_id: str, scan_id: str, which: str = "before,after,change"):
    """The images a radar comparison was made from, georeferenced by
    `bounds` [west, south, east, north] — or {status: missing|running|error}
    with what it would take to fetch them again."""
    import asyncio
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    names = tuple(n for n in (which or "").split(",") if n in ("before", "after", "change"))
    return await asyncio.to_thread(_radar_state_sync, pk, scan_id, names or ("before", "after", "change"))


@router.post("/{system_id}/radar-images/{scan_id}")
async def zone_radar_images_regenerate(request: Request, system_id: str, scan_id: str):
    """Fetch the comparison's own dates again (one Sentinel Hub request per
    date), render Before / After / Change and keep them. Runs in the
    background; poll the GET. Asked for by a person, never automatic."""
    import asyncio
    import radar_images
    pk = await asyncio.to_thread(_zone_for, request, system_id)
    if radar_images.has(scan_id):
        return {"status": "ready"}
    j = radar_images.job(scan_id)
    if j and j["status"] == "running":
        return {"status": "running", "done": j["done"], "total": j["total"]}
    src, zsid = await asyncio.to_thread(_radar_source_sync, pk, scan_id)
    if src is None:
        raise HTTPException(status_code=409, detail="This comparison did not record which radar dates it used; "
                                                    "its images cannot be fetched again.")
    import geotiff_io
    why = geotiff_io.unavailable_reason()
    if why:
        raise HTTPException(status_code=503, detail=why)
    from main import _fetch_sentinel1_raw_bands_geotiff
    radar_images._JOBS[scan_id] = {"status": "running", "done": 0, "total": src["requests"]}
    asyncio.create_task(radar_images.regenerate(scan_id, src, _fetch_sentinel1_raw_bands_geotiff,
                                                {"zone_id": zsid}))
    return {"status": "running", "done": 0, "total": src["requests"]}
