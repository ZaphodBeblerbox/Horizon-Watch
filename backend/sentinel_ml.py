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
import math
import datetime
import threading
from typing import Optional

# ── Required deps ──────────────────────────────────────────────────────────────
import numpy as np
from PIL import Image

# ── ONNX session (shared with main.py via lazy load) ──────────────────────────
_ML_BASE_DIR   = os.path.dirname(__file__)
_ort_lock      = threading.Lock()
_ort_sessions: dict = {}


def _load_ort_session(model_key: str = "coco"):
    """Lazy-load ONNX session. coco=yolov8n.onnx for ship detection."""
    with _ort_lock:
        if model_key in _ort_sessions:
            return _ort_sessions[model_key]
        try:
            import onnxruntime as ort
            fname = "yolov8n-obb.onnx" if model_key == "dota" else "yolov8n.onnx"
            path  = os.path.join(_ML_BASE_DIR, fname)
            sess  = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            _ort_sessions[model_key] = sess
            print(f"[sentinel_ml] loaded {fname}")
        except Exception as e:
            print(f"[sentinel_ml] session load failed ({model_key}): {e}")
            _ort_sessions[model_key] = None
        return _ort_sessions[model_key]


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


# ── NMS ────────────────────────────────────────────────────────────────────────

def _nms(boxes_xyxy: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45):
    if len(boxes_xyxy) == 0:
        return []
    x1, y1, x2, y2 = boxes_xyxy[:, 0], boxes_xyxy[:, 1], boxes_xyxy[:, 2], boxes_xyxy[:, 3]
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size > 0:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]]); yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]]); yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[np.where(iou <= iou_threshold)[0] + 1]
    return keep


# ── Sliding window ONNX inference ─────────────────────────────────────────────

WINDOW_SZ = 640
STRIDE    = 320   # 50 % overlap


def _run_yolo_sliding_window(img: Image.Image, confidence: float = 0.25,
                              model_key: str = "coco") -> list:
    """
    Run YOLOv8 (COCO) on `img` using a 640×640 sliding window with 320px stride.
    Returns list of dicts: {x1,y1,x2,y2,confidence,class_id,class_name,
                             cx,cy,w_px,h_px}  in full-image pixel coords.
    """
    session = _load_ort_session(model_key)
    if session is None:
        return []

    img_arr = np.array(img.convert("RGB"), dtype=np.float32)
    img_h, img_w = img_arr.shape[:2]

    # COCO class names (80 classes) — we care about "boat", "ship"
    COCO_NAMES = [
        "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
        "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
        "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
        "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard",
        "sports ball","kite","baseball bat","baseball glove","skateboard","surfboard",
        "tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl",
        "banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza",
        "donut","cake","chair","couch","potted plant","bed","dining table","toilet",
        "tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven",
        "toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear",
        "hair drier","toothbrush",
    ]

    def _tile_starts(dim):
        if dim <= WINDOW_SZ:
            return [0]
        starts = list(range(0, dim - WINDOW_SZ, STRIDE))
        if starts and starts[-1] + WINDOW_SZ < dim:
            starts.append(dim - WINDOW_SZ)
        return starts if starts else [0]

    xs_starts = _tile_starts(img_w)
    ys_starts = _tile_starts(img_h)

    all_boxes: list  = []
    all_scores: list = []
    all_cls: list    = []

    for ty in ys_starts:
        for tx in xs_starts:
            tw = min(WINDOW_SZ, img_w - tx)
            th = min(WINDOW_SZ, img_h - ty)
            tile = img_arr[ty:ty + th, tx:tx + tw]

            # Letterbox to 640×640
            scale = min(WINDOW_SZ / tw, WINDOW_SZ / th)
            nw, nh = int(tw * scale), int(th * scale)
            resized = Image.fromarray(tile.astype(np.uint8)).resize((nw, nh), Image.BILINEAR)
            pad_img = np.full((WINDOW_SZ, WINDOW_SZ, 3), 114, dtype=np.float32)
            px_off = (WINDOW_SZ - nw) // 2
            py_off = (WINDOW_SZ - nh) // 2
            pad_img[py_off:py_off + nh, px_off:px_off + nw] = np.array(resized, dtype=np.float32)

            tensor = (pad_img / 255.0).transpose(2, 0, 1)[np.newaxis]
            try:
                out = session.run(None, {session.get_inputs()[0].name: tensor})[0]
            except Exception as e:
                print(f"[sentinel_ml] inference error at tile ({tx},{ty}): {e}")
                continue

            preds = out[0].T  # (N, 84)
            bxy   = preds[:, :4]
            cls_s = preds[:, 4:]
            max_s = cls_s.max(axis=1)
            ci    = cls_s.argmax(axis=1)
            mask  = max_s > confidence
            if not mask.any():
                continue

            for bx, cy_p, w_p, h_p, sc, ci_i in zip(
                bxy[mask, 0], bxy[mask, 1], bxy[mask, 2], bxy[mask, 3],
                max_s[mask], ci[mask],
            ):
                # Unpad and unscale back to full-image coords
                x1_t = ((bx - w_p / 2) - px_off) / scale + tx
                y1_t = ((cy_p - h_p / 2) - py_off) / scale + ty
                x2_t = ((bx + w_p / 2) - px_off) / scale + tx
                y2_t = ((cy_p + h_p / 2) - py_off) / scale + ty
                # Clip to image
                x1_t = max(0.0, min(float(img_w - 1), float(x1_t)))
                y1_t = max(0.0, min(float(img_h - 1), float(y1_t)))
                x2_t = max(0.0, min(float(img_w - 1), float(x2_t)))
                y2_t = max(0.0, min(float(img_h - 1), float(y2_t)))
                if x2_t <= x1_t or y2_t <= y1_t:
                    continue
                all_boxes.append([x1_t, y1_t, x2_t, y2_t])
                all_scores.append(float(sc))
                all_cls.append(int(ci_i))

    if not all_boxes:
        return []

    boxes_arr  = np.array(all_boxes,  dtype=np.float32)
    scores_arr = np.array(all_scores, dtype=np.float32)
    kept = _nms(boxes_arr, scores_arr, iou_threshold=0.45)

    results = []
    for idx in kept:
        x1, y1, x2, y2 = boxes_arr[idx]
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2
        results.append({
            "x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2),
            "cx": float(cx), "cy": float(cy),
            "w_px": float(x2 - x1), "h_px": float(y2 - y1),
            "confidence": all_scores[idx],
            "class_id":   all_cls[idx],
            "class_name": COCO_NAMES[all_cls[idx]] if all_cls[idx] < len(COCO_NAMES) else "unknown",
        })
    return results


# ── Detection ID counter ───────────────────────────────────────────────────────

_det_counter      = 0
_det_counter_lock = threading.Lock()


def _next_det_id() -> str:
    global _det_counter
    with _det_counter_lock:
        _det_counter += 1
        return f"DET-{_det_counter:06d}"


# ── Alert tier / severity helpers ──────────────────────────────────────────────

def _vessel_tier(count_in_zone: int, baseline: float) -> tuple:
    """Returns (alert_tier, severity) for vessel detection."""
    if baseline > 0 and count_in_zone > baseline * 3:
        return "immediate", "high"
    return "silent", "info"


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
    Band: True Colour (true_colour key).  Uses YOLOv8-COCO sliding window.
    Returns vessel detections with geo bbox, estimated length/width.
    """
    tc = images.get("true_colour")
    if tc is None:
        return []

    img_w, img_h = tc.size
    res_m = _pixel_resolution_m(bbox, img_w, img_h)
    raw = _run_yolo_sliding_window(tc, confidence=0.25, model_key="coco")

    # Filter to maritime objects — COCO class 8 = "boat"
    vessel_classes = {"boat", "ship"}
    raw = [r for r in raw if r["class_name"] in vessel_classes or r["class_id"] == 8]

    alert_tier, severity = _vessel_tier(len(raw), zone_baseline)
    detections = []
    for r in raw:
        lon, lat = _affine(r["cx"], r["cy"], img_w, img_h, bbox)
        geo_poly  = _px_to_geo_polygon(r["x1"], r["y1"], r["x2"], r["y2"], img_w, img_h, bbox)
        est_len   = round(r["w_px"] * res_m, 1)
        est_wid   = round(r["h_px"] * res_m, 1)
        detections.append({
            "detection_id":    _next_det_id(),
            "object_type":     "vessel",
            "confidence":      round(r["confidence"], 3),
            "centroid_lat":    round(lat, 6),
            "centroid_lon":    round(lon, 6),
            "geo_geometry":    json.dumps(geo_poly),
            "area_m2":         round(est_len * est_wid, 1),
            "severity":        severity,
            "alert_tier":      alert_tier,
            "matched_to_ais":  False,
            "attributes":      json.dumps({
                "pixel_bbox":         {"x_min": r["x1"], "y_min": r["y1"], "x_max": r["x2"], "y_max": r["y2"]},
                "estimated_length_m": est_len,
                "estimated_width_m":  est_wid,
                "pixel_resolution_m": round(res_m, 2),
                "geolocation_uncertainty_m": round(res_m * 1.5, 1),
                "yolo_class":         r["class_name"],
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
        "requires":           [],   # imagery fetched by _run_overwatch_detection_sync (ESRI tiles)
        "alert_tier_default": "silent",
        "description":        "Detect vessels using YOLOv8 OBB (DOTA) on ESRI satellite tiles",
    },
    "vessel_cluster_detection": {
        "requires":           ["true_colour"],
        "alert_tier_default": "digest",
        "description":        "Group vessel detections within 500m into clusters",
        "depends_on":         "ship_detection",
    },
    "smoke_plume_detection": {
        "requires":           [],   # imagery fetched by _run_overwatch_detection_sync (Sentinel SWIR)
        "alert_tier_default": "immediate",
        "description":        "Detect smoke plumes via SWIR thresholding",
    },
    "fire_detection": {
        "requires":           [],   # imagery fetched by _run_overwatch_detection_sync (Sentinel SWIR+NIR)
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
