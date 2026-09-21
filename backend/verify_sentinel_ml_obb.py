"""
Verification script for the Sentinel-2/WatchZone ship-detection model-mismatch
fix (2026-08 audit): sentinel_ml.py's run_ship_detection() used to run a plain
axis-aligned-box COCO YOLOv8n detector (yolov8n.onnx, filtered to class
"boat") — a model trained on ordinary photos, a meaningfully worse fit for
overhead Sentinel-2 imagery where ships appear at arbitrary headings — instead
of the real oriented-bounding-box YOLO-OBB (DOTA) model the ESRI/Overwatch
draw-a-box path (`/api/overwatch/detect`) already used.

This does NOT hit any real Sentinel-2/Copernicus endpoint and does NOT write
to backend/data/akili.db (read-only `import main`, no TestClient, no DB
writes anywhere in this script — same guarantee the sibling test scripts on
this branch rely on).

Covers:
  1. Real mechanics smoke test — main._run_inference_on_image (the actual OBB
     decode pipeline: tiled ONNX inference, angle extraction, rotated-corner
     math) genuinely runs end-to-end, unmocked, on a synthetic image, using
     model_key="dota" (yolov8n-obb.onnx). Reports honestly if the real model
     finds nothing on synthetic pixels — not forced.
  2. Real geometry correctness — main._ow_obb_corners (the actual rotation
     math used by both the ESRI OBB path and, transitively, sentinel_ml.py)
     produces a genuinely rotated (non-axis-aligned) rectangle for a non-zero
     angle, with the right side lengths.
  3. sentinel_ml.run_ship_detection() integration — with
     main._run_inference_on_image monkeypatched to return a canned detection
     built from real rotated corners (main._ow_obb_corners), confirms:
       - it calls the shared inference helper with model_key="dota" (the
         real YOLO-OBB/DOTA model), not "coco"
       - the returned SentinelDetection dict's geo_geometry is a genuinely
         oriented polygon (angle-aware), not an axis-aligned bbox
       - non-"ship" DOTA classes (e.g. "harbor") are filtered out
       - attributes carry a real, non-trivial obb_angle_deg
  4. The old COCO sliding-window path is fully gone from sentinel_ml.py (no
     duplicate/dead OBB-adjacent implementation left behind) and
     sentinel_scanner.py's model-load precheck no longer references the old
     COCO model.

Usage:
    cd backend
    python3 test_sentinel_ml_obb.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


print("=" * 70)
print("  sentinel_ml.py YOLO-OBB ship-detection fix — verification")
print("=" * 70)

import main  # noqa: E402 — bare import, no TestClient/startup event, no DB writes
import sentinel_ml  # noqa: E402

# ── 1. Real mechanics smoke test (unmocked, real ONNX session) ─────────────
print("\n[1] main._run_inference_on_image on a synthetic image, model_key='dota'")
import numpy as np
from PIL import Image, ImageDraw

img_size = 800
im = Image.new("RGB", (img_size, img_size), (30, 60, 90))  # dark "water"
draw = ImageDraw.Draw(im)
# A bright, elongated, rotated rectangle (ship-like: high contrast, long/thin).
rect_w, rect_h, angle_deg = 140, 30, 35
cx, cy = img_size // 2, img_size // 2
half_diag = math.hypot(rect_w, rect_h) / 2
corners_px = main._ow_obb_corners(cx, cy, rect_w, rect_h, math.radians(angle_deg))
draw.polygon(corners_px, fill=(230, 230, 220))

bounds = {"north": 51.0, "south": 50.9, "east": 4.2, "west": 4.1}
result = main._run_inference_on_image(im, bounds, confidence=0.01, enhance=False,
                                       model_key="dota", keep_px=True)
check("result is a dict with 'detections'/'count'/'model'",
      isinstance(result, dict) and "detections" in result and result.get("model") == "onnx-dota",
      result.get("model") if isinstance(result, dict) else type(result))
dets = result.get("detections") or []
print(f"      real DOTA model on synthetic image: {len(dets)} raw detection(s) at confidence>=0.01")
if dets:
    d0 = dets[0]
    check("real detection has class/confidence/center/corners",
          {"class", "confidence", "center", "corners"}.issubset(d0.keys()), d0.keys())
    check("real detection's corners is a list of 4 [lat,lon] pairs",
          isinstance(d0.get("corners"), list) and len(d0["corners"]) == 4
          and all(len(c) == 2 for c in d0["corners"]), d0.get("corners"))
else:
    print("      (no detections cleared even at confidence=0.01 on synthetic pixels — "
          "reported as a real result, not forced; section 3 below exercises the "
          "conversion logic directly with a realistic canned OBB detection)")

# ── 2. Real rotation-math correctness (main._ow_obb_corners) ───────────────
print("\n[2] main._ow_obb_corners — genuine rotated-rectangle geometry")
w, h, ang = 100.0, 40.0, math.radians(30)
corners = main._ow_obb_corners(0.0, 0.0, w, h, ang)
check("returns 4 corners", len(corners) == 4, corners)
xs = [c[0] for c in corners]; ys = [c[1] for c in corners]
check("corners are NOT axis-aligned (more than 2 distinct x AND y values)",
      len(set(round(x, 6) for x in xs)) > 2 and len(set(round(y, 6) for y in ys)) > 2,
      corners)


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


side1 = _dist(corners[0], corners[1])
side2 = _dist(corners[1], corners[2])
check("adjacent side lengths match w/h (within rounding)",
      abs(sorted([side1, side2])[0] - min(w, h)) < 1.0
      and abs(sorted([side1, side2])[1] - max(w, h)) < 1.0,
      (side1, side2))

# ── 3. sentinel_ml.run_ship_detection() integration (monkeypatched OBB call) ─
print("\n[3] sentinel_ml.run_ship_detection() — model selection + angle-aware output")

bbox = {"min_lon": 10.0, "min_lat": 50.0, "max_lon": 10.1, "max_lat": 50.05}
center_lat, center_lon = 50.025, 10.05
# Build a real rotated rectangle (~111m x 44m, ship-scale) using the SAME
# rotation function production code uses, in a small local degrees-plane,
# then place it around center_lat/lon — this is a genuine oriented shape,
# not an axis-aligned stand-in.
ship_w_deg, ship_h_deg, ship_angle_deg = 0.0010, 0.0004, 35.0
local_corners = main._ow_obb_corners(0.0, 0.0, ship_w_deg, ship_h_deg, math.radians(ship_angle_deg))
ship_corners_geo = [[center_lat + y, center_lon + x] for (x, y) in local_corners]

fake_result = {
    "detections": [
        {
            "class": "ship", "category": "Vessel", "subcategory": "Large Ship",
            "confidence": 0.83,
            "center": [center_lat, center_lon],
            "corners": ship_corners_geo,
            "_px": [100.0, 100.0, 140.0, 120.0],
        },
        {
            # Non-vessel DOTA class — must be filtered out by run_ship_detection.
            "class": "harbor", "category": "Infrastructure", "subcategory": "Port/Harbor",
            "confidence": 0.9,
            "center": [center_lat + 0.01, center_lon + 0.01],
            "corners": [[center_lat, center_lon]] * 4,
            "_px": [0.0, 0.0, 10.0, 10.0],
        },
    ],
    "count": 2,
    "model": "onnx-dota",
    "enhanced": False,
}

captured_calls = []
_orig_run_inference = main._run_inference_on_image


def _fake_run_inference_on_image(img, bounds, confidence, enhance=False, model_key="dota", keep_px=False):
    captured_calls.append({
        "bounds": bounds, "confidence": confidence, "enhance": enhance,
        "model_key": model_key, "keep_px": keep_px,
    })
    return fake_result


main._run_inference_on_image = _fake_run_inference_on_image
try:
    images = {"true_colour": Image.new("RGB", (256, 256), (10, 10, 10))}
    detections = sentinel_ml.run_ship_detection(images, bbox)
finally:
    main._run_inference_on_image = _orig_run_inference

check("run_ship_detection called the shared inference helper exactly once",
      len(captured_calls) == 1, captured_calls)
if captured_calls:
    call = captured_calls[0]
    check('run_ship_detection used model_key="dota" (real YOLO-OBB), not "coco"',
          call["model_key"] == "dota", call["model_key"])
    check("run_ship_detection requested keep_px=True (needs the pixel bbox for attributes)",
          call["keep_px"] is True, call)
    check("bounds converted to {north,south,east,west} from the bbox",
          call["bounds"] == {"north": 50.05, "south": 50.0, "east": 10.1, "west": 10.0},
          call["bounds"])

check("only the 'ship' class detection survives (harbor filtered out)",
      len(detections) == 1, [d.get("object_type") for d in detections])

if detections:
    det = detections[0]
    check("object_type is 'vessel'", det.get("object_type") == "vessel", det.get("object_type"))
    check("confidence carried through", det.get("confidence") == 0.83, det.get("confidence"))
    geo = json.loads(det["geo_geometry"]) if det.get("geo_geometry") else None
    check("geo_geometry is a real GeoJSON Polygon", geo is not None and geo.get("type") == "Polygon", geo)
    if geo:
        ring = geo["coordinates"][0]
        check("polygon ring has 5 points (4 corners + closing point)", len(ring) == 5, ring)
        lons = [p[0] for p in ring[:4]]
        lats = [p[1] for p in ring[:4]]
        check("polygon is genuinely oriented — NOT an axis-aligned bbox "
              "(more than 2 distinct lon AND lat values among the 4 corners)",
              len(set(round(x, 8) for x in lons)) > 2 and len(set(round(y, 8) for y in lats)) > 2,
              ring)

    attrs = json.loads(det["attributes"]) if det.get("attributes") else {}
    check("attributes carry a real, non-trivial obb_angle_deg",
          attrs.get("obb_angle_deg") is not None
          and 5.0 < attrs["obb_angle_deg"] < 175.0,
          attrs.get("obb_angle_deg"))
    check("attributes.model names the real OBB model",
          "obb" in (attrs.get("model") or "").lower(), attrs.get("model"))
    check("estimated_length_m / estimated_width_m are plausible ship-scale positive floats",
          attrs.get("estimated_length_m") and attrs.get("estimated_width_m")
          and attrs["estimated_length_m"] > attrs["estimated_width_m"] > 0
          and attrs["estimated_length_m"] < 1000,
          (attrs.get("estimated_length_m"), attrs.get("estimated_width_m")))
    check("pixel_bbox attribute preserved from the shared inference result",
          attrs.get("pixel_bbox") == {"x_min": 100.0, "y_min": 100.0, "x_max": 140.0, "y_max": 120.0},
          attrs.get("pixel_bbox"))

# ── 4. Old COCO path fully removed — no duplicate OBB-adjacent implementation ─
print("\n[4] Old COCO sliding-window path is gone; single shared OBB decode remains")
check("sentinel_ml._run_yolo_sliding_window no longer exists",
      not hasattr(sentinel_ml, "_run_yolo_sliding_window"))
check("sentinel_ml._load_ort_session (old coco/dota dual loader) no longer exists",
      not hasattr(sentinel_ml, "_load_ort_session"))
check("sentinel_ml._get_obb_session exists (delegates to main.py's shared session cache)",
      hasattr(sentinel_ml, "_get_obb_session") and callable(sentinel_ml._get_obb_session))

real_session = sentinel_ml._get_obb_session()
check("sentinel_ml._get_obb_session() returns a real, loaded ONNX session",
      real_session is not None, real_session)

with open(os.path.join(os.path.dirname(__file__), "sentinel_scanner.py")) as _f:
    _scanner_src = _f.read()
check("sentinel_scanner.py's precheck no longer references the old coco model_key",
      'sentinel_ml._load_ort_session("coco")' not in _scanner_src, None)
check("sentinel_scanner.py's precheck now uses the shared OBB session getter",
      "sentinel_ml._get_obb_session()" in _scanner_src, None)
check("sentinel_scanner.py's error message no longer names yolov8n.onnx (COCO)",
      "yolov8n.onnx" not in _scanner_src, None)
check("sentinel_scanner.py's error message names the real OBB model file",
      "yolov8n-obb.onnx" in _scanner_src, None)

print("\n" + "=" * 70)
if FAILURES:
    print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
    print("=" * 70)
    sys.exit(1)
else:
    print("  RESULT: ALL CHECKS PASSED")
    print("=" * 70)
