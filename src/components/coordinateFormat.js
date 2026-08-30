// Pure radians -> decimal-degree formatting for <CoordinateReadout>. Kept
// dependency-free (no Cesium/React import) so it can be unit-tested in plain
// Node without a real Cesium instance/canvas — see coordinateFormat.test.js.

const RAD_TO_DEG = 180 / Math.PI

/**
 * Format a Cartographic-style (lonRadians, latRadians) pair as a
 * decimal-degree readout, e.g. "34.0522°N, 118.2437°W" — 4 decimal places,
 * hemisphere-lettered rather than signed.
 *
 * Non-negative latitude/longitude is treated as N/E respectively, so the
 * equator/prime-meridian boundary case (0, 0) reads "0.0000°N, 0.0000°E".
 */
export function formatLatLon(lonRadians, latRadians) {
    const latDeg = latRadians * RAD_TO_DEG
    const lonDeg = lonRadians * RAD_TO_DEG

    const latHemi = latDeg < 0 ? "S" : "N"
    const lonHemi = lonDeg < 0 ? "W" : "E"

    const latStr = Math.abs(latDeg).toFixed(4)
    const lonStr = Math.abs(lonDeg).toFixed(4)

    return `${latStr}°${latHemi}, ${lonStr}°${lonHemi}`
}
