"""regional_scanner.py — Tile-by-tile streaming Sentinel-2 scan for UAE.

Pipeline per tile:
  1. Fetch current Sentinel-2 image (last 5 days)
  2. Fetch baseline image (30-60 days ago)
  3. Spectral change analysis
  4. If flagged + relevant: Claude Vision analysis
  5. Store detection + emit SSE event immediately

At completion: Claude Opus intelligence report.
"""
from __future__ import annotations

import asyncio
import base64
import datetime
import io
import json
import math
import re
import uuid
from typing import Callable, Optional

import anthropic

from database import (
    RegionalScanJob, RegionalScanDetection, RegionalScanTile,
    Airport, PortBoundary, StrategicZone,
    SessionLocal,
)

# Set from main.py at startup — called to push SSE events to all clients
sse_push_fn: Optional[Callable] = None

# ── HuggingFace YOLO model registry ───────────────────────────────────────────

MODELS = {
    "vessels":   "keremberke/yolov8n-ship-detection",
    "aircraft":  "keremberke/yolov8n-satellite-imagery-detection",
    "oil_tanks": "keremberke/yolov8n-oil-spill-detection",
    "defence":   "SkalskiP/yolov8s-military-vehicle-detection",
}

_loaded_models: dict = {}


def load_detection_models():
    """Download and cache HuggingFace YOLO models. Runs once at startup in a thread."""
    try:
        from ultralytics import YOLO
        for key, hub_id in MODELS.items():
            try:
                _loaded_models[key] = YOLO(hub_id)
                print(f"[scanner] model loaded: {key} ({hub_id})")
            except Exception as e:
                print(f"[scanner] model {key} unavailable: {e}")
                _loaded_models[key] = None
    except ImportError:
        print("[scanner] ultralytics not installed — YOLO models disabled, using ONNX fallback")
        for key in MODELS:
            _loaded_models[key] = None


# ── Sentinel-2 tile fetch (sync, runs in executor) ────────────────────────────

def _fetch_tile_sync(
    west: float, south: float, east: float, north: float,
    max_age_days: int = 5,
    min_age_days: int = 0,
    max_cloud: int = 30,
    width: int = 256,
    height: int = 256,
    band_key: str = "true-colour",
) -> Optional[dict]:
    """Fetch Sentinel-2 tile via Copernicus Process API.
    Returns {"b64": base64_png, "date": datetime} or None.
    """
    try:
        from sentinel_scanner import _get_token_sync, _EVALSCRIPTS_SCANNER, _SH_PROCESS_URL
        import urllib.request

        token = _get_token_sync()
        if not token:
            return None
        evalscript = _EVALSCRIPTS_SCANNER.get(band_key)
        if not evalscript:
            return None

        now   = datetime.datetime.utcnow()
        t_to  = now - datetime.timedelta(days=min_age_days)
        t_from = now - datetime.timedelta(days=max_age_days)

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
                            "from": t_from.strftime("%Y-%m-%dT00:00:00Z"),
                            "to":   t_to.strftime("%Y-%m-%dT23:59:59Z"),
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
        with urllib.request.urlopen(req, timeout=12) as r:
            if r.status == 200:
                raw = r.read()
                return {"b64": base64.b64encode(raw).decode(), "date": t_to}
        return None
    except Exception as e:
        print(f"[scanner] tile fetch error ({west:.2f},{south:.2f}): {e}")
        return None


# ── TileByTileScanner ─────────────────────────────────────────────────────────

class TileByTileScanner:

    UAE_REGION = {
        "name": "UAE",
        "bbox": {"min_lon": 51.5, "min_lat": 22.5, "max_lon": 56.5, "max_lat": 26.2},
        "tile_size_deg": 0.5,
        "max_cloud_cover": 30,
        "spectral_change_threshold": 0.12,
        "scan_interval_days": 5,
    }

    REGIONS = {"UAE": UAE_REGION}

    # ── Tile generation ────────────────────────────────────────────────────────

    def generate_tiles(self, region: dict) -> list:
        bbox = region["bbox"]
        size = region["tile_size_deg"]
        tiles = []
        lon = bbox["min_lon"]
        while lon < bbox["max_lon"]:
            lat = bbox["min_lat"]
            while lat < bbox["max_lat"]:
                tiles.append({
                    "index":   len(tiles),
                    "min_lon": round(lon, 4),
                    "min_lat": round(lat, 4),
                    "max_lon": round(min(lon + size, bbox["max_lon"]), 4),
                    "max_lat": round(min(lat + size, bbox["max_lat"]), 4),
                })
                lat += size
            lon += size
        return tiles

    # ── Multi-band fetch ──────────────────────────────────────────────────────

    async def _fetch_tile_multiband(
        self, tile: dict, region: dict
    ) -> tuple[Optional[dict], Optional[dict]]:
        """Fetch 5 current bands + 2 baseline bands concurrently.
        Returns (current_bands, baseline_bands) keyed by band name, or (None, None) on failure.
        """
        loop = asyncio.get_running_loop()
        w = tile["min_lon"]; s = tile["min_lat"]
        e = tile["max_lon"]; n = tile["max_lat"]
        max_days  = region.get("scan_interval_days", 5)
        max_cloud = region.get("max_cloud_cover", 30)

        CURRENT_BANDS  = ["true-colour", "swir", "false-colour", "ndwi", "ndbi"]
        BASELINE_BANDS = ["true-colour", "false-colour"]

        async def _fetch(key, max_age, min_age, cloud):
            result = await loop.run_in_executor(
                None,
                lambda k=key, ma=max_age, mi=min_age, c=cloud:
                    _fetch_tile_sync(w, s, e, n, ma, mi, c, band_key=k),
            )
            return key, result

        # Fetch current in batches of 3 to avoid API rate limits
        current: dict = {}
        for batch in [CURRENT_BANDS[:3], CURRENT_BANDS[3:]]:
            results = await asyncio.gather(
                *[_fetch(k, max_days, 0, max_cloud) for k in batch],
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, tuple):
                    k, v = r
                    if v:
                        current[k] = v

        if not current.get("true-colour"):
            return None, None

        # Fetch baseline
        baseline: dict = {}
        bl_results = await asyncio.gather(
            *[_fetch(k, 60, 30, 40) for k in BASELINE_BANDS],
            return_exceptions=True,
        )
        for r in bl_results:
            if isinstance(r, tuple):
                k, v = r
                if v:
                    baseline[k] = v

        return current, baseline or None

    # ── Sub-tile bbox extraction ──────────────────────────────────────────────

    def _mask_to_geo_bboxes(
        self, mask, tile_bbox: dict, min_pixels: int = 4, max_boxes: int = 20
    ) -> list:
        """Divide mask into 32×32 coarse blocks → return geo bboxes of active blocks."""
        try:
            import numpy as np
            h, w = mask.shape
            bh = max(1, h // 32)
            bw = max(1, w // 32)
            boxes = []
            for r0 in range(0, h, bh):
                for c0 in range(0, w, bw):
                    r1 = min(r0 + bh, h)
                    c1 = min(c0 + bw, w)
                    px = int(np.sum(mask[r0:r1, c0:c1]))
                    if px < min_pixels:
                        continue
                    min_lon = tile_bbox["min_lon"] + (c0 / w) * (tile_bbox["max_lon"] - tile_bbox["min_lon"])
                    max_lon = tile_bbox["min_lon"] + (c1 / w) * (tile_bbox["max_lon"] - tile_bbox["min_lon"])
                    max_lat = tile_bbox["max_lat"] - (r0 / h) * (tile_bbox["max_lat"] - tile_bbox["min_lat"])
                    min_lat = tile_bbox["max_lat"] - (r1 / h) * (tile_bbox["max_lat"] - tile_bbox["min_lat"])
                    boxes.append({
                        "min_lon": round(min_lon, 5), "min_lat": round(min_lat, 5),
                        "max_lon": round(max_lon, 5), "max_lat": round(max_lat, 5),
                        "centroid_lon": round((min_lon + max_lon) / 2, 5),
                        "centroid_lat": round((min_lat + max_lat) / 2, 5),
                        "pixel_count": px,
                    })
                    if len(boxes) >= max_boxes:
                        return boxes
            return boxes
        except Exception:
            return []

    # ── Full spectral analysis ─────────────────────────────────────────────────

    def _analyse_spectral_full(self, current: dict, baseline: Optional[dict], region: dict) -> dict:
        """Multi-spectral analysis. Returns spectral_detections with per-pixel masks."""
        try:
            import numpy as np
            from PIL import Image

            spectral_detections: list[dict] = []
            water_mask = None
            baseline_available = False
            max_score = 0.0

            def _to_arr(b64: str):
                try:
                    return np.array(
                        Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB"),
                        dtype=float,
                    ) / 255.0
                except Exception:
                    return None

            # ── True-colour array ─────────────────────────────────────────────
            tc_arr = None
            if tc := current.get("true-colour"):
                tc_arr = _to_arr(tc["b64"])
            if tc_arr is None:
                return {"spectral_detections": [], "water_mask": None,
                        "baseline_available": False, "max_score": 0.0,
                        "flagged": False, "change_types": [], "scores": {}}

            h, w = tc_arr.shape[:2]
            r, g, b_ch = tc_arr[:, :, 0], tc_arr[:, :, 1], tc_arr[:, :, 2]

            # ── NDWI: water bodies (absolute) ────────────────────────────────
            if nw := current.get("ndwi"):
                nw_arr = _to_arr(nw["b64"])
                if nw_arr is not None:
                    eps = 1e-6
                    ndwi_val = (nw_arr[:, :, 0] - nw_arr[:, :, 1]) / (nw_arr[:, :, 0] + nw_arr[:, :, 1] + eps)
                    water_mask = ndwi_val > 0.1
                    wf = float(np.mean(water_mask))
                    if wf > 0.008:
                        spectral_detections.append({
                            "type": "WATER_BODY", "category": "environmental",
                            "confidence": round(min(0.5 + wf * 3, 0.95), 3),
                            "is_change": False, "_mask": water_mask,
                        })
                        max_score = max(max_score, wf)

            land_mask = (~water_mask if water_mask is not None else np.ones((h, w), bool))

            # ── False-colour: vegetation (absolute) ─────────────────────────
            if fc := current.get("false-colour"):
                fc_arr = _to_arr(fc["b64"])
                if fc_arr is not None:
                    eps = 1e-6
                    ndvi_val = (fc_arr[:, :, 0] - fc_arr[:, :, 1]) / (fc_arr[:, :, 0] + fc_arr[:, :, 1] + eps)
                    veg_mask = (ndvi_val > 0.2) & land_mask
                    vf = float(np.mean(veg_mask))
                    if vf > 0.005:
                        spectral_detections.append({
                            "type": "VEGETATION", "category": "environmental",
                            "confidence": round(min(0.6 + vf * 2, 0.92), 3),
                            "is_change": False, "_mask": veg_mask,
                        })

            # ── NDBI: built-up infrastructure (absolute) ─────────────────────
            ndbi_val_global = None
            if nb := current.get("ndbi"):
                nb_arr = _to_arr(nb["b64"])
                if nb_arr is not None:
                    eps = 1e-6
                    ndbi_val_global = (nb_arr[:, :, 0] - nb_arr[:, :, 1]) / (nb_arr[:, :, 0] + nb_arr[:, :, 1] + eps)
                    infra_mask = (ndbi_val_global > 0.15) & land_mask
                    inf_f = float(np.mean(infra_mask))
                    if inf_f > 0.005:
                        spectral_detections.append({
                            "type": "INFRASTRUCTURE_CHANGE", "category": "infrastructure",
                            "confidence": round(min(0.55 + inf_f * 2, 0.88), 3),
                            "is_change": False, "_mask": infra_mask,
                        })

            # ── True-colour: fire (tightened to reduce desert false positives) ─
            fire_mask_tc = (r > 0.85) & (g < 0.30) & (b_ch < 0.22)
            fs = float(np.mean(fire_mask_tc))
            if fs > 0.003:
                spectral_detections.append({
                    "type": "FIRE", "category": "environmental",
                    "confidence": round(min(fs * 80, 0.95), 3),
                    "is_change": False, "_mask": fire_mask_tc,
                })
                max_score = max(max_score, fs)

            # ── SWIR: fire via B11/B08 ratio (ratio avoids desert false positives) ─
            if sw := current.get("swir"):
                sw_arr = _to_arr(sw["b64"])
                if sw_arr is not None:
                    eps = 1e-6
                    swir_ratio = sw_arr[:, :, 0] / (sw_arr[:, :, 1] + eps)
                    fire_swir = (swir_ratio > 1.9) & (sw_arr[:, :, 0] > 0.75)
                    sf2 = float(np.mean(fire_swir))
                    already_fire = any(d["type"] == "FIRE" for d in spectral_detections)
                    if sf2 > 0.002 and not already_fire:
                        spectral_detections.append({
                            "type": "FIRE", "category": "environmental",
                            "confidence": round(min(sf2 * 100, 0.92), 3),
                            "is_change": False, "_mask": fire_swir,
                        })

            # ── Smoke ─────────────────────────────────────────────────────────
            smoke_mask = (np.abs(r - g) < 0.08) & (np.abs(g - b_ch) < 0.08) & (r > 0.45) & (r < 0.75)
            sms = float(np.mean(smoke_mask))
            if sms > 0.04:
                spectral_detections.append({
                    "type": "SMOKE", "category": "environmental",
                    "confidence": round(min(sms * 12, 0.85), 3),
                    "is_change": False, "_mask": smoke_mask,
                })

            # ── Baseline comparisons ──────────────────────────────────────────
            if baseline and (tc_bl := baseline.get("true-colour")):
                base_arr = _to_arr(tc_bl["b64"])
                if base_arr is not None and base_arr.shape == tc_arr.shape:
                    baseline_available = True
                    diff3 = np.abs(tc_arr - base_arr)
                    mean_diff = float(np.mean(diff3))
                    threshold = region.get("spectral_change_threshold", 0.12)

                    # General change
                    if mean_diff > threshold * 0.7:
                        change_mask = np.mean(diff3, axis=2) > threshold * 0.75
                        spectral_detections.append({
                            "type": "INFRASTRUCTURE_CHANGE", "category": "infrastructure",
                            "confidence": round(min(mean_diff * 5, 0.90), 3),
                            "is_change": True, "_mask": change_mask,
                        })
                        max_score = max(max_score, mean_diff * 5)

                    # Burn scar
                    burn_mask = (
                        (base_arr[:, :, 0] - tc_arr[:, :, 0] > 0.15) &
                        (base_arr[:, :, 1] - tc_arr[:, :, 1] > 0.10) &
                        (tc_arr[:, :, 0] < 0.30)
                    )
                    if float(np.mean(burn_mask)) > 0.008:
                        spectral_detections.append({
                            "type": "BURN_SCAR", "category": "environmental",
                            "confidence": round(min(float(np.mean(burn_mask)) * 30, 0.9), 3),
                            "is_change": True, "_mask": burn_mask,
                        })

                    # Vegetation loss
                    if (fc_c := current.get("false-colour")) and (fc_b := baseline.get("false-colour")):
                        fc_curr = _to_arr(fc_c["b64"])
                        fc_base = _to_arr(fc_b["b64"])
                        if fc_curr is not None and fc_base is not None and fc_curr.shape == fc_base.shape:
                            eps = 1e-6
                            ndvi_c = (fc_curr[:, :, 0] - fc_curr[:, :, 1]) / (fc_curr[:, :, 0] + fc_curr[:, :, 1] + eps)
                            ndvi_b = (fc_base[:, :, 0] - fc_base[:, :, 1]) / (fc_base[:, :, 0] + fc_base[:, :, 1] + eps)
                            ndvi_loss_mask = (ndvi_b - ndvi_c) > 0.12
                            if float(np.mean(ndvi_loss_mask)) > 0.02:
                                spectral_detections.append({
                                    "type": "VEGETATION_LOSS", "category": "environmental",
                                    "confidence": round(min(float(np.mean(ndvi_loss_mask)) * 10, 0.9), 3),
                                    "is_change": True, "_mask": ndvi_loss_mask,
                                })

                    # Construction (NDBI increase vs baseline)
                    if ndbi_val_global is not None and float(np.mean(ndbi_val_global > 0.1)) > 0.04:
                        con_mask = (ndbi_val_global > 0.08) & land_mask
                        spectral_detections.append({
                            "type": "CONSTRUCTION", "category": "infrastructure",
                            "confidence": 0.60, "is_change": True, "_mask": con_mask,
                        })

            if max_score == 0.0 and spectral_detections:
                max_score = max(d["confidence"] for d in spectral_detections)

            return {
                "spectral_detections": spectral_detections,
                "water_mask":          water_mask,
                "baseline_available":  baseline_available,
                "max_score":           round(max_score, 4),
                "flagged":             bool(spectral_detections),
                "change_types":        list({d["type"] for d in spectral_detections}),
                "scores":              {d["type"]: d["confidence"] for d in spectral_detections},
            }

        except Exception as e:
            print(f"[scanner] spectral_full error: {e}")
            import traceback; traceback.print_exc()
            return {"spectral_detections": [], "water_mask": None, "baseline_available": False,
                    "max_score": 0.0, "flagged": False, "change_types": [], "scores": {}}

    # ── YOLO inference ─────────────────────────────────────────────────────────

    def _run_all_models(self, current: dict, tile: dict, water_mask=None) -> list:
        """Run loaded YOLO models with domain masks. Returns list of detection dicts."""
        if not _loaded_models:
            return []
        detections = []
        tc_data = current.get("true-colour")
        if not tc_data:
            return []
        try:
            import numpy as np
            from PIL import Image
            tc_bytes = base64.b64decode(tc_data["b64"])
            tc_pil   = Image.open(io.BytesIO(tc_bytes)).convert("RGB")
            tc_arr   = np.array(tc_pil)
            h, w     = tc_arr.shape[:2]
            bbox = {
                "min_lon": tile["min_lon"], "min_lat": tile["min_lat"],
                "max_lon": tile["max_lon"], "max_lat": tile["max_lat"],
            }
            land_mask = ~water_mask if water_mask is not None else None
            domain_masks = {
                "vessels":   water_mask,
                "aircraft":  land_mask,
                "oil_tanks": None,
                "defence":   land_mask,
            }
            for model_key, dmask in domain_masks.items():
                model = _loaded_models.get(model_key)
                if model is None:
                    continue
                try:
                    if dmask is not None and dmask.shape == tc_arr.shape[:2]:
                        masked = tc_arr.copy()
                        masked[~dmask] = 0
                        img_in = Image.fromarray(masked.astype(np.uint8))
                    else:
                        img_in = tc_pil
                    results = model.predict(img_in, conf=0.2, verbose=False)
                    for res in results:
                        if not hasattr(res, "boxes") or res.boxes is None:
                            continue
                        for box in res.boxes:
                            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                            conf   = float(box.conf[0])
                            cls_id = int(box.cls[0])
                            cls_name = (res.names or {}).get(cls_id, "unknown")
                            cx = (x1 + x2) / 2; cy = (y1 + y2) / 2
                            cent_lon, cent_lat   = self._bbox_px_to_geo(cx, cy, w, h, bbox)
                            bmin_lon, bmin_lat   = self._bbox_px_to_geo(x1, y1, w, h, bbox)
                            bmax_lon, bmax_lat   = self._bbox_px_to_geo(x2, y2, w, h, bbox)
                            detections.append({
                                "detection_type":   self._yolo_to_det_type(model_key, cls_name),
                                "category":         self._yolo_to_category(model_key),
                                "detection_source": f"yolo_{model_key}",
                                "class_name":       cls_name,
                                "confidence":       round(conf, 3),
                                "centroid_lat":     cent_lat,
                                "centroid_lon":     cent_lon,
                                "bbox_min_lon":     min(bmin_lon, bmax_lon),
                                "bbox_min_lat":     min(bmin_lat, bmax_lat),
                                "bbox_max_lon":     max(bmin_lon, bmax_lon),
                                "bbox_max_lat":     max(bmin_lat, bmax_lat),
                                "is_change":        False,
                            })
                except Exception as me:
                    print(f"[scanner] yolo {model_key}: {me}")
        except Exception as e:
            print(f"[scanner] _run_all_models: {e}")
        return detections

    def _bbox_px_to_geo(self, px: float, py: float, img_w: int, img_h: int, bbox: dict) -> tuple:
        lon = bbox["min_lon"] + (px / img_w) * (bbox["max_lon"] - bbox["min_lon"])
        lat = bbox["max_lat"] - (py / img_h) * (bbox["max_lat"] - bbox["min_lat"])
        return float(lon), float(lat)

    def _yolo_to_det_type(self, model_key: str, cls_name: str) -> str:
        if model_key == "vessels":   return "PORT_CHANGE"
        if model_key == "aircraft":  return "RUNWAY_CHANGE"
        if model_key == "oil_tanks": return "ENERGY_CHANGE"
        if model_key == "defence":   return "MILITARY_ACTIVITY"
        return "INFRASTRUCTURE_CHANGE"

    def _yolo_to_category(self, model_key: str) -> str:
        return {"vessels": "maritime", "aircraft": "aviation",
                "oil_tanks": "energy", "defence": "military"}.get(model_key, "infrastructure")

    def _map_change_type_full(self, spectral_type: str, nearby: list) -> str:
        TYPE_MAP = {
            "FIRE": "FIRE", "SMOKE": "SMOKE", "BURN_SCAR": "BURN_SCAR",
            "VEGETATION_LOSS": "VEGETATION_LOSS", "CONSTRUCTION": "EXCAVATION",
            "CHANGE": "INFRASTRUCTURE_CHANGE",
        }
        if spectral_type in TYPE_MAP:
            return TYPE_MAP[spectral_type]
        if nearby:
            t = nearby[0]["type"]
            if t == "airport": return "RUNWAY_CHANGE"
            if t == "port":    return "PORT_CHANGE"
        return "INFRASTRUCTURE_CHANGE"

    def _spectral_to_category(self, det_type: str) -> str:
        ENV = {"FIRE", "SMOKE", "BURN_SCAR", "VEGETATION_LOSS"}
        if det_type in ENV:           return "environmental"
        if det_type == "RUNWAY_CHANGE": return "aviation"
        if det_type == "PORT_CHANGE":   return "maritime"
        if det_type == "ENERGY_CHANGE": return "energy"
        if det_type in {"MILITARY_ACTIVITY", "VEHICLE_CLUSTER", "UNKNOWN_COMPOUND"}:
            return "military"
        return "infrastructure"

    def _importance(self, confidence: float, has_nearby: bool, has_zone: bool, is_fire: bool) -> int:
        score = round(confidence * 3)
        if is_fire:    score += 2
        if has_zone:   score += 1
        if has_nearby: score += 1
        return min(5, max(1, score))

    # ── Job creation + background launch ──────────────────────────────────────

    async def start_scan(self, region_name: str, db) -> RegionalScanJob:
        region = self.REGIONS.get(region_name.upper())
        if not region:
            raise ValueError(f"Unknown region: {region_name!r}")

        tiles  = self.generate_tiles(region)
        job_id = f"RSCAN-{uuid.uuid4().hex[:6].upper()}"

        job = RegionalScanJob(
            job_id             = job_id,
            region_name        = region_name.upper(),
            status             = "running",
            bbox_min_lon       = region["bbox"]["min_lon"],
            bbox_min_lat       = region["bbox"]["min_lat"],
            bbox_max_lon       = region["bbox"]["max_lon"],
            bbox_max_lat       = region["bbox"]["max_lat"],
            tile_size_deg      = region["tile_size_deg"],
            total_tiles        = len(tiles),
            tiles_complete     = 0,
            tiles_failed       = 0,
            detections_total   = 0,
            current_tile_index = 0,
            cancelled          = False,
            started_at         = datetime.datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        asyncio.create_task(self._process_tiles(job_id, tiles, region))
        print(f"[scanner] {job_id}: started — {len(tiles)} tiles")
        return job

    # ── Background tile loop ───────────────────────────────────────────────────

    async def _process_tiles(self, job_id: str, tiles: list, region: dict):
        db = SessionLocal()
        try:
            for tile in tiles:
                # Cancellation check
                job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()
                if not job or job.cancelled or job.status != "running":
                    if job and job.cancelled:
                        job.status       = "cancelled"
                        job.completed_at = datetime.datetime.utcnow()
                        db.commit()
                    return

                job.current_tile_index = tile["index"]
                db.commit()

                # Process tile
                try:
                    detections = await asyncio.wait_for(
                        self._process_single_tile(tile, region, job_id, db),
                        timeout=75.0,
                    )
                    job.tiles_complete   = (job.tiles_complete or 0) + 1
                    job.detections_total = (job.detections_total or 0) + len(detections)
                    db.commit()

                    # Grab tile image b64 for live rendering (SSE consumers)
                    _tile_img_b64 = None
                    try:
                        _trec = db.query(RegionalScanTile).filter_by(
                            job_id=job_id, tile_index=tile["index"]
                        ).first()
                        if _trec:
                            _tile_img_b64 = _trec.image_b64
                    except Exception:
                        pass

                    self._emit("scan_progress", {
                        "job_id":           job_id,
                        "tile_index":       tile["index"],
                        "total_tiles":      len(tiles),
                        "tiles_complete":   job.tiles_complete,
                        "pct":              round(job.tiles_complete / len(tiles) * 100),
                        "tile_image_b64":   _tile_img_b64,
                        "tile_bbox": {
                            "min_lon": tile["min_lon"],
                            "min_lat": tile["min_lat"],
                            "max_lon": tile["max_lon"],
                            "max_lat": tile["max_lat"],
                        },
                        "new_detections": [
                            {
                                "detection_id":   d.detection_id,
                                "detection_type": d.detection_type,
                                "confidence":     d.confidence,
                                "lat":            d.centroid_lat,
                                "lon":            d.centroid_lon,
                                "severity":       d.claude_severity or "medium",
                                "bbox": {
                                    "min_lon": d.bbox_min_lon,
                                    "min_lat": d.bbox_min_lat,
                                    "max_lon": d.bbox_max_lon,
                                    "max_lat": d.bbox_max_lat,
                                },
                                "category":  d.category,
                                "importance": d.importance,
                            }
                            for d in detections
                        ],
                    })

                except asyncio.TimeoutError:
                    print(f"[scanner] tile {tile['index']} timed out")
                    job.tiles_failed = (job.tiles_failed or 0) + 1
                    db.commit()
                except Exception as e:
                    print(f"[scanner] tile {tile['index']} error: {e}")
                    job.tiles_failed = (job.tiles_failed or 0) + 1
                    db.commit()

                await asyncio.sleep(0.5)

            # All tiles complete
            job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()
            if job and not job.cancelled:
                job.status       = "complete"
                job.completed_at = datetime.datetime.utcnow()
                db.commit()
                await self._generate_report(job_id, db)

                job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()
                self._emit("scan_complete", {
                    "job_id":           job_id,
                    "region":           job.region_name if job else "UAE",
                    "total_detections": job.detections_total if job else 0,
                    "tiles_complete":   job.tiles_complete if job else len(tiles),
                    "summary":          job.report_summary if job else None,
                })

        except Exception as e:
            print(f"[scanner] {job_id} fatal: {e}")
            import traceback; traceback.print_exc()
            try:
                job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()
                if job:
                    job.status        = "failed"
                    job.error_message = str(e)[:500]
                    job.completed_at  = datetime.datetime.utcnow()
                    db.commit()
            except Exception:
                pass
        finally:
            db.close()

    # ── Single tile pipeline ───────────────────────────────────────────────────

    async def _process_single_tile(
        self, tile: dict, region: dict, job_id: str, db
    ) -> list[RegionalScanDetection]:
        loop = asyncio.get_running_loop()
        tile_lat = (tile["min_lat"] + tile["max_lat"]) / 2
        tile_lon = (tile["min_lon"] + tile["max_lon"]) / 2
        tile_id  = f"RTILE-{uuid.uuid4().hex[:6].upper()}"

        # 1. Fetch all band combinations
        current, baseline = await self._fetch_tile_multiband(tile, region)

        # Persist tile record
        tile_row = RegionalScanTile(
            tile_id     = tile_id,
            job_id      = job_id,
            tile_index  = tile["index"],
            min_lon     = tile["min_lon"],
            min_lat     = tile["min_lat"],
            max_lon     = tile["max_lon"],
            max_lat     = tile["max_lat"],
            status      = "fetched" if current else "failed",
            image_b64   = current.get("true-colour", {}).get("b64") if current else None,
            image_date  = current.get("true-colour", {}).get("date") if current else None,
        )
        try:
            db.add(tile_row)
            db.commit()
        except Exception as _te:
            db.rollback()
            print(f"[scanner] tile_row persist error: {_te}")

        if not current:
            return []

        # 2. Full spectral analysis (CPU-bound numpy — run in executor)
        spectral = await loop.run_in_executor(
            None, lambda: self._analyse_spectral_full(current, baseline, region)
        )

        # 3. YOLO inference (CPU-bound)
        water_mask = spectral.get("water_mask")
        yolo_dets  = await loop.run_in_executor(
            None, lambda: self._run_all_models(current, tile, water_mask)
        )

        if not spectral["flagged"] and not yolo_dets:
            return []

        # 4. Context (needed for importance scoring + Claude Vision)
        nearby  = await loop.run_in_executor(None, lambda: self._get_nearby_assets(tile_lat, tile_lon, 10, db))
        zone_id = await loop.run_in_executor(None, lambda: self._get_containing_zone(tile_lat, tile_lon, db))

        detections: list[RegionalScanDetection] = []
        tile_bbox = {
            "min_lon": tile["min_lon"], "min_lat": tile["min_lat"],
            "max_lon": tile["max_lon"], "max_lat": tile["max_lat"],
        }

        # ── Claude Vision: one call per unique high-confidence spectral type ──────
        # Only for fire/smoke/burn — expensive to call for every bbox
        vision_cache: dict[str, dict] = {}
        for sd in spectral["spectral_detections"]:
            dt = sd["type"]
            is_fire = dt in ("FIRE", "SMOKE", "BURN_SCAR")
            if is_fire and sd["confidence"] > 0.45 and dt not in vision_cache:
                try:
                    vis = await self._claude_vision(
                        current.get("true-colour", {}), tile, dt, nearby, zone_id
                    )
                    vision_cache[dt] = vis
                except Exception as ve:
                    print(f"[scanner] vision tile {tile['index']}: {ve}")

        # 5. Spectral detections — expand mask to sub-tile geo bboxes
        MAX_BOXES = {"FIRE": 5, "SMOKE": 5, "BURN_SCAR": 5, "VEGETATION_LOSS": 8,
                     "WATER_BODY": 10, "VEGETATION": 15, "INFRASTRUCTURE_CHANGE": 20,
                     "CONSTRUCTION": 15}
        for sd in spectral["spectral_detections"]:
            mask = sd.pop("_mask", None)
            det_type   = sd["type"]
            confidence = sd["confidence"]
            is_change  = sd["is_change"]
            category   = sd.get("category") or self._spectral_to_category(det_type)
            is_fire    = det_type in ("FIRE", "SMOKE", "BURN_SCAR")
            importance = self._importance(confidence, bool(nearby), bool(zone_id), is_fire)

            vis_result     = vision_cache.get(det_type, {})
            claude_analysis = vis_result.get("description")
            claude_severity = vis_result.get("severity", "info" if not is_fire else "medium")

            # Expand mask to sub-tile bboxes; fall back to tile-wide if mask unavailable
            if mask is not None:
                bboxes = self._mask_to_geo_bboxes(
                    mask, tile_bbox,
                    min_pixels=4,
                    max_boxes=MAX_BOXES.get(det_type, 10),
                )
            else:
                bboxes = []
            if not bboxes:
                bboxes = [{
                    "min_lon": tile_bbox["min_lon"], "min_lat": tile_bbox["min_lat"],
                    "max_lon": tile_bbox["max_lon"], "max_lat": tile_bbox["max_lat"],
                    "centroid_lon": tile_lon, "centroid_lat": tile_lat, "pixel_count": 1,
                }]

            for bbox in bboxes:
                det = RegionalScanDetection(
                    detection_id              = f"RDET-{uuid.uuid4().hex[:6].upper()}",
                    job_id                    = job_id,
                    tile_index                = tile["index"],
                    region_name               = "UAE",
                    detection_type            = det_type,
                    confidence                = confidence,
                    centroid_lat              = bbox["centroid_lat"],
                    centroid_lon              = bbox["centroid_lon"],
                    bbox_min_lon              = bbox["min_lon"],
                    bbox_min_lat              = bbox["min_lat"],
                    bbox_max_lon              = bbox["max_lon"],
                    bbox_max_lat              = bbox["max_lat"],
                    spectral_change_score     = round(spectral["max_score"], 4),
                    change_type               = "FIRE" if is_fire else ("CHANGED" if is_change else "DETECTED"),
                    nearest_asset_name        = nearby[0]["name"]           if nearby else None,
                    nearest_asset_type        = nearby[0]["type"]           if nearby else None,
                    nearest_asset_distance_km = round(nearby[0]["distance_km"], 2) if nearby else None,
                    in_strategic_zone         = zone_id,
                    claude_vision_analysis    = claude_analysis,
                    claude_severity           = claude_severity,
                    category                  = category,
                    importance                = importance,
                    detection_source          = "spectral",
                    is_change                 = is_change,
                    baseline_available        = spectral.get("baseline_available", False),
                    created_at                = datetime.datetime.utcnow(),
                )
                db.add(det)
                detections.append(det)

        # 6. YOLO detections
        for yd in yolo_dets:
            importance = self._importance(yd["confidence"], bool(nearby), bool(zone_id), False)
            det = RegionalScanDetection(
                detection_id              = f"RDET-{uuid.uuid4().hex[:6].upper()}",
                job_id                    = job_id,
                tile_index                = tile["index"],
                region_name               = "UAE",
                detection_type            = yd["detection_type"],
                confidence                = yd["confidence"],
                centroid_lat              = yd["centroid_lat"],
                centroid_lon              = yd["centroid_lon"],
                bbox_min_lon              = yd["bbox_min_lon"],
                bbox_min_lat              = yd["bbox_min_lat"],
                bbox_max_lon              = yd["bbox_max_lon"],
                bbox_max_lat              = yd["bbox_max_lat"],
                spectral_change_score     = 0.0,
                change_type               = "DETECTED",
                nearest_asset_name        = nearby[0]["name"]           if nearby else None,
                nearest_asset_type        = nearby[0]["type"]           if nearby else None,
                nearest_asset_distance_km = round(nearby[0]["distance_km"], 2) if nearby else None,
                in_strategic_zone         = zone_id,
                category                  = yd["category"],
                importance                = importance,
                detection_source          = yd["detection_source"],
                class_name                = yd["class_name"],
                is_change                 = False,
                baseline_available        = spectral.get("baseline_available", False),
                created_at                = datetime.datetime.utcnow(),
            )
            db.add(det)
            detections.append(det)

        try:
            tile_row.detections_count = len(detections)
            db.commit()
        except Exception as _ce:
            db.rollback()
            print(f"[scanner] detections commit error: {_ce}")
        return detections

    # ── Spectral analysis ──────────────────────────────────────────────────────

    def _analyse_spectral(self, current: dict, baseline: Optional[dict], region: dict) -> dict:
        try:
            import numpy as np
            from PIL import Image

            if not current or not current.get("b64"):
                return {"flagged": False, "change_types": [], "scores": {}, "max_score": 0.0}

            img_bytes = base64.b64decode(current["b64"])
            curr = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"), dtype=float) / 255.0
            r, g, b = curr[:, :, 0], curr[:, :, 1], curr[:, :, 2]

            change_types: list[str] = []
            scores: dict[str, float] = {}

            # Fire: high red, low green/blue
            fire_mask  = (r > 0.72) & (g < 0.35) & (b < 0.25)
            fire_score = float(np.mean(fire_mask))
            if fire_score > 0.008:
                change_types.append("FIRE")
                scores["FIRE"] = min(fire_score * 60, 1.0)

            # Smoke: near-grey mid-brightness
            smoke_mask  = (np.abs(r - g) < 0.08) & (np.abs(g - b) < 0.08) & (r > 0.45) & (r < 0.75)
            smoke_score = float(np.mean(smoke_mask))
            if smoke_score > 0.06:
                change_types.append("SMOKE")
                scores["SMOKE"] = min(smoke_score * 10, 1.0)

            # Change vs baseline
            if baseline and baseline.get("b64"):
                base_bytes = base64.b64decode(baseline["b64"])
                base_arr   = np.array(Image.open(io.BytesIO(base_bytes)).convert("RGB"), dtype=float) / 255.0
                if base_arr.shape == curr.shape:
                    diff      = np.abs(curr - base_arr)
                    mean_diff = float(np.mean(diff))
                    threshold = region.get("spectral_change_threshold", 0.12)
                    if mean_diff > threshold:
                        change_types.append("CHANGE")
                        scores["CHANGE"] = min(mean_diff * 5, 1.0)

                    burn_mask  = (base_arr[:, :, 0] - r > 0.18) & (base_arr[:, :, 1] - g > 0.12) & (r < 0.25)
                    burn_score = float(np.mean(burn_mask))
                    if burn_score > 0.015:
                        change_types.append("BURN_SCAR")
                        scores["BURN_SCAR"] = min(burn_score * 30, 1.0)

            max_score = max(scores.values()) if scores else 0.0
            return {"flagged": bool(change_types), "change_types": change_types,
                    "scores": scores, "max_score": max_score}

        except Exception as e:
            print(f"[scanner] spectral error: {e}")
            return {"flagged": False, "change_types": [], "scores": {}, "max_score": 0.0}

    # ── Claude Vision ──────────────────────────────────────────────────────────

    async def _claude_vision(
        self, image: dict, tile: dict, det_type: str,
        nearby: list, zone_id: Optional[str],
    ) -> dict:
        loop = asyncio.get_event_loop()
        asset_ctx = (
            f"Nearest: {nearby[0]['name']} ({nearby[0]['type']}, {nearby[0]['distance_km']:.1f}km)"
            if nearby else "No known assets nearby"
        )

        def _call():
            client = anthropic.Anthropic()
            resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type":       "base64",
                                "media_type": "image/png",
                                "data":       image["b64"],
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Satellite image from UAE "
                                f"({tile['min_lat']:.2f}N,{tile['min_lon']:.2f}E – "
                                f"{tile['max_lat']:.2f}N,{tile['max_lon']:.2f}E).\n"
                                f"Detection: {det_type}\n{asset_ctx}\n"
                                f"Zone: {zone_id or 'None'}\n\n"
                                "Describe what you observe in 2 sentences. "
                                "Return JSON only:\n"
                                '{"description": "...", "severity": "info|medium|high|critical"}'
                            ),
                        },
                    ],
                }],
            )
            text  = resp.content[0].text
            match = re.search(r'\{.*\}', text, re.DOTALL)
            return json.loads(match.group()) if match else {"description": text[:200], "severity": "medium"}

        return await loop.run_in_executor(None, _call)

    # ── Asset / zone lookup ────────────────────────────────────────────────────

    def _get_nearby_assets(self, lat: float, lon: float, radius_km: float, db) -> list:
        deg    = radius_km / 111.32
        assets = []
        try:
            for a in db.query(Airport).filter(
                Airport.latitude.between(lat - deg, lat + deg),
                Airport.longitude.between(lon - deg, lon + deg),
            ).limit(5).all():
                assets.append({
                    "type": "airport", "name": a.airport_name,
                    "distance_km": math.hypot(lat - a.latitude, lon - a.longitude) * 111.32,
                })
        except Exception:
            pass
        try:
            for p in db.query(PortBoundary).filter(
                PortBoundary.latitude.between(lat - deg, lat + deg),
                PortBoundary.longitude.between(lon - deg, lon + deg),
            ).limit(5).all():
                assets.append({
                    "type": "port", "name": p.port_name,
                    "distance_km": math.hypot(lat - p.latitude, lon - p.longitude) * 111.32,
                })
        except Exception:
            pass
        return sorted(assets, key=lambda x: x["distance_km"])

    def _get_containing_zone(self, lat: float, lon: float, db) -> Optional[str]:
        try:
            from shapely.geometry import Point, shape
            pt = Point(lon, lat)
            for z in db.query(StrategicZone).filter_by(enabled=True).all():
                try:
                    if shape(json.loads(z.polygon_geojson)).contains(pt):
                        return z.zone_id
                except Exception:
                    pass
        except ImportError:
            pass
        return None

    def _map_change_type(self, spectral_type: str, nearby: list) -> str:
        if spectral_type == "FIRE":      return "FIRE"
        if spectral_type == "SMOKE":     return "SMOKE"
        if spectral_type == "BURN_SCAR": return "BURN_SCAR"
        if nearby:
            t = nearby[0]["type"]
            if t == "airport": return "RUNWAY_CHANGE"
            if t == "port":    return "PORT_CHANGE"
        return "INFRASTRUCTURE_CHANGE"

    # ── Opus report ────────────────────────────────────────────────────────────

    async def _generate_report(self, job_id: str, db):
        dets = (
            db.query(RegionalScanDetection)
            .filter_by(job_id=job_id, suppressed=False)
            .all()
        )
        job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()

        if not dets or not job:
            if job:
                job.report_summary = "No significant changes detected."
                job.claude_report  = "No significant changes detected in this scan cycle."
                db.commit()
            return

        det_rows = [{
            "type":        d.detection_type,
            "confidence":  round(d.confidence, 2),
            "lat":         d.centroid_lat,
            "lon":         d.centroid_lon,
            "asset":       d.nearest_asset_name,
            "zone":        d.in_strategic_zone,
            "analysis":    d.claude_vision_analysis or "",
            "severity":    d.claude_severity,
        } for d in dets[:40]]

        loop = asyncio.get_event_loop()

        def _run():
            client = anthropic.Anthropic()
            report = client.messages.create(
                model="claude-opus-4-7",
                max_tokens=2000,
                messages=[{"role": "user", "content": (
                    f"Intelligence report: UAE regional satellite scan.\n"
                    f"{len(dets)} detections found.\n\n"
                    f"Detections:\n{json.dumps(det_rows, indent=2)}\n\n"
                    "Write a structured report with sections:\n"
                    "EXECUTIVE SUMMARY, CRITICAL FINDINGS, INFRASTRUCTURE CHANGES, "
                    "FIRE/ENVIRONMENTAL, UNKNOWN STRUCTURES, ASSESSMENT.\n"
                    "Be specific about coordinates and asset names."
                )}],
            ).content[0].text

            summary = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=100,
                messages=[{"role": "user", "content": f"One sentence (max 25 words):\n{report[:1000]}"}],
            ).content[0].text

            return report, summary

        try:
            report, summary = await loop.run_in_executor(None, _run)
            job.claude_report  = report
            job.report_summary = summary
            db.commit()
            print(f"[scanner] {job_id}: report generated")
        except Exception as e:
            print(f"[scanner] {job_id}: report error: {e}")

    # ── SSE emit helper ────────────────────────────────────────────────────────

    def _emit(self, event_type: str, payload: dict):
        if sse_push_fn:
            try:
                sse_push_fn({"event": event_type, "payload": payload})
            except Exception:
                pass


# ── Module singleton ───────────────────────────────────────────────────────────
tile_scanner = TileByTileScanner()
