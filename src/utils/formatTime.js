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
