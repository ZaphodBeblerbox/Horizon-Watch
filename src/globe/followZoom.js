/**
 * followZoom.js — the zoom arithmetic for a locked-on camera.
 *
 * Extracted so it can be tested without a globe. The behaviour it
 * encodes is not obvious and got the camera thrown into space once
 * already: while Cesium's camera.lookAt is active the camera is in a
 * LOCAL reference frame, so positionCartographic.height is not a height
 * and Cesium's own zoom — which scales every step by that value —
 * cannot be allowed to run. The follow layer disables it and computes
 * the range here instead.
 */

export const MIN_RANGE_M = 120
// Past this the lock lets go. It was 900 km, and at the lock's shallow
// pitch a range like that looks past the planet: a few seconds of
// trackpad scrolling "blasted us into space" (the owner, 2026-10-07).
export const MAX_RANGE_M = 60_000
// The step for one mouse-wheel notch (|delta| ≈ 120). A trackpad sends
// many small deltas, so the step is scaled by the delta's size rather
// than taken whole per event — 1.15 per event compounded to 900 km in
// half a second of a two-finger scroll.
export const ZOOM_STEP = 1.15
const NOTCH = 120

/**
 * The next follow range for one wheel event, or null to release.
 *
 * `delta` follows Cesium's WHEEL convention: negative is a scroll
 * toward the viewer, which every map treats as zooming out. Its size
 * sets the step: a notch is one ZOOM_STEP, a trackpad flick a fraction.
 * Returns null when pulling back past the far limit.
 */
export function nextRange(current, delta) {
    const r = Number(current)
    if (!Number.isFinite(r) || r <= 0) return MIN_RANGE_M
    const d = Number(delta)
    const size = Number.isFinite(d) && d !== 0 ? Math.min(3, Math.abs(d) / NOTCH) : 1
    const step = Math.pow(ZOOM_STEP, Math.max(0.05, size))
    const out = d < 0
    const next = out ? r * step : r / step
    if (next > MAX_RANGE_M) return null
    return Math.max(MIN_RANGE_M, next)
}

/**
 * The pitch to look at the contact from, at this range: the chosen pitch
 * close in, turning toward straight down as the camera pulls back, so the
 * ground stays filling the view instead of the horizon and then space.
 */
export function pitchForRange(chosenRad, range) {
    const lo = 4_000, hi = MAX_RANGE_M
    const t = Math.min(1, Math.max(0, (Math.log(range) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))))
    const e = t * t * (3 - 2 * t)
    const down = -Math.PI / 2 * 0.94
    return chosenRad + (down - chosenRad) * e
}
