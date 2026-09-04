"""Analytics router — heatmap, time-series, and type-breakdown endpoints
backed by the TrackDensity aggregation table."""

from __future__ import annotations

import datetime
import json
from typing import Optional

from fastapi import APIRouter, Query
from sqlalchemy import func, or_

from database import (
    TrackDensity, Alert, NewsArticle, SentinelDetection, WatchZone, Report,
    get_db,
)
import threat_matrix

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# ── Overview endpoint — real cross-domain aggregates for the Analytics page ──
# Severity vocabularies differ across tables (Alert/SentinelDetection use
# info/medium/high/critical; NewsArticle has no severity field, only an
# editorial tier 1-4). Both are remapped onto the 4-tier display vocabulary
# the design system's --sev-* tokens use (critical/high/moderate/low) —
# a display relabeling of real values, never a fabricated score.
_SEV_DISPLAY = {"critical": "critical", "high": "high", "medium": "moderate", "info": "low"}
_TIER_SEV = {1: "critical", 2: "high", 3: "moderate", 4: "low"}
_SEV_ORDER = ["critical", "high", "moderate", "low"]

_RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90}

_DOMAIN_LABELS = {"maritime": "Maritime", "air": "Air", "news": "News", "imagery": "Imagery", "zones": "Zones"}

# Real escalation-chain icon types (backend/database.py EscalationChain rows,
# and correlation_engine.py's own generic dual/triple markers) are the only
# reliable way to identify a fired escalation post-hoc, since write_alert()
# stores them with alert_type="unknown" — see backend/detectors/correlation_engine.py.
_ESCALATION_MARKERS = ["ESCALATED_DUAL", "ESCALATED_TRIPLE", "DARK_SHIP_CABLE", "ESCALATED_DUAL_"]


def _classify_region(lat, lon):
    if lat is None or lon is None:
        return "Other"
    for name, info in threat_matrix.REGIONS.items():
        if threat_matrix._in_bbox(lat, lon, info["bbox"]):
            return name
    return "Other"


def _window(range_key: str):
    days = _RANGE_DAYS.get(range_key, 30)
    now = datetime.datetime.utcnow()
    cur_start = now - datetime.timedelta(days=days)
    prior_start = cur_start - datetime.timedelta(days=days)
    return now, cur_start, prior_start, days


def _pct_delta(cur: int, prior: int):
    if prior <= 0:
        return None
    return round(((cur - prior) / prior) * 100, 1)


@router.get("/overview")
async def get_overview(
    range: str = Query("30d", pattern="^(7d|30d|90d)$"),
    region: str = Query("all"),
    domain: str = Query("all", pattern="^(all|maritime|air|news|imagery|zones)$"),
):
    """Real, live-computed aggregates for the Analytics page — KPIs, a daily
    volume series, severity/domain/region/source breakdowns, a region x
    domain heatmap, index movers, and the highest-severity signals table.
    Every figure is derived from Alert/NewsArticle/SentinelDetection/
    WatchZone/Report rows for the selected window — nothing here is
    randomized, and an empty real result renders as a real zero/None rather
    than a fabricated placeholder number.
    """
    now, cur_start, prior_start, days = _window(range)
    region_names = list(threat_matrix.REGIONS.keys()) + ["Other"]
    if region != "all" and region not in region_names:
        region = "all"

    with get_db() as db:
        # ── Fetch the three raw signal sources for the full cur+prior span ──
        alerts = (
            db.query(Alert.id, Alert.severity, Alert.source, Alert.lat, Alert.lon,
                     Alert.zone_ids, Alert.created_at, Alert.status, Alert.title,
                     Alert.entity_id, Alert.entity_type, Alert.alert_id, Alert.analyst_note)
            .filter(Alert.created_at >= prior_start)
            .all()
        )
        articles = (
            db.query(NewsArticle.url, NewsArticle.tier, NewsArticle.lat, NewsArticle.lon,
                     NewsArticle.ingested_at, NewsArticle.source_name, NewsArticle.title,
                     NewsArticle.llm_extracted)
            .filter(NewsArticle.ingested_at >= prior_start)
            .all()
        )
        detections = (
            db.query(SentinelDetection.detection_id, SentinelDetection.severity,
                     SentinelDetection.centroid_lat, SentinelDetection.centroid_lon,
                     SentinelDetection.created_at, SentinelDetection.object_type)
            .filter(SentinelDetection.created_at >= prior_start)
            .all()
        )

        watch_zones_enabled = db.query(WatchZone).filter(WatchZone.enabled == True).all()  # noqa: E712

        reports_published_cur = (
            db.query(Report)
            .filter(Report.status == "published", Report.published_at >= cur_start)
            .all()
        )
        escalations_cur = (
            db.query(func.count(Alert.id))
            .filter(Alert.created_at >= cur_start,
                    or_(*[Alert.raw_json.like(f"%{m}%") for m in _ESCALATION_MARKERS]))
            .scalar()
        ) or 0

    # ── Normalize into one unified signal list ──
    signals = []
    for row in alerts:
        (aid, sev, source, lat, lon, zone_ids, created_at, status, title,
         entity_id, entity_type, alert_id, analyst_note) = row
        zones = []
        try:
            zones = json.loads(zone_ids) if zone_ids else []
        except (ValueError, TypeError):
            zones = []
        src_norm = (source or "").lower()
        if zones:
            dom = "zones"
        elif "adsb" in src_norm:
            dom = "air"
        elif "ais" in src_norm:
            dom = "maritime"
        else:
            dom = "zones"
        signals.append({
            "id": alert_id, "kind": "alert", "domain": dom,
            "severity": _SEV_DISPLAY.get((sev or "").lower(), "moderate"),
            "region": _classify_region(lat, lon), "lat": lat, "lon": lon,
            "created_at": created_at, "title": title, "source": src_norm or "unknown",
            "status": status, "entity_id": entity_id, "entity_type": entity_type,
            "assessed": bool(analyst_note),
        })
    for row in articles:
        url, tier, lat, lon, ingested_at, source_name, title, llm_extracted = row
        signals.append({
            "id": url, "kind": "news", "domain": "news",
            "severity": _TIER_SEV.get(tier, "moderate"),
            "region": _classify_region(lat, lon), "lat": lat, "lon": lon,
            "created_at": ingested_at, "title": title,
            "source": (source_name or "unknown"), "status": "active",
            "entity_id": None, "entity_type": None, "assessed": bool(llm_extracted),
        })
    for row in detections:
        det_id, sev, lat, lon, created_at, object_type = row
        signals.append({
            "id": det_id, "kind": "imagery", "domain": "imagery",
            "severity": _SEV_DISPLAY.get((sev or "").lower(), "moderate"),
            "region": _classify_region(lat, lon), "lat": lat, "lon": lon,
            "created_at": created_at, "title": f"{object_type} detection",
            "source": "sentinel", "status": "active",
            "entity_id": None, "entity_type": "detection", "assessed": False,
        })

    if region != "all":
        signals = [s for s in signals if s["region"] == region]
    if domain != "all":
        signals = [s for s in signals if s["domain"] == domain]

    cur_signals = [s for s in signals if s["created_at"] and s["created_at"] >= cur_start]
    prior_signals = [s for s in signals if s["created_at"] and prior_start <= s["created_at"] < cur_start]

    # ── KPIs ──
    def _kpi(cur_val, prior_val):
        return {"value": cur_val, "delta_pct": _pct_delta(cur_val, prior_val)}

    critical_open_cur = sum(1 for s in cur_signals if s["severity"] == "critical" and s["status"] == "active")
    critical_open_prior = sum(1 for s in prior_signals if s["severity"] == "critical" and s["status"] == "active")
    regions_cur = len({s["region"] for s in cur_signals if s["region"] != "Other"})
    regions_prior = len({s["region"] for s in prior_signals if s["region"] != "Other"})
    assessed_cur = sum(1 for s in cur_signals if s["assessed"])
    assessed_prior = sum(1 for s in prior_signals if s["assessed"])

    mttr_hours = None
    if reports_published_cur:
        deltas = [(r.published_at - r.created_at).total_seconds() / 3600.0 for r in reports_published_cur]
        mttr_hours = round(sum(deltas) / len(deltas), 1)

    kpis = {
        "signals_ingested": _kpi(len(cur_signals), len(prior_signals)),
        "signals_assessed": _kpi(assessed_cur, assessed_prior),
        "critical_open": _kpi(critical_open_cur, critical_open_prior),
        "regions_touched": _kpi(regions_cur, regions_prior),
        "aois_watched": {"value": len(watch_zones_enabled), "delta_pct": None},
        "reports_issued": {"value": len(reports_published_cur), "delta_pct": None},
        "mean_time_to_report_hours": {"value": mttr_hours, "delta_pct": None},
        "escalations": {"value": int(escalations_cur), "delta_pct": None},
    }

    # ── Daily volume series ──
    buckets: dict[str, int] = {}
    d = cur_start.date()
    while d <= now.date():
        buckets[d.isoformat()] = 0
        d += datetime.timedelta(days=1)
    for s in cur_signals:
        key = s["created_at"].date().isoformat()
        if key in buckets:
            buckets[key] += 1
    timeseries = [{"date": k, "count": v} for k, v in sorted(buckets.items())]

    # ── Donuts: severity (real colors), domain/region/source (grey ramp) ──
    def _tally(items, key_fn):
        out: dict[str, int] = {}
        for s in items:
            k = key_fn(s)
            out[k] = out.get(k, 0) + 1
        return out

    sev_tally = _tally(cur_signals, lambda s: s["severity"])
    donut_severity = [{"key": k, "label": k.capitalize(), "value": sev_tally.get(k, 0)} for k in _SEV_ORDER]

    dom_tally = _tally(cur_signals, lambda s: s["domain"])
    donut_domain = [
        {"key": k, "label": _DOMAIN_LABELS[k], "value": dom_tally.get(k, 0)}
        for k in ["maritime", "air", "news", "imagery", "zones"]
    ]

    reg_tally = _tally(cur_signals, lambda s: s["region"])
    donut_region = sorted(
        ({"key": k, "label": k, "value": v} for k, v in reg_tally.items() if v > 0),
        key=lambda r: r["key"],
    )

    src_tally = _tally(cur_signals, lambda s: s["source"])
    top_sources = sorted(src_tally.items(), key=lambda kv: (-kv[1], kv[0]))
    donut_source = [{"key": k, "label": k, "value": v} for k, v in top_sources[:13]]
    other_src_total = sum(v for _, v in top_sources[13:])
    if other_src_total:
        donut_source.append({"key": "other", "label": "Other", "value": other_src_total})
    donut_source.sort(key=lambda r: r["key"])

    # ── Heatmap: region x domain, real counts, explicit zero cells ──
    active_regions = sorted({s["region"] for s in cur_signals if s["region"] != "Other"})
    heatmap_domains = ["maritime", "air", "news", "imagery", "zones"]
    cell_tally: dict[tuple, int] = {}
    for s in cur_signals:
        if s["region"] == "Other":
            continue
        key = (s["region"], s["domain"])
        cell_tally[key] = cell_tally.get(key, 0) + 1
    heatmap_cells = [
        {"region": r, "domain": d, "count": cell_tally.get((r, d), 0)}
        for r in active_regions for d in heatmap_domains
    ]

    # ── Index movers: per-region delta, current vs prior window ──
    cur_by_region = _tally(cur_signals, lambda s: s["region"])
    prior_by_region = _tally(prior_signals, lambda s: s["region"])
    mover_keys = set(cur_by_region) | set(prior_by_region)
    movers = []
    for k in mover_keys:
        if k == "Other":
            continue
        cur_v, prior_v = cur_by_region.get(k, 0), prior_by_region.get(k, 0)
        movers.append({
            "key": k, "label": k, "current": cur_v, "prior": prior_v,
            "delta": cur_v - prior_v, "delta_pct": _pct_delta(cur_v, prior_v),
        })
    movers.sort(key=lambda m: -abs(m["delta"]))
    movers = movers[:10]
    max_abs_delta = max((abs(m["delta"]) for m in movers), default=0) or 1
    for m in movers:
        m["bar_pct"] = round(abs(m["delta"]) / max_abs_delta * 100, 1)

    # ── Highest-severity signals table — critical first, then high, each
    # group newest-first (stable sort: sort by time desc, then re-sort by
    # severity rank, which preserves the time ordering within each rank) ──
    top_signals = [s for s in cur_signals if s["severity"] in ("critical", "high") and s["created_at"]]
    top_signals.sort(key=lambda s: s["created_at"], reverse=True)
    top_signals.sort(key=lambda s: 0 if s["severity"] == "critical" else 1)
    top_signals = top_signals[:50]
    top_signals_out = [
        {
            "id": s["id"], "title": s["title"], "severity": s["severity"],
            "domain": s["domain"], "region": s["region"], "lat": s["lat"], "lon": s["lon"],
            "created_at": s["created_at"].isoformat() if s["created_at"] else None,
            "entity_id": s["entity_id"], "entity_type": s["entity_type"], "source": s["source"],
        }
        for s in top_signals
    ]

    return {
        "range": range, "region": region, "domain": domain,
        "generated_at": now.isoformat(),
        "kpis": kpis,
        "timeseries": timeseries,
        "donuts": {
            "severity": donut_severity, "domain": donut_domain,
            "region": donut_region, "source": donut_source,
        },
        "heatmap": {"regions": active_regions, "domains": heatmap_domains, "cells": heatmap_cells},
        "movers": movers,
        "top_signals": top_signals_out,
        "region_options": region_names,
    }


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
