/**
 * taskingMath.js — PARALLAX §12.1's arithmetic.
 *
 * "Usable passes, not total passes. The cloud ceiling is what actually decides
 * how much of the archive you get, so the panel estimates the number that
 * matters."
 */

/** §12.1, verbatim. Optical loses to cloud; SAR does not. */
export function usablePasses(passes, cloudPct, sensor) {
    const n = Number(passes)
    if (!isFinite(n) || n <= 0) return 0
    if (isSar(sensor)) return Math.round(n)
    const c = Math.max(0, Math.min(100, Number(cloudPct) || 0))
    return Math.round(n * (1 - Math.min(0.85, c / 100 + 0.15)))
}

export const isSar = (sensor) => typeof sensor === "string" && sensor.includes("sar")

/**
 * Area of a lat/lon box in km². A degree of longitude shrinks with latitude,
 * so this uses the box's mid-latitude rather than treating the world as flat —
 * a naive version overstates a Baltic box by roughly a third.
 */
export function bboxAreaKm2(b) {
    if (!b) return 0
    const { north, south, east, west } = b
    if ([north, south, east, west].some((v) => !isFinite(v))) return 0
    const midLat = ((north + south) / 2) * (Math.PI / 180)
    const kmPerDegLat = 110.574
    const kmPerDegLon = 111.32 * Math.cos(midLat)
    return Math.abs((north - south) * kmPerDegLat) * Math.abs((east - west) * kmPerDegLon)
}

/** Corner count: a drawn polygon's real vertices, else a box's four. */
export function cornerCount(drawn) {
    if (!drawn) return 0
    return drawn.polygonVertices?.length || (drawn.bounds ? 4 : 0)
}

export function fmtArea(km2) {
    if (!km2) return "—"
    if (km2 >= 10_000) return `${Math.round(km2 / 1000)}k`
    if (km2 >= 100) return String(Math.round(km2))
    return km2.toFixed(1)
}

/** §12.2 — the detection tag's colour band. */
export function confidenceBand(conf) {
    const c = Number(conf) > 1 ? Number(conf) / 100 : Number(conf)
    if (!isFinite(c)) return "plain"
    if (c >= 0.85) return "good"
    if (c >= 0.70) return "plain"
    return "weak"
}

/** §12.2 — the row diamond: new is red, removed is steel, everything else amber. */
export function detectionDiamond(d) {
    const s = (d?.change_type || d?.status || "").toLowerCase()
    if (s.includes("new")) return "var(--red)"
    if (s.includes("removed")) return "var(--steel)"
    return "var(--amber)"
}
