"""
briefing_prep.py — Aggregate all active intelligence signals into a structured
intelligence picture for Claude to reason about.

prepare_intelligence_picture(db, forge_alerts, fusion_engine_instance) -> dict

Designed to run synchronously inside a ThreadPoolExecutor from an async context.
"""
from __future__ import annotations
import json
import math
import datetime
import time as _perf_time
from datetime import timedelta


def _region_ok(lat, lon, region: list[str] | None, extra_bbox: tuple | None = None) -> bool:
    """True if (lat, lon) falls inside — or within 400km of the edge of — any of
    the named regions in `region` (same bbox+buffer convention already used by
    scoring.geo_gate_passes for the Mission Profile surface-pool filter, and the
    same named-region vocabulary as Mission Profile's own focusRegions), or
    inside/near `extra_bbox` (an explicit (south, north, west, east) tuple —
    used for a real WatchZone's own bbox, which isn't one of the named
    REGION_BBOXES entries). No region and no extra_bbox => everything passes,
    i.e. today's unscoped behavior."""
    if not region and not extra_bbox:
        return True
    if lat is None or lon is None:
        return False
    from scoring import REGION_BBOXES, _haversine_km
    boxes = [REGION_BBOXES.get(rname) for rname in (region or [])]
    boxes = [b for b in boxes if b is not None]  # unrecognised region name — ignore, don't silently exclude everything
    if extra_bbox is not None:
        boxes.append(extra_bbox)
    for s, n, w, e in boxes:
        if s <= lat <= n and w <= lon <= e:
            return True
        clamp_lat = max(s, min(n, lat))
        clamp_lon = max(w, min(e, lon))
        if _haversine_km(lat, lon, clamp_lat, clamp_lon) <= 400.0:
            return True
    return False


def _period_ok(ts_value, period_start, period_end) -> bool:
    """True if ts_value falls within [period_start, period_end] (either bound
    may be None/open). No period requested => everything passes."""
    if not (period_start or period_end):
        return True
    if ts_value is None:
        return False
    if isinstance(ts_value, str):
        try:
            ts_value = datetime.datetime.fromisoformat(ts_value.replace("Z", "+00:00"))
        except Exception:
            return False
    if ts_value.tzinfo is not None:
        ts_value = ts_value.replace(tzinfo=None)
    if period_start and ts_value < period_start:
        return False
    if period_end and ts_value > period_end:
        return False
    return True


def _sql_region_filter(lat_col, lon_col, region: list[str] | None, extra_bbox: tuple | None = None):
    """Build a SQLAlchemy filter expression that restricts a query to rows whose
    (lat_col, lon_col) fall inside a bounding box around any of the named
    `region` entries, or `extra_bbox` (an explicit (south, north, west, east)
    tuple — a real WatchZone's own bbox) — buffered by the same 400km margin
    `_region_ok()` uses, so this is a deliberately over-inclusive SQL-level
    prefilter (a rectangle with a generous buffer, not the exact
    haversine-buffered check). It exists so the LIMIT applied afterwards
    bounds an already-region-scoped result set instead of the unscoped table
    — `_region_ok()` still runs per-row afterwards and remains the sole
    source of truth for exact inclusion.

    Returns None (no SQL-level restriction — caller should skip filtering and
    rely on `_region_ok()` alone) when `region` is falsy and `extra_bbox` is
    None, or when none of the requested names resolve to a known bbox — same
    "unrecognised name is ignored, never silently excludes everything" rule
    `_region_ok()` follows.
    """
    if not region and not extra_bbox:
        return None
    from sqlalchemy import and_, or_
    from scoring import REGION_BBOXES
    boxes = [REGION_BBOXES.get(rname) for rname in (region or [])]
    boxes = [b for b in boxes if b is not None]  # unrecognised name (or "Global") — skip
    if extra_bbox is not None:
        boxes.append(extra_bbox)
    clauses = []
    for s, n, w, e in boxes:
        lat_buf = 400.0 / 111.0
        # Longitude degrees-per-km shrinks with latitude; use the most extreme
        # (closest-to-pole) latitude in the buffered box so the buffer is never
        # too tight at any point along it.
        extreme_lat = min(max(abs(s), abs(n)) + lat_buf, 89.0)
        cos_lat = max(math.cos(math.radians(extreme_lat)), 0.05)
        lon_buf = 400.0 / (111.0 * cos_lat)
        clauses.append(and_(
            lat_col >= s - lat_buf, lat_col <= n + lat_buf,
            lon_col >= w - lon_buf, lon_col <= e + lon_buf,
        ))
    if not clauses:
        return None
    return or_(*clauses)


def prepare_intelligence_picture(
    db,
    forge_alerts: list | None = None,
    fusion_engine_instance=None,
    region: list[str] | None = None,
    period_start: "datetime.datetime | None" = None,
    period_end: "datetime.datetime | None" = None,
    bbox: tuple | None = None,
) -> dict:
    """
    Collect and score all active intelligence signals, group by region/zone,
    return a structured dict Claude can reason about directly.

    `region` (optional): list of named Mission-Profile-style region strings
    (must match scoring.REGION_BBOXES keys, e.g. "Red Sea / Arabian Peninsula")
    to scope every geolocated signal to. `bbox` (optional): an explicit
    (south, north, west, east) tuple to scope to instead of/in addition to
    `region` — used for a real WatchZone's own bbox, which isn't one of the
    named REGION_BBOXES entries (a Snapshot Report scoped to a specific Watch
    Area). `period_start`/`period_end` (optional): scope every signal to this
    time window instead of the fixed 24h/48h lookback windows below. All are
    additive — omitting them (the default) reproduces today's exact
    unscoped, "right now, everywhere" behavior byte-for-byte; every existing
    call site (Director briefings, the unscoped snapshot endpoint) keeps
    working unchanged.
    """
    from database import (
        FusionEvent, SurgeEvent, SentinelDetection, StrategicZone,
    )
    from intelligence_schema import IntelligenceAssessment
    import threat_matrix
    from relevance_scorer import relevance_scorer
    import functools

    now      = datetime.datetime.utcnow()
    cutoff_24h = now - timedelta(hours=24)
    cutoff_48h = now - timedelta(hours=48)
    # Sentinel/Overwatch scans run per-WatchZone on that zone's own
    # scan_interval_hours (real defaults of 24-120h, see database.py's
    # WatchZone.scan_interval_hours) rather than continuously the way
    # AIS/ADS-B stream — a 48h window would miss a real, recent scan on a
    # zone with a longer real revisit cadence. 14 days is a more realistic
    # "still current" window for imagery without becoming stale history.
    cutoff_imagery = now - timedelta(days=14)

    # Bind `bbox` into every _region_ok()/_sql_region_filter() call below
    # (14 call sites) without touching each one individually — every
    # unqualified call in the rest of this function resolves to these local
    # names, shadowing the module-level functions for the duration of this
    # call only. globals()[...] (not the bare name) on the right-hand side
    # is required here: once a name is assigned anywhere in a function body,
    # Python treats every reference to it in that function as local, so
    # `_region_ok = functools.partial(_region_ok, ...)` would raise
    # UnboundLocalError on its own right-hand side.
    _region_ok = functools.partial(globals()["_region_ok"], extra_bbox=bbox)
    _sql_region_filter = functools.partial(globals()["_sql_region_filter"], extra_bbox=bbox)

    # A scoped call (region and/or period actually requested) needs a much
    # higher DB fetch ceiling than the default unscoped snapshot: today's real
    # numbers already show 177 real quality-passing Alert rows in 24h against
    # a hardcoded limit(100) applied BEFORE the region/period filter below ever
    # ran — silently dropping 77 real rows on every single call, regardless of
    # region. Region/period restrictions are now pushed into the SQL query
    # itself (via `_sql_region_filter` / direct created_at bounds) so the
    # LIMIT below bounds an already-scoped result set rather than truncating
    # the unscoped table first — the raised ceiling is extra headroom on top
    # of that, not a substitute for it. Omitting region/period (the default,
    # existing call sites) reproduces the exact prior limits unchanged.
    scoped = bool(region) or bool(period_start) or bool(period_end) or bool(bbox)

    def _scoped_limit(base: int) -> int:
        return base * 10 if scoped else base

    # Real perf round — one lightweight, permanent total-timing log (not
    # the 10-checkpoint-per-call instrumentation used to actually find the
    # real bottleneck during that round's investigation, which lived here
    # temporarily and was removed once section 8's real missing-index cost
    # was confirmed and fixed — see AircraftHistory/VesselHistory's own
    # composite-index comments in database.py). A real >3s call is still
    # worth a visible log line in production even after that fix, since
    # this function's cost is a direct function of live table sizes that
    # will keep growing.
    _perf_t0 = _perf_time.perf_counter()

    alerts = list(forge_alerts or [])
    excluded_low_quality_alerts = 0

    # ── 0. Supplement forge_alerts with persisted Alert DB rows ──────────────
    # Quality filter: 99.9% of live Alert rows have alert_type='unknown' and a
    # blank title (confirmed by audit) — an artefact of upstream ingestion gaps,
    # not real intelligence content. Letting those into the picture would mean
    # a report silently treating that noise as if it were signal. Excluded here,
    # at the point where DB-backed alerts enter the snapshot, rather than
    # filtered later where it's easy to forget.
    try:
        from database import Alert as _AlertDB, NewsArticle as _NADB, OntologyLink as _OLDB
        _alert_q = db.query(_AlertDB).filter(
            _AlertDB.status == "active",
            _AlertDB.created_at >= cutoff_24h,
            _AlertDB.alert_type.isnot(None),
            _AlertDB.alert_type != "unknown",
            _AlertDB.title.isnot(None),
            _AlertDB.title != "",
        )
        _alert_region_clause = _sql_region_filter(_AlertDB.lat, _AlertDB.lon, region)
        if _alert_region_clause is not None:
            _alert_q = _alert_q.filter(_alert_region_clause)
        if period_start:
            _alert_q = _alert_q.filter(_AlertDB.created_at >= period_start)
        if period_end:
            _alert_q = _alert_q.filter(_AlertDB.created_at <= period_end)
        db_alert_rows = (
            _alert_q
            .order_by(_AlertDB.created_at.desc())
            .limit(_scoped_limit(100))
            .all()
        )
        total_active_count = (
            db.query(_AlertDB)
            .filter(_AlertDB.status == "active", _AlertDB.created_at >= cutoff_24h)
            .count()
        )
        quality_count = (
            db.query(_AlertDB)
            .filter(
                _AlertDB.status == "active",
                _AlertDB.created_at >= cutoff_24h,
                _AlertDB.alert_type.isnot(None),
                _AlertDB.alert_type != "unknown",
                _AlertDB.title.isnot(None),
                _AlertDB.title != "",
            )
            .count()
        )
        excluded_low_quality_alerts = max(0, total_active_count - quality_count)
        existing_ids = {str(a.get("id", "")) for a in alerts}
        for row in db_alert_rows:
            if row.alert_id not in existing_ids:
                alerts.append({
                    "id":        row.alert_id,
                    "source":    row.source,
                    "alert_type": row.alert_type,
                    "title":     row.title,
                    "severity":  row.severity,
                    "lat":       row.lat,
                    "lng":       row.lon,
                    "timestamp": row.created_at.isoformat() if row.created_at else "",
                })

        # Top news articles (last 24h, or the requested period). Tier <= 3
        # (everything but tier 4 = "irrelevant" per article_intelligence.py's
        # own classification prompt), not the old hard tier IN (1,2) gate —
        # that gate assumed most articles get a real per-article Haiku
        # classification, which the "cost reduction" cap
        # (MAX_LLM_CALLS_PER_CYCLE, main.py) had pushed down to 8/cycle,
        # leaving the overwhelming majority of real articles at the cheap
        # fallback classification (tier 3, article_type "other") rather than
        # a genuine tier 1/2 result — an empty/near-empty top_articles was
        # a direct, honest consequence, not a query bug on its own. Ranking
        # by (tier ASC, relevance_score DESC) still prefers genuinely
        # higher-tier real classifications when they exist, without
        # excluding tier-3 "contextual" real articles entirely when nothing
        # better is available — real content beats an empty section.
        # RSS is retired (status="retired" on every existing row) — explicit
        # filter rather than relying solely on the time window, so an old-
        # period historical report request can never resurface retired rows
        # as if they were live.
        _news_q = db.query(_NADB).filter(
            _NADB.tier <= 3, _NADB.ingested_at >= (period_start or cutoff_24h),
            _NADB.status == "active",
        )
        _news_region_clause = _sql_region_filter(_NADB.lat, _NADB.lon, region)
        if _news_region_clause is not None:
            _news_q = _news_q.filter(_news_region_clause)
        if period_end:
            _news_q = _news_q.filter(_NADB.ingested_at <= period_end)
        top_articles = (
            _news_q
            .order_by(_NADB.tier.asc(), _NADB.relevance_score.desc())
            .limit(_scoped_limit(20))
            .all()
        )
        top_articles = [
            a for a in top_articles
            if _region_ok(a.lat, a.lon, region) and _period_ok(a.ingested_at, None, period_end)
        ]
    except Exception:
        top_articles = []
    # ── 1. Threat matrix — use cached scores (refreshed hourly) ──────────────
    cached = threat_matrix.get_cached_scores()
    elevated_regions = []
    for row in cached:
        score = row.get("threat_score", 0)
        if score >= 25:
            elevated_regions.append({
                "region":  row["region_name"],
                "score":   score,
                "level":   row.get("threat_level", "LOW"),
                "trend":   row.get("trend", "stable"),
                "signals": row.get("contributing_signals", []),
            })
    elevated_regions.sort(key=lambda x: x["score"], reverse=True)
    # ── 2. Active fusion events ────────────────────────────────────────────────
    try:
        fusions = (
            db.query(FusionEvent)
            .filter(FusionEvent.status == "active", FusionEvent.expires_at > now)
            .order_by(FusionEvent.confidence.desc())
            .all()
        )
    except Exception:
        fusions = []

    fusions = [
        f for f in fusions
        if _region_ok(f.lat, f.lon, region) and _period_ok(f.created_at, period_start, period_end)
        # A real fusion event with no real resolvable location ("Unknown
        # Location", lat/lon both None) isn't citable content for a report —
        # there's nothing real to say about where it happened. Excluded
        # from the curated content handed to drafting; the underlying
        # correlation-engine issue that produces these is a separate,
        # already-flagged concern, not something fixed here.
        and not (f.lat is None and f.lon is None)
    ]

    fusion_items = []
    for f in fusions:
        try:
            fusion_items.append({
                "fusion_id":         f.fusion_id,
                "title":             f.title,
                "subtitle":          f.subtitle,
                "narrative":         f.narrative,
                "severity":          f.severity,
                "confidence":        f.confidence,
                "domains":           _safe_json(f.domains, []),
                "location":          f.location_name,
                "lat":               f.lat,
                "lon":               f.lon,
                "signal_count":      f.signal_count,
                "key_signals":       _safe_json(f.key_signals, []),
                "threat_indicators": _safe_json(f.threat_indicators, []),
                "created_at":        _iso(f.created_at),
            })
        except Exception:
            pass
    # ── 3. Active surge events ─────────────────────────────────────────────────
    try:
        surges = (
            db.query(SurgeEvent)
            .filter(SurgeEvent.status == "active", SurgeEvent.expires_at > now)
            .all()
        )
    except Exception:
        surges = []

    surges = [
        s for s in surges
        if _region_ok(s.lat, s.lon, region) and _period_ok(s.created_at, period_start, period_end)
    ]
    # SurgeEvent.severity is a free-text String column ("critical"/"high"/
    # "medium"/"low"), not an ordered type — a SQL .desc() on it sorts
    # alphabetically ("critical" < "high" < "low" < "medium"), which put the
    # least severe surges first and genuinely critical ones last. Real rank
    # sort instead, same convention as main.py's own SEV_ORDER.
    _SURGE_SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    surges.sort(key=lambda s: _SURGE_SEV_RANK.get((s.severity or "").lower(), 4))

    surge_items = []
    for s in surges:
        try:
            surge_items.append({
                "surge_id":     s.surge_id,
                "headline":     s.headline,
                "article_type": s.article_type,
                "surge_type":   s.surge_type,
                "location":     s.location_name,
                "country":      s.location_country,
                "lat":          s.lat,
                "lon":          s.lon,
                "article_count": s.article_count,
                "time_window":  s.time_window_description,
                "severity":     s.severity,
                "evidence":     _safe_json(s.evidence_items, [])[:5],
            })
        except Exception:
            pass
    # ── 4. Collect + score signals from forge alerts + fusion engine ───────────
    signals_raw: list[dict] = []
    seen_ids: set[str] = set()

    # Pre-fetch OntologyLinks for all alerts to enrich signal context
    _alert_links: dict = {}
    try:
        from database import OntologyLink as _OLsig
        alert_ids_for_links = [str(a.get("id", "")) for a in alerts[-100:] if a.get("id")]
        if alert_ids_for_links:
            links_rows = (db.query(_OLsig)
                          .filter(_OLsig.source_id.in_(alert_ids_for_links))
                          .all())
            for lr in links_rows:
                _alert_links.setdefault(lr.source_id, []).append({
                    "entity_type": lr.entity_type, "entity_name": lr.entity_name,
                    "link_type": lr.link_type, "distance_km": lr.distance_km,
                })
    except Exception:
        pass

    for a in alerts[-500:]:
        lat = a.get("lat")
        lon = a.get("lng") or a.get("lon")
        if lat is None or lon is None:
            continue
        if not _region_ok(lat, lon, region):
            continue
        if not _period_ok(a.get("timestamp"), period_start, period_end):
            continue
        sid = str(a.get("id") or f"alert-{lat:.3f}-{lon:.3f}")
        if sid in seen_ids:
            continue
        seen_ids.add(sid)
        _links = _alert_links.get(sid, [])
        signals_raw.append({
            "signal_id":    sid,
            "domain":       (a.get("source") or "AIS").upper(),
            "severity":     a.get("severity", "medium"),
            "lat":          lat,
            "lon":          lon,
            "location_name": a.get("title") or a.get("rule_name") or "",
            "summary":      a.get("message") or a.get("title") or "",
            "rule_name":    a.get("rule_name") or "",
            "title":        a.get("title") or "",
            "created_at":   a.get("timestamp") or now.isoformat(),
            "linked_zones":        [l["entity_name"] for l in _links if l["entity_type"] in ("watch_zone","strategic_zone")],
            "linked_cables":       [l["entity_name"] for l in _links if l["entity_type"] == "cable"],
            "linked_ports":        [l["entity_name"] for l in _links if l["entity_type"] == "port"],
        })

    if fusion_engine_instance:
        try:
            for bucket in fusion_engine_instance.active_signals.values():
                for s in bucket:
                    sid = str(s.get("signal_id", ""))
                    if not sid or sid in seen_ids:
                        continue
                    if not _region_ok(s.get("lat"), s.get("lon"), region):
                        continue
                    if not _period_ok(s.get("created_at"), period_start, period_end):
                        continue
                    seen_ids.add(sid)
                    signals_raw.append(s)
        except Exception:
            pass

    all_scored = relevance_scorer.score_all_active_signals(signals_raw, db)

    high_relevance = [s for s in all_scored if s.get("relevance_score", 0) >= 60]
    # Real relevance-rank sort before the top-10 cap below — score_all_active_
    # signals() only scores/mutates in place, it never sorts, so without this
    # the "top 10" kept was whichever 10 entered signals_raw first (arrival
    # order), not the 10 highest-relevance ones.
    high_relevance.sort(key=lambda s: -(s.get("relevance_score") or 0))
    ais_signals    = [s for s in high_relevance if s.get("domain", "") == "AIS"]
    adsb_signals   = [s for s in high_relevance if s.get("domain", "") == "ADSB"]
    # Real GeoConfirmed-origin signals (write_geoconfirmed_alerts() writes
    # these as real Alert rows, domain="GEOCONFIRMED" per this same
    # relevance_scorer pass) were already being computed and counted into
    # statistics.total_active_signals above — they just had no output
    # bucket of their own and were silently dropped before Generate.jsx's
    # corpus grid, the actual root cause of "GeoConfirmed points don't load
    # into Generate at all."
    geoconfirmed_signals = [s for s in high_relevance if s.get("domain", "") == "GEOCONFIRMED"]
    # ── 5. Recent Sentinel detections (14d, immediate + digest tier) ──────────
    # Was alert_tier == "immediate" only, 48h — too narrow on both axes for a
    # real imagery-analysis section: "digest" tier is still a real, confirmed
    # detection (see sentinel_ml.py's own tiering — "immediate" vs "digest"
    # is about alert urgency, not detection validity), and 48h is shorter
    # than most real scan_interval_hours values, so this used to exclude
    # genuinely current, real scans.
    try:
        _sent_q = db.query(SentinelDetection).filter(
            SentinelDetection.alert_tier.in_(["immediate", "digest"]),
            SentinelDetection.created_at > (period_start or cutoff_imagery),
        )
        _sent_region_clause = _sql_region_filter(
            SentinelDetection.centroid_lat, SentinelDetection.centroid_lon, region
        )
        if _sent_region_clause is not None:
            _sent_q = _sent_q.filter(_sent_region_clause)
        if period_end:
            _sent_q = _sent_q.filter(SentinelDetection.created_at <= period_end)
        sentinel_rows = (
            _sent_q
            .order_by(SentinelDetection.confidence.desc())
            .limit(_scoped_limit(20))
            .all()
        )
    except Exception:
        sentinel_rows = []

    sentinel_rows = [
        d for d in sentinel_rows
        if _region_ok(d.centroid_lat, d.centroid_lon, region)
        and _period_ok(d.created_at, None, period_end)  # lower bound already applied in the query above
    ]

    sentinel_items = []
    for d in sentinel_rows:
        try:
            zone_ctx = []
            if d.centroid_lat and d.centroid_lon:
                zone_ctx = relevance_scorer.get_containing_zones(d.centroid_lat, d.centroid_lon, db)
            sentinel_items.append({
                "detection_id":           d.detection_id,
                "object_type":            d.object_type,
                "confidence":             d.confidence,
                "severity":               d.severity,
                "lat":                    d.centroid_lat,
                "lon":                    d.centroid_lon,
                "nearest_port":           d.nearest_port,
                "nearest_infrastructure": d.nearest_infrastructure,
                "nearest_chokepoint":     d.nearest_chokepoint,
                "zone_context":           [z.get("name") for z in zone_ctx],
                "image_crop_url":         d.image_crop_url,
                "scan_timestamp":         _iso(d.created_at),
            })
        except Exception:
            pass
    # ── 6. Top news assessments (high/critical, not expired) ──────────────────
    try:
        from sqlalchemy import or_ as _or
        _assess_q = db.query(IntelligenceAssessment).filter(
            IntelligenceAssessment.domain == "NEWS",
            IntelligenceAssessment.expires_at > now,
            IntelligenceAssessment.severity.in_(["high", "critical"]),
        )
        _assess_region_clause = _sql_region_filter(
            IntelligenceAssessment.lat, IntelligenceAssessment.lon, region
        )
        if _assess_region_clause is not None:
            _assess_q = _assess_q.filter(_assess_region_clause)
        if period_start:
            _assess_q = _assess_q.filter(IntelligenceAssessment.created_at >= period_start)
        if period_end:
            _assess_q = _assess_q.filter(IntelligenceAssessment.created_at <= period_end)
        assessments = (
            _assess_q
            .order_by(IntelligenceAssessment.confidence.desc())
            .limit(_scoped_limit(15))
            .all()
        )
    except Exception:
        assessments = []

    assessments = [
        a for a in assessments
        if _region_ok(a.lat, a.lon, region) and _period_ok(a.created_at, period_start, period_end)
    ]

    assessment_items = []
    for a in assessments:
        try:
            assessment_items.append({
                "assessment_id": a.assessment_id,
                "type":          a.assessment_type,
                "headline":      a.headline,
                "summary":       a.summary,
                "severity":      a.severity,
                "confidence":    a.confidence,
                "location":      a.location_name,
                "country":       a.location_country,
                "lat":           a.lat,
                "lon":           a.lon,
                "key_signals":   _safe_json(a.key_signals, []),
                "evidence_count": a.evidence_count,
            })
        except Exception:
            pass
    # ── 7. Active strategic zones with signal counts ───────────────────────────
    try:
        zone_rows = db.query(StrategicZone).filter(StrategicZone.enabled == True).all()
    except Exception:
        zone_rows = []

    # Zones are static config, not time-scoped events — only region scoping applies
    # (by bbox centroid), no period filtering.
    zone_rows = [
        z for z in zone_rows
        if _region_ok((z.bbox_min_lat + z.bbox_max_lat) / 2, (z.bbox_min_lon + z.bbox_max_lon) / 2, region)
    ]

    active_zones = []
    for z in zone_rows:
        zone_signals = [
            s for s in all_scored
            if s.get("lat") is not None and s.get("lon") is not None
            and z.bbox_min_lat <= s["lat"] <= z.bbox_max_lat
            and z.bbox_min_lon <= s["lon"] <= z.bbox_max_lon
        ]
        if zone_signals or z.severity_baseline in ("high", "critical"):
            active_zones.append({
                "zone_id":             z.zone_id,
                "name":                z.name,
                "zone_type":           z.zone_type,
                "severity_baseline":   z.severity_baseline,
                "description":         z.description,
                "signal_count":        len(zone_signals),
                "highest_signal_score": max(
                    (s.get("relevance_score", 0) for s in zone_signals), default=0
                ),
            })

    active_zones.sort(key=lambda x: x["highest_signal_score"], reverse=True)
    # ── 8. Traffic summary — real counts, not just the top-10 "notable
    # anomaly" lists above. ais_signals/adsb_signals (relevance_score >= 60)
    # answer "what's worth flagging"; this answers "how much real traffic is
    # there at all" — a report citing "3 loitering vessels" with no sense of
    # whether that's out of 30 or 30,000 real vessels isn't actually
    # informative. Distinct mmsi/icao24 counts come from VesselHistory/
    # AircraftHistory (the same real, already-live position-history tables
    # GlobeTrackLayer.jsx reads) — real live traffic, not the alerts/signals
    # pipeline. Anomaly-type counts are real Alert rows already collected
    # above (`alerts`), matched against the real rule_name/alert_type values
    # each detector actually writes (detectors/ais_detector.py,
    # detectors/correlation_engine.py, main.py's sanctions relevance gate).
    try:
        from database import VesselHistory as _VH, AircraftHistory as _AH
        _traffic_window_start = period_start or cutoff_24h
        _vh_q = db.query(_VH.mmsi).filter(_VH.timestamp >= _traffic_window_start)
        _vh_region = _sql_region_filter(_VH.lat, _VH.lon, region)
        if _vh_region is not None:
            _vh_q = _vh_q.filter(_vh_region)
        if period_end:
            _vh_q = _vh_q.filter(_VH.timestamp <= period_end)
        active_vessel_count = _vh_q.distinct().count()

        _ah_q = db.query(_AH.icao24).filter(_AH.timestamp >= _traffic_window_start)
        _ah_region = _sql_region_filter(_AH.lat, _AH.lon, region)
        if _ah_region is not None:
            _ah_q = _ah_q.filter(_ah_region)
        if period_end:
            _ah_q = _ah_q.filter(_AH.timestamp <= period_end)
        active_aircraft_count = _ah_q.distinct().count()
    except Exception:
        active_vessel_count = active_aircraft_count = 0

    def _count_alerts_matching(rule_names: set[str] | None = None, alert_types: set[str] | None = None) -> int:
        n = 0
        for a in alerts:
            if rule_names and (a.get("rule_name") or "") in rule_names:
                n += 1
            elif alert_types and (a.get("alert_type") or "") in alert_types:
                n += 1
        return n

    traffic_summary = {
        "active_vessel_count":   active_vessel_count,
        "active_aircraft_count": active_aircraft_count,
        "loitering_count": _count_alerts_matching(rule_names={
            "AIS_LOITERING_NEAR_CABLE", "AIS_LOITERING_NEAR_INFRA", "ADSB_LOITERING_NEAR_AIRPORT",
        }),
        "dark_ship_count": _count_alerts_matching(rule_names={"AIS_DARK_SHIP"}),
        "sanctioned_vessel_count": _count_alerts_matching(alert_types={
            "Sanctioned Vessel", "Sanctioned Vessel (Possible)",
        }),
        "chokepoint_activity_count": _count_alerts_matching(rule_names={"AIS_CHOKEPOINT_ACTIVITY"}),
        "window_hours": int((now - _traffic_window_start).total_seconds() // 3600) if _traffic_window_start else 24,
    }
    # ── 9. Statistics ──────────────────────────────────────────────────────────
    total_signals    = len(all_scored)
    critical_signals = len([s for s in all_scored if s.get("relevance_score", 0) >= 70])

    _perf_elapsed = _perf_time.perf_counter() - _perf_t0
    if _perf_elapsed > 3.0:
        print(f"[perf][prepare_intelligence_picture] slow real call: {_perf_elapsed:.2f}s (scoped={scoped})")

    return {
        "generated_at":   now.isoformat(),
        "classification": "HORIZON WATCH INTELLIGENCE PICTURE",
        "statistics": {
            "total_active_signals": total_signals,
            "critical_signals":     critical_signals,
            "active_fusions":       len(fusion_items),
            "active_surges":        len(surge_items),
            "elevated_regions":     len(elevated_regions),
            "alerts_excluded_low_quality": excluded_low_quality_alerts,
        },
        "threat_overview": {
            "elevated_regions": elevated_regions,
            "most_active_zone": active_zones[0]["name"] if active_zones else None,
        },
        "traffic_summary":    traffic_summary,
        "fusion_events":      fusion_items,
        "surge_events":       surge_items,
        "ais_anomalies":      ais_signals[:10],
        "adsb_anomalies":     adsb_signals[:10],
        "geoconfirmed_signals": geoconfirmed_signals[:10],
        "sentinel_detections": sentinel_items[:10],
        "news_assessments":   assessment_items[:10],
        "strategic_zones":    active_zones[:10],
        "top_articles":       [
            {
                "url":           a.url, "title": a.event_title or a.title,
                "article_type":  a.article_type, "tier": a.tier,
                "relevance_score": a.relevance_score,
                "context_summary": a.context_summary,
                "country_code":  a.country_code, "lat": a.lat, "lon": a.lon,
            }
            for a in top_articles
        ],
        "foresight_risks":    _get_foresight_risks(db),
    }


def _get_foresight_risks(_unused_db) -> list:
    """Fetch top escalation risks from foresight assessments (last 24h, prob >= 0.40).
    Uses an isolated session to prevent a missing table from poisoning the caller's session."""
    try:
        from database import ForesightAssessment, get_db
        cutoff = datetime.datetime.utcnow() - timedelta(hours=24)
        with get_db() as _fdb:
            rows = (
                _fdb.query(ForesightAssessment)
                .filter(ForesightAssessment.generated_at >= cutoff,
                        ForesightAssessment.escalation_probability_30d >= 0.40)
                .order_by(ForesightAssessment.escalation_probability_30d.desc())
                .limit(5)
                .all()
            )
            return [
                {
                    "zone":                   a.zone_name,
                    "escalation_probability": float(a.escalation_probability_30d or 0),
                    "situation":              a.situation_summary or "",
                    "analyst_note":           a.analyst_note or "",
                    "confidence":             a.confidence or "low",
                    "scenarios":              _safe_json(a.likely_scenarios, [])[:2],
                }
                for a in rows
            ]
    except Exception as _fe:
        print(f"[briefing_prep] foresight_risks skipped: {_fe}")
        return []


def _safe_json(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime.datetime):
        return dt.isoformat()
    return str(dt)
