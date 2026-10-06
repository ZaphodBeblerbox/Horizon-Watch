/**
 * aircraft.js — a four-engined freighter, a narrow-body airliner, a business
 * jet and a helicopter.
 *
 * The fuselage is lathed from a real profile (nose, constant section, tail
 * cone swept up), painted by height: white crown, a cheatline under the
 * windows, a grey belly. Wings, tailplanes and fins are lofted through
 * NACA four-digit sections with sweep, taper and dihedral. Engines are
 * lathed nacelles with an intake lip, a dark fan face and an exhaust cone.
 * Gear down: they stand on their wheels.
 */
import * as THREE from "three"
import { PAL, mat, mesh, cyl, sphere, rod, block, GLASS } from "./kit.js"

const paint = { white: 0xf2f4f6, belly: 0xb9c0c7, metal: 0x9aa3ab }

/** A patch of a body of revolution around X, lifted off it a little: windows
 *  that follow the curvature. r(x) is the radius at x; angles from the top
 *  (+Y) toward +Z; yOff(x) any upward sweep of the axis at x. */
function patch(r, x0, x1, a0, a1, material, { lift = 0.025, nx = 6, na = 6, yOff = () => 0, side = 1 } = {}) {
    const pos = [], idx = []
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= na; j++) {
        const x = x0 + ((x1 - x0) * i) / nx, a = a0 + ((a1 - a0) * j) / na, rr = r(x) + lift
        pos.push(x, yOff(x) + Math.cos(a) * rr, side * Math.sin(a) * rr)
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < na; j++) {
        const a = i * (na + 1) + j, b = a + na + 1
        side > 0 ? idx.push(a, b, a + 1, a + 1, b, b + 1) : idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return mesh(geo, material, { shadow: false })
}
const GLASS2 = () => mat(PAL.glass, { metal: 0.6, rough: 0.12, side: THREE.DoubleSide })

/** NACA 00xx-style section, closed polygon of [x, y] for chord 1. */
function airfoil(t = 0.12, n = 14, camber = 0.02) {
    const up = [], lo = []
    for (let i = 0; i <= n; i++) {
        const x = (1 - Math.cos((Math.PI * i) / n)) / 2           // cosine spacing: more points at the nose
        const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        const yc = camber * 4 * x * (1 - x)
        up.push([x, yc + yt]); lo.push([x, yc - yt])
    }
    return [...up, ...lo.slice(1, -1).reverse()]
}

/**
 * Loft a lifting surface through sections [{x, y, z, chord, t}] (x = leading
 * edge, chord along +x… we draw aircraft nose toward +X, so chord runs -X).
 * Closed at the root and the tip.
 */
function loft(sections, material, { vertical = false } = {}) {
    const prof = airfoil(0.12, 14, vertical ? 0 : 0.02)
    const P = prof.length
    const pos = [], idx = []
    sections.forEach((s) => {
        const t = s.t ?? 0.12
        for (const [px, py] of prof) {
            const cx = s.x - px * s.chord
            const cy = (py / 0.12) * t * s.chord
            if (vertical) pos.push(cx, s.y, s.z + cy)          // fin: thickness along z, span along y
            else pos.push(cx, s.y + cy, s.z)                    // wing: thickness along y, span along z
        }
    })
    for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < P; k++) {
        const a = i * P + k, b = i * P + ((k + 1) % P), c = (i + 1) * P + k, d = (i + 1) * P + ((k + 1) % P)
        idx.push(a, c, b, b, c, d)
    }
    // caps
    const capAt = (i, flip) => {
        const base = pos.length / 3
        let cx = 0, cy = 0, cz = 0
        for (let k = 0; k < P; k++) { cx += pos[(i * P + k) * 3]; cy += pos[(i * P + k) * 3 + 1]; cz += pos[(i * P + k) * 3 + 2] }
        pos.push(cx / P, cy / P, cz / P)
        for (let k = 0; k < P; k++) flip ? idx.push(base, i * P + ((k + 1) % P), i * P + k) : idx.push(base, i * P + k, i * P + ((k + 1) % P))
    }
    capAt(0, false); capAt(sections.length - 1, true)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return mesh(geo, material)
}

/** A wing pair: root at the fuselage, swept back, tapering, with dihedral and a winglet. */
function wings(g, { rootX, rootY, rootZ, span, rootChord, tipChord, sweep, dihedral, t = 0.13, winglet = 0, material }) {
    const m = material || mat(paint.white, { metal: 0.25, rough: 0.35 })
    for (const sgn of [1, -1]) {
        const secs = []
        for (const f of [0, 0.35, 1]) {
            const z = rootZ + f * (span / 2 - rootZ)
            secs.push({ x: rootX - Math.tan(sweep) * (z - rootZ), y: rootY + Math.tan(dihedral) * (z - rootZ), z: sgn * z,
                        chord: rootChord + (tipChord - rootChord) * f, t: t * (1 - 0.35 * f) })
        }
        if (winglet) {
            const tip = secs[secs.length - 1]
            secs.push({ x: tip.x - tipChord * 0.25, y: tip.y + winglet * 0.15, z: sgn * (Math.abs(tip.z) + winglet * 0.08), chord: tipChord * 0.8, t: 0.09 })
            g.add(loft([{ x: tip.x - tipChord * 0.2, y: tip.y, z: tip.z, chord: tipChord * 0.85 }, { x: tip.x - tipChord * 0.55, y: tip.y + winglet, z: tip.z + sgn * winglet * 0.18, chord: tipChord * 0.4 }], m, { vertical: true }))
        }
        g.add(loft(sgn > 0 ? secs : secs, m))
        // flap-track fairings under the trailing edge
        for (const f of [0.22, 0.42, 0.62]) {
            const z = rootZ + f * (span / 2 - rootZ), x = rootX - Math.tan(sweep) * (z - rootZ) - (rootChord + (tipChord - rootChord) * f) * 0.7
            const fair = new THREE.Mesh(new THREE.CapsuleGeometry(0.18 * rootChord / 6, rootChord * 0.4, 4, 10), m)
            fair.rotation.z = Math.PI / 2
            fair.position.set(x, rootY + Math.tan(dihedral) * (z - rootZ) - 0.25 * rootChord / 6, sgn * z)
            fair.castShadow = true
            g.add(fair)
        }
    }
}

/** The fuselage, nose toward +X, painted by height. tailUp: how far the tail cone sweeps up. */
function fuselage(g, { L, R, nose = 2.2, tail = 3.2, tailUp = 0.55, hump = 0, cheat = PAL.blue, windows = true, winSpacing = 0.53, winSize = 1, freighter = false }) {
    // radius along s (0 at the nose tip … L at the tail)
    const radius = (s) => {
        if (s < nose * R) return R * Math.sqrt(Math.max(0, 1 - Math.pow(1 - s / (nose * R), 2.2)))
        if (s > L - tail * R) return R * Math.max(0.06, 1 - Math.pow((s - (L - tail * R)) / (tail * R), 1.6) * 0.94)
        return R
    }
    const up = (s) => (s > L - tail * R ? R * tailUp * Math.pow((s - (L - tail * R)) / (tail * R), 2) : 0)
    // a 747's upper deck: rises behind the cockpit, runs flat, fades out
    const humpAt = (s) => {
        if (!hump) return 0
        const a = nose * R * 0.55, b = a + R * 1.4, c = hump - R * 3, d = hump
        if (s < a || s > d) return 0
        if (s < b) { const t = (s - a) / (b - a); return t * t * (3 - 2 * t) }
        if (s < c) return 1
        const t = (s - c) / (d - c); return 1 - t * t * (3 - 2 * t)
    }
    const pts = []
    for (let i = 0; i <= 96; i++) { const s = (i / 96) * L; pts.push(new THREE.Vector2(radius(s), s)) }
    const geo = new THREE.LatheGeometry(pts, 56)
    geo.rotateZ(-Math.PI / 2)                                // lathe axis Y → +X (s increases with x)
    const p = geo.attributes.position
    const col = new Float32Array(p.count * 3)
    const C = { crown: new THREE.Color(paint.white), cheat: new THREE.Color(cheat), belly: new THREE.Color(paint.belly) }
    for (let v = 0; v < p.count; v++) {
        const s = p.getX(v)
        let y = p.getY(v)
        const z = p.getZ(v)
        if (y > 0) y += R * 0.5 * humpAt(s) * Math.pow(y / Math.max(1e-6, radius(s)), 1.5)
        y += up(s)
        p.setXYZ(v, L / 2 - s, y, z)                          // nose toward +X
        const ny = (y - up(s)) / Math.max(1e-6, radius(s))
        const c = ny < -0.38 ? C.belly : ny < -0.1 && ny > -0.24 ? C.cheat : C.crown
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    g.add(mesh(geo, mat(0xffffff, { vertexColors: true, metal: 0.3, rough: 0.32 })))
    // the windscreen: four panes a side cut from the nose's own surface
    const rx = (x) => radius(L / 2 - x)
    const n0 = L / 2 - nose * R * 0.62, n1 = L / 2 - nose * R * 0.3
    for (const side of [1, -1]) {
        const panes = [[0.18, 0.5], [0.56, 0.86], [0.92, 1.16]]
        panes.forEach(([a0, a1], i) => {
            const x1 = n1 - i * R * 0.06, x0 = n0 - i * R * 0.14
            g.add(patch(rx, x0, x1, a0, a1, GLASS2(), { side, lift: 0.03 }))
        })
    }
    // cabin windows (none on a freighter's main deck)
    if (windows) {
        const wg = new THREE.CapsuleGeometry(R * 0.035 * winSize, R * 0.05 * winSize, 3, 8)
        const list = []
        const d = new THREE.Object3D()
        for (const sgn of [1, -1]) for (let x = L / 2 - nose * R * 1.35; x > -L / 2 + tail * R * 1.05; x -= winSpacing) {
            d.position.set(x, R * 0.08, sgn * R * 1.0)
            d.scale.set(1, 1, 0.25)
            d.updateMatrix()
            list.push(d.matrix.clone())
        }
        const im = new THREE.InstancedMesh(wg, GLASS(), list.length)
        list.forEach((m, i) => im.setMatrixAt(i, m))
        g.add(im)
    }
    if (hump) {                                                // upper-deck windows
        const wg = new THREE.CapsuleGeometry(R * 0.03, R * 0.04, 3, 8)
        const d = new THREE.Object3D(), list = []
        for (const sgn of [1, -1]) for (let s = nose * R * 1.4; s < hump - R * 3.2; s += 0.6) {
            d.position.set(L / 2 - s, R * 0.95, sgn * R * 0.62); d.rotation.set(sgn * 0.55, 0, 0); d.scale.set(1, 1, 0.25); d.updateMatrix(); list.push(d.matrix.clone())
        }
        const im = new THREE.InstancedMesh(wg, GLASS(), list.length)
        list.forEach((m, i) => im.setMatrixAt(i, m))
        g.add(im)
    }
    const door = mat(paint.belly, { metal: 0.3, rough: 0.4 })
    for (const sgn of [1, -1]) for (const x of [L / 2 - nose * R * 1.15, -L / 2 + tail * R * 1.15]) {
        g.add(block(R * 0.3, R * 0.62, 0.04, door, { x, y: -R * 0.22, z: sgn * R * 1.003 }))
    }
    if (freighter) g.add(block(R * 1.3, R * 0.75, 0.04, door, { x: -L * 0.18, y: -R * 0.05, z: -R * 1.004 }))   // side cargo door
}

/** A turbofan: nacelle with intake lip, fan face, exhaust cone; on a pylon to (wx, wy, wz). */
function engine(g, { x, y, z, len, dia, pylonTo, color = paint.white }) {
    const r = dia / 2
    const prof = [[r * 0.82, 0], [r * 0.98, len * 0.03], [r, len * 0.12], [r * 0.97, len * 0.55], [r * 0.78, len * 0.92], [r * 0.7, len]]
    const geo = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 36)
    geo.rotateZ(Math.PI / 2)
    const n = mesh(geo, mat(color, { metal: 0.35, rough: 0.3, side: THREE.DoubleSide }), { x: x + len / 2, y, z })
    g.add(n)
    g.add(cyl(r * 0.8, r * 0.8, 0.05, mat(PAL.black, { metal: 0.5, rough: 0.3 }), { x: x + len / 2 - len * 0.06, y, z, axis: "x" }))   // fan face
    g.add(mesh(new THREE.ConeGeometry(r * 0.24, r * 0.5, 16).rotateZ(-Math.PI / 2), mat(PAL.darkgrey, { metal: 0.6 }), { x: x + len / 2 - len * 0.02, y, z }))   // spinner
    g.add(mesh(new THREE.ConeGeometry(r * 0.55, len * 0.35, 20).rotateZ(Math.PI / 2), mat(paint.metal, { metal: 0.7, rough: 0.35 }), { x: x - len / 2 - len * 0.12, y, z }))   // exhaust cone
    g.add(cyl(r * 0.71, r * 0.71, 0.04, mat(PAL.black), { x: x - len / 2 + 0.02, y, z, axis: "x" }))
    if (pylonTo) {
        const [px, py, pz] = pylonTo
        const pyl = new THREE.Shape()
        pyl.moveTo(-len * 0.42, 0); pyl.lineTo(len * 0.25, 0); pyl.lineTo(len * 0.05, py - y - r * 0.8); pyl.lineTo(-len * 0.6, py - y - r * 0.8); pyl.closePath()
        const pg = new THREE.ExtrudeGeometry(pyl, { depth: r * 0.22, bevelEnabled: false })
        pg.translate(0, 0, -r * 0.11)
        g.add(mesh(pg, mat(color, { metal: 0.35, rough: 0.3 }), { x: px - len * 0.05, y: y + r * 0.8, z: pz }))
    }
}

function gear(g, { x, z, h, wheels = 2, r = 0.55, spread = 0.7 }) {
    const strut = mat(paint.metal, { metal: 0.7, rough: 0.35 })
    g.add(rod([x, h, z], [x, r, z], r * 0.18, strut))
    for (let i = 0; i < wheels; i++) {
        const dz = (i - (wheels - 1) / 2) * spread
        const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, r * 0.3, 10, 24), mat(PAL.black, { rough: 0.9 }))
        tyre.position.set(x, r, z + dz); tyre.castShadow = true
        g.add(tyre)
        g.add(cyl(r * 0.45, r * 0.45, r * 0.5, mat(paint.metal, { metal: 0.6 }), { x, y: r, z: z + dz, axis: "z" }))
    }
}

function tail(g, { x, y, finH, finRoot, finTip, finSweep, stabSpan, stabRoot, stabTip, stabSweep, stabY, tColor, tTail = false }) {
    const fm = mat(tColor, { metal: 0.25, rough: 0.35 })
    g.add(loft([{ x, y, z: 0, chord: finRoot, t: 0.11 }, { x: x - Math.tan(finSweep) * finH, y: y + finH, z: 0, chord: finTip, t: 0.1 }], fm, { vertical: true }))
    const sy = tTail ? y + finH * 0.97 : stabY
    const sx = tTail ? x - Math.tan(finSweep) * finH : x + finRoot * 0.05
    const sm = tTail ? fm : mat(paint.white, { metal: 0.25, rough: 0.35 })
    for (const sgn of [1, -1]) {
        g.add(loft([{ x: sx, y: sy, z: 0, chord: stabRoot, t: 0.1 }, { x: sx - Math.tan(stabSweep) * stabSpan / 2, y: sy + stabSpan * 0.04, z: sgn * stabSpan / 2, chord: stabTip, t: 0.09 }], sm))
    }
}

export function airliner() {
    const g = new THREE.Group()
    const L = 37.6, R = 1.98, gearH = 2.1
    const lift = (o) => { o.position.y += gearH + R; return o }
    const body = new THREE.Group()
    fuselage(body, { L, R, cheat: PAL.blue, nose: 1.9, tail: 3.6 })
    wings(body, { rootX: 3.2, rootY: -R * 0.55, rootZ: R * 0.85, span: 35.8, rootChord: 6.3, tipChord: 1.5, sweep: 0.44, dihedral: 0.09, winglet: 2.4 })
    for (const sgn of [1, -1]) engine(body, { x: 6.3, y: -R * 1.3, z: sgn * 5.8, len: 4.6, dia: 2.1, pylonTo: [4.6, -R * 0.55, sgn * 5.8] })
    tail(body, { x: -L / 2 + 6.4, y: R * 0.75, finH: 6.0, finRoot: 5.6, finTip: 2.2, finSweep: 0.62, stabSpan: 12.5, stabRoot: 3.6, stabTip: 1.4, stabSweep: 0.55, stabY: R * 0.35, tColor: PAL.blue })
    g.add(lift(body))
    // gear: nose, and two mains under the wing roots
    gear(g, { x: L / 2 - 5.3, z: 0, h: gearH + 0.4, wheels: 2, r: 0.38, spread: 0.6 })
    for (const sgn of [1, -1]) gear(g, { x: -0.5, z: sgn * 3.8, h: gearH + R * 0.4, wheels: 2, r: 0.58, spread: 0.9 })
    return { group: g, setting: "land" }
}

export function freighter() {
    const g = new THREE.Group()
    const L = 76.3, R = 3.25, gearH = 3.4
    const body = new THREE.Group()
    fuselage(body, { L, R, cheat: PAL.orange, nose: 2.0, tail: 3.8, hump: 26, windows: false, freighter: true })
    // a few windows on the upper deck only
    wings(body, { rootX: 6, rootY: -R * 0.5, rootZ: R * 0.85, span: 68.4, rootChord: 13, tipChord: 3.2, sweep: 0.62, dihedral: 0.1, t: 0.12, winglet: 0 })
    for (const sgn of [1, -1]) for (const [ez, ex] of [[11.5, 8.5], [21.5, 1.8]]) {
        engine(body, { x: ex, y: -R * 1.05 + ez * 0.06, z: sgn * ez, len: 7.4, dia: 3.4, pylonTo: [ex - 2, -R * 0.45 + ez * 0.09, sgn * ez] })
    }
    tail(body, { x: -L / 2 + 12.5, y: R * 0.7, finH: 12.5, finRoot: 11, finTip: 4.2, finSweep: 0.7, stabSpan: 22, stabRoot: 7.5, stabTip: 2.6, stabSweep: 0.62, stabY: R * 0.3, tColor: PAL.orange })
    body.position.y = gearH + R
    g.add(body)
    gear(g, { x: L / 2 - 8, z: 0, h: gearH + 0.6, wheels: 2, r: 0.6, spread: 0.9 })
    for (const sgn of [1, -1]) for (const [x, z] of [[0, 3.6], [-3.2, 6.2]]) gear(g, { x, z: sgn * z, h: gearH + R * 0.5, wheels: 2, r: 0.62, spread: 1.0 })
    return { group: g, setting: "land" }
}

export function bizjet() {
    const g = new THREE.Group()
    const L = 30.4, R = 1.3, gearH = 1.35
    const body = new THREE.Group()
    fuselage(body, { L, R, cheat: PAL.darkgrey, nose: 2.6, tail: 4.2, tailUp: 0.35, winSpacing: 1.25, winSize: 2.2 })
    wings(body, { rootX: 2.2, rootY: -R * 0.6, rootZ: R * 0.8, span: 30.4, rootChord: 4.6, tipChord: 1.1, sweep: 0.56, dihedral: 0.06, winglet: 1.6 })
    // the engines sit high on the rear fuselage
    for (const sgn of [1, -1]) {
        engine(body, { x: -L / 2 + 8.2, y: R * 0.55, z: sgn * (R + 1.0), len: 4.2, dia: 1.45 })
        body.add(block(1.6, 0.25, 1.0, mat(paint.white, { metal: 0.3, rough: 0.3 }), { x: -L / 2 + 8.2, y: R * 0.45, z: sgn * (R + 0.4) }))
    }
    tail(body, { x: -L / 2 + 5.6, y: R * 0.8, finH: 4.4, finRoot: 4.6, finTip: 2.6, finSweep: 0.75, stabSpan: 10.5, stabRoot: 2.5, stabTip: 1.2, stabSweep: 0.55, stabY: 0, tColor: PAL.darkgrey, tTail: true })
    // the business jet's oval windows: larger, fewer
    body.position.y = gearH + R
    g.add(body)
    gear(g, { x: L / 2 - 4.5, z: 0, h: gearH + 0.3, wheels: 2, r: 0.28, spread: 0.4 })
    for (const sgn of [1, -1]) gear(g, { x: -0.4, z: sgn * 2.2, h: gearH + R * 0.4, wheels: 2, r: 0.38, spread: 0.5 })
    return { group: g, setting: "land" }
}

export function helicopter() {
    const g = new THREE.Group()
    const skin = mat(PAL.red, { metal: 0.25, rough: 0.35 })
    const dark = mat(PAL.darkgrey, { metal: 0.4, rough: 0.4 })
    // the cabin pod: a lathed teardrop, nose toward +X; the canopy is a
    // glazed patch of its own front and top, so it follows the shape
    const prof = (s) => { // s 0 nose … 4.5 tail end; radius
        if (s < 1.6) return 1.12 * Math.sqrt(Math.max(0, 1 - Math.pow(1 - s / 1.6, 2)))
        if (s < 2.8) return 1.12
        return 1.12 * Math.max(0.3, 1 - Math.pow((s - 2.8) / 1.7, 1.4) * 0.7)
    }
    const pp = []
    for (let i = 0; i <= 48; i++) { const s = (i / 48) * 4.5; pp.push(new THREE.Vector2(prof(s), s)) }
    const pg = new THREE.LatheGeometry(pp, 40)
    pg.rotateZ(-Math.PI / 2)
    const pa = pg.attributes.position
    for (let v = 0; v < pa.count; v++) pa.setX(v, 4.5 - pa.getX(v))
    pg.scale(1.45, 1.15, 1.0)
    pg.computeVertexNormals()
    g.add(mesh(pg, skin, { x: -2.6 + 0.0, y: 1.8 }))
    const r = (x) => prof(4.5 - (x + 2.6) / 1.45) * 1.0
    for (const side of [1, -1]) {
        const cp = patch((x) => r(x) * 1.0, 1.1, 3.75, 0.05, 1.45, GLASS2(), { side, lift: 0.04, nx: 12, na: 10, yOff: () => 1.8 })
        cp.scale.y = 1.15
        cp.position.y = 1.8 - 1.8 * 1.15
        g.add(cp)
    }
    // side windows in the cabin doors
    for (const sgn of [1, -1]) {
        g.add(block(1.2, 0.75, 0.05, GLASS(), { x: 0.2, y: 2.15, z: sgn * 1.13 }))
        g.add(block(0.9, 0.7, 0.05, GLASS(), { x: -1.1, y: 2.2, z: sgn * 1.08 }))
    }
    // the engine cowling on top, and the mast
    g.add(mesh(new THREE.CapsuleGeometry(0.7, 2.4, 6, 16).rotateZ(Math.PI / 2), skin, { x: -0.4, y: 3.2 }))
    g.add(cyl(0.18, 0.22, 0.8, dark, { x: 0.2, y: 3.9 }))
    // tail boom, fin, the fenestron and the stabiliser
    g.add(cyl(0.22, 0.48, 6.4, skin, { x: -4.6, y: 2.45, axis: "x", rz: 0.04 }))
    const fin = new THREE.Shape()
    fin.moveTo(0, 0); fin.lineTo(1.6, 0); fin.lineTo(0.6, 2.0); fin.lineTo(-0.5, 2.0); fin.closePath()
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 })
    fg.translate(0, 0, -0.09)
    g.add(mesh(fg, skin, { x: -8.6, y: 2.4 }))
    g.add(mesh(new THREE.TorusGeometry(0.62, 0.2, 10, 28), skin, { x: -7.8, y: 2.9 }))
    g.add(block(1.0, 0.1, 3.0, skin, { x: -6.9, y: 2.4 }))
    // the skids
    const sk = mat(PAL.darkgrey, { metal: 0.6, rough: 0.35 })
    for (const sgn of [1, -1]) {
        g.add(rod([-1.8, 0.12, sgn * 1.25], [3.6, 0.12, sgn * 1.25], 0.09, sk))
        g.add(rod([3.6, 0.12, sgn * 1.25], [4.1, 0.45, sgn * 1.25], 0.09, sk))
        for (const x of [-0.8, 2.4]) g.add(rod([x, 0.12, sgn * 1.25], [x + 0.1, 1.35, sgn * 0.7], 0.08, sk))
    }
    // the rotors turn
    const rotor = new THREE.Group()
    rotor.position.set(0.2, 4.35, 0)
    rotor.add(cyl(0.32, 0.32, 0.25, dark))
    for (let i = 0; i < 4; i++) {
        const b = block(5.4, 0.06, 0.32, dark, { x: 2.75 })
        const arm = new THREE.Group(); arm.add(b); arm.rotation.y = (i * Math.PI) / 2
        rotor.add(arm)
    }
    rotor.userData.tick = (t) => { rotor.rotation.y = t * 1.6 }
    g.add(rotor)
    const tr = new THREE.Group()
    tr.position.set(-7.8, 2.9, 0)
    for (let i = 0; i < 8; i++) { const b = block(0.5, 0.05, 0.12, dark, { x: 0.25 }); const a = new THREE.Group(); a.add(b); a.rotation.z = (i * Math.PI) / 4; tr.add(a) }
    tr.userData.tick = (t) => { tr.rotation.z = t * 6 }
    g.add(tr)
    return { group: g, setting: "land" }
}

void sphere
