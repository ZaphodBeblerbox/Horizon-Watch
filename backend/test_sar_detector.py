"""
Verification script for the Sentinel-1 SAR ship detector (sar_detector.py).

Does NOT hit any real Copernicus/CDSE endpoint and does NOT require a real
Sentinel-1 SAFE product — it builds a small synthetic two-band (vh, vv)
GeoTIFF pair laid out exactly like a real SAFE product's measurement/
directory, then runs the real preprocessing (rasterio reproject + 8-bit
clip) and the real detector + attribute models (downloaded/cached weights)
against it. This tests the mechanics (shapes, dtypes, instrument tagging,
lat/lon conversion) end-to-end with real model code and real weights, on
synthetic pixels instead of a real satellite scene.

Usage:
    cd backend
    python3 test_sar_detector.py
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

import numpy as np

FAILURES = []


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(label)


def _make_synthetic_safe_product(root: str) -> str:
    """Builds <root>/TEST_SCENE.SAFE/measurement/*-vh-*.tiff and *-vv-*.tiff,
    each a small georeferenced raster in EPSG:4326 with a few bright blobs
    (simulating vessel-like point reflectors against a darker sea background)."""
    import rasterio
    from rasterio.transform import from_bounds

    safe_dir = os.path.join(root, "TEST_SCENE.SAFE")
    measurement_dir = os.path.join(safe_dir, "measurement")
    os.makedirs(measurement_dir, exist_ok=True)

    size = 512
    west, south, east, north = 4.0, 51.0, 4.2, 51.15
    transform = from_bounds(west, south, east, north, size, size)

    rng = np.random.default_rng(42)

    for pol in ("vh", "vv"):
        data = (rng.normal(loc=40, scale=8, size=(size, size))).clip(0, 255).astype(np.uint16)
        # Sprinkle a handful of bright "vessel-like" point blobs.
        for (r, c) in [(100, 120), (300, 250), (400, 60)]:
            data[r - 2:r + 2, c - 2:c + 2] = 220
        path = os.path.join(measurement_dir, f"s1a-iw-grd-{pol}-20260101t000000-20260101t000025-000001-0abcde-001.tiff")
        with rasterio.open(
            path, "w", driver="GTiff", height=size, width=size, count=1,
            dtype=data.dtype, crs="EPSG:4326", transform=transform,
        ) as dst:
            dst.write(data, 1)

    return safe_dir


def main():
    print("=" * 70)
    print("  sar_detector.py — verification (synthetic raster, real models)")
    print("=" * 70)

    tmpdir = tempfile.mkdtemp(prefix="sar_detector_test_")
    try:
        import sar_detector

        # ── 1. Preprocessing mechanics ──────────────────────────────────────
        print("\n[1] preprocess_safe_product on synthetic vh/vv GeoTIFFs")
        safe_dir = _make_synthetic_safe_product(tmpdir)
        prep = sar_detector.preprocess_safe_product(safe_dir)

        arr = prep["array"]
        check("array is numpy ndarray", isinstance(arr, np.ndarray))
        check("array has 2 channels (vh, vv)", arr.shape[0] == 2, f"shape={arr.shape}")
        check("array dtype is uint8", arr.dtype == np.uint8, f"dtype={arr.dtype}")
        check("array values within [0,255]", arr.min() >= 0 and arr.max() <= 255)
        check("crs is EPSG:3857", prep["crs"] == "EPSG:3857", prep["crs"])
        check("meters_per_pixel is a positive float", prep["meters_per_pixel"] > 0, str(prep["meters_per_pixel"]))
        check("width/height match array", (prep["height"], prep["width"]) == arr.shape[1:], str(arr.shape))

        # ── 2. Model loading (real weights, real construction) ──────────────
        print("\n[2] load_models — real checkpoints into constructed PyTorch models")
        detector, attr_model, device = sar_detector.load_models()
        check("detector module constructed", detector is not None)
        check("detector.eval() applied", detector.training is False)
        check("attr model constructed", attr_model is not None)
        check("attr_model.eval() applied", attr_model.training is False)
        n_det_params = sum(p.numel() for p in detector.parameters())
        n_attr_params = sum(p.numel() for p in attr_model.parameters())
        check("detector has trained parameters", n_det_params > 1_000_000, str(n_det_params))
        check("attr model has trained parameters", n_attr_params > 1_000_000, str(n_attr_params))

        # ── 3. Full detection pipeline, low threshold to force some output ──
        print("\n[3] run_sar_ship_detection end-to-end on synthetic scene")
        detections = sar_detector.run_sar_ship_detection(
            safe_dir, window_size=512, padding=32, conf_threshold=0.0, nms_thresh=10,
        )
        check("returns a list", isinstance(detections, list))
        check("at least one candidate detection at conf_threshold=0.0", len(detections) > 0, str(len(detections)))

        if detections:
            d = detections[0]
            required_keys = {
                "instrument", "lat", "lon", "score", "vessel_length_m",
                "vessel_width_m", "vessel_speed_k", "heading_bucket_i",
                "is_fishing_vessel", "pixel_row", "pixel_col", "meters_per_pixel",
            }
            check("detection has all required keys", required_keys.issubset(d.keys()),
                  f"missing={required_keys - d.keys()}")
            check('instrument is explicitly "SAR"', d.get("instrument") == "SAR", str(d.get("instrument")))
            check("lat is plausible (west/south/east/north bbox-ish)", 50.5 < d["lat"] < 51.6, str(d["lat"]))
            check("lon is plausible", 3.5 < d["lon"] < 4.7, str(d["lon"]))
            check("heading_bucket_i in [0,16)", 0 <= d["heading_bucket_i"] < 16, str(d["heading_bucket_i"]))
            check("is_fishing_vessel is a bool", isinstance(d["is_fishing_vessel"], bool))
            check("score is a float in [0,1]", 0.0 <= d["score"] <= 1.0, str(d["score"]))
            print(f"      sample detection: {d}")
        else:
            print("      (no candidate boxes cleared even conf_threshold=0.0 — "
                  "reported as a real result, not forced)")

        # ── 4. Confirm high default threshold behaves sanely on noise ───────
        print("\n[4] run_sar_ship_detection at real default threshold (0.9)")
        strict_detections = sar_detector.run_sar_ship_detection(safe_dir, window_size=512)
        check("returns a list at default threshold", isinstance(strict_detections, list))
        print(f"      {len(strict_detections)} detection(s) at conf_threshold=0.9 on synthetic noise")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        print(f"\n[cleanup] removed temp dir {tmpdir}")

    print("\n" + "=" * 70)
    if FAILURES:
        print(f"  RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
        print("=" * 70)
        sys.exit(1)
    else:
        print("  RESULT: ALL CHECKS PASSED")
        print("=" * 70)


if __name__ == "__main__":
    main()
