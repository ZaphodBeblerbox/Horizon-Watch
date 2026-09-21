#!/usr/bin/env python3
"""
preview_models.py - look at a generated model without a browser.

WHY THIS EXISTS. Judging whether an airframe reads as an airframe is a
question about the mesh, and putting it on a globe to answer that drags
in a dev server, a session cookie, tile loading and a camera. This
rasterises the .glb directly: deterministic, offline, and it isolates
the geometry from everything else.

It also renders through the SAME axis conversion Cesium applies
(glTF (gx,gy,gz) -> Cesium (gz, gx, gy), read off a live model), so what
comes out here is oriented the way the globe will draw it. A model that
looks nose-down in this preview is nose-down in the app.
"""
import json
import math
import pathlib
import struct
import sys

from PIL import Image

W = H = 520


def load_glb(path):
    b = path.read_bytes()
    assert struct.unpack("<I", b[0:4])[0] == 0x46546C67, "not a glb"
    jlen = struct.unpack("<I", b[12:16])[0]
    gltf = json.loads(b[20:20 + jlen])
    bin_off = 20 + jlen + 8

    def acc(i):
        a = gltf["accessors"][i]
        bv = gltf["bufferViews"][a["bufferView"]]
        start = bin_off + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        n = a["count"]
        if a["type"] == "VEC3":
            vals = struct.unpack_from("<%df" % (n * 3), b, start)
            return [vals[k * 3:k * 3 + 3] for k in range(n)]
        return list(struct.unpack_from("<%dI" % n, b, start))

    prim = gltf["meshes"][0]["primitives"][0]
    pos = acc(prim["attributes"]["POSITION"])
    nrm = acc(prim["attributes"]["NORMAL"])
    idx = acc(prim["indices"])
    return pos, nrm, idx


def to_cesium(p):
    """glTF -> Cesium, exactly as the viewer does it."""
    gx, gy, gz = p
    return (gz, gx, gy)


def render(path, out, yaw_deg=35.0, pitch_deg=22.0):
    pos, nrm, idx = load_glb(path)
    pos = [to_cesium(p) for p in pos]
    nrm = [to_cesium(n) for n in nrm]

    ya, pa = math.radians(yaw_deg), math.radians(pitch_deg)
    cy, sy, cp, sp = math.cos(ya), math.sin(ya), math.cos(pa), math.sin(pa)

    def view(v):
        x, y, z = v
        x, y = x * cy - y * sy, x * sy + y * cy     # yaw about up
        y, z = y * cp - z * sp, y * sp + z * cp     # pitch
        return (x, y, z)

    vp = [view(p) for p in pos]
    vn = [view(n) for n in nrm]

    xs = [p[0] for p in vp]; zs = [p[2] for p in vp]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    scale = 0.82 * min(W, H) / max(max(xs) - min(xs), max(zs) - min(zs), 1e-6)

    img = Image.new("RGB", (W, H), (22, 26, 32))
    px = img.load()
    zbuf = [[-1e30] * W for _ in range(H)]
    light = (0.42, -0.50, 0.76)

    def project(p):
        return (W / 2 + (p[0] - cx) * scale, H / 2 - (p[2] - cz) * scale)

    for t in range(0, len(idx), 3):
        i0, i1, i2 = idx[t], idx[t + 1], idx[t + 2]
        p0, p1, p2 = project(vp[i0]), project(vp[i1]), project(vp[i2])
        depth = (vp[i0][1] + vp[i1][1] + vp[i2][1]) / 3
        n = vn[i0]
        L = math.sqrt(sum(c * c for c in n)) or 1.0
        lam = max(0.0, sum(a * b for a, b in zip([c / L for c in n], light)))
        shade = 0.20 + 0.80 * lam
        col = (int(215 * shade), int(222 * shade), int(232 * shade))

        minx = max(0, int(min(p[0] for p in (p0, p1, p2))))
        maxx = min(W - 1, int(max(p[0] for p in (p0, p1, p2))) + 1)
        miny = max(0, int(min(p[1] for p in (p0, p1, p2))))
        maxy = min(H - 1, int(max(p[1] for p in (p0, p1, p2))) + 1)
        d = ((p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]))
        if abs(d) < 1e-9:
            continue
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                w0 = ((p1[1] - p2[1]) * (x - p2[0]) + (p2[0] - p1[0]) * (y - p2[1])) / d
                w1 = ((p2[1] - p0[1]) * (x - p2[0]) + (p0[0] - p2[0]) * (y - p2[1])) / d
                w2 = 1 - w0 - w1
                if w0 < -0.002 or w1 < -0.002 or w2 < -0.002:
                    continue
                if depth > zbuf[y][x]:
                    zbuf[y][x] = depth
                    px[x, y] = col
    img.save(out)
    return out


if __name__ == "__main__":
    names = sys.argv[1:] or ["narrowbody"]
    base = pathlib.Path(__file__).resolve().parent.parent / "public" / "models"
    outdir = pathlib.Path("/tmp")
    for name in names:
        src = base / "aircraft" / f"{name}.glb"
        if not src.exists():
            src = base / "vessel" / f"{name}.glb"
        for label, (yaw, pitch) in {"top": (0, 89), "oblique": (35, 22)}.items():
            out = outdir / f"preview_{name}_{label}.png"
            render(src, out, yaw, pitch)
            print("wrote", out)
