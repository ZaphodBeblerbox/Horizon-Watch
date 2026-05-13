"""
Quick smoke-test for the overwatch detection pipeline.

Usage:
    cd backend
    python3 test_scan.py

Runs detection over:
  1. Jebel Ali port bbox — TRUE_COLOR vessel detection
  2. Abu Dhabi desert bbox — SWIR fire detection
Prints detections and imagery dimensions without requiring the backend to be running.
"""

import os, sys
os.environ.setdefault("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
sys.path.insert(0, os.path.dirname(__file__))


def fmt_dets(dets: list, label: str):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  Total detections: {len(dets)}")
    if not dets:
        print("  (none)")
        return
    by_type: dict = {}
    for d in dets:
        t = d.get("object_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    for t, n in sorted(by_type.items()):
        print(f"    {t:<30} {n}")
    print()
    for d in dets[:5]:
        print(f"    [{d['object_type']}] conf={d['confidence']:.2f}  "
              f"lat={d['centroid_lat']:.4f}  lon={d['centroid_lon']:.4f}  "
              f"sev={d['severity']}")
    if len(dets) > 5:
        print(f"    … ({len(dets) - 5} more)")


# ── Test 1: Jebel Ali port — vessel detection via ESRI tiles ─────────────────

JEBEL_ALI = {"min_lon": 55.02, "min_lat": 24.97, "max_lon": 55.12, "max_lat": 25.03}

print("\n" + "="*60)
print("  TEST 1 — Jebel Ali port (vessel detection, ESRI tiles)")
print("="*60)

try:
    from main import _run_overwatch_detection_sync
    dets = _run_overwatch_detection_sync(JEBEL_ALI, band_type="TRUE_COLOR", confidence=0.15)
    fmt_dets(dets, "Jebel Ali — TRUE_COLOR / vessel detection")
except Exception as e:
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()


# ── Test 2: Abu Dhabi desert — SWIR fire detection ───────────────────────────

ABU_DHABI_DESERT = {"min_lon": 54.5, "min_lat": 24.3, "max_lon": 54.8, "max_lat": 24.6}

print("\n" + "="*60)
print("  TEST 2 — Abu Dhabi desert (fire detection, Sentinel SWIR)")
print("="*60)

try:
    # Also print raw image dimensions from the fetch step
    from sentinel_scanner import _fetch_sentinel_image, _bytes_to_pil
    from PIL import Image
    import math

    west, south, east, north = (ABU_DHABI_DESERT["min_lon"], ABU_DHABI_DESERT["min_lat"],
                                  ABU_DHABI_DESERT["max_lon"], ABU_DHABI_DESERT["max_lat"])
    img_w = min(2048, max(512, int(abs(east - west) * 11100)))
    img_h = min(2048, max(512, int(abs(north - south) * 11100)))
    print(f"  Requested Sentinel image size: {img_w}×{img_h}px")

    swir_bytes = _fetch_sentinel_image(west, south, east, north, "swir",
                                        max_cloud=30, width=img_w, height=img_h)
    if swir_bytes:
        pil = _bytes_to_pil(swir_bytes)
        print(f"  Actual SWIR image received:    {pil.size[0]}×{pil.size[1]}px  ({len(swir_bytes):,} bytes)")
    else:
        print("  SWIR fetch failed (no Copernicus credentials or network error)")

    dets = _run_overwatch_detection_sync(ABU_DHABI_DESERT, band_type="SWIR", confidence=0.15)
    fmt_dets(dets, "Abu Dhabi desert — SWIR / fire detection")
except Exception as e:
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()


# ── Test 3: Print Jebel Ali image dimensions (TRUE_COLOR ESRI) ───────────────

print("\n" + "="*60)
print("  TEST 3 — Jebel Ali ESRI tile stitch dimensions")
print("="*60)

try:
    import math
    from main import _ow_lon_to_tile_x_frac, _ow_lat_to_tile_y_frac

    zoom = 17
    west, south, east, north = (JEBEL_ALI["min_lon"], JEBEL_ALI["min_lat"],
                                  JEBEL_ALI["max_lon"], JEBEL_ALI["max_lat"])

    x_min = int(_ow_lon_to_tile_x_frac(west,  zoom))
    x_max = int(_ow_lon_to_tile_x_frac(east,  zoom))
    y_min = int(_ow_lat_to_tile_y_frac(north, zoom))
    y_max = int(_ow_lat_to_tile_y_frac(south, zoom))
    x_min, x_max = min(x_min, x_max), max(x_min, x_max)
    y_min, y_max = min(y_min, y_max), max(y_min, y_max)
    tile_count = (x_max - x_min + 1) * (y_max - y_min + 1)
    stitch_w = (x_max - x_min + 1) * 256
    stitch_h = (y_max - y_min + 1) * 256
    print(f"  Zoom {zoom}: {tile_count} tiles  stitch={stitch_w}×{stitch_h}px")
except Exception as e:
    print(f"  ERROR: {e}")

print("\n" + "="*60)
print("  Done.")
print("="*60 + "\n")
