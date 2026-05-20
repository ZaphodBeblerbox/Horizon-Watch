"""
sentinel_scanner.py — Scan runner for Sentinel surveillance zones.

SentinelScanner.run_scan(zone, triggered_by) is the main entry point.
It is called from main.py's background scheduler loop (via asyncio executor)
and from the POST /api/watch-zones/{id}/scan-now endpoint.

The scanner:
  1. Creates a SentinelScan row (status=pending)
  2. Fetches Sentinel-2 imagery for each required band combination
  3. Runs the ML tasks specified in zone.ml_tasks
  4. Saves all detections to SentinelDetection table
  5. Fires immediate alerts via the global _forge_alerts list
  6. Updates scan status and zone timestamps
"""

import os
import io
import json
import base64
import datetime
import threading
import math
from typing import Optional

# ── Optional deps (graceful fallback if Pillow not available) ──────────────────
try:
    from PIL import Image as _PIL_Image
    _PILLOW_OK = True
except ImportError:
    _PILLOW_OK = False

# ── Copernicus credentials ────────────────────────────────────────────────────
_COPERNICUS_CLIENT_ID     = os.getenv("COPERNICUS_CLIENT_ID", "").strip()
_COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET", "").strip()
_COPERNICUS_TOKEN_URL     = (
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/"
    "protocol/openid-connect/token"
)
_SH_PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

_token_cache: dict  = {}
_token_lock         = threading.Lock()


def _get_token_sync() -> Optional[str]:
    """Synchronous Copernicus OAuth2 token fetch with in-process cache."""
    if not (_COPERNICUS_CLIENT_ID and _COPERNICUS_CLIENT_SECRET):
        return None
    import time, urllib.request, urllib.parse
    with _token_lock:
        now = time.time()
        if _token_cache.get("access_token") and float(_token_cache.get("expires_at", 0)) - now > 60:
            return _token_cache["access_token"]
        try:
            data = urllib.parse.urlencode({
                "grant_type":    "client_credentials",
                "client_id":     _COPERNICUS_CLIENT_ID,
                "client_secret": _COPERNICUS_CLIENT_SECRET,
            }).encode()
            req = urllib.request.Request(
                _COPERNICUS_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                payload = json.loads(r.read())
            access_token = payload.get("access_token")
            expires_in   = int(payload.get("expires_in", 3600))
            _token_cache["access_token"] = access_token
            _token_cache["expires_at"]   = now + max(300, expires_in - 120)
            return access_token
        except Exception as e:
            print(f"[sentinel_scanner] token error: {e}")
            return None


# ── Evalscripts for each band combo ──────────────────────────────────────────

_EVALSCRIPTS_SCANNER: dict = {
    "true-colour": """//VERSION=3
function setup(){return{input:["B04","B03","B02","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B04,3.5*s.B03,3.5*s.B02,s.dataMask]}""",

    "swir": """//VERSION=3
function setup(){return{input:["B12","B11","B04","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B12,3.5*s.B11,3.5*s.B04,s.dataMask]}""",

    "false-colour": """//VERSION=3
function setup(){return{input:["B08","B04","B03","dataMask"],output:{bands:4}}}
function evaluatePixel(s){return[3.5*s.B08,3.5*s.B04,3.5*s.B03,s.dataMask]}""",
}

# NBR pair: R=B08, G=B12, B=zeros — repurpose false-colour as B08 proxy
# Actual NBR computation is in sentinel_ml; scanner just fetches the bands.


def _fetch_sentinel_image(
    west: float, south: float, east: float, north: float,
    image_type: str,
    max_cloud: int = 30,
    days_back: int = 7,
    width: int = 1024,
    height: int = 1024,
) -> Optional[bytes]:
    """
    Fetch a Sentinel-2 image as PNG bytes from the Sentinel Hub Process API.
    Returns None if fetch fails or credentials unavailable.
    """
    import urllib.request
    token = _get_token_sync()
    if not token:
        return None

    evalscript = _EVALSCRIPTS_SCANNER.get(image_type)
    if not evalscript:
        return None

    now = datetime.datetime.utcnow()
    payload = {
        "input": {
            "bounds": {
                "bbox": [west, south, east, north],
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "maxCloudCoverage": max_cloud,
                    "timeRange": {
                        "from": (now - datetime.timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00Z"),
                        "to":   now.strftime("%Y-%m-%dT23:59:59Z"),
                    },
                    "mosaickingOrder": "leastCC",
                },
            }],
        },
        "output": {
            "width":  width,
            "height": height,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": evalscript,
    }

    try:
        body = json.dumps(payload).encode("utf-8")
        req  = urllib.request.Request(
            _SH_PROCESS_URL,
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
                "Accept":        "image/png",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status == 200:
                return r.read()
            else:
                print(f"[sentinel_scanner] Process API {r.status} for {image_type}")
                return None
    except Exception as e:
        print(f"[sentinel_scanner] fetch error ({image_type}): {e}")
        return None


def _bytes_to_pil(data: bytes) -> Optional[object]:
    """Convert PNG bytes to PIL Image (RGB)."""
    if not _PILLOW_OK or data is None:
        return None
    try:
        return _PIL_Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:
        print(f"[sentinel_scanner] PIL open error: {e}")
        return None


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _nearest_label(lat: float, lon: float, candidates: list, max_m: float = 50_000) -> Optional[str]:
    """Return name of nearest candidate within max_m metres, or None."""
    best_d, best_n = float("inf"), None
    for c in candidates:
        d = _haversine_m(lat, lon, c.get("lat", 0), c.get("lon", 0))
        if d < best_d and d <= max_m:
            best_d, best_n = d, c.get("name") or c.get("port_name") or c.get("system_id")
    return best_n


# ── Alert icon mapping ────────────────────────────────────────────────────────
_ICON_MAP = {
    "fire":                    "LOITERING_INFRA",
    "smoke_plume":             "LOITERING_INFRA",
    "vessel_without_ais":      "DARK_SHIP",
    "vessel_cluster":          "FORMATION_SAILING",
    "oil_slick":               "UNKNOWN_CONTACT",
    "infrastructure_change":   "IDENTITY_CHANGE",
    "vessel":                  "UNKNOWN_CONTACT",
    "burn_scar":               "LOITERING_INFRA",
}


# ── Main scanner class ─────────────────────────────────────────────────────────

class SentinelScanner:

    def run_scan(self, zone, triggered_by: str = "schedule") -> dict:
        """
        Run a full scan for `zone` (WatchZone ORM row or dict).
        Returns the scan_id (string) for status tracking.
        Creates SentinelScan and SentinelDetection rows in the database.
        """
        from database import WatchZone, SentinelScan, SentinelDetection, get_db
        from sentinel_ml import (
            TASK_REGISTRY, BAND_REQUIREMENTS,
            run_vessel_cluster_detection,
            run_burn_scar_detection, run_oil_slick_detection,
            run_infrastructure_change_detection, run_vessel_without_ais,
        )
        import main as _main_mod

        now = datetime.datetime.utcnow()

        # ── Normalise zone input ──────────────────────────────────────────────
        if isinstance(zone, dict):
            zone_id          = zone["id"]
            zone_system_id   = zone["system_id"]
            zone_name        = zone["name"]
            bbox_min_lon     = zone["bbox_min_lon"]
            bbox_min_lat     = zone["bbox_min_lat"]
            bbox_max_lon     = zone["bbox_max_lon"]
            bbox_max_lat     = zone["bbox_max_lat"]
            ml_tasks_raw     = zone.get("ml_tasks", "[]")
            scan_interval_h  = zone.get("scan_interval_hours", 24)
            alert_threshold  = zone.get("alert_threshold", "both")
        else:
            zone_id          = zone.id
            zone_system_id   = zone.system_id
            zone_name        = zone.name
            bbox_min_lon     = zone.bbox_min_lon
            bbox_min_lat     = zone.bbox_min_lat
            bbox_max_lon     = zone.bbox_max_lon
            bbox_max_lat     = zone.bbox_max_lat
            ml_tasks_raw     = zone.ml_tasks or "[]"
            scan_interval_h  = zone.scan_interval_hours or 24
            alert_threshold  = zone.alert_threshold or "both"

        ml_tasks = json.loads(ml_tasks_raw) if isinstance(ml_tasks_raw, str) else (ml_tasks_raw or [])
        bbox = {
            "min_lon": bbox_min_lon, "min_lat": bbox_min_lat,
            "max_lon": bbox_max_lon, "max_lat": bbox_max_lat,
        }
        west, south, east, north = bbox_min_lon, bbox_min_lat, bbox_max_lon, bbox_max_lat

        # ── Create SentinelScan row (status=pending) ──────────────────────────
        with get_db() as db:
            scan_num = db.query(SentinelScan).count() + 1
            scan_id  = f"SCAN-{scan_num:04d}"
            # Avoid duplicate scan_id in race conditions
            while db.query(SentinelScan).filter(SentinelScan.scan_id == scan_id).first():
                scan_num += 1
                scan_id   = f"SCAN-{scan_num:04d}"
            scan = SentinelScan(
                scan_id      = scan_id,
                zone_id      = zone_id,
                triggered_by = triggered_by,
                status       = "pending",
                created_at   = now,
            )
            db.add(scan)
            db.commit()

        print(f"[sentinel_scanner] SCAN {scan_id} started for {zone_system_id} ({zone_name}) triggered_by={triggered_by}")

        # ── Determine which band combinations are needed ──────────────────────
        needed_image_keys: set = set()
        for task in ml_tasks:
            meta = TASK_REGISTRY.get(task, {})
            for key in meta.get("requires", []):
                needed_image_keys.add(key)

        # ── Fetch images ──────────────────────────────────────────────────────
        # Compute pixel dimensions from bbox (cap at 2048×2048 for memory)
        lon_span = abs(east - west)
        lat_span = abs(north - south)
        img_w = min(2048, max(512, int(lon_span * 11100)))
        img_h = min(2048, max(512, int(lat_span * 11100)))

        images: dict = {}
        image_fetch_errors = 0
        for key in needed_image_keys:
            image_type = BAND_REQUIREMENTS.get(key, "true-colour")
            # "nbr_pair" needs a custom evalscript that encodes B08 and B12
            if key == "nbr_pair":
                # Reuse the false-colour image (R=B08) as a proxy
                # The run_burn_scar_detection task uses R=B08, G=B12 layout;
                # we build a synthetic two-band image from the false-colour
                img_bytes = _fetch_sentinel_image(west, south, east, north, "false-colour",
                                                  max_cloud=30, width=img_w, height=img_h)
                pil = _bytes_to_pil(img_bytes)
                if pil and _PILLOW_OK:
                    import numpy as np
                    arr = np.array(pil)
                    # R=B08 (from false-colour R), G=B12 approx (use B channel as proxy)
                    nbr_arr = np.stack([arr[:, :, 0], arr[:, :, 2],
                                        np.zeros_like(arr[:, :, 0])], axis=2).astype(np.uint8)
                    images["nbr_pair"] = _PIL_Image.fromarray(nbr_arr)
                elif pil:
                    images["nbr_pair"] = pil
                else:
                    image_fetch_errors += 1
                continue

            img_bytes = _fetch_sentinel_image(west, south, east, north, image_type,
                                              max_cloud=30, width=img_w, height=img_h)
            pil = _bytes_to_pil(img_bytes)
            if pil:
                images[key] = pil
            else:
                image_fetch_errors += 1

        # ── Estimate image metadata ───────────────────────────────────────────
        # We don't have per-tile cloud cover from the Process API, so use 0.0 as default
        # (the Process API already filtered by maxCloudCoverage=30%)
        cloud_cover = 0.0
        image_id    = f"SH-{zone_system_id}-{now.strftime('%Y%m%d%H%M')}"
        image_timestamp_utc = now  # approximate; Process API mosaics to most recent

        if not images and image_fetch_errors > 0:
            # All fetches failed — mark scan failed
            with get_db() as db:
                s = db.query(SentinelScan).filter(SentinelScan.scan_id == scan_id).first()
                if s:
                    s.status        = "failed"
                    s.completed_at  = datetime.datetime.utcnow()
                    s.error_message = "All image fetches failed — check Copernicus credentials"
                    db.commit()
                zone_row = db.query(WatchZone).filter(WatchZone.id == zone_id).first()
                if zone_row:
                    zone_row.next_scan_at = datetime.datetime.utcnow() + datetime.timedelta(hours=scan_interval_h)
                    db.commit()
            print(f"[sentinel_scanner] SCAN {scan_id} FAILED — image fetch error")
            return {"scan_id": scan_id, "status": "failed", "error": "image fetch failed"}

        # ── Update scan: running ──────────────────────────────────────────────
        with get_db() as db:
            s = db.query(SentinelScan).filter(SentinelScan.scan_id == scan_id).first()
            if s:
                s.status               = "running"
                s.image_id             = image_id
                s.image_timestamp_utc  = image_timestamp_utc
                s.cloud_cover_percent  = cloud_cover
                s.image_age_hours      = 0.0
                db.commit()

        # ── Load context for alert enrichment ─────────────────────────────────
        ports_list: list = []
        infra_list: list = []
        try:
            from database import PortBoundary, CableSegment, get_db as _gdb
            with _gdb() as _db:
                ports_list = [
                    {"name": p.port_name, "lat": p.latitude, "lon": p.longitude}
                    for p in _db.query(PortBoundary).all()
                ]
                infra_list = [
                    {"name": c.cable_name, "lat": None, "lon": None}
                    for c in _db.query(CableSegment).limit(500).all()
                ]
        except Exception as e:
            print(f"[sentinel_scanner] context load error: {e}")

        # ── Get vessel baseline from zone scan history ─────────────────────────
        vessel_baseline = 0.0
        try:
            from database import SentinelScan as _SS, SentinelDetection as _SD, get_db as _gdb
            with _gdb() as _db:
                past_scans = (_db.query(_SS)
                              .filter(_SS.zone_id == zone_id, _SS.status == "complete")
                              .order_by(_SS.id.desc()).limit(20).all())
                vessel_counts = []
                for ps in past_scans:
                    if ps.result_summary:
                        try:
                            rs = json.loads(ps.result_summary) if isinstance(ps.result_summary, str) else ps.result_summary
                            vc = (rs.get("by_type") or {}).get("vessel", 0)
                            vessel_counts.append(vc)
                        except Exception:
                            pass
                if vessel_counts:
                    vessel_baseline = sum(vessel_counts) / len(vessel_counts)
        except Exception:
            pass

        # ── Run ML tasks ──────────────────────────────────────────────────────
        all_detections: list = []
        ship_detections: list = []

        for task_name in ml_tasks:
            if task_name not in TASK_REGISTRY:
                print(f"[sentinel_scanner] unknown task: {task_name} — skipping")
                continue

            try:
                if task_name == "ship_detection":
                    # Use pre-fetched Sentinel true-colour through the same inference
                    # pipeline as /api/overwatch/detect-image. Falls back to ESRI tiles
                    # if Copernicus credentials are absent.
                    tc_img = images.get("true_colour")
                    if tc_img is not None:
                        ow_bounds = {"north": north, "south": south,
                                     "east": east,  "west": west}
                        raw = _main_mod._run_inference_on_image(
                            tc_img, ow_bounds, 0.15, enhance=False, model_key="dota"
                        )
                        dets = _main_mod._convert_overwatch_detections(
                            raw.get("detections", []), "TRUE_COLOR"
                        )
                    else:
                        dets = _main_mod._run_overwatch_detection_sync(
                            bbox, "TRUE_COLOR", 0.15
                        )
                    ship_detections = dets
                    all_detections.extend(dets)

                elif task_name == "vessel_cluster_detection":
                    dets = run_vessel_cluster_detection(ship_detections, bbox)
                    all_detections.extend(dets)

                elif task_name == "smoke_plume_detection":
                    # Use pre-fetched SWIR + true_colour bands directly
                    from sentinel_ml import run_smoke_plume_detection
                    if images.get("swir") is not None:
                        dets = run_smoke_plume_detection(images, bbox)
                    else:
                        dets = _main_mod._run_overwatch_detection_sync(
                            bbox, "FALSE_COLOR", 0.15
                        )
                    all_detections.extend(dets)

                elif task_name == "fire_detection":
                    # Use pre-fetched SWIR + NIR bands directly
                    from sentinel_ml import run_fire_detection
                    if images.get("swir") is not None:
                        dets = run_fire_detection(images, bbox)
                    else:
                        dets = _main_mod._run_overwatch_detection_sync(
                            bbox, "SWIR", 0.15
                        )
                    all_detections.extend(dets)

                elif task_name == "burn_scar_detection":
                    dets = run_burn_scar_detection(images, bbox)
                    all_detections.extend(dets)

                elif task_name == "oil_slick_detection":
                    nearest_port = _nearest_label(
                        (bbox_min_lat + bbox_max_lat) / 2,
                        (bbox_min_lon + bbox_max_lon) / 2,
                        ports_list,
                    )
                    dets = run_oil_slick_detection(images, bbox,
                                                   nearest_port=nearest_port,
                                                   nearest_infra=None)
                    all_detections.extend(dets)

                elif task_name == "infrastructure_change_detection":
                    # Baseline imagery not yet stored; skip on first scan
                    dets = run_infrastructure_change_detection(images, None, bbox)
                    all_detections.extend(dets)

                elif task_name == "vessel_without_ais_detection":
                    # Pull AIS snapshot from main.py global (if available)
                    ais_vessels: list = []
                    try:
                        import main as _main
                        snap = getattr(_main, "_VESSEL_SNAPSHOT", {})
                        ais_vessels = [
                            {"lat": v.get("lat", 0), "lon": v.get("lng", v.get("lon", 0)),
                             "mmsi": v.get("mmsi"), "name": v.get("name")}
                            for v in snap.values()
                        ]
                    except Exception:
                        pass
                    nearest_chokepoint = None  # enriched below if needed
                    dets = run_vessel_without_ais(
                        ship_detections, ais_vessels, bbox,
                        nearest_infra=None,
                        nearest_chokepoint=nearest_chokepoint,
                    )
                    all_detections.extend(dets)

                print(f"[sentinel_scanner] SCAN {scan_id} task={task_name}: {len(dets)} detections")

            except Exception as e:
                print(f"[sentinel_scanner] SCAN {scan_id} task={task_name} ERROR: {e}")

        # ── Enrich and save detections ────────────────────────────────────────
        now_save = datetime.datetime.utcnow()
        immediate_count = 0
        by_type: dict = {}
        immediate_alerts_fired = 0

        with get_db() as db:
            det_num = db.query(SentinelDetection).count()
            for det in all_detections:
                det_num += 1

                # Ensure detection_id is unique
                det_id = det.get("detection_id") or f"DET-{det_num:06d}"
                while db.query(SentinelDetection).filter(SentinelDetection.detection_id == det_id).first():
                    det_num += 1
                    det_id = f"DET-{det_num:06d}"

                # Enrich nearest port/infra
                c_lat = det.get("centroid_lat", 0)
                c_lon = det.get("centroid_lon", 0)
                nearest_port = det.get("nearest_port") or _nearest_label(c_lat, c_lon, ports_list)

                row = SentinelDetection(
                    detection_id            = det_id,
                    scan_id                 = scan_id,
                    zone_id                 = zone_id,
                    object_type             = det.get("object_type", "unknown"),
                    confidence              = float(det.get("confidence", 0.0)),
                    centroid_lat            = float(c_lat),
                    centroid_lon            = float(c_lon),
                    geo_geometry            = det.get("geo_geometry"),
                    area_m2                 = det.get("area_m2"),
                    severity                = det.get("severity", "info"),
                    alert_tier              = det.get("alert_tier", "silent"),
                    attributes              = det.get("attributes"),
                    matched_to_ais          = bool(det.get("matched_to_ais", False)),
                    nearest_port            = nearest_port,
                    nearest_infrastructure  = det.get("nearest_infrastructure"),
                    nearest_chokepoint      = det.get("nearest_chokepoint"),
                    created_at              = now_save,
                )
                db.add(row)

                # Count by type
                ot = det.get("object_type", "unknown")
                by_type[ot] = by_type.get(ot, 0) + 1

                # Fire immediate alerts
                tier = det.get("alert_tier", "silent")
                if tier == "immediate" and alert_threshold in ("immediate", "both"):
                    self._fire_alert(det, zone_system_id, zone_name, scan_id)
                    immediate_alerts_fired += 1

            db.commit()

        # ── Build result summary ───────────────────────────────────────────────
        result_summary = {
            "total_detections":      len(all_detections),
            "by_type":               by_type,
            "immediate_alerts_fired": immediate_alerts_fired,
            "image_age_hours":       0.0,
            "cloud_cover_pct":       cloud_cover,
            "highest_severity":      self._highest_severity(all_detections),
            "tasks_run":             ml_tasks,
        }

        # ── Update scan and zone ───────────────────────────────────────────────
        completed_at = datetime.datetime.utcnow()
        with get_db() as db:
            s = db.query(SentinelScan).filter(SentinelScan.scan_id == scan_id).first()
            if s:
                s.status          = "complete"
                s.completed_at    = completed_at
                s.result_summary  = json.dumps(result_summary)
                s.alert_fired     = immediate_alerts_fired > 0
                db.commit()

            zone_row = db.query(WatchZone).filter(WatchZone.id == zone_id).first()
            if zone_row:
                zone_row.last_scanned_at = completed_at
                zone_row.next_scan_at    = completed_at + datetime.timedelta(hours=scan_interval_h)
                db.commit()

        print(
            f"[sentinel_scanner] SCAN {scan_id} COMPLETE — "
            f"{len(all_detections)} detections, {immediate_alerts_fired} immediate alerts, "
            f"{by_type}"
        )
        return {"scan_id": scan_id, "status": "complete", "summary": result_summary}

    async def run_detection_on_bbox(self, bbox: dict, db=None) -> list:
        """Async wrapper: fetch Sentinel true-colour for bbox and run ship detection."""
        import asyncio, functools
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, functools.partial(self._run_detection_on_bbox_sync, bbox)
        )

    def _run_detection_on_bbox_sync(self, bbox: dict) -> list:
        import json as _j
        west  = float(bbox["min_lon"])
        south = float(bbox["min_lat"])
        east  = float(bbox["max_lon"])
        north = float(bbox["max_lat"])
        img_w = min(2048, max(512, int(abs(east - west) * 11100)))
        img_h = min(2048, max(512, int(abs(north - south) * 11100)))

        img_bytes = _fetch_sentinel_image(
            west, south, east, north, "true-colour",
            max_cloud=30, width=img_w, height=img_h,
        )
        pil = _bytes_to_pil(img_bytes)
        if pil is None:
            print("[sentinel_scanner] run_detection_on_bbox: Sentinel fetch failed")
            return []

        try:
            import main as _main_mod
            ow_bounds = {"north": north, "south": south, "east": east, "west": west}
            raw  = _main_mod._run_inference_on_image(
                pil, ow_bounds, 0.15, enhance=False, model_key="dota"
            )
            dets = _main_mod._convert_overwatch_detections(
                raw.get("detections", []), "TRUE_COLOR"
            )
            for d in dets:
                try:
                    attrs = _j.loads(d.get("attributes") or "{}")
                    d["estimated_length_m"] = attrs.get("estimated_length_m")
                    d["estimated_width_m"]  = attrs.get("estimated_width_m")
                except Exception:
                    pass
            return dets
        except Exception as e:
            print(f"[sentinel_scanner] run_detection_on_bbox error: {e}")
            return []

    # ── Internal helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _highest_severity(detections: list) -> str:
        order = {"critical": 4, "high": 3, "medium": 2, "info": 1}
        best  = "info"
        for d in detections:
            sev = d.get("severity", "info")
            if order.get(sev, 0) > order.get(best, 0):
                best = sev
        return best

    @staticmethod
    def _fire_alert(detection: dict, zone_system_id: str, zone_name: str, scan_id: str):
        """Inject a forge alert into the main.py _forge_alerts list."""
        import datetime as _dt
        obj_type = detection.get("object_type", "unknown")
        conf     = detection.get("confidence", 0.0)
        area     = detection.get("area_m2")
        lat      = detection.get("centroid_lat")
        lon      = detection.get("centroid_lon")
        sev      = detection.get("severity", "high")

        area_str = f", area {area/1e6:.2f} km²" if area and area > 0 else ""
        message  = (
            f"SENTINEL: {obj_type.replace('_', ' ').title()} detected in {zone_name}"
            f" — confidence {conf*100:.0f}%{area_str}"
        )

        icon_map = {
            "fire":                  "LOITERING_INFRA",
            "smoke_plume":           "LOITERING_INFRA",
            "vessel_without_ais":    "DARK_SHIP",
            "vessel_cluster":        "FORMATION_SAILING",
            "oil_slick":             "UNKNOWN_CONTACT",
            "infrastructure_change": "IDENTITY_CHANGE",
            "vessel":                "UNKNOWN_CONTACT",
            "burn_scar":             "LOITERING_INFRA",
        }

        alert = {
            "type":           f"SENTINEL_{obj_type.upper()}",
            "rule_name":      f"SENTINEL_{obj_type.upper()}",
            "message":        message,
            "severity":       sev,
            "timestamp":      _dt.datetime.utcnow().isoformat() + "Z",
            "lat":            lat,
            "lng":            lon,
            "icon_type":      icon_map.get(obj_type, "UNKNOWN_CONTACT"),
            "zone_system_id": zone_system_id,
            "zone_name":      zone_name,
            "scan_id":        scan_id,
            "detection_id":   detection.get("detection_id"),
            "object_type":    obj_type,
            "confidence":     conf,
            "area_m2":        area,
            "_sentinel":      True,
        }

        try:
            import main as _main
            with _main._ALERTS_QUEUE_LOCK if hasattr(_main, "_ALERTS_QUEUE_LOCK") else _noop_ctx():
                _main._forge_alerts.append(alert)
        except Exception as e:
            print(f"[sentinel_scanner] alert inject error: {e}")

        # Persist to DB + create OntologyLinks + mark region dirty
        try:
            from alert_writer import write_alert as _write_alert, _mark_region_dirty as _mrd_sent
            from entity_linker import entity_linker as _el_sent
            _sent_id = f"SENT-{detection.get('detection_id', '')}"
            _write_alert({
                "id":         _sent_id,
                "source":     "sentinel",
                "alert_type": f"sentinel_{obj_type.lower()}",
                "title":      f"SENTINEL: {obj_type.replace('_', ' ').title()} detected in {zone_name}",
                "severity":   sev,
                "lat":        lat,
                "lon":        lon,
            })
            _el_sent.link_alert(_sent_id, "sentinel", lat, lon, zone_name)
            _mrd_sent(zone_system_id)
        except Exception as _se:
            print(f"[sentinel_scanner] alert persist error: {_se}")

        # Feed fusion engine
        try:
            import main as _main2
            if hasattr(_main2, "_fusion_engine") and _main2._fusion_engine:
                import datetime as _dt2
                _main2._fusion_engine.on_signal({
                    "signal_id":    f"SENTINEL-{detection.get('detection_id', '')}",
                    "domain":       "SENTINEL",
                    "severity":     sev,
                    "lat":          lat,
                    "lon":          lon,
                    "location_name": zone_name,
                    "region_id":    None,
                    "country":      None,
                    "timestamp":    _dt2.datetime.utcnow(),
                    "alert_id":     None,
                    "assessment_id": None,
                    "rule_id":      None,
                    "rule_name":    f"Sentinel: {obj_type}",
                    "summary":      f"{obj_type.replace('_',' ').title()} detected with {int(conf*100)}% confidence",
                })
        except Exception as _fse:
            print(f"[sentinel_scanner] fusion signal error: {_fse}")


class _noop_ctx:
    def __enter__(self): return self
    def __exit__(self, *a): pass
