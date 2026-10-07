/**
 * ships.js — seven vessel types, each in its own proportions.
 *
 * Built on kit.hull(): the hull sets the deck line, everything else stands
 * on it. Dimensions are those of a typical ship of the type (an Aframax
 * tanker, a Panamax container ship, a Supramax bulker, a Moss LNG carrier,
 * a coaster, a platform supply vessel, a 70 m motor yacht).
 */
import * as THREE from "three"
import { PAL, mat, mesh, block, rblock, cyl, sphere, rod, windows, hull, containerStack, GLASS } from "./kit.js"

const steel = () => mat(PAL.steel, { metal: 0.55, rough: 0.45 })
const white = () => mat(PAL.white, { rough: 0.5 })

/** Deck height at x along a hull of length L (the hull's own sheer). */
const deckY = (h, x) => h.userData.deckAt(x / h.userData.L + 0.5)

/** The accommodation: one house of `decks` decks with deck lines and rows of
 *  windows, the enclosed bridge on top with a band of glass, open bridge wings
 *  out to the ship's side, the monkey island with mast and radar, and the
 *  funnel just aft. x is the after end of the house. */
function accommodation(g, { x, y, len, wid, decks, deckH = 2.9, color = PAL.white, beam, funnel = true, funnelColor = PAL.orange, mast = true }) {
    const m = mat(color, { rough: 0.5 })
    const trim = mat(PAL.offwhite, { rough: 0.55 })
    const H = decks * deckH
    const cx = x + len / 2
    g.add(rblock(len, H, wid, 0.4, m, { x: cx, y }))
    for (let i = 1; i < decks; i++) g.add(block(len + 0.25, 0.16, wid + 0.25, trim, { x: cx, y: y + i * deckH - 0.08 }))
    for (let i = 0; i < decks; i++) {
        windows(g, { cx, cz: 0, y0: y + i * deckH, w: len, h: deckH, d: wid }, { faces: ["+x", "+z", "-z", "-x"], rowH: deckH, colW: 2.3, paneW: 1.25, paneH: 1.05, sill: 1.2, top: 0.5, lit: 0.22, seed: i * 7 + 3 })
    }
    // the bridge: a deck taller, glass all round its front and sides
    const top = y + H
    const bl = len * 0.7, bx = x + len - bl / 2
    g.add(rblock(bl, deckH * 1.15, wid, 0.3, m, { x: bx, y: top }))
    g.add(block(0.14, deckH * 0.6, wid * 0.96, GLASS(), { x: bx + bl / 2 + 0.04, y: top + deckH * 0.42 }))
    for (const sgn of [1, -1]) g.add(block(bl * 0.9, deckH * 0.6, 0.14, GLASS(), { x: bx, y: top + deckH * 0.42, z: sgn * (wid / 2 + 0.04) }))
    // open wings to the ship's side, with a bulwark and a little wheelhouse console at the end
    const span = (beam || wid * 1.2) / 2
    for (const sgn of [1, -1]) {
        g.add(block(bl * 0.32, 0.3, span - wid / 2, trim, { x: bx + bl * 0.34, y: top + deckH * 0.05, z: sgn * (wid / 2 + (span - wid / 2) / 2) }))
        g.add(block(bl * 0.32, 1.1, 0.18, m, { x: bx + bl * 0.34, y: top + deckH * 0.05 + 0.3, z: sgn * span }))
        g.add(block(1.2, 1.2, 1.2, m, { x: bx + bl * 0.34, y: top + deckH * 0.05 + 0.3, z: sgn * (span - 0.8) }))
    }
    g.add(block(bl + 0.6, 0.3, wid + 0.6, trim, { x: bx + 0.2, y: top + deckH * 1.15 }))   // the roof, a little proud
    const roof = top + deckH * 1.15 + 0.3
    if (mast) {
        const mx = bx + bl * 0.1
        const sm = mat(PAL.offwhite, { metal: 0.5, rough: 0.4 })
        g.add(rod([mx, roof, 0], [mx, roof + 10, 0], 0.28, sm))
        g.add(rod([mx, roof + 7, -3.2], [mx, roof + 7, 3.2], 0.13, sm))
        g.add(rod([mx - 2, roof, -1.5], [mx, roof + 7, 0], 0.1, sm)); g.add(rod([mx - 2, roof, 1.5], [mx, roof + 7, 0], 0.1, sm))
        g.add(sphere(0.35, mat(0xff4030, { emissive: 0xff2010, emissiveIntensity: 0.6 }), { x: mx, y: roof + 10.3 }, 10))
        for (const [dx, wR] of [[3.2, 2.2], [-1.6, 1.6]]) {
            g.add(cyl(0.35, 0.35, 1.2, mat(PAL.darkgrey), { x: mx + dx, y: roof + 0.6 }))
            g.add(block(wR * 2, 0.22, 0.45, mat(PAL.white), { x: mx + dx, y: roof + 1.25 }))      // radar scanners
        }
    }
    if (funnel) {
        const fh = deckH * 2.6, fx = x - 1, fy = top - deckH * 0.8
        const prof = new THREE.Shape()
        prof.moveTo(-4.6, 0); prof.lineTo(2.4, 0); prof.lineTo(1.4, fh); prof.lineTo(-5.4, fh); prof.closePath()
        const fg = new THREE.ExtrudeGeometry(prof, { depth: wid * 0.3, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5, bevelSegments: 4 })
        fg.translate(0, 0, -wid * 0.15)
        g.add(mesh(fg, mat(funnelColor, { rough: 0.45 }), { x: fx, y: fy }))
        const band = new THREE.ExtrudeGeometry(prof, { depth: wid * 0.3 + 1.1, bevelEnabled: false })
        band.translate(0, 0, -wid * 0.15 - 0.55)
        g.add(mesh(band, mat(PAL.black, { rough: 0.6 }), { x: fx, y: fy + fh * 0.84, sy: 0.16 }))
        for (const dz of [-1.3, 1.3]) g.add(cyl(0.75, 0.75, 2.4, mat(PAL.black), { x: fx - 2, y: fy + fh + 1.2, z: dz }))
    }
    return roof
}

/** A deck crane: pedestal, cab, and a jib raised toward the bow. */
function deckCrane(g, x, y, z, { jib = 26, angle = 0.62, swing = 0, color = PAL.yellow } = {}) {
    const m = mat(color, { rough: 0.45, metal: 0.2 })
    g.add(cyl(1.6, 1.9, 6, m, { x, y: y + 3, z }))
    const cab = rblock(4.6, 3.6, 3.6, 0.3, m, { x, y: y + 6, z, ry: swing })
    g.add(cab)
    g.add(block(1.2, 1.2, 3.5, GLASS(), { x: x + 1.9 * Math.cos(swing), y: y + 7.2, z: z - 1.9 * Math.sin(swing) }))
    const dx = Math.cos(angle) * jib * Math.cos(swing), dy = Math.sin(angle) * jib, dz = -Math.cos(angle) * jib * Math.sin(swing)
    g.add(rod([x, y + 7.5, z + 0.8], [x + dx, y + 7.5 + dy, z + dz + 0.3], 0.38, m))
    g.add(rod([x, y + 7.5, z - 0.8], [x + dx, y + 7.5 + dy, z + dz - 0.3], 0.38, m))
    g.add(rod([x - 1, y + 9.6, z], [x + dx, y + 7.5 + dy, z + dz], 0.08, mat(PAL.darkgrey)))
    g.add(rod([x + dx, y + 7.5 + dy, z + dz], [x + dx, y + 7.5 + dy - 9, z + dz], 0.05, mat(PAL.darkgrey)))
    g.add(block(1.2, 0.9, 1.2, mat(PAL.darkgrey), { x: x + dx, y: y + 7.5 + dy - 10, z: z + dz }))
}

/** Railings along both sides between two x (thin posts and two rails). */
function rails(g, h, x0, x1, { inset = 0.4, step = 2.2, height = 1.1 } = {}) {
    const m = mat(PAL.offwhite, { metal: 0.4, rough: 0.4 })
    const L = h.userData.L
    for (const s of [1, -1]) {
        let prev = null
        for (let x = x0; x <= x1; x += step) {
            const u = x / L + 0.5, y = h.userData.deckAt(u), z = s * (h.userData.halfW(u) - inset)
            g.add(rod([x, y, z], [x, y + height, z], 0.04, m, 5))
            if (prev) { g.add(rod([prev[0], prev[1] + height, prev[2]], [x, y + height, z], 0.035, m, 5)); g.add(rod([prev[0], prev[1] + height * 0.5, prev[2]], [x, y + height * 0.5, z], 0.03, m, 5)) }
            prev = [x, y, z]
        }
    }
}

/** Anchors stowed in their hawse pipes, one each side of the bow. */
function anchors(g, h) {
    const { L, D } = h.userData
    const x = L / 2 - L * 0.07, u = x / L + 0.5
    const z = h.userData.halfW(u) + 0.05
    for (const sgn of [1, -1]) {
        g.add(cyl(D * 0.07, D * 0.07, 0.3, mat(PAL.black), { x, y: D * 0.78, z: sgn * z, axis: "z" }))
        const a = new THREE.Group()
        a.add(block(D * 0.05, D * 0.22, 0.3, mat(PAL.darkgrey, { metal: 0.6, rough: 0.5 })))
        a.add(block(D * 0.18, D * 0.05, 0.4, mat(PAL.darkgrey, { metal: 0.6, rough: 0.5 }), { y: -D * 0.02 }))
        a.position.set(x - D * 0.02, D * 0.56, sgn * (z + 0.15))
        a.rotation.z = 0.12
        g.add(a)
    }
}

function forecastle(g, h, { len = 18, height = 2.6 }) {
    anchors(g, h)
    const L = h.userData.L
    const x0 = L / 2 - len
    const shape = new THREE.Shape()
    const N = 16
    for (let i = 0; i <= N; i++) { const x = x0 + (len * i) / N; const w = h.userData.halfW(x / L + 0.5) * 0.98; i ? shape.lineTo(x, w) : shape.moveTo(x, w) }
    for (let i = N; i >= 0; i--) { const x = x0 + (len * i) / N; shape.lineTo(x, -h.userData.halfW(x / L + 0.5) * 0.98) }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
    geo.rotateX(-Math.PI / 2)
    g.add(mesh(geo, mat(h.userData.hullColor, { rough: 0.42, metal: 0.3 }), { y: deckY(h, x0) - 0.05 }))
    const cap = new THREE.ShapeGeometry(shape)
    cap.rotateX(-Math.PI / 2)
    g.add(mesh(cap, mat(h.userData.deckColor, { rough: 0.85 }), { y: deckY(h, x0) - 0.05 + height + 0.02 }))
    // the white sheer line carries on round the forecastle
    const rim = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false })
    rim.rotateX(-Math.PI / 2)
    g.add(mesh(rim, mat(PAL.white, { rough: 0.5 }), { y: deckY(h, x0) - 0.05 + height - 0.35, sx: 1.002, sz: 1.01 }))
    // windlass and bollards
    for (const z of [-3, 3]) g.add(cyl(0.9, 0.9, 1.6, steel(), { x: L / 2 - len * 0.55, y: deckY(h, x0) + height + 0.8, z, axis: "z" }))
}

export function tanker() {
    const g = new THREE.Group()
    const L = 245, B = 44, D = 21, T = 13
    const h = hull({ L, B, D, T, color: PAL.navy, deck: PAL.deckred, entry: 0.2, run: 0.1, transom: 0.82 })
    g.add(h)
    forecastle(g, h, { len: 20 })
    // cargo deck: three longitudinal pipes, a raised catwalk, tank domes and the midships manifold
    const x0 = -L / 2 + 42, x1 = L / 2 - 22
    const pm = mat(PAL.offwhite, { metal: 0.45, rough: 0.35 })
    for (const z of [-4.5, -2.5, 2.5, 4.5]) g.add(rod([x0, D + 1.4, z], [x1, D + 1.4, z], 0.45, pm))
    g.add(block(x1 - x0, 0.25, 1.6, mat(PAL.green, { rough: 0.8 }), { x: (x0 + x1) / 2, y: D + 2.6 }))       // catwalk
    for (let x = x0; x < x1; x += 6) g.add(rod([x, D, 0], [x, D + 2.6, 0], 0.12, pm, 6))
    for (let x = x0 + 8; x < x1 - 6; x += 22) for (const z of [-12, 12]) {
        g.add(cyl(1.4, 1.6, 1.6, pm, { x, y: D + 0.8, z }))
        g.add(rod([x, D + 1.4, z], [x, D + 1.4, z > 0 ? 4.5 : -4.5], 0.25, pm))
    }
    for (const z of [-16, -10, 10, 16]) g.add(rod([-6, D + 1.4, z], [6, D + 1.4, z], 0.5, mat(PAL.red, { metal: 0.3 })))
    for (const x of [-6, 0, 6]) g.add(rod([x, D + 1.4, -20], [x, D + 1.4, 20], 0.55, mat(PAL.red, { metal: 0.3 })))
    for (const z of [-15, 15]) deckCrane(g, 0, D, z, { jib: 16, angle: 0.75, swing: z > 0 ? 1.8 : -1.8, color: PAL.white })
    rails(g, h, -L / 2 + 6, L / 2 - 24, { step: 4 })
    accommodation(g, { x: -L / 2 + 12, y: deckY(h, -L / 2 + 22), len: 24, wid: B * 0.72, beam: B * 0.98, decks: 5, funnelColor: PAL.red })
    return { group: g, setting: "water", waterline: 0 + T }
}

export function containerShip() {
    const g = new THREE.Group()
    const L = 290, B = 32.2, D = 24, T = 12
    const h = hull({ L, B, D, T, color: PAL.blue, deck: PAL.darkgrey, entry: 0.3, run: 0.14, transom: 0.86, rake: 0.5 })
    g.add(h)
    forecastle(g, h, { len: 22, height: 3.4 })
    const accX = -L / 2 + 48
    const top = accommodation(g, { x: accX, y: deckY(h, accX + 10), len: 16, wid: B * 0.78, beam: B, decks: 8, color: PAL.white, funnel: false })
    // the funnel stands alone aft of the accommodation on modern ships
    const fx = -L / 2 + 22
    g.add(rblock(10, 18, 12, 1.2, mat(PAL.white), { x: fx, y: deckY(h, fx) }))
    g.add(block(10.4, 3, 12.4, mat(PAL.blue), { x: fx, y: deckY(h, fx) + 12 }))
    g.add(block(10.4, 1.6, 12.4, mat(PAL.black), { x: fx, y: deckY(h, fx) + 18 }))
    // bays: 40 ft containers, 12 across, stacked to the bridge's sightline forward of it, fuller aft
    const rows = 12, z0 = -((rows - 1) * 2.5) / 2
    const bayLen = 12.2 + 1.8
    for (let bx = -L / 2 + 34; bx < L / 2 - 30; bx += bayLen) {
        if (bx > accX - 8 && bx < accX + 18) continue
        if (bx > fx - 8 && bx < fx + 8) continue
        const u = bx / L + 0.5
        const narrowing = Math.min(1, (h.userData.halfW(u + 12 / L) * 2) / B)
        const r = Math.max(4, Math.round(rows * narrowing))
        const tiers = bx > accX ? 6 : 7
        containerStack(g, { x0: bx, z0: z0 + ((rows - r) * 2.5) / 2, bays: 1, rows: r, tiers, y0: deckY(h, bx) + 0.6, wid: 2.44, seed: Math.round(bx) + 500, fill: 0.86 })
        // lashing bridge
        g.add(block(0.8, 5.5, B * 0.9 * narrowing, mat(PAL.darkgrey, { metal: 0.5 }), { x: bx - 1.2, y: deckY(h, bx) }))
    }
    void top
    return { group: g, setting: "water" }
}

export function bulkCarrier() {
    const g = new THREE.Group()
    const L = 199, B = 32.2, D = 18.5, T = 12
    const h = hull({ L, B, D, T, color: PAL.black, deck: PAL.deckred, entry: 0.18, run: 0.1 })
    g.add(h)
    forecastle(g, h, { len: 16 })
    const holds = 5, x0 = -L / 2 + 40, span = L - 40 - 22
    const step = span / holds
    for (let i = 0; i < holds; i++) {
        const x = x0 + step * i + step / 2
        const y = deckY(h, x)
        const coaming = block(step * 0.7, 1.8, B * 0.56, mat(PAL.deckred, { rough: 0.7 }), { x, y })
        g.add(coaming)
        // the hatch cover: two folding halves with ribs
        for (const s of [-1, 1]) {
            const hc = rblock(step * 0.34, 1.0, B * 0.6, 0.35, mat(PAL.deckgreen, { rough: 0.6 }), { x: x + s * step * 0.175, y: y + 1.8 })
            g.add(hc)
            for (let r = -2; r <= 2; r++) g.add(block(0.25, 0.3, B * 0.6, mat(PAL.deckgreen, { rough: 0.6 }), { x: x + s * step * 0.175 + r * step * 0.06, y: y + 2.8 }))
        }
        if (i < holds - 1) deckCrane(g, x + step / 2, deckY(h, x + step / 2), 0, { jib: 28, angle: 0.55, swing: Math.PI * (i % 2 ? 0.08 : -0.08) })
    }
    rails(g, h, -L / 2 + 8, L / 2 - 18, { step: 4 })
    accommodation(g, { x: -L / 2 + 12, y: deckY(h, -L / 2 + 20), len: 20, wid: B * 0.74, beam: B * 0.98, decks: 5, funnelColor: PAL.blue })
    return { group: g, setting: "water" }
}

export function lngCarrier() {
    const g = new THREE.Group()
    const L = 290, B = 48, D = 27, T = 11.5
    const h = hull({ L, B, D, T, color: PAL.navy, deck: PAL.deckgreen, entry: 0.24, run: 0.12 })
    g.add(h)
    forecastle(g, h, { len: 22, height: 3 })
    // four Moss spheres: the top half shows above a cylindrical skirt
    const r = 19.5, cover = mat(PAL.offwhite, { rough: 0.45, metal: 0.2 })
    const xs = [-56, -10, 36, 82]
    for (const x of xs) {
        g.add(cyl(r * 1.0, r * 1.02, 6, mat(PAL.deckgreen, { rough: 0.6 }), { x, y: D + 3 }, 48))
        const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), cover)
        dome.position.set(x, D + 6, 0); dome.castShadow = true; dome.receiveShadow = true
        g.add(dome)
        g.add(cyl(1.6, 1.6, 2.4, steel(), { x, y: D + 6 + r + 0.9 }))                    // the dome's tower
        // equator stiffening band
        g.add(mesh(new THREE.TorusGeometry(r * 0.98, 0.35, 8, 64), mat(PAL.grey), { x, y: D + 6.5, rx: Math.PI / 2 }))
    }
    // the trunk: a pipe rack running over the spheres along the centreline
    const pm = mat(PAL.grey, { metal: 0.5, rough: 0.4 })
    for (const dz of [-1.2, 0, 1.2]) g.add(rod([-80, D + 6 + r + 1.6, dz], [104, D + 6 + r + 1.6, dz], 0.4, pm))
    for (const x of [-80, ...xs.map((v) => v + 23)]) g.add(rod([x, D, 0], [x, D + 6 + r + 1.6, 0], 0.5, pm))
    rails(g, h, -L / 2 + 8, L / 2 - 24, { step: 5 })
    accommodation(g, { x: -L / 2 + 12, y: deckY(h, -L / 2 + 22), len: 24, wid: B * 0.66, beam: B * 0.96, decks: 6, funnelColor: PAL.blue })
    return { group: g, setting: "water" }
}

export function generalCargo() {
    const g = new THREE.Group()
    const L = 120, B = 20, D = 10, T = 7.2
    const h = hull({ L, B, D, T, color: PAL.green, deck: PAL.deckred, entry: 0.22, run: 0.14, sheer: 0.1 })
    g.add(h)
    forecastle(g, h, { len: 12, height: 2.4 })
    const x0 = -L / 2 + 28
    for (let i = 0; i < 2; i++) {
        const x = x0 + 18 + i * 34
        g.add(block(26, 1.4, B * 0.6, mat(PAL.deckgreen), { x, y: deckY(h, x) }))
        for (let r = -5; r <= 5; r++) g.add(block(0.2, 0.25, B * 0.6, mat(PAL.deckgreen), { x: x + r * 2.4, y: deckY(h, x) + 1.4 }))
    }
    deckCrane(g, x0 + 35, deckY(h, x0 + 35), B * 0.3, { jib: 18, angle: 0.7, swing: 0.4, color: PAL.yellow })
    deckCrane(g, x0 + 35, deckY(h, x0 + 35), -B * 0.3, { jib: 18, angle: 0.7, swing: -0.5, color: PAL.yellow })
    rails(g, h, -L / 2 + 4, L / 2 - 14, { step: 3 })
    accommodation(g, { x: -L / 2 + 6, y: deckY(h, -L / 2 + 12), len: 13, wid: B * 0.74, beam: B * 0.98, decks: 3, deckH: 2.7, funnelColor: PAL.red })
    return { group: g, setting: "water" }
}

export function offshoreSupply() {
    const g = new THREE.Group()
    const L = 86, B = 19, D = 8, T = 6
    const h = hull({ L, B, D, T, color: PAL.orange, deck: PAL.darkgrey, entry: 0.32, run: 0.05, transom: 0.95, rake: 0.6, sheer: 0.2 })
    g.add(h)
    // the superstructure sits forward; the long low deck aft carries the cargo
    anchors(g, h)
    const sx = L / 2 - 19, sl = 18, sw = B * 0.94
    const m = mat(PAL.white)
    const y0 = deckY(h, sx)
    // the house: a box with chamfered front corners near the bow
    const shape = new THREE.Shape()
    shape.moveTo(-sl / 2, -sw / 2); shape.lineTo(sl / 2 - 2.5, -sw / 2); shape.lineTo(sl / 2, -sw / 2 + 2.5)
    shape.lineTo(sl / 2, sw / 2 - 2.5); shape.lineTo(sl / 2 - 2.5, sw / 2); shape.lineTo(-sl / 2, sw / 2); shape.closePath()
    const hg = new THREE.ExtrudeGeometry(shape, { depth: 8.4, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 3, curveSegments: 20 })
    hg.rotateX(-Math.PI / 2)
    g.add(mesh(hg, m, { x: sx, y: y0 }))
    for (let i = 1; i < 3; i++) {
        const lg = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 20 })
        lg.rotateX(-Math.PI / 2)
        g.add(mesh(lg, mat(PAL.offwhite), { x: sx, y: y0 + i * 2.8, sx: 1.02, sz: 1.03 }))
    }
    windows(g, { cx: sx - 1.5, cz: 0, y0, w: sl - 3 + 0.7, h: 8.4, d: sw + 0.7 }, { faces: ["+z", "-z", "-x"], rowH: 2.8, colW: 2.0, paneW: 1.3, paneH: 1.0, sill: 1.2, top: 0.4, lit: 0.2, seed: 5 })
    // the bridge: glass all round (it works the aft deck as much as the bow)
    const by = y0 + 8.7
    const bridge = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false, curveSegments: 20 })
    bridge.rotateX(-Math.PI / 2)
    g.add(mesh(bridge, m, { x: sx + 1, y: by, sx: 0.78, sz: 0.86 }))
    const band = new THREE.ExtrudeGeometry(shape, { depth: 1.3, bevelEnabled: false, curveSegments: 20 })
    band.rotateX(-Math.PI / 2)
    g.add(mesh(band, GLASS(), { x: sx + 1, y: by + 0.8, sx: 0.79, sz: 0.875 }))
    const roof = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 20 })
    roof.rotateX(-Math.PI / 2)
    g.add(mesh(roof, mat(PAL.offwhite), { x: sx + 1, y: by + 2.6, sx: 0.84, sz: 0.92 }))
    const y = by + 2.9
    // cargo rails and deck cargo
    for (const s of [1, -1]) g.add(block(L * 0.55, 1.4, 0.4, mat(PAL.yellow), { x: -L / 2 + L * 0.3, y: deckY(h, -10), z: s * (B / 2 - 0.6) }))
    const cargo = [[-30, -4, PAL.blue], [-30, 3, PAL.red], [-20, -3, PAL.green], [-12, 4, PAL.orange], [-38, 0, PAL.offwhite]]
    for (const [x, z, c] of cargo) g.add(block(6, 2.6, 2.6, mat(c, { rough: 0.7 }), { x, y: deckY(h, x), z }))
    for (const z of [-4, 4]) g.add(cyl(1.2, 1.2, 9, mat(PAL.grey, { metal: 0.6 }), { x: -6, y: deckY(h, -6) + 1.2, z, axis: "x" }))
    deckCrane(g, -L / 2 + 8, deckY(h, -L / 2 + 8), 5.5, { jib: 12, angle: 0.5, swing: 2.6, color: PAL.yellow })
    return { group: g, setting: "water" }
}

export function yacht() {
    const g = new THREE.Group()
    const L = 70, B = 12, D = 6.2, T = 3.6
    const h = hull({ L, B, D, T, color: PAL.white, deck: PAL.teak, entry: 0.42, run: 0.14, transom: 0.86, rake: 1.2, sheer: 0.18 })
    g.add(h)
    // three decks of superstructure, each shorter and swept back. Each is a
    // white deck slab, a recessed band of dark glass all round, and a white
    // overhang above it — the look of a motor yacht is these bands.
    const m = mat(PAL.white, { rough: 0.3, metal: 0.1 })
    const tint = mat(0x0d141b, { metal: 0.8, rough: 0.08 })
    const decks = [[-24, 34, 0.9], [-19, 26, 0.8], [-13, 16, 0.66]]
    let y = deckY(h, 0)
    const outline = (x0, len, wf) => {
        const sh = new THREE.Shape(), w = (B * wf) / 2
        sh.moveTo(x0, -w); sh.lineTo(x0 + len * 0.68, -w); sh.bezierCurveTo(x0 + len * 0.92, -w, x0 + len, -w * 0.45, x0 + len, 0)
        sh.bezierCurveTo(x0 + len, w * 0.45, x0 + len * 0.92, w, x0 + len * 0.68, w); sh.lineTo(x0, w); sh.closePath()
        return sh
    }
    const slab = (sh, depth) => { const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 24 }); geo.rotateX(-Math.PI / 2); return geo }
    for (const [x0, len, wf] of decks) {
        const sh = outline(x0, len, wf)
        g.add(mesh(slab(sh, 0.7), m, { y }))                                     // the deck slab
        g.add(mesh(slab(outline(x0 + 0.6, len - 1.6, wf * 0.92), 1.6), tint, { y: y + 0.7 }))   // glass, set back
        g.add(mesh(slab(outline(x0 - 0.8, len + 0.6, wf * 1.02), 0.45), m, { y: y + 2.3 }))      // the overhang
        y += 2.75
    }
    // hull windows: a long dark slit each side in the topsides
    for (const sgn of [1, -1]) {
        const x0 = -12, x1 = 18, u = 0.5
        g.add(block(x1 - x0, 0.7, 0.12, tint, { x: (x0 + x1) / 2, y: D * 0.62, z: sgn * (h.userData.halfW(u) + 0.02) }))
    }
    // sun deck: radar arch, a hardtop and the tender aft
    g.add(rod([-6, y, -3.5], [-3, y + 4, 0], 0.35, m)); g.add(rod([-6, y, 3.5], [-3, y + 4, 0], 0.35, m))
    g.add(cyl(0.9, 0.9, 0.3, mat(PAL.white), { x: -3, y: y + 4.2 }))
    g.add(block(12, 0.3, B * 0.6, m, { x: -8, y: y + 2.6 }))
    for (const [x, z] of [[-13, -3], [-13, 3], [-3, -3], [-3, 3]]) g.add(rod([x, y, z], [x, y + 2.6, z], 0.12, m))
    const tender = hull({ L: 9, B: 3.2, D: 1.3, T: 0.5, color: PAL.offwhite, deck: PAL.teak, entry: 0.4 })
    tender.position.set(-27, deckY(h, -27) + 0.3, 0)
    g.add(tender)
    rails(g, h, -L / 2 + 2, L / 2 - 6, { step: 1.8, height: 1.0 })
    return { group: g, setting: "water" }
}

/** A ro-pax ferry: a tall white block of passenger decks on a short, full
 *  hull, lifeboats along both sides, the funnel aft and the bow visor. */
export function passengerShip() {
    const g = new THREE.Group()
    const L = 186, B = 28, D = 14, T = 6.5
    const h = hull({ L, B, D, T, color: PAL.white, deck: PAL.darkgrey, entry: 0.26, run: 0.08, transom: 0.92, rake: 0.5, sheer: 0.04 })
    g.add(h)
    anchors(g, h)
    // a blue hull band below the sheer, and the vehicle-deck doors in it
    for (const sgn of [1, -1]) {
        g.add(block(L * 0.86, 2.2, 0.14, mat(PAL.blue, { rough: 0.4 }), { x: -L * 0.02, y: D * 0.55, z: sgn * (B / 2 + 0.03) }))
        for (const x of [-60, 40]) g.add(block(10, 5, 0.12, mat(0xb9bdc2), { x, y: D * 0.62, z: sgn * (B / 2 + 0.05) }))
    }
    // passenger decks: each a white slab with a window band, stepping back toward the bow
    const m = mat(PAL.white, { rough: 0.45 })
    const decks = 6, dh = 2.9, y0 = deckY(h, 0)
    for (let i = 0; i < decks; i++) {
        const x0 = -L / 2 + 14 + i * 1.5, x1 = L / 2 - 30 - i * 2.4, w = B * (0.98 - i * 0.015)
        const cx = (x0 + x1) / 2, len = x1 - x0
        g.add(rblock(len, dh, w, 0.4, m, { x: cx, y: y0 + i * dh }))
        windows(g, { cx, cz: 0, y0: y0 + i * dh, w: len, h: dh, d: w }, { faces: ["+z", "-z", "+x"], rowH: dh, colW: 2.0, paneW: 1.5, paneH: 1.2, sill: 1.1, top: 0.4, lit: 0.3, seed: i * 5 + 2 })
        g.add(block(len + 0.3, 0.18, w + 0.3, mat(PAL.offwhite), { x: cx, y: y0 + (i + 1) * dh - 0.1 }))
    }
    const top = y0 + decks * dh
    // the bridge forward with its glass front and wings
    const bx = L / 2 - 38
    g.add(rblock(14, 3.2, B * 0.9, 0.4, m, { x: bx, y: top }))
    g.add(block(0.2, 1.6, B * 0.86, GLASS(), { x: bx + 7.05, y: top + 1.2 }))
    for (const sgn of [1, -1]) g.add(block(6, 0.3, 3, m, { x: bx + 3, y: top + 1, z: sgn * (B * 0.45 + 1.5) }))
    // lifeboats in their davits along both sides, orange
    for (const sgn of [1, -1]) for (let i = 0; i < 6; i++) {
        const x = -40 + i * 13
        const boat = hull({ L: 9.5, B: 3.2, D: 1.6, T: 0.4, color: PAL.orange, deck: PAL.orange, entry: 0.4, run: 0.2, transom: 0.6 })
        boat.position.set(x, y0 + 3 * dh + 0.4, sgn * (B / 2 + 1.4))
        g.add(boat)
        g.add(block(0.3, 1.8, 0.3, mat(PAL.grey, { metal: 0.6 }), { x: x - 3.5, y: y0 + 3 * dh + 1.4, z: sgn * (B / 2 + 0.6) }))
        g.add(block(0.3, 1.8, 0.3, mat(PAL.grey, { metal: 0.6 }), { x: x + 3.5, y: y0 + 3 * dh + 1.4, z: sgn * (B / 2 + 0.6) }))
    }
    // the funnel aft, in the line's colours, and the radar mast
    const fx = -L / 2 + 30
    g.add(rblock(14, 12, 9, 1.2, mat(PAL.blue, { rough: 0.4 }), { x: fx, y: top }))
    g.add(block(14.4, 2.2, 9.4, mat(PAL.white), { x: fx, y: top + 6 }))
    for (const dz of [-2, 2]) g.add(cyl(0.9, 0.9, 2.5, mat(PAL.black), { x: fx - 2, y: top + 13.2, z: dz }))
    g.add(rod([bx - 4, top + 3.2, 0], [bx - 4, top + 13, 0], 0.3, mat(PAL.offwhite, { metal: 0.5 })))
    g.add(block(4, 0.25, 0.5, mat(PAL.white), { x: bx - 4, y: top + 10 }))
    rails(g, h, -L / 2 + 4, L / 2 - 20, { step: 3 })
    return { group: g, setting: "water" }
}

/** A frigate: a fine grey hull, a faceted stealthy superstructure, the gun
 *  forward, vertical launch cells, the integrated mast, a hangar and helideck. */
export function warship() {
    const g = new THREE.Group()
    const L = 135, B = 16.5, D = 10, T = 5
    const grey = 0x7d858c
    const h = hull({ L, B, D, T, color: grey, deck: 0x5c636a, entry: 0.34, run: 0.1, transom: 0.86, rake: 0.9, sheer: 0.08 })
    g.add(h)
    const m = mat(grey, { rough: 0.55, metal: 0.25 })
    const dk = mat(0x6c747b, { rough: 0.6, metal: 0.25 })
    // the hull number on the bow
    const nx = L / 2 - 18
    for (const sgn of [1, -1]) g.add(block(4.6, 2, 0.06, mat(PAL.white), { x: nx, y: D * 0.62, z: sgn * (h.userData.halfW(nx / L + 0.5) + 0.04) }))
    // the superstructure: a faceted block, its sides leaning inward
    const ss = (x0, x1, w0, w1, y, ht) => {
        const geo = new THREE.BufferGeometry()
        const v = [[x0, 0, -w0], [x1, 0, -w0], [x1, 0, w0], [x0, 0, w0], [x0, ht, -w1], [x1, ht, -w1], [x1, ht, w1], [x0, ht, w1]]
        const f = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]
        const pos = []
        for (const q of f) { const [a, b, c, d] = q.map((i) => v[i]); pos.push(...a, ...b, ...c, ...a, ...c, ...d) }
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
        geo.computeVertexNormals()
        g.add(mesh(geo, mat(grey, { rough: 0.55, metal: 0.25, side: THREE.DoubleSide }), { y }))
    }
    const y0 = deckY(h, 0)
    ss(-L / 2 + 22, 30, B * 0.46, B * 0.38, y0, 7)          // the main block with the hangar aft
    ss(4, 28, B * 0.36, B * 0.28, y0 + 7, 5)                // the bridge level
    g.add(block(0.2, 1.2, B * 0.5, GLASS(), { x: 28.1, y: y0 + 9.2 }))
    // the integrated mast: a tapering faceted tower with the flat radar faces
    ss(10, 20, 3.4, 2, y0 + 12, 12)
    for (const [dx, dz, ry] of [[4.9, 0, 0], [-4.9, 0, Math.PI], [0, 2.8, Math.PI / 2], [0, -2.8, -Math.PI / 2]]) g.add(block(0.3, 3.2, 3.2, mat(0x5c636a), { x: 15 + dx, y: y0 + 16, z: dz, ry }))
    g.add(rod([15, y0 + 24, 0], [15, y0 + 31, 0], 0.25, dk))
    g.add(cyl(1.2, 1.2, 1.4, mat(0xdfe2e4), { x: 15, y: y0 + 25.2 }))
    // the gun forward: a faceted turret and a long barrel
    const gx = L / 2 - 30
    ss(gx - 3, gx + 3, 2.4, 1.7, deckY(h, gx), 2.6)
    g.add(rod([gx + 2.5, deckY(h, gx) + 1.4, 0], [gx + 11, deckY(h, gx) + 2.6, 0], 0.22, dk))
    // vertical launch cells between the gun and the bridge
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.add(block(1.4, 0.2, 1.4, mat(0x50575d), { x: 34 + i * 1.6, y: deckY(h, 36) + 0.05, z: -2.4 + j * 1.6 }))
    // close-in weapon on the hangar roof, the helideck markings, boats in their recesses
    g.add(cyl(1.1, 1.3, 2, mat(0xdfe2e4), { x: -L / 2 + 30, y: y0 + 8 }))
    g.add(block(4, 0.05, 0.4, mat(PAL.white), { x: -L / 2 + 10, y: deckY(h, -L / 2 + 10) + 0.02 }))
    g.add(mesh(new THREE.TorusGeometry(4.5, 0.15, 4, 40), mat(PAL.white), { x: -L / 2 + 11, y: deckY(h, -L / 2 + 11) + 0.03, rx: Math.PI / 2 }))
    for (const sgn of [1, -1]) g.add(rblock(7, 1.4, 2.4, 0.5, mat(PAL.orange), { x: -6, y: y0 + 3, z: sgn * (B * 0.42) }))
    rails(g, h, -L / 2 + 4, L / 2 - 8, { step: 2.8 })
    return { group: g, setting: "water" }
}

/** A stern trawler: a short deep hull, the wheelhouse forward, the gantry
 *  and net drum aft, and the warps running down the ramp. */
export function fishingVessel() {
    const g = new THREE.Group()
    const L = 42, B = 10, D = 6, T = 4.2
    const h = hull({ L, B, D, T, color: 0x2f5f8a, deck: 0x6a5a48, entry: 0.34, run: 0.16, transom: 0.84, rake: 0.8, sheer: 0.22 })
    g.add(h)
    anchors(g, h)
    // the wheelhouse: a white house forward with a wide band of glass
    const x = L / 2 - 14, y = deckY(h, x)
    g.add(rblock(8, 3, B * 0.8, 0.3, mat(PAL.white), { x, y }))
    g.add(rblock(6, 2.6, B * 0.7, 0.3, mat(PAL.white), { x: x + 0.8, y: y + 3 }))
    g.add(block(0.15, 1.2, B * 0.66, GLASS(), { x: x + 3.85, y: y + 4.2 }))
    for (const sgn of [1, -1]) g.add(block(5, 1.2, 0.12, GLASS(), { x: x + 0.8, y: y + 4.2, z: sgn * (B * 0.35 + 0.02) }))
    g.add(rod([x - 1, y + 5.6, 0], [x - 1, y + 12, 0], 0.15, mat(PAL.offwhite, { metal: 0.5 })))
    g.add(block(2.6, 0.18, 0.3, mat(PAL.white), { x: x - 1, y: y + 9 }))
    g.add(sphere(0.25, mat(0xffd9a0, { emissive: 0xffc070 }), { x: x - 1, y: y + 12.2 }, 10))
    // the aft gantry (an A-frame) and the net drum with its net
    const gy = deckY(h, -L / 2 + 3)
    const ora = mat(PAL.orange, { metal: 0.3, rough: 0.5 })
    for (const sgn of [1, -1]) g.add(rod([-L / 2 + 2, gy, sgn * (B / 2 - 0.6)], [-L / 2 + 1, gy + 7, sgn * 2.5], 0.28, ora))
    g.add(rod([-L / 2 + 1, gy + 7, -2.5], [-L / 2 + 1, gy + 7, 2.5], 0.28, ora))
    g.add(cyl(1.6, 1.6, 5, mat(0x2a6b4a, { rough: 0.9 }), { x: -L / 2 + 8, y: gy + 1.8, axis: "z" }))
    for (const dz of [-2.6, 2.6]) g.add(cyl(1.9, 1.9, 0.2, ora, { x: -L / 2 + 8, y: gy + 1.8, z: dz, axis: "z" }))
    // the trawl winches, the stern ramp, the warps down into the water
    for (const dz of [-2.8, 2.8]) g.add(cyl(0.9, 0.9, 1.6, mat(PAL.grey, { metal: 0.5 }), { x: -2, y: deckY(h, -2) + 1, z: dz, axis: "z" }))
    g.add(block(4, 0.2, 3.5, mat(0x5a4c3e), { x: -L / 2 + 1.5, y: deckY(h, -L / 2 + 1) - 0.6 }))
    for (const dz of [-1.5, 1.5]) g.add(rod([-L / 2 + 1, gy + 6.8, dz], [-L / 2 - 14, T * 0.2, dz * 3], 0.05, mat(PAL.black)))
    // floats strung along the bulwark
    for (let i = 0; i < 8; i++) g.add(sphere(0.35, ora, { x: -6 + i * 1.2, y: deckY(h, 0) + 1.1, z: B / 2 - 0.4 }, 10))
    rails(g, h, -L / 2 + 3, L / 2 - 4, { step: 1.6, height: 1.0 })
    return { group: g, setting: "water" }
}
