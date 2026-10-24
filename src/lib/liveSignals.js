/**
 * liveSignals.js — the one signal family of the map, phone and desktop alike
 * (owner, 2026-10-22: "signals are still not live", "all way too much", "no
 * overlapping icons, ever"). Pure, so both maps and the tests share it.
 *
 *   stripEmoji         the guard behind backend/textclean.py strip_emoji (same ranges)
 *   ACTS / actIcon     the owner's nine acts, one marker family: a round badge with the
 *                      act's glyph; live and not-live are one style, "muted" (a high-impact act nobody
 *                      corroborated) is the same badge, fainter
 *   liveSignalDrawn    a signal is drawn for 60 min after its event (a crowd: 3 h), never longer
 *   cardText           the card in plain words: the headline and one source line
 *   declutter          collision pass in SCREEN space: markers whose boxes touch become one cluster
 *                      that opens a list; nothing is fanned out or nudged silently
 *   labelsToShow       a text label is shown only where it overlaps neither a marker nor another label
 *
 * Keep LIVE_WINDOW_MIN / CROWD_MAX_MIN the same as backend/live_signals.py.
 */
import { markerUri, clusterIcon, ICON_PX, PRIORITY, PRIORITY_RANK, priorityOf, topPriority } from "./mapIcons.js"
export { ICON_PX }
export const LIVE_WINDOW_MIN = 60
export const CROWD_MAX_MIN = 180

// Same ranges as backend/textclean.py EMOJI_RE.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2934}\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{2122}]+/gu

/** The text without emoji, pictographs, flags, variation selectors and joiners; spaces tidied. */
export function stripEmoji(s) {
    if (s == null) return ""
    return String(s).replace(EMOJI_RE, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s\-–—·|]+|[\s\-–—·|]+$/g, "")
}

// The nine acts: the glyph says which act; the colour is what it means to you (lib/mapIcons.js), never the act.
export const ACTS = {
    arrest: { label: "Arrest", glyph: "arrest", impact: true },
    shots_fired: { label: "Shots fired", glyph: "crime", impact: true },
    explosion: { label: "Explosion", glyph: "explosion", impact: true },
    strike: { label: "Strike", glyph: "strike", impact: true },
    missile_launch: { label: "Missile launch", glyph: "missile_launch", impact: true },
    missile_impact: { label: "Missile impact", glyph: "missile_impact", impact: true },
    crowd_movement: { label: "Crowd", glyph: "crowd" },
    troops_sighted: { label: "Troops", glyph: "troops" },
    police_intervention: { label: "Police", glyph: "police" },
}
const FALLBACK = ACTS.police_intervention

/** A signal's priority for you: the server's per-user priority when it sends one, else high impact = urgent, else alert. */
export function signalPriority(s) {
    if (s?.priority && PRIORITY[s.priority]) return s.priority
    return s?.high_impact && !s?.muted ? "urgent" : "alert"
}
/** A signal's state: muted (nobody corroborated it), developing (the server says so), else live. */
export const signalState = (s) => (s?.muted ? "muted" : s?.developing || s?.status === "developing" ? "developing" : "live")

/** The badge: a circle (a reported event) with the act's glyph, the priority's colour, the state's rendering. */
export function actIcon(act, { muted = false, bearing = null, priority = "alert", state = null } = {}) {
    const a = ACTS[act] || FALLBACK
    return markerUri({ kind: "event", glyph: a.glyph, priority, bearing, state: state || (muted ? "muted" : "live") })
}
/** The badge of one signal record. */
export const signalIcon = (s) => actIcon(s?.act, { bearing: s?.direction?.bearing, priority: signalPriority(s), state: signalState(s) })

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** Is a signal still on the map at `now`? 60 min after its latest event; a crowd 3 h after its first. */
export function liveSignalDrawn(s, now = Date.now()) {
    if (s?.source_kind === "user") return false        // a user's report: drawn by the User reports layer (lib/fieldReports.js)
    const last = ms(s?.event_time)
    if (!Number.isFinite(last)) return false
    const age = (now - last) / 60_000
    if (age < -1.5 || age > LIVE_WINDOW_MIN) return false
    if (s.act === "crowd_movement") {
        const first = ms(s.first_event_time || s.event_time)
        return !(now - first > CROWD_MAX_MIN * 60_000)
    }
    return true
}

export function agoWords(iso, now = Date.now()) {
    const t = ms(iso)
    if (!Number.isFinite(t)) return ""
    const m = Math.max(0, (now - t) / 60_000)
    if (m < 1) return "just now"
    if (m < 60) return `${Math.round(m)} min ago`
    return `${Math.round(m / 60)} h ago`
}

/** The card in plain words: { title, line, lines }. "Police charge at Sorbonne, Paris" / "Eyewitness, 8 min ago". */
export function cardText(s, now = Date.now()) {
    const src = stripEmoji(s?.corroboration?.line || "")
    const when = agoWords(s?.event_time, now)
    const line = [src, when].filter(Boolean).join(", ")
    return { title: stripEmoji(s?.title || ""), line, lines: (s?.lines || []).map((l) => stripEmoji(l.text)).filter(Boolean) }
}

/** The media of a signal as the sources ReportMedia reads. */
export function mediaSources(s) {
    return (s?.all_media || (s?.media ? [s.media] : [])).map((m) => ({
        media: m.kind, thumb_url: m.thumb_url, video_url: m.video_url, channel: m.channel, msg_id: m.msg_id,
        channel_title: s.sources?.[0]?.channel_title, posted_at: s.event_time,
    }))
}

const SEV = { critical: 0, high: 1, moderate: 2 }

/**
 * Collision pass, in screen pixels. items: [{id, x, y, size}] (centre, box side). Any two whose boxes
 * (plus `gap`) intersect end up in one group; a group of one is a plain marker, a larger one a cluster
 * at the mean of its members. Deterministic; nothing is displaced.
 * Returns [{ id, x, y, members:[item…], cluster:boolean }].
 */
export function declutter(items, gap = 2) {
    const n = items.length
    const parent = items.map((_, i) => i)
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
    const idx = items.map((it, i) => i).sort((a, b) => items[a].x - items[b].x)
    for (let ii = 0; ii < n; ii++) {
        const a = items[idx[ii]]
        for (let jj = ii + 1; jj < n; jj++) {
            const b = items[idx[jj]]
            const reach = (a.size + b.size) / 2 + gap
            if (b.x - a.x >= reach) break
            if (Math.abs(a.y - b.y) < reach) parent[find(idx[ii])] = find(idx[jj])
        }
    }
    const groups = new Map()
    items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it) })
    return [...groups.values()].map((members) => {
        const x = members.reduce((s, m) => s + m.x, 0) / members.length
        const y = members.reduce((s, m) => s + m.y, 0) / members.length
        const worst = members.map((m) => SEV[m.sev] ?? 3).sort((p, q) => p - q)[0]
        return { id: members.length === 1 ? members[0].id : `cl:${members.map((m) => m.id).sort().join("|")}`,
                 x, y, members, cluster: members.length > 1, worst }
    })
}

/**
 * A group's box on screen: ONE ICON PER PLACE (owner, 2026-10-23 evening) — a group is drawn as its most important
 * member's own marker (representative()), so its box is that marker's size; never a count blob.
 */
export const clusterSize = (members = null) => (Array.isArray(members) && members.length
    ? Math.max(...members.map((m) => m.size || ICON_PX)) : ICON_PX)

/**
 * Which member of a group is drawn: the highest priority for you (flash, urgent, alert, info), then the most recent
 * (`t`, ms or ISO), then the first. Members read `pri` (or `sev` as a severity word) and `t`.
 */
export function representative(members) {
    const rk = (m) => PRIORITY_RANK[priorityOf(m?.pri || m?.sev || null, "info")]
    const tm = (m) => { const v = typeof m?.t === "number" ? m.t : Date.parse(m?.t || ""); return Number.isFinite(v) ? v : -Infinity }
    return [...(members || [])].sort((a, b) => rk(a) - rk(b) || tm(b) - tm(a))[0] || null
}

/** Declutter to a fixed point: a cluster is bigger than a marker and may touch a neighbour, so merge again until none touch. */
export function declutterAll(items, gap = 2) {
    let cur = items.map((it) => ({ ...it, members: [it] }))
    for (let guard = 0; guard < 8; guard++) {
        const out = declutter(cur.map((g) => ({ id: g.id, x: g.x, y: g.y, sev: g.sev, size: g.members.length > 1 ? clusterSize(g.members) : g.size, _g: g })), gap)
        if (out.every((o) => !o.cluster)) break
        cur = out.map((o) => {
            const members = o.members.flatMap((m) => m._g.members)
            return { id: members.length === 1 ? members[0].id : `cl:${members.map((m) => m.id).sort().join("|")}`, x: o.x, y: o.y, sev: members[0].sev, size: members.length === 1 ? members[0].size : clusterSize(members), members }
        })
    }
    return cur.map((g) => ({ id: g.id, x: g.x, y: g.y, members: g.members.map((m) => m.members ? m.members[0] : m), cluster: g.members.length > 1 }))
}

/** Which labels may be shown: those whose text box overlaps no marker box and no label already kept (earlier = more important). */
export function labelsToShow(labels, markers) {
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    const boxes = markers.map((m) => ({ x: m.x - m.size / 2, y: m.y - m.size / 2, w: m.size, h: m.size }))
    const kept = []
    for (const l of labels) {
        const b = { x: l.x, y: l.y, w: l.w, h: l.h }
        if (boxes.some((o) => hit(b, o)) || kept.some((o) => hit(b, o))) continue
        kept.push(b)
        l.show = true
    }
    return labels.filter((l) => l.show)
}

/** A cluster's badge: lib/mapIcons.js clusterIcon, the same on the phone and the globe; `priorities` of its members. */
export function clusterIconUri(n, priorities = null) {
    return clusterIcon(n, priorities ? topPriority(priorities) : null).uri
}

/** Is a point on the near side of the globe seen from the camera (both ECEF, metres)? A sphere's horizon. */
export function onNearSide(p, cam, R = 6371000) {
    const pl = Math.hypot(p.x, p.y, p.z), cl = Math.hypot(cam.x, cam.y, cam.z)
    if (!pl || !cl || cl <= R) return true
    return (p.x * cam.x + p.y * cam.y + p.z * cam.z) / (pl * cl) >= R / cl - 1e-9
}
