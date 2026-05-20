"""regional_scanner.py — Tile-by-tile Sentinel-2 regional intelligence scan.

Pipeline phases:
  1. acquisition  — fetch current + baseline Sentinel-2 tiles for region bbox
  2. spectral     — compute spectral change scores tile-by-tile
  3. detection    — YOLO on flagged tiles + asset proximity cross-reference
  4. vision       — Claude Vision on confirmed detections
  5. report       — Claude Opus full intelligence report
"""
from __future__ import annotations

import asyncio
import base64
import datetime
import io
import json
import re
import math
from typing import Callable, Optional

import anthropic

from database import (
    RegionalScanJob, RegionalScanDetection,
    Airport, PortBoundary, StrategicZone,
    get_db,
)


# ── ID generators ──────────────────────────────────────────────────────────────

def _next_job_id(db) -> str:
    n = db.query(RegionalScanJob).count() + 1
    return f"RSCAN-{n:04d}"


def _next_det_id(db) -> str:
    n = db.query(RegionalScanDetection).count() + 1
    return f"RDET-{n:04d}"


# ── Sentinel fetch (wraps sentinel_scanner._fetch_sentinel_image) ──────────────

def _fetch_tile_range(
    west: float, south: float, east: float, north: float,
    image_type: str = "true-colour",
    date_from: Optional[datetime.datetime] = None,
    date_to: Optional[datetime.datetime] = None,
    max_cloud: int = 20,
    width: int = 512,
    height: int = 512,
) -> Optional[bytes]:
    """Fetch Sentinel-2 tile for an explicit date range."""
    from sentinel_scanner import _get_token_sync, _EVALSCRIPTS_SCANNER, _SH_PROCESS_URL
    import urllib.request

    token = _get_token_sync()
    if not token:
        return None
    evalscript = _EVALSCRIPTS_SCANNER.get(image_type)
    if not evalscript:
        return None

    now = datetime.datetime.utcnow()
    t_to   = date_to   or now
    t_from = date_from or (now - datetime.timedelta(days=7))

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
            return r.read() if r.status == 200 else None
    except Exception as e:
        print(f"[regional_scanner] tile fetch error: {e}")
        return None


def _decode_image(b64_or_bytes):
    """Decode base64 string or raw bytes → numpy RGB array."""
    try:
        import numpy as np
        from PIL import Image
        if isinstance(b64_or_bytes, str):
            data = base64.b64decode(b64_or_bytes)
        else:
            data = b64_or_bytes
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return np.array(img)
    except Exception:
        return None


# ── RegionalScanner ────────────────────────────────────────────────────────────

class RegionalScanner:
    """Orchestrates a full regional satellite intelligence scan."""

    def __init__(
        self,
        yolo_fn: Optional[Callable] = None,
        broadcast_fn: Optional[Callable] = None,
    ):
        self.yolo_fn      = yolo_fn       # sync fn(bbox, band_type, db) → list[dict]
        self.broadcast_fn = broadcast_fn  # fn(title, body, data)

    async def run_scan(self, region: dict, db) -> RegionalScanJob:
        job = RegionalScanJob(
            job_id         = _next_job_id(db),
            region_name    = region["name"],
            bbox_min_lon   = region["bbox"]["min_lon"],
            bbox_min_lat   = region["bbox"]["min_lat"],
            bbox_max_lon   = region["bbox"]["max_lon"],
            bbox_max_lat   = region["bbox"]["max_lat"],
            status         = "running",
            phase          = "acquisition",
            started_at     = datetime.datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        print(f"[regional_scanner] {job.job_id}: started scan of {region['name']}")

        try:
            tiles      = await self._phase_acquisition(job, region, db)
            flagged    = await self._phase_spectral(job, tiles, region, db)
            detections = await self._phase_detection(job, flagged, db)
            await self._phase_vision(job, detections, db)
            await self._phase_report(job, db)

            job.status       = "complete"
            job.completed_at = datetime.datetime.utcnow()
            db.commit()
            print(f"[regional_scanner] {job.job_id}: complete — "
                  f"{job.detections_flagged} flagged detections")

            if self.broadcast_fn:
                try:
                    self.broadcast_fn(
                        f"UAE Regional Scan Complete",
                        job.report_summary or f"{job.detections_flagged} detections",
                        {"type": "regional_scan_complete", "job_id": job.job_id,
                         "region": job.region_name, "detections": job.detections_flagged},
                    )
                except Exception:
                    pass

        except Exception as e:
            print(f"[regional_scanner] {job.job_id}: FAILED — {e}")
            import traceback; traceback.print_exc()
            job.status        = "failed"
            job.error_message = str(e)[:500]
            job.completed_at  = datetime.datetime.utcnow()
            db.commit()
            raise

        return job

    # ── Phase 1: Acquisition ───────────────────────────────────────────────────

    async def _phase_acquisition(self, job, region, db) -> list:
        job.phase = "acquisition"
        db.commit()

        bbox      = region["bbox"]
        tile_size = region["tile_size_deg"]
        tiles: list[dict] = []

        lon = bbox["min_lon"]
        while lon < bbox["max_lon"]:
            lat = bbox["min_lat"]
            while lat < bbox["max_lat"]:
                tiles.append({
                    "index": len(tiles),
                    "bbox": {
                        "min_lon": round(lon, 6),
                        "min_lat": round(lat, 6),
                        "max_lon": round(min(lon + tile_size, bbox["max_lon"]), 6),
                        "max_lat": round(min(lat + tile_size, bbox["max_lat"]), 6),
                    },
                })
                lat += tile_size
            lon += tile_size

        job.total_tiles = len(tiles)
        db.commit()
        print(f"[regional_scanner] {job.job_id}: {len(tiles)} tiles in grid")

        now           = datetime.datetime.utcnow()
        current_from  = now - datetime.timedelta(days=region.get("scan_interval_days", 5))
        baseline_to   = now - datetime.timedelta(days=30)
        baseline_from = now - datetime.timedelta(days=60)
        max_cloud     = region.get("max_cloud_cover", 20)

        loop           = asyncio.get_event_loop()
        BATCH          = 3        # concurrent tile fetches
        TILE_TIMEOUT   = 30       # per-tile HTTP timeout (seconds)
        TOTAL_TIMEOUT  = 4 * 3600 # 4-hour overall acquisition limit
        acq_start      = asyncio.get_event_loop().time()
        fetched_count  = 0

        async def _fetch_one(tile, date_from, date_to, cloud):
            """Fetch a single tile with per-tile timeout; returns None on any error."""
            b = tile["bbox"]
            try:
                raw = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda b=b, df=date_from, dt=date_to, c=cloud: _fetch_tile_range(
                            b["min_lon"], b["min_lat"], b["max_lon"], b["max_lat"],
                            image_type="true-colour",
                            date_from=df,
                            date_to=dt,
                            max_cloud=c,
                        ),
                    ),
                    timeout=TILE_TIMEOUT,
                )
                return raw
            except asyncio.TimeoutError:
                print(f"[regional_scanner] tile {tile['index']} timed out — skipping")
                return None
            except Exception as e:
                print(f"[regional_scanner] tile {tile['index']} error: {e}")
                return None

        # ── Current image fetch (batches of 3) ────────────────────────────────
        for batch_start in range(0, len(tiles), BATCH):
            # Overall acquisition timeout guard
            if asyncio.get_event_loop().time() - acq_start > TOTAL_TIMEOUT:
                raise RuntimeError(
                    f"Acquisition timeout — too many tiles for sequential fetch "
                    f"({fetched_count}/{len(tiles)} fetched before 4h limit)"
                )

            batch = tiles[batch_start:batch_start + BATCH]
            results = await asyncio.gather(*[
                _fetch_one(t, current_from, now, max_cloud) for t in batch
            ])
            for tile, raw in zip(batch, results):
                if raw:
                    tile["image_bytes"] = raw
                    tile["image_date"]  = now
                    fetched_count += 1

            # Progress checkpoint every 50 tiles
            if (batch_start + BATCH) % 50 == 0 or batch_start + BATCH >= len(tiles):
                job.metadata = json.dumps({"tiles_fetched": fetched_count, "tiles_total": len(tiles)})
                try:
                    db.commit()
                except Exception:
                    pass
                print(f"[regional_scanner] {job.job_id}: progress {fetched_count}/{len(tiles)}")

            await asyncio.sleep(0.3)

        print(f"[regional_scanner] {job.job_id}: {fetched_count}/{len(tiles)} current tiles fetched")

        # ── Baseline fetch (batches of 3, only for tiles that have current image) ──
        baseline_tiles = [t for t in tiles if t.get("image_bytes")]
        for batch_start in range(0, len(baseline_tiles), BATCH):
            if asyncio.get_event_loop().time() - acq_start > TOTAL_TIMEOUT:
                print(f"[regional_scanner] {job.job_id}: 4h timeout hit during baseline — continuing with partial data")
                break

            batch = baseline_tiles[batch_start:batch_start + BATCH]
            results = await asyncio.gather(*[
                _fetch_one(t, baseline_from, baseline_to, 30) for t in batch
            ])
            for tile, raw in zip(batch, results):
                tile["baseline_bytes"] = raw
                tile["baseline_date"]  = baseline_to if raw else None

            await asyncio.sleep(0.3)

        fetched = sum(1 for t in tiles if t.get("image_bytes"))
        print(f"[regional_scanner] {job.job_id}: {fetched}/{len(tiles)} tiles fetched (final)")

        dated = [t["image_date"] for t in tiles if t.get("image_date")]
        if dated:
            job.image_date = min(dated)
        bdated = [t["baseline_date"] for t in tiles if t.get("baseline_date")]
        if bdated:
            job.baseline_date = max(bdated)
        db.commit()
        return tiles

    # ── Phase 2: Spectral change detection ────────────────────────────────────

    async def _phase_spectral(self, job, tiles, region, db) -> list:
        job.phase = "spectral"
        db.commit()

        import numpy as np
        from PIL import Image

        threshold  = region.get("spectral_change_threshold", 0.12)
        flagged: list[dict] = []

        for tile in tiles:
            if not tile.get("image_bytes") or not tile.get("baseline_bytes"):
                continue
            try:
                curr = _decode_image(tile["image_bytes"])
                base = _decode_image(tile["baseline_bytes"])
                if curr is None or base is None:
                    continue

                h, w = curr.shape[:2]
                if base.shape[:2] != (h, w):
                    base = np.array(Image.fromarray(base).resize((w, h)))

                r_c = curr[:,:,0].astype(float) / 255
                g_c = curr[:,:,1].astype(float) / 255
                b_c = curr[:,:,2].astype(float) / 255
                r_b = base[:,:,0].astype(float) / 255
                g_b = base[:,:,1].astype(float) / 255
                b_b = base[:,:,2].astype(float) / 255

                # Fire: bright warm pixels (red-dominant, low blue)
                fire_mask  = (r_c > 0.72) & (g_c < 0.42) & (b_c < 0.32)
                fire_score = float(np.mean(fire_mask))

                # Burn scar: darkening vs baseline in all channels
                burn_mask  = ((r_b - r_c) > 0.18) & ((g_b - g_c) > 0.12) & (r_c < 0.32)
                burn_score = float(np.mean(burn_mask))

                # General pixel diff
                diff       = np.abs(curr.astype(float) - base.astype(float))
                mean_diff  = float(np.mean(diff)) / 255

                # New built-up (bright grey not in baseline)
                bright_c   = (r_c > 0.52) & (g_c > 0.52) & (b_c > 0.52)
                bright_b   = (r_b > 0.52) & (g_b > 0.52) & (b_b > 0.52)
                buildup    = float(np.mean(bright_c & ~bright_b))

                should_flag = (
                    fire_score   > 0.005 or
                    burn_score   > 0.015 or
                    mean_diff    > threshold or
                    buildup      > 0.04
                )

                if should_flag:
                    change_types = []
                    if fire_score  > 0.005: change_types.append("FIRE")
                    if burn_score  > 0.015: change_types.append("BURN_SCAR")
                    if mean_diff   > threshold: change_types.append("CHANGE")
                    if buildup     > 0.04:  change_types.append("BUILDUP")

                    tile["change_score"]  = max(
                        fire_score * 5, burn_score * 3, mean_diff, buildup * 2
                    )
                    tile["change_types"]  = change_types
                    tile["fire_score"]    = fire_score
                    tile["burn_score"]    = burn_score
                    tile["change_diff"]   = mean_diff
                    flagged.append(tile)

            except Exception as e:
                print(f"[regional_scanner] spectral tile {tile['index']}: {e}")

        job.flagged_tiles = len(flagged)
        db.commit()
        print(f"[regional_scanner] {job.job_id}: {len(flagged)} flagged tiles")
        return flagged

    # ── Phase 3: YOLO detection + asset cross-reference ───────────────────────

    async def _phase_detection(self, job, flagged_tiles, db) -> list:
        job.phase = "detection"
        db.commit()

        loop = asyncio.get_event_loop()
        all_detections: list[RegionalScanDetection] = []

        for tile in flagged_tiles:
            if not tile.get("image_bytes"):
                continue
            b = tile["bbox"]
            tile_lat = (b["min_lat"] + b["max_lat"]) / 2
            tile_lon = (b["min_lon"] + b["max_lon"]) / 2

            # YOLO (optional — injected from main.py)
            yolo_results: list[dict] = []
            if self.yolo_fn:
                try:
                    yolo_results = await loop.run_in_executor(
                        None, lambda t=tile: self.yolo_fn(t["bbox"], "TRUE_COLOR", db)
                    )
                except Exception as e:
                    print(f"[regional_scanner] YOLO tile {tile['index']}: {e}")

            # Always flag fire/burn detections
            for ct in tile.get("change_types", []):
                if ct in ("FIRE", "BURN_SCAR"):
                    score = tile.get("fire_score", 0) if ct == "FIRE" else tile.get("burn_score", 0)
                    det = self._create_detection(
                        job=job, tile=tile,
                        detection_type=ct, change_type="NEW",
                        confidence=min(0.5 + score * 10, 0.95),
                        centroid_lat=tile_lat, centroid_lon=tile_lon,
                        yolo_confirmed=False, db=db,
                    )
                    if det:
                        all_detections.append(det)

            # Flag infrastructure changes only near known assets / strategic zones
            if any(ct in tile.get("change_types", []) for ct in ("CHANGE", "BUILDUP")):
                nearby = await loop.run_in_executor(
                    None, lambda: self._get_nearby_assets(tile_lat, tile_lon, 8, db)
                )
                in_zone = await loop.run_in_executor(
                    None, lambda: self._in_strategic_zone(tile_lat, tile_lon, db)
                )
                if nearby or in_zone:
                    det_type = self._classify_change_type(tile, nearby, yolo_results)
                    det = self._create_detection(
                        job=job, tile=tile,
                        detection_type=det_type, change_type="NEW",
                        confidence=min(tile.get("change_score", 0.4), 0.9),
                        centroid_lat=tile_lat, centroid_lon=tile_lon,
                        yolo_confirmed=bool(yolo_results),
                        yolo_object_type=yolo_results[0].get("object_type") if yolo_results else None,
                        nearest_assets=nearby, db=db,
                    )
                    if det:
                        all_detections.append(det)

        job.detections_total   = len(all_detections)
        job.detections_flagged = sum(1 for d in all_detections if d.confidence > 0.4)
        db.commit()
        print(f"[regional_scanner] {job.job_id}: {len(all_detections)} detections")
        return all_detections

    def _create_detection(
        self, job, tile, detection_type, change_type, confidence,
        centroid_lat, centroid_lon, yolo_confirmed, db,
        yolo_object_type=None, nearest_assets=None,
    ) -> Optional[RegionalScanDetection]:
        try:
            b = tile["bbox"]
            nearest = (nearest_assets or [])
            first   = nearest[0] if nearest else None

            # Strategic zone lookup
            zone_id = self._in_strategic_zone_id(centroid_lat, centroid_lon, db)

            det = RegionalScanDetection(
                detection_id             = _next_det_id(db),
                job_id                   = job.job_id,
                region_name              = job.region_name,
                detection_type           = detection_type,
                change_type              = change_type,
                confidence               = round(confidence, 3),
                centroid_lat             = centroid_lat,
                centroid_lon             = centroid_lon,
                bbox_min_lon             = b["min_lon"],
                bbox_min_lat             = b["min_lat"],
                bbox_max_lon             = b["max_lon"],
                bbox_max_lat             = b["max_lat"],
                spectral_change_score    = round(tile.get("change_score", 0), 4),
                yolo_confirmed           = yolo_confirmed,
                yolo_object_type         = yolo_object_type,
                nearest_asset_type       = first["type"] if first else None,
                nearest_asset_name       = first["name"] if first else None,
                nearest_asset_distance_km= round(first["distance_km"], 2) if first else None,
                in_strategic_zone        = zone_id,
                image_date               = tile.get("image_date"),
                baseline_date            = tile.get("baseline_date"),
            )
            db.add(det)
            db.commit()
            return det
        except Exception as e:
            print(f"[regional_scanner] create_detection error: {e}")
            return None

    def _classify_change_type(self, tile, nearby_assets, yolo_results) -> str:
        asset_types  = {a["type"] for a in nearby_assets}
        change_types = set(tile.get("change_types", []))
        if "airport"         in asset_types: return "RUNWAY_CHANGE"
        if "port"            in asset_types: return "PORT_CHANGE"
        if "energy"          in asset_types or "pipeline" in asset_types: return "ENERGY_CHANGE"
        if not nearby_assets:               return "UNKNOWN_COMPOUND"
        if "BUILDUP"         in change_types: return "INFRASTRUCTURE_CHANGE"
        return "INFRASTRUCTURE_CHANGE"

    def _get_nearby_assets(self, lat: float, lon: float, radius_km: float, db) -> list:
        deg = radius_km / 111.32
        assets: list[dict] = []

        for a in db.query(Airport).filter(
            Airport.latitude.between(lat - deg, lat + deg),
            Airport.longitude.between(lon - deg, lon + deg),
        ).all():
            assets.append({
                "type": "airport", "name": a.airport_name,
                "distance_km": math.hypot(lat - a.latitude, lon - a.longitude) * 111.32,
            })

        for p in db.query(PortBoundary).filter(
            PortBoundary.latitude.between(lat - deg, lat + deg),
            PortBoundary.longitude.between(lon - deg, lon + deg),
        ).all():
            assets.append({
                "type": "port", "name": p.port_name,
                "distance_km": math.hypot(lat - p.latitude, lon - p.longitude) * 111.32,
            })

        return sorted(assets, key=lambda x: x["distance_km"])

    def _in_strategic_zone(self, lat: float, lon: float, db) -> bool:
        return self._in_strategic_zone_id(lat, lon, db) is not None

    def _in_strategic_zone_id(self, lat: float, lon: float, db) -> Optional[str]:
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

    # ── Phase 4: Claude Vision ─────────────────────────────────────────────────

    async def _phase_vision(self, job, detections, db) -> None:
        job.phase = "vision"
        db.commit()

        qualifying = [d for d in detections if d.confidence > 0.4]
        print(f"[regional_scanner] {job.job_id}: "
              f"sending {len(qualifying)} detections to Claude Vision")

        ai_client = anthropic.Anthropic()
        loop      = asyncio.get_event_loop()

        for det in qualifying:
            try:
                # Find original tile image bytes
                tile_bytes = self._get_tile_bytes_for_det(det, detections, job)
                if not tile_bytes:
                    continue

                image_date_str = det.image_date.strftime("%Y-%m-%d") if det.image_date else "unknown"
                context = (
                    f"You are analysing a Sentinel-2 satellite image crop from the "
                    f"{det.region_name} region captured on {image_date_str}.\n\n"
                    f"Detection metadata:\n"
                    f"- Type: {det.detection_type}\n"
                    f"- Change from baseline: {det.change_type}\n"
                    f"- Spectral change score: {det.spectral_change_score:.3f}\n"
                    f"- Nearest known asset: {det.nearest_asset_name or 'None'} "
                    f"({det.nearest_asset_type or 'unknown'}"
                    + (f", {det.nearest_asset_distance_km:.1f}km away" if det.nearest_asset_distance_km else "") + ")\n"
                    f"- Inside strategic zone: {det.in_strategic_zone or 'No'}\n"
                    f"- YOLO detected: {det.yolo_object_type or 'No detection'}\n\n"
                    "Analyse this image and return ONLY valid JSON:\n"
                    '{"description": "...", "likely_purpose": "...", '
                    '"military_relevance": "...", '
                    '"severity": "info|medium|high|critical", '
                    '"threat_assessment": "one sentence"}'
                )

                b64 = base64.b64encode(tile_bytes).decode()

                def _call(b64=b64, context=context):
                    msg = ai_client.messages.create(
                        model="claude-sonnet-4-6",
                        max_tokens=512,
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "image", "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": b64,
                                }},
                                {"type": "text", "text": context},
                            ],
                        }],
                    )
                    return msg.content[0].text

                text = await loop.run_in_executor(None, _call)
                m = re.search(r'\{.*\}', text, re.DOTALL)
                if m:
                    try:
                        a = json.loads(m.group())
                        det.claude_vision_analysis   = a.get("description", "")[:1000]
                        det.claude_threat_assessment = a.get("threat_assessment", "")[:300]
                        det.claude_severity          = a.get("severity", "info")
                    except json.JSONDecodeError:
                        det.claude_vision_analysis = text[:500]
                else:
                    det.claude_vision_analysis = text[:500]

                db.commit()
                await asyncio.sleep(1.2)

            except Exception as e:
                print(f"[regional_scanner] vision {det.detection_id}: {e}")

    def _get_tile_bytes_for_det(self, det, detections, job) -> Optional[bytes]:
        """Retrieve the tile bytes associated with this detection (from in-memory pipeline state).
        We keep it simple: re-fetch a small crop around the detection centroid."""
        try:
            margin = 0.03  # ~3km
            return _fetch_tile_range(
                det.centroid_lon - margin,
                det.centroid_lat - margin,
                det.centroid_lon + margin,
                det.centroid_lat + margin,
                image_type="true-colour",
                date_from=(det.image_date - datetime.timedelta(days=7)) if det.image_date else None,
                date_to=det.image_date,
                max_cloud=30,
                width=256,
                height=256,
            )
        except Exception:
            return None

    # ── Phase 5: Opus report ───────────────────────────────────────────────────

    async def _phase_report(self, job, db) -> None:
        job.phase = "report"
        db.commit()

        detections = (
            db.query(RegionalScanDetection)
            .filter(
                RegionalScanDetection.job_id == job.job_id,
                RegionalScanDetection.suppressed == False,
            )
            .order_by(RegionalScanDetection.confidence.desc())
            .all()
        )

        if not detections:
            job.claude_report  = "No significant changes detected in this scan cycle."
            job.report_summary = "No significant changes detected."
            db.commit()
            return

        det_rows = []
        for d in detections[:50]:
            det_rows.append({
                "type":           d.detection_type,
                "change":         d.change_type,
                "location":       f"{d.centroid_lat:.4f}N {d.centroid_lon:.4f}E",
                "confidence":     round(d.confidence, 2),
                "nearest_asset":  (f"{d.nearest_asset_name} ({d.nearest_asset_type})"
                                   if d.nearest_asset_name else "No known asset nearby"),
                "distance_km":    d.nearest_asset_distance_km,
                "strategic_zone": d.in_strategic_zone or "None",
                "analysis":       d.claude_vision_analysis or "Not analysed",
                "severity":       d.claude_severity or "info",
                "threat":         d.claude_threat_assessment or "None",
            })

        image_date_str    = job.image_date.strftime("%Y-%m-%d")    if job.image_date    else "unknown"
        baseline_date_str = job.baseline_date.strftime("%Y-%m-%d") if job.baseline_date else "unknown"

        prompt = (
            f"You are a senior intelligence analyst. Generate a structured intelligence "
            f"report based on the following satellite imagery analysis of the {job.region_name} region.\n\n"
            f"Scan period: {baseline_date_str} → {image_date_str}\n"
            f"Total tiles analysed: {job.total_tiles}\n"
            f"Flagged tiles: {job.flagged_tiles}\n"
            f"Total detections: {job.detections_total}\n\n"
            f"DETECTIONS:\n{json.dumps(det_rows, indent=2)}\n\n"
            "Generate a formal intelligence report with these sections:\n"
            "1. EXECUTIVE SUMMARY (3-4 sentences, most critical findings)\n"
            "2. CRITICAL FINDINGS (highest-severity detections with location, nature, significance)\n"
            "3. AIRPORT AND AIRFIELD ACTIVITY (changes at known airports or unknown airstrips)\n"
            "4. PORT AND MARITIME INFRASTRUCTURE (changes at ports, new berths, vessel concentrations)\n"
            "5. ENERGY AND OIL INFRASTRUCTURE (refinery, pipeline, storage changes)\n"
            "6. UNKNOWN STRUCTURES AND COMPOUNDS (new construction with no DB match)\n"
            "7. FIRE AND ENVIRONMENTAL EVENTS (fires, burn scars, industrial incidents)\n"
            "8. MILITARY INDICATORS (changes suggesting buildup, new facilities, equipment)\n"
            "9. ASSESSMENT AND WATCH ITEMS (overall threat assessment, next scan priorities)\n\n"
            "Be specific about locations (use coordinates). Be direct about military relevance. "
            "Do not hedge unnecessarily. Write for a senior analyst who needs actionable intelligence."
        )

        ai_client = anthropic.Anthropic()
        loop      = asyncio.get_event_loop()

        def _call_opus():
            return ai_client.messages.create(
                model="claude-opus-4-7",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            ).content[0].text

        report = await loop.run_in_executor(None, _call_opus)
        job.claude_report = report

        def _call_haiku():
            return ai_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=150,
                messages=[{"role": "user", "content": (
                    "Summarise this intelligence report in one sentence of max 30 words, "
                    f"naming the most critical finding:\n\n{report[:2000]}"
                )}],
            ).content[0].text

        job.report_summary = await loop.run_in_executor(None, _call_haiku)
        db.commit()
        print(f"[regional_scanner] {job.job_id}: report generated")


# ── Singleton ──────────────────────────────────────────────────────────────────
regional_scanner = RegionalScanner()
