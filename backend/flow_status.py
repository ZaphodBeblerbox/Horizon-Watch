"""
flow_status.py — is anything actually moving, and is anything in the way.

The Flows layer drew corridors and said nothing about them. A trade route is
not interesting because it exists — everyone knows there is a route through
Hormuz — it is interesting when something is happening on it, and the layer
had no way to show that.

WHAT "DISRUPTED" IS ALLOWED TO MEAN HERE, because this is the kind of word
that quietly turns into a number nobody can reconstruct. A route is reported
against four things that are each independently checkable:

    traffic      vessels on the corridor now, against its own recent baseline
    incidents    alerts inside the corridor in the window
    interference where aircraft over it are losing their satellite fix
    chokepoints  the named passages it runs through

They are reported SEPARATELY and are never added into one score. A corridor
with no ships and no incidents is quiet; one with a third of its usual
traffic and two incidents is a different thing from one with normal traffic
and a jamming cell over it, and a single number would call them the same.
The UI can rank by whichever the reader cares about; this does not decide
for them.

BASELINE IS THE CORRIDOR'S OWN. "Fewer ships than usual" only means anything
against what that corridor usually holds — the Channel and the Bab el-Mandeb
are different worlds. Until a corridor has been watched long enough the
baseline is null and the comparison is withheld rather than guessed.
"""
from __future__ import annotations

import datetime
import math
import time

# How far from the corridor's centre line a vessel or an incident counts as
# being "on" it. Shipping lanes are wide and the route geometry is a coarse
# centre line, so this is generous on purpose; it is stated in the response
# so nobody reads the counts as precise.
CORRIDOR_KM = 75.0

# Rolling window for the traffic baseline, and the samples needed before it
# is trustworthy enough to divide by.
BASELINE_WINDOW_S = 6 * 3600
MIN_BASELINE_SAMPLES = 5

# How far the traffic has to move from baseline before it is worth saying.
# Vessel counts are noisy; ±25% is inside the noise.
QUIET_RATIO = 0.6
BUSY_RATIO = 1.5

_baseline: dict[str, list[tuple[float, int]]] = {}


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _near_route(lat, lon, coords, max_km: float = CORRIDOR_KM) -> bool:
    """Within max_km of any vertex of the corridor.

    Vertex distance rather than true segment distance: route geometry here
    is a handful of points per corridor, the tolerance is already 75 km, and
    a perpendicular-distance solve for every vessel against every segment is
    a lot of arithmetic for an answer that would not change.
    """
    if lat is None or lon is None:
        return False
    for pt in coords or []:
        # Routes are stored [lon, lat].
        if _haversine_km(lat, lon, pt[1], pt[0]) <= max_km:
            return True
    return False


def record_baseline(route_id: str, count: int, now: float | None = None) -> None:
    now = now or time.time()
    samples = _baseline.setdefault(route_id, [])
    samples.append((now, count))
    cutoff = now - BASELINE_WINDOW_S
    _baseline[route_id] = [s for s in samples if s[0] >= cutoff][-400:]


def baseline_for(route_id: str):
    samples = _baseline.get(route_id) or []
    if len(samples) < MIN_BASELINE_SAMPLES:
        return None, len(samples)
    return sum(c for _, c in samples) / len(samples), len(samples)


def assess(route: dict, *, vessels=None, alerts=None, interference=None,
           chokepoint_status=None, now: float | None = None) -> dict:
    """Everything this system can honestly say about one corridor."""
    now = now or time.time()
    rid = route.get("id") or route.get("name") or "route"
    coords = route.get("coordinates") or []

    on_route = [v for v in (vessels or [])
                if _near_route(v.get("lat"), v.get("lon"), coords)]
    moving = [v for v in on_route
              if isinstance(v.get("speed"), (int, float)) and v["speed"] >= 2.0]

    record_baseline(rid, len(on_route), now=now)
    mean, samples = baseline_for(rid)
    traffic = {
        "vessels": len(on_route),
        "under_way": len(moving),
        "baseline": round(mean, 1) if mean else None,
        "samples": samples,
        "ratio": round(len(on_route) / mean, 2) if mean and mean > 0 else None,
        "note": None if mean else (
            f"No baseline yet — {samples} of {MIN_BASELINE_SAMPLES} samples. "
            "A vessel count on its own does not say whether that is normal."),
    }
    if traffic["ratio"] is not None:
        traffic["state"] = ("quiet" if traffic["ratio"] <= QUIET_RATIO
                            else "busy" if traffic["ratio"] >= BUSY_RATIO
                            else "normal")
    else:
        traffic["state"] = "unknown"

    incidents = [a for a in (alerts or [])
                 if _near_route(a.get("lat"), a.get("lon"), coords)]
    by_sev: dict[str, int] = {}
    for a in incidents:
        sev = (a.get("severity") or "moderate").lower()
        by_sev[sev] = by_sev.get(sev, 0) + 1

    jam = [c for c in (interference or [])
           if c.get("level") != "clear" and _near_route(c.get("lat"), c.get("lon"), coords)]

    chokes = []
    for name in route.get("chokepoints") or []:
        st = (chokepoint_status or {}).get(name)
        chokes.append({"id": name, "status": st or "unknown"})

    # Reported, never summed. Each of these is separately checkable and they
    # measure different things; one number over them would hide which.
    flags = []
    if traffic["state"] == "quiet":
        flags.append("traffic below this corridor's normal")
    if by_sev.get("critical") or by_sev.get("high"):
        flags.append(f"{by_sev.get('critical', 0) + by_sev.get('high', 0)} high-severity incidents on it")
    if jam:
        flags.append(f"satellite navigation degraded over {len(jam)} cell(s)")
    if any(c["status"] in ("disrupted", "closed", "elevated") for c in chokes):
        flags.append("a chokepoint on it is not normal")

    return {
        "id": rid,
        "name": route.get("name") or rid,
        "traffic": traffic,
        "incidents": {"count": len(incidents), "by_severity": by_sev},
        "interference_cells": len(jam),
        "chokepoints": chokes,
        # The one derived field, and it is a list of reasons rather than a
        # score, so every item in it can be checked against the numbers above.
        "disrupted": bool(flags),
        "why": flags,
        "corridor_km": CORRIDOR_KM,
        "as_of": datetime.datetime.utcfromtimestamp(now).isoformat() + "Z",
    }
