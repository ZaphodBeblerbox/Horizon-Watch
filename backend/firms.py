"""
firms.py — NASA FIRMS active-fire detections as a scan trigger.

THE CHAIN. FIRMS publishes thermal anomalies from VIIRS and MODIS within about
three hours of overpass. A fire near something we care about is a reason to
task imagery over it and run object detection on the result — which is the
whole point: a thermal hotspot says SOMETHING IS BURNING, and only a picture
says what.

⚠ NOT EVERY FIRE. FIRMS reports tens of thousands of detections a day
worldwide, and the overwhelming majority are agricultural burning, forest
fires and gas flares. Tasking imagery on all of them would exhaust the
Copernicus quota inside a day and bury real findings in crop stubble.

So a detection has to EARN a scan, and the test is relevance to something
already in the picture: a watch zone, a port, an airfield, a register asset.
"A fire happened" is not a finding. "A fire happened inside your watch zone,
400m from a terminal" is.

Persistent gas flares are the specific trap. A refinery flare burns every
night at the same coordinate and FIRMS reports it faithfully every night, so
without suppression the first zone containing a refinery would consume the
entire imagery budget for ever. Repeat detections at a location we have
already scanned are dropped.
"""
from __future__ import annotations

import csv
import io
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

# VIIRS 375m is the workhorse: finest resolution of the free products, and
# fine enough that a detection maps to a facility rather than a district.
SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT")
DEFAULT_SOURCE = "VIIRS_SNPP_NRT"

_UA = "HorizonWatch/2.0 (+https://github.com/ZaphodBeblerbox/Horizon-Watch)"

# A detection below this confidence is noise more often than fire.
MIN_CONFIDENCE = {"l": 0, "n": 1, "h": 2}     # VIIRS: low / nominal / high
MIN_BRIGHTNESS_K = 300.0                       # kelvin, brightness temperature

# How close a fire must be to something we track to be worth a picture.
RELEVANCE_RADIUS_KM = 5.0

# A location already scanned within this window is not scanned again — the
# gas-flare suppressor.
REPEAT_SUPPRESS_HOURS = 72
REPEAT_RADIUS_KM = 2.0


def api_key() -> str | None:
    return (os.getenv("FIRMS_MAP_KEY") or os.getenv("NASA_FIRMS_KEY") or "").strip() or None


def available() -> bool:
    return api_key() is not None


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def fetch_area(bbox: tuple[float, float, float, float], *, source: str = DEFAULT_SOURCE,
               days: int = 1, timeout: int = 45) -> dict:
    """Active fires in a bbox (west, south, east, north) over the last `days`.

    Returns {"status": ..., "fires": [...]} — and says plainly when it cannot
    run, rather than returning an empty list that reads as "no fires".
    """
    key = api_key()
    if not key:
        return {"status": "unavailable",
                "reason": "no FIRMS_MAP_KEY set — a free key comes from "
                          "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
                "fires": []}
    w, s, e, n = bbox
    url = f"{BASE}/{key}/{source}/{w},{s},{e},{n}/{max(1, min(int(days), 10))}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
    except Exception as ex:
        return {"status": "error", "reason": f"{type(ex).__name__}: {ex}", "fires": []}

    if body.lstrip().lower().startswith(("invalid", "error")):
        return {"status": "error", "reason": body.strip()[:200], "fires": []}

    fires = []
    for row in csv.DictReader(io.StringIO(body)):
        try:
            lat, lon = float(row["latitude"]), float(row["longitude"])
        except Exception:
            continue
        bright = _f(row.get("bright_ti4") or row.get("brightness"))
        fires.append({
            "lat": lat, "lon": lon,
            "brightness_k": bright,
            "confidence": (row.get("confidence") or "").strip().lower(),
            "acq_date": row.get("acq_date"), "acq_time": row.get("acq_time"),
            "satellite": row.get("satellite"), "instrument": row.get("instrument"),
            "frp": _f(row.get("frp")),           # fire radiative power, MW
            "daynight": row.get("daynight"),
            "source": source,
        })
    return {"status": "ok", "fires": fires, "source": source}


def _f(v):
    try:
        return float(v)
    except Exception:
        return None


def is_credible(fire: dict) -> bool:
    """Is this detection strong enough to act on?"""
    conf = (fire.get("confidence") or "").lower()
    if conf and conf in MIN_CONFIDENCE and MIN_CONFIDENCE[conf] < 1:
        return False                                  # low confidence
    if conf.isdigit() and int(conf) < 50:             # MODIS reports 0-100
        return False
    b = fire.get("brightness_k")
    if b is not None and b < MIN_BRIGHTNESS_K:
        return False
    return True


def fire_time(fire: dict) -> datetime | None:
    """FIRMS splits acquisition into a date and an HHMM string."""
    d, t = fire.get("acq_date"), str(fire.get("acq_time") or "").zfill(4)
    if not d:
        return None
    try:
        return datetime.strptime(f"{d} {t[:2]}:{t[2:4]}", "%Y-%m-%d %H:%M")
    except Exception:
        return None


def relevant_to(fire: dict, targets: list[dict], radius_km: float = RELEVANCE_RADIUS_KM):
    """The nearest thing we track, if the fire is close enough to matter.

    `targets` are dicts with lat/lon and a label — watch zones, ports,
    airfields, register assets. A fire with no target nearby is a fire in a
    field, and this system has nothing useful to say about it.
    """
    best = None
    for t in targets:
        try:
            d = haversine_km(fire["lat"], fire["lon"], t["lat"], t["lon"])
        except Exception:
            continue
        if d <= radius_km and (best is None or d < best["distance_km"]):
            best = {**t, "distance_km": round(d, 2)}
    return best


def suppress_repeats(fires: list[dict], recent_points: list[dict],
                     radius_km: float = REPEAT_RADIUS_KM) -> list[dict]:
    """Drop fires at locations already scanned recently.

    A refinery flare burns every night at the same coordinate and FIRMS
    reports it every night. Without this, the first zone containing a
    refinery consumes the whole imagery budget, for ever.
    """
    out = []
    for f in fires:
        if any(haversine_km(f["lat"], f["lon"], p["lat"], p["lon"]) <= radius_km
               for p in recent_points):
            continue
        out.append(f)
    return out


def triggers(fires: list[dict], targets: list[dict], recent_points: list[dict] | None = None,
             *, radius_km: float = RELEVANCE_RADIUS_KM) -> list[dict]:
    """Fires that have earned a satellite tasking, strongest first."""
    credible = [f for f in fires if is_credible(f)]
    fresh = suppress_repeats(credible, recent_points or [])
    out = []
    for f in fresh:
        near = relevant_to(f, targets, radius_km)
        if not near:
            continue
        out.append({**f, "target": near,
                    "why": f"{near.get('label') or near.get('system_id')} "
                           f"at {near['distance_km']}km"})
    out.sort(key=lambda x: (-(x.get("frp") or 0), x["target"]["distance_km"]))
    return out
