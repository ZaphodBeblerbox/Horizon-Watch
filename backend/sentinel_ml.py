"""
sentinel_ml.py — ML task registry for Sentinel surveillance zone scanning.

Each task receives a dict of PIL Images (one per band combination) and a bbox dict,
and returns a list of detection dicts conforming to the SentinelDetection schema.

Band images are passed as PIL RGB (uint8) images where channels encode:
  true_colour : R=B04, G=B03, B=B02
  swir        : R=B12, G=B11, B=B04  (for smoke/fire)
  nir         : R=B08, G=B04, B=B03  (for water/land mask)
  nbr_pair    : R=B08, G=B12, B=zeros (for burn scar; NBR = (R-G)/(R+G))

Pixel-to-WGS84 affine transform:
  lon = bbox_min_lon + (px / img_w) * (bbox_max_lon - bbox_min_lon)
  lat = bbox_max_lat - (py / img_h) * (bbox_max_lat - bbox_min_lat)
"""

import os
import json
import uuid
import math
import datetime
import threading
from typing import Optional

# ── Required deps ──────────────────────────────────────────────────────────────
import numpy as np
from PIL import Image

# ── ONNX session ────────────────────────────────────────────────────────────
# Ship detection (below) does NOT load its own ONNX session — it delegates to
# main.py's `_get_ort_session`/`_run_inference_on_image`, the same shared YOLO-
# OBB (DOTA) inference pipeline the ESRI/Overwatch draw-a-box path
# (`/api/overwatch/detect`) already uses. This keeps the (correct) oriented-
# bounding-box decode logic — tiled inference, angle extraction, rotated-
# corner math — in exactly one place instead of duplicating it here.
_ML_BASE_DIR = os.path.dirname(__file__)


def _get_obb_session():
    """Return the shared YOLO-OBB (DOTA, yolov8n-obb.onnx) ONNX session via
    main.py's session cache, or None if it failed to load. Imported lazily
    (function-local, not at module top) because main.py imports sentinel_ml
    indirectly through sentinel_scanner.py at call time, not at import time —
    a top-level import here would risk a circular import at process start.
    By the time this is actually called (a real scan is running), main.py is
    already fully loaded."""
    try:
        from main import _get_ort_session
    except ImportError:
        from backend.main import _get_ort_session
    return _get_ort_session("dota")


# ── Geo helpers ────────────────────────────────────────────────────────────────

def _affine(px: float, py: float, img_w: int, img_h: int, bbox: dict) -> tuple:
    """Linear pixel → (lon, lat). bbox keys: min_lon, min_lat, max_lon, max_lat."""
    lon = bbox["min_lon"] + (px / img_w) * (bbox["max_lon"] - bbox["min_lon"])
    lat = bbox["max_lat"] - (py / img_h) * (bbox["max_lat"] - bbox["min_lat"])
    return float(lon), float(lat)


def _px_to_geo_polygon(x1, y1, x2, y2, img_w, img_h, bbox) -> dict:
    """Return a GeoJSON Polygon from pixel bbox corners."""
    lon1, lat1 = _affine(x1, y1, img_w, img_h, bbox)
    lon2, lat2 = _affine(x2, y2, img_w, img_h, bbox)
    lon1, lon2 = min(lon1, lon2), max(lon1, lon2)
    lat1, lat2 = min(lat1, lat2), max(lat1, lat2)
    ring = [[lon1, lat1], [lon2, lat1], [lon2, lat2], [lon1, lat2], [lon1, lat1]]
    return {"type": "Polygon", "coordinates": [ring]}


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _pixel_resolution_m(bbox: dict, img_w: int, img_h: int) -> float:
    """Approximate ground sample distance (m/pixel) at image centre."""
    lat_centre = (bbox["max_lat"] + bbox["min_lat"]) / 2
    lon_span_m = _haversine_m(lat_centre, bbox["min_lon"], lat_centre, bbox["max_lon"])
    lat_span_m = _haversine_m(bbox["min_lat"], bbox["min_lon"], bbox["max_lat"], bbox["min_lon"])
    return min(lon_span_m / max(img_w, 1), lat_span_m / max(img_h, 1))


# ── Detection ID counter ───────────────────────────────────────────────────────

_det_counter      = 0
_det_counter_lock = threading.Lock()


def _next_det_id() -> str:
    """A detection id that is unique across processes and restarts.

    This was a plain in-process counter producing DET-000001 upward, which
    restarts from one every time the backend does. detection_id is UNIQUE in
    the database, so the second run of any scan collided on its first
    detection and the whole insert was rejected — observed as
    "UNIQUE constraint failed: sentinel_detections.detection_id" with the
    scan's findings computed and then thrown away.

    The counter is kept for readable ordering within one run and a short
    random suffix makes the id globally unique.
    """
    global _det_counter
    with _det_counter_lock:
        _det_counter += 1
        n = _det_counter
    return f"DET-{n:06d}-{uuid.uuid4().hex[:6]}"


# ── Alert tier / severity helpers ──────────────────────────────────────────────

def _vessel_tier(count_in_zone: int, baseline: float) -> tuple:
    """Returns (alert_tier, severity) for vessel detection."""
    if baseline > 0 and count_in_zone > baseline * 3:
        return "immediate", "high"
    return "silent", "info"


def interpret_vessel_detection(confidence: float, est_len, est_wid, severity: str, alert_tier: str, baseline: float) -> str:
    """Real, deterministic (non-LLM) plain-English interpretation of one
    detection — same rule_based_summary() convention usage_tracker.py already
    uses elsewhere, not a generated/model-written narrative. Previously
    there was no interpretation step in this pipeline at all; detections
    only ever carried structured fields."""
    size = f"~{est_len:.0f}m x {est_wid:.0f}m" if est_len and est_wid else "size unresolved"
    parts = [f"Vessel detected ({size}), {confidence * 100:.0f}% model confidence."]
    if alert_tier == "immediate":
        parts.append(f"Flagged immediate — count exceeds this zone's real {baseline:.1f}-vessel historical baseline by >3x.")
    elif baseline > 0:
        parts.append(f"Within this zone's real historical baseline (~{baseline:.1f} vessels/scan).")
    else:
        parts.append("No real historical baseline yet for this zone (fewer than 2 prior completed scans).")
    parts.append(f"Severity: {severity}.")
    return " ".join(parts)


def _cluster_tier(vessel_count: int) -> tuple:
    if vessel_count > 20:
        return "immediate", "high"
    if vessel_count > 5:
        return "digest", "medium"
    return "silent", "info"


# ── Water mask helper (from NIR image) ────────────────────────────────────────

def _water_mask(nir_img: Optional[Image.Image], img_w: int, img_h: int) -> np.ndarray:
    """Return boolean mask where True = water. Uses NIR B08 (low reflectance = water)."""
    if nir_img is None:
        # Fallback: assume all pixels are water (maritime zone)
        return np.ones((img_h, img_w), dtype=bool)
    arr = np.array(nir_img.convert("RGB"), dtype=np.float32)
    nir_channel = arr[:, :, 0] / 255.0   # R channel = B08
    return nir_channel < 0.1             # low NIR = water


# ── Connected components (pure numpy) ─────────────────────────────────────────

def _find_blobs(mask: np.ndarray, min_pixels: int = 10):
    """
    Simple connected-component labelling via flood fill.
    Returns list of (row_indices, col_indices) per component.
    Avoids scipy dependency.
    """
    try:
        from scipy.ndimage import label as _scipy_label
        labeled, n = _scipy_label(mask)
        blobs = []
        for i in range(1, n + 1):
            rows, cols = np.where(labeled == i)
            if len(rows) >= min_pixels:
                blobs.append((rows, cols))
        return blobs
    except ImportError:
        pass

    # Pure numpy BFS fallback — limited to first 200 blobs for speed
    visited = np.zeros_like(mask, dtype=bool)
    blobs   = []
    rows_y, cols_x = np.where(mask)
    seed_set = list(zip(rows_y.tolist(), cols_x.tolist()))

    for sy, sx in seed_set:
        if visited[sy, sx]:
            continue
        queue = [(sy, sx)]
        comp_r, comp_c = [], []
        head = 0
        while head < len(queue):
            r, c = queue[head]; head += 1
            if r < 0 or r >= mask.shape[0] or c < 0 or c >= mask.shape[1]:
                continue
            if visited[r, c] or not mask[r, c]:
                continue
            visited[r, c] = True
            comp_r.append(r); comp_c.append(c)
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < mask.shape[0] and 0 <= nc < mask.shape[1] and not visited[nr, nc] and mask[nr, nc]:
                    queue.append((nr, nc))
        if len(comp_r) >= min_pixels:
            blobs.append((np.array(comp_r), np.array(comp_c)))
        if len(blobs) >= 200:
            break
    return blobs


# ═════════════════════════════════════════════════════════════════════════════
# TASK IMPLEMENTATIONS
# ═════════════════════════════════════════════════════════════════════════════

def run_ship_detection(images: dict, bbox: dict, zone_baseline: float = 0.0) -> list:
    """
    TASK: ship_detection
    Band: True Colour (true_colour key).

    Real functional fix (2026-08): this used to run a plain axis-aligned-box
    COCO YOLOv8n detector (yolov8n.onnx, filtered to class "boat") — a model
    trained on ordinary photos, a meaningfully worse fit for overhead
    Sentinel-2 imagery where ships appear at arbitrary headings. It now
    delegates to main.py's `_run_inference_on_image` — the same tiled
    YOLO-OBB (DOTA, yolov8n-obb.onnx) inference pipeline the ESRI/Overwatch
    draw-a-box path already uses — so this module does not maintain a second,
    independent OBB-decoding implementation. Only the SentinelDetection-shape
    conversion below is specific to this module; the actual box/angle decode
    math lives in exactly one place (main.py).

    Returns vessel detections with a real oriented (angle-aware) geo polygon
    built from the model's rotated corners — not an axis-aligned bbox —
    plus estimated length/width and centroid.
    """
    tc = images.get("true_colour")
    if tc is None:
        return []

    img_w, img_h = tc.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)

    try:
        from main import _run_inference_on_image
    except ImportError:
        from backend.main import _run_inference_on_image

    # main.py's inference helper takes {north,south,east,west}; this module's
    # callers (sentinel_scanner.py) pass {min_lon,min_lat,max_lon,max_lat}.
    bounds_nsew = {
        "north": bbox["max_lat"], "south": bbox["min_lat"],
        "east":  bbox["max_lon"], "west":  bbox["min_lon"],
    }
    result = _run_inference_on_image(
        tc, bounds_nsew, confidence=0.25, enhance=False,
        model_key="dota", keep_px=True,
    )
    # DOTA's 15 classes include "ship" but no "boat" — this is the maritime one.
    raw = [d for d in (result.get("detections") or []) if d.get("class") == "ship"]

    alert_tier, severity = _vessel_tier(len(raw), zone_baseline)
    detections = []
    for r in raw:
        corners = r.get("corners") or []   # 4x [lat, lon], in rotated OBB order
        center  = r.get("center") or [0.0, 0.0]
        lat, lon = float(center[0]), float(center[1])

        geo_poly = None
        est_len = est_wid = area_m2 = angle_deg = None
        if len(corners) == 4:
            # Build the polygon from the actual rotated corners (not a
            # min/max axis-aligned box) so orientation survives into the
            # stored geometry — the entire point of switching to OBB.
            ring = [[float(c[1]), float(c[0])] for c in corners]  # [lon, lat]
            ring.append(ring[0])
            geo_poly = {"type": "Polygon", "coordinates": [ring]}

            side_a = _haversine_m(corners[0][0], corners[0][1], corners[1][0], corners[1][1])
            side_b = _haversine_m(corners[1][0], corners[1][1], corners[2][0], corners[2][1])
            est_len = round(max(side_a, side_b), 1)
            est_wid = round(min(side_a, side_b), 1)
            area_m2 = round(side_a * side_b, 1)
            dy = corners[1][0] - corners[0][0]
            dx = corners[1][1] - corners[0][1]
            angle_deg = round(math.degrees(math.atan2(dy, dx)) % 180, 1)

        px = r.get("_px")
        detections.append({
            "detection_id":    _next_det_id(),
            "object_type":     "vessel",
            "confidence":      round(float(r.get("confidence", 0.0)), 3),
            "centroid_lat":    round(lat, 6),
            "centroid_lon":    round(lon, 6),
            "geo_geometry":    json.dumps(geo_poly) if geo_poly else None,
            "area_m2":         area_m2,
            "severity":        severity,
            "alert_tier":      alert_tier,
            "matched_to_ais":  False,
            "attributes":      json.dumps({
                "pixel_bbox":         ({"x_min": px[0], "y_min": px[1], "x_max": px[2], "y_max": px[3]}
                                        if px else None),
                "estimated_length_m": est_len,
                "estimated_width_m":  est_wid,
                "pixel_resolution_m": round(res_m, 2),
                "geolocation_uncertainty_m": round(res_m * 1.5, 1),
                "yolo_class":         r.get("class", "ship"),
                "obb_angle_deg":      angle_deg,
                "model":              "yolov8n-obb (DOTA)",
                "interpretation":     interpret_vessel_detection(
                    r.get("confidence", 0.0), est_len, est_wid, severity, alert_tier, zone_baseline,
                ),
            }),
        })
    return detections


def run_vessel_cluster_detection(ship_detections: list, bbox: dict) -> list:
    """
    TASK: vessel_cluster_detection
    Groups ship_detection results within 500m of each other.
    """
    if not ship_detections:
        return []

    points = [(d["centroid_lat"], d["centroid_lon"]) for d in ship_detections]
    used   = [False] * len(points)
    clusters = []

    for i, (lat_i, lon_i) in enumerate(points):
        if used[i]:
            continue
        cluster_indices = [i]
        for j, (lat_j, lon_j) in enumerate(points):
            if i == j or used[j]:
                continue
            if _haversine_m(lat_i, lon_i, lat_j, lon_j) <= 500:
                cluster_indices.append(j)
        if len(cluster_indices) < 2:
            continue
        for idx in cluster_indices:
            used[idx] = True
        lats = [points[k][0] for k in cluster_indices]
        lons = [points[k][1] for k in cluster_indices]
        clat = sum(lats) / len(lats)
        clon = sum(lons) / len(lons)
        count = len(cluster_indices)
        alert_tier, severity = _cluster_tier(count)
        clusters.append({
            "detection_id":  _next_det_id(),
            "object_type":   "vessel_cluster",
            "confidence":    0.9,
            "centroid_lat":  round(clat, 6),
            "centroid_lon":  round(clon, 6),
            "geo_geometry":  json.dumps({
                "type": "Point",
                "coordinates": [round(clon, 6), round(clat, 6)],
            }),
            "area_m2":       None,
            "severity":      severity,
            "alert_tier":    alert_tier,
            "matched_to_ais": False,
            "attributes":    json.dumps({
                "vessel_count":  count,
                "cluster_span_m": round(max(
                    _haversine_m(min(lats), min(lons), max(lats), max(lons)), 0
                ), 1),
            }),
        })
    return clusters


def run_smoke_plume_detection(images: dict, bbox: dict) -> list:
    """
    TASK: smoke_plume_detection
    Multi-condition: SWIR B12 in smoke range (0.15–0.45), visible bands darkened,
    area > 5000 m², elongated shape (major axis > 3x minor axis).
    """
    swir = images.get("swir")
    tc   = images.get("true_colour")
    if swir is None:
        return []

    img_w, img_h = swir.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)
    arr_swir = np.array(swir.convert("RGB"), dtype=np.float32) / 255.0

    # Condition 1: SWIR B12 elevated but not extreme (smoke range)
    smoke_mask = (arr_swir[:, :, 0] > 0.15) & (arr_swir[:, :, 0] < 0.45)

    # Condition 2: visible bands reduced reflectance (smoke darkens visible)
    if tc is not None:
        tc_resized = tc.resize((img_w, img_h), Image.BILINEAR) if tc.size != (img_w, img_h) else tc
        arr_tc = np.array(tc_resized.convert("RGB"), dtype=np.float32) / 255.0
        vis_mean = arr_tc.mean(axis=2)
        smoke_mask = smoke_mask & (vis_mean > 0.05) & (vis_mean < 0.55)

    # Condition 3: area > 5000 m²
    min_pixels = max(10, int(5000 / (res_m ** 2 + 1e-6)))
    blobs = _find_blobs(smoke_mask, min_pixels=min_pixels)

    detections = []
    for rows, cols in blobs:
        area_m2 = len(rows) * (res_m ** 2)

        # Condition 4: shape must be elongated — major axis variance > 9x minor axis variance
        if len(rows) > 5:
            cov = np.cov(np.stack([cols.astype(float), rows.astype(float)]))
            eigvals, eigvecs = np.linalg.eigh(cov)
            min_eigval = max(float(eigvals.min()), 1e-6)
            axis_ratio = float(eigvals.max()) / min_eigval
            if axis_ratio < 9.0:  # sqrt(9)=3 → major std > 3x minor std
                continue
            major    = eigvecs[:, eigvals.argmax()]
            angle_deg = round(math.degrees(math.atan2(float(major[1]), float(major[0]))) % 360, 1)
        else:
            angle_deg = None

        cy_px = float(rows.mean()); cx_px = float(cols.mean())
        lon, lat = _affine(cx_px, cy_px, img_w, img_h, bbox)
        r1, c1, r2, c2 = rows.min(), cols.min(), rows.max(), cols.max()
        geo_poly = _px_to_geo_polygon(float(c1), float(r1), float(c2), float(r2), img_w, img_h, bbox)

        detections.append({
            "detection_id":   _next_det_id(),
            "object_type":    "smoke_plume",
            "confidence":     round(min(0.95, 0.6 + area_m2 / 1e6), 3),
            "centroid_lat":   round(lat, 6),
            "centroid_lon":   round(lon, 6),
            "geo_geometry":   json.dumps(geo_poly),
            "area_m2":        round(area_m2, 1),
            "severity":       "high",
            "alert_tier":     "immediate",
            "matched_to_ais": False,
            "attributes":     json.dumps({
                "plume_area_m2":      round(area_m2, 1),
                "wind_direction_deg": angle_deg,
                "pixel_count":        int(len(rows)),
            }),
        })
    return detections


def run_fire_detection(images: dict, bbox: dict) -> list:
    """
    TASK: fire_detection
    Multi-condition filter to eliminate sun glint, clouds, and ocean false positives.
    All conditions must be true: B12>0.5, B11>0.3, B08<0.3 (cloud), B02<0.2 (glint),
    NDWI<=0 (not water), min cluster 9 pixels.
    Sanity cap: >50 detections → flag result unreliable.
    """
    swir = images.get("swir")
    nir  = images.get("nir")
    tc   = images.get("true_colour")
    if swir is None:
        return []

    img_w, img_h = swir.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)
    arr_swir = np.array(swir.convert("RGB"), dtype=np.float32) / 255.0

    # Condition 1 & 2: B12 > 0.5 (SWIR-2 R) and B11 > 0.3 (SWIR-1 G)
    fire_mask = (arr_swir[:, :, 0] > 0.5) & (arr_swir[:, :, 1] > 0.3)

    if nir is not None:
        nir_resized = nir.resize((img_w, img_h), Image.BILINEAR) if nir.size != (img_w, img_h) else nir
        arr_nir = np.array(nir_resized.convert("RGB"), dtype=np.float32) / 255.0
        b08 = arr_nir[:, :, 0]  # R=B08
        b03 = arr_nir[:, :, 2]  # B=B03
        # Condition 3: B08 < 0.3 — eliminates clouds (clouds are bright NIR)
        fire_mask = fire_mask & (b08 < 0.3)
        # Condition 5: NDWI = (B03 - B08) / (B03 + B08); NDWI > 0 = water → skip
        ndwi_denom = b03 + b08 + 1e-6
        ndwi = (b03 - b08) / ndwi_denom
        fire_mask = fire_mask & (ndwi <= 0.0)
    else:
        # Fallback water mask
        water = _water_mask(None, img_w, img_h)
        fire_mask = fire_mask & ~water

    if tc is not None:
        tc_resized = tc.resize((img_w, img_h), Image.BILINEAR) if tc.size != (img_w, img_h) else tc
        arr_tc = np.array(tc_resized.convert("RGB"), dtype=np.float32) / 255.0
        # Condition 4: B02 < 0.2 — eliminates sun glint (glint is bright blue)
        fire_mask = fire_mask & (arr_tc[:, :, 2] < 0.2)

    # Condition 6: minimum 9 connected pixels (900 m² at 10m res)
    min_pixels = max(9, int(900 / (res_m ** 2 + 1e-6)))
    blobs = _find_blobs(fire_mask, min_pixels=min_pixels)

    HIGH_FP_THRESHOLD = 50
    detections = []
    for rows, cols in blobs:
        cy_px   = float(rows.mean()); cx_px = float(cols.mean())
        area_m2 = len(rows) * (res_m ** 2)
        lon, lat = _affine(cx_px, cy_px, img_w, img_h, bbox)
        r1, c1, r2, c2 = rows.min(), cols.min(), rows.max(), cols.max()
        geo_poly = _px_to_geo_polygon(float(c1), float(r1), float(c2), float(r2), img_w, img_h, bbox)

        severity = "critical" if area_m2 > 100_000 else "high"
        b12_vals = arr_swir[:, :, 0][rows, cols]
        detections.append({
            "detection_id":   _next_det_id(),
            "object_type":    "fire",
            "confidence":     round(min(0.97, 0.7 + area_m2 / 5e5), 3),
            "centroid_lat":   round(lat, 6),
            "centroid_lon":   round(lon, 6),
            "geo_geometry":   json.dumps(geo_poly),
            "area_m2":        round(area_m2, 1),
            "severity":       severity,
            "alert_tier":     "immediate",
            "matched_to_ais": False,
            "attributes":     json.dumps({
                "fire_area_m2": round(area_m2, 1),
                "pixel_count":  int(len(rows)),
                "b12_max":      round(float(b12_vals.max()), 3),
                "b12_mean":     round(float(b12_vals.mean()), 3),
            }),
        })

    if len(detections) > HIGH_FP_THRESHOLD:
        for d in detections:
            attrs = json.loads(d.get("attributes") or "{}")
            attrs["high_false_positive_risk"] = True
            d["attributes"] = json.dumps(attrs)

    return detections


def run_burn_scar_detection(images: dict, bbox: dict) -> list:
    """
    TASK: burn_scar_detection
    Band: nbr_pair (R=B08, G=B12). NBR = (B08-B12)/(B08+B12). Burn scars: NBR < -0.1.
    Alert tier: digest unless area > 1 km² then immediate.
    """
    nbr_img = images.get("nbr_pair")
    if nbr_img is None:
        return []

    img_w, img_h = nbr_img.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)
    arr   = np.array(nbr_img.convert("RGB"), dtype=np.float32) / 255.0

    b08 = arr[:, :, 0]; b12 = arr[:, :, 1]
    denom = b08 + b12 + 1e-6
    nbr   = (b08 - b12) / denom

    burn_mask = nbr < -0.1
    min_pixels = max(10, int(5000 / (res_m ** 2 + 1e-6)))
    blobs = _find_blobs(burn_mask, min_pixels=min_pixels)

    detections = []
    for rows, cols in blobs:
        cy_px   = float(rows.mean()); cx_px = float(cols.mean())
        area_m2 = len(rows) * (res_m ** 2)
        lon, lat = _affine(cx_px, cy_px, img_w, img_h, bbox)
        r1, c1, r2, c2 = rows.min(), cols.min(), rows.max(), cols.max()
        geo_poly = _px_to_geo_polygon(float(c1), float(r1), float(c2), float(r2), img_w, img_h, bbox)
        delta_nbr = round(float(nbr[rows, cols].mean()), 4)
        alert_tier = "immediate" if area_m2 > 1_000_000 else "digest"
        severity   = "high" if area_m2 > 1_000_000 else "medium"

        detections.append({
            "detection_id":   _next_det_id(),
            "object_type":    "burn_scar",
            "confidence":     round(min(0.90, 0.55 + abs(delta_nbr) * 2), 3),
            "centroid_lat":   round(lat, 6),
            "centroid_lon":   round(lon, 6),
            "geo_geometry":   json.dumps(geo_poly),
            "area_m2":        round(area_m2, 1),
            "severity":       severity,
            "alert_tier":     alert_tier,
            "matched_to_ais": False,
            "attributes":     json.dumps({
                "burn_area_m2":  round(area_m2, 1),
                "delta_nbr":     delta_nbr,
                "pixel_count":   int(len(rows)),
            }),
        })
    return detections


def run_oil_slick_detection(images: dict, bbox: dict,
                             nearest_port: Optional[str] = None,
                             nearest_infra: Optional[str] = None) -> list:
    """
    TASK: oil_slick_detection
    Band: True Colour. Oil appears dark and smooth on water (low R+G+B variance).
    Alert tier: immediate if near port or infra, digest otherwise.
    """
    tc  = images.get("true_colour")
    nir = images.get("nir")
    if tc is None:
        return []

    img_w, img_h = tc.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)
    arr   = np.array(tc.convert("RGB"), dtype=np.float32) / 255.0

    water = _water_mask(nir, img_w, img_h)
    # Oil: dark pixels over water — mean of all channels < 0.12
    brightness = arr.mean(axis=2)
    oil_mask   = (brightness < 0.12) & water

    # Smooth blob filter: compute local variance; low variance = smooth slick
    from numpy.lib.stride_tricks import as_strided  # pure numpy, no scipy
    win = 5
    pad_b = np.pad(brightness, win // 2, mode="edge")
    # Approximate local std via sliding window mean of (x - mean)^2
    h, w = img_h, img_w
    shape   = (h, w, win, win)
    strides = pad_b.strides * 2
    try:
        patches = as_strided(pad_b, shape=shape, strides=strides, writeable=False)
        local_std = patches.reshape(h, w, -1).std(axis=2)
        smooth_mask = local_std < 0.04
    except Exception:
        smooth_mask = np.ones((img_h, img_w), dtype=bool)

    oil_mask = oil_mask & smooth_mask
    min_pixels = max(10, int(10_000 / (res_m ** 2 + 1e-6)))
    blobs = _find_blobs(oil_mask, min_pixels=min_pixels)

    detections = []
    for rows, cols in blobs:
        cy_px   = float(rows.mean()); cx_px = float(cols.mean())
        area_m2 = len(rows) * (res_m ** 2)
        lon, lat = _affine(cx_px, cy_px, img_w, img_h, bbox)
        r1, c1, r2, c2 = rows.min(), cols.min(), rows.max(), cols.max()
        geo_poly = _px_to_geo_polygon(float(c1), float(r1), float(c2), float(r2), img_w, img_h, bbox)

        near_critical = bool(nearest_port or nearest_infra)
        alert_tier = "immediate" if near_critical else "digest"
        severity   = "high" if near_critical else "medium"

        detections.append({
            "detection_id":          _next_det_id(),
            "object_type":           "oil_slick",
            "confidence":            round(min(0.85, 0.50 + area_m2 / 5e5), 3),
            "centroid_lat":          round(lat, 6),
            "centroid_lon":          round(lon, 6),
            "geo_geometry":          json.dumps(geo_poly),
            "area_m2":               round(area_m2, 1),
            "severity":              severity,
            "alert_tier":            alert_tier,
            "nearest_port":          nearest_port,
            "nearest_infrastructure": nearest_infra,
            "matched_to_ais":        False,
            "attributes":            json.dumps({
                "slick_area_m2":  round(area_m2, 1),
                "pixel_count":    int(len(rows)),
                "near_critical":  near_critical,
            }),
        })
    return detections


def run_infrastructure_change_detection(images: dict, baseline_images: Optional[dict],
                                         bbox: dict) -> list:
    """
    TASK: infrastructure_change_detection
    Band: True Colour. Compare current vs baseline via mean absolute difference.
    Flags areas with MAD > 0.15 (proxy for SSIM < 0.7).
    Alert tier: digest unless change > 10 000 m² then immediate.
    """
    tc      = images.get("true_colour")
    tc_base = (baseline_images or {}).get("true_colour")
    if tc is None:
        return []
    if tc_base is None:
        # No baseline — cannot detect changes
        return []

    img_w, img_h = tc.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)

    try:
        arr_cur  = np.array(tc.convert("RGB"),      dtype=np.float32) / 255.0
        arr_base = np.array(tc_base.resize((img_w, img_h), Image.BILINEAR).convert("RGB"),
                            dtype=np.float32) / 255.0
    except Exception as e:
        print(f"[sentinel_ml] infra_change resize error: {e}")
        return []

    diff = np.abs(arr_cur - arr_base).mean(axis=2)
    change_mask = diff > 0.15
    min_pixels  = max(10, int(1000 / (res_m ** 2 + 1e-6)))
    blobs = _find_blobs(change_mask, min_pixels=min_pixels)

    detections = []
    for rows, cols in blobs:
        cy_px   = float(rows.mean()); cx_px = float(cols.mean())
        area_m2 = len(rows) * (res_m ** 2)
        lon, lat = _affine(cx_px, cy_px, img_w, img_h, bbox)
        r1, c1, r2, c2 = rows.min(), cols.min(), rows.max(), cols.max()
        geo_poly   = _px_to_geo_polygon(float(c1), float(r1), float(c2), float(r2), img_w, img_h, bbox)
        mean_diff  = round(float(diff[rows, cols].mean()), 4)
        alert_tier = "immediate" if area_m2 > 10_000 else "digest"
        severity   = "high" if area_m2 > 10_000 else "medium"

        detections.append({
            "detection_id":   _next_det_id(),
            "object_type":    "infrastructure_change",
            "confidence":     round(min(0.85, 0.5 + mean_diff * 2), 3),
            "centroid_lat":   round(lat, 6),
            "centroid_lon":   round(lon, 6),
            "geo_geometry":   json.dumps(geo_poly),
            "area_m2":        round(area_m2, 1),
            "severity":       severity,
            "alert_tier":     alert_tier,
            "matched_to_ais": False,
            "attributes":     json.dumps({
                "change_area_m2":   round(area_m2, 1),
                "mean_pixel_delta": mean_diff,
                "pixel_count":      int(len(rows)),
                "change_type":      "construction" if mean_diff > 0.3 else "modification",
            }),
        })
    return detections


def run_vessel_without_ais(ship_detections: list, ais_vessels: list,
                            bbox: dict,
                            nearest_infra: Optional[str] = None,
                            nearest_chokepoint: Optional[str] = None) -> list:
    """
    TASK: vessel_without_ais_detection
    Cross-references ship_detections against AIS vessels within 1 km.
    ais_vessels: list of {lat, lon, mmsi, name} at image timestamp.
    Returns detections where no AIS match was found within 1 km.
    """
    dark_detections = []
    for det in ship_detections:
        lat, lon = det["centroid_lat"], det["centroid_lon"]
        matched = any(
            _haversine_m(lat, lon, v.get("lat", 0), v.get("lon", 0)) <= 1000
            for v in ais_vessels
        )
        if matched:
            continue  # vessel has AIS, skip

        near_critical = bool(nearest_infra or nearest_chokepoint)
        alert_tier = "immediate" if near_critical else "digest"
        severity   = "high" if near_critical else "medium"

        # Inherit geo from ship detection
        attrs = {}
        if det.get("attributes"):
            try:
                attrs = json.loads(det["attributes"])
            except Exception:
                pass
        attrs["ais_search_radius_m"]       = 1000
        attrs["nearest_ais_vessel"]        = None
        attrs["near_critical_infra"]       = near_critical

        dark_detections.append({
            "detection_id":          _next_det_id(),
            "object_type":           "vessel_without_ais",
            "confidence":            det.get("confidence", 0.6),
            "centroid_lat":          lat,
            "centroid_lon":          lon,
            "geo_geometry":          det.get("geo_geometry"),
            "area_m2":               det.get("area_m2"),
            "severity":              severity,
            "alert_tier":            alert_tier,
            "matched_to_ais":        False,
            "nearest_infrastructure": nearest_infra,
            "nearest_chokepoint":    nearest_chokepoint,
            "attributes":            json.dumps(attrs),
        })
    return dark_detections


# ═════════════════════════════════════════════════════════════════════════════
# TASK REGISTRY — maps task_name → runner function signature
# ═════════════════════════════════════════════════════════════════════════════

#  Each entry: {
#    "requires": list of image keys needed,
#    "runner":   callable,
#    "alert_tier_default": str,
#  }

TASK_REGISTRY: dict = {
    "ship_detection": {
        "requires":           ["true_colour"],  # Sentinel-2 true-colour via Copernicus
        "alert_tier_default": "silent",
        "description":        "Detect vessels using YOLOv8 OBB (DOTA) on Sentinel-2 true-colour",
    },
    "vessel_cluster_detection": {
        "requires":           ["true_colour"],
        "alert_tier_default": "digest",
        "description":        "Group vessel detections within 500m into clusters",
        "depends_on":         "ship_detection",
    },
    "smoke_plume_detection": {
        "requires":           ["swir", "true_colour"],  # pre-fetched Sentinel bands
        "alert_tier_default": "immediate",
        "description":        "Detect smoke plumes via SWIR thresholding",
    },
    "fire_detection": {
        "requires":           ["swir", "nir"],          # pre-fetched Sentinel bands
        "alert_tier_default": "immediate",
        "description":        "Detect active fire pixels via SWIR-2 thresholding",
    },
    "burn_scar_detection": {
        "requires":           ["nbr_pair"],
        "alert_tier_default": "digest",
        "description":        "Detect burn scars via NBR index",
    },
    "oil_slick_detection": {
        "requires":           ["true_colour", "nir"],
        "alert_tier_default": "digest",
        "description":        "Detect oil slicks as dark smooth regions over water",
    },
    "infrastructure_change_detection": {
        "requires":           ["true_colour"],
        "alert_tier_default": "digest",
        "description":        "Detect infrastructure changes vs baseline imagery",
        "needs_baseline":     True,
    },
    "vessel_without_ais_detection": {
        "requires":           ["true_colour"],
        "alert_tier_default": "digest",
        "description":        "Cross-reference vessel detections against AIS snapshot",
        "depends_on":         "ship_detection",
    },
}

# Band combinations required per image key:
BAND_REQUIREMENTS: dict = {
    "true_colour": "true-colour",      # B04/B03/B02
    "swir":        "swir",             # B12/B11/B04
    "nir":         "false-colour",     # B08/B04/B03
    "nbr_pair":    "false-colour",     # repurpose false-colour as B08 proxy
}


# ── multi-class detection ─────────────────────────────────────────────────
#
# WHY THIS EXISTS. run_ship_detection() above runs the full 15-class DOTA
# model and then throws 14 of the classes away:
#
#     raw = [d for d in result["detections"] if d.get("class") == "ship"]
#
# The planes, storage tanks, harbours, bridges and vehicles were detected on
# every scan since the OBB switch and discarded at that line. The targets the
# product actually wants — aircraft on an airfield, new storage capacity at a
# terminal, vehicle concentrations — were already being found and dropped.
#
# This keeps them. run_ship_detection is left untouched: it carries vessel
# specific baseline/tiering logic, and quietly widening what it returns would
# change the meaning of every existing vessel alert.

# DOTA class -> the object_type stored on a SentinelDetection row.
_DOTA_OBJECT_TYPE = {
    "ship":               "vessel",
    "harbor":             "port_infrastructure",
    "plane":              "aircraft",
    "helicopter":         "aircraft",
    "storage-tank":       "storage_tank",
    "bridge":             "bridge",
    "large-vehicle":      "vehicle",      # a truck or bus, NOT a vessel
    "small-vehicle":      "vehicle",
    "roundabout":         "road_feature",
    "container-crane":    "port_infrastructure",
    "airport":            "airfield",
    "helipad":            "airfield",
    # The sports/recreation classes are real DOTA outputs but carry no
    # intelligence value here. Mapped, not dropped, so a caller can filter
    # them deliberately rather than wonder where they went.
    "baseball-diamond":   "recreation",
    "tennis-court":       "recreation",
    "basketball-court":   "recreation",
    "ground-track-field": "recreation",
    "soccer-ball-field":  "recreation",
    "swimming-pool":      "recreation",
}

# Classes that are noise for this product unless explicitly requested.
LOW_VALUE_TYPES = {"recreation", "road_feature"}


def run_object_detection(images: dict, bbox: dict, *,
                         confidence: float = 0.25,
                         include_low_value: bool = False,
                         instrument: str = "OPTICAL") -> list:
    """Detect every DOTA class over one image, not just ships.

    Returns SentinelDetection-shaped dicts. Severity is deliberately left at
    "info"/"silent": what makes an object notable is whether it is NEW or
    GONE relative to the last scan of the same area, which this function
    cannot know from a single image. Assigning severity here would mean
    inventing significance from one observation.
    """
    tc = images.get("true_colour")
    if tc is None:
        return []

    img_w, img_h = tc.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)

    try:
        from main import _run_inference_on_image
    except ImportError:
        from backend.main import _run_inference_on_image

    bounds_nsew = {
        "north": bbox["max_lat"], "south": bbox["min_lat"],
        "east":  bbox["max_lon"], "west":  bbox["min_lon"],
    }
    result = _run_inference_on_image(
        tc, bounds_nsew, confidence=confidence, enhance=False,
        model_key="dota", keep_px=True,
    )

    out = []
    for r in (result.get("detections") or []):
        cls = r.get("class")
        obj_type = _DOTA_OBJECT_TYPE.get(cls)
        if obj_type is None:
            continue
        if obj_type in LOW_VALUE_TYPES and not include_low_value:
            continue

        corners = r.get("corners") or []
        center  = r.get("center") or [0.0, 0.0]
        lat, lon = float(center[0]), float(center[1])

        geo_poly = None
        est_len = est_wid = area_m2 = angle_deg = None
        if len(corners) == 4:
            ring = [[float(c[1]), float(c[0])] for c in corners]
            ring.append(ring[0])
            geo_poly = {"type": "Polygon", "coordinates": [ring]}
            side_a = _haversine_m(corners[0][0], corners[0][1], corners[1][0], corners[1][1])
            side_b = _haversine_m(corners[1][0], corners[1][1], corners[2][0], corners[2][1])
            est_len = round(max(side_a, side_b), 1)
            est_wid = round(min(side_a, side_b), 1)
            area_m2 = round(side_a * side_b, 1)
            dy = corners[1][0] - corners[0][0]
            dx = corners[1][1] - corners[0][1]
            angle_deg = round(math.degrees(math.atan2(dy, dx)) % 180, 1)

        px = r.get("_px")
        out.append({
            "detection_id":   _next_det_id(),
            "object_type":    obj_type,
            "instrument":     instrument,
            "confidence":     round(float(r.get("confidence", 0.0)), 3),
            "centroid_lat":   round(lat, 6),
            "centroid_lon":   round(lon, 6),
            "geo_geometry":   json.dumps(geo_poly) if geo_poly else None,
            "area_m2":        area_m2,
            "severity":       "info",
            "alert_tier":     "silent",
            "matched_to_ais": False,
            "attributes":     json.dumps({
                "pixel_bbox": ({"x_min": px[0], "y_min": px[1], "x_max": px[2], "y_max": px[3]}
                               if px else None),
                "estimated_length_m": est_len,
                "estimated_width_m":  est_wid,
                "pixel_resolution_m": round(res_m, 2),
                # How far a centroid could really be from the truth. Reporting
                # a 6-decimal coordinate from a 20 m/px image without this
                # would imply a precision the sensor does not have.
                "geolocation_uncertainty_m": round(res_m * 1.5, 1),
                "yolo_class":  cls,
                "obb_angle_deg": angle_deg,
                "model": "yolov8n-obb (DOTA)",
            }),
        })
    return out
