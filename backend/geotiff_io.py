"""
geotiff_io.py — read the GeoTIFFs Sentinel Hub returns, with or without GDAL.

WHY THIS EXISTS (2026-10-11). Every Sentinel-1 path in production crashed
with `ImportError: libexpat.so.1` — rasterio's bundled GDAL needs the
system expat library and the Railpack runtime image does not ship it
(backend/railpack.json now installs it). One missing shared library took
down radar ship detection, the radar image in the Imagery window, the
border sweep and every radar change pass, and each of them said so only
as a crash string on a scan row.

The GeoTIFFs we read are simple: a Process API response, float32, a few
bands, already on an EPSG:4326 grid over the requested box. Reading them
does not need GDAL. So rasterio is tried first (it is the reference
reader) and `tifffile` — pure Python over numpy — is the fallback, with
the affine transform rebuilt from the GeoTIFF tags. If neither can be
used, `require()` raises RadarUnavailable with a sentence a person can
act on, BEFORE any paid Sentinel Hub request is spent.
"""
from __future__ import annotations

import io
import threading

_lock = threading.Lock()
_status: dict | None = None


class RadarUnavailable(RuntimeError):
    """No GeoTIFF reader can be loaded on this server."""


class _Affine:
    """The six-number pixel→world map; `t * (col, row)` like affine.Affine."""
    __slots__ = ("a", "b", "c", "d", "e", "f")

    def __init__(self, a, b, c, d, e, f):
        self.a, self.b, self.c, self.d, self.e, self.f = a, b, c, d, e, f

    def __mul__(self, xy):
        x, y = xy
        return (self.a * x + self.b * y + self.c, self.d * x + self.e * y + self.f)

    def __repr__(self):
        return f"_Affine({self.a}, {self.b}, {self.c}, {self.d}, {self.e}, {self.f})"


def _probe() -> dict:
    out = {"rasterio": None, "tifffile": None}
    try:
        import rasterio  # noqa: F401
        out["rasterio"] = True
    except Exception as e:                                  # noqa: BLE001 — ImportError/OSError from a missing .so
        out["rasterio"] = f"{type(e).__name__}: {e}"
    try:
        import tifffile  # noqa: F401
        out["tifffile"] = True
    except Exception as e:                                  # noqa: BLE001
        out["tifffile"] = f"{type(e).__name__}: {e}"
    return out


def status() -> dict:
    """Which readers load here (probed once per process)."""
    global _status
    with _lock:
        if _status is None:
            _status = _probe()
        return dict(_status)


def available() -> bool:
    s = status()
    return s["rasterio"] is True or s["tifffile"] is True


def unavailable_reason() -> str | None:
    s = status()
    if available():
        return None
    return ("radar processing is unavailable on this server: the GeoTIFF reader could not be loaded "
            f"(rasterio — {s['rasterio']}; tifffile — {s['tifffile']}). "
            "In production this means the runtime image lacks GDAL's system libraries "
            "(libexpat1, see backend/railpack.json).")


def require() -> None:
    """Raise RadarUnavailable with a readable reason if nothing can read a GeoTIFF."""
    why = unavailable_reason()
    if why:
        raise RadarUnavailable(why)


def _read_tifffile(data: bytes):
    import numpy as np
    import tifffile
    with tifffile.TiffFile(io.BytesIO(data)) as tf:
        page = tf.pages[0]
        arr = page.asarray()
        tags = page.tags
        scale = tags.get("ModelPixelScaleTag")
        tie = tags.get("ModelTiepointTag")
        mtx = tags.get("ModelTransformationTag")
        planar = getattr(page, "planarconfig", None)
    arr = np.asarray(arr)
    # [H, W] → [1, H, W]; [H, W, B] (contiguous, the usual Process API
    # layout) → [B, H, W]. A separate-planes file already reads as [B, H, W].
    if arr.ndim == 2:
        arr = arr[None, ...]
    elif arr.ndim == 3:
        sep = planar is not None and int(getattr(planar, "value", planar)) == 2
        if not sep:
            arr = np.moveaxis(arr, -1, 0)
    transform = None
    if mtx is not None:
        m = list(mtx.value)
        transform = _Affine(m[0], m[1], m[3], m[4], m[5], m[7])
    elif scale is not None and tie is not None:
        sx, sy = scale.value[0], scale.value[1]
        i, j, _k, x, y = tie.value[:5]
        transform = _Affine(sx, 0.0, x - i * sx, 0.0, -sy, y + j * sy)
    return arr, transform


def read(data: bytes):
    """(array [bands, H, W], transform) from GeoTIFF bytes.

    transform supports `t * (col, row) -> (x, y)` in the file's CRS
    (EPSG:4326 for every Process API request this app makes), or is None
    when the file carries no georeferencing."""
    require()
    s = status()
    if s["rasterio"] is True:
        from rasterio.io import MemoryFile
        with MemoryFile(data) as memfile:
            with memfile.open() as src:
                return src.read(), src.transform
    return _read_tifffile(data)
