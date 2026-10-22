/**
 * liveIncident.js — what a Telegram signal says about WHEN, honestly
 * (owner, 2026-10-22: "make our signals actually live").
 *
 * A post's own time (posted_at) is when someone wrote it, not when the thing
 * happened. The server's strict extractor (backend/live_incident.py) reads
 * the time of the EVENT out of the text, and the code checks it; a post it
 * did not vouch for has no event_time, and its age is the post's.
 *
 *   event_time  when it happened (only when established)
 *   live_state  live | past (was live) | not_live | unchecked  — the server's reading
 *               at the time of the response; `isLive` below is derived again from
 *               event_time and the CLIENT's clock, so a card never stays "live"
 *               past the window just because nobody refreshed it
 *
 * Keep LIVE_WINDOW_MIN the same as backend/live_incident.py.
 */
export const LIVE_WINDOW_MIN = 60
const SKEW_MS = 90_000

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** The time to measure an item's age from: its event's, else its post's. */
export function whenOf(p) {
    return p?.event_time || p?.posted_at || p?.published_at || p?.created_at || null
}

/** Live now: the server vouched for the event (live_state live/past) and it is within the window of `now`. */
export function isLive(p, now = Date.now()) {
    if (!p || (p.live_state !== "live" && p.live_state !== "past")) return false
    const t = ms(p.event_time)
    if (!Number.isFinite(t)) return false
    const d = now - t
    return d >= -SKEW_MS && d <= LIVE_WINDOW_MIN * 60_000
}

function span(mins) {
    if (mins < 1) return "just now"
    if (mins < 60) return `${Math.round(mins)} min ago`
    const h = mins / 60
    return h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`
}

/** "Live · 12 min ago" while live, else null (the caller's own label stands). */
export function liveLabel(p, now = Date.now()) {
    if (!isLive(p, now)) return null
    const mins = Math.max(0, (now - ms(p.event_time)) / 60_000)
    return mins < 1 ? "Live · just now" : `Live · ${span(mins)}`
}

/** The age words for an item: the event's age when known ("happened 3 h ago"), else the post's ("reported 3 h ago"). */
export function ageLabel(p, now = Date.now()) {
    const live = liveLabel(p, now)
    if (live) return live
    const ev = ms(p?.event_time)
    if (Number.isFinite(ev)) return `Happened ${span(Math.max(0, (now - ev) / 60_000))}`
    const t = ms(p?.posted_at || p?.published_at || p?.created_at)
    return Number.isFinite(t) ? `Reported ${span(Math.max(0, (now - t) / 60_000))}` : ""
}
