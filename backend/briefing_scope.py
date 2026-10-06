"""
briefing_scope.py — the place a briefing is about, as a box on the map.

Generate's "About" field is free text ("Yemen and the Red Sea", "Sudan",
"our tankers in the Gulf of Aden"). It was stored as the report's title and
nothing else, so a Yemen briefing was assembled from sanctioned ships in
the North Sea. Here each part of it becomes a box — a named region
(scoring.REGION_BBOXES), a chokepoint (its radius), or the geocoder's
extent for a country, sea or city — and the briefing's evidence is limited
to their union, as a watch area's box already limits it.
Returns (south, north, west, east) or None when nothing resolves.
"""
from __future__ import annotations

import math
import re

STOP = {"the", "our", "and", "in", "of", "around", "near", "situation", "briefing", "report", "on", "about"}


def parts(text: str) -> list[str]:
    bits = re.split(r"\s*(?:,|/|;|&|\band\b|\bplus\b)\s*", text or "", flags=re.I)
    out = []
    for b in bits:
        words = [w for w in re.findall(r"[\w'’-]+", b) if w.lower() not in STOP]
        if words:
            out.append(" ".join(words))
    return out


def _named(p: str):
    from scoring import REGION_BBOXES, CHOKEPOINT_LOCS
    for name, box in REGION_BBOXES.items():
        if box and name.lower() == p.lower():
            return box
    for name, (lat, lon, r) in CHOKEPOINT_LOCS.items():
        if name.lower() == p.lower():
            d = r / 111.0
            return (lat - d, lat + d, lon - d / max(0.2, math.cos(math.radians(lat))), lon + d / max(0.2, math.cos(math.radians(lat))))
    return None


def box_for(text: str, geocode=None) -> tuple | None:
    if not text:
        return None
    if geocode is None:
        from geocode_utils import geocode_place as geocode
    boxes = []
    for p in parts(text):
        b = _named(p)
        if b is None:
            hits = geocode(p) or []
            bb = hits[0].get("boundingbox") if hits else None
            if bb and len(bb) == 4:
                s, n, w, e = map(float, bb)
                b = (s, n, w, e)
        if b:
            boxes.append(b)
    if not boxes:
        return None
    return (min(b[0] for b in boxes), max(b[1] for b in boxes), min(b[2] for b in boxes), max(b[3] for b in boxes))
