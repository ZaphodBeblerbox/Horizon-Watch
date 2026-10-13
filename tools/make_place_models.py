#!/usr/bin/env python3
"""
make_place_models.py - the 3D models shown for endangered places.

One small model per MODEL TYPE (backend/place_types.py MODEL_LABEL): what
stands at the place - a refinery, a fuel depot, a town or market square, a
prefecture, a station, a bridge, a works, an office building, a park, a
whole town when the call names only the town... 33 types, so that every
place on the list has one (owner, 2026-10-12).

WHERE THEY ARE SHOWN. Never on the map (owner, 2026-10-12: "we never want
the 3D model displayed on the map"): only turning slowly in the sidebar -
the desktop inspector card and the phone's place sheet (PlaceModel.jsx).

WHAT A MODEL CLAIMS. Only the type. The real Feyzin refinery is two
kilometres across and Place Bellecour is not this square; each model is a
nominal, recognisable stand-in at a nominal size for its type, not a survey
of the site.

ONE NEUTRAL VERSION per type ({type}.glb), standing on a grey plinth: the
call's status is on the card, in words and colour, and the model does not
repeat it.

Same conventions as the shipped vessel and aircraft models
(tools/export_globe_models.mjs output): ONE mesh, ONE material, colours
baked per vertex (COLOR_0, linear), metallic 0.25 / roughness 0.55,
double-sided, indexed. Built in the natural frame (+X along, +Y right,
+Z up, metres) and rewritten into glTF's frame with the same conversion
as make_aircraft_models.to_gltf_axes(forward=1), so Cesium draws them
standing up. Origin at the centre of the plinth at ground level.

    python3 tools/make_place_models.py [type ...]
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


# Status colours: the same three as the 2D markers (endangeredPlaces.js);
# only grey is used now (one neutral version per type).
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


# ── shared parts for the town models ───────────────────────────────────

def tree(m, x, y, g, h=7.0, r=2.4, col=None):
    """A street tree: a trunk and a two-tier crown."""
    m.cyl(x, y, g, g + h * 0.42, 0.25, 0.2, col=C["rust"], seg=6)
    m.cyl(x, y, g + h * 0.32, g + h * 0.78, r, r * 0.55, col=col or C["grass"], seg=9)
    m.cyl(x, y, g + h * 0.72, g + h, r * 0.62, 0.0, col=col or C["grass"], seg=9)


def windows(m, cx, cy, w, d, z0, z1, g, floor_h=3.4, sides="nsew", col=None, inset=0.12):
    """Window bands round a box (w along X, d along Y): one band per floor."""
    col = col or C["glass"]
    z = g + z0 + 1.0
    while z + 1.4 <= g + z1 - 0.4:
        if "s" in sides:
            m.cbox(cx, cy - d / 2 - inset / 2, w * 0.86, inset, z, z + 1.4, col)
        if "n" in sides:
            m.cbox(cx, cy + d / 2 + inset / 2, w * 0.86, inset, z, z + 1.4, col)
        if "w" in sides:
            m.cbox(cx - w / 2 - inset / 2, cy, inset, d * 0.86, z, z + 1.4, col)
        if "e" in sides:
            m.cbox(cx + w / 2 + inset / 2, cy, inset, d * 0.86, z, z + 1.4, col)
        z += floor_h


def block(m, cx, cy, w, d, h, g, wall=None, roof=None, floor_h=3.4, sides="nsew", win=True):
    """A building: a box, a darker roof, and its windows."""
    m.cbox(cx, cy, w, d, g, g + h, wall or C["offwhite"], top=roof or C["roof"])
    if win:
        windows(m, cx, cy, w, d, 0, h, g, floor_h, sides)


def gable_roof(m, cx, cy, w, d, z, rise, col, along_x=True):
    """A pitched roof over a w×d box, ridge along X (or Y)."""
    if along_x:
        a, b = (cx - w / 2, cy - d / 2, z), (cx + w / 2, cy - d / 2, z)
        c, e = (cx + w / 2, cy + d / 2, z), (cx - w / 2, cy + d / 2, z)
        r0, r1 = (cx - w / 2, cy, z + rise), (cx + w / 2, cy, z + rise)
        m.quad_outward((cx, cy, z), a, b, r1, r0, col)
        m.quad_outward((cx, cy, z), e, c, r1, r0, col)
        m.tri(a, e, r0, col); m.tri(b, c, r1, col)
    else:
        a, b = (cx - w / 2, cy - d / 2, z), (cx - w / 2, cy + d / 2, z)
        c, e = (cx + w / 2, cy + d / 2, z), (cx + w / 2, cy - d / 2, z)
        r0, r1 = (cx, cy - d / 2, z + rise), (cx, cy + d / 2, z + rise)
        m.quad_outward((cx, cy, z), a, b, r1, r0, col)
        m.quad_outward((cx, cy, z), e, c, r1, r0, col)
        m.tri(a, e, r0, col); m.tri(b, c, r1, col)


def portico(m, cx, cy, w, g, h, n=6, depth=5.0, col=None, facing=-1):
    """A classical front: a stepped base, n columns, an entablature and a
    pediment, on the face at cy (facing -1 = towards -Y)."""
    col = col or C["white"]
    y = cy + facing * depth / 2
    for k in range(3):                                         # the steps
        m.cbox(cx, y + facing * (0.6 * (2 - k)), w + 2 - k * 0.6, depth + 1.2 * (2 - k), g, g + 0.35 * (k + 1), C["concrete"])
    base = g + 1.05
    for k in range(n):
        x = cx - w / 2 + 1.2 + k * (w - 2.4) / (n - 1)
        m.cyl(x, y + facing * (depth / 2 - 0.9), base, base + h, 0.55, 0.48, col=col, seg=10)
    m.cbox(cx, y, w, depth, base + h, base + h + 1.2, col)
    # the pediment: a low triangle across the front
    z = base + h + 1.2
    yf = y + facing * depth / 2
    yb = y - facing * depth / 2
    a, b, c = (cx - w / 2, yf, z), (cx + w / 2, yf, z), (cx, yf, z + w * 0.16)
    a2, b2, c2 = (cx - w / 2, yb, z), (cx + w / 2, yb, z), (cx, yb, z + w * 0.16)
    m.tri(a, b, c, col); m.tri(a2, c2, b2, col)
    m.quad_outward((cx, y, z), a, c, c2, a2, C["roof"])
    m.quad_outward((cx, y, z), b, c, c2, b2, C["roof"])


def flagpole(m, x, y, g, h=12.0, flag=None):
    m.cyl(x, y, g, g + h, 0.12, col=C["steel"], seg=6)
    m.cbox(x + 1.4, y, 2.6, 0.08, g + h - 1.8, g + h - 0.2, flag or C["flag"])


def crowd(m, cx, cy, g, rad=5.0, n=14, spread=360, start=0):
    cols = [C["cloth1"], C["cloth2"], C["cloth3"], C["cloth4"]]
    for k in range(n):
        a = math.radians(start + spread * (k + 0.5) / n)
        rr = rad * (0.55 + 0.45 * ((k * 37) % 10) / 10)
        person(m, cx + rr * math.cos(a), cy + rr * math.sin(a), g, cols[k % 4], 1.6 + 0.15 * (k % 3))


def bus(m, x, y, g, rot=0.0, col=None):
    m.cbox(x, y, 11.5, 2.5, g + 0.4, g + 3.0, col or C["yellow"], top=C["offwhite"], rot=rot)
    m.cbox(x, y, 11.7, 2.55, g + 1.5, g + 2.5, C["glass"], rot=rot)


def truck(m, x, y, g, rot=0.0, col=None):
    cs, sn = math.cos(rot), math.sin(rot)
    m.cbox(x - 2.0 * cs, y - 2.0 * sn, 9.0, 2.5, g + 0.9, g + 4.0, col or C["white"], top=C["offwhite"], rot=rot)
    m.cbox(x + 4.0 * cs, y + 4.0 * sn, 2.4, 2.4, g + 0.6, g + 3.2, C["car2"], rot=rot)


# ── the models (one per model_type, backend/place_types.py) ────────────

def factory(status):
    """A works (an arms-industry site): the former arms_company model."""
    return arms_company(status)


def motorway_junction(status):
    """A toll plaza across a motorway: lanes, booths under a canopy, and a
    bridge carrying a crossing road."""
    m = Mesh()
    g = plinth(m, 110, 60, status, C["grass"])
    m.cbox(0, 0, 104, 30, g, g + 0.12, C["asphalt"])
    for y in (-7.5, 7.5):
        for k in range(10):
            m.cbox(-48 + k * 10.5, y, 5, 0.25, g + 0.14, g + 0.18, C["marking"])
    m.cbox(0, 0, 104, 0.8, g, g + 0.9, C["concrete"])                     # the central barrier
    # the plaza: a canopy on pillars, booths between the lanes
    m.cbox(-18, 0, 10, 32, g + 6.0, g + 7.2, C["white"], top=C["roof"])
    m.cbox(-18, 0, 10.4, 32.4, g + 6.4, g + 7.0, C["yellow"])
    for k in range(7):
        y = -13.5 + k * 4.5
        m.cbox(-18, y, 2.2, 1.4, g, g + 2.6, C["offwhite"], top=C["roof"])
        m.cbox(-18, y, 0.4, 0.4, g + 2.6, g + 6.0, C["steel"])
    for j, (y, col) in enumerate([(-11.2, C["car1"]), (-6.7, C["car3"]), (2.2, C["car2"]), (6.7, C["car4"])]):
        car(m, -12 + 4 * j, y, g + 0.12, col)
    truck(m, -30, -11.2, g + 0.12, col=C["white"])
    # the overbridge with its deck and piers
    m.cbox(28, 0, 9, 58, g + 6.5, g + 7.6, C["concrete"], top=C["asphalt"])
    for y in (-16, 0, 16):
        m.cbox(28, y, 6, 1.6, g, g + 6.5, C["concrete"])
    m.cbox(28, -4.5, 9, 0.4, g + 7.6, g + 8.6, C["steel"])
    m.cbox(28, 4.5, 9, 0.4, g + 7.6, g + 8.6, C["steel"])
    car(m, 28, 10, g + 7.6, C["car1"], rot=math.pi / 2)
    # the gantry sign
    for y in (-15, 15):
        m.cbox(-40, y, 0.6, 0.6, g, g + 7.5, C["darksteel"])
    m.cbox(-40, 0, 1.0, 30, g + 6.8, g + 7.6, C["darksteel"])
    m.cbox(-40.6, 0, 0.15, 10, g + 6.0, g + 8.4, srgb("#2E6B3E"))
    return m


def town_square(status):
    """A market square: paving with a fountain in the middle, market stalls
    under striped awnings, plane trees, and town houses along two sides."""
    m = Mesh()
    g = plinth(m, 80, 80, status, srgb("#B7AE9C"))
    # paving pattern: lighter squares
    for i in range(-3, 4):
        for j in range(-3, 4):
            if (i + j) % 2 == 0:
                m.cbox(i * 8.5, j * 8.5, 8.4, 8.4, g, g + 0.05, srgb("#C9C1AF"))
    # the fountain: a basin, a column, a bowl
    m.cyl(0, 0, g, g + 0.9, 6.0, col=C["concrete"], seg=28, cap=srgb("#5B88A8"))
    m.cyl(0, 0, g + 0.9, g + 3.6, 0.7, col=C["concrete"], seg=12)
    m.cyl(0, 0, g + 3.6, g + 4.3, 2.4, 1.2, col=C["concrete"], seg=16, cap=srgb("#5B88A8"))
    # the market: two rows of stalls with striped awnings
    stripes = [srgb("#B5412F"), srgb("#E9E2CF"), srgb("#2F6FB3"), srgb("#E9E2CF"), srgb("#3E7A4A"), srgb("#E9E2CF")]
    for row, y in enumerate((-20, 20)):
        for k in range(5):
            x = -24 + k * 12
            col = stripes[(k * 2 + row * 2) % len(stripes)]
            m.cbox(x, y, 9, 4, g, g + 1.0, C["rust"], top=srgb("#D9B03A"))           # the counter with produce
            for px in (-4.3, 4.3):
                for py in (-1.9, 1.9):
                    m.cbox(x + px, y + py, 0.2, 0.2, g, g + 2.8, C["steel"])
            gable_roof(m, x, y, 9.6, 5.0, g + 2.8, 1.0, col)
    crowd(m, 0, -12, g, rad=8, n=10, spread=160, start=190)
    crowd(m, 0, 12, g, rad=8, n=8, spread=160, start=10)
    # trees on the open sides
    for y in (-30, -10, 10, 30):
        tree(m, 33, y, g, 8.5, 2.8)
    # town houses along the back and the left
    cols = [srgb("#C9B79C"), srgb("#B9A487"), srgb("#D2C6B0"), srgb("#AD9C86"), srgb("#C4B49A")]
    for k in range(6):
        x = -32 + k * 12.5
        h = 11 + (k * 7) % 5
        block(m, x, 34, 12, 8, h, g, wall=cols[k % 5], sides="s", floor_h=3.3)
        gable_roof(m, x, 34, 12, 8, g + h, 3.0, srgb("#8A4E3B"))
    for k in range(4):
        y = -26 + k * 13
        h = 12 + (k * 5) % 4
        block(m, -35, y, 8, 12.5, h, g, wall=cols[(k + 2) % 5], sides="e", floor_h=3.3)
        gable_roof(m, -35, y, 8, 12.5, g + h, 3.0, srgb("#8A4E3B"), along_x=False)
    return m


def street(status):
    """A city street: two carriageways' worth of asphalt, pavements, trees,
    terraced buildings on both sides and people on the pavement."""
    m = Mesh()
    g = plinth(m, 90, 56, status, C["concrete"])
    m.cbox(0, 0, 88, 12, g, g + 0.1, C["asphalt"])
    for k in range(9):
        m.cbox(-40 + k * 10, 0, 4.5, 0.3, g + 0.11, g + 0.14, C["marking"])
    for y in (-7.5, 7.5):
        m.cbox(0, y, 88, 3, g, g + 0.25, srgb("#B4AFA5"))
    cols = [srgb("#C9B79C"), srgb("#B9A487"), srgb("#D2C6B0"), srgb("#AD9C86"), srgb("#C4B49A"), C["offwhite"]]
    for side, y in ((-1, -17), (1, 17)):
        for k in range(7):
            x = -38 + k * 12.6
            h = 13 + (k * 5 + (side > 0) * 3) % 7
            block(m, x, y, 12.4, 16, h, g, wall=cols[(k + (side > 0)) % 6], sides="n" if side < 0 else "s")
        for k in range(6):
            tree(m, -32 + k * 13, y * 0.47, g, 7.5, 2.2)
    car(m, -18, -3, g + 0.1, C["car1"]); car(m, 6, 3, g + 0.1, C["car2"], rot=math.pi); car(m, 24, -3, g + 0.1, C["car3"])
    crowd(m, -6, 7.5, g, rad=3.5, n=8, spread=360)
    crowd(m, 16, -7.5, g, rad=2.5, n=5, spread=360)
    return m


def town_hall(status):
    """A town hall: a two-wing civic building with a central clock tower,
    a flag over the door, and a forecourt."""
    m = Mesh()
    g = plinth(m, 72, 52, status, srgb("#B7AE9C"))
    wall = srgb("#D8CDB6")
    block(m, 0, 8, 56, 18, 13, g, wall=wall, sides="sew", floor_h=4.2)
    gable_roof(m, 0, 8, 56, 18, g + 13, 5, srgb("#59636D"))
    # the central pavilion and its clock tower
    m.cbox(0, 0, 14, 4, g, g + 15, wall, top=C["roof"])
    m.cbox(0, -2.1, 3.2, 0.2, g, g + 4.2, C["darksteel"])                 # the door
    m.cbox(0, 8, 7, 7, g + 13, g + 26, wall, top=C["roof"])
    m.cyl(0, 4.4, g + 21.5, g + 21.6, 2.2, col=C["white"], seg=20)
    m.cbox(0, 4.45, 2.6, 0.1, g + 20.2, g + 22.8, C["white"])               # the clock face
    m.cbox(0, 8, 7.6, 7.6, g + 26, g + 26.6, C["roof"])
    m.cyl(0, 8, g + 26.6, g + 32, 4.6, 0.0, col=srgb("#59636D"), seg=4)
    flagpole(m, 0, -2.6, g + 15, 6, C["flag"])
    for x in (-24, 24):
        flagpole(m, x, -12, g, 10, C["flag"])
    for x in (-14, 14):
        tree(m, x, -16, g, 7, 2.4)
    crowd(m, 0, -12, g, rad=6, n=10, spread=180, start=180)
    return m


def government_office(status):
    """A prefecture or ministry: a long neoclassical block with a columned
    portico, a courtyard gate, and flags at the front."""
    m = Mesh()
    g = plinth(m, 84, 60, status, srgb("#B7AE9C"))
    wall = srgb("#DCD3C1")
    block(m, 0, 10, 70, 22, 16, g, wall=wall, sides="sew", floor_h=4.6)
    m.cbox(0, 10, 71, 23, g + 16, g + 17, C["white"])
    m.cbox(0, 10, 66, 18, g + 17, g + 20, srgb("#59636D"))                # mansard roof
    portico(m, 0, -1, 24, g, 11, n=6, depth=5, col=C["white"])
    for x in (-30, 30):
        block(m, x, -8, 10, 14, 13, g, wall=wall, sides="sew", floor_h=4.6)
    # the railings and the gate in front
    for x in range(-40, 41, 4):
        if abs(x) > 6:
            m.cbox(x, -24, 0.25, 0.25, g, g + 2.4, C["darksteel"])
    m.cbox(-23, -24, 34, 0.15, g + 2.0, g + 2.3, C["darksteel"])
    m.cbox(23, -24, 34, 0.15, g + 2.0, g + 2.3, C["darksteel"])
    for x in (-6, 6):
        m.cbox(x, -24, 1.2, 1.2, g, g + 3.2, wall, top=C["white"])
    for x in (-3, 0, 3):
        flagpole(m, x, -13, g, 11, C["flag"])
    return m


def embassy(status):
    """An embassy: a villa behind a high fence, a guard post at the gate,
    bollards, and a flag over the entrance."""
    m = Mesh()
    g = plinth(m, 60, 50, status, C["grass"])
    m.cbox(0, -6, 60 - 5, 6, g, g + 0.1, C["concrete"])
    block(m, 0, 8, 32, 18, 11, g, wall=srgb("#E2DCCF"), floor_h=3.8)
    gable_roof(m, 0, 8, 32, 18, g + 11, 4, srgb("#8A4E3B"))
    portico(m, 0, -1, 12, g, 7, n=4, depth=3.2, col=C["white"])
    flagpole(m, 0, -3, g + 9, 6, C["flag"])
    # the fence on a low wall, the gate, the guard post
    for x0, x1 in ((-26, -5), (5, 26)):
        m.cbox((x0 + x1) / 2, -14, x1 - x0, 0.6, g, g + 1.0, C["concrete"])
        for x in range(int(x0), int(x1) + 1, 2):
            m.cbox(x, -14, 0.15, 0.15, g + 1.0, g + 3.4, C["darksteel"])
    m.cbox(-26, 4, 0.6, 36, g, g + 3.4, C["concrete"])
    m.cbox(26, 4, 0.6, 36, g, g + 3.4, C["concrete"])
    m.cbox(0, 22, 52, 0.6, g, g + 3.4, C["concrete"])
    m.cbox(8, -16, 2.6, 2.6, g, g + 2.8, C["offwhite"], top=C["roof"])
    for x in (-4, -2, 0, 2, 4):
        m.cyl(x, -19, g, g + 0.9, 0.25, col=C["darksteel"], seg=8)
    for x in (-20, 20):
        tree(m, x, 12, g, 8, 2.8)
    return m


def police_station(status):
    """A police station: a modern block with a blue band, a radio mast on
    the roof, and patrol cars in the yard."""
    m = Mesh()
    g = plinth(m, 64, 50, status, C["concrete"])
    block(m, -4, 6, 40, 20, 11, g, wall=C["offwhite"], floor_h=3.6)
    m.cbox(-4, 6, 40.3, 20.3, g + 4.2, g + 5.0, srgb("#2F4F8F"))
    m.cbox(-4, -4.3, 8, 1.2, g + 3.0, g + 3.6, srgb("#2F4F8F"))           # the sign over the door
    m.cbox(-4, -4.1, 3, 0.2, g, g + 2.8, C["glass"])
    m.cyl(8, 10, g + 11, g + 24, 0.35, 0.15, col=C["steel"], seg=6)
    for z in (15, 19):
        m.cbox(8, 10, 2.4, 0.15, g + z, g + z + 0.15, C["steel"])
    m.cbox(-4, -14, 52, 12, g, g + 0.1, C["asphalt"])
    police = srgb("#E8ECF2")
    for k, x in enumerate((-20, -12, -4, 4)):
        car(m, x, -14, g + 0.1, police, rot=math.pi / 2)
        m.cbox(x, -14, 0.5, 1.2, g + 1.65, g + 1.9, srgb("#2F6FD8"))
    for x in range(-28, 29, 4):
        m.cbox(x, -21, 0.2, 0.2, g, g + 2.2, C["steel"])
    m.cbox(0, -21, 56, 0.1, g + 1.9, g + 2.1, C["steel"])
    return m


def courthouse(status):
    """A courthouse: a raised temple front over a broad flight of steps,
    and a dome."""
    m = Mesh()
    g = plinth(m, 70, 60, status, srgb("#B7AE9C"))
    stone = srgb("#E0D9C8")
    m.cbox(0, 8, 46, 26, g, g + 3, stone)
    block(m, 0, 10, 42, 22, 16, g + 3, wall=stone, sides="ew", floor_h=5)
    portico(m, 0, -3, 30, g + 3, 12, n=8, depth=6, col=C["white"])
    for k in range(6):                                                     # the broad flight of steps
        m.cbox(0, -8 - k * 1.1, 34, 1.2, g, g + 3 - k * 0.5, C["concrete"])
    m.cyl(0, 12, g + 19, g + 23, 8, col=stone, seg=24)
    m.cyl(0, 12, g + 23, g + 28, 8, 4, col=srgb("#5E7F7A"), seg=24)
    m.cyl(0, 12, g + 28, g + 30.5, 4, 0.6, col=srgb("#5E7F7A"), seg=24)
    for x in (-24, 24):
        tree(m, x, -18, g, 7, 2.2)
    return m


def school(status):
    """A school or university: an L of teaching blocks, a sports court and
    a flag in the yard."""
    m = Mesh()
    g = plinth(m, 76, 60, status, C["grass"])
    brick = srgb("#9A6A55")
    block(m, -8, 16, 52, 14, 10, g, wall=brick, floor_h=3.6)
    block(m, -28, -6, 14, 30, 10, g, wall=brick, floor_h=3.6)
    m.cbox(-8, 8.8, 6, 0.3, g, g + 3, C["glass"])
    # the yard and the sports court with its lines and goals
    m.cbox(10, -10, 44, 28, g, g + 0.1, srgb("#B4AFA5"))
    m.cbox(12, -10, 30, 16, g + 0.1, g + 0.14, srgb("#4F7A8F"))
    m.cbox(12, -10, 0.2, 16, g + 0.14, g + 0.17, C["marking"])
    for x in (-3, 27):
        m.cbox(x, -10, 0.3, 3, g + 0.1, g + 2.2, C["white"])
    flagpole(m, -12, 2, g, 10, C["flag"])
    for x, y in ((30, 12), (32, 22), (-36, 20)):
        tree(m, x, y, g, 8, 2.6)
    crowd(m, 6, -18, g, rad=3, n=7)
    return m


def hospital(status):
    """A hospital: a tall ward block on a podium, a red cross, a helipad on
    the roof, and ambulances at the emergency entrance."""
    m = Mesh()
    g = plinth(m, 70, 56, status, C["concrete"])
    block(m, 0, 4, 54, 30, 7, g, wall=C["white"], floor_h=3.5)
    block(m, 4, 8, 30, 16, 28, g, wall=C["white"], floor_h=3.4)
    m.cbox(4, 8, 14, 14, g + 28, g + 28.2, C["darksteel"])                 # the helipad
    m.ring(4, 8, g + 28.25, 5.2, 5.8, C["marking"], seg=24)
    m.cbox(2.6, 8, 0.6, 5, g + 28.25, g + 28.3, C["marking"])
    m.cbox(5.4, 8, 0.6, 5, g + 28.25, g + 28.3, C["marking"])
    m.cbox(4, 8, 2.6, 0.6, g + 28.25, g + 28.3, C["marking"])
    red = srgb("#D23B3B")
    m.cbox(4, -0.1, 5, 0.3, g + 21, g + 22.6, red)                          # the cross on the face
    m.cbox(4, -0.1, 1.6, 0.3, g + 19.4, g + 24.2, red)
    m.cbox(-18, -13, 14, 6, g + 4.5, g + 5.2, C["white"], top=C["roof"])   # the emergency canopy
    for x in (-24, -12):
        m.cbox(x, -15.5, 0.4, 0.4, g, g + 4.5, C["steel"])
    for x in (-21, -15):
        m.cbox(x, -13, 2.2, 5.6, g + 0.3, g + 2.8, C["white"], top=C["white"])
        m.cbox(x, -13, 2.25, 1.0, g + 1.2, g + 1.7, red)
    for x in (22, 28):
        tree(m, x, -18, g, 7, 2.2)
    return m


def train_station(status):
    """A railway station: a stone front with a clock, an arched train shed
    over the platforms, the tracks and a train."""
    m = Mesh()
    g = plinth(m, 96, 60, status, srgb("#8F8A80"))
    stone = srgb("#D8CDB6")
    block(m, -34, 0, 14, 44, 16, g, wall=stone, sides="wns", floor_h=5)
    m.cbox(-41.2, 0, 0.3, 4.2, g + 12, g + 15.6, C["white"])               # the clock
    m.cbox(-34, 0, 15, 45, g + 16, g + 17, C["roof"])
    # tracks
    for y in (-14, -5, 5, 14):
        m.cbox(14, y, 80, 2.0, g, g + 0.15, srgb("#6E655A"))
        for dy in (-0.7, 0.7):
            m.cbox(14, y + dy, 80, 0.15, g + 0.15, g + 0.3, C["steel"])
    for y in (-9.5, 9.5, 0):
        m.cbox(-2, y, 48, 3.4 if y else 2.6, g, g + 1.0, C["concrete"])
    # the arched shed: ribs and roof panels
    seg = 10
    R = 22
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        y0, z0 = -R * math.cos(a0), R * 0.55 * math.sin(a0)
        y1, z1 = -R * math.cos(a1), R * 0.55 * math.sin(a1)
        col = C["glass"] if k in (3, 4, 5, 6) else C["roof"]
        m.quad_outward((0, 0, g + 6), (-26, y0, g + 6 + z0), (22, y0, g + 6 + z0), (22, y1, g + 6 + z1), (-26, y1, g + 6 + z1), col)
    for x in range(-26, 23, 8):
        for s in (-1, 1):
            m.cbox(x, s * R, 0.6, 0.6, g, g + 6, C["darksteel"])
    # a train on the track
    for k in range(4):
        x = 0 + k * 13
        m.cbox(x, -5, 12.4, 2.9, g + 0.9, g + 4.4, srgb("#C8CDD3"), top=C["darksteel"])
        m.cbox(x, -5, 12.5, 2.95, g + 2.6, g + 3.6, C["glass"])
        m.cbox(x, -5, 12.5, 2.95, g + 1.2, g + 1.6, srgb("#B5412F"))
    crowd(m, -14, 9.5, g + 1.0, rad=4, n=8)
    return m


def bus_depot(status):
    """Local transport: a bus station's canopy over its bays, buses at the
    stands and a tram."""
    m = Mesh()
    g = plinth(m, 70, 50, status, C["asphalt"])
    for k in range(4):
        x = -21 + k * 14
        m.cbox(x, 4, 3, 22, g, g + 0.3, C["concrete"])                     # the islands
        bus(m, x + 4.6, 4, g, rot=math.pi / 2, col=[C["yellow"], srgb("#2F6FB3"), srgb("#3E7A4A"), C["yellow"]][k])
    m.cbox(-6, 4, 54, 26, g + 5.2, g + 5.8, C["white"], top=C["roof"])
    for x in (-30, -12, 6, 22):
        for y in (-7, 15):
            m.cbox(x, y, 0.5, 0.5, g, g + 5.2, C["steel"])
    block(m, 26, 4, 10, 18, 6, g, wall=C["offwhite"], floor_h=3.0)
    # the tram on its rails along the front
    for dy in (-0.8, 0.8):
        m.cbox(0, -18 + dy, 66, 0.2, g, g + 0.2, C["steel"])
    for k in range(3):
        m.cbox(-14 + k * 9.4, -18, 9, 2.5, g + 0.4, g + 3.4, srgb("#E2E6EA"), top=C["darksteel"])
        m.cbox(-14 + k * 9.4, -18, 9.1, 2.55, g + 1.6, g + 2.7, C["glass"])
    crowd(m, -21, 4, g + 0.3, rad=2.5, n=6)
    return m


def port(status):
    """A port: a quay along the water, two container cranes, stacks of
    containers and a ship alongside."""
    m = Mesh()
    g = plinth(m, 110, 76, status, srgb("#2E5B78"))
    m.cbox(0, 18, 106, 36, g, g + 2.0, C["concrete"])                       # the quay, above the water
    q = g + 2.0
    box_cols = [srgb("#B5412F"), srgb("#2F6FB3"), srgb("#3E7A4A"), srgb("#D9B03A"), srgb("#8A9096"), srgb("#7A3E6B")]
    for i in range(6):
        for j in range(3):
            for k in range(1 + (i + j) % 3):
                m.cbox(-30 + i * 12.6, 22 + j * 3.0, 12, 2.5, q + k * 2.6, q + k * 2.6 + 2.5, box_cols[(i * 3 + j + k) % 6])
    # the cranes: legs over the quay edge, the boom out over the water
    for x in (-26, 10):
        for dx in (-5, 5):
            for y in (2, 12):
                m.cbox(x + dx, y, 1.0, 1.0, q, q + 26, C["chimred"])
        m.cbox(x, 7, 12, 12, q + 26, q + 28, C["chimred"])
        m.cbox(x, -4, 2.0, 40, q + 30, q + 31.6, C["chimred"])
        m.cbox(x, 6, 4, 5, q + 28, q + 32, C["white"])
    # the ship
    m.cbox(-8, -14, 84, 13, g - 0.5, g + 4.5, srgb("#22303C"), top=srgb("#7A3E2B"))
    for i in range(5):
        m.cbox(-36 + i * 12.5, -14, 12, 10, g + 4.5, g + 7.0, box_cols[(i + 2) % 6])
    m.cbox(30, -14, 7, 11, g + 4.5, g + 13, C["white"], top=C["roof"])
    m.cbox(30, -19.6, 6, 0.2, g + 10.5, g + 12, C["glass"])
    return m


def airport(status):
    """An airport: a terminal with its glazed front, a control tower, the
    apron with an airliner at the gate."""
    m = Mesh()
    g = plinth(m, 110, 80, status, C["grass"])
    m.cbox(0, -10, 106, 46, g, g + 0.1, srgb("#55595E"))                    # the apron
    m.cbox(0, -30, 106, 8, g, g + 0.12, C["asphalt"])                       # the taxiway
    for k in range(10):
        m.cbox(-48 + k * 10.5, -30, 5, 0.3, g + 0.13, g + 0.16, C["yellow"])
    block(m, 0, 24, 80, 18, 12, g, wall=C["offwhite"], floor_h=12, win=False)
    m.cbox(0, 14.9, 76, 0.3, g + 1, g + 11, C["glass"])
    m.cbox(0, 24, 84, 22, g + 12, g + 13, C["white"])                       # the roof overhang
    # the jet bridge and the airliner
    m.cbox(-6, 8, 2.6, 14, g + 3.5, g + 6.0, C["offwhite"])
    m.cyl(-6, 1, g, g + 3.5, 0.5, col=C["steel"], seg=6)
    fx = -6
    m.rod((fx - 22, -6, g + 4.6), (fx + 18, -6, g + 4.6), 2.2, C["white"], seg=14)       # fuselage along X
    m.prism([(fx - 4, -6), (fx + 3, -6), (fx - 7, -23), (fx - 10, -23)], g + 3.6, g + 4.0, C["white"])
    m.prism([(fx - 4, -6), (fx + 3, -6), (fx - 7, 11), (fx - 10, 11)], g + 3.6, g + 4.0, C["white"])
    m.cbox(fx - 20, -6, 4, 0.5, g + 6.0, g + 11.0, srgb("#2F6FB3"))          # the fin
    m.prism([(fx - 22, -6), (fx - 18, -6), (fx - 21, -12), (fx - 23, -12)], g + 5.6, g + 5.9, C["white"])
    m.prism([(fx - 22, -6), (fx - 18, -6), (fx - 21, 0), (fx - 23, 0)], g + 5.6, g + 5.9, C["white"])
    for y in (-15, 3):
        m.rod((fx - 6, y, g + 2.9), (fx - 1, y, g + 2.9), 1.0, C["steel"], seg=10)
    # the control tower
    m.cyl(44, 0, g, g + 30, 2.2, 1.8, col=C["offwhite"], seg=12)
    m.cyl(44, 0, g + 30, g + 34, 4.2, 4.8, col=C["glass"], seg=12)
    m.cyl(44, 0, g + 34, g + 35, 5.0, 3.0, col=C["roof"], seg=12)
    m.cyl(44, 0, g + 35, g + 39, 0.15, col=C["steel"], seg=6)
    return m


def military_base(status):
    """A military base: a fenced perimeter with watch tower and gatehouse,
    two arched hangars, and a vehicle on the hardstanding."""
    m = Mesh()
    g = plinth(m, 96, 70, status, srgb("#7C8466"))
    m.cbox(4, 4, 86, 54, g, g + 0.1, srgb("#80827A"))
    olive = srgb("#59603F")
    for x in (-16, 22):                                                     # the hangars: half-barrels
        seg = 10
        for k in range(seg):
            a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
            y0, z0 = 9 * math.cos(a0), 9 * math.sin(a0)
            y1, z1 = 9 * math.cos(a1), 9 * math.sin(a1)
            m.quad_outward((x, 12, g), (x - 14, 12 + y0, g + z0), (x + 14, 12 + y0, g + z0),
                           (x + 14, 12 + y1, g + z1), (x - 14, 12 + y1, g + z1), olive)
        m.cbox(x - 14.05, 12, 0.1, 12, g, g + 6.5, C["darksteel"])
    # the fence
    for x in range(-42, 47, 4):
        for y in (-23, 31):
            m.cbox(x, y, 0.15, 0.15, g, g + 3, C["steel"])
    for y in range(-23, 32, 4):
        for x in (-42, 46):
            m.cbox(x, y, 0.15, 0.15, g, g + 3, C["steel"])
    m.cbox(2, -23, 88, 0.08, g + 2.6, g + 2.8, C["steel"]); m.cbox(2, 31, 88, 0.08, g + 2.6, g + 2.8, C["steel"])
    m.cbox(-42, 4, 0.08, 54, g + 2.6, g + 2.8, C["steel"]); m.cbox(46, 4, 0.08, 54, g + 2.6, g + 2.8, C["steel"])
    # the gatehouse and its barrier
    block(m, -8, -27, 8, 5, 3.4, g, wall=C["offwhite"], floor_h=3)
    m.cbox(0, -23, 8, 0.25, g + 1.0, g + 1.25, C["chimred"])
    # the watch tower
    for dx, dy in ((-1.4, -1.4), (1.4, -1.4), (-1.4, 1.4), (1.4, 1.4)):
        m.cbox(-38 + dx, 26 + dy, 0.3, 0.3, g, g + 10, C["darksteel"])
    m.cbox(-38, 26, 4.2, 4.2, g + 10, g + 12.5, olive, top=C["roof"])
    # an armoured vehicle and a truck
    m.cbox(4, -10, 7, 3.2, g + 0.6, g + 2.6, olive, top=olive)
    m.cyl(5, -10, g + 2.6, g + 3.4, 1.2, col=olive, seg=8)
    m.rod((5, -10, g + 3.0), (10, -10, g + 3.0), 0.15, olive)
    truck(m, 22, -10, g, col=olive)
    flagpole(m, -14, -18, g, 10, C["flag"])
    return m


def bridge(status):
    """A bridge: stone arches over a river, the roadway with cars, and the
    embankments with trees."""
    m = Mesh()
    g = plinth(m, 90, 64, status, C["grass"])
    m.cbox(0, 0, 86, 34, g - 0.3, g + 0.05, srgb("#3E6A86"))               # the river
    for s in (-1, 1):
        m.cbox(0, s * 19, 86, 4, g, g + 1.2, C["concrete"])                  # the quays
        for k in range(5):
            tree(m, -36 + k * 18, s * 25, g, 8, 2.6)
    stone = srgb("#C9BFA9")
    deck_z = g + 7.5
    m.cbox(0, 0, 12, 46, deck_z, deck_z + 1.2, stone, top=C["asphalt"])
    for s in (-1, 1):
        m.cbox(s * 5.6, 0, 0.8, 46, deck_z + 1.2, deck_z + 2.2, stone)
    for y in (-17, -6, 6, 17):                                              # the piers with cutwaters
        m.cbox(0, y, 11, 2.6, g - 0.3, deck_z, stone)
        m.cyl(-5.5, y, g - 0.3, g + 3, 1.3, col=stone, seg=8)
        m.cyl(5.5, y, g - 0.3, g + 3, 1.3, col=stone, seg=8)
    # arch soffits between the piers (a stepped curve)
    for y0, y1 in ((-17, -6), (-6, 6), (6, 17)):
        cy, half = (y0 + y1) / 2, (y1 - y0) / 2 - 1.3
        for k in range(6):
            a = math.pi * (k + 0.5) / 6
            m.cbox(0, cy - half * math.cos(a), 11, half / 3.2, g + 2.5 + 4.2 * math.sin(a), deck_z, stone)
    for j, (y, col) in enumerate([(-12, C["car1"]), (2, C["car2"]), (14, C["car3"])]):
        car(m, (-2.2 if j % 2 else 2.2), y, deck_z + 1.2, col, rot=math.pi / 2)
    crowd(m, 3.5, -3, deck_z + 1.2, rad=1.5, n=5)
    return m


def office_building(status):
    """An office building: a glass tower on a podium, a canopy at the door
    and a forecourt."""
    m = Mesh()
    g = plinth(m, 56, 50, status, C["concrete"])
    m.cbox(0, 4, 40, 30, g, g + 6, srgb("#B9BEC4"), top=C["roof"])
    m.cbox(0, -11.1, 36, 0.2, g + 0.5, g + 5.5, C["glass"])
    m.cbox(4, 6, 22, 18, g + 6, g + 46, srgb("#3B5268"), top=C["roof"])
    for z in range(8, 46, 4):                                               # the floor slabs, as bands
        m.cbox(4, 6, 22.3, 18.3, g + z, g + z + 0.5, srgb("#C9CED4"))
    for x in (-6.9, 14.9):
        m.cbox(x, 6, 0.3, 18.4, g + 6, g + 46, srgb("#C9CED4"))
    m.cbox(4, 6, 10, 8, g + 46, g + 48.5, C["darksteel"])                    # the plant room
    m.cbox(0, -13, 12, 4, g + 4, g + 4.4, C["white"])
    for x in (-5, 5):
        m.cbox(x, -14.6, 0.3, 0.3, g, g + 4, C["steel"])
    for x in (-20, 20):
        tree(m, x, -18, g, 6, 2)
    flagpole(m, -14, -17, g, 9, C["flag"])
    return m


def shopping_centre(status):
    """A shopping centre: a big low box with a glazed entrance, signage, and
    a car park full of cars."""
    m = Mesh()
    g = plinth(m, 96, 74, status, C["asphalt"])
    block(m, 0, 18, 80, 30, 12, g, wall=srgb("#D2CDC4"), win=False)
    m.cbox(0, 2.6, 22, 1.2, g, g + 14, C["glass"])                           # the glazed entrance hall
    m.cbox(0, 2.4, 24, 1.0, g + 14, g + 15, C["white"])
    m.cbox(0, 1.8, 14, 0.3, g + 10.5, g + 12.5, srgb("#B5412F"))             # the sign
    for x in (-28, 28):
        m.cbox(x, 2.8, 18, 0.2, g + 3, g + 7, C["glass"])
    # the car park: bays and cars
    cols = [C["car1"], C["car2"], C["car3"], C["car4"]]
    for row, y in enumerate((-10, -22)):
        for k in range(14):
            x = -40 + k * 6.1
            m.cbox(x - 3, y, 0.15, 5, g + 0.05, g + 0.09, C["marking"])
            if (k * 7 + row * 3) % 4 != 0:
                car(m, x, y, g + 0.05, cols[(k + row) % 4], rot=math.pi / 2)
    m.cbox(40, -30, 1.0, 1.0, g, g + 10, C["darksteel"])
    m.cbox(40, -30, 1.4, 4.0, g + 6, g + 10, srgb("#B5412F"))               # the totem
    return m


def warehouse(status):
    """A logistics warehouse: a long shed with loading docks, trucks backed
    up to them, and trailers in the yard."""
    m = Mesh()
    g = plinth(m, 104, 70, status, C["concrete"])
    block(m, 0, 12, 92, 36, 13, g, wall=srgb("#C9CED4"), win=False)
    for k in range(int(92 / 4)):
        m.cbox(-44 + k * 4, 12, 0.2, 36.2, g + 0.2, g + 12.8, srgb("#B4BAC1"))   # cladding ribs
    for k in range(10):
        x = -38 + k * 8.4
        m.cbox(x, -6.1, 4, 0.3, g, g + 4.5, C["darksteel"])                    # the dock doors
    m.cbox(0, -10, 100, 14, g, g + 0.1, C["asphalt"])
    for k, x in enumerate((-38, -21.2, 4, 20.8)):
        truck(m, x, -13, g + 0.1, rot=-math.pi / 2, col=[C["white"], srgb("#2F6FB3"), C["white"], srgb("#B5412F")][k])
    for k in range(4):
        m.cbox(-30 + k * 16, -27, 13, 2.6, g + 1.0, g + 4.0, C["white"], top=C["offwhite"])
    m.cbox(40, 12, 10, 36.4, g + 13, g + 13.4, C["roof"])
    return m


def power_plant(status):
    """A power plant: two cooling towers with steam, the turbine hall and a
    tall chimney."""
    m = Mesh()
    g = plinth(m, 100, 76, status, C["ground"])
    for x in (-22, 12):
        m.cyl(x, 12, g, g + 14, 16, 11, col=srgb("#C9C6BE"), seg=28)
        m.cyl(x, 12, g + 14, g + 34, 11, 12.5, col=srgb("#C9C6BE"), seg=28)
        m.cyl(x, 12, g + 34, g + 40, 13, 9, col=srgb("#EEF0F2"), seg=16)       # the steam
        m.cyl(x, 12, g + 40, g + 44, 9, 3, col=srgb("#EEF0F2"), seg=16)
    block(m, 0, -20, 50, 16, 16, g, wall=C["offwhite"], floor_h=16)
    m.cbox(0, -20, 50.4, 16.4, g + 11, g + 12.5, srgb("#2F6FB3"))
    m.cyl(34, -18, g, g + 60, 2.8, 1.9, col=C["concrete"], seg=12)
    for k, z in enumerate((48, 52, 56)):
        m.cyl(34, -18, g + z, g + z + 2, 2.2 - 0.1 * k, col=C["chimred"] if k % 2 == 0 else C["white"], seg=12)
    for x in (-40, -34):
        for y in (-30, -22):
            m.cbox(x, y, 3, 3, g, g + 6, C["darksteel"])
    return m


def stadium(status):
    """A stadium: a pitch inside an oval bowl of stands under a roof ring,
    with floodlight masts."""
    m = Mesh()
    g = plinth(m, 104, 84, status, C["concrete"])
    m.cbox(0, 0, 44, 28, g, g + 0.2, srgb("#4E8A4A"))
    for k in range(-2, 3):
        m.cbox(k * 8.8, 0, 4.4, 28, g + 0.2, g + 0.22, srgb("#5A9656"))
    m.cbox(0, 0, 0.3, 28, g + 0.22, g + 0.26, C["marking"])
    m.ring(0, 0, g + 0.26, 3.8, 4.2, C["marking"], seg=20)
    seg = 32
    for k in range(seg):
        a0, a1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
        for t, (r0, r1, z0, z1, col) in enumerate([(1.0, 1.55, 0.6, 14, srgb("#9AA3AD")), (1.55, 1.6, 14, 18, C["offwhite"])]):
            p = [(32 * r * math.cos(a), 22 * r * math.sin(a)) for r, a in ((r0, a0), (r0, a1), (r1, a1), (r1, a0))]
            m.quad_outward((0, 0, g - 50), (p[0][0], p[0][1], g + z0), (p[1][0], p[1][1], g + z0),
                           (p[2][0], p[2][1], g + z1), (p[3][0], p[3][1], g + z1), col)
            if t == 1:                                                    # the outer wall
                m.quad_outward((0, 0, g - 50), (p[3][0], p[3][1], g + z1), (p[2][0], p[2][1], g + z1),
                               (p[2][0], p[2][1], g), (p[3][0], p[3][1], g), col)
        # the roof ring over the upper tier
        p = [(32 * r * math.cos(a), 22 * r * math.sin(a)) for r, a in ((1.25, a0), (1.25, a1), (1.62, a1), (1.62, a0))]
        m.quad(*(((x, y, g + 19.5) for x, y in p)), C["white"], ((0, 0, 1),) * 4)
        m.quad(*(((x, y, g + 19.5) for x, y in reversed(p))), C["roof"], ((0, 0, -1),) * 4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 44, sy * 31
            m.cyl(x, y, g, g + 32, 0.6, 0.4, col=C["steel"], seg=6)
            m.cbox(x, y, 4, 0.6, g + 31, g + 34, C["white"])
    return m


def church(status):
    """A church: a nave with a pitched roof, a west tower with a spire, and
    a small square in front."""
    m = Mesh()
    g = plinth(m, 64, 44, status, srgb("#B7AE9C"))
    stone = srgb("#C9BFA9")
    m.cbox(4, 0, 36, 14, g, g + 12, stone)
    gable_roof(m, 4, 0, 36, 14, g + 12, 7, srgb("#59636D"))
    for x in range(-10, 21, 6):                                              # the tall windows
        for s in (-1, 1):
            m.cbox(x, s * 7.06, 1.4, 0.1, g + 3, g + 9, C["glass"])
    m.cyl(22, 0, g, g + 12, 7, col=stone, seg=16)                            # the apse
    m.cyl(22, 0, g + 12, g + 16, 7, 0.5, col=srgb("#59636D"), seg=16)
    m.cbox(-18, 0, 9, 9, g, g + 22, stone, top=C["roof"])                    # the tower
    m.cbox(-22.56, 0, 0.1, 2.4, g + 15, g + 19, C["darksteel"])
    m.cbox(-22.56, 0, 0.1, 3.0, g, g + 5, C["darksteel"])                    # the door
    m.cyl(-18, 0, g + 22, g + 40, 6.0, 0.0, col=srgb("#59636D"), seg=8)
    m.cbox(-18, 0, 0.3, 0.3, g + 40, g + 43, C["darksteel"])
    m.cbox(-18, 0, 0.3, 1.8, g + 41.6, g + 42.0, C["darksteel"])
    for y in (-14, 14):
        tree(m, -26, y, g, 7, 2.4)
    return m


def monument(status):
    """A monument: a stepped plinth with an obelisk, a ring of bollards, and
    wreaths at its foot."""
    m = Mesh()
    g = plinth(m, 40, 40, status, srgb("#B7AE9C"), round_=True)
    stone = srgb("#D8D2C4")
    for k, r in enumerate((10, 8.5, 7)):
        m.cbox(0, 0, r * 2, r * 2, g + k * 0.6, g + (k + 1) * 0.6, C["concrete"])
    m.cbox(0, 0, 6, 6, g + 1.8, g + 6.5, stone, top=stone)
    m.cbox(0, 0, 6.6, 6.6, g + 6.5, g + 7.2, stone)
    m.cyl(0, 0, g + 7.2, g + 25, 2.0, 1.1, col=stone, seg=4)
    m.cyl(0, 0, g + 25, g + 27, 1.1, 0.0, col=srgb("#B8A770"), seg=4)
    for k in range(12):
        a = 2 * math.pi * k / 12
        m.cyl(13 * math.cos(a), 13 * math.sin(a), g, g + 1.0, 0.3, col=C["darksteel"], seg=6)
    for x in (-1.6, 1.6):
        m.cyl(x, -3.6, g + 1.8, g + 2.0, 0.8, col=srgb("#3E7A4A"), seg=10)
    crowd(m, 0, 0, g, rad=11, n=10, spread=140, start=220)
    return m


def park(status):
    """A park: lawns, curving paths, clumps of trees, a bandstand and a pond."""
    m = Mesh()
    g = plinth(m, 80, 64, status, C["grass"])
    for rot in (0.35, -0.5):
        m.cbox(0, 0, 84, 3.2, g, g + 0.08, srgb("#C9BFA9"), rot=rot)
    m.cyl(-18, 12, g - 0.0, g + 0.1, 9, col=srgb("#3E6A86"), seg=24)            # the pond
    # the bandstand: an octagonal platform, posts and a roof
    m.cyl(16, -8, g, g + 1.0, 6, col=C["white"], seg=8)
    for k in range(8):
        a = 2 * math.pi * k / 8
        m.cyl(16 + 5.4 * math.cos(a), -8 + 5.4 * math.sin(a), g + 1, g + 5, 0.2, col=C["white"], seg=6)
    m.cyl(16, -8, g + 5, g + 7.5, 6.6, 0.4, col=srgb("#3E5E4A"), seg=8)
    cols = [srgb("#4E6F43"), srgb("#5D7E4C"), srgb("#3F6040")]
    for k, (x, y) in enumerate([(-32, -22), (-26, -14), (-34, 24), (30, 22), (24, 28), (34, 10), (-6, -24), (2, 22),
                                (-30, -2), (36, -24)]):
        tree(m, x, y, g, 8 + (k % 3) * 1.5, 2.6 + (k % 2) * 0.6, col=cols[k % 3])
    for x in (-4, 6):
        m.cbox(x, 4, 2.4, 0.6, g + 0.4, g + 0.9, C["rust"])                  # benches
    crowd(m, 16, -8, g + 1.0, rad=3.5, n=6)
    return m


def car_park(status):
    """A car park: marked bays, rows of cars, lamp posts and a pay machine."""
    m = Mesh()
    g = plinth(m, 64, 48, status, C["asphalt"])
    cols = [C["car1"], C["car2"], C["car3"], C["car4"], srgb("#C9CED4")]
    for row, y in enumerate((-15, -5, 5, 15)):
        for k in range(10):
            x = -27 + k * 6
            m.cbox(x - 3, y, 0.15, 5, g + 0.02, g + 0.06, C["marking"])
            if (k * 5 + row * 3) % 7 not in (0, 3):
                car(m, x, y, g + 0.02, cols[(k * 3 + row) % 5], rot=math.pi / 2)
    for x in (-20, 0, 20):
        m.cyl(x, 0, g, g + 8, 0.15, col=C["steel"], seg=6)
        m.cbox(x, 0, 1.6, 0.5, g + 7.8, g + 8.2, C["offwhite"])
    m.cbox(28, -21, 1.0, 0.7, g, g + 1.8, srgb("#2F6FB3"))
    crowd(m, -10, 0, g, rad=3, n=7)
    return m


def city(status):
    """A city or area named without a place: a cluster of blocks and towers
    of varied heights — "somewhere in this town", and no more."""
    m = Mesh()
    g = plinth(m, 70, 70, status, C["concrete"], round_=True)
    walls = [C["offwhite"], srgb("#C9B79C"), srgb("#B9BEC4"), srgb("#D2C6B0"), srgb("#AD9C86"), srgb("#3B5268")]
    k = 0
    for i in range(-2, 3):
        for j in range(-2, 3):
            x, y = i * 11.5, j * 11.5
            if x * x + y * y > 27 ** 2:
                continue
            h = 8 + ((i * 7 + j * 13 + 40) % 9) * 3.2 * (1.3 if abs(i) + abs(j) <= 1 else 0.7)
            w = 8 + (k % 3)
            # windows on the two faces the default view sees, every other floor's height
            block(m, x, y, w, w, h, g, wall=walls[k % 6], floor_h=4.2, sides="sw")
            k += 1
    for t in range(0, 360, 30):                                              # the ring road
        a = math.radians(t)
        tree(m, 31 * math.cos(a), 31 * math.sin(a), g, 6, 1.9)
    return m


def generic_building(status):
    """A building at an address: a six-storey block with a ground-floor
    shop front, a door and the pavement."""
    m = Mesh()
    g = plinth(m, 40, 36, status, C["concrete"])
    block(m, 0, 4, 28, 18, 20, g, wall=srgb("#D2C6B0"), floor_h=3.2)
    m.cbox(0, 4, 28.4, 18.4, g, g + 3.6, srgb("#8A8F96"))
    m.cbox(0, -5.2, 24, 0.2, g + 0.4, g + 3.2, C["glass"])
    m.cbox(0, -5.4, 26, 1.4, g + 3.4, g + 3.7, srgb("#3E5E4A"))             # the awning
    m.cbox(0, 4, 29, 19, g + 20, g + 20.6, C["roof"])
    gable_roof(m, 0, 4, 28, 18, g + 20.6, 4, srgb("#59636D"))
    for x in (-12, 12):
        tree(m, x, -12, g, 6, 1.9)
    crowd(m, 0, -11, g, rad=4, n=8, spread=180, start=180)
    return m


def shield(m, cx, y, z0, w, h, col, inner=None, facing=-1):
    """A heraldic shield standing upright in the XZ plane at y (its face
    towards `facing` along Y): a flat top, straight sides, a point below;
    a smaller one of `inner` colour on it, and a check mark."""
    def outline(sw, sh, zb):
        pts = [(-sw / 2, zb + sh), (sw / 2, zb + sh), (sw / 2, zb + sh * 0.45)]
        for k in range(1, 6):                                     # the curved lower edge to the point
            a = k / 6
            pts.append((sw / 2 * (1 - a) ** 1.3, zb + sh * 0.45 * (1 - a) ** 0.8))
        pts.append((0.0, zb))
        for k in range(5, 0, -1):
            a = k / 6
            pts.append((-sw / 2 * (1 - a) ** 1.3, zb + sh * 0.45 * (1 - a) ** 0.8))
        pts.append((-sw / 2, zb + sh * 0.45))
        return pts
    nrm = (0.0, float(facing), 0.0)
    def face(pts, yy, colr):
        ctr = (cx, yy, sum(p[1] for p in pts) / len(pts))
        for a, b in zip(pts, pts[1:] + pts[:1]):
            m.tri(ctr, (cx + a[0], yy, a[1]), (cx + b[0], yy, b[1]), colr, (nrm,) * 3)
    face(outline(w, h, z0), y, col)
    face(outline(w * 0.78, h * 0.8, z0 + h * 0.1), y + facing * 0.05, inner or C["white"])
    # the check mark, two bars
    zc = z0 + h * 0.5
    m.rod((cx - w * 0.2, y + facing * 0.1, zc), (cx - w * 0.04, y + facing * 0.1, zc - h * 0.16), h * 0.05, col, seg=6)
    m.rod((cx - w * 0.04, y + facing * 0.1, zc - h * 0.16), (cx + w * 0.24, y + facing * 0.1, zc + h * 0.2), h * 0.05, col, seg=6)


def safe_house(status):
    """A SAFE HOUSE (evacuation.py): a plain two-storey house — nothing on it
    says what it is from the street — inside a high fence with a sliding
    gate and an intercom post, shutters on the ground floor, a generator and
    a water tank at the back, and, for the map only, a green shield with a
    check mark at the gate and over the door."""
    m = Mesh()
    g = plinth(m, 56, 48, status, C["grass"])
    green, white = srgb("#2E9E5B"), C["white"]
    wall = srgb("#D9D1C2")
    m.cbox(0, -3, 50, 7, g, g + 0.1, C["concrete"])                          # the drive
    m.cbox(0, 6, 22, 14, g, g + 7.2, wall)                                   # the house
    windows(m, 0, 6, 22, 14, g, g + 7.2, g, floor_h=3.6)
    gable_roof(m, 0, 6, 23.4, 15.4, g + 7.2, 4.2, srgb("#6B4B3E"))
    for x in (-7.5, -3, 3, 7.5):                                             # ground-floor shutters, closed
        m.cbox(x, -1.06, 2.2, 0.12, g + 0.9, g + 2.9, srgb("#4A5560"))
    m.cbox(0, -1.08, 2.0, 0.14, g, g + 2.6, srgb("#3B3F45"))                 # the steel door
    m.cbox(0, -1.5, 3.2, 1.2, g + 2.7, g + 2.9, C["darksteel"])              # its canopy
    shield(m, 0, -1.2, g + 4.0, 2.4, 2.8, green, white)                      # over the door
    m.cbox(-9, 14.5, 4, 2, g, g + 2.2, C["darksteel"], top=C["steel"])       # the generator
    m.cyl(9, 15, g, g + 3.4, 1.6, col=srgb("#5F7F95"), seg=14)               # the water tank
    m.cyl(-10.8, 1.5, g + 7.2, g + 10.5, 0.12, col=C["steel"], seg=6)        # the radio aerial
    # the fence: a low wall with high bars all round, the sliding gate open a little
    def fence(x0, y0, x1, y1):
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(L / 1.6))
        m.cbox((x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0) or 0.6, abs(y1 - y0) or 0.6, g, g + 0.9, C["concrete"])
        for k in range(n + 1):
            x, y = x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n
            m.cbox(x, y, 0.16, 0.16, g + 0.9, g + 3.6, C["darksteel"])
        m.cbox((x0 + x1) / 2, (y0 + y1) / 2, (abs(x1 - x0) or 0.12) + 0.1, (abs(y1 - y0) or 0.12) + 0.1, g + 3.5, g + 3.7, C["darksteel"])
    fence(-24, -10, -4, -10)
    fence(8, -10, 24, -10)
    fence(-24, -10, -24, 20)
    fence(24, -10, 24, 20)
    fence(-24, 20, 24, 20)
    # the gate: a heavier frame, slid half open behind the right-hand fence
    m.cbox(4, -10.6, 9, 0.25, g + 0.2, g + 3.4, srgb("#3B3F45"))
    for x in (-4, 8):
        m.cbox(x, -10, 0.7, 0.7, g, g + 4.0, C["concrete"], top=C["roof"])
    m.cbox(-6, -12, 0.5, 0.5, g, g + 1.5, C["steel"])                        # the intercom post
    shield(m, -6, -12.3, g + 1.6, 1.6, 1.9, green, white)                    # the sign at the gate
    for x, y in ((-18, 12), (18, 4), (-17, -4)):
        tree(m, x, y, g, 7, 2.3)
    car(m, -12, -3, g + 0.1, C["car4"])
    return m


MODELS = {
    "refinery": refinery, "fuel_depot": fuel_depot, "fuel_station": fuel_station, "roundabout": roundabout,
    "motorway_junction": motorway_junction, "town_square": town_square, "street": street,
    "town_hall": town_hall, "government_office": government_office, "embassy": embassy,
    "police_station": police_station, "courthouse": courthouse, "school": school, "hospital": hospital,
    "train_station": train_station, "bus_depot": bus_depot, "port": port, "airport": airport,
    "military_base": military_base, "bridge": bridge, "factory": factory, "office_building": office_building,
    "shopping_centre": shopping_centre, "warehouse": warehouse, "power_plant": power_plant,
    "stadium": stadium, "church": church, "monument": monument, "park": park, "car_park": car_park,
    "city": city, "generic_building": generic_building, "rally": rally, "safe_house": safe_house,
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


def file_name(model_type):
    return f"{model_type}.glb"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    only = set(sys.argv[1:])
    for name, build in MODELS.items():
        if only and name not in only:
            continue
        size, tris = to_glb(build("grey"), OUT / file_name(name))
        total += size
        print(f"  {file_name(name):26s} {tris:6d} triangles  {size / 1024:6.1f} KB")
    print(f"  {'total':26s}                  {total / 1024:6.1f} KB")
    sys.exit(0)
