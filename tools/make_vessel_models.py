#!/usr/bin/env python3
"""
make_vessel_models.py - the ship models the globe draws.

Same reasoning as make_aircraft_models.py, and the same axis handling:
built nose-first in a natural frame and rewritten into glTF's frame on
the way out, because Cesium remaps the axes on load.

WHAT THESE DO AND DO NOT CLAIM. AIS as we receive it carries no length
or beam - 0 of 1,728 vessels in a live sample had either - so the size
of a hull on the map is a nominal figure for its TYPE, not a
measurement of that ship. Types are thin too: 34% report "other" and
another 34% report nothing at all, so most vessels get the generic
hull. That is the honest default; a generic hull pointed the right way
says "a ship, heading that way", which is all AIS actually told us.

Bow +X, starboard +Y, up +Z, before conversion - the opposite
along-body sense from the aircraft, which is why to_glb takes it as a
parameter rather than assuming.
"""
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_aircraft_models import Mesh, to_glb  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "models" / "vessel"


def hull(m, length, beam, depth, bow_frac=0.22, stern_frac=0.10, seg=7):
    """A hull with a raked stem, a chamfered bilge and deck sheer.

    The first version was a flat-bottomed box with a point on the front,
    and at any zoom where a ship is more than a few pixels that is what
    it looked like. Three things carry almost all of the improvement:

      - a CHAMFERED BILGE, so the turn from bottom to side is two facets
        instead of a right angle. Real hulls are round there and the
        square edge is the single most model-like thing about a box.
      - a RAKED STEM: the bow overhangs forward at deck level and tucks
        under at the waterline, which is what makes a ship read as
        moving rather than as a brick.
      - DECK SHEER, the slight rise of the deck towards the bow. A few
        centimetres of it is the difference between a ship and a barge.

    Every face is wound by quad_outward against the hull centroid rather
    than by hand. Writing the orders out by hand is how box() ended up
    lit on the inside, and the first draft of this function repeated it
    exactly - the hull came out uniformly dark because half its faces
    pointed inwards.
    """
    centre = (length / 2, 0.0, depth / 2)
    bow_x = length * (1 - bow_frac)
    stern_x = length * stern_frac

    # Stations: x, half-beam at deck, half-beam at the bilge, deck height.
    def station(t):
        x = t * length
        if x < stern_x:                      # transom shoulder
            f = 0.72 + 0.28 * (x / max(stern_x, 1e-6))
        elif x > bow_x:                      # fining towards the stem
            u = (x - bow_x) / max(length - bow_x, 1e-6)
            f = (1 - u) ** 0.65
        else:
            f = 1.0
        half = beam / 2 * f
        sheer = depth * 0.10 * max(0.0, (x / length - 0.55)) / 0.45
        return x, half, half * 0.78, depth + sheer

    ts = [k / (seg * 3) for k in range(seg * 3 + 1)]
    prev = None
    for t in ts:
        cur = station(t)
        if prev is None:
            prev = cur
            continue
        (x0, h0, b0, d0), (x1, h1, b1, d1) = prev, cur
        # The stem rakes forward: at the bow the deck edge runs ahead of
        # the waterline, so the keel line is pulled aft of the deck line.
        k0 = x0 - (length * 0.05 if x0 > bow_x else 0.0)
        k1 = x1 - (length * 0.05 if x1 > bow_x else 0.0)
        for sgn in (1, -1):
            # deck edge -> bilge -> keel, two facets per side
            m.quad_outward(centre, (x0, sgn * h0, d0), (x1, sgn * h1, d1),
                           (x1, sgn * b1, depth * 0.30), (x0, sgn * b0, depth * 0.30))
            m.quad_outward(centre, (x0, sgn * b0, depth * 0.30), (x1, sgn * b1, depth * 0.30),
                           (k1, sgn * b1 * 0.45, 0.0), (k0, sgn * b0 * 0.45, 0.0))
        # deck and bottom
        m.quad_outward(centre, (x0, -h0, d0), (x1, -h1, d1), (x1, h1, d1), (x0, h0, d0))
        m.quad_outward(centre, (k0, b0 * 0.45, 0.0), (k1, b1 * 0.45, 0.0),
                       (k1, -b1 * 0.45, 0.0), (k0, -b0 * 0.45, 0.0))
        prev = cur

    # Transom.
    _, h, bg, d = station(0.0)
    m.quad_outward(centre, (0.0, -h, d), (0.0, h, d),
                   (0.0, bg * 0.45, 0.0), (0.0, -bg * 0.45, 0.0))


def box(m, x0, x1, y0, y1, z0, z1):
    """A box whose faces all point outward.

    The winding used to be a hand-written list of index tuples, and four
    of the six were wrong: top and bottom swapped, two sides inverted.
    Nothing shows that in a silhouette, and with a double-sided material
    nothing goes missing either - the visible symptom is a superstructure
    lit on the inside and dark on the outside. quad_outward derives the
    winding from where the face sits relative to the box centre.
    """
    c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    centre = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    for a, b, cc, d in [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
                        (3, 2, 6, 7), (0, 3, 7, 4), (1, 2, 6, 5)]:
        m.quad_outward(centre, c[a], c[b], c[cc], c[d])


def ship(length, beam, bridge_at, bridge_h, deck_boxes=0, funnel=True):
    """A hull with its superstructure where that type carries it."""
    m = Mesh()
    depth = beam * 0.42
    hull(m, length, beam, depth)
    bx = length * bridge_at
    box(m, bx, bx + length * 0.09, -beam * 0.36, beam * 0.36,
        depth, depth + bridge_h)
    if funnel:
        fx = bx + length * 0.02
        box(m, fx, fx + length * 0.025, -beam * 0.10, beam * 0.10,
            depth + bridge_h, depth + bridge_h * 1.45)
    # Containers or deck cargo, forward of the bridge.
    for i in range(deck_boxes):
        t = 0.18 + i * (0.62 / max(1, deck_boxes))
        box(m, length * t, length * (t + 0.55 / max(1, deck_boxes) * 0.8),
            -beam * 0.40, beam * 0.40, depth, depth + beam * 0.30)
    return m


def cruise(length, beam):
    """Passenger hulls are mostly superstructure, several decks of it."""
    m = Mesh()
    depth = beam * 0.40
    hull(m, length, beam, depth)
    for k in range(4):
        inset = 0.03 + k * 0.02
        box(m, length * (0.10 + inset), length * (0.88 - inset),
            -beam * (0.42 - k * 0.05), beam * (0.42 - k * 0.05),
            depth + k * beam * 0.22, depth + (k + 1) * beam * 0.22)
    return m


def warship(length, beam):
    m = Mesh()
    depth = beam * 0.45
    hull(m, length, beam, depth, bow_frac=0.30)
    box(m, length * 0.34, length * 0.52, -beam * 0.28, beam * 0.28,
        depth, depth + beam * 0.55)          # bridge
    box(m, length * 0.40, length * 0.46, -beam * 0.10, beam * 0.10,
        depth + beam * 0.55, depth + beam * 1.30)   # mast
    return m


GREY = [0.74, 0.77, 0.80, 1.0]
DARK = [0.40, 0.44, 0.48, 1.0]
WHITE = [0.88, 0.90, 0.92, 1.0]

# Length and beam in metres: nominal for the TYPE, not a measurement.
FAMILIES = {
    "container": (ship(300, 45, 0.12, 22, deck_boxes=4), GREY),
    "cargo":     (ship(190, 30, 0.14, 16, deck_boxes=2), GREY),
    "tanker":    (ship(250, 44, 0.12, 18, funnel=True),  DARK),
    "passenger": (cruise(290, 36),                        WHITE),
    "military":  (warship(150, 20),                       DARK),
    "fishing":   (ship(40, 9, 0.30, 5, funnel=False),     GREY),
    "other":     (ship(110, 18, 0.16, 10),                GREY),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (mesh, colour) in FAMILIES.items():
        # forward=+1: hull() puts the pointed bow at x=length, where
        # fuselage() puts the nose at x=0 and runs aft.
        size, tris = to_glb(mesh, OUT / f"{name}.glb", colour, forward=1)
        total += size
        print(f"  {name:11s} {tris:5d} triangles  {size/1024:6.1f} KB")
    print(f"  {'total':11s} {'':5s}             {total/1024:6.1f} KB")
