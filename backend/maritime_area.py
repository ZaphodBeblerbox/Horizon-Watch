"""
maritime_area.py — what is actually happening inside a piece of sea.

Clicking a chokepoint used to return a strategic description and a few
headlines; clicking an EEZ returned the names of the two countries whose
claim it separates. Both are reference facts you could read once and never
need again, and neither answers the question someone clicking a body of
water is asking: what is in there right now.

So this computes, over any polygon or bounding box:

    traffic      how many vessels are inside, and what they are doing
    congestion   that count against what this area normally holds
    sanctioned   hulls present that appear on a sanctions list
    flags        whose ships they are

CONGESTION IS THE ONE TO BE CAREFUL WITH, because it is the number that
looks most like insight and is easiest to fake. A count on its own says
nothing — the Strait of Hormuz always has ships in it. It is only
meaningful against that area's own recent baseline, so a baseline is kept
per area and the reading is reported as a ratio against it, with the
sample size that produced it. Until an area has a baseline the congestion
field is explicitly null rather than 1.0, because "normal" and "we have
not watched this long enough to know" are different answers.

NOTHING HERE FABRICATES A POSITION. A vessel with no fix is not placed at
the centre of the area; it is left out, and the count says so.
"""
from __future__ import annotations

import datetime
import math
import time

# How long an area's traffic samples are kept when building its baseline.
BASELINE_WINDOW_S = 6 * 3600

# Samples needed before a baseline is trustworthy enough to divide by.
MIN_BASELINE_SAMPLES = 5

# A vessel under this speed is holding station rather than transiting. Two
# knots is the usual working threshold: drifting and anchored hulls sit
# below it, and a ship making way is comfortably above.
STATIONARY_KTS = 2.0

# area key -> [(timestamp, vessel_count), ...]
_baseline: dict[str, list[tuple[float, int]]] = {}


def _point_in_ring(lat: float, lon: float, ring: list) -> bool:
    """Ray casting. `ring` is [[lon, lat], ...] as GeoJSON orders it."""
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and \
           (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _in_area(lat, lon, *, ring=None, bounds=None) -> bool:
    if lat is None or lon is None:
        return False
    if ring:
        return _point_in_ring(lat, lon, ring)
    if bounds:
        s, w, n, e = bounds
        return s <= lat <= n and w <= lon <= e
    return False


def record_baseline(area_key: str, count: int, now: float | None = None) -> None:
    """Add one observation to an area's traffic baseline."""
    now = now or time.time()
    samples = _baseline.setdefault(area_key, [])
    samples.append((now, count))
    cutoff = now - BASELINE_WINDOW_S
    _baseline[area_key] = [s for s in samples if s[0] >= cutoff][-400:]


def baseline_for(area_key: str) -> tuple[float | None, int]:
    """(mean vessels, sample count). Mean is None until there is enough."""
    samples = _baseline.get(area_key) or []
    if len(samples) < MIN_BASELINE_SAMPLES:
        return None, len(samples)
    return sum(c for _, c in samples) / len(samples), len(samples)


def summarise(vessels: list[dict], *, area_key: str, ring=None, bounds=None,
              sanctions_check=None, flag_lookup=None, now: float | None = None) -> dict:
    """Everything this system can honestly say about one piece of sea.

    `sanctions_check` is injected rather than imported so this module stays
    testable without the sanctions loader, and so a slow or failing
    sanctions lookup degrades this to "we could not check" instead of
    taking the whole panel down.
    """
    now = now or time.time()
    inside, no_fix = [], 0

    for v in vessels or []:
        lat, lon = v.get("lat"), v.get("lon")
        if lat is None or lon is None:
            no_fix += 1
            continue
        if _in_area(lat, lon, ring=ring, bounds=bounds):
            inside.append(v)

    moving = [v for v in inside
              if isinstance(v.get("speed"), (int, float)) and v["speed"] >= STATIONARY_KTS]
    holding = [v for v in inside
               if isinstance(v.get("speed"), (int, float)) and v["speed"] < STATIONARY_KTS]

    # Flags, most common first.
    #
    # RESOLVED HERE, NOT READ OFF THE VESSEL. The AIS cache stores what the
    # transponder sent, and flag is not part of a position report — the
    # /api/ais/vessels endpoint derives it from the MMSI prefix on the way
    # out. Reading `flag_iso2` off the cached record therefore found nothing
    # and every area reported no flags at all, which looked like "we don't
    # know" rather than "we didn't ask".
    flags: dict[str, dict] = {}
    for v in inside:
        iso = (v.get("flag_iso2") or "").upper()
        name = v.get("flag") or v.get("flag_country")
        emoji = v.get("flag_emoji")
        url = v.get("flag_url")
        if not iso and flag_lookup:
            try:
                got = flag_lookup(str(v.get("mmsi") or "")) or {}
                iso = (got.get("flag_iso2") or "").upper()
                name = name or got.get("flag_country")
                emoji = emoji or got.get("flag_emoji")
                url = url or got.get("flag_url")
            except Exception:
                pass
        # "XX" is the table's own marker for an MMSI prefix it does not
        # recognise. Counting it as a country would invent a fleet.
        if not iso or iso == "XX":
            continue
        row = flags.setdefault(iso, {
            "iso2": iso, "name": name or iso,
            "emoji": emoji or None, "image": url or None, "count": 0,
        })
        row["count"] += 1
    flag_rows = sorted(flags.values(), key=lambda f: -f["count"])

    sanctioned, sanctions_error = [], None
    if sanctions_check:
        for v in inside:
            try:
                hit = sanctions_check(v)
            except Exception as ex:
                sanctions_error = f"{type(ex).__name__}"
                break
            if hit:
                sanctioned.append({
                    "mmsi": v.get("mmsi"),
                    "name": v.get("name") or hit.get("name") or None,
                    "flag": v.get("flag"),
                    "flag_emoji": v.get("flag_emoji"),
                    "lat": v.get("lat"), "lon": v.get("lon"),
                    "speed": v.get("speed"),
                    "programme": hit.get("programme") or hit.get("list") or None,
                })

    record_baseline(area_key, len(inside), now=now)
    mean, samples = baseline_for(area_key)

    congestion = None
    if mean and mean > 0:
        congestion = {
            "ratio": round(len(inside) / mean, 2),
            "baseline_vessels": round(mean, 1),
            "samples": samples,
            "window_hours": BASELINE_WINDOW_S // 3600,
        }

    return {
        "vessels_present": len(inside),
        "under_way": len(moving),
        "holding_station": len(holding),
        # Said out loud rather than folded silently into the total: a hull
        # the receiver knows about but cannot place is not evidence of an
        # empty strait.
        "vessels_without_position": no_fix,
        "flags": flag_rows[:12],
        "sanctioned": sanctioned,
        "sanctioned_count": len(sanctioned),
        "sanctions_checked": sanctions_check is not None and sanctions_error is None,
        "sanctions_error": sanctions_error,
        "congestion": congestion,
        "congestion_note": (
            None if congestion else
            f"No baseline yet — {samples} of {MIN_BASELINE_SAMPLES} samples. "
            "A vessel count means nothing without one, so none is reported."),
        "as_of": datetime.datetime.utcfromtimestamp(now).isoformat() + "Z",
        "method": (
            "Live AIS positions inside the area boundary. Speed under "
            f"{STATIONARY_KTS} kn is counted as holding station. Congestion is "
            "this area's own recent average, never a global one."),
    }
