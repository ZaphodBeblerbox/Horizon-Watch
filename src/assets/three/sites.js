/**
 * sites.js — places: factory, office, warehouse, refinery, power plant,
 * substation, port terminal, airport.
 *
 * Each sits on a plinth like an architectural model — a slab of its ground
 * (concrete, grass, gravel, apron) with the edge showing — so a site reads
 * as a site and not as a building floating in space.
 */
import * as THREE from "three"
import { PAL, mat, mesh, block, rblock, cyl, sphere, rod, lathe, windows, lattice, containerStack, hull, GLASS, LIT } from "./kit.js"
import { truck } from "./vehicles.js"
import { airliner } from "./aircraft.js"
import { containerShip } from "./ships.js"

let _cloud = null
/** A soft round cloud: white in the middle, nothing at the edge. */
function cloudTexture() {
    if (_cloud) return _cloud
    const c = document.createElement("canvas")
    c.width = c.height = 128
    const x = c.getContext("2d")
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64)
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.45, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)")
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128)
    _cloud = new THREE.CanvasTexture(c)
    _cloud.colorSpace = THREE.SRGBColorSpace
    return _cloud
}

/** The plinth: a rounded slab of ground, top at y = 0. */
function plinth(g, w, d, color = PAL.concrete, { r = 4, h = 1.6, edge = 0x2a2f36 } = {}) {
    const sh = new THREE.Shape()
    const x0 = -w / 2, y0 = -d / 2
    sh.moveTo(x0 + r, y0); sh.lineTo(x0 + w - r, y0); sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r)
    sh.lineTo(x0 + w, y0 + d - r); sh.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d)
    sh.lineTo(x0 + r, y0 + d); sh.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r)
    sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0)
    const body = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 10 })
    body.rotateX(-Math.PI / 2)
    g.add(mesh(body, mat(edge, { rough: 0.9 }), { y: -h }))
    const top = new THREE.ShapeGeometry(sh, 10)
    top.rotateX(-Math.PI / 2)
    g.add(mesh(top, mat(color, { rough: 0.95 }), { y: 0.01 }))
}

/** Road / marking strip lying on the ground. */
const strip = (g, w, d, color, x, z, ry = 0) => g.add(block(w, 0.03, d, mat(color, { rough: 0.9 }), { x, y: 0.01, z, ry }))

/** A tree: a trunk and a rounded crown. */
function tree(g, x, z, s = 1) {
    g.add(cyl(0.18 * s, 0.25 * s, 2.2 * s, mat(0x5a4632, { rough: 0.9 }), { x, y: 1.1 * s, z }))
    g.add(sphere(1.5 * s, mat(0x4d6e45, { rough: 0.85, flat: true }), { x, y: 3.2 * s, z }, 8))
}

/** A chimney with red and white bands and a platform near the top. */
function chimney(g, x, z, h, r) {
    const bands = 7
    for (let i = 0; i < bands; i++) {
        const y0 = (h * i) / bands, rr0 = r * (1 - 0.25 * (i / bands)), rr1 = r * (1 - 0.25 * ((i + 1) / bands))
        g.add(cyl(rr1, rr0, h / bands, mat(i >= bands - 3 ? (i % 2 ? PAL.white : 0xb3302a) : PAL.concrete, { rough: 0.8 }), { x, y: y0 + h / bands / 2, z }))
    }
    g.add(mesh(new THREE.TorusGeometry(r * 0.95, 0.12, 6, 24), mat(PAL.darkgrey, { metal: 0.6 }), { x, y: h * 0.82, z, rx: Math.PI / 2 }))
}

export function factory() {
    const g = new THREE.Group()
    plinth(g, 108, 78, PAL.concrete)
    strip(g, 108, 7, PAL.asphalt, 0, 33)
    // the main hall: a sawtooth roof, glazed on the steep faces (north lights)
    const hallW = 64, hallD = 44, hallH = 9, teeth = 8
    const wall = mat(0xc9ccd0, { rough: 0.7 })
    g.add(block(hallW, hallH, hallD, wall, { x: -12, z: -6 }))
    for (let i = 0; i < hallW / 1.6; i++) g.add(block(0.18, hallH, 0.06, mat(0xb4b8bd), { x: -12 - hallW / 2 + 0.8 + i * 1.6, y: 0, z: -6 + hallD / 2 + 0.03 }))   // cladding ribs
    const tw = hallW / teeth
    for (let i = 0; i < teeth; i++) {
        const sh = new THREE.Shape()
        sh.moveTo(0, 0); sh.lineTo(tw, 0); sh.lineTo(tw * 0.2, 4.2); sh.lineTo(0, 4.2); sh.closePath()
        const geo = new THREE.ExtrudeGeometry(sh, { depth: hallD, bevelEnabled: false })
        geo.translate(0, 0, -hallD / 2)
        g.add(mesh(geo, mat(0x8d949b, { metal: 0.4, rough: 0.5 }), { x: -12 - hallW / 2 + i * tw, y: hallH, z: -6 }))
        g.add(block(0.1, 3.6, hallD - 0.4, GLASS(), { x: -12 - hallW / 2 + i * tw + 0.08, y: hallH + 0.3, z: -6 }))
    }
    // the office annex with windows, the loading docks, two chimneys, silos and a pipe bridge
    g.add(block(22, 12, 14, mat(PAL.offwhite, { rough: 0.6 }), { x: 31, z: 18 }))
    windows(g, { cx: 31, cz: 18, y0: 0, w: 22, h: 12, d: 14 }, { faces: ["+z", "+x", "-x"], rowH: 3.6, colW: 2.2, paneW: 1.8, paneH: 1.9, sill: 1.1, lit: 0.35 })
    for (let i = 0; i < 6; i++) {
        g.add(block(4.2, 4.6, 0.3, mat(0x50565d, { metal: 0.5 }), { x: -38 + i * 7, y: 0, z: -6 + hallD / 2 + 0.2 }))
        g.add(block(5, 0.3, 2.4, mat(PAL.darkgrey), { x: -38 + i * 7, y: 4.8, z: -6 + hallD / 2 + 1.3 }))
    }
    chimney(g, 30, -18, 38, 2.2)
    chimney(g, 38, -14, 30, 1.8)
    for (const [x, z] of [[24, -26], [30, -28], [36, -27]]) {
        g.add(cyl(3, 3, 14, mat(PAL.offwhite, { metal: 0.3, rough: 0.4 }), { x, y: 7 + 3, z }))
        g.add(mesh(new THREE.ConeGeometry(3, 2.5, 24), mat(PAL.offwhite, { metal: 0.3, rough: 0.4 }), { x, y: 18.2, z }))
        g.add(mesh(new THREE.ConeGeometry(3, 3, 24).rotateX(Math.PI), mat(PAL.offwhite), { x, y: 1.6, z }))
        for (const [dx, dz] of [[2.2, 2.2], [-2.2, 2.2], [2.2, -2.2], [-2.2, -2.2]]) g.add(rod([x + dx, 0, z + dz], [x + dx * 0.9, 3.2, z + dz * 0.9], 0.18, mat(PAL.steel, { metal: 0.6 })))
    }
    g.add(rod([20, hallH + 2, -18], [24, hallH + 2, -18], 0.6, mat(PAL.grey, { metal: 0.6 })))
    g.add(rod([24, hallH + 2, -18], [28, 6, -18], 0.6, mat(PAL.grey, { metal: 0.6 })))
    const t = truck().group; t.position.set(-30, 0, 30); t.rotation.y = Math.PI; t.scale.setScalar(1); g.add(t)
    for (let i = 0; i < 9; i++) strip(g, 0.2, 5, PAL.white, 4 + i * 3, 27)               // car park lines
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function office() {
    const g = new THREE.Group()
    plinth(g, 60, 52, 0x9fa39b)
    strip(g, 60, 7, PAL.asphalt, 0, 22)
    // the podium, then a curtain-wall tower with mullions and lit floors
    const pod = mat(0x6d747c, { metal: 0.3, rough: 0.5 })
    g.add(block(44, 9, 34, pod, { x: 0, z: -4 }))
    windows(g, { cx: 0, cz: -4, y0: 0, w: 44, h: 9, d: 34 }, { faces: ["+z", "+x", "-x"], rowH: 4.5, colW: 3, paneW: 2.9, paneH: 3.6, sill: 0.4, lit: 0.5 })
    const H = 96, w = 26, d = 22
    const glass = mat(0x2a3d52, { metal: 0.85, rough: 0.08 })
    g.add(block(w, H, d, glass, { x: -2, y: 9, z: -6 }))
    const fin = mat(0xd5d9de, { metal: 0.6, rough: 0.3 })
    // vertical mullions on all four faces, floor slabs every 4 m
    for (let i = 0; i <= w / 1.5; i++) for (const s of [1, -1]) g.add(block(0.18, H, 0.35, fin, { x: -2 - w / 2 + i * 1.5, y: 9, z: -6 + s * (d / 2 + 0.15) }))
    for (let i = 0; i <= d / 1.5; i++) for (const s of [1, -1]) g.add(block(0.35, H, 0.18, fin, { x: -2 + s * (w / 2 + 0.15), y: 9, z: -6 - d / 2 + i * 1.5 }))
    for (let f = 1; f < H / 4; f++) g.add(block(w + 0.5, 0.25, d + 0.5, fin, { x: -2, y: 9 + f * 4, z: -6 }))
    // some floors lit from inside
    for (let f = 0; f < H / 4; f++) if ((f * 7) % 5 < 2) g.add(block(w - 0.4, 2.6, d - 0.4, LIT(), { x: -2, y: 9 + f * 4 + 0.6, z: -6 }))
    // the crown: plant room, a setback, an antenna
    g.add(block(w - 6, 6, d - 6, mat(0xd5d9de, { metal: 0.4 }), { x: -2, y: 9 + H, z: -6 }))
    g.add(rod([-2, 9 + H + 6, -6], [-2, 9 + H + 20, -6], 0.3, mat(PAL.grey, { metal: 0.7 })))
    for (const [x, z] of [[-26, 22], [-18, 22], [14, 22], [22, 22], [28, 6], [28, -8]]) tree(g, x, z, 1.2)
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function warehouse() {
    const g = new THREE.Group()
    plinth(g, 112, 72, 0x8f918c)
    const W = 96, D = 46, H = 13
    g.add(block(W, H, D, mat(0xb8bcc1, { rough: 0.6, metal: 0.3 }), { z: -8 }))
    for (let i = 0; i < W / 1.2; i++) g.add(block(0.2, H, 0.08, mat(0xa3a8ae, { metal: 0.3 }), { x: -W / 2 + 0.6 + i * 1.2, z: -8 + D / 2 + 0.04 }))   // trapezoidal cladding
    // shallow pitched roof with skylights
    const roof = new THREE.Shape()
    roof.moveTo(-D / 2 - 0.5, 0); roof.lineTo(D / 2 + 0.5, 0); roof.lineTo(0, 2.6); roof.closePath()
    const rg = new THREE.ExtrudeGeometry(roof, { depth: W + 1, bevelEnabled: false })
    rg.rotateY(Math.PI / 2); rg.translate(-W / 2 - 0.5, 0, 0)
    g.add(mesh(rg, mat(0x7d848b, { metal: 0.5, rough: 0.45 }), { y: H, z: -8 }))
    for (let i = 0; i < 10; i++) g.add(block(4, 0.2, 2, GLASS(), { x: -W / 2 + 6 + i * 9.4, y: H + 1.0, z: -8 + 5 }))
    // twelve dock doors with leveller canopies; trucks backed into two of them
    for (let i = 0; i < 12; i++) {
        const x = -W / 2 + 6 + i * 7.6
        g.add(block(3.2, 3.8, 0.25, mat(i % 3 ? 0x4a5560 : 0xd9822b, { metal: 0.4, rough: 0.5 }), { x, y: 1.2, z: -8 + D / 2 + 0.15 }))
        g.add(block(4.2, 0.25, 1.8, mat(PAL.darkgrey), { x, y: 5.4, z: -8 + D / 2 + 0.9 }))
        g.add(block(3.6, 1.2, 0.6, mat(PAL.black, { rough: 0.9 }), { x, y: 0, z: -8 + D / 2 + 0.35 }))
    }
    for (const x of [-W / 2 + 6 + 7.6 * 2, -W / 2 + 6 + 7.6 * 6]) { const t = truck().group; t.position.set(x, 0, 15 + 14); t.rotation.y = -Math.PI / 2; g.add(t) }
    strip(g, 112, 18, PAL.asphalt, 0, 26)
    for (let i = 0; i < 12; i++) strip(g, 0.25, 8, PAL.yellow, -W / 2 + 6 + i * 7.6 - 3.8, 24)
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function refinery() {
    const g = new THREE.Group()
    plinth(g, 118, 84, 0x8c8a82)
    const steel = mat(PAL.grey, { metal: 0.7, rough: 0.35 })
    const white = mat(PAL.offwhite, { metal: 0.3, rough: 0.45 })
    // distillation columns with platforms and ladders
    for (const [x, z, h, r] of [[-30, -18, 52, 3.2], [-20, -20, 40, 2.4], [-12, -16, 30, 2], [-36, -6, 34, 2.2]]) {
        g.add(cyl(r, r, h, steel, { x, y: h / 2, z }))
        g.add(sphere(r, steel, { x, y: h, z }, 20))
        for (let y = 8; y < h; y += 9) {
            g.add(cyl(r + 1.2, r + 1.2, 0.2, mat(PAL.yellow, { metal: 0.3 }), { x, y, z }))
            g.add(mesh(new THREE.TorusGeometry(r + 1.2, 0.06, 4, 32), mat(PAL.yellow), { x, y: y + 1.1, z, rx: Math.PI / 2 }))
        }
        g.add(block(0.5, h, 0.12, mat(PAL.yellow), { x: x + r + 0.3, y: 0, z }))
    }
    // the pipe rack: a steel lattice with pipes along it
    for (let i = 0; i < 9; i++) {
        const x = -40 + i * 8
        for (const s of [1, -1]) g.add(rod([x, 0, 4 + s * 3], [x, 9, 4 + s * 3], 0.25, steel))
        g.add(rod([x, 9, 1], [x, 9, 7], 0.2, steel)); g.add(rod([x, 5, 1], [x, 5, 7], 0.2, steel))
    }
    const pc = [PAL.offwhite, PAL.grey, 0x8a5a3b, PAL.yellow, PAL.grey]
    pc.forEach((c, i) => g.add(rod([-42, 9.6, 1.6 + i * 1.2], [26, 9.6, 1.6 + i * 1.2], 0.4, mat(c, { metal: 0.5, rough: 0.4 }))))
    pc.forEach((c, i) => g.add(rod([-42, 5.6, 1.6 + i * 1.2], [26, 5.6, 1.6 + i * 1.2], 0.35, mat(c, { metal: 0.5, rough: 0.4 }))))
    // floating-roof tanks in a bund
    for (const [x, z] of [[24, -24], [44, -24], [24, -2], [44, -2]]) {
        g.add(cyl(9, 9, 13, white, { x, y: 6.5, z }, 48))
        g.add(cyl(8.6, 8.6, 0.4, mat(0x9aa0a6, { metal: 0.5 }), { x, y: 10.5, z }, 48))
        g.add(mesh(new THREE.TorusGeometry(9, 0.12, 4, 48), steel, { x, y: 13, z, rx: Math.PI / 2 }))
        for (let k = 0; k < 4; k++) g.add(block(0.15, 13, 0.4, mat(PAL.darkgrey), { x: x + 9 * Math.cos(k * 1.57), y: 0, z: z + 9 * Math.sin(k * 1.57) }))
    }
    g.add(block(46, 1.6, 0.6, mat(PAL.concrete), { x: 34, y: 0, z: 10 }))     // the bund wall
    g.add(block(0.6, 1.6, 46, mat(PAL.concrete), { x: 11, y: 0, z: -13 }))
    // the furnace and the flare stack, burning
    g.add(block(14, 12, 8, mat(0x6b5146, { rough: 0.7 }), { x: -6, z: 22 }))
    chimney(g, -6, 30, 28, 1.2)
    g.add(rod([52, 0, 34], [52, 46, 34], 0.8, steel))
    lattice(g, { x: 52, z: 34, y0: 0, y1: 40, w0: 6, w1: 2, levels: 7, r: 0.12 })
    const flame = new THREE.Group()
    const fl = mat(0xffa030, { emissive: 0xff7a10, emissiveIntensity: 2.2, opacity: 0.9 })
    const f1 = mesh(new THREE.ConeGeometry(1.6, 6, 12), fl, { y: 3, shadow: false })
    const f2 = mesh(new THREE.ConeGeometry(1.0, 4, 12), mat(0xffe28a, { emissive: 0xffd070, emissiveIntensity: 2.5 }), { y: 2.2, shadow: false })
    flame.add(f1, f2)
    flame.position.set(52, 46, 34)
    flame.userData.tick = (t) => { const k = 1 + 0.12 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23); flame.scale.set(1, k, 1); flame.rotation.z = 0.06 * Math.sin(t * 3) }
    g.add(flame)
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function powerPlant() {
    const g = new THREE.Group()
    plinth(g, 132, 96, 0x8d8f86)
    // two hyperboloid cooling towers
    const towerProfile = []
    const TH = 70
    for (let i = 0; i <= 24; i++) { const y = (TH * i) / 24, t = y / TH; towerProfile.push([20 * Math.sqrt(0.36 + Math.pow((t - 0.72) / 0.72, 2) * 0.64) * (1 + 0.02 * Math.sin(i)), y]) }
    const conc = mat(0xb8b4aa, { rough: 0.9, side: THREE.DoubleSide })
    for (const x of [-38, 10]) {
        g.add(lathe(towerProfile, conc, { x, z: -22 }, 64))
        for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.add(rod([x + Math.cos(a) * 19.5, 0, -22 + Math.sin(a) * 19.5], [x + Math.cos(a + 0.2) * 18.6, 4, -22 + Math.sin(a + 0.2) * 18.6], 0.35, conc)) }
        // steam: soft billboard clouds that rise, swell and thin as they drift
        const steam = new THREE.Group()
        const puffs = []
        for (let i = 0; i < 14; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.6, color: 0xf2f4f7 }))
            steam.add(sp); puffs.push(sp)
        }
        steam.position.set(x, TH - 2, -22)
        steam.userData.tick = (t) => puffs.forEach((p, i) => {
            const f = ((t * 0.06 + i / puffs.length) % 1)
            p.position.set(f * 30 + Math.sin(i * 2.1) * 4, 6 + f * 46, f * 8 + Math.cos(i * 1.7) * 4)
            const sc = 26 + f * 40
            p.scale.set(sc, sc, 1)
            p.material.opacity = 0.62 * Math.min(1, f * 6) * (1 - f)
        })
        g.add(steam)
    }
    // the turbine hall, the boiler house, the stack, transformers outside
    g.add(block(56, 22, 26, mat(0x7b858f, { metal: 0.3, rough: 0.5 }), { x: 12, z: 28 }))
    for (let i = 0; i < 18; i++) g.add(block(0.25, 22, 0.1, mat(0x6a737c), { x: -15 + i * 3.1, z: 28 + 13.05 }))
    g.add(block(20, 40, 22, mat(0x5d666f, { metal: 0.3 }), { x: -30, z: 28 }))
    windows(g, { cx: 12, cz: 28, y0: 0, w: 56, h: 22, d: 26 }, { faces: ["+z"], rowH: 7, colW: 3.1, paneW: 2.2, paneH: 4, sill: 6, lit: 0.3, band: true })
    chimney(g, -48, 36, 110, 4)
    for (let i = 0; i < 3; i++) { g.add(block(6, 6, 5, mat(0x4f5a50, { metal: 0.3 }), { x: 48, z: 16 + i * 8 })); for (let k = 0; k < 6; k++) g.add(block(0.3, 5, 4.6, mat(0x45504a), { x: 48 + 3.2 + k * 0.45, z: 16 + i * 8 })) }
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function substation() {
    const g = new THREE.Group()
    plinth(g, 84, 60, 0x9c9a93)
    const steel = mat(PAL.steel, { metal: 0.6, rough: 0.4 })
    const porc = mat(0x8a5a3b, { rough: 0.4 })
    // gravel yard and its fence
    g.add(block(70, 0.08, 50, mat(0xa9a69e, { rough: 1 }), { x: -2, y: 0.01 }))
    for (let i = 0; i <= 28; i++) {
        for (const z of [-25, 25]) g.add(rod([-37 + i * 2.5, 0, z], [-37 + i * 2.5, 2.4, z], 0.05, mat(PAL.grey, { metal: 0.6 })))
    }
    for (const z of [-25, 25]) g.add(block(70, 2.2, 0.04, mat(0x9aa3ab, { opacity: 0.45, metal: 0.5 }), { x: -2, y: 0.1, z }))
    // three transformers: tank, radiators, bushings
    for (let i = 0; i < 3; i++) {
        const x = -22 + i * 14, z = -6
        g.add(block(7, 5, 4.5, mat(0x5d6b58, { metal: 0.35, rough: 0.5 }), { x, z }))
        for (let k = 0; k < 7; k++) g.add(block(0.18, 4, 2.2, mat(0x55624f, { metal: 0.3 }), { x: x - 3 + k * 1, y: 0.5, z: z + 3.4 }))
        for (const dx of [-2, 0, 2]) {
            g.add(cyl(0.18, 0.28, 3.2, porc, { x: x + dx, y: 6.6, z: z - 0.8 }))
            for (let r = 0; r < 6; r++) g.add(cyl(0.42, 0.42, 0.08, porc, { x: x + dx, y: 5.4 + r * 0.45, z: z - 0.8 }, 12))
        }
        g.add(block(1.6, 1.6, 1.2, mat(0x5d6b58), { x: x + 2.5, y: 5, z: z + 1 }))   // conservator
    }
    // gantries carrying the busbars, and a lattice pylon taking the line out
    for (const x of [-30, -8, 14]) {
        for (const z of [-16, 4]) lattice(g, { x, z, y0: 0, y1: 14, w0: 1.4, w1: 1.0, levels: 5, r: 0.07, material: steel })
        g.add(block(1.2, 1.2, 22, steel, { x, y: 13.4, z: -6 }))
    }
    for (const dz of [-12, -6, 0]) g.add(rod([-30, 13, dz], [14, 13, dz], 0.08, mat(PAL.copper, { metal: 0.8, rough: 0.3 })))
    lattice(g, { x: 30, z: -6, y0: 0, y1: 40, w0: 7, w1: 1.6, levels: 9, r: 0.12, material: steel })
    for (const y of [28, 34]) g.add(block(14, 0.6, 0.6, steel, { x: 30, y, z: -6, ry: Math.PI / 2 }))
    for (const dz of [-6, 0, 6]) {
        g.add(rod([30, 27.4, -6 + dz], [14, 13, -6 + dz * 0.5], 0.06, mat(0x30353b, { metal: 0.6 })))
        g.add(rod([30, 27.4, -6 + dz], [44, 22, -6 + dz], 0.06, mat(0x30353b, { metal: 0.6 })))
        g.add(cyl(0.15, 0.15, 1.4, porc, { x: 30, y: 27.4, z: -6 + dz }))
    }
    // the control building
    g.add(block(14, 5, 8, mat(PAL.offwhite), { x: -26, z: 16 }))
    windows(g, { cx: -26, cz: 16, y0: 0, w: 14, h: 5, d: 8 }, { faces: ["+z", "-x"], rowH: 5, colW: 2.5, paneW: 1.4, paneH: 1.4, sill: 1.6, lit: 0.4 })
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

export function port() {
    const g = new THREE.Group()
    // the quay rises out of the water (waterline at y = 0)
    const quay = mat(0xa6a299, { rough: 0.9 })
    g.add(block(170, 9, 70, quay, { x: 0, y: -6, z: -42 }))
    g.add(block(170, 0.4, 2, mat(PAL.yellow), { x: 0, y: 3, z: -7.6 }))
    for (let i = 0; i < 16; i++) g.add(cyl(0.5, 0.6, 0.9, mat(PAL.black, { metal: 0.5 }), { x: -78 + i * 10.5, y: 3.4, z: -8.6 }))
    // a container ship alongside
    const ship = containerShip().group
    ship.scale.setScalar(0.5); ship.position.set(0, -6, 10); g.add(ship)
    // ship-to-shore gantry cranes: legs on the quay, boom out over the ship
    const crane = mat(0x2f6fb3, { metal: 0.4, rough: 0.45 })
    for (const x of [-40, -8, 24]) {
        const c = new THREE.Group()
        for (const dx of [-7, 7]) for (const dz of [-24, -10]) c.add(rod([dx, 3, dz], [dx, 44, dz], 0.9, crane))
        for (const dz of [-24, -10]) c.add(rod([-7, 44, dz], [7, 44, dz], 0.8, crane))
        for (const dx of [-7, 7]) c.add(rod([dx, 30, -24], [dx, 30, -10], 0.6, crane))
        for (const dx of [-6, 6]) c.add(rod([dx, 46, -36], [dx, 46, 32], 0.8, crane))         // the boom
        for (const dx of [-6, 6]) c.add(rod([dx, 46, -10], [dx, 62, -18], 0.5, crane))
        for (const dx of [-6, 6]) c.add(rod([dx, 62, -18], [dx, 46, 28], 0.25, mat(PAL.darkgrey)))
        c.add(block(6, 3, 5, mat(PAL.white), { x: 0, y: 46.8, z: 14 }))                        // the trolley and cab
        c.add(rod([0, 46, 14], [0, 30, 14], 0.1, mat(PAL.darkgrey)))
        c.add(block(12.4, 1.4, 2.5, mat(PAL.yellow), { x: 0, y: 29, z: 14 }))                 // spreader
        c.position.x = x
        g.add(c)
    }
    // the container yard and a straddle carrier
    containerStack(g, { x0: -70, z0: -70, bays: 9, rows: 6, tiers: 4, y0: 3, gap: 1.2, seed: 17, fill: 0.7 })
    containerStack(g, { x0: 20, z0: -70, bays: 4, rows: 6, tiers: 3, y0: 3, gap: 1.2, seed: 29, fill: 0.6 })
    for (let i = 0; i < 4; i++) for (const s of [1, -1]) g.add(rod([60 + i * 0.01, 3, -54 + s * 5], [60, 18, -54 + s * 5], 0.4, mat(PAL.orange)))
    g.add(block(1.2, 1.2, 12, mat(PAL.orange), { x: 60, y: 17.5, z: -54 }))
    return { group: g, setting: "water", waterline: 0 }
}

export function airport() {
    const g = new THREE.Group()
    plinth(g, 200, 140, 0x6f7a62)
    // the runway with its markings, a taxiway
    g.add(block(220, 0.1, 30, mat(PAL.asphalt, { rough: 0.9 }), { x: 0, y: 0.02, z: 52 }))
    for (let i = 0; i < 16; i++) g.add(block(8, 0.12, 0.6, mat(PAL.white), { x: -96 + i * 13, y: 0.04, z: 52 }))
    for (let i = 0; i < 8; i++) for (const s of [1, -1]) g.add(block(18, 0.12, 1.4, mat(PAL.white), { x: -100, y: 0.04, z: 52 + s * (3 + i * 1.6) }))
    g.add(block(160, 0.08, 14, mat(0x3a3e43, { rough: 0.9 }), { x: 0, y: 0.02, z: 22 }))
    for (let i = 0; i < 20; i++) g.add(block(4, 0.1, 0.3, mat(PAL.yellow), { x: -76 + i * 8, y: 0.04, z: 22 }))
    // the apron and the terminal: glass front, a curved roof
    g.add(block(130, 0.06, 26, mat(0x8d9096, { rough: 0.9 }), { x: 0, y: 0.02, z: -4 }))
    g.add(block(110, 14, 26, mat(0x2a3d52, { metal: 0.8, rough: 0.1 }), { x: 0, z: -34 }))
    for (let i = 0; i <= 44; i++) g.add(block(0.3, 14, 0.4, mat(0xd5d9de, { metal: 0.6 }), { x: -55 + i * 2.5, z: -34 + 13.1 }))
    const arc = new THREE.Shape()
    arc.moveTo(-15, 0); arc.quadraticCurveTo(0, 9, 15, 0); arc.lineTo(15, -0.8); arc.quadraticCurveTo(0, 8, -15, -0.8); arc.closePath()
    const ag = new THREE.ExtrudeGeometry(arc, { depth: 116, bevelEnabled: false, curveSegments: 24 })
    ag.rotateY(Math.PI / 2); ag.translate(-58, 0, 0)
    g.add(mesh(ag, mat(0xd9dcdf, { metal: 0.6, rough: 0.3 }), { y: 14, z: -34 }))
    // jet bridges and two parked airliners
    for (const x of [-30, 20]) {
        g.add(block(4, 3, 18, mat(0xc9ccd0, { metal: 0.4 }), { x, y: 4, z: -12 }))
        for (const dz of [-6, 0]) g.add(rod([x, 0, -12 + dz], [x, 4, -12 + dz], 0.3, mat(PAL.grey)))
        const a = airliner().group; a.position.set(x + 2, 0, 12); a.rotation.y = Math.PI / 2 + 0.0; g.add(a)
    }
    // the control tower
    g.add(cyl(3.2, 4.2, 44, mat(PAL.offwhite, { rough: 0.6 }), { x: 70, y: 22, z: -30 }))
    g.add(cyl(7, 5, 3, mat(PAL.offwhite), { x: 70, y: 45.5, z: -30 }))
    g.add(cyl(7.2, 6.4, 5, mat(0x2a3d52, { metal: 0.8, rough: 0.1 }), { x: 70, y: 49.5, z: -30 }, 12))
    g.add(cyl(7.6, 7.6, 0.8, mat(PAL.offwhite), { x: 70, y: 52.4, z: -30 }))
    g.add(rod([70, 52.8, -30], [70, 60, -30], 0.2, mat(PAL.grey, { metal: 0.7 })))
    return { group: g, setting: "land", view: { azimuth: 0.62 } }
}

void hull; void rblock
