"""routers/geoconfirmed.py — /api/geoconfirmed/* endpoints.

Real, stored GeoConfirmed placemarks only — no live upstream call on the
request path (geoconfirmed.py's sync loop in main.py keeps the DB current).
Zero Claude/model calls anywhere in this module.
"""
from __future__ import annotations
import datetime

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/geoconfirmed", tags=["geoconfirmed"])


@router.get("/placemarks")
def get_placemarks(
    theatre: str | None = Query(None, description="Real theatre slug, e.g. 'ukraine'. Omit for all theatres."),
    max_age_days: int = Query(30, ge=1, le=3650),
    limit: int = Query(1000, ge=1, le=5000),
):
    """Real, active (non-removed) placemarks, most recent first. Bounded by
    age and count for the same reason every other dense map layer in this
    app is (see isMobile.js's per-layer caps) — Ukraine alone carries
    ~60,000 real historical pins; a live map view needs recent activity,
    not the full archive."""
    from database import GeoConfirmedPlacemark, get_db

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=max_age_days)
    with get_db() as db:
        q = db.query(GeoConfirmedPlacemark).filter(
            GeoConfirmedPlacemark.status == "active",
            GeoConfirmedPlacemark.date >= cutoff,
        )
        if theatre:
            q = q.filter(GeoConfirmedPlacemark.theatre_slug == theatre)
        rows = q.order_by(GeoConfirmedPlacemark.date.desc()).limit(limit).all()

        placemarks = [{
            "id": r.id,
            "theatre_slug": r.theatre_slug,
            "name": r.name,
            "description": r.description,
            "date": r.date.isoformat() if r.date else None,
            "date_precision": r.date_precision,
            "lat": r.latitude,
            "lon": r.longitude,
            "faction": r.faction,
            "origin": r.origin,
            "original_source": r.original_source,
            "geolocation_source": r.geolocation_source,
            "plus_code": r.plus_code,
            "orbat_node_id": r.orbat_node_id,
            "orbat_unit_name": r.orbat_unit_name,
        } for r in rows]

        total_active = db.query(GeoConfirmedPlacemark).filter(
            GeoConfirmedPlacemark.status == "active"
        ).count()

    return {
        "theatre": theatre, "max_age_days": max_age_days,
        "returned": len(placemarks), "total_active_all_time": total_active,
        "placemarks": placemarks,
    }


@router.get("/theatres")
def get_theatres():
    """Real per-theatre active placemark counts currently stored — lets the
    UI (or a debug view) confirm 'World is not the union' against this
    app's own real synced data, not just GeoConfirmed's live API."""
    from database import GeoConfirmedPlacemark, get_db
    from sqlalchemy import func

    with get_db() as db:
        rows = db.query(
            GeoConfirmedPlacemark.theatre_slug,
            func.count(GeoConfirmedPlacemark.id),
        ).filter(GeoConfirmedPlacemark.status == "active").group_by(
            GeoConfirmedPlacemark.theatre_slug
        ).all()
    return {"theatres": [{"theatre_slug": t, "active_count": c} for t, c in sorted(rows, key=lambda r: -r[1])]}
