/**
 * formatTime.js — one way to write a date in this app.
 *
 * The inspector alone printed dates three ways: "10/5/2026, 12:00:00 AM"
 * (the browser's locale, here American), "2026-10-05", and "12:14Z". The
 * first also INVENTED A TIME: GeoConfirmed dates a placemark to the day,
 * and toLocaleString turned that into midnight local time, which reads as
 * an observation at 00:00 that nobody made.
 *
 * The house format is "5 Oct 2026" for a day and "5 Oct 2026, 14:32Z" for
 * a moment. UTC always, because the console's clock is UTC and a reader
 * comparing two records must not have to know which zone each was in.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param {string|number|Date} ts
 * @param {{precision?: "day"|"minute"}} opts  "day" drops the time; left
 *        unset, a value with no time part (or exactly 00:00:00) is a day.
 */
export function fmtWhen(ts, { precision } = {}) {
    if (ts === null || ts === undefined || ts === "") return null
    const raw = typeof ts === "string" ? ts.trim() : ts
    // A timestamp with no zone is UTC: that is what the backend writes. The
    // browser would read it as LOCAL time, and "2026-10-05T00:00:00" became
    // 4 Oct 22:00Z on a machine in Berlin.
    const naive = typeof raw === "string" && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)
    const d = typeof raw === "string" && DATE_ONLY.test(raw) ? new Date(`${raw}T00:00:00Z`)
        : naive ? new Date(`${raw}Z`) : new Date(raw)
    if (isNaN(d.getTime())) return String(ts)
    const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
    const isDay = precision === "day" || (precision !== "minute" && (
        (typeof raw === "string" && (DATE_ONLY.test(raw) || /T00:00:00(\.0+)?(Z|[+-]00:?00)?$/.test(raw)))
        || (raw instanceof Date && midnight)))
    if (isDay) return day
    const hh = String(d.getUTCHours()).padStart(2, "0")
    const mm = String(d.getUTCMinutes()).padStart(2, "0")
    return `${day}, ${hh}:${mm}Z`
}

/** "just now", "12 min ago", "2 h 10 min ago", "3 d ago" — UTC-safe. */
export function agoLabel(ts, now = Date.now()) {
    const t = ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts
        : Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(ts)) ? `${ts}Z` : String(ts))
    if (!Number.isFinite(t)) return null
    const m = Math.max(0, Math.round((now - t) / 60000))
    if (m < 1) return "just now"
    if (m < 60) return `${m} min ago`
    const h = Math.floor(m / 60), r = m % 60
    if (h < 24) return r ? `${h} h ${r} min ago` : `${h} h ago`
    const d = Math.floor(h / 24)
    return `${d} d ago`
}

/** When a signal was noticed, and how long ago: "14:32Z · 2 h 10 min ago";
 *  older than a day it carries the date: "4 Oct 2026, 09:10Z · 2 d ago". */
export function whenLabel(ts, now = Date.now()) {
    const ago = agoLabel(ts, now)
    if (!ago) return null
    const full = fmtWhen(ts, { precision: "minute" })
    const t = Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(ts)) ? `${ts}Z` : String(ts))
    const clock = full && Number.isFinite(t) && now - t < 24 * 3600 * 1000 ? full.split(", ").pop() : full
    return clock ? `${clock} · ${ago}` : ago
}
