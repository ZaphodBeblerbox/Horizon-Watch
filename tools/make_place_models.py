#!/usr/bin/env python3
"""
make_place_models.py - the 3D models the globe draws for endangered places.

One small model per KIND of place (backend/endangered_places.py KIND_LABEL):
a refinery, a fuel depot, a fuel station, a rally point, a roundabout and an
arms-industry works. Drawn by GlobeEndangeredPlacesLayer.jsx when the camera
is close; the flat triangle/disc markers stay for the far view.

WHAT A MODEL CLAIMS. Only the kind. The real Feyzin refinery is two
kilometres across and a station is a forecourt; each model is a nominal,
recognisable stand-in at a nominal size for its kind, not a survey of the
site. Where the place sits is the source's point, and which way the model
faces is decided by the place's id, not by the site's layout.

THE STATUS IS THE BASE. Every model stands on a plinth whose sides and top
border carry the call status in the layer's colours (endangeredPlaces.js
ALARM_COLOR): red for a roadblock, slow-drive or picket called within 48 h,
amber for any other call to come, grey for listed without a call. That is
three files per kind - {kind}.glb (grey), {kind}_amber.glb, {kind}_red.glb -
because a Cesium model colour tints the whole mesh, and a refinery dyed
amber stops reading as steel.

Same conventions as the shipped vessel and aircraft models
(tools/export_globe_models.mjs output): ONE mesh, ONE material, colours
baked per vertex (COLOR_0, linear), metallic 0.25 / roughness 0.55,
double-sided, indexed. Built in the natural frame (+X along, +Y right,
+Z up, metres) and rewritten into glTF's frame with the same conversion
as make_aircraft_models.to_gltf_axes(forward=1), so Cesium draws them
standing up. Origin at the centre of the plinth at ground level.

    python3 tools/make_place_models.py
then bump MODEL_VERSION in src/globe/placeModels.js.
"""
import json
import math
import pathlib
import struct
import sys

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "models" / "place"


def srgb(hexstr):
    """'#RRGGBB' -> linear RGB, which is what glTF vertex colours are."""
    h = hexstr.lstrip("#")
    out = []
    for k in (0, 2, 4):
        c = int(h[k:k + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# Status colours: the same three as the 2D markers (endangeredPlaces.js).
STATUS = {"grey": srgb("#8A94A3"), "amber": srgb("#F5A524"), "red": srgb("#E5484D")}

# A muted palette, the asset models' (src/assets/three/kit.js PAL).
C = {
    "concrete": srgb("#A9A59C"), "ground": srgb("#8C8A82"), "asphalt": srgb("#3A3E44"),
    "steel": srgb("#8A9096"), "darksteel": srgb("#5B636B"), "white": srgb("#E4E6E8"),
    "offwhite": srgb("#CFD2D5"), "glass": srgb("#2A3A4C"), "rust": srgb("#8A5A3B"),
    "yellow": srgb("#D9B03A"), "grass": srgb("#6D8A5A"), "flame": srgb("#FFA030"),
    "flamecore": srgb("#FFE28A"), "brick": srgb("#7A5446"), "roof": srgb("#7D858D"),
    "skin": srgb("#C9A27E"), "cloth1": srgb("#3F5A7A"), "cloth2": srgb("#6B4A5E"),
    "cloth3": srgb("#4E6B52"), "cloth4": srgb("#8A7A5A"), "flag": srgb("#E9E2CF"),
    "car1": srgb("#2F6FB3"), "car2": srgb("#B5412F"), "car3": srgb("#D9D9D9"), "car4": srgb("#3B4148"),
    "chimred": srgb("#B3302A"), "marking": srgb("#E8E8E2"),
}


class Mesh:
    """Triangles with a normal and a colour per vertex, indexed."""

    def __init__(self):
        self.v, self.n, self.c, self.i = [], [], [], []

    def tri(self, a, b, c, col, nrm=None):
        if nrm is None:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            L = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            nrm = ((nx / L, ny / L, nz / L),) * 3
        base = len(self.v)
        for p, nn in zip((a, b, c), nrm):
            self.v.append(tuple(p)); self.n.append(tuple(nn)); self.c.append(col)
        self.i += [base, base + 1, base + 2]

    def quad(self, a, b, c, d, col, nrm=None):
        if nrm is None:
            self.tri(a, b, c, col); self.tri(a, c, d, col)
        else:
            self.tri(a, b, c, col, (nrm[0], nrm[1], nrm[2]))
            self.tri(a, c, d, col, (nrm[0], nrm[2], nrm[3]))

    def quad_outward(self, centre, a, b, c, d, col):
        """A quad wound so its normal points away from `centre` (see
        make_aircraft_models.Mesh.quad_outward for why it is derived)."""
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        mx = (a[0] + b[0] + c[0] + d[0]) / 4 - centre[0]
        my = (a[1] + b[1] + c[1] + d[1]) / 4 - centre[1]
        mz = (a[2] + b[2] + c[2] + d[2]) / 4 - centre[2]
        if nx * mx + ny * my + nz * mz < 0:
            self.quad(d, c, b, a, col)
        else:
            self.quad(a, b, c, d, col)

    # ── parts ──────────────────────────────────────────────────────────

    def box(self, x0, x1, y0, y1, z0, z1, col, top=None):
        p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        ctr = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        for k, (a, b, c, d) in enumerate([(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
                                           (3, 2, 6, 7), (0, 3, 7, 4), (1, 2, 6, 5)]):
            self.quad_outward(ctr, p[a], p[b], p[c], p[d], top if (k == 1 and top) else col)

    def cbox(self, x, y, w, d, z0, z1, col, top=None, rot=0.0):
        """A box centred on (x, y), w along X and d along Y, turned by rot."""
        if not rot:
            self.box(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z0, z1, col, top)
            return
        cs, sn = math.cos(rot), math.sin(rot)
        poly = [(x + dx * cs - dy * sn, y + dx * sn + dy * cs)
                for dx, dy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
        self.prism(poly, z0, z1, col, top)

    def prism(self, poly, z0, z1, col, top=None):
        """A convex polygon (x, y) extruded from z0 to z1."""
        n = len(poly)
        cx = sum(p[0] for p in poly) / n
        cy = sum(p[1] for p in poly) / n
        ctr = (cx, cy, (z0 + z1) / 2)
        for k in range(n):
            a, b = poly[k], poly[(k + 1) % n]
            self.quad_outward(ctr, (a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1), col)
        up, dn = (0, 0, 1), (0, 0, -1)
        for k in range(n):
            a, b = poly[k], poly[(k + 1) % n]
            self._fan((cx, cy, z1), (a[0], a[1], z1), (b[0], b[1], z1), up, top or col)
            self._fan((cx, cy, z0), (b[0], b[1], z0), (a[0], a[1], z0), dn, col)

    def _fan(self, c, a, b, want, col):
        """A triangle facing `want` whatever order a and b come in."""
        ux, uy = a[0] - c[0], a[1] - c[1]
        vx, vy = b[0] - c[0], b[1] - c[1]
        if (ux * vy - uy * vx) * want[2] < 0:
            a, b = b, a
        self.tri(c, a, b, col, (want,) * 3)

    def cyl(self, x, y, z0, z1, r0, r1=None, col=None, seg=16, cap=None):
        """A (tapered) cylinder on the vertical axis, smooth-shaded sides."""
        r1 = r0 if r1 is None else r1
        h = z1 - z0
        slope = (r0 - r1) / h if h else 0
        for j in range(seg):
            a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
            c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
            L = math.sqrt(1 + slope * slope)
            n0, n1 = (c0 / L, s0 / L, slope / L), (c1 / L, s1 / L, slope / L)
            self.quad((x + r0 * c0, y + r0 * s0, z0), (x + r0 * c1, y + r0 * s1, z0),
                      (x + r1 * c1, y + r1 * s1, z1), (x + r1 * c0, y + r1 * s0, z1),
                      col, (n0, n1, n1, n0))
            if r1 > 0:
                self.tri((x, y, z1), (x + r1 * c0, y + r1 * s0, z1), (x + r1 * c1, y + r1 * s1, z1),
                         cap or col, ((0, 0, 1),) * 3)
            self.tri((x, y, z0), (x + r0 * c1, y + r0 * s1, z0), (x + r0 * c0, y + r0 * s0, z0),
                     col, ((0, 0, -1),) * 3)

    def ring(self, x, y, z, r_in, r_out, col, seg=32):
        """A flat annulus facing up."""
        for j in range(seg):
            a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
            self.quad((x + r_in * math.cos(a0), y + r_in * math.sin(a0), z),
                      (x + r_out * math.cos(a0), y + r_out * math.sin(a0), z),
                      (x + r_out * math.cos(a1), y + r_out * math.sin(a1), z),
                      (x + r_in * math.cos(a1), y + r_in * math.sin(a1), z),
                      col, ((0, 0, 1),) * 4)

    def rod(self, a, b, r, col, seg=6):
        """A pipe between two points."""
        ax, ay, az = a
        dx, dy, dz = b[0] - ax, b[1] - ay, b[2] - az
        L = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        w = (dx / L, dy / L, dz / L)
        t = (0, 0, 1) if abs(w[2]) < 0.9 else (1, 0, 0)
        u = (w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0])
        ul = math.sqrt(sum(k * k for k in u)); u = tuple(k / ul for k in u)
        v = (w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0])
        for j in range(seg):
            a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
            n0 = tuple(u[k] * math.cos(a0) + v[k] * math.sin(a0) for k in range(3))
            n1 = tuple(u[k] * math.cos(a1) + v[k] * math.sin(a1) for k in range(3))
            p0 = tuple(a[k] + r * n0[k] for k in range(3)); p1 = tuple(a[k] + r * n1[k] for k in range(3))
            q0 = tuple(b[k] + r * n0[k] for k in range(3)); q1 = tuple(b[k] + r * n1[k] for k in range(3))
            self.quad(p0, p1, q1, q0, col, (n0, n1, n1, n0))


# ── the plinth that carries the status ─────────────────────────────────

def plinth(m, w, d, status, ground, round_=False, h=None, border=None):
    """The status base: a slab whose sides and top border are the status
    colour, with the site's ground inset on top. Rectangular, or an
    octagon-ish disc (round_) for the roundabout and the rally point."""
    sc = STATUS[status]
    h = h if h is not None else min(2.2, 0.05 * min(w, d))
    b = border if border is not None else max(2.0, 0.07 * min(w, d))
    if round_:
        r = w / 2
        poly = [(r * math.cos(2 * math.pi * k / 24), r * math.sin(2 * math.pi * k / 24)) for k in range(24)]
        inner = [((r - b) * math.cos(2 * math.pi * k / 24), (r - b) * math.sin(2 * math.pi * k / 24)) for k in range(24)]
    else:
        poly = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
        inner = [(-w / 2 + b, -d / 2 + b), (w / 2 - b, -d / 2 + b), (w / 2 - b, d / 2 - b), (-w / 2 + b, d / 2 - b)]
    m.prism(poly, 0.0, h, sc)
    m.prism(inner, h, h + 0.15, ground)
    return h + 0.15        # the ground level everything else stands on


# ── the kinds ──────────────────────────────────────────────────────────

def refinery(status):
    """Distillation columns with their platforms, a flare stack burning,
    a pipe rack, a furnace and two storage tanks."""
    m = Mesh()
    g = plinth(m, 120, 84, status, C["ground"])
    for x, y, h, r in [(-34, -16, 54, 3.4), (-23, -20, 42, 2.6), (-14, -14, 32, 2.2), (-38, -2, 36, 2.4)]:
        m.cyl(x, y, g, g + h, r, col=C["steel"], seg=14, cap=C["darksteel"])
        for z in range(10, int(h), 10):
            m.cyl(x, y, g + z, g + z + 0.6, r + 1.3, col=C["yellow"], seg=14)
    # the pipe rack: legs and five coloured pipes
    for k in range(9):
        x = -42 + k * 8.5
        for s in (1, -1):
            m.cbox(x, 4 + s * 3, 0.6, 0.6, g, g + 9, C["darksteel"])
    for k, col in enumerate([C["offwhite"], C["steel"], C["rust"], C["yellow"], C["steel"]]):
        y = 1.6 + k * 1.2
        m.rod((-42, y, g + 9.6), (28, y, g + 9.6), 0.45, col)
    # floating-roof tanks in a bund
    for x, y in [(30, -22), (48, -22)]:
        m.cyl(x, y, g, g + 13, 8.5, col=C["white"], seg=20, cap=C["roof"])
    m.cbox(39, -8, 40, 0.8, g, g + 1.8, C["concrete"])
    m.cbox(19, -22, 0.8, 30, g, g + 1.8, C["concrete"])
    # the furnace and its stack
    m.cbox(-4, 24, 16, 10, g, g + 12, C["brick"], top=C["darksteel"])
    m.cyl(-4, 31, g, g + 26, 1.4, 1.1, col=C["concrete"], seg=10)
    # the flare stack on a tapered lattice, burning
    m.cyl(50, 30, g, g + 58, 2.6, 0.9, col=C["darksteel"], seg=8)
    m.cyl(50, 30, g + 58, g + 66, 2.2, 0.0, col=C["flame"], seg=10)
    m.cyl(50, 30, g + 58, g + 63, 1.2, 0.0, col=C["flamecore"], seg=8)
    return m


def tank(m, x, y, g, r, h, roof_cone=False):
    m.cyl(x, y, g, g + h, r, col=C["white"], seg=24, cap=C["roof"])
    if roof_cone:
        m.cyl(x, y, g + h, g + h + r * 0.22, r, 0.0, col=C["roof"], seg=24)
    m.cyl(x, y, g + h * 0.82, g + h * 0.86, r + 0.05, col=C["steel"], seg=24)   # wind girder
    # the stair winding up the shell, as a dark stripe
    m.rod((x + r + 0.4, y, g), (x + 0.2, y + r + 0.4, g + h), 0.35, C["darksteel"])


def fuel_depot(status):
    """A cluster of round storage tanks, each in its low bund, a pump house
    and the truck loading gantry."""
    m = Mesh()
    g = plinth(m, 130, 100, status, C["ground"])
    for x, y, r, h, cone in [(-38, -22, 14, 17, False), (-4, -22, 14, 17, False), (30, -22, 14, 17, False),
                             (-38, 18, 10, 14, True), (-12, 18, 10, 14, True), (14, 18, 10, 14, True)]:
        bw = r * 2 + 7
        for dx, dy, w, d in [(0, -bw / 2, bw, 1.0), (0, bw / 2, bw, 1.0), (-bw / 2, 0, 1.0, bw), (bw / 2, 0, 1.0, bw)]:
            m.cbox(x + dx, y + dy, w, d, g, g + 2.0, C["concrete"])
        tank(m, x, y, g, r, h, cone)
    # pipe rack between the rows
    for k, col in enumerate([C["yellow"], C["steel"], C["rust"]]):
        m.rod((-54, -1.5 + k * 1.3, g + 5), (48, -1.5 + k * 1.3, g + 5), 0.5, col)
    for x in range(-54, 49, 12):
        m.cbox(x, -0.2, 0.5, 4.2, g, g + 5, C["darksteel"])
    # pump house and the loading gantry with a tanker truck under it
    m.cbox(48, 22, 14, 10, g, g + 6, C["offwhite"], top=C["roof"])
    m.cbox(48, -26, 22, 12, g + 7, g + 7.6, C["steel"])
    for dx, dy in [(-10, -5), (10, -5), (-10, 5), (10, 5)]:
        m.cbox(48 + dx, -26 + dy, 0.6, 0.6, g, g + 7, C["darksteel"])
    m.cbox(44, -26, 3, 2.6, g + 0.8, g + 3.6, C["white"])            # cab
    m.rod((46, -26, g + 2.2), (56, -26, g + 2.2), 1.3, C["white"], seg=10)   # the tank
    return m


def fuel_station(status):
    """A canopy on pillars over three pump islands, the shop kiosk, and the
    price totem at the road."""
    m = Mesh()
    g = plinth(m, 44, 34, status, C["asphalt"], border=2.0)
    # canopy: a slab with a lighter fascia band, on four pillars
    m.cbox(-4, -2, 26, 14, g + 5.4, g + 6.4, C["white"], top=C["roof"])
    m.cbox(-4, -2, 26.4, 14.4, g + 5.6, g + 6.2, C["offwhite"])
    for px in (-14, 6):
        for py in (-6, 2):
            m.cbox(px, py, 0.7, 0.7, g, g + 5.4, C["steel"])
    # pump islands with pumps
    for dx in (-12, -4, 4):
        m.cbox(dx, -2, 5.5, 1.6, g, g + 0.3, C["concrete"])
        for sx in (-1.5, 1.5):
            m.cbox(dx + sx, -2, 0.9, 0.6, g + 0.3, g + 2.0, C["white"], top=C["darksteel"])
    # the kiosk: a box with a glass front
    m.cbox(-4, 11.5, 18, 6.5, g, g + 4.0, C["offwhite"], top=C["roof"])
    m.cbox(-4, 8.15, 14, 0.2, g + 0.3, g + 3.2, C["glass"])
    # the price totem
    m.cbox(16, -12, 1.4, 0.6, g, g + 8.5, C["darksteel"])
    m.cbox(16, -12, 1.8, 0.8, g + 5.0, g + 8.2, C["white"])
    # a car at the pumps
    car(m, -8, 0.4, g, C["car1"])
    return m


def car(m, x, y, g, col, rot=0.0):
    m.cbox(x, y, 4.4, 1.8, g + 0.3, g + 1.1, col, rot=rot)
    cs, sn = math.cos(rot), math.sin(rot)
    m.cbox(x - 0.3 * cs, y - 0.3 * sn, 2.4, 1.6, g + 1.1, g + 1.6, C["glass"], top=col, rot=rot)


def person(m, x, y, g, col, h=1.75):
    m.cbox(x, y, 0.5, 0.35, g, g + h * 0.82, col)
    m.cbox(x, y, 0.28, 0.28, g + h * 0.84, g + h, C["skin"])


def rally(status):
    """A rally point: a raised platform with a flag on a tall pole and a
    crowd gathered in front of it."""
    m = Mesh()
    g = plinth(m, 30, 30, status, C["concrete"], round_=True, border=2.2)
    # the platform with its steps
    m.cbox(0, 6, 9, 5, g, g + 1.4, C["darksteel"], top=C["steel"])
    m.cbox(0, 3.0, 3, 1.2, g, g + 0.7, C["darksteel"])
    person(m, 0, 6.4, g + 1.4, C["cloth1"], 2.0)
    # the flag: a tall pole, the cloth in the status colour
    m.cyl(-3.5, 7.5, g + 1.4, g + 15, 0.18, col=C["steel"], seg=6)
    m.cbox(-3.5 + 2.6, 7.5, 5.2, 0.15, g + 11.4, g + 14.6, STATUS[status] if status != "grey" else C["flag"])
    # the crowd: rows on an arc facing the platform
    cols = [C["cloth1"], C["cloth2"], C["cloth3"], C["cloth4"]]
    k = 0
    for row, (rad, n) in enumerate([(5.0, 7), (7.4, 9), (9.8, 11)]):
        for j in range(n):
            a = math.radians(205 + (130 * (j + 0.5 * (row % 2))) / n)
            person(m, rad * math.cos(a), 6 + rad * math.sin(a) - 1.0, g, cols[k % 4], 1.6 + 0.15 * ((k * 7) % 3))
            k += 1
    # placards held up over the crowd
    for j, a in enumerate((220, 260, 300)):
        r = 8.6
        px, py = r * math.cos(math.radians(a)), 6 + r * math.sin(math.radians(a)) - 1.0
        m.cbox(px, py, 0.08, 0.08, g + 1.6, g + 2.9, C["steel"])
        m.cbox(px, py, 1.6, 0.1, g + 2.6, g + 3.6, C["flag"])
    return m


def roundabout(status):
    """A ring road round a grassed island, four arms, and cars going round."""
    m = Mesh()
    g = plinth(m, 64, 64, status, C["grass"], round_=True, border=2.4)
    # the arms, under the ring
    for rot in (0, math.pi / 2):
        m.cbox(0, 0, 58, 8.5, g, g + 0.12, C["asphalt"], rot=rot)
    m.ring(0, 0, g + 0.2, 10.5, 18.5, C["asphalt"], seg=40)
    m.ring(0, 0, g + 0.22, 14.3, 14.7, C["marking"], seg=40)
    # the island: a kerbed raised disc, grass, and a sculpture in the middle
    m.cyl(0, 0, g, g + 0.7, 10.5, col=C["concrete"], seg=32, cap=C["grass"])
    m.cyl(0, 0, g + 0.7, g + 1.5, 4.0, col=C["grass"], seg=16)
    m.cyl(0, 0, g + 1.5, g + 7.5, 0.6, 0.2, col=C["steel"], seg=8)
    # cars on the ring, travelling anticlockwise
    for j, col in enumerate([C["car1"], C["car2"], C["car3"], C["car4"], C["car3"]]):
        a = math.radians(30 + j * 72)
        r = 12.5 if j % 2 else 16.4
        car(m, r * math.cos(a), r * math.sin(a), g + 0.2, col, rot=a + math.pi / 2)
    return m


def arms_company(status):
    """A works: a long hall with a sawtooth roof, the office block, a
    banded chimney and a fenced yard."""
    m = Mesh()
    g = plinth(m, 104, 72, status, C["concrete"])
    hx, hy, hw, hd, hh = -10, -4, 62, 42, 9.0
    m.cbox(hx, hy, hw, hd, g, g + hh, C["offwhite"])
    teeth = 8
    tw = hw / teeth
    for k in range(teeth):
        x0 = hx - hw / 2 + k * tw
        # the steep north-light face is glazed, the long slope is roofing
        poly_y = (hy - hd / 2, hy + hd / 2)
        a, b, c = (x0, g + hh), (x0 + tw, g + hh), (x0 + tw * 0.2, g + hh + 4.2)
        for (p, q), col in (((a, b), C["roof"]), ((b, c), C["roof"]), ((c, a), C["glass"])):
            m.quad_outward((x0 + tw * 0.4, hy, g + hh + 1.4),
                           (p[0], poly_y[0], p[1]), (q[0], poly_y[0], q[1]),
                           (q[0], poly_y[1], q[1]), (p[0], poly_y[1], p[1]), col)
        for yy in poly_y:
            m.tri((a[0], yy, a[1]), (b[0], yy, b[1]), (c[0], yy, c[1]), C["roof"])
    # loading doors along the front
    for k in range(5):
        m.cbox(hx - 24 + k * 10, hy - hd / 2 - 0.1, 5, 0.25, g, g + 5, C["darksteel"])
    # office block with a window band
    m.cbox(34, 16, 20, 14, g, g + 11, C["white"], top=C["roof"])
    for z in (2.0, 5.6, 9.2):
        m.cbox(34, 8.9, 18, 0.2, g + z, g + z + 1.6, C["glass"])
    # the chimney, red and white at the top
    bands = 7
    hch = 36.0
    for k in range(bands):
        z0, z1 = hch * k / bands, hch * (k + 1) / bands
        col = (C["white"] if k % 2 else C["chimred"]) if k >= bands - 3 else C["concrete"]
        m.cyl(30, -22, g + z0, g + z1, 2.4 - 0.6 * k / bands, 2.4 - 0.6 * (k + 1) / bands, col=col, seg=12)
    # yard fence posts and a gate
    for x in range(-50, 51, 10):
        m.cbox(x, 34, 0.3, 0.3, g, g + 2.4, C["steel"])
    m.cbox(0, 34, 100, 0.1, g + 0.2, g + 2.2, C["steel"])
    return m


KINDS = {
    "refinery": refinery, "fuel_depot": fuel_depot, "fuel_station": fuel_station,
    "rally": rally, "roundabout": roundabout, "arms_company": arms_company,
}


def to_gltf(p):
    """Natural (along, right, up) -> glTF (right, up, along): the vessel
    conversion (make_aircraft_models.to_gltf_axes, forward=1)."""
    x, y, z = p
    return (y, z, x)


def weld(mesh):
    """Share vertices that agree on position, normal and colour: the files
    are a third of the size and nothing on screen changes."""
    out = Mesh()
    seen = {}
    for k in mesh.i:
        key = (tuple(round(c, 4) for c in mesh.v[k]), tuple(round(c, 4) for c in mesh.n[k]), mesh.c[k])
        j = seen.get(key)
        if j is None:
            j = seen[key] = len(out.v)
            out.v.append(mesh.v[k]); out.n.append(mesh.n[k]); out.c.append(mesh.c[k])
        out.i.append(j)
    return out


def to_glb(mesh, path):
    mesh = weld(mesh)
    mv = [to_gltf(p) for p in mesh.v]
    mn = [to_gltf(p) for p in mesh.n]
    verts = struct.pack("<%df" % (len(mv) * 3), *[c for p in mv for c in p])
    norms = struct.pack("<%df" % (len(mn) * 3), *[c for p in mn for c in p])
    cols = struct.pack("<%df" % (len(mesh.c) * 3), *[c for p in mesh.c for c in p])
    idx = struct.pack("<%dI" % len(mesh.i), *mesh.i)
    blob = verts + norms + cols + idx
    xs = [p[0] for p in mv]; ys = [p[1] for p in mv]; zs = [p[2] for p in mv]
    off = [0, len(verts), len(verts) + len(norms), len(verts) + len(norms) + len(cols)]
    gltf = {
        "asset": {"version": "2.0", "generator": "horizon-watch procedural places (tools/make_place_models.py)"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": path.stem}],
        "meshes": [{"primitives": [{"mode": 4, "attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                                    "indices": 3, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"metallicFactor": 0.25, "roughnessFactor": 0.55},
                       "doubleSided": True}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(mv), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": 5126, "count": len(mn), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(mesh.c), "type": "VEC3"},
            {"bufferView": 3, "componentType": 5125, "count": len(mesh.i), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": off[0], "byteLength": len(verts), "target": 34962},
            {"buffer": 0, "byteOffset": off[1], "byteLength": len(norms), "target": 34962},
            {"buffer": 0, "byteOffset": off[2], "byteLength": len(cols), "target": 34962},
            {"buffer": 0, "byteOffset": off[3], "byteLength": len(idx), "target": 34963},
        ],
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(out)
    return len(out), len(mesh.i) // 3


def file_name(kind, status):
    return f"{kind}.glb" if status == "grey" else f"{kind}_{status}.glb"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for kind, build in KINDS.items():
        for status in STATUS:
            size, tris = to_glb(build(status), OUT / file_name(kind, status))
            total += size
            print(f"  {file_name(kind, status):24s} {tris:6d} triangles  {size / 1024:6.1f} KB")
    print(f"  {'total':24s}                  {total / 1024:6.1f} KB")
    sys.exit(0)
