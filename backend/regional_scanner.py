"""regional_scanner.py — Tile-by-tile UAE satellite scan.

Pipeline per tile:
  1. Fetch true-colour Sentinel-2 imagery → globe overlay
  2. Run Overwatch DOTA ONNX YOLO on imagery → object detections
  3. Run SWIR fire detection (same sentinel_ml path as Overwatch)
  4. Run change detection if baseline exists AND near strategic asset
  5. Emit imagery immediately via SSE; emit detections after processing

At completion: Claude Opus intelligence report.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
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

# Set from main.py at startup — pushes SSE events to connected clients
sse_push_fn: Optional[Callable] = None


# ── Sentinel-2 tile fetch (sync, runs in thread pool) ────────────────────────

def _fetch_tile_sync(
    west: float, south: float, east: float, north: float,
    max_age_days: int = 10,
    min_age_days: int = 0,
    max_cloud: int = 30,
    width: int = 512,
    height: int = 512,
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

        now    = datetime.datetime.utcnow()
        t_to   = now - datetime.timedelta(days=min_age_days)
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
        with urllib.request.urlopen(req, timeout=30) as r:
            if r.status == 200:
                raw = r.read()
                if len(raw) > 1000:
                    return {"b64": base64.b64encode(raw).decode(), "date": t_to}
        return None
    except Exception as e:
        print(f"[scanner] tile fetch error ({west:.2f},{south:.2f},{band_key}): {e}")
        return None


# ── DOTA class → detection type mapping ──────────────────────────────────────

_DOTA_CLASS_MAP: dict[str, tuple[str, str, int]] = {
    # (detection_type, category, base_importance)
    "ship":               ("PORT_CHANGE",          "maritime",       4),
    "large-vehicle":      ("VEHICLE_CLUSTER",       "military",       3),
    "small-vehicle":      ("VEHICLE_CLUSTER",       "infrastructure", 1),
    "vehicle":            ("VEHICLE_CLUSTER",       "military",       2),
    "plane":              ("RUNWAY_CHANGE",         "aviation",       4),
    "helicopter":         ("RUNWAY_CHANGE",         "aviation",       4),
    "aircraft":           ("RUNWAY_CHANGE",         "aviation",       4),
    "storage-tank":       ("ENERGY_CHANGE",         "energy",         3),
    "harbor":             ("PORT_CHANGE",           "maritime",       3),
    "bridge":             ("INFRASTRUCTURE_CHANGE", "infrastructure", 2),
    "roundabout":         ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "ground-track-field": ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "swimming-pool":      ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "basketball-court":   ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "soccer-ball-field":  ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "tennis-court":       ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
    "baseball-diamond":   ("INFRASTRUCTURE_CHANGE", "infrastructure", 1),
}


# ── TileByTileScanner ─────────────────────────────────────────────────────────

class TileByTileScanner:

    UAE_REGION = {
        "name":                      "UAE",
        "bbox":                      {"min_lon": 51.5, "min_lat": 22.5, "max_lon": 56.5, "max_lat": 26.2},
        "tile_size_deg":             0.1,
        "max_cloud_cover":           30,
        "spectral_change_threshold": 0.12,
        "scan_interval_days":        5,
    }

    REGIONS = {"UAE": UAE_REGION}

    # ── Tile generation ────────────────────────────────────────────────────────

    def generate_tiles(self, region: dict) -> list:
        bbox  = region["bbox"]
        size  = region["tile_size_deg"]
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
                job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()
                if not job or job.cancelled or job.status != "running":
                    if job and job.cancelled:
                        job.status       = "cancelled"
                        job.completed_at = datetime.datetime.utcnow()
                        db.commit()
                    return

                job.current_tile_index = tile["index"]
                db.commit()

                try:
                    detections = await asyncio.wait_for(
                        self._process_single_tile(tile, region, job_id, db),
                        timeout=90.0,
                    )
                    job.tiles_complete   = (job.tiles_complete or 0) + 1
                    job.detections_total = (job.detections_total or 0) + len(detections)
                    db.commit()

                    self._emit("scan_progress", {
                        "job_id":         job_id,
                        "tile_index":     tile["index"],
                        "total_tiles":    len(tiles),
                        "tiles_complete": job.tiles_complete,
                        "pct":            round(job.tiles_complete / len(tiles) * 100),
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
                    import traceback; traceback.print_exc()
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
    ) -> list:
        loop     = asyncio.get_running_loop()
        tile_lat = (tile["min_lat"] + tile["max_lat"]) / 2
        tile_lon = (tile["min_lon"] + tile["max_lon"]) / 2
        tile_id  = f"RTILE-{uuid.uuid4().hex[:6].upper()}"
        detections: list[RegionalScanDetection] = []

        # ── PHASE A: Concurrent fetch — ESRI (YOLO) + Sentinel (globe) ─────────
        (esri_pil, esri_w, esri_h), tc_result = await asyncio.gather(
            loop.run_in_executor(None, lambda: self._fetch_esri_image(tile)),
            loop.run_in_executor(None, lambda: _fetch_tile_sync(
                tile["min_lon"], tile["min_lat"],
                tile["max_lon"], tile["max_lat"],
                max_age_days=10, band_key="true-colour",
            )),
        )

        if not tc_result:
            print(f"[scanner] Tile {tile['index']}: no Sentinel imagery, skipping")
            return []

        tc_b64 = tc_result["b64"]

        # ── PHASE B: Store tile record + emit Sentinel imagery for globe ────────
        tile_row = RegionalScanTile(
            tile_id          = tile_id,
            job_id           = job_id,
            tile_index       = tile["index"],
            min_lon          = tile["min_lon"],
            min_lat          = tile["min_lat"],
            max_lon          = tile["max_lon"],
            max_lat          = tile["max_lat"],
            status           = "fetched",
            image_b64        = tc_b64,
            image_date       = tc_result["date"],
            detections_count = 0,
        )
        try:
            db.add(tile_row)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[scanner] tile record error: {e}")

        self._emit("scan_tile_image", {
            "job_id":         job_id,
            "tile_index":     tile["index"],
            "tile_bbox":      {
                "min_lon": tile["min_lon"], "min_lat": tile["min_lat"],
                "max_lon": tile["max_lon"], "max_lat": tile["max_lat"],
            },
            "tile_image_b64": tc_b64,
        })

        # Context for importance scoring
        nearby  = await loop.run_in_executor(None, lambda: self._get_nearby_assets(tile_lat, tile_lon, 10, db))
        zone_id = await loop.run_in_executor(None, lambda: self._get_containing_zone(tile_lat, tile_lon, db))

        # ── PHASE C: YOLO on ESRI imagery (native resolution, pixel-space bbox) ─
        yolo_count = 0
        if esri_pil and esri_w > 0 and esri_h > 0:
            try:
                yolo_raw = await loop.run_in_executor(
                    None, lambda: self._run_yolo_detection(esri_pil, tile)
                )
                for raw in yolo_raw:
                    det_type, category, _ = self._dota_to_det(raw.get("class_name", ""))
                    conf = float(raw.get("confidence", 0.5))
                    if raw.get("bbox_px"):
                        geo = self._px_to_geo(raw["bbox_px"], tile, esri_w, esri_h)
                    else:
                        geo = raw.get("_geo") or {
                            "min_lon": tile_lon - 0.005, "max_lon": tile_lon + 0.005,
                            "min_lat": tile_lat - 0.005, "max_lat": tile_lat + 0.005,
                            "centroid_lon": tile_lon, "centroid_lat": tile_lat,
                        }
                    det = self._make_det(
                        job_id=job_id, tile=tile, tile_id=tile_id,
                        det_type=det_type, category=category,
                        importance=self._importance(conf, bool(nearby), bool(zone_id), False),
                        confidence=conf,
                        geo=geo, class_name=raw.get("class_name", "object"),
                        source="yolo_dota_esri",
                        nearby=nearby, zone_id=zone_id,
                        is_change=False,
                    )
                    db.add(det)
                    detections.append(det)
                    yolo_count += 1
            except Exception as e:
                print(f"[scanner] Tile {tile['index']} YOLO error: {e}")

        # ── PHASE D: SWIR fire detection ───────────────────────────────────────
        fire_count = 0
        try:
            fire_raw = await loop.run_in_executor(
                None, lambda: self._run_swir_sync(tile)
            )
            for fd in fire_raw:
                conf = float(fd.get("confidence", 0.7))
                geo  = self._parse_overwatch_geo(fd, tile)
                det  = self._make_det(
                    job_id=job_id, tile=tile, tile_id=tile_id,
                    det_type="FIRE", category="environmental",
                    importance=self._importance(conf, bool(nearby), bool(zone_id), True),
                    confidence=conf,
                    geo=geo, class_name="fire",
                    source="swir_spectral",
                    nearby=nearby, zone_id=zone_id,
                    is_change=False,
                )
                db.add(det)
                detections.append(det)
                fire_count += 1
        except Exception as e:
            print(f"[scanner] Tile {tile['index']} SWIR error: {e}")

        # ── PHASE E: Change detection (only if baseline + near strategic asset) ─
        change_count = 0
        if nearby or zone_id:
            has_bl = await loop.run_in_executor(None, lambda: self._has_baseline(tile, db))
            if has_bl:
                try:
                    change_dets = await loop.run_in_executor(
                        None, lambda: self._detect_changes_sync(tile, tc_b64, db)
                    )
                    for cd in change_dets:
                        conf = float(cd["confidence"])
                        det  = self._make_det(
                            job_id=job_id, tile=tile, tile_id=tile_id,
                            det_type="INFRASTRUCTURE_CHANGE", category="infrastructure",
                            importance=self._importance(conf, bool(nearby), bool(zone_id), False),
                            confidence=conf,
                            geo=cd["geo"], class_name="change",
                            source="change_detection",
                            nearby=nearby, zone_id=zone_id,
                            is_change=True,
                        )
                        db.add(det)
                        detections.append(det)
                        change_count += 1
                except Exception as e:
                    print(f"[scanner] Tile {tile['index']} change detection error: {e}")

        # ── PHASE F: Claude Vision on fire detections ─────────────────────────
        fire_dets = [d for d in detections if d.detection_type == "FIRE"]
        if fire_dets:
            try:
                vis = await self._claude_vision({"b64": tc_b64}, tile, "FIRE", nearby, zone_id)
                for fd in fire_dets:
                    fd.claude_vision_analysis = vis.get("description")
                    fd.claude_severity        = vis.get("severity", "high")
            except Exception as e:
                print(f"[scanner] Tile {tile['index']} Vision error: {e}")

        # ── PHASE G: Commit + emit tile-complete event ─────────────────────────
        try:
            tile_row.detections_count = len(detections)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[scanner] commit error: {e}")

        self._emit("scan_tile_complete", {
            "job_id":          job_id,
            "tile_index":      tile["index"],
            "tile_bbox": {
                "min_lon": tile["min_lon"], "min_lat": tile["min_lat"],
                "max_lon": tile["max_lon"], "max_lat": tile["max_lat"],
            },
            "detection_count": len(detections),
            "detections": [
                {
                    "detection_id": d.detection_id,
                    "type":         d.detection_type,
                    "category":     d.category,
                    "importance":   d.importance,
                    "confidence":   d.confidence,
                    "centroid_lat": d.centroid_lat,
                    "centroid_lon": d.centroid_lon,
                    "bbox": {
                        "min_lon": d.bbox_min_lon, "min_lat": d.bbox_min_lat,
                        "max_lon": d.bbox_max_lon, "max_lat": d.bbox_max_lat,
                    },
                }
                for d in detections
            ],
        })

        print(
            f"[scanner] Tile {tile['index']}: "
            f"{len(detections)} detections "
            f"({yolo_count} YOLO/ESRI, {fire_count} fire, {change_count} changes)"
        )
        return detections

    # ── ESRI tile fetch + stitch ───────────────────────────────────────────────

    def _fetch_esri_image(self, tile: dict, zoom: int = 15):
        """Fetch ESRI World Imagery sub-tiles covering tile bbox, stitch to PIL.
        Returns (pil_image, width_px, height_px) or (None, 0, 0).
        Native resolution — no resize. Recurses with zoom-1 if > 200 sub-tiles.
        """
        def _deg2tile(lat_deg, lon_deg, z):
            n = 2 ** z
            lat_rad = math.radians(lat_deg)
            x = int((lon_deg + 180.0) / 360.0 * n)
            y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
            return x, y

        x_min, y_min = _deg2tile(tile["max_lat"], tile["min_lon"], zoom)  # top-left
        x_max, y_max = _deg2tile(tile["min_lat"], tile["max_lon"], zoom)  # bottom-right
        n_x = x_max - x_min + 1
        n_y = y_max - y_min + 1

        if n_x * n_y > 200:
            if zoom <= 8:
                return None, 0, 0
            return self._fetch_esri_image(tile, zoom - 1)
        if n_x <= 0 or n_y <= 0:
            return None, 0, 0

        try:
            from main import _fetch_esri_tile
            from PIL import Image as _PILImage
        except ImportError as e:
            print(f"[scanner] _fetch_esri_image import: {e}")
            return None, 0, 0

        coords = [(x, y) for y in range(y_min, y_max + 1) for x in range(x_min, x_max + 1)]
        tile_imgs: dict = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            futs = {pool.submit(_fetch_esri_tile, zoom, x, y): (x, y) for x, y in coords}
            for fut in concurrent.futures.as_completed(futs):
                xy = futs[fut]
                try:
                    img = fut.result(timeout=15)
                    if img:
                        tile_imgs[xy] = img
                except Exception:
                    pass

        if not tile_imgs:
            return None, 0, 0

        out_w, out_h = n_x * 256, n_y * 256
        canvas = _PILImage.new("RGB", (out_w, out_h))
        for (x, y), img in tile_imgs.items():
            canvas.paste(img.convert("RGB"), ((x - x_min) * 256, (y - y_min) * 256))

        return canvas, out_w, out_h

    # ── YOLO via Overwatch ONNX model (ESRI imagery, pixel-space bbox) ─────────

    def _run_yolo_detection(self, pil_img, tile: dict, conf_threshold: float = 0.20) -> list:
        """Run DOTA ONNX on ESRI PIL image with keep_px=True for pixel-space bboxes.
        Returns [{class_name, confidence, bbox_px: {x1,y1,x2,y2}, _geo}].
        """
        try:
            from main import _run_inference_on_image
            bounds = {
                "north": tile["max_lat"], "south": tile["min_lat"],
                "east":  tile["max_lon"], "west":  tile["min_lon"],
            }
            result = _run_inference_on_image(
                pil_img, bounds, confidence=conf_threshold,
                model_key="dota", keep_px=True,
            )
            if result.get("error"):
                print(f"[scanner] YOLO (tile {tile['index']}): {result['error']}")
                return []
            out = []
            for det in result.get("detections", []):
                px = det.get("_px")
                if px and len(px) >= 4:
                    out.append({
                        "class_name": det.get("class", "unknown"),
                        "confidence": float(det.get("confidence", 0.5)),
                        "bbox_px":    {"x1": int(px[0]), "y1": int(px[1]), "x2": int(px[2]), "y2": int(px[3])},
                        "_geo":       None,
                    })
                else:
                    out.append({
                        "class_name": det.get("class", "unknown"),
                        "confidence": float(det.get("confidence", 0.5)),
                        "bbox_px":    None,
                        "_geo":       self._corners_to_geo(det, tile),
                    })
            return out
        except Exception as e:
            print(f"[scanner] _run_yolo_detection: {e}")
            return []

    def _px_to_geo(self, bbox_px: dict, tile: dict, img_w: int, img_h: int) -> dict:
        """Map pixel bbox at native image resolution to geographic coordinates."""
        x1, y1, x2, y2 = bbox_px["x1"], bbox_px["y1"], bbox_px["x2"], bbox_px["y2"]
        lon_range = tile["max_lon"] - tile["min_lon"]
        lat_range = tile["max_lat"] - tile["min_lat"]
        min_lon = tile["min_lon"] + (x1 / img_w) * lon_range
        max_lon = tile["min_lon"] + (x2 / img_w) * lon_range
        max_lat = tile["max_lat"] - (y1 / img_h) * lat_range
        min_lat = tile["max_lat"] - (y2 / img_h) * lat_range
        return {
            "min_lon":      min_lon, "max_lon":      max_lon,
            "min_lat":      min_lat, "max_lat":      max_lat,
            "centroid_lon": (min_lon + max_lon) / 2,
            "centroid_lat": (min_lat + max_lat) / 2,
        }

    # ── SWIR fire detection (same path as Overwatch) ──────────────────────────

    def _run_swir_sync(self, tile: dict) -> list:
        """Fetch Sentinel SWIR+NIR and run sentinel_ml fire detection.
        Returns list of SentinelDetection schema dicts with centroid_lat/lon + geo_geometry.
        """
        try:
            from sentinel_scanner import _fetch_sentinel_image, _bytes_to_pil
            from sentinel_ml import run_fire_detection
        except ImportError as e:
            print(f"[scanner] SWIR import error: {e}")
            return []

        w = tile["min_lon"]; s = tile["min_lat"]
        e = tile["max_lon"]; n = tile["max_lat"]
        bbox = {"min_lon": w, "min_lat": s, "max_lon": e, "max_lat": n}

        img_w = min(1024, max(256, int(abs(e - w) * 11100)))
        img_h = min(1024, max(256, int(abs(n - s) * 11100)))

        swir_b   = _fetch_sentinel_image(w, s, e, n, "swir",         max_cloud=30, days_back=10, width=img_w, height=img_h)
        swir_pil = _bytes_to_pil(swir_b)
        if swir_pil is None:
            return []

        nir_b   = _fetch_sentinel_image(w, s, e, n, "false-colour", max_cloud=30, days_back=10, width=img_w, height=img_h)
        nir_pil = _bytes_to_pil(nir_b)

        try:
            return run_fire_detection({"swir": swir_pil, "nir": nir_pil}, bbox)
        except Exception as ex:
            print(f"[scanner] run_fire_detection error: {ex}")
            return []

    # ── Change detection vs stored baseline ───────────────────────────────────

    def _detect_changes_sync(self, tile: dict, current_b64: str, db) -> list:
        """Compare current tile image to most recent previous scan at same location.
        Returns list of {"confidence": float, "geo": bbox_dict}.
        Only called when _has_baseline() is True.
        """
        try:
            import numpy as np
            from PIL import Image
            import scipy.ndimage as ndi
        except ImportError:
            return []

        # Get previous tile (offset(1) skips the one just inserted)
        prev = (
            db.query(RegionalScanTile)
            .filter(
                RegionalScanTile.min_lon.between(tile["min_lon"] - 0.001, tile["min_lon"] + 0.001),
                RegionalScanTile.min_lat.between(tile["min_lat"] - 0.001, tile["min_lat"] + 0.001),
                RegionalScanTile.image_b64.isnot(None),
            )
            .order_by(RegionalScanTile.id.desc())
            .offset(1)
            .first()
        )
        if not prev or not prev.image_b64:
            return []

        SIZE = 256

        def _decode(b64: str):
            raw = base64.b64decode(b64)
            return np.array(
                Image.open(io.BytesIO(raw)).convert("RGB").resize((SIZE, SIZE)),
                dtype=np.float32,
            ) / 255.0

        try:
            curr_arr = _decode(current_b64)
            base_arr = _decode(prev.image_b64)
        except Exception:
            return []

        diff = np.abs(curr_arr - base_arr).mean(axis=2)
        change_mask = diff > 0.15

        labeled, n_blobs = ndi.label(change_mask.astype(np.uint8))
        results = []
        for i in range(1, n_blobs + 1):
            comp = labeled == i
            if comp.sum() < 25:
                continue
            rows = np.where(comp.any(axis=1))[0]
            cols = np.where(comp.any(axis=0))[0]
            conf = min(0.85, 0.40 + float(diff[comp].mean()) * 2.0)

            lon_range = tile["max_lon"] - tile["min_lon"]
            lat_range = tile["max_lat"] - tile["min_lat"]
            min_lon = tile["min_lon"] + (int(cols[0])  / SIZE) * lon_range
            max_lon = tile["min_lon"] + (int(cols[-1]) / SIZE) * lon_range
            max_lat = tile["max_lat"] - (int(rows[0])  / SIZE) * lat_range
            min_lat = tile["max_lat"] - (int(rows[-1]) / SIZE) * lat_range

            results.append({
                "confidence": conf,
                "geo": {
                    "min_lon":      min_lon, "max_lon":      max_lon,
                    "min_lat":      min_lat, "max_lat":      max_lat,
                    "centroid_lon": (min_lon + max_lon) / 2,
                    "centroid_lat": (min_lat + max_lat) / 2,
                },
            })
        return results

    def _has_baseline(self, tile: dict, db) -> bool:
        """True if >= 2 tile records exist at this location (current + at least one previous)."""
        count = (
            db.query(RegionalScanTile)
            .filter(
                RegionalScanTile.min_lon.between(tile["min_lon"] - 0.001, tile["min_lon"] + 0.001),
                RegionalScanTile.min_lat.between(tile["min_lat"] - 0.001, tile["min_lat"] + 0.001),
                RegionalScanTile.image_b64.isnot(None),
            )
            .count()
        )
        return count >= 2

    # ── Detection creation helper ──────────────────────────────────────────────

    def _make_det(
        self, *, job_id, tile, tile_id, det_type, category, importance,
        confidence, geo, class_name, source, nearby, zone_id, is_change=False,
    ) -> RegionalScanDetection:
        return RegionalScanDetection(
            detection_id              = f"RDET-{uuid.uuid4().hex[:6].upper()}",
            job_id                    = job_id,
            tile_index                = tile["index"],
            region_name               = "UAE",
            detection_type            = det_type,
            category                  = category,
            importance                = importance,
            confidence                = round(confidence, 3),
            centroid_lat              = geo["centroid_lat"],
            centroid_lon              = geo["centroid_lon"],
            bbox_min_lon              = geo.get("min_lon"),
            bbox_min_lat              = geo.get("min_lat"),
            bbox_max_lon              = geo.get("max_lon"),
            bbox_max_lat              = geo.get("max_lat"),
            nearest_asset_name        = nearby[0]["name"]               if nearby else None,
            nearest_asset_type        = nearby[0]["type"]               if nearby else None,
            nearest_asset_distance_km = round(nearby[0]["distance_km"], 2) if nearby else None,
            in_strategic_zone         = zone_id,
            change_type               = "CHANGED" if is_change else "DETECTED",
            is_change                 = is_change,
            detection_source          = source,
            class_name                = class_name,
            spectral_change_score     = 0.0,
            baseline_available        = is_change,
            created_at                = datetime.datetime.utcnow(),
        )

    # ── Geo parsing helpers ────────────────────────────────────────────────────

    def _b64_to_pil(self, b64: str):
        try:
            from PIL import Image
            return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        except Exception:
            return None

    def _corners_to_geo(self, raw_det: dict, tile: dict) -> dict:
        """Extract geo bbox from ONNX detection: corners [[lat,lon], ...] + center [lat,lon]."""
        try:
            corners = raw_det.get("corners", [])
            if corners:
                lats = [c[0] for c in corners]
                lons = [c[1] for c in corners]
                ctr  = raw_det.get("center", [(min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2])
                return {
                    "min_lon": min(lons), "max_lon": max(lons),
                    "min_lat": min(lats), "max_lat": max(lats),
                    "centroid_lat": float(ctr[0]), "centroid_lon": float(ctr[1]),
                }
        except Exception:
            pass
        # Fallback: centroid only, small bbox
        ctr = raw_det.get("center", [(tile["min_lat"] + tile["max_lat"]) / 2,
                                      (tile["min_lon"] + tile["max_lon"]) / 2])
        lat, lon = float(ctr[0]), float(ctr[1])
        return {
            "min_lon": lon - 0.002, "max_lon": lon + 0.002,
            "min_lat": lat - 0.002, "max_lat": lat + 0.002,
            "centroid_lat": lat, "centroid_lon": lon,
        }

    def _parse_overwatch_geo(self, det: dict, tile: dict) -> dict:
        """Extract geo bbox from Overwatch SentinelDetection-schema dict.
        Uses geo_geometry (GeoJSON polygon) if present, otherwise centroid point.
        """
        try:
            geo_str = det.get("geo_geometry", "")
            if geo_str:
                geo    = json.loads(geo_str)
                coords = geo.get("coordinates", [[]])[0]
                lons   = [c[0] for c in coords]
                lats   = [c[1] for c in coords]
                if lons and lats:
                    return {
                        "min_lon":      min(lons), "max_lon": max(lons),
                        "min_lat":      min(lats), "max_lat": max(lats),
                        "centroid_lat": float(det.get("centroid_lat", (min(lats) + max(lats)) / 2)),
                        "centroid_lon": float(det.get("centroid_lon", (min(lons) + max(lons)) / 2)),
                    }
        except Exception:
            pass
        lat = float(det.get("centroid_lat", (tile["min_lat"] + tile["max_lat"]) / 2))
        lon = float(det.get("centroid_lon", (tile["min_lon"] + tile["max_lon"]) / 2))
        return {
            "min_lon": lon - 0.005, "max_lon": lon + 0.005,
            "min_lat": lat - 0.005, "max_lat": lat + 0.005,
            "centroid_lat": lat, "centroid_lon": lon,
        }

    def _dota_to_det(self, cls_name: str) -> tuple:
        key = (cls_name or "").lower().strip()
        return _DOTA_CLASS_MAP.get(key, ("OBJECT_DETECTED", "infrastructure", 2))

    # ── Scoring ────────────────────────────────────────────────────────────────

    def _importance(self, confidence: float, has_nearby: bool, has_zone: bool, is_fire: bool) -> int:
        score = round(confidence * 3)
        if is_fire:    score += 2
        if has_zone:   score += 1
        if has_nearby: score += 1
        return min(5, max(1, score))

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

    # ── Claude Vision ──────────────────────────────────────────────────────────

    async def _claude_vision(
        self, image: dict, tile: dict, det_type: str,
        nearby: list, zone_id: Optional[str],
    ) -> dict:
        loop      = asyncio.get_event_loop()
        asset_ctx = (
            f"Nearest: {nearby[0]['name']} ({nearby[0]['type']}, {nearby[0]['distance_km']:.1f}km)"
            if nearby else "No known assets nearby"
        )

        def _call():
            client = anthropic.Anthropic()
            resp   = client.messages.create(
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

    # ── Opus intelligence report ───────────────────────────────────────────────

    async def _generate_report(self, job_id: str, db):
        dets = (
            db.query(RegionalScanDetection)
            .filter_by(job_id=job_id, suppressed=False)
            .all()
        )
        job = db.query(RegionalScanJob).filter_by(job_id=job_id).first()

        if not dets or not job:
            if job:
                job.report_summary = "No significant detections found in this scan."
                job.claude_report  = "No significant detections found in this scan cycle."
                db.commit()
            return

        det_rows = [{
            "type":       d.detection_type,
            "confidence": round(d.confidence, 2),
            "lat":        d.centroid_lat,
            "lon":        d.centroid_lon,
            "asset":      d.nearest_asset_name,
            "zone":       d.in_strategic_zone,
            "analysis":   d.claude_vision_analysis or "",
            "source":     d.detection_source,
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
                    "FIRE/ENVIRONMENTAL, AVIATION/MARITIME, ASSESSMENT.\n"
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
