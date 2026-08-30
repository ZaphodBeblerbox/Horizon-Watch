"""
sentinel_scanner.py — real satellite-imagery scan engine for WatchZone monitoring.

Replaces the July 2026 no-op stub (which only ever wrote status="skipped" rows and
never looked at any imagery). This module:

  1. Searches the public AWS Earth Search STAC API for the most recent low-cloud
     Sentinel-2 scene covering the zone's bbox — no credentials required for this
     step (`main._satellite_search_impl`).
  2. Fetches a real true-colour image crop for the exact zone bbox via the Sentinel
     Hub Process API (`main._fetch_sentinel_image_bytes`, requires
     COPERNICUS_CLIENT_ID/SECRET).
  3. Runs real ONNX-based ship detection (`sentinel_ml.run_ship_detection`) and
     vessel-cluster grouping (`sentinel_ml.run_vessel_cluster_detection`) on the
     fetched image.
  4. Writes one `SentinelScan` row (status "completed" or "error", carrying the
     *real* scene capture time / cloud cover / image age pulled from the STAC
     search — never the request window) and one `SentinelDetection` row per
     detection, in the exact `object_type` / `result_summary.by_type` vocabulary
     the rest of the codebase (zone analytics, alerting) already expects.
  5. Advances `WatchZone.last_scanned_at` / `next_scan_at` by the zone's own
     `scan_interval_hours` after every attempt — the 15-minute scheduler loop in
     main.py only checks `next_scan_at <= now`, so without this a zone would be
     re-scanned every 15 minutes forever instead of on its configured cadence.

No-fake-data policy, enforced throughout:
  - Every failure path (search error, no scenes found, auth failure, image fetch
    failure, undecodable image, ONNX model failed to load) writes
    status="error" with a real, specific error_message. Nothing is ever marked
    "completed" or "skipped" to paper over a failure.
  - An empty detection list is only ever written when detection genuinely ran
    against a real image and found nothing — never as a stand-in for "the model
    didn't load" (that case is checked explicitly and reported as an error).
  - If `zone.ml_tasks` requests a task this module doesn't implement yet
    (anything besides ship_detection / vessel_cluster_detection), that task is
    reported by name in `result_summary.not_implemented_or_skipped` rather than
    silently dropped while the scan is reported as fully "completed".

Known gap, not addressed here: `zone.alert_threshold` is accepted at zone
creation/update but is not read by any consuming logic anywhere in the codebase
(confirmed by repo-wide search) — its intended semantics were never defined, so
no behavior is invented for it in this pass. Flagged for follow-up rather than
guessed at.
"""

import asyncio
import datetime
import io
import json
import uuid

# Only these produce real, schema-matching detections today.
_IMPLEMENTED_TASKS = {"ship_detection", "vessel_cluster_detection"}


class SentinelScanner:
    def run_scan(self, zone_dict: dict, triggered_by: str = "schedule") -> dict:
        """Synchronous entry point — called via loop.run_in_executor() from main.py.
        Internally drives the async fetch/search helpers with asyncio.run()."""
        scan_id = str(uuid.uuid4())
        zone_id = zone_dict.get("id")
        system_id = zone_dict.get("system_id", "unknown")

        from database import SentinelScan, SentinelDetection, WatchZone, get_db

        try:
            result = asyncio.run(self._run_scan_async(zone_dict))
        except Exception as e:
            result = {"status": "error", "error_message": f"scan crashed: {type(e).__name__}: {e}"}

        detections = result.get("detections") or []

        try:
            with get_db() as db:
                scan_row = SentinelScan(
                    scan_id=scan_id,
                    zone_id=zone_id,
                    triggered_by=triggered_by,
                    status=result["status"],
                    created_at=datetime.datetime.utcnow(),
                    completed_at=datetime.datetime.utcnow(),
                    image_id=result.get("image_id"),
                    image_timestamp_utc=result.get("image_timestamp_utc"),
                    cloud_cover_percent=result.get("cloud_cover_percent"),
                    image_age_hours=result.get("image_age_hours"),
                    result_summary=json.dumps(result["result_summary"]) if result.get("result_summary") is not None else None,
                    raw_result_json=json.dumps(result["raw_result"]) if result.get("raw_result") is not None else None,
                    alert_fired=bool(result.get("alert_fired", False)),
                    error_message=result.get("error_message"),
                )
                db.add(scan_row)

                for det in detections:
                    db.add(SentinelDetection(
                        detection_id=f"DET-{uuid.uuid4().hex[:12]}",
                        scan_id=scan_id,
                        zone_id=zone_id,
                        # This scanner only ever runs the optical Sentinel-2 /
                        # YOLO-OBB pipeline (sentinel_ml.py) — real Sentinel-1
                        # SAR detections come from the separate sar_detector.py
                        # pipeline and are never written through this path, so
                        # "OPTICAL" is always correct here, not a guess.
                        instrument=det.get("instrument", "OPTICAL"),
                        object_type=det["object_type"],
                        confidence=det["confidence"],
                        centroid_lat=det["centroid_lat"],
                        centroid_lon=det["centroid_lon"],
                        geo_geometry=det.get("geo_geometry"),
                        area_m2=det.get("area_m2"),
                        severity=det.get("severity", "info"),
                        alert_tier=det.get("alert_tier", "silent"),
                        attributes=det.get("attributes"),
                        matched_to_ais=bool(det.get("matched_to_ais", False)),
                    ))

                # Advance the zone's schedule on every attempt (success or error) so the
                # 15-minute scheduler loop respects scan_interval_hours instead of
                # re-triggering this zone on every tick forever.
                zone = db.query(WatchZone).filter(WatchZone.id == zone_id).first()
                if zone is not None:
                    now = datetime.datetime.utcnow()
                    zone.last_scanned_at = now
                    interval = zone.scan_interval_hours or zone_dict.get("scan_interval_hours") or 120
                    zone.next_scan_at = now + datetime.timedelta(hours=interval)

                db.commit()

            print(f"[sentinel-scanner] scan {scan_id} zone={system_id} triggered_by={triggered_by} "
                  f"status={result['status']} detections={len(detections)}"
                  + (f" error={result.get('error_message')}" if result["status"] == "error" else ""))
        except Exception as e:
            print(f"[sentinel-scanner] failed to persist scan {scan_id} for zone={system_id}: {e}")

        return {"scan_id": scan_id, "status": result.get("status", "error")}

    async def _run_scan_async(self, zone_dict: dict) -> dict:
        from main import _satellite_search_impl, _fetch_sentinel_image_bytes
        import sentinel_ml

        min_lon = zone_dict["bbox_min_lon"]; min_lat = zone_dict["bbox_min_lat"]
        max_lon = zone_dict["bbox_max_lon"]; max_lat = zone_dict["bbox_max_lat"]

        # main.py's satellite functions take [west, south, east, north] / {west,south,east,north}
        stac_bbox = [min_lon, min_lat, max_lon, max_lat]
        bounds_wsen = {"west": min_lon, "south": min_lat, "east": max_lon, "north": max_lat}
        # sentinel_ml.py's detection functions take {min_lon,min_lat,max_lon,max_lat}
        ml_bbox = {"min_lon": min_lon, "min_lat": min_lat, "max_lon": max_lon, "max_lat": max_lat}

        raw_ml_tasks = zone_dict.get("ml_tasks")
        try:
            requested_tasks = json.loads(raw_ml_tasks) if isinstance(raw_ml_tasks, str) else (raw_ml_tasks or [])
        except Exception:
            requested_tasks = []
        if not isinstance(requested_tasks, list):
            requested_tasks = []

        run_tasks = [t for t in requested_tasks if t in _IMPLEMENTED_TASKS]
        skipped_tasks = [t for t in requested_tasks if t not in _IMPLEMENTED_TASKS]

        # -- 1. Find the most recent real scene, for honest freshness metadata --
        search = await _satellite_search_impl(stac_bbox, max_cloud=40, days_back=30)
        if search.get("error"):
            return {"status": "error", "error_message": f"scene search failed: {search['error']}"}
        items = search.get("items") or []
        if not items:
            return {"status": "error",
                    "error_message": "no Sentinel-2 scenes found for this zone in the last 30 days "
                                      "(max_cloud<=40) - cannot report a genuine detection result "
                                      "without a real image"}
        scene = items[0]  # _satellite_search_impl sorts most-recent-first
        scene_dt_str = scene.get("datetime")
        cloud_cover = scene.get("cloud_cover")
        scene_dt = None
        if scene_dt_str:
            try:
                scene_dt = datetime.datetime.fromisoformat(scene_dt_str.replace("Z", "+00:00"))
            except Exception:
                scene_dt = None
        image_age_hours = None
        if scene_dt is not None:
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            image_age_hours = round((now_utc - scene_dt).total_seconds() / 3600.0, 2)
        # Store as naive UTC to match the DateTime column convention used elsewhere in this codebase.
        scene_dt_naive = scene_dt.replace(tzinfo=None) if scene_dt is not None else None

        base_meta = {
            "image_id": scene.get("id"),
            "image_timestamp_utc": scene_dt_naive,
            "cloud_cover_percent": cloud_cover,
            "image_age_hours": image_age_hours,
        }

        if not run_tasks:
            return {
                "status": "error",
                "error_message": f"none of this zone's requested ml_tasks are implemented yet "
                                  f"(requested={requested_tasks}, implemented={sorted(_IMPLEMENTED_TASKS)})",
                **base_meta,
            }

        # -- 2. Fetch the real true-colour image for the exact zone bbox --
        img_result = await _fetch_sentinel_image_bytes(bounds_wsen, image_type="true-colour",
                                                         max_cloud=40, days_back=30)
        if img_result.get("error"):
            return {"status": "error", "error_message": f"image fetch failed: {img_result['error']}", **base_meta}

        try:
            from PIL import Image
            tc_image = Image.open(io.BytesIO(img_result["image_bytes"])).convert("RGB")
        except Exception as e:
            return {"status": "error", "error_message": f"could not decode fetched image: {e}", **base_meta}

        images = {"true_colour": tc_image}

        # -- 3. Run real detection tasks --
        by_type: dict = {}
        all_detections: list = []
        alert_fired = False

        if "ship_detection" in run_tasks:
            # run_ship_detection() returns [] both when the OBB model failed to load AND when it
            # genuinely found nothing - check the session explicitly so those two cases are never
            # conflated (a load failure must never be reported as "0 vessels found"). This is the
            # same shared YOLO-OBB (DOTA) session main.py's ESRI/Overwatch path uses.
            if sentinel_ml._get_obb_session() is None:
                return {
                    "status": "error",
                    "error_message": "ONNX model (yolov8n-obb.onnx) failed to load - cannot run ship_detection",
                    **base_meta,
                }
            ships = sentinel_ml.run_ship_detection(images, ml_bbox)
            all_detections.extend(ships)
            by_type["vessel"] = len(ships)
            if any(d.get("alert_tier") == "immediate" for d in ships):
                alert_fired = True

            if "vessel_cluster_detection" in run_tasks:
                clusters = sentinel_ml.run_vessel_cluster_detection(ships, ml_bbox)
                all_detections.extend(clusters)
                by_type["vessel_cluster"] = len(clusters)
                if any(d.get("alert_tier") == "immediate" for d in clusters):
                    alert_fired = True
        elif "vessel_cluster_detection" in run_tasks:
            # Clustering has nothing to group without ship_detection having run first.
            skipped_tasks.append("vessel_cluster_detection (requires ship_detection to also be enabled)")

        result_summary = {"by_type": by_type, "total_detections": len(all_detections)}
        if skipped_tasks:
            result_summary["not_implemented_or_skipped"] = skipped_tasks

        return {
            "status": "completed",
            "result_summary": result_summary,
            "raw_result": {"requested_tasks": requested_tasks, "run_tasks": run_tasks},
            "alert_fired": alert_fired,
            "detections": all_detections,
            **base_meta,
        }
