/**
 * forecastFeasibility.js — can this formation actually go there?
 *
 * A template that moves every unit the same way is a diagram, not a
 * course of action. Movement is domain-specific and the differences are
 * not subtle:
 *
 *   air     does not use roads, and does not appear from nowhere — it
 *           originates at an airfield, so an air axis whose origin is
 *           not near one is asserting a capability nobody has.
 *   ground  stays on land, and beyond that depends on roads: heavy
 *           armour cannot take every surface that a map calls a road.
 *   sea     stays in water and cannot strike inland. A naval symbol on
 *           a landlocked point is not an aggressive claim, it is an
 *           impossible one.
 *
 * WHAT THIS CAN AND CANNOT CHECK TODAY, STATED RATHER THAN IMPLIED.
 * Land and water are decidable right now from the country polygons the
 * app already ships, and airfields are decidable from the 49,260-row
 * airport table. ROADS ARE NOT: there is no road network and no
 * elevation model in this database, so ground trafficability returns
 * "unknown" and says so. An unknown that announces itself is a caveat;
 * an unknown dressed as a pass is a lie about the hardest part.
 */
import { num } from "../utils/strictNumber.js"

/** How near an air axis's origin must be to a real airfield, in km. */
export const AIRFIELD_KM = 40

/** How far inland a sea unit may reach — naval gunfire, roughly. */
export const NAVAL_REACH_KM = 30

const R_LAT = 111.0

export function kmBetween(a, b) {
    const [lon1, lat1] = a, [lon2, lat2] = b
    const dy = (lat2 - lat1) * R_LAT
    const dx = (lon2 - lon1) * R_LAT * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
    return Math.hypot(dx, dy)
}

/** Ray casting over one ring of [lon, lat]. */
function inRing(lon, lat, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = num(ring[i]?.[0]), yi = num(ring[i]?.[1])
        const xj = num(ring[j]?.[0]), yj = num(ring[j]?.[1])
        if (xi === null || yi === null || xj === null || yj === null) continue
        if ((yi > lat) !== (yj > lat) &&
            lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

/**
 * Is this point on land?
 *
 * GeoJSON polygons put the outer boundary first and holes after, so a
 * point inside a hole — a lake, an enclave — is water even though it is
 * inside the outer ring. Ignoring holes would call the Caspian land.
 */
export function isLand(lon, lat, features) {
    if (!Array.isArray(features)) return null
    for (const f of features) {
        const g = f?.geometry
        if (!g) continue
        const polys = g.type === "Polygon" ? [g.coordinates]
            : g.type === "MultiPolygon" ? g.coordinates : []
        for (const poly of polys) {
            if (!poly?.length) continue
            if (!inRing(lon, lat, poly[0])) continue
            let inHole = false
            for (let h = 1; h < poly.length; h++) {
                if (inRing(lon, lat, poly[h])) { inHole = true; break }
            }
            if (!inHole) return true
        }
    }
    return false
}

/** Nearest airfield to a point, or null. `fields` is [{lat, lon, name}]. */
export function nearestAirfield(lon, lat, fields) {
    let best = null, bestKm = Infinity
    for (const f of fields || []) {
        const flon = num(f?.lon), flat = num(f?.lat)
        if (flon === null || flat === null) continue
        const d = kmBetween([lon, lat], [flon, flat])
        if (d < bestKm) { bestKm = d; best = f }
    }
    return best ? { field: best, km: bestKm } : null
}

/**
 * Whether a unit's movement is physically possible, and why not.
 *
 * Returns { ok, status, reason }, where status is "ok" | "impossible" |
 * "unknown". "unknown" is a real answer and must not be rendered as a
 * pass: it is what ground trafficability is until a road network exists.
 */
export function checkUnit(unit, geo, world, airfields) {
    const dom = unit?.domain || "ground"
    const from = geo?.from, to = geo?.to
    if (!from || !to) return { ok: false, status: "unknown", reason: "no coordinates" }

    if (dom === "air") {
        const near = nearestAirfield(from[0], from[1], airfields)
        if (!near) {
            return { ok: false, status: "unknown",
                     reason: "no airfield data for this area" }
        }
        if (near.km > AIRFIELD_KM) {
            return { ok: false, status: "impossible",
                     reason: `air movement with no airfield within ${AIRFIELD_KM}km `
                           + `of its origin — nearest is ${near.field.name} at `
                           + `${Math.round(near.km)}km` }
        }
        return { ok: true, status: "ok",
                 reason: `originates ${Math.round(near.km)}km from ${near.field.name}` }
    }

    if (dom === "sea") {
        if (isLand(from[0], from[1], world)) {
            return { ok: false, status: "impossible",
                     reason: "a surface contact cannot originate on land" }
        }
        // It may close on a coast but not drive inland.
        if (isLand(to[0], to[1], world)) {
            return { ok: false, status: "impossible",
                     reason: `a surface contact cannot reach an inland point `
                           + `(naval reach is about ${NAVAL_REACH_KM}km)` }
        }
        return { ok: true, status: "ok", reason: "remains on water" }
    }

    // Ground.
    if (!isLand(from[0], from[1], world) || !isLand(to[0], to[1], world)) {
        return { ok: false, status: "impossible",
                 reason: "a ground axis crossing open water needs a crossing "
                       + "this template does not assert" }
    }
    return { ok: true, status: "unknown",
             reason: "on land; road trafficability unknown — no road network "
                   + "or elevation model is loaded, and heavy armour cannot "
                   + "take every surface a map calls a road" }
}
