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
export const MAX_RANGE_M = 900_000
export const ZOOM_STEP = 1.15

/**
 * The next follow range for one wheel notch, or null to release.
 *
 * `delta` follows Cesium's WHEEL convention: negative is a scroll
 * toward the viewer, which every map in the world treats as zooming
 * out.
 *
 * Multiplicative rather than a fixed step, because a step that feels
 * right at 1.5km is imperceptible at 500km. Returns null when pulling
 * back past the far limit: at that distance the contact is a dot, and
 * continuing to pull is the clearest way somebody can say they are done
 * following it.
 */
export function nextRange(current, delta) {
    const r = Number(current)
    if (!Number.isFinite(r) || r <= 0) return MIN_RANGE_M
    const out = delta < 0
    const next = out ? r * ZOOM_STEP : r / ZOOM_STEP
    if (next > MAX_RANGE_M) return null
    return Math.max(MIN_RANGE_M, next)
}
