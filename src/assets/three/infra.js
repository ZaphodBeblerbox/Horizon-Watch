/**
 * infra.js — infrastructure: what the infrastructure layer shows and what
 * can be registered as one of our assets. A telecom mast, a wind turbine
 * and a wind farm, a solar farm, a hydro dam, a nuclear plant, a lattice
 * transmission pylon carrying its line, a subsea cable cut open on the
 * seabed, a tank farm, a data centre, a pipeline with its valve station,
 * and a pumpjack nodding over its well.
 *
 * Same kit and look as the asset models (kit.js, sites.js): metres, up is
 * +Y, sites on a plinth of their own ground; moving parts are ticked by
 * the stage (userData.tick).
 */
import * as THREE from "three"
import { PAL, mat, mesh, block, rblock, cyl, sphere, rod, lathe, windows, lattice, GLASS, LIT } from "./kit.js"
import { plinth, tree, cloudTexture } from "./sites.js"
import { truck } from "./vehicles.js"

const steel = () => mat(PAL.steel, { metal: 0.6, rough: 0.42 })
const galv = () => mat(0x9aa3a8, { metal: 0.7, rough: 0.38 })
const white = () => mat(PAL.white, { rough: 0.45 })
const grass = 0x6d8a5a
const gravel = 0xa3a097
const sand = 0xc2b08a

/** A chain-link fence round a rectangle: posts and a faint mesh. */
function fence(g, x0, z0, x1, z1, { h = 2.4, step = 3 } = {}) {
    const post = mat(PAL.grey, { metal: 0.6 })
    const net = mat(0x9aa3ab, { opacity: 0.35, metal: 0.5, side: THREE.DoubleSide })
    const sides = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]
    for (const [ax, az, bx, bz] of sides) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step))
        for (let i = 0; i <= n; i++) g.add(rod([ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n], [ax + ((bx - ax) * i) / n, h, az + ((bz - az) * i) / n], 0.05, post, 6))
        g.add(mesh(new THREE.PlaneGeometry(len, h * 0.92), net, { x: (ax + bx) / 2, y: h * 0.48, z: (az + bz) / 2, ry: -Math.atan2(bz - az, bx - ax) }))
    }
}

/** A warning light that blinks (aviation red on masts and turbines). */
function beacon(g, x, y, z, r = 0.35, period = 1.6) {
    const on = mat(0xff3020, { emissive: 0xff2010, emissiveIntensity: 1.4 })
    const b = sphere(r, on, { x, y, z }, 12)
    b.userData.tick = (t) => { b.visible = (t % period) < period * 0.45 }
    g.add(b)
}

// ── telecom mast ─────────────────────────────────────────────────────────────

export function telecomMast() {
    const g = new THREE.Group()
    plinth(g, 34, 34, gravel)
    const H = 54
    // the lattice in painted sections: grey below, red and white for aviation near the top
    const secs = [[0, 30, galv()], [30, 36, mat(0xc23a2e, { metal: 0.4, rough: 0.5 })], [36, 42, white()], [42, 48, mat(0xc23a2e, { metal: 0.4, rough: 0.5 })], [48, H, white()]]
    const wAt = (y) => 6.4 - (6.4 - 1.5) * (y / H)
    for (const [y0, y1, m] of secs) lattice(g, { y0, y1, w0: wAt(y0), w1: wAt(y1), levels: Math.max(1, Math.round((y1 - y0) / 4)), r: 0.09, material: m })
    // cable ladder up one face, and the feeder cables running down it
    g.add(rod([wAt(0) / 2 - 0.3, 0.5, 0], [wAt(H) / 2 - 0.2, H - 1, 0], 0.08, mat(PAL.darkgrey)))
    for (let k = 0; k < 4; k++) g.add(rod([wAt(0) / 2 - 0.5, 0.5, -0.4 + k * 0.25], [wAt(44) / 2 - 0.4, 44, -0.4 + k * 0.25], 0.05, mat(PAL.black, { rough: 0.6 }), 6))
    // two platforms with three sectors of panel antennas each, 120° apart
    for (const [py, n] of [[44, 3], [50, 3]]) {
        const r = wAt(py) / 2 + 1.4
        g.add(mesh(new THREE.TorusGeometry(r, 0.09, 6, 36), galv(), { y: py, rx: Math.PI / 2 }))
        g.add(mesh(new THREE.CylinderGeometry(r, r, 0.12, 36, 1, true), mat(0x7f878d, { metal: 0.6, opacity: 0.6, side: THREE.DoubleSide }), { y: py - 0.4 }))
        for (let s = 0; s < n; s++) {
            const a = (s / n) * Math.PI * 2 + (py === 50 ? 0.5 : 0)
            for (const da of [-0.22, 0, 0.22]) {
                const ax = Math.cos(a + da) * r, az = Math.sin(a + da) * r
                g.add(rblock(0.35, 2.6, 0.75, 0.12, mat(0xe9ebec, { rough: 0.4 }), { x: ax, y: py - 0.9, z: az, ry: -(a + da) }))
                g.add(block(0.25, 0.4, 0.25, mat(PAL.darkgrey), { x: ax * 0.92, y: py - 1.2, z: az * 0.92 }))   // the radio unit behind it
            }
        }
    }
    // microwave dishes: drum radomes on short mounts
    for (const [y, a, R] of [[38, 0.8, 0.9], [40, 2.6, 1.2], [34, 4.4, 0.7]]) {
        const d = wAt(y) / 2 + 0.6, x = Math.cos(a) * d, z = Math.sin(a) * d
        const dish = new THREE.Group()
        dish.add(cyl(R, R, 0.7, mat(0xdcdedf, { rough: 0.5 }), { axis: "x" }, 32))
        dish.add(cyl(R * 0.98, R * 0.98, 0.05, mat(0xb9bcbe), { x: 0.37, axis: "x" }, 32))
        dish.position.set(x, y, z); dish.rotation.y = -a
        g.add(dish)
    }
    // the lightning rod and the beacon at the top
    g.add(rod([0, H, 0], [0, H + 4, 0], 0.07, galv()))
    beacon(g, 0, H + 0.4, 0, 0.32)
    beacon(g, 0, 36.2, wAt(36) / 2 + 0.1, 0.25, 1.9)
    // at the foot: the equipment shelter and outdoor cabinets inside the fence
    g.add(rblock(6, 3, 3.6, 0.2, mat(0xd6d4cc, { rough: 0.7 }), { x: -9, z: 8 }))
    g.add(block(1.2, 1.8, 0.8, mat(0xa9b0a8), { x: 7, z: 9 }))
    g.add(block(1.2, 1.8, 0.8, mat(0xa9b0a8), { x: 8.6, z: 9 }))
    g.add(block(1.0, 0.6, 1.0, mat(PAL.darkgrey), { x: -9, y: 3, z: 8 }))   // air conditioner on the roof
    g.add(rod([-6, 2.4, 8], [-2.5, 2.4, 2], 0.18, mat(PAL.darkgrey)))       // cable bridge to the mast
    fence(g, -14, -14, 14, 14)
    return { group: g, setting: "land", view: { azimuth: 0.62, elevation: 0.28 } }
}

// ── wind ─────────────────────────────────────────────────────────────────────

/** One blade, lofted: a rounded root that flattens into a twisted, tapering airfoil. */
function blade(len) {
    const N = 22, M = 14
    const pos = [], idx = []
    for (let i = 0; i <= N; i++) {
        const t = i / N, r = t * len
        const chord = t < 0.18 ? 1.6 + (3.6 - 1.6) * (t / 0.18) : 3.6 * Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 0.9) * 0.88 + 0.35
        const thick = t < 0.1 ? 1.5 : Math.max(0.12, chord * (0.32 - 0.22 * t))
        const roundness = t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.12)
        const twist = (1 - t) * 0.32
        for (let k = 0; k < M; k++) {
            const a = (k / M) * Math.PI * 2
            // an airfoil: blunt nose, thin tail; at the root a circle
            const ex = Math.cos(a), ey = Math.sin(a)
            const foilX = ex * chord * 0.5 + (ex > 0 ? 0 : ex * chord * 0.08)
            const foilY = ey * thick * 0.5 * (ex > 0 ? 1 - ex * 0.65 : 1)
            const cx = roundness * ex * 0.9 + (1 - roundness) * foilX
            const cy = roundness * ey * 0.9 + (1 - roundness) * foilY
            const x = cx * Math.cos(twist) - cy * Math.sin(twist), z = cx * Math.sin(twist) + cy * Math.cos(twist)
            pos.push(x, r, z)
        }
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) {
        const a = i * M + k, b = i * M + ((k + 1) % M), c = (i + 1) * M + k, d = (i + 1) * M + ((k + 1) % M)
        idx.push(a, c, b, b, c, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
}

/** A 3-bladed turbine, hub at y = hub; the rotor turns (phase offsets it). */
function turbineAt(g, x, z, { hub = 82, rotor = 52, phase = 0, yaw = 0, speed = 0.55 } = {}) {
    const t = new THREE.Group()
    const shell = mat(0xf1f2f3, { rough: 0.35, metal: 0.05 })
    // tubular tower in sections, with a door at the foot and the foundation ring
    const prof = []
    for (let i = 0; i <= 12; i++) { const y = (hub - 2) * i / 12; prof.push([2.25 - 0.95 * (i / 12), y]) }
    t.add(lathe(prof, shell, {}, 40))
    for (const y of [hub * 0.33, hub * 0.66]) t.add(mesh(new THREE.TorusGeometry(2.25 - 0.95 * (y / hub) + 0.02, 0.05, 6, 40), mat(0xd9dbdd), { y, rx: Math.PI / 2 }))
    t.add(cyl(7, 7.4, 1.0, mat(PAL.concrete, { rough: 0.9 }), { y: 0.3 }, 40))
    t.add(block(0.9, 2.2, 0.2, mat(0xc8cbcd), { x: 2.2, y: 0.8, z: 0, ry: 0 }))
    t.add(block(1.6, 0.15, 1.6, galv(), { x: 2.9, y: 0.75 }))
    // the nacelle: a long rounded box with a cooler on top and a little anemometer mast
    const head = new THREE.Group()
    head.add(rblock(12, 4, 4.2, 0.9, shell, { x: -3.2, y: -2 }))
    head.add(block(2.4, 0.8, 2.6, mat(0xdfe1e3), { x: -7.2, y: 2.1 }))
    head.add(rod([-6, 2, 0], [-6, 4.2, 0], 0.05, galv(), 6)); head.add(rod([-6.3, 4.2, 0], [-5.7, 4.2, 0], 0.03, galv(), 6))
    head.add(block(1.4, 0.15, 0.6, mat(0x8fa0aa), { x: -9, y: 2.0 }))
    beacon(head, -8.4, 2.6, 0.9, 0.18, 2.0); beacon(head, -8.4, 2.6, -0.9, 0.18, 2.0)
    // the rotor: spinner and three blades, turning about the nacelle's axis (+X)
    const rot = new THREE.Group()
    const spin = lathe([[0, 2.6], [0.8, 2.4], [1.45, 1.6], [1.75, 0.6], [1.8, 0]], shell, { rz: -Math.PI / 2 }, 32)
    rot.add(spin)
    const bg = blade(rotor)
    for (let b = 0; b < 3; b++) {
        const bl = mesh(bg, shell)
        bl.rotation.x = (b / 3) * Math.PI * 2
        bl.position.x = 0.4
        rot.add(bl)
        // red tip bands
        const tip = mesh(new THREE.CylinderGeometry(0.36, 0.42, rotor * 0.06, 10), mat(0xc23a2e, { rough: 0.5 }), {})
        tip.position.set(0.4, Math.cos((b / 3) * Math.PI * 2) * rotor * 0.92, Math.sin((b / 3) * Math.PI * 2) * rotor * 0.92)
        tip.rotation.x = (b / 3) * Math.PI * 2
        rot.add(tip)
    }
    rot.position.set(3, 0, 0)
    rot.rotation.x = phase
    rot.userData.tick = (s) => { rot.rotation.x = phase + s * speed }
    head.add(rot)
    head.position.y = hub
    head.rotation.y = yaw
    t.add(head)
    t.position.set(x, 0, z)
    g.add(t)
    return t
}

export function windTurbine() {
    const g = new THREE.Group()
    plinth(g, 70, 70, grass)
    g.add(block(60, 0.05, 6, mat(gravel, { rough: 1 }), { x: 6, y: 0.01, z: 14 }))         // the access track
    g.add(block(16, 0.05, 14, mat(gravel, { rough: 1 }), { x: 0, y: 0.01, z: 0 }))         // the crane pad
    turbineAt(g, 0, 0, { hub: 82, rotor: 52, phase: 0.4, yaw: 0.35 })
    g.add(rblock(3, 2.6, 2.4, 0.2, mat(0xd6d4cc), { x: 14, z: 10 }))                       // the transformer kiosk
    tree(g, -26, 22, 1.4); tree(g, -22, 27, 1.1)
    return { group: g, setting: "land", view: { azimuth: 0.85, elevation: 0.2 } }
}

export function windFarm() {
    const g = new THREE.Group()
    plinth(g, 560, 380, grass)
    // fields in two tones, tracks between the turbines, the farm's substation
    for (const [x, z, w, d, c] of [[-150, -80, 220, 160, 0x7d9a5e], [120, 90, 260, 170, 0x88a265], [130, -110, 240, 120, 0x9aa96a]]) g.add(block(w, 0.04, d, mat(c, { rough: 1 }), { x, y: 0.02, z }))
    const spots = [[-180, -60], [-60, -100], [60, -40], [180, -90], [-120, 90], [10, 110], [150, 120]]
    spots.forEach(([x, z], i) => turbineAt(g, x, z, { hub: 90, rotor: 58, phase: i * 0.9, yaw: 0.35 + i * 0.03, speed: 0.48 + (i % 3) * 0.04 }))
    for (let i = 0; i < spots.length - 1; i++) {
        const [ax, az] = spots[i], [bx, bz] = spots[i + 1]
        const len = Math.hypot(bx - ax, bz - az)
        g.add(mesh(new THREE.BoxGeometry(len, 0.05, 5), mat(gravel, { rough: 1 }), { x: (ax + bx) / 2, y: 0.05, z: (az + bz) / 2, ry: -Math.atan2(bz - az, bx - ax) }))
    }
    g.add(block(30, 0.06, 22, mat(gravel), { x: 230, y: 0.03, z: 20 }))
    g.add(block(9, 5, 5, mat(0x5d6b58, { metal: 0.3 }), { x: 226, z: 18 }))
    g.add(block(10, 4, 6, mat(PAL.offwhite), { x: 238, z: 26 }))
    lattice(g, { x: 236, z: 10, y0: 0, y1: 16, w0: 3, w1: 1.4, levels: 4, r: 0.12, material: galv() })
    for (let i = 0; i < 14; i++) tree(g, -260 + i * 9 + (i % 3) * 3, 170 - (i % 2) * 6, 2.2)
    return { group: g, setting: "land", view: { azimuth: 0.6, elevation: 0.32 } }
}

// ── solar ────────────────────────────────────────────────────────────────────

let _pv = null
/** The look of a PV module field: dark blue cells on a white grid. */
function pvTexture() {
    if (_pv) return _pv
    const c = document.createElement("canvas")
    c.width = 256; c.height = 64
    const x = c.getContext("2d")
    x.fillStyle = "#8e98a3"; x.fillRect(0, 0, 256, 64)
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        x.fillStyle = (i + j) % 7 === 0 ? "#1d3557" : "#16294a"
        x.fillRect(i * 16 + 1, j * 16 + 1, 14, 14)
    }
    _pv = new THREE.CanvasTexture(c)
    _pv.colorSpace = THREE.SRGBColorSpace
    _pv.wrapS = _pv.wrapT = THREE.RepeatWrapping
    _pv.anisotropy = 4
    return _pv
}

export function solarFarm() {
    const g = new THREE.Group()
    plinth(g, 150, 104, grass)
    const tex = pvTexture()
    const rowL = 120, rowD = 5.2, tilt = 0.44
    const panel = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.15, roughness: 0.32 })
    panel.map.repeat.set(rowL / 8, 1)
    const frame = galv()
    for (let r = 0; r < 12; r++) {
        const z = -42 + r * 7.4
        const row = new THREE.Group()
        row.add(mesh(new THREE.BoxGeometry(rowL, 0.06, rowD), panel, { rx: tilt }))
        row.add(mesh(new THREE.BoxGeometry(rowL, 0.12, rowD + 0.1), mat(0x9aa1a8, { metal: 0.6 }), { y: -0.07, rx: tilt }))
        row.position.set(-6, 1.7, z)
        g.add(row)
        for (let x = -6 - rowL / 2 + 3; x < -6 + rowL / 2; x += 6) {
            g.add(rod([x, 0, z - 1.0], [x, 1.7 - Math.sin(tilt) * 1.1, z - 1.0], 0.06, frame, 6))
            g.add(rod([x, 0, z + 1.0], [x, 1.7 + Math.sin(tilt) * 1.1, z + 1.0], 0.06, frame, 6))
        }
    }
    // inverter stations, the farm substation, a track and the fence
    for (const z of [-30, 0, 30]) { g.add(rblock(6, 2.6, 2.4, 0.15, white(), { x: 60, z })); g.add(block(1.8, 1.4, 1.2, mat(PAL.darkgrey), { x: 64.5, z })) }
    g.add(block(150, 0.05, 6, mat(gravel), { x: 0, y: 0.02, z: 49 }))
    g.add(block(12, 4, 7, mat(0x5d6b58, { metal: 0.3 }), { x: 66, z: 44 }))
    fence(g, -72, -50, 72, 47, { step: 6 })
    return { group: g, setting: "land", view: { azimuth: 0.95, elevation: 0.42 } }
}

// ── hydro ────────────────────────────────────────────────────────────────────

export function hydroDam() {
    const g = new THREE.Group()
    const W = 260, Dp = 200, H = 64, damX = -10
    // the terrain: a slab whose top is a valley — a river gorge along X with
    // steep sides, wider upstream where the reservoir fills it
    const floor = (x) => (x < damX ? 4 : 0)
    const halfGorge = (x) => (x < damX ? 34 + Math.max(0, damX - x) * 0.32 : 16 + Math.max(0, x - damX) * 0.05)
    const height = (x, z) => {
        const w = halfGorge(x), d = Math.abs(z)
        const t = Math.min(1, Math.max(0, (d - w * 0.5) / (w * 1.3)))
        const ease = t * t * (3 - 2 * t)
        const bumps = Math.sin(x * 0.07 + z * 0.05) * 3 + Math.cos(x * 0.11 - z * 0.09) * 2.4 + Math.sin(z * 0.21) * 1.2
        return floor(x) + ease * (H + 6) + (ease > 0.05 ? bumps * ease : 0)
    }
    const NX = 120, NZ = 96
    const geo = new THREE.PlaneGeometry(W, Dp, NX, NZ)
    geo.rotateX(-Math.PI / 2)
    const p = geo.attributes.position
    const col = new Float32Array(p.count * 3)
    const low = new THREE.Color(0x58783f), mid = new THREE.Color(0x6f7a4e), high = new THREE.Color(0x8f8a7c), c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), y = height(x, z)
        p.setY(i, y)
        const k = Math.min(1, y / (H + 6))
        if (k < 0.55) c.copy(low).lerp(mid, k / 0.55); else c.copy(mid).lerp(high, (k - 0.55) / 0.45)
        col.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    g.add(mesh(geo, mat(0xffffff, { vertexColors: true, rough: 0.95 })))
    // the slab's edges, so it reads as a cut model of the valley
    const edge = mat(0x3a3328, { rough: 1 })
    for (const sz of [1, -1]) {
        const sh = new THREE.Shape()
        sh.moveTo(-W / 2, -6)
        for (let i = 0; i <= NX; i++) { const x = -W / 2 + (W * i) / NX; sh.lineTo(x, height(x, sz * Dp / 2)) }
        sh.lineTo(W / 2, -6); sh.closePath()
        const eg = new THREE.ShapeGeometry(sh)
        g.add(mesh(eg, edge, { z: sz * Dp / 2, ry: sz > 0 ? 0 : Math.PI, sx: sz > 0 ? 1 : -1 }))
    }
    for (const sx of [1, -1]) {
        const sh = new THREE.Shape()
        sh.moveTo(-Dp / 2, -6)
        for (let i = 0; i <= NZ; i++) { const z = -Dp / 2 + (Dp * i) / NZ; sh.lineTo(z, height(sx * W / 2, z)) }
        sh.lineTo(Dp / 2, -6); sh.closePath()
        g.add(mesh(new THREE.ShapeGeometry(sh), edge, { x: sx * W / 2, ry: sx > 0 ? -Math.PI / 2 : Math.PI / 2, sx: sx > 0 ? 1 : -1 }))
    }
    // the reservoir: water at crest level upstream, wherever the land is lower
    const lakeY = H - 4
    const lake = new THREE.PlaneGeometry(W / 2 + damX - 2, Dp - 2)
    lake.rotateX(-Math.PI / 2)
    g.add(mesh(lake, mat(0x2b5a78, { metal: 0.25, rough: 0.1 }), { x: -W / 4 + damX / 2 - 1, y: lakeY }))
    // the river leaving the foot of the dam
    const river = new THREE.PlaneGeometry(W / 2 - damX - 4, 18)
    river.rotateX(-Math.PI / 2)
    g.add(mesh(river, mat(0x3a6c88, { metal: 0.25, rough: 0.12 }), { x: W / 4 + damX / 2 + 2, y: 1.2 }))
    // the arch: curved concrete, thick at the foot, bowed upstream into the lake
    const R = 60, span = 1.1
    const prof = [[0, 0], [10, 0], [3.4, H], [0, H]]
    const arch = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(R + x, y)), 64, -span / 2, span)
    const wall = new THREE.Group()
    wall.add(mesh(arch, mat(0xcfccc2, { rough: 0.85, side: THREE.DoubleSide })))
    for (let k = 0; k <= 16; k++) {                       // crest parapet posts
        const a = -span / 2 + (span * k) / 16
        wall.add(rod([Math.sin(a) * (R + 3.2), H, Math.cos(a) * (R + 3.2)], [Math.sin(a) * (R + 3.2), H + 1.3, Math.cos(a) * (R + 3.2)], 0.15, galv(), 6))
    }
    for (let k = 1; k < 8; k++) {                         // block joints down the face
        const a = -span / 2 + (span * k) / 8
        wall.add(rod([Math.sin(a) * (R + 10.05), 0, Math.cos(a) * (R + 10.05)], [Math.sin(a) * (R + 3.45), H, Math.cos(a) * (R + 3.45)], 0.12, mat(0xb5b2a8), 4))
    }
    wall.rotation.y = Math.PI / 2
    wall.position.set(damX - R, 0, 0)
    g.add(wall)
    // spillway chute down the face, with white water at its foot
    for (let i = 0; i < 7; i++) g.add(sphere(4 - i * 0.2, mat(0xeef3f6, { opacity: 0.55 }), { x: damX + 2 + i * 1.3, y: H - 4 - i * 9, z: 0 }, 12))
    for (let i = 0; i < 6; i++) g.add(sphere(5, mat(0xf4f7f9, { opacity: 0.4 }), { x: damX + 16 + i * 5, y: 2, z: (i % 2 ? 4 : -4) }, 12))
    // the powerhouse at the foot, its penstocks, the outgoing line
    g.add(block(26, 14, 18, mat(0x9aa0a2, { metal: 0.2 }), { x: damX + 26, y: 0, z: 22 }))
    windows(g, { cx: damX + 26, cz: 22, y0: 0, w: 26, h: 14, d: 18 }, { faces: ["+x", "-z"], rowH: 7, colW: 3, paneW: 2, paneH: 3, sill: 3, lit: 0.3 })
    for (const dz of [16, 22, 28]) g.add(rod([damX + 4, 44, dz * 0.6], [damX + 14, 6, dz], 1.3, mat(0x6f777e, { metal: 0.6 })))
    lattice(g, { x: damX + 48, z: 30, y0: height(damX + 48, 30), y1: height(damX + 48, 30) + 24, w0: 4, w1: 1.6, levels: 5, r: 0.12, material: galv() })
    // the crest road and a few trees on the slopes
    for (const [x, z] of [[60, -46], [70, -40], [80, 52], [96, -60], [40, 70], [110, 40]]) {
        const n = g.children.length
        tree(g, x, z, 2.4)
        for (const o of g.children.slice(n)) o.position.y += height(x, z)
    }
    return { group: g, setting: "land", view: { azimuth: 0.22, elevation: 0.5 } }
}

// ── nuclear ──────────────────────────────────────────────────────────────────

function coolingTower(g, x, z, TH = 150, R = 54) {
    const prof = []
    for (let i = 0; i <= 28; i++) { const y = (TH * i) / 28, t = y / TH; prof.push([R * Math.sqrt(0.34 + Math.pow((t - 0.74) / 0.74, 2) * 0.66), y]) }
    const conc = mat(0xbcb8ad, { rough: 0.9, side: THREE.DoubleSide })
    g.add(lathe(prof, conc, { x, z }, 72))
    for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; g.add(rod([x + Math.cos(a) * R * 0.98, 0, z + Math.sin(a) * R * 0.98], [x + Math.cos(a + 0.15) * R * 0.94, 9, z + Math.sin(a + 0.15) * R * 0.94], 0.8, conc, 6)) }
    const steam = new THREE.Group(), puffs = []
    for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.6, color: 0xf3f5f8 }))
        steam.add(sp); puffs.push(sp)
    }
    steam.position.set(x, TH - 4, z)
    steam.userData.tick = (t) => puffs.forEach((p, i) => {
        const f = ((t * 0.05 + i / puffs.length) % 1)
        p.position.set(f * 70 + Math.sin(i * 2.1) * 8, 10 + f * 90, f * 16 + Math.cos(i * 1.7) * 8)
        const sc = 60 + f * 90
        p.scale.set(sc, sc, 1)
        p.material.opacity = 0.66 * Math.min(1, f * 6) * (1 - f)
    })
    g.add(steam)
}

export function nuclearPlant() {
    const g = new THREE.Group()
    plinth(g, 440, 300, 0x8d8f86)
    coolingTower(g, -140, -60)
    coolingTower(g, -10, -80)
    // two reactor buildings: cylinder and dome, with the equipment hatch
    for (const x of [70, 150]) {
        g.add(cyl(24, 24, 46, mat(0xd2d0c8, { rough: 0.8 }), { x, y: 23, z: 40 }, 64))
        g.add(mesh(new THREE.SphereGeometry(24, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd9d7cf, { rough: 0.7 }), { x, y: 46, z: 40 }))
        g.add(cyl(4, 4, 2, mat(0x9aa0a2), { x: x - 24, y: 12, z: 40, axis: "x" }))
        for (let i = 1; i < 4; i++) g.add(mesh(new THREE.TorusGeometry(24.05, 0.18, 6, 64), mat(0xbdbbb3), { x, y: i * 11.5, z: 40, rx: Math.PI / 2 }))
    }
    // the turbine halls behind, the vent stack between, auxiliary blocks
    for (const x of [70, 150]) {
        g.add(block(60, 30, 34, mat(0x7b858f, { metal: 0.25 }), { x, z: 100 }))
        windows(g, { cx: x, cz: 100, y0: 0, w: 60, h: 30, d: 34 }, { faces: ["+z", "-x"], rowH: 10, colW: 4, paneW: 3, paneH: 5, sill: 4, lit: 0.25, band: true })
    }
    g.add(cyl(3.2, 4, 110, mat(PAL.offwhite), { x: 110, y: 55, z: 62 }))
    lattice(g, { x: 110, z: 62, y0: 0, y1: 100, w0: 16, w1: 6, levels: 10, r: 0.25, material: galv() })
    g.add(block(40, 18, 24, mat(0xa9a59c), { x: 110, z: 10 }))
    // the switchyard and the line leaving it
    g.add(block(90, 0.06, 50, mat(gravel), { x: 160, y: 0.03, z: -90 }))
    for (let i = 0; i < 4; i++) lattice(g, { x: 130 + i * 20, z: -90, y0: 0, y1: 20, w0: 3, w1: 1.6, levels: 4, r: 0.15, material: galv() })
    for (let i = 0; i < 3; i++) g.add(block(9, 7, 6, mat(0x5d6b58, { metal: 0.3 }), { x: 130 + i * 25, z: -66 }))
    // the security fence and the cooling water intake on the river
    fence(g, -210, -140, 210, 140, { h: 4, step: 12 })
    g.add(block(440, 0.3, 26, mat(0x3a6c88, { metal: 0.3, rough: 0.15 }), { x: 0, y: 0.04, z: 160 }))
    return { group: g, setting: "land", view: { azimuth: 0.5, elevation: 0.3 } }
}

// ── transmission ─────────────────────────────────────────────────────────────

/** A sagging conductor between two points (a catenary approximated). */
function conductor(g, a, b, sag, m, r = 0.06) {
    const N = 14
    let prev = a
    for (let i = 1; i <= N; i++) {
        const t = i / N
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]
        g.add(rod(prev, p, r, m, 5))
        prev = p
    }
}

/** A lattice transmission tower with two crossarms, insulators and the line both ways. */
function towerAt(g, x, H = 52, { span = 110, lines = true } = {}) {
    const m = galv()
    lattice(g, { x, z: 0, y0: 0, y1: H * 0.62, w0: 9, w1: 3, levels: 8, r: 0.14, material: m })
    lattice(g, { x, z: 0, y0: H * 0.62, y1: H, w0: 3, w1: 1.2, levels: 4, r: 0.12, material: m })
    const arms = [[H * 0.62, 11], [H * 0.8, 8]]
    const porc = mat(0x6b4a33, { rough: 0.35 })
    const wire = mat(0x3a3f45, { metal: 0.7, rough: 0.4 })
    const tips = []
    for (const [y, w] of arms) {
        for (const s of [1, -1]) {
            g.add(rod([x - 1.2, y, 0], [x - 0.4, y, s * w], 0.13, m))
            g.add(rod([x + 1.2, y, 0], [x + 0.4, y, s * w], 0.13, m))
            g.add(rod([x, y + 2.4, s * 1.4], [x, y, s * w], 0.1, m))
            // the insulator string: discs down to the conductor clamp
            for (let k = 0; k < 9; k++) g.add(cyl(0.34, 0.34, 0.1, porc, { x, y: y - 0.5 - k * 0.42, z: s * w }, 14))
            tips.push([x, y - 4.4, s * w])
        }
    }
    // earth wire peak
    g.add(rod([x, H, 0], [x, H + 1.5, 0], 0.1, m))
    if (lines) {
        for (const tp of tips) for (const d of [-1, 1]) conductor(g, tp, [tp[0] + d * span, tp[1], tp[2]], 7, wire, 0.11)
        conductor(g, [x, H + 1.4, 0], [x + span, H + 1.4, 0], 5, wire, 0.04)
        conductor(g, [x, H + 1.4, 0], [x - span, H + 1.4, 0], 5, wire, 0.04)
    }
}

export function pylon() {
    const g = new THREE.Group()
    plinth(g, 90, 46, grass)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(block(2, 0.6, 2, mat(PAL.concrete), { x: sx * 4.5, z: sz * 4.5 }))
    towerAt(g, 0, 52, { span: 44 })
    for (let i = 0; i < 5; i++) tree(g, -36 + i * 4, 16 + (i % 2) * 3, 1.3)
    return { group: g, setting: "land", view: { azimuth: 1.0, elevation: 0.22 } }
}

// ── subsea cable ─────────────────────────────────────────────────────────────

/** A subsea cable on the seabed, its end cut away to show what it is made of. */
export function subseaCable() {
    const g = new THREE.Group()
    plinth(g, 40, 24, 0xb8a888, { edge: 0x6a5d48 })
    // sand ripples
    for (let i = 0; i < 18; i++) g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 22, 6), mat(0xc6b796, { rough: 1 }), { x: -18 + i * 2.1, y: 0.04, rz: Math.PI / 2, ry: Math.PI / 2 + 0.2 }))
    // the cable runs in a slight S across the bed, half buried, then lifts at its cut end
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-20, 0.35, 6), new THREE.Vector3(-8, 0.4, 2), new THREE.Vector3(4, 0.45, -2), new THREE.Vector3(12, 0.9, -1), new THREE.Vector3(14.5, 1.3, -0.5)])
    const R = 0.75
    g.add(mesh(new THREE.TubeGeometry(curve, 80, R, 28, false), mat(0x1b1d20, { rough: 0.55 })))
    // rock armour dumped over it at one point
    for (let i = 0; i < 22; i++) g.add(mesh(new THREE.DodecahedronGeometry(0.35 + (i % 4) * 0.12, 0), mat(0x6e6a63, { rough: 1, flat: true }), { x: -9 + (i % 7) * 0.7, y: 0.6 + Math.floor(i / 7) * 0.35, z: 2.4 - (i % 5) * 0.6, rx: i, ry: i * 2 }))
    // the cut end: sheath, armour wires, bedding, the three cores (or the fibre unit)
    const end = curve.getPoint(1), tan = curve.getTangent(1)
    const cut = new THREE.Group()
    const ring = (r0, r1, len, m) => { const ge = new THREE.CylinderGeometry(r1, r1, len, 40, 1, false); cut.add(mesh(ge, m, { rz: -Math.PI / 2, x: len / 2 })) }
    ring(0, R * 0.97, 1.2, mat(0x2a2d31, { rough: 0.6 }))                                   // outer serving
    for (let k = 0; k < 30; k++) {                                                         // armour wires
        const a = (k / 30) * Math.PI * 2
        cut.add(rod([1.2, Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85], [2.0, Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85], 0.07, galv(), 8))
    }
    ring(0, R * 0.74, 2.6, mat(0xd8c25a, { rough: 0.5 }))                                  // bedding tape
    for (let k = 0; k < 3; k++) {                                                          // three insulated cores
        const a = (k / 3) * Math.PI * 2 + 0.3
        const cy = Math.cos(a) * R * 0.38, cz = Math.sin(a) * R * 0.38
        cut.add(cyl(R * 0.3, R * 0.3, 1.0, mat(0x2b3a52, { rough: 0.4 }), { x: 3.1, y: cy, z: cz, axis: "x" }, 24))
        cut.add(cyl(R * 0.2, R * 0.2, 1.3, mat(0xece6d6, { rough: 0.5 }), { x: 3.75, y: cy, z: cz, axis: "x" }, 24))
        cut.add(cyl(R * 0.11, R * 0.11, 1.6, mat(PAL.copper, { metal: 0.9, rough: 0.25 }), { x: 4.0, y: cy, z: cz, axis: "x" }, 18))
    }
    cut.add(cyl(R * 0.12, R * 0.12, 1.4, mat(0x2f8a5a, { rough: 0.4 }), { x: 3.6, axis: "x" }, 16))      // the fibre unit in the interstice
    cut.position.copy(end)
    cut.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan.normalize())
    g.add(cut)
    // a marker buoy's ground tackle and a few weeds for scale
    for (let i = 0; i < 8; i++) g.add(rod([-14 + i * 1.1, 0, -7 + (i % 3)], [-14 + i * 1.1 + 0.3, 1.4 + (i % 3) * 0.5, -7 + (i % 3)], 0.06, mat(0x4f7a4a, { rough: 0.9 }), 5))
    return { group: g, setting: "land", view: { azimuth: 0.4, elevation: 0.38 } }
}

// ── oil and gas ──────────────────────────────────────────────────────────────

/** A storage tank: shell, a floating or cone roof, the wind girder, a spiral stair. */
function tank(g, x, z, r, h, { color = 0xe9e8e3, cone = false } = {}) {
    const m = mat(color, { rough: 0.5, metal: 0.25 })
    g.add(cyl(r, r, h, m, { x, y: h / 2, z }, 64))
    g.add(mesh(new THREE.TorusGeometry(r + 0.2, 0.18, 6, 64), mat(0xcfcdc6, { metal: 0.3 }), { x, y: h - 1.2, z, rx: Math.PI / 2 }))
    if (cone) g.add(mesh(new THREE.ConeGeometry(r * 1.01, r * 0.22, 64), m, { x, y: h + r * 0.11, z }))
    else {
        g.add(cyl(r * 0.97, r * 0.97, 0.3, mat(0xb9b7ae, { metal: 0.4 }), { x, y: h - 2.4, z }, 64))
        g.add(rod([x - r * 0.6, h - 2.2, z], [x + r * 0.6, h, z], 0.15, galv()))       // the rolling ladder
    }
    // the spiral stair up the shell
    const N = 26
    let prev = null
    for (let i = 0; i <= N; i++) {
        const a = -0.6 + (i / N) * 1.6, y = (h * i) / N
        const p = [x + Math.cos(a) * (r + 0.8), y, z + Math.sin(a) * (r + 0.8)]
        if (prev) g.add(rod(prev, p, 0.1, galv(), 5))
        prev = p
    }
}

export function tankFarm() {
    const g = new THREE.Group()
    plinth(g, 220, 160, 0xa49f92)
    // six tanks in their bunds, two sizes
    const spots = [[-70, -40, 20, 18], [-15, -40, 20, 18], [40, -40, 20, 18], [-70, 25, 14, 16], [-30, 25, 14, 16], [10, 25, 14, 16]]
    for (const [x, z, r, h] of spots) {
        const bw = r * 2 + 10
        for (const [dx, dz, w, d] of [[0, -bw / 2, bw, 1], [0, bw / 2, bw, 1], [-bw / 2, 0, 1, bw], [bw / 2, 0, 1, bw]]) g.add(block(w, 1.4, d, mat(0xb9b3a4, { rough: 0.95 }), { x: x + dx, z: z + dz }))
        tank(g, x, z, r, h, { cone: r < 16 })
    }
    // the pipe rack, the pump house, the truck loading gantry with a tanker under it
    for (let x = -90; x <= 60; x += 6) { g.add(rod([x, 0, -8], [x, 6, -8], 0.25, steel())); g.add(rod([x, 6, -8], [x, 6, -2], 0.2, steel())) }
    for (const [dz, c] of [[-7, 0xd9b03a], [-5.5, 0xb0b5b9], [-4, 0x8f5a3a], [-2.6, 0xb0b5b9]]) g.add(rod([-90, 6.5, dz], [60, 6.5, dz], 0.5, mat(c, { metal: 0.4 })))
    g.add(block(16, 7, 10, mat(PAL.offwhite), { x: 80, z: -10 }))
    g.add(block(24, 0.4, 12, steel(), { x: 80, y: 7, z: 30 }))
    for (const [dx, dz] of [[-11, -5], [11, -5], [-11, 5], [11, 5]]) g.add(rod([80 + dx, 0, 30 + dz], [80 + dx, 7, 30 + dz], 0.3, steel()))
    const tr = truck().group
    tr.position.set(80, 0, 30); tr.rotation.y = Math.PI / 2; tr.scale.setScalar(0.95)
    g.add(tr)
    fence(g, -108, -78, 108, 78, { step: 9 })
    return { group: g, setting: "land", view: { azimuth: 0.6, elevation: 0.4 } }
}

/** A gate valve: body, bonnet, stem and handwheel, flanged into the line. */
function valve(g, x, y, z, r) {
    const m = mat(0x3f6fa0, { metal: 0.5, rough: 0.4 })
    g.add(cyl(r * 1.25, r * 1.25, r * 2.2, m, { x, y, z, axis: "x" }))
    for (const dx of [-r * 1.3, r * 1.3]) g.add(cyl(r * 1.6, r * 1.6, r * 0.3, m, { x: x + dx, y, z, axis: "x" }))
    g.add(cyl(r * 0.7, r * 0.9, r * 2.4, m, { x, y: y + r * 2.2, z }))
    g.add(rod([x, y + r * 3.4, z], [x, y + r * 4.6, z], r * 0.12, galv()))
    g.add(mesh(new THREE.TorusGeometry(r * 1.1, r * 0.12, 8, 28), mat(0xc23a2e, { metal: 0.3 }), { x, y: y + r * 4.6, z, rx: Math.PI / 2 }))
    for (let k = 0; k < 3; k++) g.add(rod([x, y + r * 4.6, z], [x + Math.cos(k * 2.09) * r * 1.1, y + r * 4.6, z + Math.sin(k * 2.09) * r * 1.1], r * 0.08, mat(0xc23a2e)))
}

export function pipeline() {
    const g = new THREE.Group()
    plinth(g, 120, 56, sand)
    const pm = mat(0xd9b03a, { metal: 0.45, rough: 0.4 })                 // gas yellow
    const r = 0.9, y = 2.2
    // the line on its supports, with an expansion loop, going into the ground at both ends
    const pts = [[-56, -0.6], [-50, y], [-20, y], [-14, y], [-14, y], [-8, y]]
    g.add(rod([-60, -1.2, 0], [-50, y, 0], r, pm, 24))
    g.add(rod([-50, y, 0], [-16, y, 0], r, pm, 24))
    // expansion loop: out to the side and back
    g.add(rod([-16, y, 0], [-16, y, 10], r, pm, 24)); g.add(rod([-16, y, 10], [-8, y, 10], r, pm, 24)); g.add(rod([-8, y, 10], [-8, y, 0], r, pm, 24))
    for (const [a, b] of [[[-16, y, 0], [-16, y, 10]], [[-8, y, 10], [-8, y, 0]]]) for (const p of [a, b]) g.add(sphere(r * 1.02, pm, { x: p[0], y: p[1], z: p[2] }, 16))
    g.add(sphere(r * 1.02, pm, { x: -16, y, z: 10 }, 16)); g.add(sphere(r * 1.02, pm, { x: -8, y, z: 10 }, 16))
    g.add(rod([-8, y, 0], [50, y, 0], r, pm, 24))
    g.add(rod([50, y, 0], [60, -1.2, 0], r, pm, 24))
    void pts
    // H-frame supports with saddles every 6 m
    for (let x = -46; x <= 46; x += 6) {
        if (x > -18 && x < -6) continue
        for (const dz of [-1.3, 1.3]) g.add(rod([x, 0, dz], [x, y - r, dz], 0.16, steel(), 8))
        g.add(block(0.5, 0.35, 3.2, steel(), { x, y: y - r - 0.35 }))
        g.add(block(0.4, 0.3, 2.2, mat(0x2a2d31), { x, y: y - r - 0.05 }))
    }
    // the block-valve station: two valves, a bypass, a fenced pad
    g.add(block(26, 0.15, 18, mat(gravel), { x: 20, y: 0.01, z: 0 }))
    valve(g, 14, y, 0, r); valve(g, 26, y, 0, r)
    g.add(rod([12, y, 0], [12, y, -5], r * 0.4, pm, 16)); g.add(rod([12, y, -5], [28, y, -5], r * 0.4, pm, 16)); g.add(rod([28, y, -5], [28, y, 0], r * 0.4, pm, 16))
    valve(g, 20, y, -5, r * 0.45)
    g.add(rblock(4, 2.6, 3, 0.15, mat(PAL.offwhite), { x: 20, z: 7 }))
    fence(g, 7, -9, 33, 9, { step: 3 })
    // marker posts along the buried line, and the warning sign
    for (const x of [-58, 58]) { g.add(rod([x, 0, 3], [x, 1.8, 3], 0.08, mat(0xe0b63a), 6)); g.add(block(0.6, 0.6, 0.06, mat(0xe0b63a), { x, y: 1.8, z: 3 })) }
    return { group: g, setting: "land", view: { azimuth: 0.7, elevation: 0.32 } }
}

/** A pumpjack ("nodding donkey") over its well, with the wellhead tree; it pumps. */
export function oilWell() {
    const g = new THREE.Group()
    plinth(g, 48, 34, sand)
    g.add(block(26, 0.5, 8, mat(PAL.concrete), { x: -2, y: 0 }))                     // the pad
    const red = mat(0xb3302a, { metal: 0.4, rough: 0.45 })
    const dark = mat(PAL.darkgrey, { metal: 0.5 })
    // base skid and the samson post (an A-frame)
    g.add(block(18, 0.8, 2.4, dark, { x: -2, y: 0.5 }))
    const pivot = [-1, 9.2, 0]
    for (const dz of [-1.4, 1.4]) { g.add(rod([-4, 1.3, dz], [pivot[0], pivot[1], dz * 0.3], 0.28, red)); g.add(rod([2, 1.3, dz], [pivot[0], pivot[1], dz * 0.3], 0.28, red)) }
    // gearbox, the electric motor and the belt guard
    g.add(rblock(3.2, 2.6, 2.4, 0.3, red, { x: -8, y: 1.3 }))
    g.add(cyl(0.7, 0.7, 1.8, mat(0x3f6fa0, { metal: 0.4 }), { x: -11.2, y: 2.2, z: 0, axis: "z" }))
    g.add(block(2.6, 2.2, 0.3, mat(0xe0b63a), { x: -9.8, y: 1.6, z: 1.35 }))
    // the moving parts
    const beam = new THREE.Group()                              // walking beam with the horse head
    beam.add(block(16, 0.7, 0.6, red, { x: 1.5, y: -0.35 }))
    const head = new THREE.Shape()
    head.moveTo(0, -1.8); head.absarc(0, 0, 1.8, -Math.PI / 2, Math.PI / 2, false); head.lineTo(-1.2, 1.8); head.lineTo(-1.2, -1.8); head.closePath()
    const hg = new THREE.ExtrudeGeometry(head, { depth: 1.0, bevelEnabled: false, curveSegments: 20 }); hg.translate(0, 0, -0.5)
    beam.add(mesh(hg, red, { x: 9.6, y: -0.35 }))
    beam.add(block(1.2, 0.6, 1.6, red, { x: -6.6, y: -0.3 }))     // the equaliser
    beam.position.set(...pivot)
    g.add(beam)
    const crankC = [-8, 3.4, 0]
    const cranks = new THREE.Group()                            // crank arms with counterweights
    for (const dz of [-1.5, 1.5]) {
        cranks.add(block(4.2, 0.5, 0.4, red, { x: -1.4, y: -0.25, z: dz }))
        cranks.add(rblock(2.2, 2.6, 0.5, 0.4, dark, { x: -3.3, y: -1.3, z: dz }))
    }
    cranks.position.set(...crankC)
    g.add(cranks)
    // links made once with unit length and moved each frame (no geometry per frame)
    const unit = (r, m) => { const k = mesh(new THREE.CylinderGeometry(r, r, 1, 10, 1), m); g.add(k); return k }
    const Y = new THREE.Vector3(0, 1, 0), A = new THREE.Vector3(), B = new THREE.Vector3()
    const place = (k, a, b) => {
        A.set(...a); B.set(...b)
        k.position.copy(A).add(B).multiplyScalar(0.5)
        k.scale.set(1, A.distanceTo(B), 1)
        k.quaternion.setFromUnitVectors(Y, B.sub(A).normalize())
    }
    const rodM = mat(0xc8cdd2, { metal: 0.8, rough: 0.25 })
    const pitmen = [unit(0.16, red), unit(0.16, red)]
    const bridle = unit(0.05, rodM), polished = unit(0.09, rodM)
    const pump = (t) => {
        const ang = t * 1.6
        cranks.rotation.z = ang
        const pinX = crankC[0] + Math.cos(ang) * 2.8, pinY = crankC[1] + Math.sin(ang) * 2.8
        // the beam follows the pitman: its tail end rides up and down with the crank pin
        const tilt = Math.atan2((pinY + 5.4) - pivot[1], 6.6) * 0.35 - 0.08
        beam.rotation.z = -tilt
        const tail = [pivot[0] - Math.cos(tilt) * 6.6, pivot[1] + Math.sin(tilt) * 6.6]
        for (const [i, dz] of [[0, -1.5], [1, 1.5]]) place(pitmen[i], [pinX, pinY, dz], [tail[0], tail[1], dz * 0.5])
        const hx = pivot[0] + Math.cos(tilt) * 11.4, hy = pivot[1] - Math.sin(tilt) * 11.4
        place(bridle, [hx, hy, 0], [hx, 3.2, 0])
        place(polished, [hx, 3.2, 0], [hx, 1.2, 0])                        // the polished rod into the stuffing box
    }
    pump(0)
    const driver = new THREE.Object3D()
    driver.userData.tick = pump
    g.add(driver)
    // the wellhead tree and its flowline to a small tank and separator
    const wx = pivot[0] + 11.4
    g.add(cyl(0.5, 0.5, 1.2, mat(0x3f6fa0, { metal: 0.4 }), { x: wx, y: 0.6 }))
    for (const y of [0.4, 0.9]) g.add(cyl(0.75, 0.75, 0.16, mat(0x3f6fa0), { x: wx, y }))
    g.add(rod([wx, 0.8, 0], [wx, 0.8, 6], 0.18, mat(PAL.grey, { metal: 0.6 })))
    g.add(rod([wx, 0.8, 6], [-12, 0.8, 9], 0.18, mat(PAL.grey, { metal: 0.6 })))
    tank(g, -14, 11, 2.6, 6, { color: 0x6f7a62, cone: true })
    g.add(cyl(0.9, 0.9, 4, mat(PAL.offwhite, { metal: 0.3 }), { x: -6, y: 2.2, z: 11 }))
    return { group: g, setting: "land", view: { azimuth: 0.35, elevation: 0.22 } }
}

// ── data centre ──────────────────────────────────────────────────────────────

export function dataCenter() {
    const g = new THREE.Group()
    plinth(g, 170, 120, 0x8f938c)
    const W = 110, H = 16, D = 58
    // the hall: a long, nearly blind box with vertical louvres and a glass entrance
    g.add(block(W, H, D, mat(0xc9cdd0, { metal: 0.25, rough: 0.5 }), { x: -10, z: -10 }))
    const louvre = mat(0x9ea6ad, { metal: 0.5 })
    for (let i = 0; i < 52; i++) for (const s of [1, -1]) g.add(block(0.35, H * 0.8, 0.5, louvre, { x: -10 - W / 2 + 2 + i * 2.1, y: H * 0.1, z: -10 + s * (D / 2 + 0.25) }))
    g.add(block(14, 9, 6, GLASS(), { x: -50, y: 0, z: -10 + D / 2 + 2 }))
    g.add(block(16, 1, 8, mat(PAL.offwhite), { x: -50, y: 9, z: -10 + D / 2 + 2 }))
    // the roof plant: rows of chillers with their fans
    const ch = mat(0xdfe2e4, { metal: 0.3 })
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) {
        const x = -55 + c * 11, z = -26 + r * 14
        g.add(block(9, 2.4, 4.2, ch, { x, y: H, z }))
        for (const dx of [-2.6, 0, 2.6]) {
            g.add(cyl(1.1, 1.1, 0.2, mat(PAL.darkgrey), { x: x + dx, y: H + 2.5, z }, 20))
            const fan = block(2, 0.05, 0.25, mat(0x6a737c), { x: x + dx, y: H + 2.62, z })
            fan.userData.tick = (t) => { fan.rotation.y = t * 7 + c + r }
            g.add(fan)
        }
    }
    // the generator yard: containerised gensets with exhaust stacks, and fuel tanks
    for (let i = 0; i < 6; i++) {
        const x = -58 + i * 13
        g.add(rblock(12, 3.2, 3, 0.2, mat(0x56606a, { metal: 0.3 }), { x, z: 36 }))
        g.add(cyl(0.35, 0.35, 3, mat(PAL.darkgrey, { metal: 0.6 }), { x: x + 4, y: 4.6, z: 36 }))
    }
    for (const x of [30, 38]) g.add(cyl(1.6, 1.6, 9, mat(0xe9e8e3), { x, y: 1.8, z: 36, axis: "x" }))
    // its own substation, the car park, the double fence
    g.add(block(30, 0.06, 26, mat(gravel), { x: 62, y: 0.03, z: -30 }))
    for (let i = 0; i < 2; i++) g.add(block(8, 6, 5, mat(0x5d6b58, { metal: 0.3 }), { x: 56 + i * 12, z: -30 }))
    lattice(g, { x: 70, z: -40, y0: 0, y1: 14, w0: 2.6, w1: 1.2, levels: 4, r: 0.1, material: galv() })
    g.add(block(30, 0.05, 30, mat(PAL.asphalt), { x: 62, y: 0.02, z: 22 }))
    for (let i = 0; i < 10; i++) g.add(block(4.4, 1.4, 2, mat([0x8f2a24, 0x2f6fb3, 0xd9dcdf, 0x3b4148][i % 4], { metal: 0.5, rough: 0.3 }), { x: 52 + (i % 5) * 5, z: 14 + Math.floor(i / 5) * 12 }))
    fence(g, -80, -56, 80, 56, { h: 3, step: 8 })
    return { group: g, setting: "land", view: { azimuth: 0.62, elevation: 0.36 } }
}

void LIT
