/**
 * selectedTrack.js — the arithmetic behind a clicked contact's path.
 *
 * Split out of the layer so the parts that can be wrong in silence — a
 * unit conversion, an altitude that is not a number — are testable
 * without a globe.
 */

/** Feet to metres. ADS-B reports altitude in feet; Cesium wants metres. */
export const FT_TO_M = 0.3048

/**
 * An ADS-B altitude as metres above the ellipsoid.
 *
 * ALTITUDE IS NOT ALWAYS A NUMBER. ADS-B reports the literal string
 * "ground" for an aircraft on the surface, and it appears in this feed —
 * 1 of 75 positions on the first airframe checked. Feeding that to a
 * wall's maximumHeights produces NaN, and a NaN vertex does not draw a
 * short wall, it drops the whole geometry. Anything unparseable is
 * ground level, which is what "ground" means and a safe reading of the
 * rest.
 */
export function altitudeMetres(raw) {
    if (raw === null || raw === undefined) return 0
    if (typeof raw === "string" && raw.trim().toLowerCase() === "ground") return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n * FT_TO_M : 0
}

/**
 * Positions oldest-first, so a track is drawn in the direction travelled.
 *
 * The API returns newest-first because every other consumer wants the
 * latest fix. A line drawn in that order is the same shape but its
 * arrowheads, animations and "start" all point backwards in time.
 */
export function chronological(positions) {
    return [...(positions || [])]
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
}

/**
 * Consecutive fixes at the same spot collapsed to one.
 *
 * A moored ship or a parked aircraft reports the same coordinate for
 * hours, so its "track" is several hundred copies of one point. Cesium
 * builds a ground polyline by taking the direction between consecutive
 * vertices, and the direction between a point and itself is a
 * zero-length vector it cannot normalise. Deduplicating is also just
 * true: a contact that has not moved has one position, not four hundred.
 *
 * Rounding is deliberate. AIS and ADS-B jitter in the last decimal even
 * when nothing moves, and 5dp is about a metre — below that, two fixes
 * are the same place, not a voyage.
 */
const DP = 5

export function dedupe(positions) {
    const out = []
    let lastKey = null
    for (const p of positions || []) {
        const lat = Number(p?.lat), lon = Number(p?.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
        const key = `${lat.toFixed(DP)},${lon.toFixed(DP)}`
        if (key === lastKey) continue
        lastKey = key
        out.push(p)
    }
    return out
}

/**
 * Is there enough here to draw a line at all?
 *
 * Two fixes at the SAME place are not enough — that is a dot, and
 * asking Cesium to draw it is what turns a click into a dead globe.
 */
export function isDrawable(positions) {
    return dedupe(chronological(positions)).length >= 2
}
