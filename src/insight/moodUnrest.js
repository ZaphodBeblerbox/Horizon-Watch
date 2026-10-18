/**
 * moodUnrest.js — how the tension trend and the demonstration likelihood
 * (backend/telegram_unrest.py) are written, on the desktop's Insight › Mood
 * and on the phone's mood screen alike.
 *
 * Owner, 2026-10-17: "I want to be able to see tensions rising, likelihood
 * of demonstrations increasing." Words stay monochrome; colour lives only in
 * the small arrow and dot (owner's v4 rule: colour in icons, not in text).
 */

/** The arrow for a trend direction; "unclear" (too few posts) gets none. */
export function trendArrow(direction) {
    return { rising: "↑", falling: "↓", steady: "→" }[direction] || ""
}

/** Colour of the arrow only. */
export function trendColor(direction) {
    return direction === "rising" ? "var(--red, #ff3b30)" : direction === "falling" ? "var(--green, #34c759)" : "var(--txt4)"
}

/** "Rising 2.4× · 24 h" — or why it cannot be read. */
export function trendText(t, window = "24 h") {
    if (!t) return ""
    if (!t.enough) return `Too few posts to read the trend (${window})`
    const word = { rising: "Rising", falling: "Falling", steady: "Steady" }[t.direction] || "Steady"
    return `${word} ${Math.round(t.ratio * 10) / 10}× · ${window}`
}

/** Colour of the likelihood dot only. */
export function levelColor(level) {
    return level === "High" ? "var(--red, #ff3b30)" : level === "Elevated" ? "var(--sev-high, #ff9f0a)" : "var(--txt4)"
}

/** "Demonstrations: High" for a chip or a row's title. */
export function levelText(level) {
    return level ? `Demonstrations: ${level}` : ""
}

/** One sentence for a row's tooltip: the trend and the likelihood with its reasons. */
export function unrestTitle(name, trend, likelihood) {
    const parts = []
    if (trend?.daily) parts.push(`tension ${trendText(trend.daily).toLowerCase()}`)
    if (likelihood) parts.push(`demonstrations in the next 48 h ${likelihood.level}${likelihood.reasons?.length ? `: ${likelihood.reasons.join("; ")}` : ""}`)
    return parts.length ? `${name}: ${parts.join(" · ")}` : ""
}
