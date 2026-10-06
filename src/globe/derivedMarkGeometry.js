/**
 * derivedMarkGeometry.js — PARALLAX addendum §A8, the parts of the marks that
 * are arithmetic rather than markup.
 *
 * §A8 is written in SVG, where every radius is a pixel count divided by the
 * zoom (`21 / k`). Cesium has no `k`: an ellipse is drawn at a REAL GROUND
 * RADIUS in metres, which is the translation §A8 itself asks for ("both become
 * EllipseGraphics outlines at a *real* ground radius"). The radii below are
 * therefore chosen against the thing they describe — §A4's 2.5° cell, roughly
 * 278 km across at the equator — so a surge halo reads as "about this region"
 * rather than as a fixed blob that means a different area at every latitude.
 */

/** §A4's cell is ~2.5°; these sit comfortably inside one. */
export const SURGE_HALO_M = 85_000
export const SURGE_INNER_M = 48_000
export const FUSION_RING_M = 30_000      // the fusion radius itself (alerts_derived.FUSION_RADIUS_KM)
export const FUSION_OUTER_M = 40_000
export const TICK_OUTER_M = 42_000
export const TICK_INNER_M = 32_000

/**
 * §A8 draws one radial tick per modality, evenly spaced from due north.
 * "The tick count is the finding, rendered" — so the bearings are a pure
 * function of how many modalities agreed, and nothing else.
 */
export function tickBearings(n) {
    if (!Number.isFinite(n) || n < 1) return []
    return Array.from({ length: n }, (_, i) => (i / n) * 360)
}

/**
 * A point `metres` away from (lat, lon) on a bearing — for the tick ends.
 * Spherical, which at these radii is well inside the width of the stroke.
 */
export function offset(lat, lon, bearingDeg, metres) {
    const R = 6_371_008.8
    const d = metres / R
    const br = (bearingDeg * Math.PI) / 180
    const la = (lat * Math.PI) / 180
    const lo = (lon * Math.PI) / 180
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br))
    const lo2 = lo + Math.atan2(
        Math.sin(br) * Math.sin(d) * Math.cos(la),
        Math.cos(d) - Math.sin(la) * Math.sin(la2),
    )
    return { lat: (la2 * 180) / Math.PI, lon: (((lo2 * 180) / Math.PI + 540) % 360) - 180 }
}

/**
 * §A8's pulse, as an alpha rather than an opacity: "Pulse via a
 * CallbackProperty on `outlineColor` alpha."
 *
 * Deliberately NOT a material callback. A CallbackProperty assigned to
 * `.material` has no getType(), and Cesium's per-frame visualizer calls
 * getType() on whatever is assigned there — which crashes the whole viewer
 * ("Rendering has stopped"), as the threat-heatmap layer documented at length
 * before it was removed. `outlineColor` is a plain colour Property, so a
 * callback is safe there and the spec routes the pulse through it for exactly
 * that reason.
 */
export function pulseAlpha(nowMs, periodMs, min, max) {
    const t = (nowMs % periodMs) / periodMs
    const s = Math.sin(t * Math.PI * 2) * 0.5 + 0.5
    return min + (max - min) * s
}

/** Honour the OS setting — §A8's own `@media (prefers-reduced-motion: reduce)`. */
export function prefersReducedMotion() {
    try {
        return typeof window !== "undefined" && window.matchMedia
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false
    } catch { return false }
}

/**
 * §A8 shows the labels "above 1.3×". Cesium's equivalent of a zoom threshold
 * is a DistanceDisplayCondition, so the label exists only within this camera
 * range — beyond it the mark is still drawn, just unlabelled, which is what
 * the SVG does when it renders an empty string.
 */
export const LABEL_MAX_DISTANCE_M = 9_000_000

/** §A9 — "+N more" once the list is longer than it can honestly show. */
export function overflowCount(total, shown) {
    return Math.max(0, (total || 0) - shown)
}

/** §A9's relative age, from the evaluation moment rather than wall clock. */
export function agoStr(ts, nowMs) {
    const h = (nowMs - ts * 1000) / 3_600_000
    if (!Number.isFinite(h)) return ""
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
    if (h < 48) return `${Math.round(h)}h`
    return `${Math.round(h / 24)}d`
}
