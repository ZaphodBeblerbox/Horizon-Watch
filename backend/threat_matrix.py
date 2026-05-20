"""
threat_matrix.py — Regional threat scoring engine.

compute_threat_score(region_name, db) → dict
save_daily_snapshot(db)
refresh_cache()   — called hourly from the scheduler
"""

import json
import datetime

_threat_cache_history: dict = {}   # region_name → {"score": float}

# ── Region definitions ────────────────────────────────────────────────────────
# bbox keys: min_lat, max_lat, min_lon, max_lon

REGIONS: dict = {
    "Baltic": {
        "region_ids": ["REG-NORSEA"],
        "bbox": {"min_lat": 53.0, "max_lat": 66.0, "min_lon": 10.0, "max_lon": 30.0},
        "countries": ["Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Germany", "Sweden", "Denmark", "Russia", "Belarus"],
    },
    "East Mediterranean": {
        "region_ids": ["REG-MED"],
        "bbox": {"min_lat": 30.0, "max_lat": 37.0, "min_lon": 25.0, "max_lon": 37.0},
        "countries": ["Greece", "Turkey", "Cyprus", "Lebanon", "Israel", "Syria", "Egypt", "Libya", "Palestine"],
    },
    "Black Sea / Ukraine": {
        "region_ids": [],
        "bbox": {"min_lat": 40.0, "max_lat": 50.0, "min_lon": 27.0, "max_lon": 42.0},
        "countries": ["Ukraine", "Romania", "Bulgaria", "Georgia", "Turkey", "Russia", "Moldova"],
    },
    "Persian Gulf": {
        "region_ids": ["REG-REDSEA"],
        "bbox": {"min_lat": 23.0, "max_lat": 30.0, "min_lon": 48.0, "max_lon": 60.0},
        "countries": ["Iran", "Iraq", "Kuwait", "Saudi Arabia", "Qatar", "United Arab Emirates", "Oman", "Bahrain"],
    },
    "Red Sea / Bab el-Mandeb": {
        "region_ids": ["REG-REDSEA"],
        "bbox": {"min_lat": 12.0, "max_lat": 22.0, "min_lon": 32.0, "max_lon": 45.0},
        "countries": ["Yemen", "Djibouti", "Eritrea", "Somalia", "Ethiopia", "Saudi Arabia", "Egypt", "Sudan"],
    },
    "Sahel": {
        "region_ids": [],
        "bbox": {"min_lat": 10.0, "max_lat": 20.0, "min_lon": -15.0, "max_lon": 15.0},
        "countries": ["Mali", "Niger", "Burkina Faso", "Nigeria", "Chad", "Mauritania", "Senegal", "Guinea", "Gambia"],
    },
    "Horn of Africa": {
        "region_ids": [],
        "bbox": {"min_lat": -5.0, "max_lat": 15.0, "min_lon": 35.0, "max_lon": 55.0},
        "countries": ["Somalia", "Ethiopia", "Djibouti", "Eritrea", "Kenya", "South Sudan"],
    },
    "South China Sea": {
        "region_ids": ["REG-SEASIA"],
        "bbox": {"min_lat": 5.0, "max_lat": 25.0, "min_lon": 105.0, "max_lon": 125.0},
        "countries": ["China", "Vietnam", "Philippines", "Malaysia", "Brunei", "Taiwan", "Indonesia"],
    },
    "Taiwan Strait": {
        "region_ids": ["REG-SEASIA"],
        "bbox": {"min_lat": 22.0, "max_lat": 28.0, "min_lon": 116.0, "max_lon": 125.0},
        "countries": ["China", "Taiwan"],
    },
    "Indian Ocean": {
        "region_ids": ["REG-IND"],
        "bbox": {"min_lat": -10.0, "max_lat": 15.0, "min_lon": 55.0, "max_lon": 80.0},
        "countries": ["India", "Sri Lanka", "Maldives", "Pakistan", "Iran", "Oman", "Mozambique", "Tanzania"],
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

    # ── 6. Surge bonus ────────────────────────────────────────────────────────
    surge_bonus = 0
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

    # ── 8. Trend vs last cached score ────────────────────────────────────────
    prev_score = _threat_cache_history.get(region_name, {}).get("score", score)
    trend = ("escalating"    if score > prev_score + 5 else
             "de-escalating" if score < prev_score - 5 else
             "stable")
    _threat_cache_history.setdefault(region_name, {})["score"] = score

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
        "threat_level":              _threat_level(score),
        "trend":                     trend,
        "alert_count":               alert_count,
        "forge_alert_count":         forge_alert_count,
        "sentinel_detection_count":  sentinel_count,
        "news_event_count":          news_count,
        "fusion_count":              fusion_count,
        "surge_bonus":               surge_bonus,
        "link_bonus":                link_bonus,
        "drivers": {
            "alert_count":           alert_count,
            "weighted_alert_score":  round(weighted_alert_score, 1),
            "forge_alert_count":     forge_alert_count,
            "fusion_events":         fusion_count,
            "surge_bonus":           surge_bonus,
            "sentinel_score":        round(sentinel_weighted, 1),
            "link_bonus":            link_bonus,
        },
        "contributing_signals":      signals,
    }


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
