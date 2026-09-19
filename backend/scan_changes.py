"""
scan_changes.py — what is different since the last time we looked.

WHY THIS IS THE POINT. A scan that reports "27 vessels at Kharg Island"
tells an analyst almost nothing: 27 might be Tuesday. The finding is "3
vessels that were not there yesterday", and that is a comparison, not a
detection. Everything upstream of this module produces observations; this is
where observations become findings.

It is also the only honest way to reach two of the targets on the list.
There is no off-the-shelf model that detects "damaged infrastructure" or
"new infrastructure" from one image, because damage and novelty are not
visual properties of an object — they are properties of a difference. A
storage tank is just a storage tank. A storage tank that was there last week
and is not there now is an event.

THE HARD PART IS NOT DIFFING, IT IS NOT LYING. Two scans of the same place
never produce identical coordinates: the satellite passes at a different
angle, the detector lands a box a few pixels over, the tide moves a moored
ship. Naive comparison would therefore report the entire scene as "gone" and
"new" on every single cycle, burying the one real change in noise. Matching
has to tolerate the wobble the sensor genuinely has — and no more, or two
adjacent objects collapse into one and a real departure is hidden.

So the matching radius is derived from the scan's own resolution rather than
picked: an object located on a 10 m/px image cannot be placed more precisely
than a couple of pixels, whatever the stored decimal places suggest.

WHAT THIS MODULE REFUSES TO DO. It will not report change against a baseline
that does not exist. The first scan of an area has nothing to compare to,
and saying "12 new vessels" on a first scan would be a lie of exactly the
kind this codebase keeps finding: rendering "we have never looked here"
identically to "everything here is new".
"""
from __future__ import annotations

import math

# How far apart two observations of the SAME object can be before they stop
# being the same object. Expressed in pixels of the scan's own resolution,
# because that is what actually bounds localisation accuracy.
MATCH_RADIUS_PX = 3.0

# A floor, for very high-resolution scans: sub-metre matching would split a
# single ship into "gone" plus "new" every time it swung on its mooring.
MIN_MATCH_RADIUS_M = 25.0

# A ceiling, so a coarse scan does not merge genuinely distinct objects.
MAX_MATCH_RADIUS_M = 250.0

# CONFIDENCE FLOOR FOR CALLING SOMETHING A CHANGE.
#
# Found by comparing two real Sentinel-2 passes over Khor Fakkan 23 days
# apart. The diff reported 5 new and 5 gone objects, including three storage
# tanks that had supposedly appeared or vanished — in three weeks, in a tank
# farm. They had not. Every one of those "changes" carried a confidence
# between 0.29 and 0.49: the detector was finding a slightly different subset
# of the same scene on each pass, and the diff was faithfully reporting the
# detector's own instability as events on the ground.
#
# A weak detection that is present on one pass and absent on the next is
# evidence about the DETECTOR, not about the world. Objects below this floor
# still appear in the scan — they are real observations — but they cannot
# by themselves raise "new" or "gone", because the most likely explanation
# for their coming and going is that they were never reliably seen.
#
# This is the difference between a feature an analyst can trust and one that
# cries wolf on every cycle until it is turned off.
CHANGE_CONFIDENCE_FLOOR = 0.55

# Structures should not appear or vanish between two satellite passes, so
# claiming they did needs more evidence than a passing vessel does.
STRUCTURAL_TYPES = {"storage_tank", "port_infrastructure", "airfield", "bridge"}
STRUCTURAL_CONFIDENCE_FLOOR = 0.65


def match_radius_m(m_per_px: float) -> float:
    """The distance within which two observations are one object."""
    return max(MIN_MATCH_RADIUS_M,
               min(MAX_MATCH_RADIUS_M, float(m_per_px) * MATCH_RADIUS_PX))


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _pt(d: dict):
    return d.get("centroid_lat"), d.get("centroid_lon")


def confident_enough_for_change(det: dict) -> bool:
    """Is this detection solid enough that its arrival or departure is news?"""
    conf = float(det.get("confidence") or 0.0)
    floor = (STRUCTURAL_CONFIDENCE_FLOOR
             if det.get("object_type") in STRUCTURAL_TYPES
             else CHANGE_CONFIDENCE_FLOOR)
    return conf >= floor


def diff_detections(previous: list[dict], current: list[dict], *,
                    m_per_px: float = 10.0,
                    baseline_exists: bool = True) -> dict:
    """Compare two scans of the same area.

    Returns every detection tagged with `change_type`, plus a summary.

    `baseline_exists=False` means this is the first look at the area. Nothing
    is then "new" — it is simply the first thing we know — and the result
    says so rather than manufacturing a scene full of novelty.
    """
    radius = match_radius_m(m_per_px)

    if not baseline_exists:
        for d in current:
            d["change_type"] = "baseline"
        return {
            "baseline": True,
            "match_radius_m": round(radius, 1),
            "new": [], "gone": [], "persisted": [], "moved": [],
            "unconfirmed": [],
            "all": current,
            "summary": {"new": 0, "gone": 0, "persisted": 0, "moved": 0,
                        "unconfirmed": 0, "baseline_count": len(current)},
            "headline": (f"first scan of this area — {len(current)} object(s) "
                         f"recorded as the baseline, no change to report"),
        }

    prev_left = list(previous)
    new: list[dict] = []
    moved: list[dict] = []
    persisted: list[dict] = []
    unconfirmed: list[dict] = []

    for cur in current:
        clat, clon = _pt(cur)
        if clat is None or clon is None:
            cur["change_type"] = "unlocated"
            new.append(cur)
            continue

        best = None
        best_d = None
        for p in prev_left:
            if p.get("object_type") != cur.get("object_type"):
                continue            # a tank where a ship was is not that ship
            plat, plon = _pt(p)
            if plat is None or plon is None:
                continue
            d = _haversine_m(clat, clon, plat, plon)
            if d <= radius and (best_d is None or d < best_d):
                best, best_d = p, d

        if best is None:
            if confident_enough_for_change(cur):
                cur["change_type"] = "new"
                new.append(cur)
            else:
                # Seen now, not seen before, but too weakly to claim it
                # arrived. Kept and labelled, never silently dropped: it is a
                # real observation, just not a reportable event.
                cur["change_type"] = "unconfirmed"
                cur["unconfirmed_reason"] = (
                    f"confidence {float(cur.get('confidence') or 0):.2f} is below the "
                    f"floor for calling a {cur.get('object_type')} new"
                )
                unconfirmed.append(cur)
        else:
            prev_left.remove(best)
            cur["previous_distance_m"] = round(best_d, 1)
            # Movement worth reporting is movement beyond the noise floor.
            # Half the matching radius keeps "it drifted" out of the feed
            # while still catching a ship that actually relocated.
            if best_d > radius / 2:
                cur["change_type"] = "moved"
                moved.append(cur)
            else:
                cur["change_type"] = "persisted"
                persisted.append(cur)

    gone = []
    for p in prev_left:
        p = dict(p)
        if confident_enough_for_change(p):
            p["change_type"] = "gone"
            gone.append(p)
        else:
            p["change_type"] = "unconfirmed"
            p["unconfirmed_reason"] = (
                f"was only detected at confidence {float(p.get('confidence') or 0):.2f}; "
                f"its absence now is more likely a missed detection than a departure"
            )
            unconfirmed.append(p)

    return {
        "baseline": False,
        "match_radius_m": round(radius, 1),
        "new": new, "gone": gone, "persisted": persisted, "moved": moved,
        "unconfirmed": unconfirmed,
        "all": current + gone,
        "summary": {"new": len(new), "gone": len(gone),
                    "persisted": len(persisted), "moved": len(moved),
                    "unconfirmed": len(unconfirmed)},
        "headline": headline(new, gone, moved, persisted, unconfirmed),
    }


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


# How an object_type reads in a sentence a person will actually see.
_READABLE = {
    "vessel": "vessel",
    "vehicle": "vehicle",
    "aircraft": "aircraft",
    "storage_tank": "storage tank",
    "port_infrastructure": "port structure",
    "airfield": "airfield structure",
    "bridge": "bridge",
    "road_feature": "road feature",
    "recreation": "structure",
}


def _by_type(dets: list[dict]) -> str:
    counts: dict[str, int] = {}
    for d in dets:
        t = _READABLE.get(d.get("object_type"), d.get("object_type") or "object")
        counts[t] = counts.get(t, 0) + 1
    parts = [_plural(n, t) for t, n in sorted(counts.items(), key=lambda kv: -kv[1])]
    if len(parts) > 2:
        parts = parts[:2] + [f"and {len(counts) - 2} other kind(s)"]
    return ", ".join(parts)


def headline(new, gone, moved, persisted, unconfirmed=()) -> str:
    """One sentence an analyst can read without opening anything.

    A notification that says only a count, or only an MMSI, makes the reader
    do the work of finding out whether it matters. It has to name WHAT
    changed, not merely that something did.
    """
    if not new and not gone and not moved:
        line = f"no change — {_plural(len(persisted), 'object')} still present"
        if unconfirmed:
            # Say it, rather than reporting a clean "no change" while
            # quietly holding back observations that did not meet the bar.
            line += (f" ({_plural(len(unconfirmed), 'weak detection')} "
                     f"too uncertain to call a change)")
        return line
    bits = []
    if new:
        bits.append(f"{_by_type(new)} appeared")
    if gone:
        bits.append(f"{_by_type(gone)} no longer present")
    if moved:
        bits.append(f"{_by_type(moved)} moved")
    line = "; ".join(bits)
    if unconfirmed:
        line += f" ({_plural(len(unconfirmed), 'weak detection')} not counted)"
    return line


def severity_for(change: dict, *, zone_name: str | None = None) -> str:
    """How loudly a change should be announced.

    Deliberately conservative. Vessels arrive and leave constantly and are
    not news on their own; a fixed structure appearing or disappearing is,
    because infrastructure does not normally come and go between two passes
    of a satellite — that is construction, demolition, or damage.
    """
    STRUCTURAL = {"storage_tank", "port_infrastructure", "airfield", "bridge"}
    gone_structural = [d for d in change["gone"] if d.get("object_type") in STRUCTURAL]
    new_structural = [d for d in change["new"] if d.get("object_type") in STRUCTURAL]

    if gone_structural:
        return "high"        # a structure that was there and is not
    if new_structural:
        return "medium"      # new construction
    if len(change["new"]) >= 10:
        return "medium"      # a concentration, whatever it is made of
    if change["new"] or change["gone"]:
        return "low"
    return "info"
