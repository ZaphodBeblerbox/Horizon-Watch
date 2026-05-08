"""Analytics router — heatmap, time-series, and type-breakdown endpoints
backed by the TrackDensity aggregation table."""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import func

from database import TrackDensity, get_db

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _bbox_filter(query, south, north, west, east):
    if all(v is not None for v in (south, north, west, east)):
        query = query.filter(
            TrackDensity.grid_lat >= south,
            TrackDensity.grid_lat <= north,
            TrackDensity.grid_lon >= west,
            TrackDensity.grid_lon <= east,
        )
    return query


@router.get("/heatmap")
async def get_heatmap(
    domain: str   = Query("ais",  pattern="^(ais|adsb)$"),
    hours:  int   = Query(24, ge=1, le=2160),
    south:  Optional[float] = Query(None),
    north:  Optional[float] = Query(None),
    west:   Optional[float] = Query(None),
    east:   Optional[float] = Query(None),
):
    """Grid-cell density for heatmap rendering. Cells are 0.1° (~11km) squares."""
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    with get_db() as db:
        q = (db.query(
                TrackDensity.grid_lat,
                TrackDensity.grid_lon,
                func.sum(TrackDensity.count).label("total"),
                func.avg(TrackDensity.avg_speed).label("avg_speed"),
            )
            .filter(TrackDensity.domain == domain,
                    TrackDensity.hour >= since)
            .group_by(TrackDensity.grid_lat, TrackDensity.grid_lon))
        q = _bbox_filter(q, south, north, west, east)
        rows = q.all()

    cells = [
        {
            "lat":       float(r[0]),
            "lon":       float(r[1]),
            "count":     int(r[2] or 0),
            "avg_speed": round(float(r[3]), 1) if r[3] is not None else None,
        }
        for r in rows
    ]
    return {"cells": cells, "domain": domain, "hours": hours, "count": len(cells)}


@router.get("/timeseries")
async def get_timeseries(
    domain: str = Query("ais",  pattern="^(ais|adsb)$"),
    hours:  int = Query(168, ge=1, le=2160),
    south:  Optional[float] = Query(None),
    north:  Optional[float] = Query(None),
    west:   Optional[float] = Query(None),
    east:   Optional[float] = Query(None),
):
    """Hourly track counts for line/area charts."""
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    with get_db() as db:
        q = (db.query(TrackDensity.hour,
                      func.sum(TrackDensity.count).label("total"))
             .filter(TrackDensity.domain == domain,
                     TrackDensity.hour >= since)
             .group_by(TrackDensity.hour)
             .order_by(TrackDensity.hour))
        q = _bbox_filter(q, south, north, west, east)
        rows = q.all()

    points = [{"time": r[0].isoformat(), "count": int(r[1] or 0)} for r in rows]
    return {"points": points, "domain": domain, "hours": hours}


@router.get("/breakdown")
async def get_type_breakdown(
    domain: str = Query("ais", pattern="^(ais|adsb)$"),
    hours:  int = Query(24,  ge=1, le=2160),
    south:  Optional[float] = Query(None),
    north:  Optional[float] = Query(None),
    west:   Optional[float] = Query(None),
    east:   Optional[float] = Query(None),
):
    """Vessel/aircraft type tallies for bar/pie charts."""
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)

    with get_db() as db:
        q = (db.query(TrackDensity.vessel_types)
             .filter(TrackDensity.domain == domain,
                     TrackDensity.hour >= since,
                     TrackDensity.vessel_types.isnot(None)))
        q = _bbox_filter(q, south, north, west, east)
        rows = q.all()

    totals: dict[str, int] = {}
    for (types_json,) in rows:
        if not types_json:
            continue
        for t, c in types_json.items():
            totals[t] = totals.get(t, 0) + int(c)

    # Sort by count, top first
    sorted_totals = dict(sorted(totals.items(), key=lambda kv: -kv[1]))
    return {"breakdown": sorted_totals, "domain": domain, "hours": hours}
