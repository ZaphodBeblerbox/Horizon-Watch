/**
 * strictNumber.js — Number() says null is zero, and it has cost us five times.
 *
 * `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all
 * 0, and 0 is finite, so the usual `Number.isFinite(Number(x))` guard
 * waves every one of them through as a real measurement. In this
 * codebase that has produced, in order:
 *
 *   - markers at 0°N 0°E, because a missing coordinate became Null Island
 *   - every heading-less vessel drawn pointing due north
 *   - trade-route legs through the Gulf of Guinea
 *   - satellite detections projected to a real pixel from a missing lat
 *   - a forecast bar claiming "0.0%" for a probability that was absent
 *
 * The distinction this preserves is between "the value is zero" and
 * "there is no value", which are different claims and must not render
 * the same.
 */

/** A real number, or null. Strings are parsed; blanks and nullish are not. */
export function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null
    if (typeof v === "string") {
        const s = v.trim()
        if (s === "") return null
        const n = Number(s)
        return Number.isFinite(n) ? n : null
    }
    return null
}

/** True when the value is a real number — never for null, "" or []. */
export function isNum(v) {
    return num(v) !== null
}
