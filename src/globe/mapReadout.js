// mapReadout.js — what the map says about itself: where the cursor is, and
// how big a pixel currently is (PARALLAX spec §8, §10 `.mapmeta`).
//
// Two channels, deliberately separate, because they change at wildly
// different rates. The cursor moves on every mousemove; the scale only
// changes when the camera does. Merging them into one store would push a
// scale recompute through every pixel of pointer travel.
//
// Same plain pub/sub idiom as cameraState.js next door — GlobeView is the
// only publisher (it owns the Cesium viewer; nothing else may touch it), and
// anything that needs to display these subscribes. No event round-trip.

// ── Cursor ────────────────────────────────────────────────────────────────
// null means "off the globe". The spec is explicit that pickEllipsoid
// returns undefined off-globe and that callers must null-check before use;
// a readout that keeps showing the last valid coordinate while the pointer
// sits on empty space is lying about where the pointer is.

let cursor = null
const cursorListeners = new Set()

export function publishCursor(next) {
    cursor = next
    cursorListeners.forEach((fn) => fn(cursor))
}

export function getCursor() { return cursor }

export function subscribeCursor(fn) {
    cursorListeners.add(fn)
    return () => cursorListeners.delete(fn)
}

// ── Scale ─────────────────────────────────────────────────────────────────
// { px, label, zoomLabel } — px is the rendered bar width, label its distance
// ("500 km"), zoomLabel the camera-height readout for #nav-z.

let scale = null
const scaleListeners = new Set()

export function publishScale(next) {
    scale = next
    scaleListeners.forEach((fn) => fn(scale))
}

export function getScale() { return scale }

export function subscribeScale(fn) {
    scaleListeners.add(fn)
    return () => scaleListeners.delete(fn)
}

// ── The ladder ────────────────────────────────────────────────────────────
// The spec's own NICE ladder and its 118px fit rule, kept verbatim. A scale
// bar whose length is a round number of pixels showing an awkward distance
// is useless; this picks a round DISTANCE and lets the pixel width fall
// where it may, clamped to 16–150px.

export const NICE = [
    1, 2, 5, 10, 25, 50, 100, 250, 500,
    1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6,
]

/**
 * metresPerPixel → { px, label }. Pure, so it is testable without Cesium.
 * Returns null for a non-finite input, which is what an off-globe pick
 * produces.
 */
export function scaleFor(metresPerPixel) {
    if (!isFinite(metresPerPixel) || metresPerPixel <= 0) return null
    let pick = NICE[0]
    for (const n of NICE) if (n <= metresPerPixel * 118) pick = n
    const px = Math.max(16, Math.min(150, pick / metresPerPixel))
    return {
        px: Number(px.toFixed(1)),
        label: pick < 1000 ? `${pick} m` : `${(pick / 1000).toLocaleString()} km`,
    }
}

/**
 * Camera height in metres → the #nav-z readout. The spec's SVG build showed
 * a zoom multiplier (`k`); the Cesium note replaces it with camera height,
 * "m under 1000, else km".
 */
export function zoomLabelFor(heightMetres) {
    if (!isFinite(heightMetres)) return "—"
    if (heightMetres < 1000) return `${Math.round(heightMetres)} m`
    const km = heightMetres / 1000
    if (km < 10) return `${km.toFixed(1)} km`
    if (km < 10000) return `${Math.round(km).toLocaleString()} km`
    return `${(km / 1000).toFixed(1)}k km`
}

/** Cursor readout format — LAT +DD.DDDD, four decimals, sign always shown. */
export function formatCoord(deg, pad) {
    const s = deg < 0 ? "−" : "+"
    return s + Math.abs(deg).toFixed(4).padStart(pad + 5, "0")
}
