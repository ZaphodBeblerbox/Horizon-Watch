"""routers/detection_feedback.py — an analyst's answer to one imagery detection.

GET  /api/imagery/detections/{detection_id}/feedback   the answers so far
                                                       ({items: [...]}, yours marked "mine")
POST /api/imagery/detections/{detection_id}/feedback   {verdict: "correct"|"incorrect",
                                                        actual_class?, note?} — yours,
                                                       replacing any earlier one

Who may: whoever may read the detection's watch zone
(routers/zone_findings._zone_for). Stored by backend/detection_feedback.py;
read by tools/train_detection_classifier.py.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/imagery/detections", tags=["imagery"])


def _detection(detection_id: str):
    from database import SentinelDetection, WatchZone, get_db
    with get_db() as db:
        d = db.query(SentinelDetection).filter(SentinelDetection.detection_id == detection_id).first()
        if d is None:
            raise HTTPException(status_code=404, detail=f"No detection {detection_id}")
        z = db.query(WatchZone.system_id).filter(WatchZone.id == d.zone_id).first()
        return {"object_type": d.object_type, "attributes": d.attributes, "system_id": z[0] if z else None}


def _access(request: Request, detection_id: str) -> tuple[dict, dict]:
    from main import _zone_user
    from routers.zone_findings import _zone_for
    user = _zone_user(request)
    det = _detection(detection_id)
    if not det["system_id"]:
        raise HTTPException(status_code=404, detail=f"No detection {detection_id}")
    _zone_for(request, det["system_id"])
    return user, det


@router.get("/{detection_id}/feedback")
async def get_feedback(request: Request, detection_id: str):
    import detection_feedback as fb
    from database import engine
    user, _det = await asyncio.to_thread(_access, request, detection_id)
    rows = await asyncio.to_thread(fb.for_detection, engine, detection_id)
    return {"items": [fb.public(r, user.get("id")) for r in rows]}


@router.post("/{detection_id}/feedback")
async def post_feedback(request: Request, detection_id: str):
    import detection_feedback as fb
    from database import engine
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="send JSON: {verdict, actual_class, note}")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="send JSON: {verdict, actual_class, note}")
    user, det = await asyncio.to_thread(_access, request, detection_id)
    predicted, feats = fb.detection_snapshot(det["attributes"], det["object_type"])
    try:
        row = await asyncio.to_thread(
            lambda: fb.save(engine, detection_id=detection_id, user_id=user.get("id"),
                            user_label=user.get("name") or user.get("email"), verdict=body.get("verdict"),
                            actual_class=body.get("actual_class"), note=body.get("note"),
                            predicted_class=predicted, features=feats, zone_system_id=det["system_id"]))
    except fb.FeedbackError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"status": "saved", "feedback": fb.public(row, user.get("id"))}
