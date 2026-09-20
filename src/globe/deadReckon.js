/**
 * deadReckon.js — where an aircraft is between two position reports.
 *
 * ADS-B arrives every few seconds; a marker that only moves when a
 * report lands jumps. Advancing it along its own track and ground
 * speed in between is standard practice and is what makes the map read
 * as live.
 *
 * WHY THIS IS NOT A REACT STATE UPDATE. It used to be: a 100ms interval
 * rebuilt the whole aircraft array with new objects and called
 * setState, which invalidated the memo, re-sorted, and re-rendered one
 * React component per aircraft — ten times a second. At the old cap of
 * 150 that was survivable. With the cap lifted to thousands it is
 * roughly 24,000 component renders and as many allocations per second,
 * to move some markers a few metres.
 *
 * Evaluated per frame by Cesium instead, it costs a little arithmetic
 * per visible aircraft, needs no timer, and is smooth at the display's
 * refresh rate rather than stepping at 10Hz.
 */
import { coord } from "./markerOrientation.js"

/** Below this there is no meaningful movement to extrapolate. */
export const MIN_GROUND_SPEED_KT = 10

/**
 * Stop extrapolating after this long. A track continued from a report
 * a minute old is not a position, it is a guess drawn in the same
 * style as a measurement.
 */
export const MAX_COAST_SECONDS = 30

const KT_TO_MS = 0.514444
const EARTH_R = 6371000

/**
 * The position to draw now, given the last real report.
 *
 * Returns the reported position unchanged whenever extrapolating would
 * be dishonest or pointless: no fix, not moving, or coasting too long.
 */
export function deadReckon(base, nowMs) {
    if (!base) return null
    // coord(), not Number(): Number(null) and Number("") are 0, which
    // is a real latitude, so a fix with a missing field would be
    // extrapolated from Null Island.
    const lat = coord(base.lat), lon = coord(base.lon)
    if (lat === null || lon === null) return null

    const gs = Number(base.gs)
    const ts = Number(base.ts)
    if (!Number.isFinite(gs) || gs < MIN_GROUND_SPEED_KT) return { lat, lon }
    if (!Number.isFinite(ts)) return { lat, lon }

    const dt = (Number(nowMs) - ts) / 1000
    if (!Number.isFinite(dt) || dt < 0.1 || dt > MAX_COAST_SECONDS) return { lat, lon }

    const track = Number(base.track)
    if (!Number.isFinite(track)) return { lat, lon }

    const d = (gs * KT_TO_MS * dt) / EARTH_R
    const th = (track * Math.PI) / 180
    const p1 = (lat * Math.PI) / 180
    const l1 = (lon * Math.PI) / 180
    const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th)
    const p2 = Math.asin(sinP2)
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1),
                               Math.cos(d) - Math.sin(p1) * sinP2)
    return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 }
}
