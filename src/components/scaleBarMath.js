// Pure "nice round number" scale selection for <ScaleBar>. Kept dependency-free
// (no Cesium/React import) so it can be unit-tested in plain Node without a
// real Cesium instance — see scaleBarMath.test.js.
//
// ScaleBar measures the real ground distance (in meters) covered by a fixed
// pixel span at the center of the viewport, derives metersPerPixel from that,
// then uses pickNiceScale() below to choose a human-friendly round-km value
// to actually draw and label.

export const NICE_SCALE_KM = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
]

/**
 * Pick the largest "nice" round km value (from NICE_SCALE_KM) that renders at
 * or under targetPixelWidth screen pixels, given the real measured
 * metersPerPixel at the viewport center.
 *
 * Falls back to the smallest defined value when the view is zoomed in close
 * enough that even 1km would exceed targetPixelWidth (nothing smaller is
 * defined — this is a strategic-scale globe view, not a street map), and to
 * the largest defined value once the view is zoomed out past 50,000km per
 * targetPixelWidth (whole-globe/space views).
 *
 * Returns null only for invalid input (non-finite/non-positive
 * metersPerPixel) — the caller should hide the bar in that case, e.g. when
 * viewer.camera.pickEllipsoid() returned null because the camera is looking
 * at the horizon or off into space.
 */
export function pickNiceScale(metersPerPixel, targetPixelWidth = 100) {
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null
    if (!Number.isFinite(targetPixelWidth) || targetPixelWidth <= 0) return null

    const maxKm = (metersPerPixel * targetPixelWidth) / 1000

    let chosen = NICE_SCALE_KM[0]
    for (const km of NICE_SCALE_KM) {
        if (km <= maxKm) chosen = km
        else break
    }
    return chosen
}

/**
 * On-screen pixel width a given km value renders at, for the measured
 * metersPerPixel. Returns 0 for invalid input rather than NaN/Infinity so
 * callers can render defensively.
 */
export function scaleBarWidthPx(km, metersPerPixel) {
    if (!Number.isFinite(km) || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return 0
    return (km * 1000) / metersPerPixel
}
