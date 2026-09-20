/**
 * trackPoints.js — the points of a track that are safe to draw.
 *
 * ONE BAD POINT KILLS THE WHOLE GLOBE. A track polyline is built with
 * Cartesian3.fromDegreesArray, which does not validate: a null or
 * undefined coordinate becomes a NaN cartesian, and the first time
 * Cesium clamps that to the ground it throws
 *
 *     DeveloperError: cartesian has a NaN component
 *         at cartesianToCartographic
 *         at extractHeights
 *
 * from inside the render loop. Cesium responds by stopping rendering
 * altogether — "An error occurred while rendering. Rendering has
 * stopped." The canvas keeps showing its last frame, so it does not
 * look like an exception, it looks like the map froze.
 *
 * Reproduced with 2,207 aircraft on screen. Raising the marker caps did
 * not create this, it just made a bad point far more likely to be in
 * the set being drawn.
 */
import { coord } from "./markerOrientation.js"

/**
 * The drawable points of a track, in order, with the unusable ones
 * removed.
 *
 * Dropping a point is right: a track is a sequence of places something
 * was, and a report with no coordinate is not one of them.
 */
export function usablePoints(points) {
    const out = []
    for (const p of points || []) {
        const lat = coord(p?.lat)
        const lon = coord(p?.lon ?? p?.lng)
        if (lat === null || lon === null) continue
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
        out.push({ ...p, lat, lon })
    }
    return out
}

/**
 * A height in metres for a track vertex, never NaN.
 *
 * Feet in, metres out. ADS-B sends the literal string "ground" for an
 * aircraft on the surface, and a NaN height is as fatal as a NaN
 * coordinate.
 */
export function vertexHeight(altitudeFt) {
    const n = Number(altitudeFt)
    return Number.isFinite(n) && n > 0 ? n * 0.3048 : 0
}

/** Can these points make a line at all? */
export function drawable(points) {
    return usablePoints(points).length >= 2
}

/**
 * A flat [lon, lat, lon, lat, ...] array for Cesium, or null if any
 * coordinate is unusable.
 *
 * Null rather than a filtered subset, because these are two-point
 * connectors — a line from a known place to an unknown one is not a
 * shorter line, it is not a line.
 */
export function safeDegreesArray(pairs) {
    const flat = []
    for (const [lon, lat] of pairs || []) {
        const la = coord(lat), lo = coord(lon)
        if (la === null || lo === null) return null
        if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
        flat.push(lo, la)
    }
    return flat.length >= 4 ? flat : null
}
