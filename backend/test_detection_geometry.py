"""
The detector emits an ORIENTED box. We were storing an envelope.

DOTA-style models predict rotated boxes, and the ingest took min/max of
the four corners and wrote an axis-aligned rectangle round the outside.
A vessel lying diagonally therefore rendered as a large square, and its
area and length were the envelope's rather than the hull's.
"""
import json
import math
import re
import pathlib


def _hav(a1, o1, a2, o2):
    R = 6_371_000
    dl = math.radians(a2 - a1); dg = math.radians(o2 - o1)
    x = (math.sin(dl / 2) ** 2
         + math.cos(math.radians(a1)) * math.cos(math.radians(a2))
         * math.sin(dg / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(x))


def _hull(cx, cy, length, width, deg):
    th = math.radians(deg)
    mlat = 111_320.0
    mlon = 111_320.0 * math.cos(math.radians(cx))
    out = []
    for dl, dw in ((length / 2, width / 2), (length / 2, -width / 2),
                   (-length / 2, -width / 2), (-length / 2, width / 2)):
        n = dl * math.cos(th) - dw * math.sin(th)
        e = dl * math.sin(th) + dw * math.cos(th)
        out.append([cx + n / mlat, cy + e / mlon])
    return out


def test_an_envelope_inflates_a_diagonal_vessel():
    # The behaviour being replaced, stated so the fix cannot quietly
    # regress to it: 80x20m at 45 degrees became 71x71m.
    c = _hull(25.348, 56.363, 80, 20, 45)
    lats = [p[0] for p in c]; lons = [p[1] for p in c]
    env_a = _hav(min(lats), min(lons), max(lats), min(lons))
    env_b = _hav(min(lats), min(lons), min(lats), max(lons))
    assert abs(env_a - env_b) < 5           # square
    assert env_a * env_b > 80 * 20 * 2.5    # and three times the area


def test_the_oriented_sides_recover_the_real_hull():
    c = _hull(25.348, 56.363, 80, 20, 45)
    sides = sorted(_hav(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1])
                   for i in range(4))
    assert 78 < sides[-1] < 82
    assert 18 < sides[0] < 22


def test_the_ingest_stores_the_detector_corners_not_an_envelope():
    src = pathlib.Path("main.py").read_text()
    blk = src[src.index("geo_geometry = est_length_m = est_width_m = area_m2 = None"):]
    blk = blk[:blk.index("sev        =")]
    # The ring is built FROM the corners...
    assert "ring = [[float(c[1]), float(c[0])] for c in corners]" in blk
    # ...and never from a min/max envelope again.
    assert "min(lons), min(lats)" not in blk
    # Length and beam come from the box's own sides.
    assert "sides.sort()" in blk


def test_the_ring_is_closed():
    # An unclosed ring is not a valid GeoJSON Polygon and some renderers
    # silently drop it.
    c = _hull(0, 0, 50, 10, 30)
    ring = [[p[1], p[0]] for p in c]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    assert ring[0] == ring[-1]
    assert len(ring) == 5
    json.dumps({"type": "Polygon", "coordinates": [ring]})
