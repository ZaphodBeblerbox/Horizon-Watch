"""
heat_watch.py — new heat where it matters, as a question: investigate? scan?

NASA FIRMS sees heat everywhere: gas flares that burn for years, stubble
fires, and now and then a strike on a refinery. The owner's rule
(2026-10-06): heat in the places you care about should reach you as a
notification that asks what to do — look closer, or task a satellite pass —
and a station that is already burning should not keep asking.

Covered: each theater's view (its centre and camera height). Every poll asks
FIRMS for the last three days, so "new" can be judged without a warm-up:

    new      a detection in the last 12 h with no heat within 1 km before it
             (in the same fetch or in fire_detections)
    notable  new AND (FRP >= 30 MW, or near a watched area, or within 5 km of
             a military facility or a large/medium airport with >= 5 MW or
             within 2 km — a small fire near an airport is usually a field)
    grouped  fires within 15 km near the same place are one alert

Pure functions here; main._heat_watch_loop fetches, stores and alerts.
"""
from __future__ import annotations

import math

RECENT_HOURS = 12
NEAR_KM = 5.0
STRONG_MW = 30.0
SAME_KM = 1.0
GROUP_KM = 15.0
NEAR_MIN_MW = 5.0
AT_KM = 2.0


def km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def region_for(view: dict) -> tuple[float, float, float, float] | None:
    """A theater's camera view as a box (west, south, east, north)."""
    try:
        lat, lon, h = float(view["lat"]), float(view["lon"]), float(view.get("height") or 2e6)
    except (KeyError, TypeError, ValueError):
        return None
    half = max(2.0, min(10.0, h / 1e6 * 3))
    return (max(-180, lon - half), max(-89, lat - half * 0.75), min(180, lon + half), min(89, lat + half * 0.75))


def cluster(fires: list[dict], km_apart: float = SAME_KM) -> list[dict]:
    """Merge detections of one fire (pixels of the same blaze): strongest
    detection stands for the cluster, with its pixel count."""
    out = []
    for f in sorted(fires, key=lambda x: -(x.get("frp") or 0)):
        for c in out:
            if km(f["lat"], f["lon"], c["lat"], c["lon"]) <= km_apart:
                c["pixels"] += 1
                c["frp_total"] = round(c["frp_total"] + (f.get("frp") or 0), 1)
                break
        else:
            out.append({**f, "pixels": 1, "frp_total": round(f.get("frp") or 0, 1)})
    return out


def assess(recent: list[dict], before: list[tuple[float, float]], places: list[dict]) -> list[dict]:
    """recent: fire dicts {lat, lon, frp, when}; before: (lat, lon) of heat
    seen earlier; places: {name, kind, lat, lon, radius_km?}. Returns the
    notable new fires, each with the nearest place it is notable for."""
    out = []
    for f in cluster(recent):
        if any(km(f["lat"], f["lon"], a, o) <= SAME_KM for a, o in before):
            continue                                   # burning before: not new
        near, d_near = None, None
        mw = f.get("frp_total") or 0
        for p in places:
            d = km(f["lat"], f["lon"], p["lat"], p["lon"])
            if d > p.get("radius_km", NEAR_KM):
                continue
            # Near an airport or a base, a small fire is usually a field
            # burning: it counts when it is real heat or right at the place.
            # Near a watched area, any new heat counts.
            if p.get("kind") != "watched" and mw < NEAR_MIN_MW and d > AT_KM:
                continue
            if d_near is None or d < d_near:
                near, d_near = p, d
        strong = mw >= STRONG_MW
        if not (near or strong):
            continue
        out.append({**f, "near": near, "near_km": round(d_near, 1) if d_near is not None else None, "strong": strong})
    return group(out)


def group(events: list[dict], km_apart: float = GROUP_KM) -> list[dict]:
    """One alert per area: fires within 15 km (and near the same place, if
    any) are one event — "4 fires, up to 105 MW"."""
    out = []
    for e in sorted(events, key=lambda x: -(x.get("frp_total") or 0)):
        for g in out:
            same_place = (g.get("near") or {}).get("name") == (e.get("near") or {}).get("name")
            if same_place and km(e["lat"], e["lon"], g["lat"], g["lon"]) <= km_apart:
                g["fires"] += 1
                g["frp_total"] = round(g["frp_total"] + (e.get("frp_total") or 0), 1)
                break
        else:
            out.append({**e, "fires": 1, "frp_max": e.get("frp_total")})
    return out


def headline(e: dict, where: str | None) -> str:
    n = e.get("fires") or 1
    mw = (f"{round(e.get('frp_total') or 0)} MW" if n == 1
          else f"{n} fires, up to {round(e.get('frp_max') or 0)} MW")
    if e.get("near"):
        n = e["near"]
        at = "at" if (e.get("near_km") or 99) < 1 else f"{e['near_km']} km from"
        return f"New heat {at} {n['name']} ({mw})"
    return f"Strong new heat{' in ' + where if where else ''} ({mw})"


def severity(e: dict) -> str:
    kind = (e.get("near") or {}).get("kind")
    if kind in ("military", "watched") and e.get("strong"):
        return "critical"
    return "high"
