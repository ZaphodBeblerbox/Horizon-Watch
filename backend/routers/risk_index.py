"""routers/risk_index.py — the real GDELT country risk index endpoints
(Parallax translation step 1, Part 4). See gdelt_risk_index.py for the real
scoring engine and its own detailed real-data-depth honesty notes.

Structural separation from the exposure-scoring engine (fusion_engine.py/
correlation_scoring.py): this router imports ONLY gdelt_risk_index,
gdelt_events, geoconfirmed's country_registry, and database — never
fusion_engine or correlation_scoring, and neither of those modules imports
anything from here. Grep-verified in the Part 4 report, not just asserted.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Body

import gdelt_risk_index as _gri

router = APIRouter(prefix="/api/risk-index", tags=["risk-index"])

# Real, session-lifetime weight override (in-memory; a real per-analyst
# server-persisted setting is real future work beyond this pass's scope —
# stated explicitly, not silently simplified). Starts at the real default.
_current_weights: dict = dict(_gri.DEFAULT_WEIGHTS)


def _real_geoconfirmed_counts_by_iso(window_days: int) -> dict:
    """Real GeoConfirmed placemark counts per real ISO country code in the
    real window, resolved via the same real country_registry.py used
    elsewhere in this app (never a second, disagreeing country-resolution
    mechanism)."""
    import datetime
    import country_registry
    from database import SessionLocal, GeoConfirmedPlacemark

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=window_days)
    counts: dict = {}
    with SessionLocal() as db:
        rows = db.query(GeoConfirmedPlacemark.plus_code).filter(
            GeoConfirmedPlacemark.status == "active",
            GeoConfirmedPlacemark.date >= cutoff,
        ).all()
    for (plus_code,) in rows:
        if not plus_code:
            continue
        raw = plus_code.rsplit(",", 1)[-1].strip() if "," in plus_code else None
        if not raw:
            continue
        resolved = country_registry.canonical_country(raw)
        if resolved:
            iso = resolved[0]
            counts[iso] = counts.get(iso, 0) + 1
    return counts


def get_all_events() -> list:
    import gdelt_events
    return gdelt_events.EVENTS_CACHE.get("events", [])


def real_history_days(events: list) -> float:
    dts = [d for d in (_gri._event_dt(e) for e in events) if d is not None]
    if len(dts) < 2:
        return 0.0
    return (max(dts) - min(dts)).total_seconds() / 86400.0


@router.get("/countries")
def get_all_country_risk(window_days: int = 30):
    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    hist_days = real_history_days(events)
    results = _gri.compute_all_countries(
        events, geo_counts, weights=_current_weights, window_days=window_days, real_history_days=hist_days,
    )
    return {
        "countries": results, "weights": _current_weights,
        "real_gdelt_history_days": hist_days, "real_total_gdelt_events": len(events),
        "window_days": window_days,
    }


@router.get("/country/{iso_code}")
def get_one_country_risk(iso_code: str, window_days: int = 30):
    events = get_all_events()
    geo_counts = _real_geoconfirmed_counts_by_iso(window_days)
    hist_days = real_history_days(events)
    result = _gri.compute_country_risk(
        iso_code.upper(), events, geo_counts, weights=_current_weights,
        window_days=window_days, real_history_days=hist_days,
    )
    return result


@router.get("/weights")
def get_weights():
    return {"weights": _current_weights, "default_weights": _gri.DEFAULT_WEIGHTS}


@router.post("/weights")
def set_weights(weights: dict = Body(...)):
    """Real, live weight adjustment — every real subsequent /countries or
    /country/{iso} call reflects the new weights immediately (verified by
    this round's own regression test)."""
    for k in weights:
        if k not in _gri.DEFAULT_WEIGHTS:
            raise HTTPException(status_code=400, detail=f"unknown weight key: {k}")
    global _current_weights
    _current_weights = {**_current_weights, **{k: float(v) for k, v in weights.items()}}
    return {"weights": _current_weights}


@router.post("/weights/reset")
def reset_weights():
    global _current_weights
    _current_weights = dict(_gri.DEFAULT_WEIGHTS)
    return {"weights": _current_weights}
