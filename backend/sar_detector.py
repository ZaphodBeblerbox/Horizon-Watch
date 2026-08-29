"""
sar_detector.py — real Sentinel-1 SAR ship detection wrapper.

Runs AllenAI's `vessel-detection-sentinels` Faster-RCNN point detector +
ResNet-50 attribute model (https://github.com/allenai/vessel-detection-sentinels)
on a downloaded/unzipped Sentinel-1 GRD .SAFE product directory. This is
additive to, and completely separate from, the existing optical YOLO-OBB
detector (`sentinel_ml.py`) — every detection this module returns carries an
explicit `"instrument": "SAR"` tag so nothing downstream can mistake it for
an optical detection.

Preprocessing (`preprocess_safe_product`) is adapted from the upstream repo's
`src/data/warp.py::warp()` + `src/data/image.py::prepare_scenes()`, with one
deliberate implementation change: the upstream code shells out to the
`gdalwarp` CLI binary (via `subprocess`) and uses `osgeo.gdal` Python bindings,
both of which require a system GDAL install. This machine does not have one
(`gdalinfo` not found, `brew install gdal` would pull a large, disk-heavy
dependency tree — PROJ/GEOS/HDF5/NetCDF/sqlite — which was judged too risky
under this project's disk-space constraints; see the calling task's notes).
Instead this module uses `rasterio`, whose macOS/Linux wheels bundle their own
libgdal/PROJ statically (~23MB self-contained wheel, no system GDAL needed),
and does the exact same reprojection (bilinear resample to EPSG:3857) via
`rasterio.warp.reproject` — functionally equivalent to upstream's `gdalwarp -r
bilinear -t_srs EPSG:3857`, just invoked through Python bindings instead of a
subprocess. The 0-255 clip/cast-to-uint8 step is a literal port of upstream's
`np.clip(im, 0, 255).astype(np.uint8)` (raw digital-number amplitude, no
radiometric/sigma-nought calibration — matching upstream exactly).

Model weights: downloaded on first use (not committed to git — same
convention as this repo's existing `yolov8m-obb.onnx`/`.pt` files) from the
upstream repo's Git LFS objects, resolved via `media.githubusercontent.com`
and SHA-256-verified against the exact OIDs recorded in the repo's LFS
pointer files (verified 2026-08-29):
  - detector  (frcnn_cmp2/3dff445/best.pth, 121693810 bytes):
    sha256=b2b906c1dff8311a50147237a4989766afcc7d1adff34f5ac05afb03dbef6084
  - attribute (attr/c34aa37/best.pth, 96460157 bytes):
    sha256=bf86a6e5d8a5705da26effe9ffdf708367cc5e47f27e38d71c2388bd05e03413

Weights license: the upstream model card (docs/sentinel1_model_card.md)
marks the weights' license as "License: TBD" as of 2026-08-29. Code license
is Apache-2.0. This integration proceeds on that basis per explicit
instruction to document rather than block on the ambiguity — flag for legal
review before any production use whose licensing posture depends on it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import shutil
from pathlib import Path
from typing import Optional

import numpy as np
import torch

logger = logging.getLogger("sar_detector")

BASE_DIR = Path(__file__).resolve().parent
WEIGHTS_ROOT = BASE_DIR / "data" / "model_weights" / "sentinel1"
DETECTOR_DIR = WEIGHTS_ROOT / "frcnn_cmp2"
ATTR_DIR = WEIGHTS_ROOT / "attr"

_LFS_BASE = "https://media.githubusercontent.com/media/allenai/vessel-detection-sentinels/main"

# (relative dir, filename, upstream LFS path, expected sha256, expected size)
_WEIGHT_SPECS = [
    (
        DETECTOR_DIR, "best.pth",
        f"{_LFS_BASE}/data/model_artifacts/sentinel-1/frcnn_cmp2/3dff445/best.pth",
        "b2b906c1dff8311a50147237a4989766afcc7d1adff34f5ac05afb03dbef6084",
        121693810,
    ),
    (
        ATTR_DIR, "best.pth",
        f"{_LFS_BASE}/data/model_artifacts/sentinel-1/attr/c34aa37/best.pth",
        "bf86a6e5d8a5705da26effe9ffdf708367cc5e47f27e38d71c2388bd05e03413",
        96460157,
    ),
]
_RAW_BASE = "https://raw.githubusercontent.com/allenai/vessel-detection-sentinels/main"
_CFG_SPECS = [
    (DETECTOR_DIR, "cfg.json", f"{_RAW_BASE}/data/model_artifacts/sentinel-1/frcnn_cmp2/3dff445/cfg.json"),
    (ATTR_DIR, "cfg.json", f"{_RAW_BASE}/data/model_artifacts/sentinel-1/attr/c34aa37/cfg.json"),
]

_MIN_FREE_BYTES_FOR_DOWNLOAD = 500 * 1024 * 1024  # 500MB safety floor


class SarDetectorError(Exception):
    pass


def _free_disk_bytes(path: Path) -> int:
    usage = shutil.disk_usage(path)
    return usage.free


def _sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_weights_downloaded() -> None:
    """Download (once) and SHA-256-verify the detector + attribute weights and
    their tiny cfg.json files. Never re-downloads a file that's already
    present and verified. Raises SarDetectorError with a specific reason on
    any failure — never silently produces a partial/corrupt cache."""
    import requests

    for dir_path, fname, url in _CFG_SPECS:
        dir_path.mkdir(parents=True, exist_ok=True)
        dest = dir_path / fname
        if dest.exists() and dest.stat().st_size > 0:
            continue
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        dest.write_bytes(resp.content)

    for dir_path, fname, url, expected_sha, expected_size in _WEIGHT_SPECS:
        dir_path.mkdir(parents=True, exist_ok=True)
        dest = dir_path / fname
        if dest.exists() and dest.stat().st_size == expected_size:
            if _sha256_of(dest) == expected_sha:
                continue
            logger.warning(f"[sar_detector] {dest} failed checksum re-check, re-downloading")
            dest.unlink()

        free = _free_disk_bytes(dir_path)
        if free < expected_size + _MIN_FREE_BYTES_FOR_DOWNLOAD:
            raise SarDetectorError(
                f"refusing to download {fname} ({expected_size / 1e6:.0f}MB): only "
                f"{free / 1e6:.0f}MB free, below the {_MIN_FREE_BYTES_FOR_DOWNLOAD / 1e6:.0f}MB "
                f"safety floor beyond the download itself"
            )

        tmp_dest = dest.with_suffix(".tmp")
        with requests.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with open(tmp_dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)

        actual_size = tmp_dest.stat().st_size
        actual_sha = _sha256_of(tmp_dest)
        if actual_size != expected_size or actual_sha != expected_sha:
            tmp_dest.unlink(missing_ok=True)
            raise SarDetectorError(
                f"downloaded {fname} failed verification: "
                f"size={actual_size} (expected {expected_size}), "
                f"sha256={actual_sha} (expected {expected_sha})"
            )
        tmp_dest.rename(dest)
        logger.info(f"[sar_detector] downloaded + verified {dest} ({actual_size} bytes)")


# ── Model loading ─────────────────────────────────────────────────────────────

_MODEL_CACHE: dict = {"detector": None, "attr": None, "device": None}


def _channel_count(cfg: dict) -> int:
    return sum(ch["Count"] for ch in cfg["Channels"])


def load_models(device: Optional[torch.device] = None, window_size: int = 800):
    """Load (and cache in-process) the detector + attribute models from the
    locally cached weights, downloading them first if needed. Returns
    (detector_model, attr_model, device)."""
    from sar_model_arch import SarDetectorModel, SarAttributeModel

    device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if _MODEL_CACHE["detector"] is not None and _MODEL_CACHE["device"] == device:
        return _MODEL_CACHE["detector"], _MODEL_CACHE["attr"], device

    ensure_weights_downloaded()

    with open(DETECTOR_DIR / "cfg.json") as f:
        detector_cfg = json.load(f)
    with open(ATTR_DIR / "cfg.json") as f:
        attr_cfg = json.load(f)

    # The shipped cfg.json's "categories": ["vessel"] (=> num_classes=1) does
    # NOT match the actual 3dff445/best.pth checkpoint's classifier head size
    # (verified: checkpoint's cls_score output dim is 11, i.e. 10 classes +
    # background, not 2). Infer the true class count straight from the
    # checkpoint so state_dict loading doesn't fail on a shape mismatch.
    detector_state = torch.load(DETECTOR_DIR / "best.pth", map_location=device)
    cls_score_out = detector_state["faster_rcnn.roi_heads.box_predictor.cls_score.weight"].shape[0]
    num_classes = cls_score_out - 1  # cls_score includes the background class

    detector = SarDetectorModel(detector_cfg, image_size=window_size, num_classes=num_classes)
    detector.load_state_dict(detector_state)
    detector.to(device)
    detector.eval()

    attr_model = SarAttributeModel(num_channels=_channel_count(attr_cfg))
    attr_model.load_state_dict(torch.load(ATTR_DIR / "best.pth", map_location=device))
    attr_model.to(device)
    attr_model.eval()

    _MODEL_CACHE.update({"detector": detector, "attr": attr_model, "device": device})
    return detector, attr_model, device


# ── Preprocessing ──────────────────────────────────────────────────────────────

def _find_polarization_tiffs(safe_dir: str) -> dict:
    """Locate the vh/vv measurement GeoTIFFs inside a Sentinel-1 .SAFE product
    directory. Filenames look like:
      s1a-iw-grd-vh-20260101t000000-...-001.tiff
      s1a-iw-grd-vv-20260101t000000-...-001.tiff
    (case-insensitive; the polarization token is a dash-delimited field, not
    always index 3 as in upstream's code — this scans all fields to be
    robust to naming variants across sensors/modes)."""
    measurement_dir = os.path.join(safe_dir, "measurement")
    if not os.path.isdir(measurement_dir):
        raise SarDetectorError(f"no measurement/ directory found under {safe_dir}")

    found: dict = {}
    for fname in os.listdir(measurement_dir):
        if not fname.lower().endswith((".tif", ".tiff")):
            continue
        fields = fname.lower().replace(".tiff", "").replace(".tif", "").split("-")
        for pol in ("vh", "vv"):
            if pol in fields:
                found[pol] = os.path.join(measurement_dir, fname)

    missing = [p for p in ("vh", "vv") if p not in found]
    if missing:
        raise SarDetectorError(
            f"could not find polarization channel(s) {missing} under {measurement_dir} "
            f"(found files: {os.listdir(measurement_dir)})"
        )
    return found


def preprocess_safe_product(safe_dir: str) -> dict:
    """Read the vh/vv measurement GeoTIFFs from a Sentinel-1 SAFE product
    directory, reproject both to EPSG:3857 (bilinear resample, matching
    upstream's `gdalwarp -r bilinear -t_srs epsg:3857`) onto one shared pixel
    grid, and clip/cast to uint8 (raw amplitude, no calibration — matching
    upstream's `np.clip(im, 0, 255).astype(np.uint8)`).

    Returns {"array": np.ndarray [2,H,W] uint8 (channel order [vh, vv]),
             "transform": affine.Affine (pixel->EPSG:3857 meters),
             "crs": "EPSG:3857", "meters_per_pixel": float}.
    Raises SarDetectorError on any failure — never returns a silently-empty
    or wrong-shaped array.
    """
    import rasterio
    from rasterio.warp import calculate_default_transform, reproject, Resampling

    tiffs = _find_polarization_tiffs(safe_dir)
    dst_crs = "EPSG:3857"

    # Compute one shared target transform/shape from the vh band, then warp
    # both bands onto that exact grid so they stay pixel-aligned.
    with rasterio.open(tiffs["vh"]) as src:
        transform, width, height = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds,
        )
        src_crs = src.crs

    bands = {}
    for pol, path in tiffs.items():
        with rasterio.open(path) as src:
            dst = np.zeros((height, width), dtype=src.dtypes[0])
            reproject(
                source=rasterio.band(src, 1),
                destination=dst,
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=transform,
                dst_crs=dst_crs,
                resampling=Resampling.bilinear,
            )
            bands[pol] = np.clip(dst, 0, 255).astype(np.uint8)

    array = np.stack([bands["vh"], bands["vv"]], axis=0)  # channel order matches cfg.json
    meters_per_pixel = abs(transform.a)  # EPSG:3857 units are meters

    return {
        "array": array,
        "transform": transform,
        "crs": dst_crs,
        "meters_per_pixel": float(meters_per_pixel),
        "width": width,
        "height": height,
    }


def _pixel_to_lonlat(transform, col: float, row: float) -> tuple:
    from rasterio.warp import transform as warp_transform

    x, y = transform * (col, row)
    lons, lats = warp_transform("EPSG:3857", "EPSG:4326", [x], [y])
    return lons[0], lats[0]


# ── NMS (ported from upstream's src/inference/pipeline.py::nms, unchanged
#    algorithm — grid-indexed greedy suppression by pixel distance) ──────────

class _GridIndex:
    def __init__(self, size):
        self.size = size
        self.grid: dict = {}

    def insert(self, p, data):
        self.insert_rect([p[0], p[1], p[0], p[1]], data)

    def insert_rect(self, rect, data):
        for i in range(rect[0] // self.size, rect[2] // self.size + 1):
            for j in range(rect[1] // self.size, rect[3] // self.size + 1):
                self.grid.setdefault((i, j), []).append(data)

    def search(self, rect):
        matches = set()
        for i in range(rect[0] // self.size, rect[2] // self.size + 1):
            for j in range(rect[1] // self.size, rect[3] // self.size + 1):
                for data in self.grid.get((i, j), []):
                    matches.add(data)
        return matches


def _nms(dets: list, distance_thresh: float = 10) -> list:
    """dets: list of dicts with 'row', 'col', 'score'. Returns filtered list."""
    if not dets:
        return dets
    grid_index = _GridIndex(max(64, int(distance_thresh)))
    for idx, d in enumerate(dets):
        grid_index.insert((d["row"], d["col"]), idx)

    elim = set()
    for idx, d in enumerate(dets):
        rect = [
            d["row"] - distance_thresh, d["col"] - distance_thresh,
            d["row"] + distance_thresh, d["col"] + distance_thresh,
        ]
        rect = [int(v) for v in rect]
        for other_idx in grid_index.search(rect):
            if other_idx == idx or other_idx in elim:
                continue
            other = dets[other_idx]
            if other["score"] < d["score"] or (other["score"] == d["score"] and other_idx <= idx):
                continue
            dx = other["col"] - d["col"]
            dy = other["row"] - d["row"]
            if math.sqrt(dx * dx + dy * dy) > distance_thresh:
                continue
            elim.add(idx)
            break

    return [d for i, d in enumerate(dets) if i not in elim]


# ── Detection ──────────────────────────────────────────────────────────────────

def run_sar_ship_detection(
    safe_dir: str,
    window_size: int = 800,
    padding: int = 64,
    overlap: int = 10,
    conf_threshold: float = 0.9,
    nms_thresh: float = 10,
    device: Optional[torch.device] = None,
) -> list:
    """Run the full preprocess -> sliding-window detect -> NMS -> attribute
    postprocess pipeline on a Sentinel-1 SAFE product directory. Returns a
    list of detection dicts, each explicitly tagged `"instrument": "SAR"`:

        {instrument, lat, lon, score, vessel_length_m, vessel_width_m,
         vessel_speed_k, heading_bucket_i, heading_confidence,
         is_fishing_vessel, pixel_row, pixel_col, meters_per_pixel}

    Never merged with optical detections — callers must keep this list in
    its own clearly-tagged structure or persist it into a shared table only
    via an explicit instrument column.
    """
    detector, attr_model, device = load_models(device=device, window_size=window_size)

    prep = preprocess_safe_product(safe_dir)
    img = torch.as_tensor(prep["array"])  # [2, H, W] uint8
    _, H, W = img.shape

    raw_dets: list = []
    with torch.no_grad():
        if H <= window_size and W <= window_size:
            row_offsets, col_offsets = [0], [0]
        else:
            step = max(1, window_size - 2 * padding)
            row_offsets = [0] + list(range(step, H - window_size, step)) + [H - window_size]
            col_offsets = [0] + list(range(step, W - window_size, step)) + [W - window_size]

        for row_offset in row_offsets:
            for col_offset in col_offsets:
                row_end = min(row_offset + window_size, H)
                col_end = min(col_offset + window_size, W)
                crop = img[:, row_offset:row_end, col_offset:col_end].to(device).float() / 255.0

                output = detector([crop])[0]

                keep_bounds = [padding, padding, window_size - padding, window_size - padding]
                if col_offset == 0:
                    keep_bounds[0] = 0
                if row_offset == 0:
                    keep_bounds[1] = 0
                if col_offset >= W - window_size:
                    keep_bounds[2] = window_size
                if row_offset >= H - window_size:
                    keep_bounds[3] = window_size
                keep_bounds[0] -= overlap
                keep_bounds[1] -= overlap
                keep_bounds[2] += overlap
                keep_bounds[3] += overlap

                boxes = output["boxes"].tolist()
                scores = output["scores"].tolist()
                for box, score in zip(boxes, scores):
                    if score < conf_threshold:
                        continue
                    crop_col = (box[0] + box[2]) / 2
                    crop_row = (box[1] + box[3]) / 2
                    if crop_col < keep_bounds[0] or crop_col > keep_bounds[2]:
                        continue
                    if crop_row < keep_bounds[1] or crop_row > keep_bounds[3]:
                        continue
                    raw_dets.append({
                        "row": row_offset + int(crop_row),
                        "col": col_offset + int(crop_col),
                        "score": float(score),
                    })

    kept = _nms(raw_dets, distance_thresh=nms_thresh)

    detections = []
    crop_size = 120
    with torch.no_grad():
        for d in kept:
            row = int(np.clip(d["row"], crop_size // 2, max(crop_size // 2, H - crop_size // 2)))
            col = int(np.clip(d["col"], crop_size // 2, max(crop_size // 2, W - crop_size // 2)))
            crop = img[0:2,
                       max(0, row - crop_size // 2):row + crop_size // 2,
                       max(0, col - crop_size // 2):col + crop_size // 2].to(device).float() / 255.0
            # Pad if the vessel is near the image edge and the crop came out short.
            pad_h = crop_size - crop.shape[1]
            pad_w = crop_size - crop.shape[2]
            if pad_h > 0 or pad_w > 0:
                crop = torch.nn.functional.pad(crop, (0, max(0, pad_w), 0, max(0, pad_h)))

            out = attr_model([crop])[0].cpu()
            heading_probs = torch.nn.functional.softmax(out[2:18], dim=0)
            heading_bucket_i = int(torch.argmax(heading_probs).item())
            is_fishing_vessel_prob = torch.nn.functional.softmax(out[19:21], dim=0)[1].item()

            lon, lat = _pixel_to_lonlat(prep["transform"], d["col"], d["row"])

            detections.append({
                "instrument": "SAR",
                "lat": float(lat),
                "lon": float(lon),
                "score": d["score"],
                "vessel_length_m": max(0.0, 100 * out[0].item()),
                "vessel_width_m": max(0.0, 100 * out[1].item()),
                "vessel_speed_k": out[18].item(),
                "heading_bucket_i": heading_bucket_i,
                "heading_confidence": float(heading_probs[heading_bucket_i].item()),
                "is_fishing_vessel": bool(is_fishing_vessel_prob >= 0.5),
                "is_fishing_vessel_prob": round(float(is_fishing_vessel_prob), 6),
                "pixel_row": d["row"],
                "pixel_col": d["col"],
                "meters_per_pixel": prep["meters_per_pixel"],
            })

    return detections
