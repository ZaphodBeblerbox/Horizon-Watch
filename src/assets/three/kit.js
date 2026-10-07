/**
 * kit.js — the parts every asset model is built from.
 *
 * One look for all of them: physically based materials under studio light
 * (Assets3D.js sets the light), a muted palette with one accent per model,
 * windows as real recessed panes some of which are lit. Units are metres,
 * the length of a thing along +X, up is +Y.
 */
import * as THREE from "three"

const cache = new Map()

/** How finely curved parts are cut: 1 for the inspector and the register,
 *  lower for the globe, where hundreds of models are drawn at a few dozen
 *  pixels (dev/export-globe.html). */
let DETAIL = 1
export function setDetail(d) { DETAIL = d }
export const det = (n, min = 6) => Math.max(min, Math.round(n * DETAIL))

/** A shared standard material. opts: metal, rough, emissive, emissiveIntensity, opacity, side, flat */
export function mat(color, opts = {}) {
    const key = JSON.stringify([color, opts])
    if (cache.has(key)) return cache.get(key)
    const m = new THREE.MeshStandardMaterial({
        color,
        metalness: opts.metal ?? 0.15,
        roughness: opts.rough ?? 0.62,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        transparent: opts.opacity != null,
        opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
        flatShading: !!opts.flat,
        vertexColors: !!opts.vertexColors,
    })
    cache.set(key, m)
    return m
}

export const PAL = {
    white: 0xeef0f2, offwhite: 0xd9dcdf, grey: 0x8a9096, darkgrey: 0x3b4148, steel: 0x6f7a84, black: 0x1a1d21,
    navy: 0x1f2f46, red: 0x8f2a24, antifoul: 0x7d2a22, deckgreen: 0x4c6b55, deckred: 0x7c4a3a, teak: 0x8a6a4a,
    orange: 0xd9822b, yellow: 0xe0b63a, blue: 0x2f6fb3, glass: 0x1c2b3a, concrete: 0xa9a59c, asphalt: 0x2c2f33,
    rust: 0x8a5a3b, green: 0x4f7a4a, copper: 0xb87333,
}
export const GLASS = () => mat(PAL.glass, { metal: 0.6, rough: 0.12 })
export const LIT = () => mat(0xffd9a0, { emissive: 0xffc070, emissiveIntensity: 0.9, rough: 0.4 })

export function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, shadow = true } = {}) {
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    m.scale.set(sx, sy, sz)
    m.castShadow = shadow
    m.receiveShadow = true
    return m
}

/** A box whose bottom sits at y (not centred) — buildings and decks stack. */
export function block(w, h, d, material, { x = 0, y = 0, z = 0, ry = 0 } = {}) {
    return mesh(new THREE.BoxGeometry(w, h, d), material, { x, y: y + h / 2, z, ry })
}

/** A box with rounded edges (superstructures, cabs, containers' look). */
export function rblock(w, h, d, r, material, opts = {}) {
    const shape = new THREE.Shape()
    const x0 = -w / 2, y0 = 0
    r = Math.min(r, w / 2, h / 2)
    shape.moveTo(x0 + r, y0)
    shape.lineTo(x0 + w - r, y0); shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r)
    shape.lineTo(x0 + w, y0 + h - r); shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h)
    shape.lineTo(x0 + r, y0 + h); shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r)
    shape.lineTo(x0, y0 + r); shape.quadraticCurveTo(x0, y0, x0 + r, y0)
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: Math.min(r, d / 4) * 0.6, bevelThickness: Math.min(r, d / 4) * 0.6, bevelSegments: det(3, 1), curveSegments: det(6, 2) })
    geo.translate(0, 0, -d / 2)
    return mesh(geo, material, opts)
}

export function cyl(rTop, rBot, h, material, opts = {}, seg = 28) {
    const { axis = "y", ...rest } = opts
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, det(seg), 1)
    if (axis === "x") geo.rotateZ(Math.PI / 2)
    if (axis === "z") geo.rotateX(Math.PI / 2)
    return mesh(geo, material, rest)
}

export function sphere(r, material, opts = {}, seg = 32) {
    return mesh(new THREE.SphereGeometry(r, det(seg), det(seg * 0.75, 4)), material, opts)
}

/** A pipe/rod between two points. */
export function rod(a, b, r, material, seg = 10) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
    const len = A.distanceTo(B)
    const geo = new THREE.CylinderGeometry(r, r, len, det(seg, 4), 1)
    const m = mesh(geo, material)
    m.position.copy(A).add(B).multiplyScalar(0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
    return m
}

/** Lathe a profile [[r, y], …] around Y (towers, tanks, fuselages before turning). */
export function lathe(points, material, opts = {}, seg = 48) {
    const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), det(seg, 8))
    return mesh(geo, material, opts)
}

/** Windows on the faces of a box (centre cx,cz, bottom y0, size w×h×d).
 *  faces: any of "+x","-x","+z","-z". Each pane is a thin box set into the
 *  wall; `lit` of them glow. Instanced: hundreds cost one draw. */
export function windows(group, { cx = 0, cz = 0, y0 = 0, w, h, d }, {
    faces = ["+x", "-x", "+z", "-z"], rowH = 3.2, colW = 2.4, paneW = 1.4, paneH = 1.6, sill = 1.0, top = 0.6, lit = 0.25, band = false, seed = 1,
} = {}) {
    const dummy = new THREE.Object3D()
    const panes = [], glow = []
    let s = (Math.abs(Math.round(seed)) * 9301 + 49297) % 233280
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    const rows = Math.max(1, Math.floor((h - sill - top) / rowH))
    for (const f of faces) {
        const along = f.endsWith("x") ? d : w
        const cols = Math.max(1, Math.floor(along / colW))
        const off = (along - cols * colW) / 2 + colW / 2
        for (let r = 0; r < rows; r++) {
            const y = y0 + sill + r * rowH + paneH / 2
            for (let c = 0; c < cols; c++) {
                const t = -along / 2 + off + c * colW
                let x = cx, z = cz, ry = 0
                if (f === "+x") { x = cx + w / 2 + 0.02; z = cz + t; ry = Math.PI / 2 }
                if (f === "-x") { x = cx - w / 2 - 0.02; z = cz + t; ry = Math.PI / 2 }
                if (f === "+z") { z = cz + d / 2 + 0.02; x = cx + t }
                if (f === "-z") { z = cz - d / 2 - 0.02; x = cx + t }
                dummy.position.set(x, y, z)
                dummy.rotation.set(0, ry, 0)
                dummy.scale.set(band ? colW * 1.02 : paneW, paneH, 0.08)
                dummy.updateMatrix();
                (rnd() < lit ? glow : panes).push(dummy.matrix.clone())
            }
        }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1)
    for (const [list, m] of [[panes, GLASS()], [glow, LIT()]]) {
        if (!list.length) continue
        const im = new THREE.InstancedMesh(geo, m, list.length)
        list.forEach((mx, i) => im.setMatrixAt(i, mx))
        im.castShadow = false
        im.receiveShadow = true
        group.add(im)
    }
}

/**
 * A ship's hull, lofted through cross-sections: a fine entry at the bow, a
 * full parallel midbody, a transom at the stern; superelliptic sections
 * (flat bottom, round bilge, vertical sides) that sharpen into a V toward
 * the bow, with a raked stem. Coloured by height: antifouling below the
 * waterline, a black boot-top, the hull colour above, a white sheer line.
 * Returns a group with the hull and its deck (deck top at y = D).
 */
export function hull({ L, B, D, T, color = PAL.navy, deck = PAL.deckred, entry = 0.22, run = 0.12, transom = 0.8, rake = 0.35, sheer = 0.06 }) {
    const N = det(72, 24)
    const halfW = (u) => {                   // u: 0 stern … 1 bow
        if (u > 1 - entry) { const t = (u - (1 - entry)) / entry; return Math.max(0.004, Math.sqrt(Math.max(0, 1 - t * t)) * (1 - t * 0.1)) }
        if (u < run) { const t = 1 - u / run; return transom + (1 - transom) * Math.sqrt(1 - t * t) }
        return 1
    }
    const sheerY = (u) => D * (1 + sheer * (Math.pow(Math.max(0, u - 0.6) / 0.4, 2) * 1.6 + Math.pow(Math.max(0, 0.2 - u) / 0.2, 2) * 0.5))
    // Bands down each section, each with a fixed number of samples, so every
    // colour boundary lies on a ring of vertices and stays crisp:
    // sheer line | topsides | boot-top | bottom.
    const BANDS = [
        { color: new THREE.Color(PAL.white), n: 1, to: (top) => top - D * 0.03 },
        { color: new THREE.Color(color), n: 5, to: () => T + D * 0.045 },
        { color: new THREE.Color(PAL.black), n: 1, to: () => T },
        { color: new THREE.Color(PAL.antifoul), n: 12, to: () => 0 },
    ]
    const sectionPts = (u) => {
        const hw = (B / 2) * halfW(u), top = sheerY(u)
        const fine = Math.max(0, (u - (1 - entry)) / entry)
        const n = 2 + 5 * (1 - fine * 0.85)          // full sections aft, V toward the bow
        const thetaAt = (y) => Math.asin(Math.min(1, Math.pow(Math.max(0, (top - y) / top), n / 2)))
        const pts = []                                 // starboard half, deck edge to keel
        let yFrom = top
        pts.push(yFrom)
        for (const band of BANDS) {
            const yTo = band.to(top)
            for (let i = 1; i <= band.n; i++) {
                // under water, sample by angle so the bilge turn gets the points
                if (band.n > 4) { const t0 = thetaAt(yFrom), t1 = Math.PI / 2, th = t0 + ((t1 - t0) * i) / band.n; pts.push(top - top * Math.pow(Math.sin(th), 2 / n)) }
                else pts.push(yFrom + ((yTo - yFrom) * i) / band.n)
            }
            yFrom = yTo
        }
        return pts.map((y) => {
            const th = thetaAt(y)
            const z = Math.pow(Math.cos(th), 2 / n) * hw
            const x = (u - 0.5) * L + (u > 1 - entry ? rake * (y / D) * (L * entry * 0.18) * fine : 0)
            return [x, y, z]
        })
    }
    const bandOf = []
    BANDS.forEach((b, i) => { for (let k = 0; k < b.n; k++) bandOf.push(i) })
    const rings = []
    for (let i = 0; i <= N; i++) {
        const half = sectionPts(i / N)
        // full ring: starboard deck edge → keel → port deck edge
        rings.push([...half, ...half.slice(0, -1).reverse().map(([x, y, z]) => [x, y, -z])])
    }
    const M = rings[0].length
    const pos = [], idx = []
    for (const r of rings) for (const p of r) pos.push(...p)
    const bandOfSeg = (k) => (k < bandOf.length ? bandOf[k] : bandOf[M - 2 - k])
    const tris = []
    for (let i = 0; i < N; i++) for (let k = 0; k < M - 1; k++) {
        const a = i * M + k, b = (i + 1) * M + k
        idx.push(a, b, b + 1, a, b + 1, a + 1)
        tris.push(bandOfSeg(k), bandOfSeg(k))
    }
    // smooth normals from the indexed mesh, then one colour per triangle
    const ig = new THREE.BufferGeometry()
    ig.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    ig.setIndex(idx)
    ig.computeVertexNormals()
    const geo = ig.toNonIndexed()
    const col = new Float32Array(geo.attributes.position.count * 3)
    tris.forEach((band, t) => { const c = BANDS[band].color; for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (t * 3 + v) * 3) })
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    const g = new THREE.Group()
    g.add(mesh(geo, mat(0xffffff, { vertexColors: true, metal: 0.3, rough: 0.42, side: THREE.DoubleSide })))
    // the transom: a flat stern plate in the hull colour, antifouling below the waterline
    const t0 = rings[0]
    const shapeT = new THREE.Shape()
    t0.forEach(([, y, z], k) => (k ? shapeT.lineTo(z, y) : shapeT.moveTo(z, y)))
    const tg = new THREE.ShapeGeometry(shapeT)
    tg.rotateY(Math.PI / 2)
    g.add(mesh(tg, mat(color, { metal: 0.3, rough: 0.42, side: THREE.DoubleSide }), { x: t0[0][0] }))
    // deck: the outline at the sheer, a little inboard of the bulwark
    const shape = new THREE.Shape()
    for (let i = 0; i <= N; i++) { const r = rings[i][0]; i ? shape.lineTo(r[0], r[2] * 0.985) : shape.moveTo(r[0], r[2] * 0.985) }
    for (let i = N; i >= 0; i--) { const r = rings[i][0]; shape.lineTo(r[0], -r[2] * 0.985) }
    const dg = new THREE.ShapeGeometry(shape, 1)
    dg.rotateX(Math.PI / 2)
    // the deck follows the sheer: lift each vertex to the sheer at its x
    const dp = dg.attributes.position
    for (let v = 0; v < dp.count; v++) dp.setY(v, sheerY(dp.getX(v) / L + 0.5) * 0.985)
    dg.computeVertexNormals()
    g.add(mesh(dg, mat(deck, { rough: 0.85, side: THREE.DoubleSide })))
    g.userData = { L, B, D, T, deckAt: (u) => sheerY(u) * 0.985, halfW: (u) => (B / 2) * halfW(u), deckColor: deck, hullColor: color }
    return g
}

/** A wheel: tyre + rim + hub, axle along Z. */
export function wheel(r, w, { x = 0, y = r, z = 0 } = {}) {
    const g = new THREE.Group()
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 12, 28), mat(PAL.black, { rough: 0.9 }))
    tyre.scale.z = w / (r * 0.56)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.8, 20), mat(PAL.grey, { metal: 0.7, rough: 0.35 }))
    rim.rotation.x = Math.PI / 2
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 0.9, 10), mat(PAL.darkgrey, { metal: 0.6 }))
    hub.rotation.x = Math.PI / 2
    for (const m of [tyre, rim, hub]) { m.castShadow = true; g.add(m) }
    g.position.set(x, y, z)
    return g
}

/** A lattice: four corner legs and cross-bracing between two heights (pylons, cranes, towers). */
export function lattice(group, { x = 0, z = 0, y0 = 0, y1, w0, w1, levels = 6, r = 0.12, material }) {
    const m = material || mat(PAL.steel, { metal: 0.6, rough: 0.45 })
    const corner = (y, sx, sz) => { const t = (y - y0) / (y1 - y0), w = w0 + (w1 - w0) * t; return [x + sx * w / 2, y, z + sz * w / 2] }
    const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]]
    for (const [sx, sz] of C) group.add(rod(corner(y0, sx, sz), corner(y1, sx, sz), r * 1.6, m))
    for (let l = 0; l < levels; l++) {
        const ya = y0 + ((y1 - y0) * l) / levels, yb = y0 + ((y1 - y0) * (l + 1)) / levels
        for (let i = 0; i < 4; i++) {
            const [ax, az] = C[i], [bx, bz] = C[(i + 1) % 4]
            group.add(rod(corner(ya, ax, az), corner(yb, bx, bz), r, m))
            group.add(rod(corner(yb, ax, az), corner(yb, bx, bz), r, m))
        }
    }
}

/** A container, 40 ft (12.2 × 2.6 × 2.44) by default, with corrugation hint. */
export const CONTAINER_COLORS = [0xb5412f, 0x2f6fb3, 0x3c7d4b, 0xd9822b, 0x6b6f75, 0x7d3b8a, 0xc9a227, 0x1f4e79, 0x9b2c2c, 0x2b8a8a]
export function containerStack(group, { x0, z0, bays, rows, tiers, y0, len = 12.2, wid = 2.44, hgt = 2.6, gap = 0.12, seed = 3, fill = 1 }) {
    const geo = new THREE.BoxGeometry(len, hgt, wid)
    const byColor = new Map()
    let s = (Math.abs(Math.round(seed)) * 7919) % 233280 + 1
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    const d = new THREE.Object3D()
    for (let b = 0; b < bays; b++) for (let r = 0; r < rows; r++) {
        const h = Math.max(1, Math.round(tiers * (fill + (1 - fill) * rnd())))
        for (let t = 0; t < h; t++) {
            const c = CONTAINER_COLORS[Math.floor(rnd() * CONTAINER_COLORS.length)]
            d.position.set(x0 + b * (len + gap), y0 + hgt / 2 + t * (hgt + 0.02), z0 + r * (wid + 0.06))
            d.updateMatrix()
            if (!byColor.has(c)) byColor.set(c, [])
            byColor.get(c).push(d.matrix.clone())
        }
    }
    for (const [c, list] of byColor) {
        const im = new THREE.InstancedMesh(geo, mat(c, { rough: 0.7, metal: 0.3 }), list.length)
        list.forEach((m, i) => im.setMatrixAt(i, m))
        im.castShadow = true
        im.receiveShadow = true
        group.add(im)
    }
}
