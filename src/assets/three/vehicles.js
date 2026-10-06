/**
 * vehicles.js — a truck and trailer, an SUV and an armoured vehicle; and
 * people (one, and a team of four).
 *
 * Bodies are side profiles extruded across the width and bevelled, so the
 * silhouettes read from any angle; glass is set into the body, wheels are
 * kit.wheel() (tyre, rim, hub).
 */
import * as THREE from "three"
import { PAL, mat, mesh, block, rblock, cyl, sphere, rod, wheel, GLASS } from "./kit.js"

/** Extrude a side profile [[x, y], …] across width w (centred on z = 0), bevelled.
 *  arches: [[x, r], …] wheel arches cut into the bottom edge (the first
 *  segment of the profile must be the bottom, running toward +x). */
function profile(points, w, material, { bevel = 0.06, x = 0, y = 0, z = 0, arches = [] } = {}) {
    const sh = new THREE.Shape()
    const [p0, p1] = points
    sh.moveTo(p0[0], p0[1])
    for (const [ax, ar] of [...arches].sort((a, b) => a[0] - b[0])) {
        sh.lineTo(ax - ar, p0[1])
        sh.absarc(ax, p0[1], ar, Math.PI, 0, true)
    }
    sh.lineTo(p1[0], p1[1])
    points.slice(2).forEach(([a, b]) => sh.lineTo(a, b))
    sh.closePath()
    const geo = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 8 })
    geo.translate(0, 0, -(w - 2 * bevel) / 2)
    return mesh(geo, material, { x, y, z })
}

export function truck() {
    const g = new THREE.Group()
    const cabC = mat(PAL.white, { metal: 0.35, rough: 0.3 })
    const dark = mat(PAL.darkgrey, { metal: 0.4, rough: 0.5 })
    const W = 2.5
    // the tractor: a cab-over cab with a sleeper, front toward +X
    g.add(profile([[0, 1.2], [2.25, 1.2], [2.35, 2.6], [2.2, 3.85], [0.1, 3.9], [0, 3.6]], W, cabC, { bevel: 0.12, x: 3.2, arches: [[1.4, 0.62]] }))
    g.add(profile([[0.1, 3.9], [2.0, 3.85], [1.9, 4.2], [0.2, 4.25]], W * 0.92, cabC, { bevel: 0.1, x: 3.2 }))   // roof spoiler
    // windscreen and side windows, the grille, lights, the bumper
    const ws = block(0.06, 1.15, W * 0.86, GLASS(), { x: 5.62, y: 2.45 }); ws.rotation.z = 0.07; g.add(ws)
    g.add(block(0.5, 0.12, W * 0.9, mat(PAL.darkgrey), { x: 5.62, y: 3.62 }))                 // sun visor
    for (let i = 0; i < 5; i++) g.add(block(0.08, 0.08, 0.18, mat(0xffb020, { emissive: 0xff9000, emissiveIntensity: 0.8 }), { x: 5.36, y: 3.92, z: -0.8 + i * 0.4 }))
    for (const s of [1, -1]) g.add(block(1.0, 0.9, 0.05, GLASS(), { x: 4.9, y: 2.6, z: s * (W / 2 + 0.01) }))
    g.add(block(0.06, 0.8, W * 0.62, dark, { x: 5.5, y: 1.55 }))
    for (let i = 0; i < 6; i++) g.add(block(0.08, 0.05, W * 0.6, mat(PAL.grey, { metal: 0.6 }), { x: 5.53, y: 1.6 + i * 0.12 }))
    for (const s of [1, -1]) {
        g.add(block(0.08, 0.22, 0.45, mat(0xfff4dc, { emissive: 0xfff0d0, emissiveIntensity: 0.5 }), { x: 5.52, y: 1.35, z: s * 0.85 }))
        g.add(rod([5.3, 2.9, s * 1.25], [5.55, 2.9, s * 1.55], 0.03, dark))           // mirror arm
        g.add(block(0.1, 0.55, 0.22, dark, { x: 5.6, y: 2.55, z: s * 1.55 }))          // mirror
    }
    g.add(block(0.35, 0.35, W, dark, { x: 5.45, y: 0.8 }))
    // chassis, fuel tanks, fifth wheel
    g.add(block(6.4, 0.35, 1.0, dark, { x: 2.6, y: 0.75 }))
    for (const s of [1, -1]) g.add(cyl(0.32, 0.32, 1.4, mat(PAL.grey, { metal: 0.8, rough: 0.25 }), { x: 2.5, y: 0.75, z: s * 0.95, axis: "x" }))
    g.add(cyl(0.6, 0.6, 0.12, dark, { x: 0.8, y: 1.15 }))
    for (const x of [4.6, 1.2]) for (const s of [1, -1]) g.add(wheel(0.52, 0.34, { x, y: 0.52, z: s * 1.06 }))
    // the trailer: a curtain-sider on three axles, a stripe along it
    const tr = mat(PAL.offwhite, { rough: 0.55 })
    g.add(block(13.6, 2.75, W, tr, { x: -5.4, y: 1.35 }))
    for (const s of [1, -1]) {
        g.add(block(13.4, 0.35, 0.03, mat(PAL.blue), { x: -5.4, y: 3.2, z: s * (W / 2 + 0.01) }))
        for (let k = 0; k < 12; k++) g.add(block(0.05, 2.6, 0.04, mat(PAL.grey), { x: -11.9 + k * 1.14, y: 1.42, z: s * (W / 2 + 0.01) }))
        g.add(block(13.6, 0.12, 0.04, mat(PAL.darkgrey), { x: -5.4, y: 1.2, z: s * (W / 2) }))
    }
    g.add(block(13.6, 0.3, 0.9, dark, { x: -5.4, y: 1.0 }))
    for (const x of [-9.0, -10.35, -11.7]) for (const s of [1, -1]) g.add(wheel(0.5, 0.3, { x, y: 0.5, z: s * 1.05 }))
    for (const s of [1, -1]) g.add(block(0.08, 0.15, 0.4, mat(0xc0201a, { emissive: 0x801010, emissiveIntensity: 0.6 }), { x: -12.25, y: 1.1, z: s * 0.9 }))
    g.add(block(0.3, 0.3, 0.3, dark, { x: -1.2, y: 0.55, z: 0.9 }))                   // landing leg
    g.add(block(0.3, 0.3, 0.3, dark, { x: -1.2, y: 0.55, z: -0.9 }))
    return { group: g, setting: "land" }
}

export function car() {
    const g = new THREE.Group()
    const paint = mat(0x46607e, { metal: 0.6, rough: 0.26 })
    const W = 1.95
    // an SUV: bonnet, raked windscreen, roof, a near-vertical tailgate
    g.add(profile([[-2.4, 0.42], [2.3, 0.42], [2.42, 0.6], [2.45, 0.82], [2.32, 1.02], [1.6, 1.12], [0.95, 1.2], [0.55, 1.48], [0.15, 1.72], [-0.4, 1.8], [-1.95, 1.8], [-2.3, 1.7], [-2.42, 1.45], [-2.45, 0.9], [-2.42, 0.55]], W, paint, { bevel: 0.16, arches: [[1.45, 0.47], [-1.5, 0.47]] }))
    g.add(block(4.7, 0.12, W * 0.9, mat(PAL.black, { rough: 0.8 }), { y: 0.36 }))       // the sills, black
    // the glasshouse: a dark band set into the body above the waistline
    g.add(profile([[0.85, 1.2], [0.15, 1.71], [-1.9, 1.75], [-2.3, 1.55], [-2.3, 1.22]], W + 0.02, mat(0x0f151c, { metal: 0.6, rough: 0.1 }), { bevel: 0.1 }))
    for (const x of [-0.4, -1.35]) g.add(block(0.08, 0.5, W + 0.06, paint, { x, y: 1.22 }))       // the pillars
    g.add(block(2.1, 0.06, 0.06, mat(PAL.grey, { metal: 0.7 }), { x: -0.9, y: 1.82, z: 0.75 }))    // roof rails
    g.add(block(2.1, 0.06, 0.06, mat(PAL.grey, { metal: 0.7 }), { x: -0.9, y: 1.82, z: -0.75 }))
    for (const s of [1, -1]) {
        g.add(block(0.08, 0.14, 0.4, mat(0xfff4dc, { emissive: 0xfff0d0, emissiveIntensity: 0.6 }), { x: 2.42, y: 0.88, z: s * 0.68 }))
        g.add(block(0.08, 0.16, 0.36, mat(0xc0201a, { emissive: 0x801010, emissiveIntensity: 0.6 }), { x: -2.46, y: 1.15, z: s * 0.72 }))
        g.add(block(0.18, 0.12, 0.14, paint, { x: 0.75, y: 1.15, z: s * (W / 2 + 0.08) }))           // mirrors
    }
    g.add(block(0.06, 0.25, 1.1, mat(PAL.darkgrey, { metal: 0.6 }), { x: 2.46, y: 0.72 }))         // grille
    for (const x of [1.45, -1.5]) for (const s of [1, -1]) g.add(wheel(0.39, 0.28, { x, y: 0.39, z: s * (W / 2 - 0.16) }))
    return { group: g, setting: "land" }
}

export function armoured() {
    const g = new THREE.Group()
    const sand = mat(0x8a7f5c, { metal: 0.25, rough: 0.6, flat: true })
    const dark = mat(PAL.darkgrey, { metal: 0.4, rough: 0.6 })
    const W = 2.6
    // a V-shaped lower hull and an angular armoured cab
    const vh = new THREE.Shape()
    vh.moveTo(-W / 2 + 0.35, 1.0); vh.lineTo(-0.35, 0.62); vh.lineTo(0.35, 0.62); vh.lineTo(W / 2 - 0.35, 1.0); vh.lineTo(W / 2 - 0.35, 1.45); vh.lineTo(-W / 2 + 0.35, 1.45); vh.closePath()
    const vg = new THREE.ExtrudeGeometry(vh, { depth: 6.2, bevelEnabled: false })
    vg.rotateY(Math.PI / 2); vg.translate(-3.1, 0, 0)
    g.add(mesh(vg, sand))
    g.add(profile([[-3.1, 1.3], [2.3, 1.3], [3.05, 1.6], [2.7, 2.35], [1.6, 3.05], [-3.1, 3.05]], W, sand, { bevel: 0.05, arches: [[1.95, 0.85], [-1.95, 0.85]] }))
    // thick slit windows, the windscreen, the turret with its gun
    const aw = block(0.08, 0.45, W * 0.75, GLASS(), { x: 2.25, y: 2.38 }); aw.rotation.z = 0.55; g.add(aw)
    for (const s of [1, -1]) for (const x of [1.0, -0.4, -1.8]) g.add(block(0.75, 0.38, 0.05, GLASS(), { x, y: 2.25, z: s * (W / 2 + 0.01) }))
    g.add(cyl(0.75, 0.85, 0.35, sand, { x: -0.6, y: 3.12 }))
    g.add(rblock(1.2, 0.55, 1.1, 0.1, sand, { x: -0.6, y: 3.3 }))
    g.add(rod([-0.1, 3.6, 0], [1.6, 3.65, 0], 0.07, dark))
    g.add(block(0.3, 0.25, 0.3, dark, { x: 0.05, y: 3.5 }))
    // rear door, grab rails, spare wheel, mirrors
    g.add(block(0.06, 1.3, 1.1, mat(0x7e7454, { rough: 0.6 }), { x: -3.13, y: 1.45 }))
    g.add(wheel(0.55, 0.38, { x: -3.45, y: 2.15, z: 0 }).rotateY(Math.PI / 2))
    for (const s of [1, -1]) g.add(rod([-2.8, 2.95, s * 1.1], [-0.2, 2.95, s * 1.1], 0.04, dark))
    for (const x of [1.95, -1.95]) for (const s of [1, -1]) g.add(wheel(0.72, 0.5, { x, y: 0.72, z: s * 1.22 }))
    return { group: g, setting: "land" }
}

/** One person: proportioned figure ~1.78 m, in the given clothes. */
function figure({ x = 0, z = 0, ry = 0, top = PAL.navy, legs = 0x2b2f36, skin = 0xc69a7a, hair = 0x2a1f18, vest = null, pose = 0 } = {}) {
    const g = new THREE.Group()
    const L = mat(legs, { rough: 0.8 }), T = mat(top, { rough: 0.75 }), S = mat(skin, { rough: 0.6 }), H = mat(hair, { rough: 0.9 })
    const cap = (r, len, m, o) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m, o)
    for (const s of [1, -1]) {
        g.add(cap(0.075, 0.72, L, { x: 0, y: 0.48, z: s * 0.1, rz: s * pose * 0.08 }))
        g.add(block(0.26, 0.09, 0.11, mat(0x1c1c1c), { x: 0.05, y: 0, z: s * 0.1 }))             // shoes
        g.add(cap(0.058, 0.52, T, { x: 0.02, y: 1.16, z: s * 0.27, rx: s * (0.1 + pose * 0.3) }))
        g.add(sphere(0.055, S, { x: 0.03, y: 0.86, z: s * (0.29 + pose * 0.08) }, 10))
    }
    const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.38, 8, 18), T, { y: 1.18 })
    torso.scale.set(0.82, 1, 1.32)
    g.add(torso)
    g.add(mesh(new THREE.CapsuleGeometry(0.15, 0.08, 6, 14), L, { y: 0.92, sx: 0.85, sz: 1.3 }))    // hips
    if (vest) g.add(rblock(0.28, 0.42, 0.46, 0.08, mat(vest, { emissive: vest, emissiveIntensity: 0.15, rough: 0.6 }), { y: 1.06 }))
    g.add(cyl(0.05, 0.055, 0.1, S, { y: 1.58 }))
    g.add(sphere(0.115, S, { y: 1.71 }, 20))
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), H)
    hairCap.position.set(-0.01, 1.73, 0); hairCap.rotation.z = 0.25; hairCap.castShadow = true
    g.add(hairCap)
    g.position.set(x, 0, z); g.rotation.y = ry
    return g
}

export function person() {
    const g = new THREE.Group()
    g.add(figure({ top: PAL.navy, vest: null }))
    // a lanyard and a phone: someone at work
    g.add(block(0.03, 0.25, 0.08, mat(PAL.white), { x: 0.14, y: 1.15 }))
    g.add(block(0.02, 0.14, 0.07, mat(PAL.black, { metal: 0.6, rough: 0.2 }), { x: 0.2, y: 0.95, z: 0.29 }))
    return { group: g, setting: "land" }
}

export function team() {
    const g = new THREE.Group()
    g.add(figure({ x: 0, z: 0, ry: -0.2, top: PAL.navy }))
    g.add(figure({ x: -0.55, z: 0.75, ry: 0.35, top: 0x5a6b4a, legs: 0x3b3a33, skin: 0x8d5e3e, hair: 0x111111, vest: 0xd9ff2b }))
    g.add(figure({ x: -0.6, z: -0.8, ry: -0.6, top: 0xd9dcdf, legs: 0x23324a, skin: 0xe2b896, hair: 0x6b4a2a, pose: 1 }))
    g.add(figure({ x: -1.3, z: 0.05, ry: 0.1, top: 0x7a2f2f, legs: 0x2b2f36, skin: 0xb07a55, hair: 0x2a1f18 }))
    return { group: g, setting: "land" }
}

void rod
