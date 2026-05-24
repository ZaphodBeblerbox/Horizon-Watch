"""
threat_matrix.py — Regional threat scoring engine.

compute_threat_score(region_name, db) → dict
save_daily_snapshot(db)
refresh_cache()   — called hourly from the scheduler
"""

import json
import math
import datetime

_threat_cache_history: dict = {}   # region_name → {"score": float}


def _get_trend_delta(region_name: str, current_score: float, db) -> float:
    """Return score delta vs 24h ago from ThreatSnapshotHourly. Returns 0 if no data."""
    try:
        from database import ThreatSnapshotHourly
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
        row = (db.query(ThreatSnapshotHourly)
               .filter(ThreatSnapshotHourly.region_name == region_name,
                       ThreatSnapshotHourly.snapshot_at <= cutoff)
               .order_by(ThreatSnapshotHourly.snapshot_at.desc())
               .first())
        if row:
            return round(current_score - row.score, 1)
    except Exception:
        pass
    return 0.0


def _build_narrative(region_name: str, score: float, trend: str, drivers: dict) -> str:
    level = _threat_level(score)
    parts = []
    if drivers.get("fusion_events", 0) > 0:
        parts.append(f"{drivers['fusion_events']} active intelligence fusion event(s)")
    if drivers.get("forge_alert_count", 0) > 0:
        parts.append(f"{drivers['forge_alert_count']} sensor-triggered alert(s)")
    if drivers.get("surge_bonus", 0) > 0:
        parts.append("surge-level news activity")
    if drivers.get("sentinel_score", 0) > 0:
        parts.append("satellite detections")
    if drivers.get("alert_count", 0) > 0 and drivers.get("forge_alert_count", 0) == 0:
        parts.append(f"{drivers['alert_count']} open alert(s)")
    signal_str = (", ".join(parts[:3]) + ".") if parts else "Low signal activity."
    trend_str = {"escalating": "Threat is escalating.",
                 "de-escalating": "Situation de-escalating.",
                 "stable": "Situation stable."}.get(trend, "")
    return f"{region_name} — {level} threat ({score:.0f}/100). {signal_str} {trend_str}".strip()

# ── Region definitions ────────────────────────────────────────────────────────
# bbox keys: min_lat, max_lat, min_lon, max_lon

REGIONS: dict = {
    "Baltic": {
        "region_ids": ["REG-NORSEA"],
        "bbox": {"min_lat": 53.0, "max_lat": 66.0, "min_lon": 10.0, "max_lon": 30.0},
        "countries": ["Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Germany", "Sweden", "Denmark", "Russia", "Belarus"],
        "country_codes": ["FI", "EE", "LV", "LT", "PL", "DE", "SE", "DK", "RU", "BY"],
    },
    "East Mediterranean": {
        "region_ids": ["REG-MED"],
        "bbox": {"min_lat": 30.0, "max_lat": 37.0, "min_lon": 25.0, "max_lon": 37.0},
        "countries": ["Greece", "Turkey", "Cyprus", "Lebanon", "Israel", "Syria", "Egypt", "Libya", "Palestine"],
        "country_codes": ["GR", "TR", "CY", "LB", "IL", "PS", "SY", "EG", "LY"],
    },
    "Black Sea / Ukraine": {
        "region_ids": [],
        "bbox": {"min_lat": 40.0, "max_lat": 50.0, "min_lon": 27.0, "max_lon": 42.0},
        "countries": ["Ukraine", "Romania", "Bulgaria", "Georgia", "Turkey", "Russia", "Moldova"],
        "country_codes": ["UA", "RO", "BG", "GE", "TR", "RU", "MD"],
    },
    "Persian Gulf": {
        "region_ids": ["REG-REDSEA"],
        "bbox": {"min_lat": 23.0, "max_lat": 30.0, "min_lon": 48.0, "max_lon": 60.0},
        "countries": ["Iran", "Iraq", "Kuwait", "Saudi Arabia", "Qatar", "United Arab Emirates", "Oman", "Bahrain"],
        "country_codes": ["IR", "IQ", "KW", "SA", "QA", "AE", "OM", "BH"],
    },
    "Red Sea / Bab el-Mandeb": {
        "region_ids": ["REG-REDSEA"],
        "bbox": {"min_lat": 12.0, "max_lat": 22.0, "min_lon": 32.0, "max_lon": 45.0},
        "countries": ["Yemen", "Djibouti", "Eritrea", "Somalia", "Ethiopia", "Saudi Arabia", "Egypt", "Sudan"],
        "country_codes": ["YE", "DJ", "ER", "SO", "ET", "SA", "EG", "SD"],
    },
    "Sahel": {
        "region_ids": [],
        "bbox": {"min_lat": 10.0, "max_lat": 20.0, "min_lon": -15.0, "max_lon": 15.0},
        "countries": ["Mali", "Niger", "Burkina Faso", "Nigeria", "Chad", "Mauritania", "Senegal", "Guinea", "Gambia"],
        "country_codes": ["ML", "NE", "BF", "NG", "TD", "MR", "SN", "GN", "GM"],
    },
    "Horn of Africa": {
        "region_ids": [],
        "bbox": {"min_lat": -5.0, "max_lat": 15.0, "min_lon": 35.0, "max_lon": 55.0},
        "countries": ["Somalia", "Ethiopia", "Djibouti", "Eritrea", "Kenya", "South Sudan"],
        "country_codes": ["SO", "ET", "DJ", "ER", "KE", "SS"],
    },
    "South China Sea": {
        "region_ids": ["REG-SEASIA"],
        "bbox": {"min_lat": 5.0, "max_lat": 25.0, "min_lon": 105.0, "max_lon": 125.0},
        "countries": ["China", "Vietnam", "Philippines", "Malaysia", "Brunei", "Taiwan", "Indonesia"],
        "country_codes": ["CN", "VN", "PH", "MY", "BN", "TW", "ID"],
    },
    "Taiwan Strait": {
        "region_ids": ["REG-SEASIA"],
        "bbox": {"min_lat": 22.0, "max_lat": 28.0, "min_lon": 116.0, "max_lon": 125.0},
        "countries": ["China", "Taiwan"],
        "country_codes": ["CN", "TW"],
    },
    "Indian Ocean": {
        "region_ids": ["REG-IND"],
        "bbox": {"min_lat": -10.0, "max_lat": 15.0, "min_lon": 55.0, "max_lon": 80.0},
        "countries": ["India", "Sri Lanka", "Maldives", "Pakistan", "Iran", "Oman", "Mozambique", "Tanzania"],
        "country_codes": ["IN", "LK", "MV", "PK", "IR", "OM", "MZ", "TZ"],
    },
}


def _in_bbox(lat, lon, bbox: dict) -> bool:
    if lat is None or lon is None:
        return False
    return (bbox["min_lat"] <= lat <= bbox["max_lat"] and
            bbox["min_lon"] <= lon <= bbox["max_lon"])


def _threat_level(score: float) -> str:
    if score >= 75: return "CRITICAL"
    if score >= 50: return "HIGH"
    if score >= 25: return "MEDIUM"
    return "LOW"


def compute_threat_score(region_name: str, db, forge_alerts: list = None,
                          news_events: list = None,
                          fusion_events: list = None) -> dict:
    """
    Compute a 0-100 composite threat score for a region.
    Primary source: persisted Alert + FusionEvent + SentinelDetection DB tables.
    forge_alerts / news_events / fusion_events used as supplement when DB empty.
    """
    from database import SentinelDetection, Alert, FusionEvent, OntologyLink
    region = REGIONS.get(region_name)
    if not region:
        return {"region_name": region_name, "threat_score": 0.0, "threat_level": "LOW",
                "alert_count": 0, "forge_alert_count": 0,
                "sentinel_detection_count": 0, "news_event_count": 0,
                "contributing_signals": []}

    bbox   = region["bbox"]
    now    = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(hours=24)
    SEV_WEIGHTS = {"info": 0.5, "medium": 1, "high": 2, "critical": 4}

    # ── 1. Persisted Alerts (bbox spatial filter, last 24h) ───────────────────
    db_alerts      = []
    db_alert_count = 0
    weighted_alert_score = 0.0
    try:
        db_alerts = (db.query(Alert)
                     .filter(
                         Alert.status == "active",
                         Alert.created_at >= cutoff,
                         Alert.lat.between(bbox["min_lat"], bbox["max_lat"]),
                         Alert.lon.between(bbox["min_lon"], bbox["max_lon"]),
                     )
                     .all())
        db_alert_count = len(db_alerts)
        weighted_alert_score = sum(SEV_WEIGHTS.get(a.severity or "medium", 1) for a in db_alerts)
    except Exception:
        pass

    # Fallback to in-memory forge_alerts if DB table empty
    alerts_all = forge_alerts or []
    mem_alerts = [a for a in alerts_all
                  if _in_bbox(a.get("lat"), a.get("lng") or a.get("lon"), bbox)]
    alert_count = db_alert_count or len(mem_alerts)

    forge_specific_db  = [a for a in db_alerts  if a.source in ("ais", "adsb", "sentinel")]
    forge_specific_mem = [a for a in mem_alerts  if any(a.get("type", "").startswith(p)
                                                        for p in ("AIS_", "ADSB_", "SENTINEL_"))]
    forge_alert_count  = len(forge_specific_db) or len(forge_specific_mem)

    # ── 2. Active FusionEvents (from DB) ──────────────────────────────────────
    fusion_count = 0
    try:
        fes = (db.query(FusionEvent)
               .filter(FusionEvent.status == "active",
                       FusionEvent.expires_at > now,
                       FusionEvent.lat.isnot(None))
               .all())
        fusion_count = sum(1 for fe in fes
                           if _in_bbox(fe.lat, fe.lon, bbox))
    except Exception:
        # Fallback to passed-in list
        fusions_all  = fusion_events or []
        fusion_count = sum(1 for fe in fusions_all
                           if _in_bbox(fe.get("lat"), fe.get("lon"), bbox))

    # ── 3. Sentinel detections (last 24h) ────────────────────────────────────
    sentinel_weighted = 0
    sentinel_count    = 0
    try:
        dets = (db.query(SentinelDetection)
                .filter(SentinelDetection.created_at >= cutoff)
                .all())
        for d in dets:
            if _in_bbox(d.centroid_lat, d.centroid_lon, bbox):
                sentinel_count    += 1
                sentinel_weighted += SEV_WEIGHTS.get(d.severity or "info", 1)
    except Exception:
        pass

    # ── 4. News events (from event store, passed in) ──────────────────────────
    evts = news_events or []
    news_count = sum(
        1 for ev in evts
        if _in_bbox(ev.get("lat"), ev.get("lng") or ev.get("lon"), bbox)
    )

    # ── 5. OntologyLink bonus — events linked to entities in this region ──────
    link_bonus = 0
    try:
        region_ids = region.get("region_ids", [])
        if region_ids:
            link_count = (db.query(OntologyLink)
                          .filter(OntologyLink.created_at >= cutoff,
                                  OntologyLink.entity_type.in_(
                                      ["cable", "port", "airport", "watch_zone", "strategic_zone"]))
                          .count())
            # Crude region filter: total link activity, capped contribution
            link_bonus = min(link_count, 10)
    except Exception:
        pass

    # ── 6. Surge bonus (DB-first, fallback to in-memory) ─────────────────────
    surge_bonus = 0
    try:
        from database import SurgeEvent
        region_countries_lower = {c.lower() for c in region.get("countries", [])}
        region_codes_upper     = {c.upper() for c in region.get("country_codes", [])}
        surges = (db.query(SurgeEvent)
                  .filter(SurgeEvent.status == "active",
                          SurgeEvent.expires_at > now)
                  .all())
        for s in surges:
            in_region = False
            if s.lat and s.lon:
                in_region = _in_bbox(s.lat, s.lon, bbox)
            if not in_region and s.location_country:
                lc = s.location_country.lower()
                in_region = lc in region_countries_lower
            if not in_region and s.location_country and region_codes_upper:
                in_region = s.location_country.upper() in region_codes_upper
            if in_region:
                sev_pts = {"critical": 20, "high": 12, "medium": 6, "low": 3}
                surge_bonus += sev_pts.get(s.severity or "medium", 6)
        surge_bonus = min(surge_bonus, 30)
    except Exception:
        # Fallback to in-memory surge scores
        try:
            from surge_engine import _surge_scores
            region_countries_lower = {c.lower() for c in region.get("countries", [])}
            region_ids_set = set(region.get("region_ids", []))
            for (country, surge_region_id), data in list(_surge_scores.items()):
                if data["expires_at"] < now:
                    continue
                if surge_region_id and surge_region_id in region_ids_set:
                    surge_bonus += data["score_bonus"]
                elif country and country.lower() in region_countries_lower:
                    surge_bonus += data["score_bonus"]
            surge_bonus = min(surge_bonus, 25)
        except ImportError:
            pass

    # ── 7. Composite score ────────────────────────────────────────────────────
    base           = min(weighted_alert_score * 2, 40)
    forge_bonus    = min(forge_alert_count * 5,    25)
    sentinel_bonus = min(sentinel_weighted,         20)
    news_bonus     = min(news_count * 2,            15)
    fusion_bonus   = min(fusion_count * 15,         30)
    score = min(base + forge_bonus + sentinel_bonus + news_bonus
                + fusion_bonus + surge_bonus + link_bonus, 100.0)

    # ── 8. Trend vs last cached score + 24h delta ─────────────────────────────
    prev_score = _threat_cache_history.get(region_name, {}).get("score", score)
    trend = ("escalating"    if score > prev_score + 5 else
             "de-escalating" if score < prev_score - 5 else
             "stable")
    _threat_cache_history.setdefault(region_name, {})["score"] = score

    trend_delta = _get_trend_delta(region_name, score, db)
    is_emerging   = trend == "escalating" and trend_delta >= 15 and score >= 35
    is_escalating = trend == "escalating" and trend_delta >= 25 and score >= 55

    # Centroid from bbox midpoint
    lat = round((bbox["min_lat"] + bbox["max_lat"]) / 2, 2)
    lon = round((bbox["min_lon"] + bbox["max_lon"]) / 2, 2)

    drivers_dict = {
        "alert_count":          alert_count,
        "weighted_alert_score": round(weighted_alert_score, 1),
        "forge_alert_count":    forge_alert_count,
        "fusion_events":        fusion_count,
        "surge_bonus":          surge_bonus,
        "sentinel_score":       round(sentinel_weighted, 1),
        "link_bonus":           link_bonus,
    }

    signal_count_24h = alert_count + forge_alert_count + sentinel_count + news_count + fusion_count
    narrative = _build_narrative(region_name, score, trend, drivers_dict)

    signals = []
    if alert_count       > 0: signals.append("forge_alerts")
    if forge_alert_count > 0: signals.append("rule_triggers")
    if sentinel_count    > 0: signals.append("satellite_detections")
    if news_count        > 0: signals.append("news_events")
    if fusion_count      > 0: signals.append("fusion_events")
    if surge_bonus       > 0: signals.append("surge_events")
    if link_bonus        > 0: signals.append("ontology_links")

    return {
        "region_name":               region_name,
        "region":                    region_name,
        "region_id":                 (region["region_ids"] or [""])[0],
        "threat_score":              round(score, 1),
        "score":                     round(score, 1),
        "threat_level":              _threat_level(score),
        "trend":                     trend,
        "trend_delta":               trend_delta,
        "is_emerging":               is_emerging,
        "is_escalating":             is_escalating,
        "lat":                       lat,
        "lon":                       lon,
        "narrative":                 narrative,
        "signal_count_24h":          signal_count_24h,
        "alert_count":               alert_count,
        "forge_alert_count":         forge_alert_count,
        "sentinel_detection_count":  sentinel_count,
        "news_event_count":          news_count,
        "fusion_count":              fusion_count,
        "surge_bonus":               surge_bonus,
        "link_bonus":                link_bonus,
        "drivers":                   drivers_dict,
        "score_drivers": [
            {"name": "forge_alerts",          "value": alert_count,                  "contribution": round(min(weighted_alert_score * 2, 40), 1)},
            {"name": "rule_triggers",         "value": forge_alert_count,            "contribution": round(min(forge_alert_count * 5, 25), 1)},
            {"name": "satellite_detections",  "value": sentinel_count,               "contribution": round(min(sentinel_weighted, 20), 1)},
            {"name": "news_events",           "value": news_count,                   "contribution": round(min(news_count * 2, 15), 1)},
            {"name": "fusion_events",         "value": fusion_count,                 "contribution": round(min(fusion_count * 15, 30), 1)},
            {"name": "surge_events",          "value": round(surge_bonus, 1),        "contribution": round(surge_bonus, 1)},
            {"name": "ontology_links",        "value": link_bonus,                   "contribution": round(link_bonus, 1)},
        ],
        "active_signals":            len(signals),
        "contributing_signals":      signals,
    }


def save_hourly_snapshot(db, forge_alerts: list = None,
                          news_events: list = None) -> int:
    """Write one ThreatSnapshotHourly row per region. Purges rows older than 30 days."""
    from database import ThreatSnapshotHourly
    now    = datetime.datetime.utcnow()
    purge  = now - datetime.timedelta(days=30)
    saved  = 0
    try:
        db.query(ThreatSnapshotHourly).filter(
            ThreatSnapshotHourly.snapshot_at < purge
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        pass
    for region_name in REGIONS:
        result = compute_threat_score(region_name, db, forge_alerts, news_events)
        db.add(ThreatSnapshotHourly(
            region_name  = region_name,
            region_id    = result["region_id"],
            score        = result["threat_score"],
            threat_level = result["threat_level"],
            snapshot_at  = now,
        ))
        saved += 1
    try:
        db.commit()
    except Exception:
        pass
    return saved


def save_daily_snapshot(db, forge_alerts: list = None,
                         news_events: list = None) -> int:
    """Upsert one ThreatMatrixSnapshot row per region for today's date."""
    from database import ThreatMatrixSnapshot
    today = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    upserted = 0
    for region_name in REGIONS:
        result = compute_threat_score(region_name, db, forge_alerts, news_events)
        existing = (db.query(ThreatMatrixSnapshot)
                    .filter(ThreatMatrixSnapshot.snapshot_date == today,
                            ThreatMatrixSnapshot.region_name == region_name)
                    .first())
        if existing:
            existing.threat_score             = result["threat_score"]
            existing.threat_level             = result["threat_level"]
            existing.alert_count              = result["alert_count"]
            existing.forge_alert_count        = result["forge_alert_count"]
            existing.sentinel_detection_count = result["sentinel_detection_count"]
            existing.news_event_count         = result["news_event_count"]
            existing.contributing_signals     = json.dumps(result["contributing_signals"])
        else:
            db.add(ThreatMatrixSnapshot(
                snapshot_date             = today,
                region_name               = region_name,
                region_id                 = result["region_id"],
                alert_count               = result["alert_count"],
                forge_alert_count         = result["forge_alert_count"],
                sentinel_detection_count  = result["sentinel_detection_count"],
                news_event_count          = result["news_event_count"],
                threat_score              = result["threat_score"],
                threat_level              = result["threat_level"],
                contributing_signals      = json.dumps(result["contributing_signals"]),
            ))
        upserted += 1
    db.commit()
    return upserted


# ── In-memory cache (refreshed hourly) ────────────────────────────────────────
_THREAT_CACHE: list = []
_THREAT_CACHE_TS: float = 0.0


def get_cached_scores() -> list:
    return list(_THREAT_CACHE)


def refresh_cache(db, forge_alerts: list = None, news_events: list = None,
                   fusion_events: list = None):
    global _THREAT_CACHE, _THREAT_CACHE_TS
    import time
    scores = []
    for region_name in REGIONS:
        scores.append(compute_threat_score(region_name, db, forge_alerts, news_events, fusion_events))
    scores.sort(key=lambda x: x["threat_score"], reverse=True)
    _THREAT_CACHE    = scores
    _THREAT_CACHE_TS = time.time()
    return scores


def refresh_dirty_regions(dirty: set, db, forge_alerts: list = None,
                           news_events: list = None, fusion_events: list = None):
    """Recompute threat scores only for regions in the dirty set. Updates _THREAT_CACHE in place."""
    global _THREAT_CACHE
    if not dirty:
        return
    updated = {s["region"]: s for s in _THREAT_CACHE}
    for region_name in REGIONS:
        if region_name in dirty:
            updated[region_name] = compute_threat_score(region_name, db, forge_alerts, news_events, fusion_events)
    scores = list(updated.values())
    scores.sort(key=lambda x: x["threat_score"], reverse=True)
    _THREAT_CACHE = scores
