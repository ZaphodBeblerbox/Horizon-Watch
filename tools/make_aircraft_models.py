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


def fuselage(m, length, radius, nose_frac=0.16, tail_frac=0.30, seg=14):
    """A body of revolution: rounded nose, straight barrel, tapered tail."""
    nose_x, tail_x = length * nose_frac, length * (1 - tail_frac)
    # Station list: (x, radius, z-offset) - the tail lifts slightly, as it does.
    stations = []
    for k in range(5):                       # nose cone
        t = k / 4
        stations.append((t * nose_x, radius * math.sin(t * math.pi / 2), 0.0))
    stations.append((tail_x, radius, 0.0))   # barrel
    for k in range(1, 5):                    # upswept tail
        t = k / 4
        stations.append((tail_x + t * (length - tail_x),
                         radius * (1 - t) ** 0.7,
                         radius * 0.45 * t ** 2))
    for s in range(len(stations) - 1):
        x0, r0, z0 = stations[s]
        x1, r1, z1 = stations[s + 1]
        for j in range(seg):
            a0, a1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
            m.quad((x0, r0 * math.cos(a0), z0 + r0 * math.sin(a0)),
                   (x1, r1 * math.cos(a0), z1 + r1 * math.sin(a0)),
                   (x1, r1 * math.cos(a1), z1 + r1 * math.sin(a1)),
                   (x0, r0 * math.cos(a1), z0 + r0 * math.sin(a1)))


def panel(m, root_x, root_z, span, root_c, tip_c, sweep, dihedral, thick, vertical=False):
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
            for dy in (thick / 2, -thick / 2):
                quadpts = [(p[0], dy, p[2]) for p in pts_top]
                m.quad(*quadpts)
            for k in range(4):
                a, b = pts_top[k], pts_top[(k + 1) % 4]
                m.quad((a[0], thick / 2, a[2]), (b[0], thick / 2, b[2]),
                       (b[0], -thick / 2, b[2]), (a[0], -thick / 2, a[2]))
            continue
        pts = [(root_x, 0, root_z), (root_x + root_c, 0, root_z),
               (tip_x + tip_c, tip_y, tip_z), (tip_x, tip_y, tip_z)]
        for dz in (thick / 2, -thick / 2):
            m.quad(*[(p[0], p[1], p[2] + dz) for p in pts])
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
             sweep_frac=0.28, fin_frac=0.16):
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
    return (y, z, forward * x)


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
