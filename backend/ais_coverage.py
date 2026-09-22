"""
ais_coverage.py — what this system can actually see, at sea.

THE PROBLEM THIS EXISTS TO STOP. Our AIS comes from aisstream.io, which
aggregates TERRESTRIAL receivers: volunteers with antennas, reaching
perhaps 40-80km offshore. Coverage is therefore a map of where hobbyists
live, not of where shipping matters. Measured over 2,000,030 stored
positions:

    North Sea          890,125
    Baltic             291,432
    Mediterranean      264,963
    South China Sea     43,306
    Taiwan Strait          683
    Red Sea                 28
    Gulf of Aden             3
    Hormuz / Gulf            0

Zero at Hormuz. Any finding that counts vessels and compares regions will
therefore rank northern Europe as the most active place on earth and
report the Strait of Hormuz as quiet — which is not a subtle bias, it is
the opposite of the truth, stated confidently.

SATELLITE AIS WOULD FIX IT AND IS NOT FREE. Spire, ORBCOMM and Kpler all
sell it. Global Fishing Watch publishes satellite-derived AIS through a
free API, but it requires a registered token, so it is a decision for an
operator rather than something this module can assume.

WHAT THIS MODULE DOES INSTEAD is refuse to let the gap stay invisible. A
count from a region is reported with the coverage behind it, so "3
vessels in the Gulf of Aden" reads as "we can barely see the Gulf of
Aden" rather than as "the Gulf of Aden is quiet".
"""
from __future__ import annotations

import time

# Boxes chosen to match the chokepoints and theatres this system already
# watches, so coverage can be read against the places it makes claims about.
REGIONS: list[tuple[str, float, float, float, float]] = [
    # name, south, north, west, east
    ("North Sea",        50.0, 62.0, -5.0,   9.0),
    ("Baltic",           53.0, 66.0,  9.0,  30.0),
    ("Mediterranean",    30.0, 46.0, -6.0,  36.0),
    ("Black Sea",        40.0, 48.0, 27.0,  42.0),
    ("Hormuz / Gulf",    22.0, 30.0, 48.0,  60.0),
    ("Red Sea",          10.0, 26.0, 32.0,  45.0),
    ("Gulf of Aden",     -5.0, 15.0, 40.0,  55.0),
    ("Suez approaches",  27.0, 33.0, 30.0,  36.0),
    ("Malacca",          -2.0,  8.0, 95.0, 105.0),
    ("South China Sea",   0.0, 26.0, 105.0, 122.0),
    ("Taiwan Strait",    21.0, 27.0, 118.0, 124.0),
    ("Korea / Japan",    30.0, 46.0, 124.0, 146.0),
    ("US East Coast",    24.0, 45.0, -82.0, -66.0),
    ("West Africa",      -5.0, 15.0, -18.0,  10.0),
]

# Below this many stored positions a region cannot support a claim about
# how busy it is. Chosen against the measured distribution: the gap
# between "thousands" and "single digits" is the real cliff, not a
# gradual falloff.
BLIND_THRESHOLD = 500

_CACHE: dict = {}
_CACHE_TTL = 15 * 60

CAVEAT = ("AIS here is terrestrial — receivers reach 40-80km from shore and "
          "cluster where volunteers run them. Coverage is a map of antennas, "
          "not of shipping.")


def measure(force: bool = False, compute_if_cold: bool = True) -> dict:
    """Stored AIS positions per region. Never raises.

    EXPENSIVE, AND CALLERS ON A REQUEST PATH MUST NOT PAY FOR IT. This
    counts vessel_history — 10.2 million rows in production — once for
    the total and again for each of the regions, with no index on
    lat/lon, so a cold run is tens of seconds. It is cached for fifteen
    minutes, which is fine for a dashboard and disastrous for anything
    called in a loop: whichever unlucky request arrives when the cache
    has just expired wears the whole recount.

    That is precisely what happened. notification_relevance() calls
    _coverage_note() per alert, the notifications endpoint runs it over
    up to 2,400 alerts, and profiling put 9.83 of 10.3 seconds inside
    this one function. The tray's endpoint took 45 seconds on a cold
    cache and returned nothing at all before the index fix.

    So `compute_if_cold=False` lets a caller say "only if it is already
    known". A missing coverage note is a missing sentence of context; a
    45-second request is a feature that does not work.
    """
    hit = _CACHE.get("coverage")
    if hit and not force and time.time() - hit["ts"] < _CACHE_TTL:
        return hit["data"]
    if not compute_if_cold and not force:
        # Stale is better than slow: serve an expired reading if we have
        # one, and otherwise say nothing rather than stalling the caller.
        if hit:
            return hit["data"]
        return {"available": False, "error": "not measured yet", "regions": []}

    rows = []
    try:
        from database import VesselHistory, get_db
        from sqlalchemy import func
        with get_db() as db:
            total = db.query(func.count(VesselHistory.id)).scalar() or 0
            for name, s, n, w, e in REGIONS:
                cnt = (db.query(func.count(VesselHistory.id))
                         .filter(VesselHistory.lat >= s, VesselHistory.lat <= n,
                                 VesselHistory.lon >= w, VesselHistory.lon <= e)
                         .scalar() or 0)
                rows.append({"region": name, "positions": int(cnt),
                             "bbox": [s, n, w, e]})
    except Exception as ex:                                 # noqa: BLE001
        return {"available": False, "error": f"{type(ex).__name__}: {ex}",
                "regions": []}

    rows.sort(key=lambda r: -r["positions"])
    best = rows[0]["positions"] if rows else 0
    for r in rows:
        r["share"] = round(r["positions"] / best, 4) if best else 0.0
        r["blind"] = r["positions"] < BLIND_THRESHOLD
        # The sentence a reader needs, rather than a ratio they must
        # interpret.
        r["reads_as"] = (
            "effectively unwatched — a quiet count here means we cannot see it"
            if r["blind"] else
            "thin coverage — counts here understate activity"
            if r["share"] < 0.05 else
            "usable coverage")

    data = {
        "available": True,
        "total_positions": total,
        "regions": rows,
        "blind_regions": [r["region"] for r in rows if r["blind"]],
        "caveat": CAVEAT,
        "remedy": ("global coverage needs satellite AIS; Global Fishing Watch "
                   "publishes it through a free API that requires a registered "
                   "token"),
        "error": None,
    }
    _CACHE["coverage"] = {"ts": time.time(), "data": data}
    return data


def coverage_for(lat: float, lon: float, compute_if_cold: bool = False) -> dict | None:
    """How well we see this point, for attaching to a finding made there.

    Does NOT compute by default — see measure(). This is called once per
    alert inside the notification loop, and a note about antenna
    coverage is not worth making the tray unusable.
    """
    if lat is None or lon is None:
        return None
    cov = measure(compute_if_cold=compute_if_cold)
    if not cov.get("available"):
        return None
    for r in cov["regions"]:
        s, n, w, e = r["bbox"]
        if s <= lat <= n and w <= lon <= e:
            return {"region": r["region"], "positions": r["positions"],
                    "blind": r["blind"], "reads_as": r["reads_as"]}
    return None
