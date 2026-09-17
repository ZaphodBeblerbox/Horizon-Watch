"""routers/alerts_derived.py — PARALLAX addendum §A12.

    GET /api/alerts/surges?at=&window=7d   → [{cell,cat,n,expected,p,place,rows}]
    GET /api/alerts/fusions?at=&window=4d  → [{cell,mods,items,span_h,strength,place}]

Both accept `at`, so the client can ask "what would have been surging on 12
August" — the playhead is a QUERY PARAMETER, not a client-side filter (§A7).
That distinction is the whole reason this is computed server-side: the surge
baseline is 90 days of records, and a browser asked to hold 90 days of every
theatre so it can re-filter them on each scrub would be shipping the archive
to do arithmetic the database can do in place.

Zero model calls. Every number returned is computed from stored records.
"""
from __future__ import annotations

import asyncio
import datetime
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

import alerts_derived as _D

router = APIRouter(prefix="/api/alerts", tags=["alerts-derived"])

_WINDOW = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([dh])\s*$", re.IGNORECASE)


def _parse_window(value: str, default_days: float) -> float:
    """'7d' / '96h' → days. A malformed window is refused rather than
    silently defaulted: a caller that asked for a 7-day window and quietly
    got 4 would read the resulting p-values as answers to a question it did
    not ask."""
    if not value:
        return default_days
    m = _WINDOW.match(value)
    if not m:
        raise HTTPException(400, f"window must look like '7d' or '96h', got {value!r}")
    n, unit = float(m.group(1)), m.group(2).lower()
    days = n if unit == "d" else n / 24.0
    if not (0 < days <= 365):
        raise HTTPException(400, "window must be between 0 and 365 days")
    return days


def _at_epoch(at: Optional[str]) -> float:
    """The evaluation moment. §A7: wall clock is only the default, never the
    assumption — a detector that can only ever answer "this week" is useless
    the moment an analyst goes looking at August."""
    if not at:
        return datetime.datetime.utcnow().timestamp()
    raw = at.strip().replace("Z", "+00:00")
    try:
        dt = datetime.datetime.fromisoformat(raw)
    except ValueError:
        try:
            dt = datetime.datetime.strptime(raw, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"at must be an ISO date or datetime, got {at!r}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return dt.timestamp()


# ── Loaders — one per modality, each returning plain dicts ────────────────

def _confirmations(db, at: float, span_days: float, theatres: Optional[list[str]]):
    from database import GeoConfirmedPlacemark

    end = datetime.datetime.utcfromtimestamp(at)
    start = end - datetime.timedelta(days=span_days)
    q = db.query(GeoConfirmedPlacemark).filter(
        GeoConfirmedPlacemark.status == "active",
        GeoConfirmedPlacemark.date >= start,
        GeoConfirmedPlacemark.date <= end,
    )
    if theatres:
        q = q.filter(GeoConfirmedPlacemark.theatre_slug.in_(theatres))
    out = []
    for r in q.all():
        if r.latitude is None or r.longitude is None or not r.date:
            continue
        out.append({
            "id": r.id, "lat": r.latitude, "lon": r.longitude,
            "ts": r.date.timestamp(),
            # `category` is NULL for rows the §A3 backfill has not reached.
            # They are loaded anyway — they still count toward a fusion
            # point — and detect_surges drops them from per-category
            # baselines on its own.
            "cat": r.category,
            "place": r.plus_code.split(" ", 1)[1] if (r.plus_code and " " in r.plus_code) else None,
            "title": r.title or r.name,
            "mod": "confirmation",
            "label": r.title or r.name,
            "ref": r.id,
        })
    return out


# The news table is a RAW article table, not a signal feed. 5,906 of its
# 6,066 geocoded rows are article_type 'other' — concert listings, gallery
# reviews, local colour — and they carry real coordinates, so they qualify
# as a modality just as readily as a conflict report does.
#
# Unfiltered, that is not a cosmetic problem: it is the difference between a
# fusion point meaning "independent sources agree something is happening
# here" and meaning "a sanctioned hull is moored in Berlin and a concert was
# announced nearby". The second is louder (there are far more concerts than
# conflicts) and would dominate the list while looking exactly like a
# finding. §A6's whole claim is that the coincidence IS the finding, which
# only holds if every contributing source is about the world the analyst is
# watching.
#
# So the signal modality is restricted to the security article types. This
# is deliberately a whitelist, not a blacklist: a new article_type must be
# considered before it can raise a critical fusion notification, rather than
# silently qualifying the day it is introduced.
_SIGNAL_ARTICLE_TYPES = (
    "conflict", "maritime", "aviation", "energy", "infrastructure",
    "cyber", "disaster", "political", "economic", "local_incident",
)


def _signals(db, at: float, span_days: float):
    """Corpus signals — the news layer. §A7's note about age vs date applies
    to the demo corpus; these rows carry a real `published` timestamp, so
    they are anchored to it and mean the same thing at any playhead."""
    from database import NewsArticle

    end = datetime.datetime.utcfromtimestamp(at)
    start = end - datetime.timedelta(days=span_days)
    out = []
    for r in db.query(NewsArticle).filter(
        NewsArticle.lat.isnot(None),
        NewsArticle.article_type.in_(_SIGNAL_ARTICLE_TYPES),
    ).all():
        ts = None
        for field in (r.published, r.ingested_at):
            if not field:
                continue
            try:
                ts = (field if isinstance(field, datetime.datetime)
                      else datetime.datetime.fromisoformat(str(field).replace("Z", "+00:00")))
                if ts.tzinfo is not None:
                    ts = ts.astimezone(datetime.timezone.utc).replace(tzinfo=None)
                break
            except (ValueError, TypeError):
                continue
        if not ts or not (start <= ts <= end):
            continue
        out.append({"lat": r.lat, "lon": r.lon, "ts": ts.timestamp(), "mod": "signal",
                    "label": r.event_title or r.title, "ref": f"NEWS-{r.id}",
                    "place": r.location_name})
    return out


def _imagery(db, at: float, span_days: float):
    from database import SentinelDetection

    end = datetime.datetime.utcfromtimestamp(at)
    start = end - datetime.timedelta(days=span_days)
    out = []
    for r in db.query(SentinelDetection).filter(
        SentinelDetection.centroid_lat.isnot(None),
        SentinelDetection.created_at >= start,
        SentinelDetection.created_at <= end,
    ).all():
        out.append({"lat": r.centroid_lat, "lon": r.centroid_lon,
                    "ts": r.created_at.timestamp(), "mod": "imagery",
                    "label": r.object_type or "Detection",
                    "ref": r.detection_id, "place": r.nearest_port or r.nearest_chokepoint})
    return out


# The alerts table's own type vocabulary, per modality. These are the REAL
# stored values, not the canonical names: 5,958 rows are typed
# "Sanctioned Vessel" and none at all begin with "AIS", so an `alert_type
# LIKE 'AIS%'` filter — the obvious one to write — silently matches nothing
# and the modality vanishes from every fusion point without any error.
#
# `geoconfirmed_event` is deliberately absent: those alerts are written FROM
# the placemarks the confirmation modality already loads, and counting them
# again would let one confirmation fuse with itself.
#
# `unknown` is also absent, and that is a known gap rather than an oversight:
# 54,483 active alerts are typed "unknown" because the AIS and ADS-B
# detectors emit `rule_name`, not `alert_type` (see alert_writer.py). The
# fallbacks there fix rows written from now on; these older rows cannot be
# re-typed without guessing, and a guess here would fabricate the modality
# that makes a fusion point a finding.
_MODALITY_ALERT_TYPES = {
    "ais": ("Sanctioned Vessel",),
    "aircraft": ("military_aircraft",),
}


def _alert_modalities(db, at: float, span_days: float):
    """AIS and ADS-B alerts, each as its own modality.

    Aircraft tracking is NOT folded into `ais`: §A6 counts distinct KINDS of
    source, so merging two genuinely independent sensor networks into one
    label would throw away exactly the independence the rule is testing for.
    """
    from database import Alert

    end = datetime.datetime.utcfromtimestamp(at)
    start = end - datetime.timedelta(days=span_days)
    wanted = [t for types in _MODALITY_ALERT_TYPES.values() for t in types]
    by_type = {t: mod for mod, types in _MODALITY_ALERT_TYPES.items() for t in types}

    out = []
    q = db.query(Alert).filter(
        Alert.status == "active",
        Alert.lat.isnot(None), Alert.lon.isnot(None),
        Alert.created_at >= start, Alert.created_at <= end,
        Alert.alert_type.in_(wanted),
    )
    for r in q.limit(20000).all():
        out.append({"lat": r.lat, "lon": r.lon, "ts": r.created_at.timestamp(),
                    "mod": by_type.get(r.alert_type, "ais"), "label": r.title,
                    "ref": r.alert_id, "place": r.region})
    return out


# ── Endpoints ─────────────────────────────────────────────────────────────

def _surges_sync(at: float, window_days: float, baseline_days: float,
                 theatres: Optional[list[str]], limit: int) -> dict:
    from database import get_db

    with get_db() as db:
        rows = _confirmations(db, at, window_days + baseline_days + 1, theatres)
    found = _D.detect_surges(rows, at, window_days=window_days,
                             baseline_days=baseline_days, limit=limit)
    return {
        "at": datetime.datetime.utcfromtimestamp(at).isoformat(),
        "window_days": window_days, "baseline_days": baseline_days,
        "considered": len(rows), "returned": len(found),
        "surges": found,
        "notifications": [_D.surge_notification(s) for s in found],
        "ontology": [_D.ontology_record(s) for s in found],
    }


@router.get("/surges")
async def get_surges(
    at: str | None = Query(None, description="§A7 playhead — ISO date or datetime. Omit for live."),
    window: str = Query("7d", description="Detection window, e.g. '7d'."),
    baseline: str = Query("90d", description="Baseline the window is measured against."),
    theatre: str | None = Query(None, description="Comma-separated theatre slugs."),
    limit: int = Query(6, ge=1, le=50),
):
    """Reporting volume above what a cell normally produces, per category.

    A CHANGE IN ATTENTION, NOT A CONFIRMED CHANGE ON THE GROUND — every
    consumer of this endpoint is required to say so where it renders the
    number (§A5), which is why `notifications` is returned pre-composed
    rather than left to each client to phrase.
    """
    at_ts = _at_epoch(at)
    w = _parse_window(window, 7)
    b = _parse_window(baseline, 90)
    theatres = [t.strip() for t in theatre.split(",") if t.strip()] if theatre else None
    return await asyncio.to_thread(_surges_sync, at_ts, w, b, theatres, limit)


def _fusions_sync(at: float, window_days: float, theatres: Optional[list[str]],
                  limit: int) -> dict:
    from database import get_db

    items: list[dict] = []
    with get_db() as db:
        # Each loader is independent, and one failing modality must not take
        # the finding with it: a fusion point over three of four available
        # kinds is still a real finding, and a silent empty list here would
        # disable the feature without anything appearing to break.
        for name, fn in (("confirmation", _confirmations), ("signal", _signals),
                         ("imagery", _imagery), ("alerts", _alert_modalities)):
            try:
                if fn is _confirmations:
                    items += fn(db, at, window_days, theatres)
                else:
                    items += fn(db, at, window_days)
            except Exception as e:
                print(f"[alerts-derived] fusion modality {name} unavailable: {e}")

    found = _D.detect_fusions(items, at, window_days=window_days, limit=limit)
    return {
        "at": datetime.datetime.utcfromtimestamp(at).isoformat(),
        "window_days": window_days,
        "considered": len(items),
        "modalities_present": sorted({i["mod"] for i in items}),
        "returned": len(found),
        "fusions": found,
        "notifications": [_D.fusion_notification(f) for f in found],
        "ontology": [_D.ontology_record(f) for f in found],
    }


@router.get("/fusions")
async def get_fusions(
    at: str | None = Query(None, description="§A7 playhead — ISO date or datetime. Omit for live."),
    window: str = Query("4d", description="Coincidence window, e.g. '4d'."),
    theatre: str | None = Query(None, description="Comma-separated theatre slugs."),
    limit: int = Query(5, ge=1, le=50),
):
    """Independent sources of DIFFERENT KINDS coinciding in one cell.

    `modalities_present` is returned so a caller can tell "nothing fused"
    from "only one kind of source had any data in this window" — the second
    is a gap in coverage, not a quiet world, and they must never look the
    same on a screen.
    """
    at_ts = _at_epoch(at)
    w = _parse_window(window, 4)
    theatres = [t.strip() for t in theatre.split(",") if t.strip()] if theatre else None
    return await asyncio.to_thread(_fusions_sync, at_ts, w, theatres, limit)
