/**
 * markerOrientation.js — where a marker sits and which way it points.
 *
 * Both of these took the globe down or made it lie, so both are here
 * and both are tested.
 */
import { Cartesian3, Math as CesiumMath } from "cesium"

/**
 * A position, or null if the coordinates cannot make one.
 *
 * Cesium's Cartesian3.fromDegrees THROWS on anything that is not a
 * number — null, NaN, and a numeric STRING all raise. A throw here
 * happens inside React's render, so a single unusable row among
 * thousands does not drop one marker, it unmounts the entire globe.
 * That is what "the globe crashes when I click an aircraft" was: the
 * click changed state, React re-rendered every layer, and one bad
 * coordinate took the tree down on the way through.
 *
 * `isFinite("8.5")` is true, which is why the old guard did not help —
 * the string passed the check and then threw inside Cesium.
 */
/**
 * A coordinate as a number, or null.
 *
 * NOT Number() ALONE. Number(null), Number("") and Number([]) are all
 * 0, so a row with a missing longitude becomes a perfectly valid
 * position off the coast of Ghana. Dropping the marker is right;
 * drawing a fleet at Null Island is not.
 */
export function coord(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v)
        return Number.isFinite(n) ? n : null
    }
    return null
}

export function safeCartesian(lon, lat, height = 0) {
    const lo = coord(lon), la = coord(lat)
    const h = Number(height)
    if (lo === null || la === null) return null
    if (lo < -180 || lo > 180 || la < -90 || la > 90) return null
    return Cartesian3.fromDegrees(lo, la, Number.isFinite(h) ? h : 0)
}

/**
 * Billboard rotation, in radians, for a contact on a compass heading.
 *
 * WHY THE CAMERA COMES INTO IT. A billboard always faces the viewer and
 * its `rotation` is applied in SCREEN space, so `-heading` is only the
 * true bearing while north happens to point up the screen. Rotate the
 * globe and every ship and aircraft keeps its screen angle while the
 * world turns underneath — the heading silently stops being a heading.
 *
 * Subtracting the camera's own heading pins the nose to the real
 * bearing at any camera orientation, and because the marker still faces
 * the viewer it stays level with the horizon rather than standing up
 * out of the ground.
 *
 * (Aligning to the surface normal instead — which is what this replaced
 * — stands the icon PERPENDICULAR to the ground like a signpost, and
 * looking straight down the normal points at the camera, where the
 * projection is degenerate and the rotation becomes arbitrary.)
 *
 * @param headingDeg       compass bearing, degrees clockwise from north
 * @param cameraHeadingRad Cesium camera.heading, radians clockwise from north
 */
export function billboardRotation(headingDeg, cameraHeadingRad = 0) {
    const h = Number(headingDeg)
    const cam = Number(cameraHeadingRad)
    return (Number.isFinite(cam) ? cam : 0)
        - CesiumMath.toRadians(Number.isFinite(h) ? h : 0)
}

/**
 * A usable AIS heading, or null.
 *
 * 511 is the AIS "not available" sentinel and must never be drawn as
 * due east; course over ground is the honest fallback, and when there
 * is neither the marker should point nowhere rather than north.
 */
export function vesselHeading(v) {
    // coord(), not Number(). Number(null) and Number("") are 0, which is
    // a perfectly valid heading — due north — so a vessel that reported
    // no heading at all was being pointed up the map.
    const hdg = coord(v?.heading)
    if (hdg !== null && hdg !== 511 && hdg >= 0 && hdg < 360) return hdg
    const cog = coord(v?.cog)
    if (cog !== null && cog >= 0 && cog < 360) return cog
    return null
}

/**
 * The compass bearing from one position to another, or null.
 *
 * WHY THIS IS HERE. 44% of AIS vessels report no usable heading and
 * this feed carries no course-over-ground, so those hulls had nothing
 * to point along and were drawn as a plain dot instead. A vessel that
 * has MOVED between two reports has told us its course by doing so —
 * that is an observation, not a guess, and it is the honest way to
 * recover most of that 44%.
 *
 * `minMetres` exists because AIS positions jitter at rest. Below it the
 * two fixes are the same place and the "direction" between them is
 * noise that would spin a moored ship on the spot.
 */
export function bearingBetween(lat1, lon1, lat2, lon2, minMetres = 40) {
    const a1 = coord(lat1), o1 = coord(lon1), a2 = coord(lat2), o2 = coord(lon2)
    if (a1 === null || o1 === null || a2 === null || o2 === null) return null

    const R = 6371000
    const toRad = Math.PI / 180
    const dLat = (a2 - a1) * toRad
    const dLon = (o2 - o1) * toRad
    const midLat = ((a1 + a2) / 2) * toRad
    const dist = R * Math.hypot(dLat, dLon * Math.cos(midLat))
    if (!Number.isFinite(dist) || dist < minMetres) return null

    const y = Math.sin(dLon) * Math.cos(a2 * toRad)
    const x = Math.cos(a1 * toRad) * Math.sin(a2 * toRad)
            - Math.sin(a1 * toRad) * Math.cos(a2 * toRad) * Math.cos(dLon)
    const brg = (Math.atan2(y, x) * 180) / Math.PI
    return (brg + 360) % 360
}
