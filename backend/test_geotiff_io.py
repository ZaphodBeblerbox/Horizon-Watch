"""geotiff_io.py — the GDAL-free GeoTIFF fallback reads what rasterio reads."""
import numpy as np
import pytest

import geotiff_io

rasterio = pytest.importorskip("rasterio")
pytest.importorskip("tifffile")


def _tiff(bands=2, h=20, w=30):
    from rasterio.io import MemoryFile
    from rasterio.transform import from_bounds
    arr = np.random.default_rng(1).random((bands, h, w), dtype=np.float32)
    with MemoryFile() as mf:
        with mf.open(driver="GTiff", width=w, height=h, count=bands, dtype="float32", crs="EPSG:4326",
                     transform=from_bounds(37.0, 48.0, 37.3, 48.2, w, h)) as ds:
            ds.write(arr)
        return mf.read(), arr


def test_fallback_matches_rasterio():
    data, arr = _tiff()
    a1, t1 = geotiff_io.read(data)
    a2, t2 = geotiff_io._read_tifffile(data)
    assert a1.shape == a2.shape == arr.shape
    assert np.allclose(a1, a2) and np.allclose(a2, arr)
    for col, row in ((0, 0), (30, 20), (12.5, 7)):
        x1, y1 = t1 * (col, row)
        x2, y2 = t2 * (col, row)
        assert abs(x1 - x2) < 1e-9 and abs(y1 - y2) < 1e-9


def test_single_band():
    data, arr = _tiff(bands=1)
    a, _t = geotiff_io._read_tifffile(data)
    assert a.shape == (1, 20, 30) and np.allclose(a[0], arr[0])


def test_unavailable_reason_names_the_cause(monkeypatch):
    monkeypatch.setattr(geotiff_io, "_status", {"rasterio": "ImportError: libexpat.so.1", "tifffile": "ImportError: x"})
    assert "libexpat" in geotiff_io.unavailable_reason()
    with pytest.raises(geotiff_io.RadarUnavailable):
        geotiff_io.read(b"")
    monkeypatch.setattr(geotiff_io, "_status", {"rasterio": "ImportError: libexpat.so.1", "tifffile": True})
    assert geotiff_io.available() and geotiff_io.unavailable_reason() is None
