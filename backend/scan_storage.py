"""
scan_storage.py — what a completed scan leaves behind, and for how long.

TWO JOBS, both about the difference between an observation and a record.

1. CHANGE, PERSISTED. scan_changes.py can compare two scans, but nothing
   stored the answer, so recurring scans produced a fresh pile of "info"
   detections every cycle and no finding. Here the comparison is run against
   the region's own previous scan and the verdict is written onto each
   detection, which is what turns "27 vessels" into "3 that were not there
   yesterday".

2. IMAGES AGE OUT, DETECTIONS DO NOT. A scene is megabytes; a detection is a
   type, a confidence and a coordinate. Keeping every image forever buys
   nothing once a human has looked at it, so only the most recent few scenes
   per region are held as pixels. Everything else survives as numbers that
   still plot on a map and still serve as a baseline for the next
   comparison — "storage tank detected at 25.3090, 56.3680" is the durable
   part of a scan, not the JPEG.

   Pinning is explicit and permanent: a scan the analyst marked matters more
   than a retention rule, so a pinned image is never aged out.

WHAT THIS DELIBERATELY DOES NOT DO. It never deletes a detection. Detections
are the baseline change detection runs against, so discarding them would
silently destroy the ability to say anything changed — and would do it
quietly, months later, which is the worst possible time to find out.
"""
from __future__ import annotations

import json

import scan_changes as _changes

# How many scans per region keep their image. Two is the minimum that still
# allows a before/after comparison to be SHOWN rather than merely computed.
DEFAULT_KEEP_IMAGES = 2


def _attrs(det) -> dict:
    try:
        return json.loads(det.attributes) if det.attributes else {}
    except Exception:
        return {}


def previous_scan(db, zone_id, before_scan_id=None, instrument=None):
    """The region's last completed scan before this one.

    Restricted to the same instrument when one is given: an optical scene and
    a SAR scene of the same water do not see the same things, so diffing
    across sensors would report the difference between two instruments as a
    change on the ground.
    """
    from database import SentinelScan

    q = (db.query(SentinelScan)
           .filter(SentinelScan.zone_id == zone_id,
                   SentinelScan.status == "completed"))
    if before_scan_id:
        q = q.filter(SentinelScan.scan_id != before_scan_id)
    if instrument:
        q = q.filter(SentinelScan.instrument == instrument)
    return q.order_by(SentinelScan.created_at.desc()).first()


def detections_for(db, scan_id) -> list[dict]:
    from database import SentinelDetection

    rows = db.query(SentinelDetection).filter(SentinelDetection.scan_id == scan_id).all()
    return [{
        "detection_id": r.detection_id,
        "object_type": r.object_type,
        "confidence": r.confidence,
        "centroid_lat": r.centroid_lat,
        "centroid_lon": r.centroid_lon,
        "instrument": r.instrument,
    } for r in rows]


def apply_change_detection(db, zone_id, scan_id, *, instrument="OPTICAL",
                           m_per_px=10.0) -> dict:
    """Compare this scan against the region's previous one and record the verdict.

    Returns the change summary. Writes `change_type` into each detection's
    attributes, because the column does not exist and adding one to a live
    table is a migration this does not need: attributes is already the
    per-detection JSON bag every consumer reads.
    """
    from database import SentinelDetection

    prev = previous_scan(db, zone_id, before_scan_id=scan_id, instrument=instrument)
    current = detections_for(db, scan_id)
    baseline_exists = prev is not None
    previous = detections_for(db, prev.scan_id) if prev else []

    change = _changes.diff_detections(previous, current,
                                      m_per_px=m_per_px,
                                      baseline_exists=baseline_exists)

    # Write the verdict back onto the current scan's rows. "gone" detections
    # belong to the PREVIOUS scan and are not re-persisted here — they are
    # reported in the summary and remain readable on their own scan, so a
    # departure is never invented as a row on a scan that did not see it.
    by_id = {d.get("detection_id"): d for d in change["all"] if d.get("detection_id")}
    for row in db.query(SentinelDetection).filter(SentinelDetection.scan_id == scan_id).all():
        tagged = by_id.get(row.detection_id)
        if not tagged:
            continue
        a = _attrs(row)
        a["change_type"] = tagged.get("change_type")
        if tagged.get("previous_distance_m") is not None:
            a["previous_distance_m"] = tagged["previous_distance_m"]
        if tagged.get("unconfirmed_reason"):
            a["unconfirmed_reason"] = tagged["unconfirmed_reason"]
        row.attributes = json.dumps(a)

    return {
        "compared_to": prev.scan_id if prev else None,
        "compared_to_date": (prev.image_timestamp_utc.isoformat()
                             if prev and prev.image_timestamp_utc else None),
        "baseline": change["baseline"],
        "summary": change["summary"],
        "headline": change["headline"],
        "severity": _changes.severity_for(change),
        "match_radius_m": change["match_radius_m"],
    }


def prune_scan_images(db, zone_id, *, keep=DEFAULT_KEEP_IMAGES) -> dict:
    """Drop the stored image from all but the newest `keep` scans of a region.

    Detections are never touched. A scan whose image has aged out still
    carries every object it found, with coordinates, so it still plots on the
    minimap and still serves as the baseline for the next comparison.
    """
    from database import SentinelScan

    scans = (db.query(SentinelScan)
               .filter(SentinelScan.zone_id == zone_id,
                       SentinelScan.image_b64.isnot(None))
               .order_by(SentinelScan.created_at.desc())
               .all())

    freed = 0
    pruned = []
    for i, s in enumerate(scans):
        if i < keep:
            continue
        if is_pinned(s):
            # An explicit decision by a person outranks a retention rule.
            continue
        freed += len(s.image_b64 or "")
        s.image_b64 = None
        _mark_image_dropped(s)
        pruned.append(s.scan_id)

    return {"pruned": pruned, "kept": min(keep, len(scans)),
            "freed_bytes": freed, "freed_mb": round(freed / 1e6, 2)}


# ── pinning ───────────────────────────────────────────────────────────────
#
# Stored in the scan's existing result_summary JSON rather than as a new
# column: this is a flag on a handful of rows, and a schema migration on a
# live 4.8GB database is a far larger risk than a JSON key.

def _summary(scan) -> dict:
    try:
        return json.loads(scan.result_summary) if scan.result_summary else {}
    except Exception:
        return {}


def is_pinned(scan) -> bool:
    return bool(_summary(scan).get("image_pinned"))


def image_dropped(scan) -> bool:
    return bool(_summary(scan).get("image_dropped"))


def _mark_image_dropped(scan) -> None:
    s = _summary(scan)
    s["image_dropped"] = True
    scan.result_summary = json.dumps(s)


def set_pinned(db, scan_id, pinned=True) -> dict:
    """Keep this scan's image indefinitely, or release it.

    Unpinning does not delete anything; it only makes the scan eligible for
    the next prune. Destroying an image the moment someone changes their mind
    would make the toggle dangerous to touch.
    """
    from database import SentinelScan

    scan = db.query(SentinelScan).filter(SentinelScan.scan_id == scan_id).first()
    if scan is None:
        return {"error": "unknown scan id"}
    s = _summary(scan)
    s["image_pinned"] = bool(pinned)
    scan.result_summary = json.dumps(s)
    return {"scan_id": scan_id, "pinned": bool(pinned),
            "has_image": scan.image_b64 is not None,
            "note": (None if scan.image_b64 is not None
                     else "this scan's image has already been dropped; pinning "
                          "keeps future ones but cannot bring it back")}
