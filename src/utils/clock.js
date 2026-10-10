/**
 * clock.js — which clock times are written in.
 *
 * The console wrote every time in Zulu. Analysts comparing records across
 * theaters want that; everybody else reads "14:32Z" and has to do sums
 * (owner, 2026-10-10: "we're only displaying zulu time, not local time").
 * So times are written in the reader's own zone by default — this device's,
 * which is where they are (LocationPrompt keeps the profile's zone in step
 * with it) — and Settings › General › "Times shown in" switches the whole
 * console to Zulu. The header clock always shows
 * both. Every formatter in the app goes through here.
 */
import { getSettings } from "../state/settingsStore.js"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
let _override = null          // tests: { mode, tz }

export function __setClock(v) { _override = v }

export function timeMode() {
    if (_override?.mode) return _override.mode
    try { return getSettings()?.general?.timeDisplay === "utc" ? "utc" : "local" } catch { return "local" }
}

export function timeZone() {
    if (_override?.tz) return _override.tz
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } catch { return "UTC" }
}

const _fmts = new Map()
function fmt(tz, opts) {
    const k = tz + JSON.stringify(opts)
    if (!_fmts.has(k)) {
        try { _fmts.set(k, new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts })) }
        catch { _fmts.set(k, new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts })) }
    }
    return _fmts.get(k)
}

/** {y, mo, d, h, mi} of an instant in the display zone, plus the zone's short name. */
export function partsOf(date, mode = timeMode()) {
    const tz = mode === "utc" ? "UTC" : timeZone()
    const p = {}
    for (const x of fmt(tz, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(date)) p[x.type] = x.value
    return { y: p.year, mo: MONTHS[+p.month - 1], d: String(+p.day), h: p.hour, mi: p.minute, zone: mode === "utc" ? "Z" : p.timeZoneName }
}

/** "16:32" in local mode, "14:32Z" in Zulu mode. */
export function hm(ts, mode = timeMode()) {
    const d = toDate(ts)
    if (!d) return ""
    const p = partsOf(d, mode)
    return mode === "utc" ? `${p.h}:${p.mi}Z` : `${p.h}:${p.mi}`
}

/** Local "16:32 CEST", Zulu "14:32Z" — for the header clock and the like. */
export function hmZone(ts, mode = timeMode()) {
    const d = toDate(ts)
    if (!d) return ""
    const p = partsOf(d, mode)
    return mode === "utc" ? `${p.h}:${p.mi}Z` : `${p.h}:${p.mi} ${p.zone}`
}

/** The time in Zulu, always: "14:32Z". */
export function zuluHm(ts) { return hm(ts, "utc") }

/** A backend timestamp without a zone is UTC (that is what it writes). */
export function toDate(ts) {
    if (ts == null || ts === "") return null
    if (ts instanceof Date) return isNaN(ts) ? null : ts
    if (typeof ts === "number") return new Date(ts)
    const s = String(ts).trim()
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`)
        : /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? new Date(`${s}Z`) : new Date(s)
    return isNaN(d) ? null : d
}
