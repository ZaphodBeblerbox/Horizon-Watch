"""
land_water.py — where the water is, for deciding what a detection can be.

A ship is on water; a storage tank is not. The radar ship detector found
five "vessels" at Jebel Ali and every one was on a blue-painted roof inland,
because the first water mask was a spectral index (NDWI, green against
near-infrared): it marked blue roofs as water and missed most of the
harbour basin.

ESA WorldCover (10 m, 2021) classifies permanent water (class 80) from a
year of Sentinel-1 and Sentinel-2 — harbour basins included, roofs not. It
is public as cloud-optimised GeoTIFFs in 3°×3° tiles, so only the area's
window is read (about a second). Specks — pools, ponds — are removed with a
morphological opening; what remains is the water a ship can be on.

water_mask() returns a boolean array on the area's grid (rows from the
north), or None when WorldCover cannot be read; callers then fall back to a
Sentinel-2 MNDWI mask (green against short-wave infrared, which unlike NDWI
keeps roofs dry).
"""
from __future__ import annotations

import math

URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
       "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
WATER = 80


def tile_name(lat0: int, lon0: int) -> str:
    ns = "N" if lat0 >= 0 else "S"
    ew = "E" if lon0 >= 0 else "W"
    return f"{ns}{abs(lat0):02d}{ew}{abs(lon0):03d}"


def tiles_for(west: float, south: float, east: float, north: float) -> list[tuple[int, int]]:
    """The 3° tiles (south-west corners) an area touches."""
    out = []
    for la in range(math.floor(south / 3) * 3, math.floor(north / 3) * 3 + 1, 3):
        for lo in range(math.floor(west / 3) * 3, math.floor(east / 3) * 3 + 1, 3):
            out.append((la, lo))
    return out


def worldcover_classes(west, south, east, north, width: int, height: int):
    """WorldCover classes on the area's grid (uint8), or None."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    out = np.zeros((height, width), dtype=np.uint8)
    got = False
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="30"):
        for la, lo in tiles_for(west, south, east, north):
            # The part of the area inside this tile, and where it lands on the grid.
            w, s, e, n = max(west, lo), max(south, la), min(east, lo + 3), min(north, la + 3)
            if w >= e or s >= n:
                continue
            x0 = round((w - west) / (east - west) * width)
            x1 = round((e - west) / (east - west) * width)
            y0 = round((north - n) / (north - south) * height)
            y1 = round((north - s) / (north - south) * height)
            if x1 <= x0 or y1 <= y0:
                continue
            try:
                with rasterio.open("/vsicurl/" + URL.format(tile=tile_name(la, lo))) as src:
                    win = from_bounds(w, s, e, n, transform=src.transform)
                    out[y0:y1, x0:x1] = src.read(1, window=win, out_shape=(y1 - y0, x1 - x0),
                                                 resampling=Resampling.nearest)
                    got = True
            except Exception as ex:                          # noqa: BLE001 — open ocean has no tile
                print(f"[land_water] {tile_name(la, lo)}: {type(ex).__name__}: {str(ex)[:120]}", flush=True)
    return out if got else None


def clean(water):
    """Drop specks (pools, ponds): a 3×3 opening."""
    import numpy as np
    from PIL import Image, ImageFilter
    img = Image.fromarray((water * 255).astype(np.uint8))
    img = img.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return np.array(img) > 127


def water_mask(west, south, east, north, width: int, height: int):
    """Boolean water mask on the area's grid from WorldCover, or None."""
    cls = worldcover_classes(west, south, east, north, width, height)
    if cls is None:
        return None
    # A tile that does not exist is open ocean: unread pixels stay 0, and
    # when the whole tile is missing they are water, not land.
    return clean((cls == WATER) | (cls == 0))


def on_water(water, lat, lon, bbox, need: float = 0.5) -> bool:
    """Is the point on water, allowing one pixel of shoreline?"""
    if water is None or lat is None or lon is None:
        return False
    hgt, wid = water.shape
    x = int((lon - bbox[0]) / (bbox[2] - bbox[0]) * wid)
    y = int((bbox[3] - lat) / (bbox[3] - bbox[1]) * hgt)
    if not (0 <= x < wid and 0 <= y < hgt):
        return False
    win = water[max(0, y - 1):y + 2, max(0, x - 1):x + 2]
    return bool(win.mean() >= need)


def plausible(object_type: str, water, lat, lon, bbox) -> bool:
    """Can a detection of this kind be here? Vessels on water, fixed
    structures on land; anything else is left alone."""
    if water is None:
        return True
    kind = str(object_type or "").lower()
    if kind in ("vessel", "ship", "vessel_cluster", "boat"):
        return on_water(water, lat, lon, bbox)
    if kind in ("storage_tank", "airfield", "aircraft", "vehicle", "large_vehicle",
                "small_vehicle", "helicopter", "roundabout", "soccer_field", "tennis_court",
                "basketball_court", "ground_track_field", "swimming_pool"):
        return not on_water(water, lat, lon, bbox, need=0.8)
    return True
