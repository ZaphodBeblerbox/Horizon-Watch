"""routers/geoconfirmed.py — /api/geoconfirmed/* endpoints.

Real, stored GeoConfirmed placemarks only — no live upstream call on the
request path (geoconfirmed.py's sync loop in main.py keeps the DB current).
Zero Claude/model calls anywhere in this module.
"""
from __future__ import annotations
import datetime

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/geoconfirmed", tags=["geoconfirmed"])


def _parse_theatres(theatre: str | None) -> list[str] | None:
    """Real multi-theatre support (historic-timeline round) — comma-separated
    slugs, e.g. 'ukraine,israel'. Kept backward compatible: a bare single
    slug (every existing caller) still works unchanged."""
    if not theatre:
        return None
    parts = [t.strip() for t in theatre.split(",") if t.strip()]
    return parts or None


@router.get("/placemarks")
def get_placemarks(
    theatre: str | None = Query(None, description="Real theatre slug(s), e.g. 'ukraine' or 'ukraine,israel'. Omit for all theatres."),
    max_age_days: int = Query(30, ge=1, le=3650),
    end_date: str | None = Query(None, description="Real historic-timeline round: ISO date (YYYY-MM-DD). When given, the max_age_days window ends here instead of at utcnow() — e.g. end_date=2022-03-01&max_age_days=30 returns real placemarks from 2022-01-30 through 2022-03-01, not a live 'last 30 days from now' window."),
    limit: int = Query(1000, ge=1, le=5000),
):
    """Real, active (non-removed) placemarks, most recent first. Bounded by
    age and count for the same reason every other dense map layer in this
    app is (see isMobile.js's per-layer caps) — Ukraine alone carries
    ~60,000 real historical pins; a live map view needs recent activity,
    not the full archive."""
    from database import GeoConfirmedPlacemark, get_db

    if end_date:
        anchor = datetime.datetime.strptime(end_date, "%Y-%m-%d") + datetime.timedelta(days=1)  # inclusive of the whole end_date day
    else:
        anchor = datetime.datetime.utcnow()
    cutoff = anchor - datetime.timedelta(days=max_age_days)
    theatres = _parse_theatres(theatre)
    with get_db() as db:
        q = db.query(GeoConfirmedPlacemark).filter(
            GeoConfirmedPlacemark.status == "active",
            GeoConfirmedPlacemark.date >= cutoff,
            GeoConfirmedPlacemark.date <= anchor,
        )
        if theatres:
            q = q.filter(GeoConfirmedPlacemark.theatre_slug.in_(theatres))
        rows = q.order_by(GeoConfirmedPlacemark.date.desc()).limit(limit).all()

        placemarks = [{
            "id": r.id,
            "theatre_slug": r.theatre_slug,
            "name": r.name,
            # PARALLAX addendum §A3. `title` is the composed sentence stored
            # at ingest and is what every surface must display; `name` is
            # kept only because it is GeoConfirmed's own field and the
            # inspector cites it as provenance. `date_label` is the date,
            # demoted to metadata where it belongs — a client that wants to
            # show the date shows this, and never the title.
            #
            # The fallback is r.name ONLY for a row the §A3 backfill has not
            # reached; it is deliberately not silent, because a date leaking
            # into this field is the defect, and `title_composed` lets a
            # caller (and the acceptance check) tell the two apart.
            "title": (r.title or r.name or "").strip() or None,
            "title_composed": bool(r.title),
            "category": r.category,
            "description": r.description,
            "date": r.date.isoformat() if r.date else None,
            "date_label": r.date.date().isoformat() if r.date else None,
            "date_precision": r.date_precision,
            "lat": r.latitude,
            "lon": r.longitude,
            "faction": r.faction,
            "faction_color": r.faction_color,
            "faction_invert_color": bool(r.faction_invert_color) if r.faction_invert_color is not None else None,
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
        "theatre": theatre, "max_age_days": max_age_days, "end_date": end_date,
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


@router.get("/date-range")
def get_date_range(
    theatre: str | None = Query(None, description="Real theatre slug(s), comma-separated. Omit for the full real range across all theatres."),
):
    """Real min/max placemark date — sizes the historic-timeline slider's
    real bounds from real data (Part 0/Part 1 of the historic-timeline
    round), never a hardcoded or assumed span."""
    from database import GeoConfirmedPlacemark, get_db
    from sqlalchemy import func

    theatres = _parse_theatres(theatre)
    with get_db() as db:
        q = db.query(func.min(GeoConfirmedPlacemark.date), func.max(GeoConfirmedPlacemark.date)).filter(
            GeoConfirmedPlacemark.status == "active"
        )
        if theatres:
            q = q.filter(GeoConfirmedPlacemark.theatre_slug.in_(theatres))
        min_date, max_date = q.one()
    return {
        "theatre": theatre,
        "min_date": min_date.date().isoformat() if min_date else None,
        "max_date": max_date.date().isoformat() if max_date else None,
    }


def _pick_bucket(span_days: int) -> str:
    """Real bucket auto-scaling (Part 2.1) — a bucket size that scales
    sensibly with the span selected, so a 13-year span doesn't render ~4700
    daily bars, and a 2-week span doesn't collapse into 1-2 monthly bars."""
    return "day" if span_days <= 180 else "month"


@router.get("/histogram")
def get_histogram(
    theatre: str | None = Query(None, description="Real theatre slug(s), comma-separated. Omit for all theatres."),
    start_date: str | None = Query(None, description="ISO date (YYYY-MM-DD). Omit to use the real earliest stored placemark date for this filter."),
    end_date: str | None = Query(None, description="ISO date (YYYY-MM-DD). Omit to use the real latest stored placemark date for this filter."),
    bucket: str | None = Query(None, description="'day' | 'month'. Omit to auto-scale from the real span — see _pick_bucket."),
):
    """Real occurrence-density histogram for the timeline panel (Part 2) —
    one grouped SQL query, never a fetch-all-rows-then-bucket-in-Python pass
    (Ukraine alone carries ~60k real rows across a 13-year span). Each
    bucket is keyed by its own real, exact start date (SQLite's date()/
    'start of month' modifier) rather than a formatted display label, so the
    frontend can scrub the slider to a clicked bar's exact real date with no
    lossy re-parsing."""
    from database import GeoConfirmedPlacemark, get_db
    from sqlalchemy import func

    theatres = _parse_theatres(theatre)
    with get_db() as db:
        real_min = real_max = None
        if not start_date or not end_date:
            bounds_q = db.query(func.min(GeoConfirmedPlacemark.date), func.max(GeoConfirmedPlacemark.date)).filter(
                GeoConfirmedPlacemark.status == "active"
            )
            if theatres:
                bounds_q = bounds_q.filter(GeoConfirmedPlacemark.theatre_slug.in_(theatres))
            real_min, real_max = bounds_q.one()
            if real_min is None:  # real, honest empty state — no data for this filter at all
                return {"theatre": theatre, "start_date": start_date, "end_date": end_date, "bucket": bucket or "day", "buckets": []}

        start = datetime.datetime.strptime(start_date, "%Y-%m-%d") if start_date else real_min
        end = (datetime.datetime.strptime(end_date, "%Y-%m-%d") + datetime.timedelta(days=1)) if end_date else (real_max + datetime.timedelta(days=1))

        span_days = max(1, (end - start).days)
        bucket_size = bucket if bucket in ("day", "month") else _pick_bucket(span_days)
        bucket_expr = func.date(GeoConfirmedPlacemark.date, "start of month") if bucket_size == "month" else func.date(GeoConfirmedPlacemark.date)

        q = db.query(bucket_expr, func.count(GeoConfirmedPlacemark.id)).filter(
            GeoConfirmedPlacemark.status == "active",
            GeoConfirmedPlacemark.date >= start,
            GeoConfirmedPlacemark.date < end,
        )
        if theatres:
            q = q.filter(GeoConfirmedPlacemark.theatre_slug.in_(theatres))
        rows = q.group_by(bucket_expr).order_by(bucket_expr).all()

    return {
        "theatre": theatre,
        "start_date": start.date().isoformat(), "end_date": (end - datetime.timedelta(days=1)).date().isoformat(),
        "bucket": bucket_size,
        "buckets": [{"bucket": b, "count": c} for b, c in rows],
    }
