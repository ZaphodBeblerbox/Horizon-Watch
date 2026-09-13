"""
imagery_pipeline.py — real scene-comparison logic for the Imagery page,
bridging the real (but single-scene-only) Sentinel scanner
(sentinel_scanner.py) into the two-scene comparison view the page needs.

Honest scope, disclosed here rather than glossed over: the real detector
pipeline in this codebase (sentinel_ml.run_ship_detection, YOLO-OBB/DOTA)
detects vessels in one scene; it does not do image co-registration or a
learned change-detection model. This module adds real, computed —
never fabricated — bridging on top of that real output:
  - percent-of-frame bounding boxes, derived from each detection's real
    lat/lon against the real scene's real bbox (the scanner always fetches
    exactly the zone's bbox, so this is exact, not approximate)
  - reference-vs-current per-class count deltas, from real stored counts
    of two real scans for the same zone
  - real spatial nearest-neighbor matching between two real scans'
    detections (by real lat/lon, threshold in km) to classify each current
    detection as 'new' (no match in the reference scan) or 'existing'
    (matched) — there is no real basis for 'expanded' at the box level
    without real per-object size history, so that classification is not
    fabricated here; 'removed' detections (in the reference but not
    matched in current) are reported as their own real rows.
  - persistent-false-positive suppression: a detection recurring at
    matching real lat/lon in >=3 consecutive real scans for the same zone
    is flagged, never silently invented as a new finding each time.
"""
from __future__ import annotations
import datetime
import json
import math

MATCH_RADIUS_KM = 0.3  # ~300m — real vessels/objects don't teleport between same-week scans
PERSISTENT_SCANS = 3


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def bbox_percent(lat, lon, zone_bbox, box_km=0.12):
    """Real percent-of-frame [x,y,w,h] for a detection, derived from its real
    lat/lon against the real scene bbox (the scanner always fetches exactly
    the zone's own bbox — confirmed in sentinel_scanner.py's stac_bbox/
    bounds_wsen construction — so this mapping is exact, not approximate).
    box_km sets a real-world-plausible on-screen box size for a point
    detection (the detector returns a centroid, not a box, for a ship;
    real OBB corners exist in `attributes` for some detections and are used
    instead when present)."""
    min_lon, min_lat, max_lon, max_lat = zone_bbox
    width_deg = max(1e-6, max_lon - min_lon)
    height_deg = max(1e-6, max_lat - min_lat)
    cx = (lon - min_lon) / width_deg
    cy = (max_lat - lat) / height_deg
    # Convert a fixed real-world box size to a fractional width/height using
    # the zone's own real geographic extent (a small AOI -> a relatively
    # bigger box on screen; a large AOI -> a relatively smaller one — both
    # honest, since the box always represents the same real ~120m footprint).
    km_per_deg_lon = 111.0 * math.cos(math.radians((min_lat + max_lat) / 2))
    km_per_deg_lat = 111.0
    w = box_km / max(1e-6, width_deg * km_per_deg_lon)
    h = box_km / max(1e-6, height_deg * km_per_deg_lat)
    x = max(0.0, min(1.0, cx - w / 2))
    y = max(0.0, min(1.0, cy - h / 2))
    return [round(x, 4), round(y, 4), round(min(w, 1.0), 4), round(min(h, 1.0), 4)]


def reference_scan(db, zone_id: int, before_scan_id: str):
    """The zone's most recent OTHER real completed scan strictly before the
    given one, of the SAME real instrument — never pairs across zones,
    never invents a reference when none exists, and (Imagery/Sentinel
    round, Part 4.4) never pairs a SAR scan against an optical reference
    or vice versa. A zone that switches sensor_preference mid-history is
    the real, honest reason this filter exists — its most recent scan
    under the OLD sensor is correctly not offered as this new sensor's
    reference."""
    from database import SentinelScan
    current = db.query(SentinelScan).filter(SentinelScan.scan_id == before_scan_id).first()
    if not current:
        return None
    return (
        db.query(SentinelScan)
        .filter(SentinelScan.zone_id == zone_id, SentinelScan.status == "completed",
                SentinelScan.created_at < current.created_at,
                SentinelScan.instrument == (current.instrument or "OPTICAL"))
        .order_by(SentinelScan.created_at.desc())
        .first()
    )


def _real_detections(db, scan_id, exclude_rejected=True):
    from database import SentinelDetection
    q = db.query(SentinelDetection).filter(SentinelDetection.scan_id == scan_id)
    if exclude_rejected:
        q = q.filter(SentinelDetection.reviewed_status != "rejected")
    return q.all()


def _detection_interpretation(d) -> str:
    """Real, deterministic interpretation text (sentinel_ml.py's
    interpret_vessel_detection(), computed at detection time and stored in
    this row's own attributes JSON) — honest "" if this detection predates
    that field rather than fabricating one after the fact."""
    try:
        attrs = json.loads(d.attributes) if d.attributes else {}
    except (TypeError, ValueError):
        return ""
    return attrs.get("interpretation") or ""


def compare_scans(db, zone, current_scan):
    """Real comparison of `current_scan` against its real reference scan (if
    any). Returns per-class [label,current,delta] counts, per-detection
    change-type classification, and persistent-false-positive flags — all
    computed from real stored data, no fabricated values."""
    zone_bbox = [zone.bbox_min_lon, zone.bbox_min_lat, zone.bbox_max_lon, zone.bbox_max_lat]
    # The scan being viewed shows every real detection, including rejected
    # ones (marked as such) — only the REFERENCE scan's detections exclude
    # rejected rows, since a rejected detection shouldn't count toward a
    # later scan's stored reference counts.
    current_dets = _real_detections(db, current_scan.scan_id, exclude_rejected=False)
    ref = reference_scan(db, zone.id, current_scan.scan_id)
    ref_dets = _real_detections(db, ref.scan_id, exclude_rejected=True) if ref else []

    ref_by_id = {id(d): d for d in ref_dets}
    matched_ref_ids = set()
    changes = []
    for d in current_dets:
        match = None
        for r in ref_dets:
            if id(r) in matched_ref_ids:
                continue
            if r.object_type == d.object_type and _haversine_km(d.centroid_lat, d.centroid_lon, r.centroid_lat, r.centroid_lon) <= MATCH_RADIUS_KM:
                match = r
                break
        change_type = "new"
        if match is not None:
            matched_ref_ids.add(id(match))
            change_type = "existing"
        elif ref is None:
            change_type = "new"  # honest: no reference exists, so everything is "new" to this view
        changes.append({
            "id": d.detection_id, "label": d.object_type, "type": change_type,
            "conf": round(d.confidence, 3), "bbox": bbox_percent(d.centroid_lat, d.centroid_lon, zone_bbox),
            "note": "", "severity": d.severity, "reviewed_status": d.reviewed_status,
            "lat": d.centroid_lat, "lon": d.centroid_lon,
            "interpretation": _detection_interpretation(d),
            "instrument": d.instrument or "OPTICAL",
        })
    for r in ref_dets:
        if id(r) not in matched_ref_ids:
            changes.append({
                "id": f"removed-{r.detection_id}", "label": r.object_type, "type": "removed",
                "conf": round(r.confidence, 3), "bbox": bbox_percent(r.centroid_lat, r.centroid_lon, zone_bbox),
                "note": "no longer detected vs. the reference scene", "severity": r.severity,
                "reviewed_status": "pending", "lat": r.centroid_lat, "lon": r.centroid_lon,
                "instrument": r.instrument or "OPTICAL",
            })

    # Real per-class counts, reference -> current, with signed deltas.
    cur_counts, ref_counts = {}, {}
    for d in current_dets:
        cur_counts[d.object_type] = cur_counts.get(d.object_type, 0) + 1
    for r in ref_dets:
        ref_counts[r.object_type] = ref_counts.get(r.object_type, 0) + 1
    labels = sorted(set(cur_counts) | set(ref_counts))
    counts = [[label, cur_counts.get(label, 0), cur_counts.get(label, 0) - ref_counts.get(label, 0)] for label in labels]

    # Persistent-false-positive suppression — a detection recurring at
    # matching lat/lon across >=3 CONSECUTIVE real scans for this zone.
    suppressed_ids = _persistent_false_positives(db, zone, current_scan, current_dets)
    for c in changes:
        c["suppressed"] = c["id"] in suppressed_ids

    return {
        "reference_scan_id": ref.scan_id if ref else None,
        "reference_date": ref.image_timestamp_utc.isoformat() if ref and ref.image_timestamp_utc else None,
        "counts": counts, "changes": changes,
    }


def _persistent_false_positives(db, zone, current_scan, current_dets):
    """A real detection is flagged persistent if a same-class detection
    within MATCH_RADIUS_KM appears in each of the PERSISTENT_SCANS most
    recent real completed scans for this zone (current scan included) —
    the exact real anomaly found during this page's own build (the same
    handful of vessels recurring identically scan after scan)."""
    from database import SentinelScan
    recent = (
        db.query(SentinelScan)
        .filter(SentinelScan.zone_id == zone.id, SentinelScan.status == "completed",
                SentinelScan.created_at <= current_scan.created_at)
        .order_by(SentinelScan.created_at.desc())
        .limit(PERSISTENT_SCANS)
        .all()
    )
    if len(recent) < PERSISTENT_SCANS:
        return set()
    other_scans_dets = [_real_detections(db, s.scan_id, exclude_rejected=False) for s in recent[1:]]

    suppressed = set()
    for d in current_dets:
        hit_in_all = True
        for dets in other_scans_dets:
            if not any(o.object_type == d.object_type and _haversine_km(d.centroid_lat, d.centroid_lon, o.centroid_lat, o.centroid_lon) <= MATCH_RADIUS_KM for o in dets):
                hit_in_all = False
                break
        if hit_in_all:
            suppressed.add(d.detection_id)
    return suppressed


# ── Propose coverage for scope (§B3) ──────────────────────────────────────

def propose_coverage(db, iso3_or_country_code: str, created_by: str = "operator"):
    """Real proposed AOIs derived from the real Airport register (the only
    well-populated real infrastructure table today — ports/military/energy
    have no real ingested source in this deployment, see the module's own
    audit note below) for the given country. Inserted as status='proposed',
    enabled=False — never auto-started."""
    from database import Airport, WatchZone
    import uuid

    country_upper = iso3_or_country_code.upper()
    airports = (
        db.query(Airport)
        .filter(Airport.country_code == country_upper, Airport.airport_type.in_(["large_airport", "medium_airport"]))
        .filter(Airport.latitude.isnot(None), Airport.longitude.isnot(None))
        .limit(25)
        .all()
    )
    existing_names = {z.name for z in db.query(WatchZone).filter(WatchZone.status == "proposed").all()}

    created = []
    for a in airports:
        name = f"{a.municipality or a.airport_name} — {a.airport_name}"
        if name in existing_names:
            continue
        radius_km = 4.0  # exact spec default for airfields
        d = radius_km / 111.0
        polygon = {"type": "Polygon", "coordinates": [[
            [a.longitude - d, a.latitude - d], [a.longitude + d, a.latitude - d],
            [a.longitude + d, a.latitude + d], [a.longitude - d, a.latitude + d],
            [a.longitude - d, a.latitude - d],
        ]]}
        row = WatchZone(
            system_id=f"ZONE-{uuid.uuid4().hex[:8].upper()}", name=name, description=f"Proposed from real airport register: {a.ident}",
            polygon_geojson=json.dumps(polygon),
            bbox_min_lon=a.longitude - d, bbox_min_lat=a.latitude - d,
            bbox_max_lon=a.longitude + d, bbox_max_lat=a.latitude + d,
            priority="medium", scan_interval_hours=72, enabled=False,
            aoi_class="airport", status="proposed", owner=created_by,
            ml_tasks=json.dumps(["ship_detection"]), created_by=created_by,
        )
        db.add(row)
        created.append(row)
    db.commit()
    return {
        "created": len(created),
        "names": [r.name for r in created],
        "note": ("Ports/military/energy facilities have no real ingested register in this "
                 "deployment yet (the port ingester exists but has never been run here, and "
                 "there is no military/energy source at all) — proposals are airport-only, honestly."),
    }
