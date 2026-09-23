/**
 * forecastTerrain.js — putting a doctrinal template on real ground.
 *
 * WHY THE TERRAIN FACE EXISTS (spec F8.2). A schematic can be elegant
 * and geographically impossible. Axes that read beautifully as
 * relationships may, on the ground, run into a sea, over a range, or
 * across a border that is not where the diagram implies. The reader
 * cannot check the doctrine against the world unless the world is drawn.
 *
 * WHY THIS NEEDS NO PROJECTION LIBRARY. Equirectangular is linear: x is
 * a scaled longitude, y is a scaled latitude, and that is the whole
 * transform. It is a poor projection for measuring area and a perfectly
 * honest one for "is this axis in the sea", which is the only question
 * this face is asked. d3-geo would buy accuracy the face does not claim.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. The units are not at surveyed
 * positions. The template is generic doctrine; the board supplies a
 * country; this places the diagram over that country at an operational
 * scale so its geometry can be judged against real coastline and real
 * borders. The caller states that in words — see ForecastTemplate — and
 * the stamp is on this face too.
 *
 * COORDINATES ARE READ WITH num(), NEVER Number(). Number(null) is 0,
 * and 0,0 is a real, plausible, wrong place in the Gulf of Guinea. That
 * mistake has now been made six times in this codebase — Null Island
 * markers, headingless vessels pointing due north, trade legs routed
 * through the Gulf, a detection projected from a missing latitude, a
 * forecast bar reading "0.0%" — and it was made again here, in bboxOf,
 * and caught by this module's own test.
 */

import { num } from "../utils/strictNumber.js"

/**
 * UCDP names its countries historically — "Myanmar (Burma)", "Russia
 * (Soviet Union)" — and the world file names them currently. Dropping
 * the parenthetical reconciles most of it; these are the rest, and they
 * are listed rather than fuzzy-matched because a near-match that picks
 * the wrong country would draw the wrong coastline under real units.
 */
export const ALIASES = {
    "dr congo": "Democratic Republic of the Congo",
    "serbia": "Republic of Serbia",
    "bosnia-herzegovina": "Bosnia and Herzegovina",
    "cambodia (kampuchea)": "Cambodia",
    "ivory coast": "Ivory Coast",
    "united states of america": "United States of America",
}

/** The world file's name for a board's country, or null. */
export function matchCountry(boardName, features) {
    if (!boardName || !Array.isArray(features)) return null
    const byName = new Map()
    for (const f of features) {
        const n = f?.properties?.n
        if (n) byName.set(n.toLowerCase(), f)
    }
    const raw = String(boardName).trim()
    const bare = raw.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim()
    const tries = [
        raw.toLowerCase(),
        bare.toLowerCase(),
        ALIASES[raw.toLowerCase()],
        ALIASES[bare.toLowerCase()],
    ].filter(Boolean)
    for (const t of tries) {
        const hit = byName.get(String(t).toLowerCase())
        if (hit) return hit
    }
    return null
}

/** Every ring of a Polygon or MultiPolygon, as arrays of [lon, lat]. */
export function ringsOf(geometry) {
    if (!geometry) return []
    if (geometry.type === "Polygon") return geometry.coordinates || []
    if (geometry.type === "MultiPolygon") {
        return (geometry.coordinates || []).flat()
    }
    return []
}

/** [minLon, minLat, maxLon, maxLat] over a geometry, or null. */
export function bboxOf(geometry) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (const ring of ringsOf(geometry)) {
        for (const pt of ring) {
            const lon = num(pt?.[0]), lat = num(pt?.[1])
            if (lon === null || lat === null) continue
            if (lon < a) a = lon
            if (lat < b) b = lat
            if (lon > c) c = lon
            if (lat > d) d = lat
        }
    }
    return Number.isFinite(a) ? [a, b, c, d] : null
}

/**
 * The geographic window the schematic box maps onto.
 *
 * FITTED TO THE COUNTRY, NOT TO AN OPERATIONAL RADIUS. The first version
 * used a fixed 7-degree span centred on the country, which is the right
 * scale for a brigade and the wrong one for this face: a 749km window
 * over Sudan lands entirely inside Sudan, so the panel showed featureless
 * interior. There was nothing to check the axes against, which is the
 * only reason the face exists.
 *
 * Fitting the country's own bounds always puts its border, its
 * coastline and its neighbours on screen. The cost is that the symbols
 * are then spread across a whole country rather than a front, so they
 * are explicitly NOT to scale, and the caller says so — an unstated
 * scale would be a quiet claim that these formations are 700km apart.
 *
 * Aspect ratio is preserved, and longitude is stretched by 1/cos(lat) so
 * a country does not appear squashed toward the poles.
 */
export function viewFor(bbox, { w, h, pad = 0.18 } = {}) {
    if (!bbox || !w || !h) return null
    const [minLon, minLat, maxLon, maxLat] = bbox
    const cLon = (minLon + maxLon) / 2
    const cLat = (minLat + maxLat) / 2
    const k = Math.max(0.2, Math.cos((cLat * Math.PI) / 180))

    // Work in "screen degrees", where a degree of longitude is worth
    // cos(lat) of a degree of latitude, so the fit is not distorted.
    let lonSpan = Math.max(maxLon - minLon, 1e-6) * k
    let latSpan = Math.max(maxLat - minLat, 1e-6)
    const boxAspect = w / h
    if (lonSpan / latSpan < boxAspect) lonSpan = latSpan * boxAspect
    else latSpan = lonSpan / boxAspect

    lonSpan *= 1 + pad
    latSpan *= 1 + pad
    const halfLon = lonSpan / k / 2
    const halfLat = latSpan / 2
    return {
        minLon: cLon - halfLon, maxLon: cLon + halfLon,
        minLat: cLat - halfLat, maxLat: cLat + halfLat,
        cLon, cLat, w, h,
    }
}

/** [lon, lat] -> [x, y] in the SVG box. Equirectangular, so linear. */
export function project(lon, lat, view) {
    if (!view) return null
    const x = ((lon - view.minLon) / (view.maxLon - view.minLon)) * view.w
    // y is inverted: latitude grows upward, SVG y grows downward.
    const y = (1 - (lat - view.minLat) / (view.maxLat - view.minLat)) * view.h
    return [x, y]
}

/** The inverse, used to give a schematic point real coordinates. */
export function unproject(x, y, view) {
    if (!view) return null
    const lon = view.minLon + (x / view.w) * (view.maxLon - view.minLon)
    const lat = view.minLat + (1 - y / view.h) * (view.maxLat - view.minLat)
    return [lon, lat]
}

/**
 * A geometry as SVG path data, in view coordinates.
 *
 * Rings entirely outside the window are dropped — at operational scale
 * most of the world is off-screen, and emitting it produces a path
 * string megabytes long that the browser then has to clip.
 */
export function pathFor(geometry, view, { skipOutside = true } = {}) {
    if (!view) return ""
    const out = []
    for (const ring of ringsOf(geometry)) {
        if (!ring || ring.length < 2) continue
        if (skipOutside && outside(ring, view)) continue
        let d = ""
        for (let i = 0; i < ring.length; i++) {
            const lon = num(ring[i]?.[0]), lat = num(ring[i]?.[1])
            if (lon === null || lat === null) continue
            const p = project(lon, lat, view)
            if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
            d += `${d ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`
        }
        if (d) out.push(d + "Z")
    }
    return out.join(" ")
}

/** Whether a ring's own bounds miss the window entirely. */
export function outside(ring, view) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (const pt of ring) {
        const lon = num(pt?.[0]), lat = num(pt?.[1])
        if (lon === null || lat === null) continue
        if (lon < a) a = lon
        if (lat < b) b = lat
        if (lon > c) c = lon
        if (lat > d) d = lat
    }
    if (!Number.isFinite(a)) return true
    return c < view.minLon || a > view.maxLon || d < view.minLat || b > view.maxLat
}
