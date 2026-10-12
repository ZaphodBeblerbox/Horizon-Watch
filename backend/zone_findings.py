"""
zone_findings.py — every automatic finding of a watch zone, with its box.

The database side of finding_boxes.py. Three kinds, read from what is
already stored, so findings from before boxes were kept get one too
(derived on read — nothing is rewritten):

  sweep_find    the border sweep's clusters (zone_metadata.findings); the
                extent from the finding itself, else rebuilt from the
                sweep scan's stored regions, else a square of its area
  radar_change  the NEW significant regions of each radar comparison that
                reported a change (zone_change.py's own rule), each with
                its real pixel extent
  object        objects the detector outlined that are new since the pass
                before

GET /api/watch-zones/{id}/findings and the crop endpoint
(routers/zone_findings.py) serve these; the alerts carry the same shape.
"""
from __future__ import annotations

import datetime as _dt
import json

import finding_boxes as fb

MAX_FINDINGS = 60
RADAR_SCANS = 3          # the last few comparisons that reported a change


def _j(v, default):
    if not v:
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def zone_bounds(zone) -> tuple | None:
    return fb.as_bounds([zone.bbox_min_lon, zone.bbox_min_lat, zone.bbox_max_lon, zone.bbox_max_lat]) \
        if zone.bbox_min_lon is not None else None


def _det_dict(d) -> dict:
    a = _j(d.attributes, {})
    return {"detection_id": d.detection_id, "scan_id": d.scan_id, "instrument": d.instrument,
            "object_type": d.object_type, "confidence": d.confidence,
            "centroid_lat": d.centroid_lat, "centroid_lon": d.centroid_lon, "area_m2": d.area_m2,
            "geo_geometry": _j(d.geo_geometry, None), "attributes": a if isinstance(a, dict) else {},
            "created_at": d.created_at}


def _region(det: dict) -> dict:
    """A stored change detection in the shape pwtt produced it."""
    a = det["attributes"]
    return {"detection_id": det["detection_id"], "centroid_lat": det["centroid_lat"], "centroid_lon": det["centroid_lon"],
            "area_m2": det["area_m2"], "t_peak": a.get("t_peak"), "change_direction": a.get("change_direction"),
            "pixels": a.get("pixels"), "bbox": a.get("bbox"), "geo_box": a.get("geo_box")}


def sweep_findings(db, zone, scan_id: str | None = None) -> list[dict]:
    from database import SentinelDetection, SentinelScan
    import overwatch
    meta = _j(zone.zone_metadata, {})
    raw = meta.get("findings") or ([meta["finding"]] if isinstance(meta.get("finding"), dict) else [])
    if not raw:
        return []
    sweep_scan = meta.get("sweep_scan_id")
    if scan_id and scan_id != sweep_scan:
        return []
    bounds = zone_bounds(zone)
    regions, m_per_px = [], 10.0
    if sweep_scan and any(not fb.as_bounds(f.get("box")) for f in raw):
        sc = db.query(SentinelScan.result_summary).filter(SentinelScan.scan_id == sweep_scan).first()
        summ = _j(sc[0] if sc else None, {})
        m_per_px = float(summ.get("m_per_px") or 10.0)
        bounds = fb.as_bounds(summ.get("bounds")) or bounds
        regions = [_region(_det_dict(d)) for d in
                   db.query(SentinelDetection).filter(SentinelDetection.scan_id == sweep_scan).all()]
    out = []
    for i, f in enumerate(raw):
        rbox = None
        if not fb.as_bounds(f.get("box")) and regions:
            members = overwatch.sweep_finding_regions(f, regions, m_per_px)
            rbox, src = fb.cluster_extent(members, bounds)
            if src != "pixel_extent":
                rbox = None
        x = fb.sweep_finding(f, i, zone_id=zone.system_id, scan_id=sweep_scan, date=meta.get("found_at"), regions_box=rbox)
        if x:
            out.append(x)
    return out


def radar_findings(db, zone, scan_id: str | None = None, since: _dt.datetime | None = None) -> list[dict]:
    """The new significant regions of the zone's recent radar comparisons
    that reported a change — the same rule the notification used."""
    from database import SentinelDetection, SentinelScan
    import zone_change as zc
    meta = _j(zone.zone_metadata, {})
    sweep_scan = meta.get("sweep_scan_id")
    q = (db.query(SentinelScan.scan_id, SentinelScan.result_summary, SentinelScan.created_at,
                  SentinelScan.image_timestamp_utc)
         .filter(SentinelScan.zone_id == zone.id, SentinelScan.triggered_by == "change-detect",
                 SentinelScan.status == "completed")
         .order_by(SentinelScan.created_at))
    scans = q.all()
    out = []
    prev_sig = None
    changed_seen = []
    for sid, summ, created, when in scans:
        s = _j(summ, {})
        dets = [_region(_det_dict(d)) for d in
                db.query(SentinelDetection).filter(SentinelDetection.scan_id == sid).all()]
        sig = zc.significant(dets, s.get("m_per_px"))
        verdict = (s.get("change") or {}).get("verdict")
        fresh = zc.new_regions(sig, prev_sig) if verdict == "changed" else []
        prev_sig = sig
        if sid == sweep_scan:
            continue                     # those regions are the sweep's finding, drawn as one box
        if scan_id and sid != scan_id:
            continue
        if not scan_id and since and created and created < since:
            continue
        if fresh:
            changed_seen.append((sid, s, created, when, fresh))
    for sid, s, created, when, fresh in changed_seen[-RADAR_SCANS:][::-1]:
        bounds = fb.as_bounds(s.get("bounds")) or zone_bounds(zone)
        date = (s.get("change") or {}).get("until") or when or created
        for r in sorted(fresh, key=lambda r: -(r.get("area_m2") or 0)):
            f = fb.radar_change_finding(r, bounds, scan_id=sid, zone_id=zone.system_id, date=date)
            if f:
                out.append(f)
    return out


def object_findings(db, zone, scan_id: str | None = None, since: _dt.datetime | None = None,
                    limit: int = 30) -> list[dict]:
    """Objects the detector outlined that are new since the pass before."""
    from database import SentinelDetection
    q = (db.query(SentinelDetection)
         .filter(SentinelDetection.zone_id == zone.id, SentinelDetection.object_type != "structural_change",
                 SentinelDetection.attributes.like('%"change_type": "new"%')))
    if scan_id:
        q = q.filter(SentinelDetection.scan_id == scan_id)
    elif since:
        q = q.filter(SentinelDetection.created_at >= since)
    out = []
    for d in q.order_by(SentinelDetection.created_at.desc()).limit(limit).all():
        f = fb.object_finding(_det_dict(d), zone_id=zone.system_id, date=d.created_at)
        if f:
            out.append(f)
    return out


def zone_findings(db, zone, *, scan_id: str | None = None, days: int = 30) -> dict:
    since = _dt.datetime.utcnow() - _dt.timedelta(days=max(1, int(days)))
    found = (sweep_findings(db, zone, scan_id)
             + radar_findings(db, zone, scan_id, since)
             + object_findings(db, zone, scan_id, since))[:MAX_FINDINGS]
    # Whether the radar images of the comparison behind each radar finding
    # are held (radar_images.py) — derived from the files, never stored.
    import radar_images as ri
    held: dict = {}
    for f in found:
        if f["kind"] in ("sweep_find", "radar_change") and f.get("scan_id"):
            if f["scan_id"] not in held:
                held[f["scan_id"]] = ri.has(f["scan_id"])
            f["radar_images"] = held[f["scan_id"]]
    meta = _j(zone.zone_metadata, {})
    b = zone_bounds(zone)
    return {
        "zone": {"system_id": zone.system_id, "name": zone.name,
                 "bbox": {"min_lon": b[0], "min_lat": b[1], "max_lon": b[2], "max_lat": b[3]} if b else None,
                 "sensor_preference": getattr(zone, "sensor_preference", None), "aoi_class": zone.aoi_class,
                 "caveat": meta.get("caveat")},
        "findings": found,
        "counts": {k: sum(1 for f in found if f["kind"] == k) for k in ("sweep_find", "radar_change", "object")},
    }


def radar_source(db, zone, scan_id: str) -> dict | None:
    """How the radar comparison `scan_id` of this zone was made (its box,
    dates, pixel size) — what regenerating its images needs — or None when
    the scan is not this zone's change scan or did not record its dates."""
    from database import SentinelScan
    import radar_images as ri
    row = (db.query(SentinelScan.result_summary, SentinelScan.triggered_by)
           .filter(SentinelScan.scan_id == scan_id, SentinelScan.zone_id == zone.id).first())
    if row is None or row[1] != "change-detect":
        return None
    return ri.source_of(_j(row[0], {}), zone_bounds(zone))


def crop_for(db, zone, box, *, prefer: str | None = None, max_px: int = 480) -> dict | None:
    """A cut-out of the zone's newest stored image around a finding's box.

    Every scene of a zone is fetched over the zone's own bbox, so the box
    is put on the image with the zone's bounds. Optical first (it shows
    what a thing is), radar when no optical image is held. Returns
    {image_b64 (JPEG), box: [x, y, w, h] in the crop, date, instrument,
    scan_id} or None when no image is held."""
    import base64
    import io
    from PIL import Image
    from database import SentinelScan
    bounds = zone_bounds(zone)
    if bounds is None or fb.as_bounds(box) is None:
        return None
    order = ["OPTICAL", "SAR"] if prefer != "SAR" else ["SAR", "OPTICAL"]
    for inst in order:
        row = (db.query(SentinelScan.scan_id, SentinelScan.image_b64, SentinelScan.image_timestamp_utc,
                        SentinelScan.instrument)
               .filter(SentinelScan.zone_id == zone.id, SentinelScan.status == "completed",
                       SentinelScan.image_b64.isnot(None),
                       (SentinelScan.instrument == inst) if inst == "SAR"
                       else ((SentinelScan.instrument == "OPTICAL") | SentinelScan.instrument.is_(None)))
               .order_by(SentinelScan.image_timestamp_utc.desc()).first())
        if not row:
            continue
        try:
            img = Image.open(io.BytesIO(base64.b64decode(row[1]))).convert("RGB")
        except Exception:                                        # noqa: BLE001
            continue
        win = fb.crop_window(box, bounds, img.width, img.height)
        if win is None:
            continue
        crop = img.crop((win["x0"], win["y0"], win["x1"], win["y1"]))
        # Small cut-outs are enlarged with nearest-neighbour: a 10 m pixel
        # should look like a pixel, not a smear.
        scale = max(1.0, 240 / max(crop.width, crop.height))
        scale = min(scale, max_px / max(crop.width, crop.height)) if max(crop.width, crop.height) * scale > max_px else scale
        if scale != 1.0:
            crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.NEAREST)
        buf = io.BytesIO()
        crop.save(buf, format="JPEG", quality=88)
        return {"image_b64": base64.b64encode(buf.getvalue()).decode("ascii"), "box": win["box"],
                "date": row[2].isoformat() if row[2] else None, "instrument": row[3] or "OPTICAL",
                "scan_id": row[0], "width": crop.width, "height": crop.height}
    return None
