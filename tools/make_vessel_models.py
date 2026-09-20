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


def hull(m, length, beam, depth, bow_frac=0.22, stern_frac=0.10):
    """A hull: flat bottom, vertical sides, a pointed bow, a square stern."""
    bow_x = length * (1 - bow_frac)
    stern_x = length * stern_frac
    # Waterline stations as (x, half-beam).
    stations = [(0.0, beam * 0.34), (stern_x, beam / 2),
                (bow_x, beam / 2), (length, 0.0)]
    for s in range(len(stations) - 1):
        x0, b0 = stations[s]
        x1, b1 = stations[s + 1]
        # Deck and bottom.
        m.quad((x0, -b0, depth), (x1, -b1, depth), (x1, b1, depth), (x0, b0, depth))
        m.quad((x0, b0, 0.0), (x1, b1, 0.0), (x1, -b1, 0.0), (x0, -b0, 0.0))
        # Sides.
        m.quad((x0, b0, 0.0), (x1, b1, 0.0), (x1, b1, depth), (x0, b0, depth))
        m.quad((x0, -b0, depth), (x1, -b1, depth), (x1, -b1, 0.0), (x0, -b0, 0.0))
    # Transom.
    m.quad((0.0, -stations[0][1], 0.0), (0.0, stations[0][1], 0.0),
           (0.0, stations[0][1], depth), (0.0, -stations[0][1], depth))


def box(m, x0, x1, y0, y1, z0, z1):
    c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    for a, b, cc, d in [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
                        (3, 2, 6, 7), (0, 3, 7, 4), (1, 5, 6, 2)]:
        m.quad(c[a], c[b], c[cc], c[d])


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
