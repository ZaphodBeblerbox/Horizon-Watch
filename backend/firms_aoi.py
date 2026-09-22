"""
firms_aoi.py — a fire becomes a standing area of interest.

WHAT WAS MISSING. The FIRMS chain already worked in one direction: a
credible hotspot inside a pre-defined strategic zone tasked an imagery
scan, and that was verified end to end on a real fire at Khor Fakkan.
Two things it did not do, and both are the difference between a demo
and a monitoring system:

  1. It only ever matched fires against zones that ALREADY existed. A
     fire in a place nobody had drawn a box around triggered nothing at
     all — which is most of the world, and certainly most of the places
     a fire is interesting.

  2. It scanned once. Nothing was recorded that would cause the same
     ground to be looked at again tomorrow, so the one thing imagery is
     actually good at — did this change — was never asked.

`watch_zones` already has everything needed for the second part
(scan_interval_hours, next_scan_at, enabled, aoi_class), and had exactly
one row in it, created by hand. Nothing was writing to it.

DEDUPLICATION IS THE WHOLE PROBLEM. A single wildfire produces dozens of
hotspot pixels across several satellite passes. Creating one AOI per
hotspot would have produced dozens of overlapping zones scanning the
same ground, each burning Sentinel quota and each raising its own
alerts. Fires are therefore snapped to a grid and matched against
existing fire-created zones by distance before anything is written.

AND THEY MUST EXPIRE. An AOI created by a fire that stopped burning
three weeks ago is quota spent on nothing. These carry their own class
so they can be pruned without touching an AOI a person drew.
"""
from __future__ import annotations
import math

#: Half-width of the box put around a fire. Sentinel-2 is 10m/px, so
#: ~6km across is a few hundred pixels — enough to contain the fire and
#: whatever is next to it that matters, without asking for a scene so
#: large it is mostly empty desert.
DEFAULT_RADIUS_KM = 3.0

#: A new fire this close to an existing fire-made AOI refreshes that one
#: instead of creating another. Set from the box size: two AOIs closer
#: than this overlap enough that scanning both is scanning twice.
DEDUP_KM = 5.0

#: Fires move and change fast; a day-old look is not much use.
SCAN_INTERVAL_HOURS = 12

#: Dropped after this long with no new fire, so quota is not spent on
#: ground that stopped burning weeks ago.
EXPIRE_DAYS = 14

#: Marks an AOI this module made, so pruning can never delete one a
#: person drew by hand.
AOI_CLASS = "firms_fire"

EARTH_KM_PER_DEG = 111.32


def km_between(lat1, lon1, lat2, lon2) -> float:
    """Great-circle distance in km. Haversine, because the equirectangular
    shortcut is wrong by enough to matter at the latitudes fires happen."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def bbox_for(lat: float, lon: float, radius_km: float = DEFAULT_RADIUS_KM) -> dict:
    """A square-ish box around a point, in degrees.

    Longitude is scaled by latitude, or a box at 60°N is half as wide on
    the ground as the same box at the equator.
    """
    dlat = radius_km / EARTH_KM_PER_DEG
    # Clamped so a fire near a pole does not ask for a box wider than
    # the world.
    cos = max(0.05, math.cos(math.radians(lat)))
    dlon = min(45.0, radius_km / (EARTH_KM_PER_DEG * cos))
    return {
        "min_lat": round(lat - dlat, 6), "max_lat": round(lat + dlat, 6),
        "min_lon": round(lon - dlon, 6), "max_lon": round(lon + dlon, 6),
    }


def polygon_for(lat: float, lon: float, radius_km: float = DEFAULT_RADIUS_KM) -> dict:
    """The same box as a closed GeoJSON polygon, in [lon, lat] order."""
    b = bbox_for(lat, lon, radius_km)
    ring = [
        [b["min_lon"], b["min_lat"]], [b["max_lon"], b["min_lat"]],
        [b["max_lon"], b["max_lat"]], [b["min_lon"], b["max_lat"]],
        [b["min_lon"], b["min_lat"]],
    ]
    return {"type": "Polygon", "coordinates": [ring]}


def dedupe_fires(fires: list, grid_km: float = DEDUP_KM) -> list:
    """One representative fire per cluster — the most energetic.

    NOT A GRID. The first version of this snapped fires to a coarse grid
    cell, and a single fire front 4km across straddled a cell boundary
    and became two AOIs — the identical false negative this codebase
    already documents for fusion geo keys, where two signals a few km
    apart on opposite sides of a 0.1° boundary could never correlate.
    Rounding is not clustering.

    Greedy by distance instead, strongest fire first, so a cluster is
    seeded by the most energetic pixel and everything within DEDUP_KM of
    it joins. FRP is the right ordering: it is the closest thing the feed
    has to "how big is this", so the AOI ends up centred on the strongest
    part of the fire rather than on whichever pixel the satellite
    happened to report first.
    """
    usable = []
    for f in fires or []:
        try:
            lat, lon = float(f["lat"]), float(f["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        frp = f.get("frp")
        frp = float(frp) if isinstance(frp, (int, float)) else -1.0
        usable.append((frp, lat, lon, f))

    usable.sort(key=lambda r: -r[0])
    kept: list = []
    for _frp, lat, lon, f in usable:
        if any(km_between(lat, lon, klat, klon) <= grid_km
               for klat, klon, _kf in kept):
            continue
        kept.append((lat, lon, f))
    return [f for _la, _lo, f in kept]


def nearest_existing(lat: float, lon: float, zones: list) -> tuple:
    """The closest existing AOI and its distance in km, or (None, None).

    `zones` is any iterable of objects or dicts carrying a centre, which
    is how it can be called with ORM rows in production and plain dicts
    in a test.
    """
    best, best_km = None, None
    for z in zones or []:
        c = zone_centre(z)
        if c is None:
            continue
        km = km_between(lat, lon, c[0], c[1])
        if best_km is None or km < best_km:
            best, best_km = z, km
    return best, best_km


def zone_centre(zone) -> tuple | None:
    """The centre of a zone from its bbox, whatever shape the row is."""
    def get(name):
        if isinstance(zone, dict):
            return zone.get(name)
        return getattr(zone, name, None)

    vals = [get(n) for n in
            ("bbox_min_lat", "bbox_max_lat", "bbox_min_lon", "bbox_max_lon")]
    if any(v is None for v in vals):
        return None
    try:
        mnla, mxla, mnlo, mxlo = (float(v) for v in vals)
    except (TypeError, ValueError):
        return None
    return ((mnla + mxla) / 2.0, (mnlo + mxlo) / 2.0)


def should_create(lat: float, lon: float, zones: list,
                  dedup_km: float = DEDUP_KM) -> bool:
    """Whether this fire needs a NEW AOI, or an existing one covers it."""
    _z, km = nearest_existing(lat, lon, zones)
    return km is None or km > dedup_km


def zone_name_for(fire: dict) -> str:
    """A name that says what it is and where, never a bare coordinate.

    A zone called "ZONE-1731" tells a reader nothing; the standing rule
    here is that a notification never shows a bare identifier.
    """
    lat, lon = float(fire["lat"]), float(fire["lon"])
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    place = fire.get("place") or fire.get("nearest") or ""
    where = f"{abs(lat):.2f}°{ns} {abs(lon):.2f}°{ew}"
    return f"Fire — {place} ({where})" if place else f"Fire — {where}"


def fire_alert_text(fire: dict, detections: list | None = None) -> str:
    """What the user is actually told, with the reason attached.

    Standing rule in this system: a notification carries why it is
    relevant, never just that something happened.
    """
    frp = fire.get("frp")
    sat = fire.get("satellite") or fire.get("instrument") or "satellite"
    bits = [f"Thermal hotspot detected by {sat}"]
    if isinstance(frp, (int, float)):
        bits.append(f"{frp:.0f}MW radiative power")
    bits.append("imagery tasked over the area")
    n = len(detections or [])
    if detections is not None:
        bits.append(f"{n} object{'' if n == 1 else 's'} found in the scene"
                    if n else "no objects found in the scene")
    bits.append(f"area now rescanned every {SCAN_INTERVAL_HOURS}h")
    return "; ".join(bits) + "."
