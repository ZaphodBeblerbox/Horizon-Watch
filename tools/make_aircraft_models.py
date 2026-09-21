#!/usr/bin/env python3
"""
make_aircraft_models.py - generate the aircraft glTF models the globe draws.

WHY GENERATED AND NOT DOWNLOADED. The models have to be redistributable
with this app, and a free-to-view model is not the same as a
free-to-ship one. Generating them means the licence question does not
arise, the files stay small enough to load thousands of times, and the
proportions come from published dimensions rather than from whatever a
modeller eyeballed.

WHAT THEY ARE HONESTLY. One model per aircraft FAMILY, sized from real
span and length. A 737 and an A320 differ in details - winglet shape,
nose profile - that are smaller than a pixel at any altitude this map
is used at, so shipping two near-identical meshes would cost memory to
encode a distinction nobody can see. What does read, and what these
carry, is: narrowbody against widebody, twin against quad, jet against
turboprop, airliner against fighter against helicopter.

Geometry is built in the frame that reads naturally: nose +X,
starboard +Y, up +Z. It is rewritten into glTF's frame on the way out
by to_gltf_axes(), because Cesium does NOT load a glTF in the frame it
was authored in.

CESIUM REMAPS THE AXES ON LOAD, and getting this wrong is invisible in
any check of the entity's orientation — the quaternion can be provably
correct while the mesh inside it lies on its side or points at the
ground. Read from Cesium's own code rather than assumed - and read twice,
because the first reading was of the wrong loader.
ModelUtility.getAxisCorrectionMatrix applies Y_UP_TO_Z_UP for upAxis Y
and then Z_UP_TO_X_UP when forwardAxis is Z. GltfLoader's default
forwardAxis IS Z (the `?? Axis.X` default elsewhere in Cesium belongs
to other loaders), so BOTH corrections apply to a .glb:

    glTF +X -> Cesium +Y
    glTF +Y -> Cesium +Z   (up)
    glTF +Z -> Cesium +X   (forward)

So the natural frame maps out as gltf = (starboard, up, nose).
"""
import json, struct, math, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "models" / "aircraft"


class Mesh:
    def __init__(self):
        self.v = []      # positions
        self.n = []      # normals
        self.i = []      # indices

    def tri(self, a, b, c):
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        L = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        nrm = (nx / L, ny / L, nz / L)
        base = len(self.v)
        for p in (a, b, c):
            self.v.append(p)
            self.n.append(nrm)
        self.i += [base, base + 1, base + 2]

    def quad(self, a, b, c, d):
        self.tri(a, b, c)
        self.tri(a, c, d)

    def quad_outward(self, centre, a, b, c, d):
        """A quad wound so its normal points AWAY from `centre`.

        Hand-written face lists get this wrong quietly. box() had its top
        and bottom swapped and two of its sides inverted, which is
        invisible in silhouette and invisible with a double-sided
        material — all it does is light the inside of the box and leave
        the outside dark. Deriving the winding from the geometry cannot
        drift the way a list of index tuples can.
        """
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        mx = (a[0] + b[0] + c[0] + d[0]) / 4 - centre[0]
        my = (a[1] + b[1] + c[1] + d[1]) / 4 - centre[1]
        mz = (a[2] + b[2] + c[2] + d[2]) / 4 - centre[2]
        if nx * mx + ny * my + nz * mz < 0:
            self.quad(d, c, b, a)
        else:
            self.quad(a, b, c, d)

    def tri_n(self, pts, nrms):
        """A triangle with normals given per vertex, for smooth shading."""
        base = len(self.v)
        for pt, nr in zip(pts, nrms):
            self.v.append(pt)
            self.n.append(nr)
        self.i += [base, base + 1, base + 2]

    def quad_n(self, pts, nrms):
        """A quad with per-vertex normals.

        WHY THIS EXISTS. Every surface was flat-shaded from face
        cross-products, which is right for a wing and wrong for a
        fuselage: a fourteen-sided tube lit per facet reads as a
        fourteen-sided tube, not as an aeroplane. Bodies of revolution
        now carry their true radial normals, so the hull shades smoothly
        and the silhouette is the only faceting left.
        """
        a, b, c, d = pts
        na, nb, nc, nd = nrms
        self.tri_n((a, b, c), (na, nb, nc))
        self.tri_n((a, c, d), (na, nc, nd))


def fuselage(m, length, radius, nose_frac=0.16, tail_frac=0.30, seg=22):
    """A body of revolution: rounded nose, straight barrel, tapered tail.

    Smooth-shaded, and finer than it was (22 segments rather than 14).
    Both cost nothing in a file this size and are the difference between
    a tube and a hull.
    """
    nose_x, tail_x = length * nose_frac, length * (1 - tail_frac)
    stations = []
    for k in range(7):                       # nose cone, finer than before
        t = k / 6
        stations.append((t * nose_x, radius * math.sin(t * math.pi / 2), 0.0))
    stations.append((tail_x, radius, 0.0))   # barrel
    for k in range(1, 7):                    # upswept tail
        t = k / 6
        stations.append((tail_x + t * (length - tail_x),
                         radius * (1 - t) ** 0.7,
                         radius * 0.45 * t ** 2))

    def ring(x, r, z, j):
        a = 2 * math.pi * j / seg
        return (x, r * math.cos(a), z + r * math.sin(a)), (0.0, math.cos(a), math.sin(a))

    for s_i in range(len(stations) - 1):
        x0, r0, z0 = stations[s_i]
        x1, r1, z1 = stations[s_i + 1]
        for j in range(seg):
            p00, n00 = ring(x0, r0, z0, j)
            p10, n10 = ring(x1, r1, z1, j)
            p11, n11 = ring(x1, r1, z1, j + 1)
            p01, n01 = ring(x0, r0, z0, j + 1)
            m.quad_n((p00, p10, p11, p01), (n00, n10, n11, n01))


def panel(m, root_x, root_z, span, root_c, tip_c, sweep, dihedral, thick,
          vertical=False, y_at=0.0):
    """A swept, tapered lifting surface, mirrored unless vertical."""
    sides = [1] if vertical else [1, -1]
    for side in sides:
        tip_y = span * side
        tip_x = root_x + sweep
        tip_z = root_z + (abs(span) * math.tan(math.radians(dihedral)))
        if vertical:
            # Sweep upward in Z instead of outward in Y.
            pts_top = [(root_x, 0, root_z), (root_x + root_c, 0, root_z),
                       (tip_x + tip_c, 0, root_z + span), (tip_x, 0, root_z + span)]
            for side, dy in ((1, y_at + thick / 2), (-1, y_at - thick / 2)):
                quadpts = [(p[0], dy, p[2]) for p in pts_top]
                # OPPOSITE WINDING PER FACE. Both skins were wound the
                # same way, so their computed normals pointed the same
                # way and one of the two faced into the surface. The
                # silhouette is unaffected, which is why it went unseen:
                # what it produced was a wing lit from underneath.
                m.quad(*(quadpts if side > 0 else quadpts[::-1]))
            for k in range(4):
                a, b = pts_top[k], pts_top[(k + 1) % 4]
                m.quad((a[0], y_at + thick / 2, a[2]), (b[0], y_at + thick / 2, b[2]),
                       (b[0], y_at - thick / 2, b[2]), (a[0], y_at - thick / 2, a[2]))
            continue
        pts = [(root_x, 0, root_z), (root_x + root_c, 0, root_z),
               (tip_x + tip_c, tip_y, tip_z), (tip_x, tip_y, tip_z)]
        for side, dz in ((1, thick / 2), (-1, -thick / 2)):
            face = [(p[0], p[1], p[2] + dz) for p in pts]
            # See the vertical case above: the lower skin has to be wound
            # the other way round or its normal points up into the wing.
            m.quad(*(face if side > 0 else face[::-1]))
        for k in range(4):
            a, b = pts[k], pts[(k + 1) % 4]
            m.quad((a[0], a[1], a[2] + thick / 2), (b[0], b[1], b[2] + thick / 2),
                   (b[0], b[1], b[2] - thick / 2), (a[0], a[1], a[2] - thick / 2))


def nacelle(m, x, y, z, length, radius, seg=10):
    for j in range(seg):
        a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
        m.quad((x, y + radius * math.cos(a0), z + radius * math.sin(a0)),
               (x + length, y + radius * math.cos(a0), z + radius * math.sin(a0)),
               (x + length, y + radius * math.cos(a1), z + radius * math.sin(a1)),
               (x, y + radius * math.cos(a1), z + radius * math.sin(a1)))


def disc(m, x, y, z, radius, seg=12):
    """A propeller disc, facing forward - the blurred circle it looks like.

    Lies in the Y-Z plane, which is correct for something that pulls the
    aircraft along +X.
    """
    for j in range(seg):
        a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
        m.tri((x, y, z),
              (x, y + radius * math.cos(a0), z + radius * math.sin(a0)),
              (x, y + radius * math.cos(a1), z + radius * math.sin(a1)))


def disc_flat(m, x, y, z, radius, seg=16):
    """A main rotor disc, lying flat in the X-Y plane.

    A helicopter's main rotor sweeps a HORIZONTAL circle. Drawing it with
    disc() put a 14.6m vertical disc on a 16m airframe, which the model
    geometry test caught as "not thin vertically" - the same shape of
    error as an aircraft rolled onto its side.
    """
    for j in range(seg):
        a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
        m.tri((x, y, z),
              (x + radius * math.cos(a0), y + radius * math.sin(a0), z),
              (x + radius * math.cos(a1), y + radius * math.sin(a1), z))


def airliner(length, span, engines=2, rear_engines=False, prop=False,
             sweep_frac=0.28, fin_frac=0.16, winglets=True):
    m = Mesh()
    r = length * 0.052
    fuselage(m, length, r)
    wing_x = length * 0.36
    panel(m, wing_x, -r * 0.35, span / 2, length * 0.16, length * 0.055,
          span * sweep_frac / 2, 5, r * 0.10)
    panel(m, length * 0.88, r * 0.30, span * 0.17, length * 0.09, length * 0.035,
          span * 0.10, 6, r * 0.07)
    panel(m, length * 0.86, r * 0.6, length * fin_frac, length * 0.11,
          length * 0.045, length * 0.09, 0, r * 0.07, vertical=True)
    if rear_engines:
        for s in (1, -1):
            nacelle(m, length * 0.72, s * r * 1.5, r * 0.5, length * 0.10, r * 0.42)
    else:
        n = engines // 2
        for s in (1, -1):
            for k in range(n):
                frac = 0.28 + 0.22 * k
                y = s * span * frac
                x = wing_x + (y and abs(y) * sweep_frac * 0.9) - length * 0.06
                z = -r * 0.35 + abs(y) * math.tan(math.radians(5)) - r * 0.55
                if prop:
                    nacelle(m, x, y, z, length * 0.11, r * 0.30)
                    disc(m, x - length * 0.01, y, z, span * 0.055)
                else:
                    nacelle(m, x, y, z, length * 0.13, r * 0.40)
                    # PYLON. Without it the nacelle floats under the wing
                    # with a gap, which at a glance reads as a fault in
                    # the model rather than as an engine.
                    panel(m, x + length * 0.03, z + r * 0.30, r * 0.75,
                          length * 0.055, length * 0.045, length * 0.008, 0,
                          r * 0.10, vertical=True, y_at=y)

    # WINGLETS. The single most recognisable thing about a modern
    # airliner's planform, and cheap: two small canted panels at the
    # tips. Turboprops and older types do not get them.
    if not prop and winglets:
        tip_x = wing_x + span * sweep_frac / 2
        tip_z = -r * 0.35 + (span / 2) * math.tan(math.radians(5))
        for s in (1, -1):
            panel(m, tip_x, tip_z, length * 0.055, length * 0.050, length * 0.028,
                  length * 0.018, 0, r * 0.07, vertical=True, y_at=s * span / 2)
    return m


def helicopter(length, rotor):
    m = Mesh()
    r = length * 0.11
    fuselage(m, length * 0.72, r, nose_frac=0.30, tail_frac=0.10)
    # Tail boom and fin.
    nacelle(m, length * 0.60, 0, r * 0.35, length * 0.40, r * 0.16)
    panel(m, length * 0.92, r * 0.4, length * 0.16, length * 0.10, length * 0.05,
          length * 0.04, 0, r * 0.10, vertical=True)
    disc_flat(m, length * 0.34, 0, r * 1.15, rotor / 2)      # main rotor, horizontal
    # Tail rotor spins about a lateral axis, so its disc stands upright
    # in the X-Z plane rather than facing forward.
    for j in range(12):
        a0, a1 = 2 * math.pi * j / 12, 2 * math.pi * (j + 1) / 12
        tr, tx, tz = rotor * 0.17, length * 0.99, r * 0.5
        m.tri((tx, r * 0.25, tz),
              (tx + tr * math.cos(a0), r * 0.25, tz + tr * math.sin(a0)),
              (tx + tr * math.cos(a1), r * 0.25, tz + tr * math.sin(a1)))
    return m


def fighter(length, span):
    m = Mesh()
    r = length * 0.055
    fuselage(m, length, r, nose_frac=0.26, tail_frac=0.18)
    panel(m, length * 0.42, -r * 0.2, span / 2, length * 0.30, length * 0.06,
          span * 0.52 / 2, 0, r * 0.09)                       # highly swept wing
    panel(m, length * 0.84, 0, span * 0.20, length * 0.13, length * 0.04,
          span * 0.14, 0, r * 0.07)                           # tailplane
    for s in (1, -1):                                         # twin canted fins
        panel(m, length * 0.78, r * 0.5 + s * 0, length * 0.15, length * 0.13,
              length * 0.05, length * 0.10, 0, r * 0.06, vertical=True)
    return m


def to_gltf_axes(p, forward=-1):
    """Natural frame into glTF's frame.

    `forward` is which way along X the vehicle FACES, and it is a
    parameter because the two builders disagree. fuselage() starts its
    nose cone at x=0 and extends aft, so an aircraft faces -X. hull()
    puts its pointed bow at x=length, so a ship faces +X. Both were
    then handed to the same converter, and the aircraft came out flying
    backwards - perfectly level, nose exactly 180 degrees from the
    direction of travel, across every one of 51 sampled.

    The geometry test cannot catch that: it measures EXTENTS, and a
    model facing backwards has exactly the same extents as one facing
    forwards. Only the browser check that compares rendered nose against
    direction of travel finds it.

    Cesium's conversion sends glTF (gx,gy,gz) to Cesium (gz, gx, gy) -
    read off a live model's sceneGraph.axisCorrectionMatrix, not
    inferred. Setting that equal to (forward, starboard, up) gives
    gltf = (starboard, up, forward).
    """
    x, y, z = p          # along-body, starboard, up
    if forward == 1:
        return (y, z, x)
    # A PROPER ROTATION, NOT A REFLECTION. Turning the model round by
    # negating x alone gives a transform with determinant -1, which
    # mirrors it: triangle winding reverses and every normal ends up
    # pointing into the surface it belongs to. The mesh silhouette looks
    # right, so nothing complains — but the lighting is inverted, which
    # is why the fuselage rendered darker than the wings it was supposed
    # to be lit alongside.
    #
    # Rotating 180 degrees about the up axis first (x,y -> -x,-y) and
    # then mapping gives determinant +1 and the same nose direction. The
    # airframe comes out mirrored left-for-right, which on a symmetric
    # aircraft is not a visible difference.
    return (-y, z, -x)


def to_glb(mesh, path, colour, forward=-1):
    mv = [to_gltf_axes(p, forward) for p in mesh.v]
    mn = [to_gltf_axes(p, forward) for p in mesh.n]
    verts = struct.pack("<%df" % (len(mv) * 3), *[c for p in mv for c in p])
    norms = struct.pack("<%df" % (len(mn) * 3), *[c for p in mn for c in p])
    idx = struct.pack("<%dI" % len(mesh.i), *mesh.i)
    while len(verts) % 4: verts += b"\0"
    while len(norms) % 4: norms += b"\0"
    while len(idx) % 4: idx += b"\0"
    blob = verts + norms + idx
    xs = [p[0] for p in mv]; ys = [p[1] for p in mv]; zs = [p[2] for p in mv]
    gltf = {
        "asset": {"version": "2.0", "generator": "horizon-watch procedural aircraft"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1},
                                    "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {
            "baseColorFactor": colour, "metallicFactor": 0.25, "roughnessFactor": 0.55},
            "doubleSided": True}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(mv), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": 5126, "count": len(mn), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5125, "count": len(mesh.i), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(verts), "target": 34962},
            {"buffer": 0, "byteOffset": len(verts), "byteLength": len(norms), "target": 34962},
            {"buffer": 0, "byteOffset": len(verts) + len(norms), "byteLength": len(idx),
             "target": 34963},
        ],
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    while len(js) % 4: js += b" "
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(out)
    return len(out), len(mesh.v) // 3


# Dimensions are real: length and wingspan in metres.
GREY = [0.82, 0.84, 0.87, 1.0]
MIL  = [0.42, 0.46, 0.50, 1.0]
FAMILIES = {
    "narrowbody": (airliner(37.6, 35.8), GREY),                       # A320 / 737
    "widebody":   (airliner(63.7, 64.8), GREY),                       # 777 / 787
    "heavy4":     (airliner(72.7, 79.8, engines=4), GREY),            # 747 / A340
    "regional":   (airliner(36.2, 28.7, rear_engines=True), GREY),    # E190 / CRJ
    "turboprop":  (airliner(27.2, 27.1, prop=True, sweep_frac=0.06), GREY),  # ATR / Dash 8
    "lightprop":  (airliner(14.4, 16.3, prop=True, sweep_frac=0.04), GREY),  # PC-12 / King Air
    "fighter":    (fighter(19.4, 13.1), MIL),                         # F-15 sized
    "helicopter": (helicopter(16.0, 14.6), MIL),
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (mesh, colour) in FAMILIES.items():
        size, tris = to_glb(mesh, OUT / f"{name}.glb", colour)
        total += size
        print(f"  {name:11s} {tris:5d} triangles  {size/1024:6.1f} KB")
    print(f"  {'total':11s} {'':5s}             {total/1024:6.1f} KB")
