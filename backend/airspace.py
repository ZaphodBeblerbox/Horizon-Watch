"""
airspace.py - controlled airspace volumes from openAIP.

WHAT A DRAWN CEILING IS AND IS NOT. Airspace vertical limits are not
geometric heights. They are published three different ways and openAIP
returns all three:

    GND   feet above the ground
    MSL   feet above mean sea level
    STD   a FLIGHT LEVEL - a pressure altitude

A flight level is not a distance from anything. FL95 is wherever the
altimeter reads 9,500ft when set to 1013.25hPa, which on a given day
may be a hundred metres from where this code draws it. So a volume
drawn from an STD limit is approximate by tens of metres and moves with
the weather, and every response says so.

It is still worth drawing, and it is honest against aircraft: ADS-B
alt_baro is ALSO a pressure altitude, so comparing an aircraft with an
FL-defined ceiling is like for like. It is the relationship to the
terrain underneath that is fuzzy.

UNIT AND DATUM CODES ARE MEASURED, NOT ASSUMED. openAIP sends integers
with no codebook in the payload. Over a 500-airspace sample: every one
of the 228 floors with value 0 was (unit 1, datum 0), which can only be
"0 feet above ground"; and unit 6 co-occurred with datum 2 exactly
288 times out of 288, which can only be flight levels against the
standard datum. Hence the two tables below.
"""
from __future__ import annotations

import json as _json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

BASE = "https://api.core.openaip.net/api"

#: Altitude units. See the module docstring for how these were pinned.
UNIT = {0: "m", 1: "ft", 6: "FL"}

#: Vertical reference datums.
DATUM = {0: "GND", 1: "MSL", 2: "STD"}

#: ICAO airspace classes. A-G are defined in ICAO Annex 11; openAIP uses
#: 8 for airspace it holds with no class assigned, which is reported as
#: unclassified rather than guessed at.
ICAO_CLASS = {0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F", 6: "G"}

FT_TO_M = 0.3048

#: openAIP rate-limits hard - a second call seconds after the first came
#: back 429 - and airspace boundaries change on the AIRAC cycle, every
#: 28 days. Hours of caching costs nothing in freshness.
CACHE_TTL_S = 6 * 3600

# AIRSPACE IS NEARLY STATIC — a control zone does not move — so the cache
# is written to disk as well as held in memory. In memory alone it was
# empty on every restart, which meant every restart went back to an API
# that rate-limits, and until it answered the layer drew nothing. On disk
# it also means the layer keeps working with no network at all, which is
# the difference between a desktop build that shows airspace offline and
# one that shows an empty sky.
DISK_TTL_S = 30 * 24 * 3600

_cache: dict = {}


def key() -> str | None:
    return (os.getenv("OPENAIP_KEY") or "").strip() or None


def available() -> bool:
    return key() is not None


def _get(path: str, timeout: int = 45) -> dict | None:
    k = key()
    if not k:
        return None
    req = urllib.request.Request(
        BASE + path,
        headers={"x-openaip-api-key": k, "User-Agent": "HorizonWatch/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return _json.loads(r.read())
    except urllib.error.HTTPError as e:
        # 429 is the common one and is not a bug; it is the reason the
        # cache TTL is measured in hours.
        logger.warning("openaip: HTTP %s for %s", e.code, path)
    except Exception:
        logger.exception("openaip: request failed for %s", path)
    return None


def metres(limit: dict | None) -> float | None:
    """A vertical limit in metres, or None if it cannot be read.

    Flight levels are converted at 100ft per level, which is the
    definition of a flight level and not an approximation of one. What
    is approximate is where that pressure surface physically sits.
    """
    if not isinstance(limit, dict):
        return None
    value = limit.get("value")
    if not isinstance(value, (int, float)):
        return None
    unit = UNIT.get(limit.get("unit"))
    if unit == "m":
        return float(value)
    if unit == "ft":
        return float(value) * FT_TO_M
    if unit == "FL":
        return float(value) * 100.0 * FT_TO_M
    return None


def label(limit: dict | None) -> str | None:
    """How a controller would say it: "GND", "FL95", "2500 ft MSL"."""
    if not isinstance(limit, dict):
        return None
    value = limit.get("value")
    if not isinstance(value, (int, float)):
        return None
    unit = UNIT.get(limit.get("unit"))
    datum = DATUM.get(limit.get("referenceDatum"))
    if unit == "FL":
        return f"FL{int(value)}"
    if value == 0 and datum == "GND":
        return "GND"
    v = int(value) if float(value).is_integer() else value
    return f"{v} {unit or '?'}{f' {datum}' if datum else ''}"


def normalise(item: dict) -> dict | None:
    """One openAIP airspace in this app's shape, or None if unusable."""
    if not isinstance(item, dict):
        return None
    geom = item.get("geometry") or {}
    if geom.get("type") != "Polygon":
        # openAIP also serves multipolygons for a few; skipped rather
        # than half-drawn, and counted by the caller.
        return None
    rings = geom.get("coordinates") or []
    if not rings or len(rings[0]) < 4:
        return None

    lower, upper = item.get("lowerLimit"), item.get("upperLimit")
    floor_m, ceil_m = metres(lower), metres(upper)
    if floor_m is None or ceil_m is None or ceil_m <= floor_m:
        return None

    cls = ICAO_CLASS.get(item.get("icaoClass"))
    return {
        "id": item.get("_id"),
        "name": (item.get("name") or "").strip() or None,
        "country": item.get("country"),
        # ICAO class is a defined thing; openAIP's numeric `type` is its
        # own enum with no codebook in the payload, so it travels as the
        # raw integer rather than as an invented name.
        "icao_class": cls or "unclassified",
        "openaip_type": item.get("type"),
        "floor_m": round(floor_m, 1),
        "ceiling_m": round(ceil_m, 1),
        "floor_label": label(lower),
        "ceiling_label": label(upper),
        "floor_ref": DATUM.get((lower or {}).get("referenceDatum")),
        "ceiling_ref": DATUM.get((upper or {}).get("referenceDatum")),
        # True when either limit is a flight level, i.e. pressure-based
        # and therefore only approximately where this is drawn.
        "pressure_based": "STD" in {DATUM.get((lower or {}).get("referenceDatum")),
                                    DATUM.get((upper or {}).get("referenceDatum"))},
        "by_notam": bool(item.get("byNotam")),
        "activity": item.get("activity"),
        "ring": rings[0],
    }


# openAIP rejects a bounding box larger than roughly 5 degrees on a side.
# Measured against the live API: 5.0 works at 51N, 6.0 returns 400. Four is
# used so the margin survives the rounding above and any latitude effect.
MAX_TILE_DEG = 4.0

# And a viewport can be continental, so tiling one at 4 degrees could mean
# a hundred requests against an API that rate-limits. Past this the request
# is served from whatever tiles the cap allows, centred on the viewport —
# the layer only draws close in anyway (see MAX_SPAN_DEG in the layer).
MAX_TILES = 9

# Seconds between tile requests. See the burst note where it is used.
_TILE_PAUSE_S = 2.5


def _disk_path(key: str) -> str:
    import hashlib
    try:
        from main import DATA_DIR
        root = os.path.join(DATA_DIR, "airspace_cache")
    except Exception:
        root = os.path.join(os.path.dirname(__file__), "data", "airspace_cache")
    os.makedirs(root, exist_ok=True)
    return os.path.join(root, hashlib.sha1(key.encode()).hexdigest() + ".json")


def _disk_get(key: str):
    try:
        path = _disk_path(key)
        if not os.path.exists(path):
            return None
        if time.time() - os.path.getmtime(path) > DISK_TTL_S:
            return None
        with open(path) as fh:
            return _json.load(fh)
    except Exception:
        # A cache that cannot be read is a cache miss, never an error the
        # caller has to handle.
        return None


def _disk_put(key: str, data: dict) -> None:
    try:
        path = _disk_path(key)
        tmp = path + ".tmp"
        with open(tmp, "w") as fh:
            _json.dump(data, fh)
        os.replace(tmp, path)          # atomic, so a crash cannot leave half a file
    except Exception:
        logger.debug("airspace: disk cache write failed", exc_info=True)


def _tiles(west: float, south: float, east: float, north: float):
    """Split a viewport into boxes openAIP will actually accept.

    Centred rather than truncated: when the viewport is too large for the
    tile budget, the tiles that survive are the ones around the middle of
    the screen, which is where the reader is looking.
    """
    import math as _math
    nx = max(1, _math.ceil((east - west) / MAX_TILE_DEG))
    ny = max(1, _math.ceil((north - south) / MAX_TILE_DEG))
    dx = (east - west) / nx
    dy = (north - south) / ny
    boxes = []
    for iy in range(ny):
        for ix in range(nx):
            boxes.append((round(west + ix * dx, 4), round(south + iy * dy, 4),
                          round(west + (ix + 1) * dx, 4), round(south + (iy + 1) * dy, 4)))
    if len(boxes) <= MAX_TILES:
        return boxes
    cx, cy = (west + east) / 2, (south + north) / 2
    boxes.sort(key=lambda b: ((b[0] + b[2]) / 2 - cx) ** 2 + ((b[1] + b[3]) / 2 - cy) ** 2)
    return boxes[:MAX_TILES]


def in_bbox(west: float, south: float, east: float, north: float,
            limit: int = 400, force: bool = False) -> dict:
    """Airspace volumes intersecting a viewport."""
    if not available():
        return {"available": False, "error": "OPENAIP_KEY not configured",
                "airspaces": []}

    # Rounded, so small camera nudges reuse the same cached answer.
    bbox = [round(v, 1) for v in (west, south, east, north)]
    ck = f"{bbox}:{limit}"
    hit = _cache.get(ck)
    if hit and not force and (time.time() - hit["ts"]) < CACHE_TTL_S:
        # An incomplete answer is held only briefly, so a viewport that
        # lost tiles to the rate limiter retries within the minute rather
        # than staying incomplete for the full TTL.
        if hit["data"].get("complete", True) or (time.time() - hit["ts"]) < 60:
            return {**hit["data"], "cached": True}
    if not force:
        disk = _disk_get(ck)
        if disk:
            _cache[ck] = {"ts": time.time(), "data": disk}
            return {**disk, "cached": True, "from_disk": True}

    # THE VIEWPORT IS TILED, because openAIP refuses a bbox over about
    # 5 degrees on a side — "exceeds the maximum allowed bounding box", a
    # 400 that this code used to report as "openAIP request failed" with
    # an empty list. The layer allowed spans up to 14 degrees, so at almost
    # every zoom the request was rejected and the map drew no airspace at
    # all. That is the whole reason this layer appeared broken.
    # EACH TILE IS CACHED ON ITS OWN, which matters more than it looks.
    # openAIP rate-limits hard enough that six tiles in a row had five
    # rejected, and caching only the finished viewport threw the one
    # success away with them. Per-tile, a rejected tile is the only thing
    # lost: the next request re-uses what already arrived and asks for the
    # gaps, so a viewport fills in over a few passes instead of failing
    # whole every time.
    items = []
    failures = 0
    fetched = 0
    for (tw, ts, te, tn) in _tiles(*bbox):
        tkey = f"tile:{tw},{ts},{te},{tn}:{limit}"
        cached_tile = None if force else _disk_get(tkey)
        if cached_tile is not None:
            items.extend(cached_tile.get("items") or [])
            continue
        if fetched:
            # Only pause between calls we actually make; a fully cached
            # viewport must not pay for requests it never sent.
            time.sleep(_TILE_PAUSE_S)
        q = urllib.parse.urlencode({
            "bbox": f"{tw},{ts},{te},{tn}",
            "limit": int(limit),
            "page": 1,
        })
        raw = _get(f"/airspaces?{q}")
        fetched += 1
        if raw is None:
            failures += 1
            continue
        got = raw.get("items") or []
        _disk_put(tkey, {"items": got})
        items.extend(got)

    if failures and not items:
        if hit:
            # A rate-limited call is not empty sky.
            return {**hit["data"], "cached": True, "stale": True}
        return {"available": False, "error": "openAIP request failed",
                "airspaces": []}

    # Tiles overlap at their seams and a volume spanning one is returned by
    # both, so the same airspace would otherwise be drawn twice.
    seen = set()
    deduped = []
    for it in items:
        ident = it.get("_id") or it.get("id") or id(it)
        if ident in seen:
            continue
        seen.add(ident)
        deduped.append(it)
    items = deduped
    out = [a for a in (normalise(i) for i in items) if a]
    data = {
        "available": True,
        "airspaces": out,
        "returned": len(out),
        "skipped_non_polygon": len(items) - len(out),
        "source": "openAIP",
        "source_url": "https://www.openaip.net/",
        "note": ("Vertical limits are published as GND, MSL or flight level. "
                 "A flight level is a pressure altitude, so volumes drawn "
                 "from one are approximate by tens of metres and move with "
                 "the weather."),
    }
    # A VIEWPORT IS ONLY CACHED WHOLE WHEN IT ARRIVED WHOLE. Freezing a
    # partial answer for the disk TTL would lock in whatever the rate
    # limiter happened to allow on the first try, and no later request
    # would ever fill the gaps — the map would show two thirds of the
    # airspace over Germany for a month. Incomplete answers are still
    # returned and still held in memory briefly, but the next request goes
    # back for the tiles that failed, and those arrive cached.
    data["complete"] = failures == 0
    if failures:
        data["partial_tiles"] = failures
    _cache[ck] = {"ts": time.time(), "data": data}
    if failures == 0:
        _disk_put(ck, data)
    return data
