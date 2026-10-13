"""routers/frontline_claims.py — claimed control changes, troop movements and
drone/missile trajectories (frontline_claims.py). Derived on read from
strike_events; nothing stored, no model calls, no network on the request path."""
from __future__ import annotations

from fastapi import APIRouter, Query

import frontline_claims as fc

router = APIRouter(prefix="/api/frontlines", tags=["frontlines"])


def _meta(d: dict) -> dict:
    return {k: d.get(k) for k in ("window_hours", "sides", "side_colours", "sides_note", "official_line",
                                  "events_source", "synthetic", "notes")}


@router.get("/overlay")
def get_overlay(hours: int = Query(168, ge=1, le=720)):
    """Claims, movements and trajectories in one response (the map's layers)."""
    return fc.overlay(hours)


@router.get("/claims")
def get_claims(hours: int = Query(168, ge=1, le=720)):
    d = fc.overlay(hours)
    return {**_meta(d), "available": True, "claims": d["claims"]}


@router.get("/movements")
def get_movements(hours: int = Query(168, ge=1, le=720)):
    d = fc.overlay(hours)
    return {**_meta(d), "available": True, "movements": d["movements"]}


@router.get("/trajectories")
def get_trajectories(hours: int = Query(168, ge=1, le=720)):
    d = fc.overlay(hours)
    return {**_meta(d), "available": True, "trajectories": d["trajectories"]}
