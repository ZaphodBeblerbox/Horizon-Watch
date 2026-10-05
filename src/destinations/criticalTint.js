/**
 * criticalTint.js — how strongly a critical signal is tinted.
 *
 * The "newest critical" list read as flat: a critical from four minutes
 * ago and a high from nine hours ago were the same row with a different
 * coloured diamond, and the eye had nothing to land on.
 *
 * Two inputs, because both matter and they are not the same thing.
 * Severity is how bad it is; recency is how likely it still is to be
 * true and actionable. A nine-hour-old critical is real history, not a
 * thing to look at first, so it fades — but it never fades to nothing,
 * because it is still critical.
 *
 * Kept as a left-edge wash rather than a filled row: the design rule
 * here is shades over hues and professional over alarming, and a row
 * flooded with red is a video game. One hue, used once, at low alpha.
 */

/** Severity ranks that get any tint at all. Rank 0 is critical. */
export const TINTED_RANKS = new Set([0, 1])

export const MAX_ALPHA = 0.18
export const MIN_ALPHA = 0.04

/** Full strength under this age, fully decayed past FADE_END_MS. */
export const FADE_START_MS = 30 * 60 * 1000          // 30 minutes
export const FADE_END_MS = 12 * 60 * 60 * 1000       // 12 hours

/**
 * Alpha for a row, 0 when it should not be tinted at all.
 *
 * @param {number} severityRank 0 = critical, 1 = high
 * @param {number|string} publishedAt
 * @param {number} nowMs
 */
export function tintAlpha(severityRank, publishedAt, nowMs = Date.now()) {
    if (!TINTED_RANKS.has(severityRank)) return 0
    // High severity never reaches the strength of a critical, or the
    // distinction the list exists to draw is lost.
    const ceiling = severityRank === 0 ? MAX_ALPHA : MAX_ALPHA * 0.55

    const ts = typeof publishedAt === "number" ? publishedAt : Date.parse(publishedAt || "")
    if (!Number.isFinite(ts)) return ceiling * 0.5   // unknown age: middling, not loudest

    const age = Math.max(0, nowMs - ts)
    if (age <= FADE_START_MS) return ceiling
    if (age >= FADE_END_MS) return MIN_ALPHA

    const t = (age - FADE_START_MS) / (FADE_END_MS - FADE_START_MS)
    return ceiling + (MIN_ALPHA - ceiling) * t
}

/**
 * The CSS background for a row, or undefined when it gets none —
 * undefined rather than "none" so React leaves the stylesheet's own
 * background alone.
 */
export function tintBackground(severityRank, publishedAt, nowMs = Date.now()) {
    const a = tintAlpha(severityRank, publishedAt, nowMs)
    if (a <= 0) return undefined
    // Top-down: the row's colour falls from its top edge, so the tint
    // reads as a band over the headline rather than a bar under the dot.
    return `linear-gradient(180deg, rgba(255,69,58,${a.toFixed(3)}) 0%, `
         + `rgba(255,69,58,${(a * 0.25).toFixed(3)}) 38%, transparent 72%)`
}
