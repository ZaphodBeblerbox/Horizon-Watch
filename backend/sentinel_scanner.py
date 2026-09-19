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



# ── CPU work belongs off the event loop ──────────────────────────────────
#
# This module was the leading suspect for a confirmed production event-loop
# freeze, and the kill switch in main.py exists because of it. The reason is
# here: a scan decodes a Sentinel scene, re-encodes it to JPEG, base64s it and
# then runs YOLO ONNX inference — tens of seconds of pure CPU — and all of it
# ran inline inside `async def _run_scan_async`. For that whole time the
# single-threaded asyncio loop serves nothing, which is what "everything 502s
# at once" looks like from outside.
#
# An earlier fix offloaded ONE call in this path. These are the rest.
import asyncio as _asyncio

# The pool now lives in imagery_runtime, shared with every other imagery CPU
# path in the backend (Overwatch/Esri inference, SAR detection, optical
# detection). Previously this module owned a private single-worker pool while
# main.py handed its inference to the DEFAULT executor — so "one worker" was
# true per-module and false for the process: a zone scan and an Overwatch
# scan could still run at once and contend for the same cores. One pool for
# the whole process is the only version of that guarantee that holds.
import imagery_runtime as _imagery_rt


async def _off_loop(fn, *args, **kwargs):
    """Run blocking CPU work in the shared imagery pool, never on the event loop.

    get_running_loop(), not get_event_loop(): a scan can be driven from a
    sync endpoint, which FastAPI runs in an AnyIO worker thread where there
    is no current loop at all — get_event_loop() raises "There is no current
    event loop in thread 'AnyIO worker thread'" and takes the scan with it.

    With no running loop we are already off the main thread, but we still go
    through the pool rather than running inline: admission control and the
    one-at-a-time guarantee are the point, not merely leaving the loop alone.
    """
    try:
        _asyncio.get_running_loop()
    except RuntimeError:
        return _imagery_rt.run_cpu_blocking(fn, *args, label="zone-scan", **kwargs)
    return await _imagery_rt.run_cpu(fn, *args, label="zone-scan", **kwargs)


def _sar_preview_b64(tiff_bytes: bytes, sar_detector, np) -> str:
    """Build the SAR preview JPEG.

    Parses a GeoTIFF, runs full-array numpy maths over both polarisation
    bands, then JPEG-encodes and base64s the result — all CPU-bound, and all
    of it was running on the event loop.
    """
    import base64
    from PIL import Image as _PILImage
    prep = sar_detector.preprocess_raw_geotiff_bytes(tiff_bytes)
    vh, vv = prep["array"][0].astype(np.float32), prep["array"][1].astype(np.float32)
    ratio = np.clip(vh - vv + 128, 0, 255).astype(np.uint8)
    preview = np.stack([vv.astype(np.uint8), vh.astype(np.uint8), ratio], axis=-1)
    buf = io.BytesIO()
    _PILImage.fromarray(preview, mode="RGB").save(buf, format="JPEG", quality=87)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _decode_and_encode(image_bytes: bytes):
    """Decode the fetched scene and produce the stored JPEG in one hop.

    Both halves are CPU-bound and were inline: PIL decode of a multi-megapixel
    scene, then a full JPEG re-encode at quality 87, then base64 over the
    result.
    """
    import base64
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=87)
    return img, base64.b64encode(buf.getvalue()).decode("ascii")


class SentinelScanner:
    def run_scan(self, zone_dict: dict, triggered_by: str = "schedule") -> dict:
        """Synchronous entry point — called via loop.run_in_executor() from main.py.
        Internally drives the async fetch/search helpers with asyncio.run()."""
        scan_id = str(uuid.uuid4())
        zone_id = zone_dict.get("id")
        system_id = zone_dict.get("system_id", "unknown")

        from database import SentinelScan, SentinelDetection, WatchZone, get_db

        # Real per-zone historical baseline — average vessel-detection count
        # across this zone's own last 5 completed scans. Previously this was
        # never computed at all: run_ship_detection() was called with its
        # zone_baseline default of 0.0 unconditionally, which makes
        # _vessel_tier()'s `baseline > 0` check always False — every real
        # vessel detection was silently tagged severity="info"/alert_tier=
        # "silent" regardless of how anomalous the count was, so the SAT-TASK
        # alert-routing filter below could never fire for individual vessel
        # detections (only >20-vessel clusters). A zone with fewer than 2
        # prior completed scans has no real baseline yet, so it honestly
        # stays 0.0 rather than guessing one.
        zone_baseline = 0.0
        try:
            with get_db() as _bdb:
                _recent_scans = (
                    _bdb.query(SentinelScan)
                    .filter(SentinelScan.zone_id == zone_id, SentinelScan.status == "completed")
                    .order_by(SentinelScan.created_at.desc())
                    .limit(5)
                    .all()
                )
                if len(_recent_scans) >= 2:
                    _counts = []
                    for _s in _recent_scans:
                        _n = (
                            _bdb.query(SentinelDetection)
                            .filter(SentinelDetection.scan_id == _s.scan_id, SentinelDetection.object_type == "vessel")
                            .count()
                        )
                        _counts.append(_n)
                    zone_baseline = sum(_counts) / len(_counts)
        except Exception as _be:
            print(f"[sentinel-scanner] zone_baseline computation failed for zone={system_id}: {_be}")

        try:
            result = asyncio.run(self._run_scan_async(zone_dict, zone_baseline=zone_baseline))
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
                    image_b64=result.get("image_b64"),
                    instrument=result.get("instrument", "OPTICAL"),
                )
                db.add(scan_row)

                for det in detections:
                    db.add(SentinelDetection(
                        detection_id=f"DET-{uuid.uuid4().hex[:12]}",
                        scan_id=scan_id,
                        zone_id=zone_id,
                        # Real Imagery/Sentinel round update: sar_detector.py
                        # (AllenAI's vessel-detection-sentinels model) is now
                        # restored and wired in via _run_sar_scan_async() above
                        # for any zone with sensor_preference="sentinel1_sar" —
                        # its real detections are already dicts carrying
                        # instrument="SAR" explicitly; every optical detection
                        # still has no "instrument" key of its own, so the
                        # "OPTICAL" default below is what actually applies to
                        # those, not a blanket assumption.
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

            # Real route-to-Inbox (§B7 step 7) — a qualifying finding (any
            # critical/high-severity real detection, or one this scan's own
            # detector flagged "immediate") becomes a real Alert, source
            # 'SAT-TASK', through the same write_alert() funnel every other
            # real alert path uses — not a parallel/fake notification.
            try:
                qualifying = [d for d in detections if d.get("severity") in ("critical", "high") or d.get("alert_tier") == "immediate"]
                if qualifying:
                    import main as _m
                    for d in qualifying[:5]:  # cap — one scan shouldn't flood the Inbox
                        _m.write_alert({
                            "source": "SAT-TASK", "alert_type": f"Sentinel {d.get('object_type', 'detection')}",
                            "title": f"⚠ Sentinel scan: {d.get('object_type', 'object')} detected in {system_id}",
                            "severity": d.get("severity", "medium"),
                            "lat": d.get("centroid_lat"), "lon": d.get("centroid_lon"),
                            "entity_type": d.get("object_type"), "region": None,
                            "raw_json": {"scan_id": scan_id, "zone_id": system_id, "detection": d},
                        })
            except Exception as e:
                print(f"[sentinel-scanner] SAT-TASK routing failed for scan {scan_id}: {e}")
        except Exception as e:
            print(f"[sentinel-scanner] failed to persist scan {scan_id} for zone={system_id}: {e}")

        return {"scan_id": scan_id, "status": result.get("status", "error")}

    async def _run_scan_async(self, zone_dict: dict, zone_baseline: float = 0.0) -> dict:
        from main import _satellite_search_impl, _fetch_sentinel_image_bytes

        min_lon = zone_dict["bbox_min_lon"]; min_lat = zone_dict["bbox_min_lat"]
        max_lon = zone_dict["bbox_max_lon"]; max_lat = zone_dict["bbox_max_lat"]

        # main.py's satellite functions take [west, south, east, north] / {west,south,east,north}
        stac_bbox = [min_lon, min_lat, max_lon, max_lat]
        bounds_wsen = {"west": min_lon, "south": min_lat, "east": max_lon, "north": max_lat}
        # sentinel_ml.py's detection functions take {min_lon,min_lat,max_lon,max_lat}
        ml_bbox = {"min_lon": min_lon, "min_lat": min_lat, "max_lon": max_lon, "max_lat": max_lat}

        # Real SAR branch (Imagery/Sentinel round, Part 4) — a zone whose
        # real sensor_preference is sentinel1_sar runs an entirely
        # different real pipeline (Sentinel-1 raw bands + AllenAI's real
        # vessel-detection-sentinels model, sar_detector.py) instead of the
        # Sentinel-2/YOLO-OBB optical path below. Kept as an early branch
        # here (not interleaved into the optical code) since the two real
        # pipelines share almost nothing — different fetch API, different
        # model, different real scene-freshness source.
        if (zone_dict.get("sensor_preference") or "sentinel2_optical") == "sentinel1_sar":
            return await self._run_sar_scan_async(zone_dict, bounds_wsen)

        import sentinel_ml
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
        search = await _satellite_search_impl(stac_bbox, max_cloud=20, days_back=30)
        if search.get("error"):
            return {"status": "error", "error_message": f"scene search failed: {search['error']}"}
        items = search.get("items") or []
        if not items:
            return {"status": "error",
                    "error_message": "no Sentinel-2 scenes found for this zone in the last 30 days "
                                      "(max_cloud<=20) - cannot report a genuine detection result "
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
                                                         max_cloud=20, days_back=30)
        if img_result.get("error"):
            return {"status": "error", "error_message": f"image fetch failed: {img_result['error']}", **base_meta}

        try:
            tc_image, image_b64 = await _off_loop(_decode_and_encode, img_result["image_bytes"])
        except Exception as e:
            return {"status": "error", "error_message": f"could not decode fetched image: {e}", **base_meta}

        images = {"true_colour": tc_image}
        # Persist the real fetched crop (base64) — the Imagery page's
        # comparison view needs an actual image to render.
        base_meta["image_b64"] = image_b64

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
            ships = await _off_loop(sentinel_ml.run_ship_detection, images, ml_bbox, zone_baseline)
            all_detections.extend(ships)
            by_type["vessel"] = len(ships)
            if any(d.get("alert_tier") == "immediate" for d in ships):
                alert_fired = True

            if "vessel_cluster_detection" in run_tasks:
                clusters = await _off_loop(sentinel_ml.run_vessel_cluster_detection, ships, ml_bbox)
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

    async def _run_sar_scan_async(self, zone_dict: dict, bounds_wsen: dict) -> dict:
        """Real Sentinel-1 SAR scan path (Imagery/Sentinel round, Part 4).
        Fetches real raw VH/VV bands via Sentinel Hub (main.py's
        _fetch_sentinel1_raw_bands_geotiff — the same real OAuth/Process
        API plumbing the optical path's own Sentinel-2 fetch uses) and
        runs AllenAI's real vessel-detection-sentinels model
        (sar_detector.py, restored + deployed this round) end to end.
        Every real detection this returns is tagged instrument="SAR" —
        see SentinelScanner.run_scan()'s own comment on why that's no
        longer always "OPTICAL"."""
        import base64
        from main import _fetch_sentinel1_raw_bands_geotiff
        import sar_detector

        img_result = await _fetch_sentinel1_raw_bands_geotiff(bounds_wsen, max_age_days=30)
        if img_result.get("error"):
            return {"status": "error", "error_message": f"Sentinel-1 image fetch failed: {img_result['error']}", "instrument": "SAR"}

        tiff_bytes = img_result["image_bytes"]
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        base_meta = {
            "instrument": "SAR",
            # Sentinel Hub's mosaickingOrder="mostRecent" resolves the real
            # underlying acquisition server-side but doesn't return its
            # exact timestamp to this request shape — honestly reported as
            # "now" (when this fetch happened) rather than a fabricated
            # acquisition date; cloud_cover/image_age concepts don't apply
            # to a SAR fetch at all (real, deliberate None, not a copy of
            # the optical path's fields).
            "image_id": None,
            "image_timestamp_utc": now_utc.replace(tzinfo=None),
            "cloud_cover_percent": None,
            "image_age_hours": None,
        }

        try:
            sar_dets = await _off_loop(sar_detector.run_sar_ship_detection_from_geotiff_bytes, tiff_bytes)
        except sar_detector.SarDetectorError as e:
            return {"status": "error", "error_message": f"SAR detection failed: {e}", **base_meta}
        except Exception as e:
            return {"status": "error", "error_message": f"SAR detection crashed: {type(e).__name__}: {e}", **base_meta}

        # Real preview image for the Imagery comparison view — generated
        # locally from the same real fetched/rescaled bands rather than a
        # second live Sentinel Hub call, using the false-colour VH/VV/ratio
        # mapping _EVALSCRIPT_SAR_VV_VH already establishes as this app's
        # real SAR visual convention.
        try:
            import numpy as np
            base_meta["image_b64"] = await _off_loop(_sar_preview_b64, tiff_bytes, sar_detector, np)
        except Exception as e:
            print(f"[sentinel-scanner] SAR preview image generation failed (non-fatal): {e}")

        detections = []
        for d in sar_dets:
            detections.append({
                "instrument": "SAR",
                "object_type": "vessel",
                "confidence": d["score"],
                "centroid_lat": d["lat"],
                "centroid_lon": d["lon"],
                "severity": "info",
                "alert_tier": "silent",
                "attributes": json.dumps({
                    "vessel_length_m": round(d["vessel_length_m"], 1),
                    "vessel_width_m": round(d["vessel_width_m"], 1),
                    "vessel_speed_k": round(d["vessel_speed_k"], 2),
                    "heading_bucket_i": d["heading_bucket_i"],
                    "is_fishing_vessel": d["is_fishing_vessel"],
                    "is_fishing_vessel_prob": d["is_fishing_vessel_prob"],
                    "meters_per_pixel": d["meters_per_pixel"],
                }),
            })

        return {
            "status": "completed",
            "result_summary": {"by_type": {"vessel": len(detections)}, "total_detections": len(detections)},
            "raw_result": {"model": "allenai/vessel-detection-sentinels (frcnn_cmp2 + attr)", "instrument": "SAR"},
            "alert_fired": False,
            "detections": detections,
            **base_meta,
        }
