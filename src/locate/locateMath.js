/**
 * locateMath.js — the geometry of the Locate workbench.
 *
 * TIME FROM SHADOWS. An upright object of height h casts a shadow of length
 * L on flat ground when the sun stands atan(h / L) above the horizon. Both
 * are measured in the frame, in pixels, so the ratio holds only when the
 * object and its shadow are at about the same distance from the camera and
 * the shadow runs across the view, not toward or away from it — the
 * workbench says so. That elevation is reached twice a day; at a known
 * place and date the sun's position (solarPosition.js, NOAA) gives both
 * times. The shadow's direction on the map (drawn on the satellite view
 * once the place is matched) picks one of the two: a shadow points away
 * from the sun, so the sun's azimuth is the shadow bearing + 180°.
 *
 * DIRECTION. On the satellite view an arrow along the road is a bearing.
 * In the frame, an arrow along the vehicle's motion and one along a shadow
 * give the angle between them; with the shadow's map bearing that becomes
 * a heading — exact for a drone looking straight down, rough for a shot
 * from the ground (perspective bends angles), and labelled as such.
 */
import { sunPosition } from "../utils/solarPosition.js"

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export const norm360 = (a) => ((a % 360) + 360) % 360
export const angDiff = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)); return d > 180 ? 360 - d : d }

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
export const compass = (deg) => POINTS[Math.round(norm360(deg) / 22.5) % 16]

/** Length of a frame segment {x1, y1, x2, y2} (any consistent units). */
export const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)

/** A frame segment's direction, degrees clockwise from "up" in the image. */
export const segAngle = (s) => norm360(Math.atan2(s.x2 - s.x1, -(s.y2 - s.y1)) * DEG)

/** Sun elevation (degrees) from an upright object and its shadow in the frame. */
export function elevationFromShadow(object, shadow) {
    const h = segLen(object), l = segLen(shadow)
    if (!(h > 0) || !(l > 0)) return null
    return Math.atan2(h, l) * DEG
}

/** Initial great-circle bearing from point a to b, degrees from true north. */
export function bearing(a, b) {
    const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD
    const y = Math.sin(dl) * Math.cos(p2)
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
    return norm360(Math.atan2(y, x) * DEG)
}

/**
 * When the sun stood at `elevation` (± tol) over lat/lon between fromMs and
 * toMs — and, if `azimuth` is given, in that direction (± azTol). Returns
 * windows [{from, to, mid, azimuth, elevation}] (ms epoch), earliest first.
 */
export function sunWindows({ lat, lon, fromMs, toMs, elevation, tol = 2.5, azimuth = null, azTol = 20, stepMin = 2 }) {
    if (![lat, lon, fromMs, toMs, elevation].every(Number.isFinite) || toMs <= fromMs) return []
    const out = []
    let cur = null
    for (let t = fromMs; t <= toMs; t += stepMin * 60_000) {
        const sp = sunPosition(lat, lon, new Date(t))
        const ok = sp.elevation > 0 && Math.abs(sp.elevation - elevation) <= tol
            && (azimuth == null || angDiff(sp.azimuth, azimuth) <= azTol)
        if (ok) {
            const err = Math.abs(sp.elevation - elevation) + (azimuth == null ? 0 : angDiff(sp.azimuth, azimuth) / 10)
            if (!cur) cur = { from: t, to: t, mid: t, azimuth: sp.azimuth, elevation: sp.elevation, _err: err }
            cur.to = t
            if (err < cur._err) Object.assign(cur, { mid: t, azimuth: sp.azimuth, elevation: sp.elevation, _err: err })
        } else if (cur) {
            out.push(cur); cur = null
        }
    }
    if (cur) out.push(cur)
    return out.map(({ _err, ...w }) => w)
}

/** Heading on the ground of a motion seen in the frame, from its angle to a
 *  shadow whose map bearing is known. */
export function headingFromFrame(motion, shadow, shadowBearing) {
    if (!motion || !shadow || !Number.isFinite(shadowBearing)) return null
    return norm360(shadowBearing + (segAngle(motion) - segAngle(shadow)))
}

/** Local solar time ("≈ 10:40") — the clock the sun keeps there, a stand-in
 *  for the local time zone, which a coordinate alone does not give. */
export function solarClock(ms, lon) {
    const m = ((new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes() + lon * 4) % 1440 + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60) % 60).padStart(2, "0")}`
}

export const utcClock = (ms) => new Date(ms).toISOString().slice(11, 16)
