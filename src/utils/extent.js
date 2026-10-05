/**
 * extent.js — the smallest and largest of a list, without spreading it.
 *
 * `Math.max(...values)` passes one argument per element, and a call with
 * more than roughly 100,000 arguments throws
 *
 *     RangeError: Maximum call stack size exceeded
 *
 * which is not a slow render or a wrong number — it is the whole layer
 * gone, and in a promise chain it surfaces as an unhandled rejection with
 * no obvious author. The app had this in eight places, over arrays whose
 * length comes from the data: density cells, graph nodes, track points,
 * polygon rings. Any of them can cross the limit on a busy day and none of
 * them did so predictably, which is why it presented as an intermittent
 * crash on whichever screen happened to be open.
 *
 * A reduce has no argument limit.
 *
 * `null` is skipped rather than coerced. `Number(null)` is 0, which is
 * finite, so a missing coordinate would otherwise become a real one at the
 * equator and quietly stretch every bounding box to the origin.
 */
const skip = (v) => v == null || !Number.isFinite(Number(v))

/** The largest finite number in `values`, or `fallback` if there is none. */
export function maxOf(values, fallback = 0) {
    let m = -Infinity
    for (const v of values || []) {
        if (skip(v)) continue
        const n = Number(v)
        if (n > m) m = n
    }
    return m === -Infinity ? fallback : m
}

/** The smallest finite number in `values`, or `fallback` if there is none. */
export function minOf(values, fallback = 0) {
    let m = Infinity
    for (const v of values || []) {
        if (skip(v)) continue
        const n = Number(v)
        if (n < m) m = n
    }
    return m === Infinity ? fallback : m
}

/**
 * Both ends in one pass: `{min, max}`.
 *
 * Non-finite and absent entries are skipped rather than poisoning the
 * result — a single NaN in a coordinate list used to make an entire
 * bounding box NaN, and a NaN extent draws nothing while reporting no
 * error at all.
 */
export function extentOf(values, fallback = 0) {
    let lo = Infinity, hi = -Infinity
    for (const v of values || []) {
        if (skip(v)) continue
        const n = Number(v)
        if (n < lo) lo = n
        if (n > hi) hi = n
    }
    return lo === Infinity ? { min: fallback, max: fallback } : { min: lo, max: hi }
}
