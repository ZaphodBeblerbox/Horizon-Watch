"""
imagery_verdict.py — is a stored smoke, burn-scar or fire detection still
one under today's rules? Derived on every read, never written back.

Owner, 2026-10-17: "We're still recognising clouds as smoke. We're still
recognising random stuff as smoke." The classifier of 13 Oct judged only
NEW candidates; everything published before it stayed on the map: in this
database 14 smoke plumes and 19 fires, among them seven "plumes" and seven
"fires" over Rostock harbour on cloudy days (18% cloud, no FIRMS detection
on any of those days) and three white "plumes from its densest point" at
Jebel Ali. A rule that only reaches what is found next changes nothing on
screen (see the derive-on-read note: a stored answer hides later fixes).

So every read re-judges, from what each row kept:

  * a detection the classifier measured (its features are stored) is
    classified again with today's rules — a rule added later reaches it;
  * one stored before the classifier has no spectra to re-measure: it is
    kept only where something independent saw heat — a FIRMS detection
    within 2 km between the day before and the day after the pass (smoke
    drifts; VIIRS passes hours after Sentinel-2);
  * a fire is kept with FIRMS within 1 km, or when it is 4+ pixels and
    passed the hot-pixel test that checks blue (hot_pixel_test v2).

FIRMS is counted afresh on each read, so a VIIRS detection that arrives
hours after the pass keeps a plume it was too late to vouch for.
"""
from __future__ import annotations

import datetime as _dt
import json
import math

SMOKE_TYPES = ("smoke_plume", "burn_scar")
FIRE_TYPES = ("active_fire",)
JUDGED_TYPES = SMOKE_TYPES + FIRE_TYPES
LEGACY_FIRMS_KM = 2.0
FIRE_FIRMS_KM = 1.0
FIRE_MIN_PX = 4


def _attrs(v) -> dict:
    if isinstance(v, dict):
        return v
    try:
        a = json.loads(v or "{}")
        return a if isinstance(a, dict) else {}
    except (TypeError, ValueError):
        return {}


def firms_near(points, lat: float, lon: float, km: float) -> int:
    c = max(0.1, math.cos(math.radians(lat)))
    return sum(1 for a, o in points if math.hypot((a - lat) * 111.0, (o - lon) * 111.0 * c) <= km)


def judge(object_type: str, attrs: dict, lat: float, lon: float, firms_points) -> dict | None:
    """{shown, class, decided_by, reasons, rules} for a smoke/scar/fire
    detection; None for every other kind (not this module's to judge)."""
    if object_type not in JUDGED_TYPES:
        return None
    a = _attrs(attrs)
    if object_type in FIRE_TYPES:
        n = firms_near(firms_points, lat, lon, FIRE_FIRMS_KM)
        px = a.get("fire_px")
        if px is None and a.get("fire_area_m2"):
            px = round(float(a["fire_area_m2"]) / 400)        # 20 m pixels
        if n:
            return {"shown": True, "class": object_type, "rules": "stored v2",
                    "decided_by": f"{n} FIRMS fire detection(s) within {FIRE_FIRMS_KM:g} km that day"}
        if a.get("hot_pixel_test") == "v2" and (px or 0) >= FIRE_MIN_PX:
            return {"shown": True, "class": object_type, "rules": "stored v2",
                    "decided_by": f"{px} hot pixels that passed the blue-band test"}
        return {"shown": False, "class": "hot_pixels", "rules": "stored v2",
                "decided_by": (f"{px or '?'} hot pixel(s) and no FIRMS fire within {FIRE_FIRMS_KM:g} km that day"
                               + ("" if a.get("hot_pixel_test") == "v2"
                                  else " — found before hot pixels were checked against blue (cloud, glint, roofs)"))}

    feats = a.get("features")
    if isinstance(feats, dict) and "vis" in feats:
        import smoke_classify
        f = dict(feats)
        f["ratios"] = a.get("band_ratios") or {}
        f["firms"] = max(int(f.get("firms") or 0), firms_near(firms_points, lat, lon, 1.0))
        out = smoke_classify.classify(f)
        return {"shown": smoke_classify.is_finding(out["class"]), "class": out["class"],
                "decided_by": out.get("decided_by"), "reasons": [r.get("text") for r in out["reasons"]][:5],
                "rules": out.get("classifier")}

    n = firms_near(firms_points, lat, lon, LEGACY_FIRMS_KM)
    if n:
        return {"shown": True, "class": object_type, "rules": "stored v2",
                "decided_by": f"{n} FIRMS fire detection(s) within {LEGACY_FIRMS_KM:g} km of its source that day"}
    return {"shown": False, "class": "no_source", "rules": "stored v2",
            "decided_by": ("found before the smoke classifier (13 Oct 2026) and nothing confirms a fire: no FIRMS "
                           f"detection within {LEGACY_FIRMS_KM:g} km between the day before and the day after"
                           + (f"; its {a['fire_px']} SWIR hot pixel(s) are not trusted on their own"
                              if a.get("fire_px") else ""))}


def _when(row, scan_when=None):
    w = scan_when or getattr(row, "created_at", None)
    if isinstance(w, str):
        try:
            w = _dt.datetime.fromisoformat(w.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            w = None
    return w


def verdicts(db, rows) -> dict:
    """{detection_id: verdict} for the smoke/scar/fire rows among `rows`
    (SentinelDetection objects). One FIRMS query per scan."""
    from database import FireDetection, SentinelScan
    rows = [r for r in rows if getattr(r, "object_type", None) in JUDGED_TYPES]
    if not rows:
        return {}
    scan_ids = {r.scan_id for r in rows}
    when = dict(db.query(SentinelScan.scan_id, SentinelScan.image_timestamp_utc)
                .filter(SentinelScan.scan_id.in_(scan_ids)).all())
    by_scan: dict = {}
    for r in rows:
        by_scan.setdefault(r.scan_id, []).append(r)
    out = {}
    for sid, group in by_scan.items():
        w = _when(group[0], when.get(sid))
        lats = [r.centroid_lat for r in group]
        lons = [r.centroid_lon for r in group]
        pts = []
        if w is not None:
            d0 = _dt.datetime(w.year, w.month, w.day)
            pts = db.query(FireDetection.lat, FireDetection.lon).filter(
                FireDetection.lat.between(min(lats) - 0.05, max(lats) + 0.05),
                FireDetection.lon.between(min(lons) - 0.08, max(lons) + 0.08),
                FireDetection.acquired_at >= d0 - _dt.timedelta(days=1),
                FireDetection.acquired_at < d0 + _dt.timedelta(days=2)).all()
        for r in group:
            a = _attrs(r.attributes)
            lat = a.get("source_lat", r.centroid_lat) if r.object_type in SMOKE_TYPES else r.centroid_lat
            lon = a.get("source_lon", r.centroid_lon) if r.object_type in SMOKE_TYPES else r.centroid_lon
            try:
                v = judge(r.object_type, a, float(lat), float(lon), pts)
            except Exception as e:                                   # noqa: BLE001
                # A row that cannot be judged is shown as it was, and said so.
                print(f"[imagery_verdict] error: {r.detection_id} not judged: {type(e).__name__}: {e}", flush=True)
                v = None
            if v is not None:
                out[r.detection_id] = v
    return out


def shown(v: dict | None) -> bool:
    return v is None or bool(v.get("shown"))


def withdrawn_alerts(db, alerts) -> dict:
    """{alert_id: decided_by} for the imagery-signal alerts about a smoke
    plume or burn scar whose detection today's rules withdraw. The alert
    names its scan and its plume's source ("Source 54.14569, 12.1235."), so
    it is matched to that detection; an alert that cannot be matched is
    left alone. Derived on read — the alert row is not touched."""
    import re
    from database import SentinelDetection
    want = {}
    for a in alerts:
        if getattr(a, "entity_type", None) not in SMOKE_TYPES:
            continue
        raw = _attrs(getattr(a, "raw_json", None))
        inner = raw.get("raw_json") if isinstance(raw.get("raw_json"), dict) else raw
        sid = inner.get("scan_id")
        m = re.search(r"Source (-?\d+\.\d+), (-?\d+\.\d+)", str(inner.get("reason") or ""))
        if sid and m:
            want[a.alert_id] = (sid, float(m.group(1)), float(m.group(2)))
    if not want:
        return {}
    rows = (db.query(SentinelDetection)
            .filter(SentinelDetection.scan_id.in_({v[0] for v in want.values()}),
                    SentinelDetection.object_type.in_(SMOKE_TYPES)).all())
    v = verdicts(db, rows)
    out = {}
    for aid, (sid, la, lo) in want.items():
        for r in rows:
            if r.scan_id != sid:
                continue
            a = _attrs(r.attributes)
            if abs(float(a.get("source_lat", r.centroid_lat)) - la) < 1e-4 and \
                    abs(float(a.get("source_lon", r.centroid_lon)) - lo) < 1e-4:
                if not shown(v.get(r.detection_id)):
                    out[aid] = v[r.detection_id].get("decided_by")
                break
    return out
