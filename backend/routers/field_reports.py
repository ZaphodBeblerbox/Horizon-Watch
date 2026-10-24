"""field_reports.py — user reports' API (backend/field_reports.py does the work).

    GET    /api/field-reports                 the active reports you may read (not expired, not ended), newest first;
                                              ?south&west&north&east narrow it to a box
    POST   /api/field-reports                 report: {kind, title, note?, lat, lon, place?, occurred_at?,
                                              expires_at? | expires_in_h?, audience?: company|everyone|people,
                                              shared_with?, media?: [{url, type} | {path, type, mime, name}]}
    GET    /api/field-reports/kinds           the kinds, their labels and default expiry
    GET    /api/field-reports/{id}            one (active or not) you may read
    PATCH  /api/field-reports/{id}            the author: title, note, place, expires_at | expires_in_h
    POST   /api/field-reports/{id}/end        the author ends it now
    DELETE /api/field-reports/{id}            the author, or a superadmin
    GET    /api/field-reports/{id}/media/{n}  an uploaded picture (POST /api/desk/files first, then its path here)

Who reads a report is the Desk's rule (routers/desk.py): your company by default, everyone, or named people.
"""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import field_reports as fr

router = APIRouter(prefix="/api/field-reports", tags=["field-reports"])


def _me(request: Request) -> dict:
    from routers import desk
    return desk._me(request)


def _audience(body: dict, me: dict) -> tuple:
    from database import get_db
    from routers import desk
    with get_db() as db:
        return desk._audience_of(db, body, me)


def _visible(report_id: str, me: dict) -> dict:
    row = fr.get_visible(report_id, me)
    if not row:
        raise HTTPException(status_code=404, detail="no such report")
    return row


def _author_only(row: dict, me: dict, what: str) -> None:
    if row["author_user_id"] != me["id"]:
        raise HTTPException(status_code=403, detail=f"only the person who reported it can {what} it")


@router.get("/kinds")
def kinds():
    return {"kinds": [{"kind": k, "label": fr.KIND_LABEL[k], "default_expiry_h": fr.DEFAULT_EXPIRY_H[k]} for k in fr.KINDS],
            "max_expiry_h": fr.MAX_EXPIRY_H}


@router.get("")
async def list_reports(request: Request, south: float | None = None, west: float | None = None,
                       north: float | None = None, east: float | None = None):
    me = _me(request)
    bbox = (south, west, north, east) if None not in (south, west, north, east) else None
    items = await asyncio.to_thread(fr.active_for, me, None, bbox)
    return {"reports": items, "kinds": list(fr.KINDS)}


@router.post("")
async def create_report(request: Request):
    me = _me(request)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="a report is a JSON object")
    try:
        clean = fr.validate(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    aud = _audience({"audience": clean["audience"], "shared_with": clean["shared_with"]}, me)
    try:
        row = await asyncio.to_thread(fr.create, me, clean, aud)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return fr.to_dict(row, me)


@router.get("/{report_id}")
def get_report(report_id: str, request: Request):
    me = _me(request)
    return fr.to_dict(_visible(report_id, me), me)


@router.patch("/{report_id}")
async def update_report(report_id: str, request: Request):
    me = _me(request)
    row = _visible(report_id, me)
    _author_only(row, me, "change")
    if row.get("ended_at"):
        raise HTTPException(status_code=409, detail="that report has ended")
    try:
        changes = fr.clean_update(await request.json(), row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return fr.to_dict(fr.update(report_id, me, changes), me)


@router.post("/{report_id}/end")
def end_report(report_id: str, request: Request):
    me = _me(request)
    row = _visible(report_id, me)
    _author_only(row, me, "end")
    return fr.to_dict(fr.end(report_id), me)


@router.delete("/{report_id}")
def delete_report(report_id: str, request: Request):
    me = _me(request)
    row = _visible(report_id, me)
    if row["author_user_id"] != me["id"] and not me.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="you can only delete your own reports")
    fr.delete(report_id)
    return {"ok": True, "id": report_id}


@router.get("/{report_id}/media/{n}")
def report_media(report_id: str, n: int, request: Request):
    from routers.desk import _files_root
    me = _me(request)
    row = _visible(report_id, me)
    m = fr.media_file(row, n)
    if not m:
        raise HTTPException(status_code=404, detail="no such file")
    root = os.path.realpath(_files_root())
    full = os.path.realpath(os.path.join(root, m["path"]))
    if not full.startswith(root + os.sep) or not os.path.exists(full):
        raise HTTPException(status_code=410, detail="that file is no longer on disk")
    return FileResponse(full, media_type=m.get("mime") or "application/octet-stream")


@router.on_event("startup")
def _migrate() -> None:
    """The additive migration: the table and its indexes, if missing (CREATE TABLE IF NOT EXISTS)."""
    try:
        fr.ensure_table()
    except Exception as e:                                     # noqa: BLE001 — a missing table is created on first use too
        print(f"[field-reports] error: migrate: {type(e).__name__}: {e}", flush=True)
