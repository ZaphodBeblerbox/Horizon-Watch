/**
 * whatChanged.js — "since you last looked" (v4.3 §2).
 *
 * The arithmetic behind the card, kept out of the view so the awkward
 * cases are testable: a first visit, a reload seconds later, a week
 * away, a clock that went backwards.
 *
 * THE RULE THAT MAKES IT USEFUL. If the last visit was under 24 hours
 * ago the card shows the last 24 hours instead, so a reload is never
 * empty. A panel headed "since you last looked" that says "nothing" two
 * seconds after a refresh teaches a reader to stop reading it, and it is
 * the one panel that must be worth reading.
 */

export const LAST_SEEN_KEY = "parallax.lastseen"

/** A last-seen mark older than this is treated as a first visit. */
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000

/** Severity rank, highest first. */
const SEV = { critical: 4, high: 3, elevated: 2, moderate: 1, low: 0, info: 0 }

export function sevRank(s) {
    return SEV[String(s || "").toLowerCase()] ?? 0
}

/** The window the card should describe. */
export function windowFor(lastSeen, now = Date.now()) {
    const t = Number(lastSeen)
    const valid = Number.isFinite(t) && t > 0 && t <= now && now - t <= MAX_AGE_MS
    if (!valid) {
        return { since: now - 24 * 3600 * 1000, label: "LAST 24 HOURS", firstVisit: true }
    }
    const age = now - t
    if (age < 24 * 3600 * 1000) {
        // A reload must never produce an empty card.
        return { since: now - 24 * 3600 * 1000, label: "LAST 24 HOURS", firstVisit: false }
    }
    return { since: t, label: `SINCE YOU LAST LOOKED · ${humanAge(age)}`, firstVisit: false }
}

export function humanAge(ms) {
    const h = Math.floor(ms / 3600000)
    if (h < 1) return "moments ago"
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

/** Items inside the window, worst and newest first. */
export function changedItems(items, since) {
    const out = []
    for (const i of items || []) {
        const ts = Date.parse(i?.published_at || i?.timestamp || i?.created_at || "")
        if (!Number.isFinite(ts) || ts < since) continue
        out.push({ ...i, _ts: ts })
    }
    out.sort((a, b) => (sevRank(b.severity) - sevRank(a.severity)) || (b._ts - a._ts))
    return out
}

/** "12 new signals, 3 high or critical" */
export function summarise(items) {
    const n = items.length
    const hot = items.filter((i) => sevRank(i.severity) >= 3).length
    if (!n) return "Nothing new in this window."
    return `${n} new signal${n === 1 ? "" : "s"}, ${hot} high or critical`
}

/** Read the mark, tolerating a cleared or corrupted store. */
export function readLastSeen(storage) {
    try {
        const v = Number(storage?.getItem(LAST_SEEN_KEY))
        return Number.isFinite(v) && v > 0 ? v : null
    } catch {
        return null
    }
}

export function writeLastSeen(storage, now = Date.now()) {
    try { storage?.setItem(LAST_SEEN_KEY, String(now)) } catch { /* private mode */ }
}
