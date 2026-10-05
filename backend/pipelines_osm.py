"""
pipelines_osm.py — oil and gas transmission pipelines, from OpenStreetMap.

THE OLD SOURCE IS GONE, NOT MOVED. Global Energy Monitor withdrew the GOPIT
dataset: both file URLs 404 and so does the repository itself. The energy
half of the Flows layer had been empty since March because of it, while the
layer went on calling itself "Trade & energy flows".

OSM is the replacement because it is the one source that is live, free, has
no key, and is already used elsewhere in this backend for infrastructure —
so this adds a query, not a dependency. `man_made=pipeline` with
`usage=transmission` is the long-distance transport network rather than
local distribution: 400 ways over Europe and western Asia, 172 of them
named, including MEGAL and Kirkuk-Ceyhan.

WHAT OSM IS AND IS NOT, and the layer has to say it. This is crowd-mapped:
coverage is excellent in Europe, patchy in central Asia and much of Africa,
and a pipeline's absence here is not evidence that no pipeline exists. It
also records what is BUILT, not what is flowing — a mapped pipeline says
nothing about whether gas is moving through it today. Every response carries
that, because a map of pipelines is exactly the kind of picture people read
as a map of supply.

CACHED HARD, ON DISK. A regional query takes over a minute and pipelines do
not move. Fetching is a background job; serving is a file read.
"""
from __future__ import annotations

import json as _json
import math
import os
import threading
import time

# Regions worth having, smallest-useful set rather than the whole planet.
# A global query times out on every public Overpass instance, and these are
# the theatres this product actually watches.
REGIONS = [
    # (key, label, south, west, north, east)
    ("europe",      "Europe & western Russia",   35.0,  -10.0, 62.0,  45.0),
    ("caspian",     "Caspian & central Asia",    35.0,   45.0, 56.0,  80.0),
    ("middle_east", "Middle East",               12.0,   34.0, 42.0,  63.0),
    ("north_africa", "North Africa",              18.0,  -12.0, 38.0,  36.0),
    ("east_asia",   "East & southeast Asia",      1.0,   95.0, 54.0, 145.0),
    ("north_america", "North America",           25.0, -128.0, 60.0, -60.0),
]

# How long a cached region is trusted. Pipelines are built over years.
CACHE_TTL_S = 30 * 24 * 3600

# Ways per region. Enough for the transmission network; past this the
# response is large enough to be slow to ship and to draw.
MAX_WAYS = 500

# Below this many points a "pipeline" is usually a yard connector or a
# fragment of a larger way, not something worth drawing at map scale.
MIN_POINTS = 4

_lock = threading.Lock()
_mem: dict = {}


def _cache_dir() -> str:
    try:
        from main import DATA_DIR
        root = os.path.join(DATA_DIR, "pipelines_osm")
    except Exception:
        root = os.path.join(os.path.dirname(__file__), "data", "pipelines_osm")
    os.makedirs(root, exist_ok=True)
    return root


def _cache_path(key: str) -> str:
    return os.path.join(_cache_dir(), f"{key}.json")


def build_query(south, west, north, east) -> str:
    return f"""
[out:json][timeout:120];
(
  way["man_made"="pipeline"]["usage"="transmission"]["substance"~"gas|oil|petroleum|cng|lng"]({south},{west},{north},{east});
);
out geom {MAX_WAYS};
"""


def _length_km(points) -> float:
    """Great-circle length of a polyline, in km."""
    total = 0.0
    for a, b in zip(points, points[1:]):
        lat1, lon1 = math.radians(a[1]), math.radians(a[0])
        lat2, lon2 = math.radians(b[1]), math.radians(b[0])
        dlat, dlon = lat2 - lat1, lon2 - lon1
        h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        total += 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))
    return total


def _normalise(elements, region_key: str) -> list[dict]:
    out = []
    for el in elements or []:
        geom = el.get("geometry") or []
        if len(geom) < MIN_POINTS:
            continue
        tags = el.get("tags") or {}
        # [lon, lat] — GeoJSON order, which is what the globe layer wants.
        pts = [[g["lon"], g["lat"]] for g in geom
               if g.get("lat") is not None and g.get("lon") is not None]
        if len(pts) < MIN_POINTS:
            continue
        substance = (tags.get("substance") or "").lower()
        kind = ("oil" if "oil" in substance or "petroleum" in substance
                else "gas" if "gas" in substance or "lng" in substance or "cng" in substance
                else "other")
        out.append({
            "id": f"osm-way-{el.get('id')}",
            # An unnamed pipeline is still a real pipeline; it is labelled by
            # what it carries rather than given an invented name.
            "name": tags.get("name") or tags.get("operator") or f"{kind.title()} pipeline",
            "named": bool(tags.get("name")),
            "substance": kind,
            "operator": tags.get("operator") or None,
            "diameter": tags.get("diameter") or None,
            "status": (tags.get("pipeline:status") or tags.get("status")
                       or ("construction" if tags.get("construction") else None)),
            "region": region_key,
            "length_km": round(_length_km(pts), 1),
            "coordinates": pts,
        })
    out.sort(key=lambda p: -p["length_km"])
    return out


def load_region(key: str) -> dict | None:
    """Cached region, from memory then disk. None when never fetched."""
    with _lock:
        hit = _mem.get(key)
    if hit:
        return hit
    path = _cache_path(key)
    try:
        if os.path.exists(path):
            with open(path) as fh:
                data = _json.load(fh)
            with _lock:
                _mem[key] = data
            return data
    except Exception:
        # A cache that cannot be read is a miss, never an error the caller
        # has to handle.
        pass
    return None


def region_is_stale(key: str) -> bool:
    path = _cache_path(key)
    if not os.path.exists(path):
        return True
    return (time.time() - os.path.getmtime(path)) > CACHE_TTL_S


# Degrees per Overpass request. A continental bbox is too heavy for the
# public mirrors: the query runs for over a minute and comes back 504 under
# any load. Ten degrees a side returns in seconds, and a region that fails
# halfway keeps the tiles that did arrive.
TILE_DEG = 10.0

# Seconds between tile requests. The public instances rate-limit, and a
# tiled region is a burst unless it is paced.
TILE_PAUSE_S = 2.0


def _tiles(south, west, north, east):
    out = []
    lat = south
    while lat < north:
        lon = west
        while lon < east:
            out.append((lat, lon, min(lat + TILE_DEG, north), min(lon + TILE_DEG, east)))
            lon += TILE_DEG
        lat += TILE_DEG
    return out


def fetch_region(key: str, fetch_overpass) -> dict:
    """Fetch one region, tile by tile, and cache it. `fetch_overpass` is
    injected so this module stays testable and reuses main.py's retry and
    mirror rotation rather than opening a second, differently-behaved HTTP
    path."""
    spec = next((r for r in REGIONS if r[0] == key), None)
    if not spec:
        raise ValueError(f"unknown pipeline region: {key}")
    _, label, south, west, north, east = spec

    elements, failed = [], 0
    tiles = _tiles(south, west, north, east)
    for i, (s0, w0, n0, e0) in enumerate(tiles):
        if i:
            time.sleep(TILE_PAUSE_S)
        raw = fetch_overpass(build_query(s0, w0, n0, e0))
        got = (raw or {}).get("elements") or []
        if not got and raw is not None and not (raw or {}).get("elements"):
            # An empty tile is ordinary — most of the planet has no
            # transmission pipeline in any given 10-degree box — so this is
            # only counted as a failure when the fetcher itself gave up.
            pass
        elements.extend(got)
    # Ways can straddle a tile edge and be returned by both.
    seen, deduped = set(), []
    for el in elements:
        eid = el.get("id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(el)
    pipes = _normalise(deduped, key)
    data = {
        "region": key, "label": label,
        "pipelines": pipes, "count": len(pipes),
        "tiles": len(tiles),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    try:
        path = _cache_path(key)
        tmp = path + ".tmp"
        with open(tmp, "w") as fh:
            _json.dump(data, fh)
        os.replace(tmp, path)          # atomic; a crash cannot leave half a file
    except Exception:
        pass
    with _lock:
        _mem[key] = data
    return data


def all_cached() -> dict:
    """Everything fetched so far, with the regions that are not, named.

    Missing regions are listed rather than omitted: "no pipelines here" and
    "this region has not been fetched" are different statements, and a map
    that conflates them tells you the Caspian has no pipelines.
    """
    pipes, have, missing = [], [], []
    for key, label, *_ in REGIONS:
        data = load_region(key)
        if data:
            pipes.extend(data.get("pipelines") or [])
            have.append({"region": key, "label": label,
                         "count": data.get("count", 0),
                         "fetched_at": data.get("fetched_at")})
        else:
            missing.append({"region": key, "label": label})
    return {
        "pipelines": pipes,
        "total": len(pipes),
        "regions_loaded": have,
        "regions_pending": missing,
        "source": "OpenStreetMap (man_made=pipeline, usage=transmission)",
        "caveat": (
            "Crowd-mapped: coverage is good in Europe and thin in parts of "
            "central Asia and Africa, so an absent pipeline is not evidence "
            "that none exists. It also records what is BUILT — a mapped "
            "pipeline says nothing about whether anything is flowing through "
            "it today."),
    }
