// solarPosition.js — real solar elevation angle from latitude/longitude/date,
// the standard NOAA Solar Calculator algorithm (Jean Meeus, "Astronomical
// Algorithms" — the same real formula NOAA's own published solar
// calculator uses, not an invented approximation). Accurate to well under
// 0.5° for any real date this century, which is far tighter than this
// app's own civil-twilight blend band needs (±6° — see
// CIVIL_TWILIGHT_DEG below). No external API call, no network dependency.
//
// Validated directly (see solarPosition.test.js) against real, published
// sunrise/sunset times for a real reference city/date — sunrise/sunset is
// conventionally defined at a solar elevation of -0.833° (standard
// atmospheric refraction + the sun's own apparent radius), not exactly 0°.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

function toJulianDay(date) {
    return date.getTime() / 86400000 + 2440587.5
}

/** The sun's elevation and azimuth (degrees; azimuth clockwise from true
 * north) for a real lat/lon and Date — NOAA's formulas, computed in UTC. */
export function sunPosition(lat, lon, date = new Date()) {
    const jd = toJulianDay(date)
    const T = (jd - 2451545.0) / 36525.0

    // Geometric mean longitude and anomaly of the sun (degrees)
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    const Mrad = M * RAD

    // Eccentricity of Earth's orbit
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)

    // Equation of center
    const C = Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T))
        + Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T)
        + Math.sin(3 * Mrad) * 0.000289

    const trueLong = L0 + C
    // Apparent longitude (corrected for nutation + aberration)
    const omega = 125.04 - 1934.136 * T
    const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)

    // Mean + corrected obliquity of the ecliptic
    const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))
    const e0 = 23.0 + (26.0 + seconds / 60.0) / 60.0
    const epsilon = e0 + 0.00256 * Math.cos(omega * RAD)

    // Sun's declination
    const decl = Math.asin(Math.sin(epsilon * RAD) * Math.sin(appLong * RAD)) * DEG

    // Equation of time (minutes) — real apparent-vs-mean-solar-time offset
    const y = Math.tan((epsilon / 2) * RAD) ** 2
    const eqTime = 4 * DEG * (
        y * Math.sin(2 * L0 * RAD)
        - 2 * e * Math.sin(Mrad)
        + 4 * e * y * Math.sin(Mrad) * Math.cos(2 * L0 * RAD)
        - 0.5 * y * y * Math.sin(4 * L0 * RAD)
        - 1.25 * e * e * Math.sin(2 * Mrad)
    )

    // True solar time (minutes) and hour angle (degrees)
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
    const trueSolarTime = (utcMinutes + eqTime + 4 * lon) % 1440
    let hourAngle = trueSolarTime / 4 - 180
    if (hourAngle < -180) hourAngle += 360

    const latRad = lat * RAD
    const declRad = decl * RAD
    const haRad = hourAngle * RAD

    const cosZenith = Math.sin(latRad) * Math.sin(declRad)
        + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad)
    const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) * DEG

    // Azimuth, NOAA's form: from the zenith angle and the declination,
    // folded by the hour angle (morning sun east, afternoon sun west).
    const zr = zenith * RAD
    let azimuth = 0
    const den = Math.cos(latRad) * Math.sin(zr)
    if (Math.abs(den) > 1e-9) {
        const c = Math.max(-1, Math.min(1, (Math.sin(latRad) * Math.cos(zr) - Math.sin(declRad)) / den))
        const a = Math.acos(c) * DEG
        azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360
    }
    return { elevation: 90 - zenith, azimuth }
}

/** Real solar elevation angle in degrees for a given real lat/lon (degrees)
 * and real Date (any real timezone — computed in UTC internally). */
export function solarElevationDeg(lat, lon, date = new Date()) {
    return sunPosition(lat, lon, date).elevation
}

/** The sun's azimuth, degrees clockwise from true north. */
export function solarAzimuthDeg(lat, lon, date = new Date()) {
    return sunPosition(lat, lon, date).azimuth
}

// Real civil-twilight band — standard astronomical definition (civil dawn/
// dusk is elevation = -6°; this app additionally treats +6° as "fully
// day" so the fade has a real, symmetric, ~12°-wide band to animate
// across rather than a hard cutoff right at the horizon).
/**
 * Where in the day we are, 0..1, from the sun's real hour angle.
 *
 * 0 and 1 are solar midnight, 0.5 is solar noon. This is what an arc needs
 * and elevation cannot give: elevation says how high the sun is, and the
 * same elevation happens twice a day, once climbing and once falling. The
 * hour angle distinguishes them, so the sun can rise on one side and set
 * on the other instead of going up and down the same rail.
 *
 * The computation is already done inside solarElevationDeg — this exposes
 * it rather than deriving the sun's position a second, slightly different
 * way.
 */
export function solarDayPhase(lon, date = new Date()) {
    const jd = toJulianDay(date)
    const T = (jd - 2451545.0) / 36525.0
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    const Mrad = M * RAD
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    const omega = 125.04 - 1934.136 * T
    const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))
    const e0 = 23.0 + (26.0 + seconds / 60.0) / 60.0
    const epsilon = e0 + 0.00256 * Math.cos(omega * RAD)
    const y = Math.tan((epsilon / 2) * RAD) ** 2
    const eqTime = 4 * DEG * (
        y * Math.sin(2 * L0 * RAD)
        - 2 * e * Math.sin(Mrad)
        + 4 * e * y * Math.sin(Mrad) * Math.cos(2 * L0 * RAD)
        - 0.5 * y * y * Math.sin(4 * L0 * RAD)
        - 1.25 * e * e * Math.sin(2 * Mrad)
    )
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
    const trueSolarTime = ((utcMinutes + eqTime + 4 * lon) % 1440 + 1440) % 1440
    return trueSolarTime / 1440
}

export const CIVIL_TWILIGHT_DEG = 6

/** Maps a real solar elevation angle to a continuous 0..1 blend factor:
 * 0 = fully "night" tokens, 1 = fully "day" tokens, linear in between
 * across the real civil-twilight band. Never oscillates or gets stuck —
 * pure function of elevation, clamped at both real extremes (polar day/
 * night naturally lands exactly on 0 or 1 and stays there). */
export function civilTwilightBlend(elevationDeg) {
    const t = (elevationDeg + CIVIL_TWILIGHT_DEG) / (2 * CIVIL_TWILIGHT_DEG)
    return Math.max(0, Math.min(1, t))
}
