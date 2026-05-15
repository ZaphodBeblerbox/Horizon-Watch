"""
threat_matrix.py — Regional threat scoring engine.

compute_threat_score(region_name, db) → dict
save_daily_snapshot(db)
refresh_cache()   — called hourly from the scheduler
"""

import json
import datetime

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
    Queries SentinelDetection from the last 24h.
    forge_alerts / news_events passed in (no DB query needed for live data).
    """
    from database import SentinelDetection
    region = REGIONS.get(region_name)
    if not region:
        return {"region_name": region_name, "threat_score": 0.0, "threat_level": "LOW",
                "alert_count": 0, "forge_alert_count": 0,
                "sentinel_detection_count": 0, "news_event_count": 0,
                "contributing_signals": []}

    bbox = region["bbox"]
    now  = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(hours=24)

    # ── Forge alerts ──────────────────────────────────────────────────────────
    alerts_all = forge_alerts or []
    region_alerts  = [a for a in alerts_all
                      if _in_bbox(a.get("lat"), a.get("lng") or a.get("lon"), bbox)]
    forge_specific = [a for a in region_alerts
                      if any(a.get("type", "").startswith(p)
                             for p in ("AIS_", "ADSB_", "SENTINEL_"))]

    alert_count       = len(region_alerts)
    forge_alert_count = len(forge_specific)

    # ── Sentinel detections (last 24h by image time, fallback created_at) ────
    SEV_WEIGHTS = {"info": 1, "medium": 2, "high": 5, "critical": 10}
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

    # ── News events ───────────────────────────────────────────────────────────
    evts = news_events or []
    news_count = sum(
        1 for ev in evts
        if _in_bbox(ev.get("lat"), ev.get("lng") or ev.get("lon"), bbox)
    )

    # ── Active fusion events in region ───────────────────────────────────────
    fusions_all  = fusion_events or []
    fusion_count = sum(
        1 for fe in fusions_all
        if _in_bbox(fe.get("lat"), fe.get("lon"), bbox)
    )

    # ── Surge bonus from surge_engine score cache ─────────────────────────
    surge_bonus = 0
    try:
        from surge_engine import _surge_scores
        region_countries_lower = {c.lower() for c in region.get("countries", [])}
        region_ids_set = set(region.get("region_ids", []))
        now_utc = datetime.datetime.utcnow()
        for (country, surge_region_id), data in list(_surge_scores.items()):
            if data["expires_at"] < now_utc:
                continue
            if surge_region_id and surge_region_id in region_ids_set:
                surge_bonus += data["score_bonus"]
            elif country and country.lower() in region_countries_lower:
                surge_bonus += data["score_bonus"]
        surge_bonus = min(surge_bonus, 25)
    except ImportError:
        pass

    # ── Composite score ───────────────────────────────────────────────────────
    base             = min(alert_count       * 3,  40)
    forge_bonus      = min(forge_alert_count * 5,  25)
    sentinel_bonus   = min(sentinel_weighted,       20)
    news_bonus       = min(news_count        * 2,  15)
    fusion_bonus     = min(fusion_count      * 15, 30)
    score = min(base + forge_bonus + sentinel_bonus + news_bonus + fusion_bonus + surge_bonus, 100.0)

    signals = []
    if alert_count       > 0: signals.append("forge_alerts")
    if forge_alert_count > 0: signals.append("rule_triggers")
    if sentinel_count    > 0: signals.append("satellite_detections")
    if news_count        > 0: signals.append("news_events")
    if fusion_count      > 0: signals.append("fusion_events")
    if surge_bonus       > 0: signals.append("surge_events")

    return {
        "region_name":               region_name,
        "region_id":                 (region["region_ids"] or [""])[0],
        "threat_score":              round(score, 1),
        "threat_level":              _threat_level(score),
        "alert_count":               alert_count,
        "forge_alert_count":         forge_alert_count,
        "sentinel_detection_count":  sentinel_count,
        "news_event_count":          news_count,
        "fusion_count":              fusion_count,
        "surge_bonus":               surge_bonus,
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
