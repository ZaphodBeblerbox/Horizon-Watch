/**
 * frontlineFade.js — crossfading one surveyed front into the next.
 *
 * WHY A CROSSFADE AND NOT A MORPH. Interpolating between two snapshots
 * means drawing polygons that lie between the two — shapes nobody
 * surveyed, at a date nobody surveyed them on, rendered in exactly the
 * same style as the real ones. Scrubbing the slider would produce a
 * smooth animation of a front advancing through positions it was never
 * reported to hold.
 *
 * Fading between them keeps every frame made of real geometry. What
 * moves is opacity, and opacity is the one thing here that is not a
 * claim about ground.
 *
 * The second job is less obvious: the old map used to be torn down
 * before the new one had loaded, so scrubbing flashed an empty
 * country between every pair of dates. Holding the outgoing snapshot
 * until the incoming one is ready fixes that as a side effect.
 */

/** Long enough to read as motion, short enough not to lag a scrub. */
export const FADE_MS = 450

export function clamp01(t) {
    const n = Number(t)
    if (!Number.isFinite(n)) return 0
    return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Smoothstep: no hard start or stop at the ends of the fade. */
export function ease(t) {
    const x = clamp01(t)
    return x * x * (3 - 2 * x)
}

/**
 * The two opacities at a point in the fade, as fractions of each
 * layer's own base opacity.
 *
 * They deliberately do NOT sum to 1. Control areas are translucent and
 * overlap, so a linear pair makes the overlap darken in the middle of
 * every transition and read as a change in the data. Crossing them on
 * the square root keeps the combined cover roughly constant.
 */
export function crossfade(t) {
    const e = ease(t)
    return { outgoing: Math.sqrt(1 - e), incoming: Math.sqrt(e) }
}

/** Progress through a fade that began at `startedAt`. */
export function progress(now, startedAt, durationMs = FADE_MS) {
    const d = Number(durationMs)
    if (!Number.isFinite(d) || d <= 0) return 1
    return clamp01((Number(now) - Number(startedAt)) / d)
}
