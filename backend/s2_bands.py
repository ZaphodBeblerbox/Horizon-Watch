"""
s2_bands.py — Sentinel-2 reflectances, not pictures.

The display path fetches a true-colour PNG: three bands, stretched, 8-bit.
Smoke detection and multi-image work need the measurements themselves —
blue to short-wave infrared as surface reflectance, with the scene
classification — so this fetches them as float32 GeoTIFF from the
Copernicus Data Space Process API over exact bounds, one acquisition day
at a time, and finds which days exist through the public Earth Search
catalogue. Synchronous and self-contained, for the scanner's worker
threads and for scripts.
"""
from __future__ import annotations

import io
import json
import os
import time
import urllib.parse
import urllib.request

TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
SEARCH_URL = "https://earth-search.aws.element84.com/v1/search"
BANDS = ["B02", "B03", "B04", "B08", "B11", "B12"]
_TOKEN = {"value": None, "exp": 0.0}


def _token() -> str:
    if _TOKEN["value"] and time.time() < _TOKEN["exp"] - 60:
        return _TOKEN["value"]
    form = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": os.getenv("COPERNICUS_CLIENT_ID", ""),
        "client_secret": os.getenv("COPERNICUS_CLIENT_SECRET", ""),
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"})
    d = json.loads(urllib.request.urlopen(req, timeout=30).read())
    _TOKEN.update(value=d["access_token"], exp=time.time() + float(d.get("expires_in", 600)))
    return _TOKEN["value"]


def passes(west, south, east, north, days_back: int = 60, max_cloud: float = 100, until: str | None = None) -> list[dict]:
    """[{date, time, cloud}] newest first, one per day."""
    import datetime as dt
    end = dt.datetime.fromisoformat(until) if until else dt.datetime.utcnow()
    body = {"collections": ["sentinel-2-l2a"], "bbox": [west, south, east, north],
            "datetime": f"{(end - dt.timedelta(days=days_back)).strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT23:59:59Z')}",
            "limit": 100, "query": {"eo:cloud_cover": {"lte": max_cloud}},
            "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
    req = urllib.request.Request(SEARCH_URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    feats = json.loads(urllib.request.urlopen(req, timeout=60).read()).get("features", [])
    out, seen = [], set()
    for f in feats:
        t = f["properties"]["datetime"]
        if t[:10] in seen:
            continue
        seen.add(t[:10])
        out.append({"date": t[:10], "time": t, "cloud": f["properties"].get("eo:cloud_cover")})
    return out


EVALSCRIPT = """//VERSION=3
function setup(){return{input:[{bands:["B02","B03","B04","B08","B11","B12","SCL","dataMask"],
 units:["REFLECTANCE","REFLECTANCE","REFLECTANCE","REFLECTANCE","REFLECTANCE","REFLECTANCE","DN","DN"]}],
 output:{bands:8,sampleType:"FLOAT32"}}}
function evaluatePixel(s){return[s.B02,s.B03,s.B04,s.B08,s.B11,s.B12,s.SCL,s.dataMask]}"""


def fetch(west, south, east, north, date: str, width: int, height: int, upsampling: str = "BICUBIC"):
    """float32 array (8, H, W): B02 B03 B04 B08 B11 B12 SCL mask, for one day."""
    import numpy as np
    import rasterio
    body = {
        "input": {"bounds": {"bbox": [west, south, east, north],
                             "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}},
                  "data": [{"type": "sentinel-2-l2a",
                            "dataFilter": {"timeRange": {"from": f"{date}T00:00:00Z", "to": f"{date}T23:59:59Z"},
                                           "mosaickingOrder": "mostRecent"},
                            "processing": {"upsampling": upsampling, "downsampling": "BICUBIC"}}]},
        "output": {"width": int(width), "height": int(height),
                   "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}]},
        "evalscript": EVALSCRIPT,
    }
    req = urllib.request.Request(PROCESS_URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {_token()}"})
    raw = urllib.request.urlopen(req, timeout=120).read()
    with rasterio.open(io.BytesIO(raw)) as src:
        return src.read().astype(np.float32)


def size_at(west, south, east, north, m_per_px: float) -> tuple[int, int]:
    import math
    lat = (south + north) / 2
    w = (east - west) * 111_320 * math.cos(math.radians(lat)) / m_per_px
    h = (north - south) * 110_574 / m_per_px
    k = min(1.0, 2500 / max(w, h))
    return max(16, round(w * k)), max(16, round(h * k))
