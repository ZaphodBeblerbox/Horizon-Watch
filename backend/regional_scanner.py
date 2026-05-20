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
    RegionalScanJob, RegionalScanDetection,
    Airport, PortBoundary, StrategicZone,
    SessionLocal,
)

# Set from main.py at startup — called to push SSE events to all clients
sse_push_fn: Optional[Callable] = None


# ── Sentinel-2 tile fetch (sync, runs in executor) ────────────────────────────

def _fetch_tile_sync(
    west: float, south: float, east: float, north: float,
    max_age_days: int = 5,
    min_age_days: int = 0,
    max_cloud: int = 30,
    width: int = 256,
    height: int = 256,
) -> Optional[dict]:
    """Fetch Sentinel-2 true-colour tile via Copernicus Process API.
    Returns {"b64": base64_png, "date": datetime} or None.
    """
    try:
        from sentinel_scanner import _get_token_sync, _EVALSCRIPTS_SCANNER, _SH_PROCESS_URL
        import urllib.request

        token = _get_token_sync()
        if not token:
            return None
        evalscript = _EVALSCRIPTS_SCANNER.get("true-colour")
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

                    self._emit("scan_progress", {
                        "job_id":         job_id,
                        "tile_index":     tile["index"],
                        "total_tiles":    len(tiles),
                        "tiles_complete": job.tiles_complete,
                        "pct":            round(job.tiles_complete / len(tiles) * 100),
                        "new_detections": [
                            {
                                "detection_id":   d.detection_id,
                                "detection_type": d.detection_type,
                                "confidence":     d.confidence,
                                "lat":            d.centroid_lat,
                                "lon":            d.centroid_lon,
                                "severity":       d.claude_severity or "medium",
                                "tile_bbox": {
                                    "min_lon": tile["min_lon"],
                                    "min_lat": tile["min_lat"],
                                    "max_lon": tile["max_lon"],
                                    "max_lat": tile["max_lat"],
                                },
                            }
                            for d in detections
                        ],
                        "tile_bbox": {
                            "min_lon": tile["min_lon"],
                            "min_lat": tile["min_lat"],
                            "max_lon": tile["max_lon"],
                            "max_lat": tile["max_lat"],
                        },
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
        loop = asyncio.get_event_loop()

        # 1. Fetch current image
        current = await loop.run_in_executor(
            None,
            lambda: _fetch_tile_sync(
                tile["min_lon"], tile["min_lat"],
                tile["max_lon"], tile["max_lat"],
                max_age_days=region.get("scan_interval_days", 5),
                min_age_days=0,
                max_cloud=region.get("max_cloud_cover", 30),
            ),
        )
        if not current:
            return []

        # 2. Fetch baseline (30-60 days ago)
        baseline = await loop.run_in_executor(
            None,
            lambda: _fetch_tile_sync(
                tile["min_lon"], tile["min_lat"],
                tile["max_lon"], tile["max_lat"],
                max_age_days=60,
                min_age_days=30,
                max_cloud=40,
            ),
        )

        # 3. Spectral analysis
        spectral = self._analyse_spectral(current, baseline, region)
        if not spectral["flagged"]:
            return []

        # 4. Context: nearby assets + strategic zone
        tile_lat = (tile["min_lat"] + tile["max_lat"]) / 2
        tile_lon = (tile["min_lon"] + tile["max_lon"]) / 2
        nearby  = await loop.run_in_executor(None, lambda: self._get_nearby_assets(tile_lat, tile_lon, 10, db))
        zone_id = await loop.run_in_executor(None, lambda: self._get_containing_zone(tile_lat, tile_lon, db))

        detections = []
        for change_type in spectral["change_types"]:
            is_fire   = change_type in ("FIRE", "SMOKE", "BURN_SCAR")
            relevant  = is_fire or bool(nearby) or bool(zone_id)
            if not relevant:
                continue

            det_type   = self._map_change_type(change_type, nearby)
            confidence = spectral["scores"].get(change_type, 0.5)

            # 5. Claude Vision for significant or fire detections
            claude_analysis = None
            claude_severity = "medium"
            if confidence > 0.45 or is_fire:
                try:
                    vision = await self._claude_vision(current, tile, det_type, nearby, zone_id)
                    claude_analysis = vision.get("description")
                    claude_severity = vision.get("severity", "medium")
                except Exception as ve:
                    print(f"[scanner] vision tile {tile['index']}: {ve}")

            det = RegionalScanDetection(
                detection_id             = f"RDET-{uuid.uuid4().hex[:6].upper()}",
                job_id                   = job_id,
                tile_index               = tile["index"],
                region_name              = "UAE",
                detection_type           = det_type,
                confidence               = round(confidence, 3),
                centroid_lat             = tile_lat,
                centroid_lon             = tile_lon,
                bbox_min_lon             = tile["min_lon"],
                bbox_min_lat             = tile["min_lat"],
                bbox_max_lon             = tile["max_lon"],
                bbox_max_lat             = tile["max_lat"],
                spectral_change_score    = round(spectral["max_score"], 4),
                change_type              = "FIRE" if is_fire else "CHANGED",
                nearest_asset_name       = nearby[0]["name"]        if nearby else None,
                nearest_asset_type       = nearby[0]["type"]        if nearby else None,
                nearest_asset_distance_km= round(nearby[0]["distance_km"], 2) if nearby else None,
                in_strategic_zone        = zone_id,
                claude_vision_analysis   = claude_analysis,
                claude_severity          = claude_severity,
                image_b64                = current["b64"] if is_fire else None,
                created_at               = datetime.datetime.utcnow(),
            )
            db.add(det)
            detections.append(det)

        db.commit()
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
