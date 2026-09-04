"""
asset_exposure.py — real proximity matching between a report's evidence set
and the real Asset register (backend/database.py's Asset model).

Ground rule: the Asset table is populated only for a pilot AOI today (it may
be genuinely empty in a given deployment) — this module never invents a
match. An empty or missing table produces a real, honest empty result, not a
fabricated one.
"""
from __future__ import annotations
import math

MATCH_RADIUS_KM = 25.0

# Which frozen-snapshot sections carry a real, matchable lat/lon per item,
# and which field names hold them and a human-readable label.
_GEO_SECTIONS = {
    "ais_anomalies":       ("lat", "lon", "signal_id", "location_name"),
    "adsb_anomalies":      ("lat", "lon", "signal_id", "location_name"),
    "sentinel_detections": ("lat", "lon", "detection_id", "object_type"),
    "fusion_events":       ("lat", "lon", "fusion_id", "title"),
    "surge_events":        ("lat", "lon", "surge_id", "headline"),
}


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def compute_exposure(snapshot_content: dict, db) -> dict:
    """Real haversine proximity matches between the snapshot's real geolocated
    evidence items and the real Asset register. Returns
    {"matches": [...], "asset_count": int, "checked_items": int} — an empty
    `matches` list with a real non-zero `asset_count`/`checked_items` is a
    genuine "checked, found nothing within range" result, distinct from an
    empty register (`asset_count == 0`)."""
    from database import Asset

    assets = db.query(Asset).filter(Asset.lat.isnot(None), Asset.lng.isnot(None)).all()
    matches = []
    checked = 0
    if assets:
        for section, (lat_f, lon_f, id_f, label_f) in _GEO_SECTIONS.items():
            for item in snapshot_content.get(section) or []:
                lat, lon = item.get(lat_f), item.get(lon_f)
                if lat is None or lon is None:
                    continue
                checked += 1
                for asset in assets:
                    dist = _haversine_km(lat, lon, asset.lat, asset.lng)
                    if dist <= MATCH_RADIUS_KM:
                        matches.append({
                            "asset_id": asset.asset_id, "asset_name": asset.name,
                            "asset_type": asset.asset_type, "category": asset.category,
                            "distance_km": round(dist, 1),
                            "matched_section": section, "matched_item_id": str(item.get(id_f)),
                            "matched_label": item.get(label_f),
                        })
    matches.sort(key=lambda m: m["distance_km"])
    return {"matches": matches, "asset_count": len(assets), "checked_items": checked}
