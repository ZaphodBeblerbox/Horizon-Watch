/**
 * chatThread.js — how a phone thread is laid out, kept pure so it is tested
 * (chatThread.test.js) rather than eyeballed.
 *
 * The owner, 2026-10-17: "The conversations should just look like WhatsApp,
 * Telegram, or any other." That look is three rules: a day separator where
 * the date changes, consecutive messages from one person grouped (one tail,
 * one name, tight spacing), and ticks on what you sent that turn bright when
 * the other side has read it.
 */

/** The backend sends naive UTC; read as local it is hours out. */
export function parseTs(iso) {
    if (!iso) return null
    const s = String(iso)
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`)
    return Number.isNaN(+d) ? null : d
}

/** The local calendar day, as a key. */
export function dayKey(iso) {
    const d = parseTs(iso)
    return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : ""
}

export function dayLabel(iso, today = new Date()) {
    const d = parseTs(iso)
    if (!d) return ""
    const yday = new Date(today); yday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return "Today"
    if (d.toDateString() === yday.toDateString()) return "Yesterday"
    const sameYear = d.getFullYear() === today.getFullYear()
    return d.toLocaleDateString(undefined, sameYear
        ? { weekday: "long", day: "numeric", month: "long" }
        : { day: "numeric", month: "long", year: "numeric" })
}

/** The time inside a bubble: 14:05. */
export function clock(iso) {
    const d = parseTs(iso)
    return d ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : ""
}

/** The time in the conversation list: a time today, "Yesterday", a weekday
 *  this week, a date before that — as WhatsApp's list reads. */
export function listWhen(iso, today = new Date()) {
    const d = parseTs(iso)
    if (!d) return ""
    if (d.toDateString() === today.toDateString()) return clock(iso)
    const yday = new Date(today); yday.setDate(today.getDate() - 1)
    if (d.toDateString() === yday.toDateString()) return "Yesterday"
    if (today - d < 6 * 86400e3) return d.toLocaleDateString(undefined, { weekday: "short" })
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

// Two messages from the same person more than this far apart start a new
// group, as WhatsApp does: a reply an hour later is a new turn.
export const GROUP_GAP_MS = 5 * 60 * 1000

/**
 * The thread as rows to draw, oldest first: day separators, system lines,
 * and messages flagged `first`/`last` of their group (the first carries the
 * sender's name in a group chat; the last carries the tail and the face).
 */
export function threadItems(msgs, meId) {
    const sorted = [...(msgs || [])].sort((a, b) => {
        const ta = parseTs(a.created_at)?.getTime() ?? 0, tb = parseTs(b.created_at)?.getTime() ?? 0
        return ta - tb
    })
    const out = []
    let day = null
    for (let i = 0; i < sorted.length; i++) {
        const m = sorted[i]
        const k = dayKey(m.created_at)
        if (k !== day) { out.push({ type: "day", key: `day-${k}`, label: dayLabel(m.created_at) }); day = k }
        if (m.kind === "system") { out.push({ type: "system", key: m._key || m.id, m }); continue }
        const prev = sorted[i - 1], next = sorted[i + 1]
        const joins = (a, b) => a && b && a.kind !== "system" && b.kind !== "system"
            && a.sender_id === b.sender_id && dayKey(a.created_at) === dayKey(b.created_at)
            && Math.abs((parseTs(b.created_at)?.getTime() ?? 0) - (parseTs(a.created_at)?.getTime() ?? 0)) <= GROUP_GAP_MS
        out.push({
            type: "msg", key: m._key || m.id, m,
            mine: !!meId && m.sender_id === meId,
            first: !joins(prev, m), last: !joins(m, next),
        })
    }
    return out
}

/** Sending, sent, or read by everyone else (`readAt` from the server). */
export function deliveryState(m, readAt) {
    if (m?._pending) return "sending"
    const t = parseTs(m?.created_at), r = parseTs(readAt)
    return t && r && t <= r ? "read" : "sent"
}

/** Merge a poll into what is shown: the server's list, plus anything sent
 *  from here that the server has not returned yet. */
export function mergeMessages(server, local) {
    const ids = new Set((server || []).map((m) => m.id))
    return [...(server || []), ...(local || []).filter((m) => m._pending && !ids.has(m.id))]
}
