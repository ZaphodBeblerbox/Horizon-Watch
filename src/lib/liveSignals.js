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
export const LIVE_WINDOW_MIN = 60
export const CROWD_MAX_MIN = 180

// Same ranges as backend/textclean.py EMOJI_RE.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2300}-\u{23FF}\u{2934}\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{2122}]+/gu

/** The text without emoji, pictographs, flags, variation selectors and joiners; spaces tidied. */
export function stripEmoji(s) {
    if (s == null) return ""
    return String(s).replace(EMOJI_RE, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s\-–—·|]+|[\s\-–—·|]+$/g, "")
}

export const ACTS = {
    arrest: { label: "Arrest", color: "#E5484D", glyph: "M9 16a3 3 0 106 0 3 3 0 00-6 0M9 16v-2M15 16v-2M12 19v2" },
    shots_fired: { label: "Shots fired", color: "#E5484D", glyph: "M7 16h8l3-2v4l-3-2M7 16l-2 4M10 13l1-2" },
    explosion: { label: "Explosion", color: "#F5A524", glyph: "M16 7l1.5 4.5L22 12l-4 3 1.5 5L16 17l-3.5 3 1.5-5-4-3 4.5-.5z" },
    strike: { label: "Strike", color: "#F5A524", glyph: "M16 6v9M12 12l4 5 4-5M9 22h14" },
    missile_launch: { label: "Missile launch", color: "#E5484D", glyph: "M10 22l10-12M17 9h4v4M9 18l3 3" },
    missile_impact: { label: "Missile impact", color: "#E5484D", glyph: "M16 8v7M13 12l3 4 3-4M10 21h12M12 18l-2 3M20 18l2 3" },
    crowd_movement: { label: "Crowd", color: "#F5A524", glyph: "M11 15a2 2 0 104 0 2 2 0 00-4 0M17 15a2 2 0 104 0 2 2 0 00-4 0M8 22c.5-3 2-4.5 4-4.5s3.5 1.500 4 4.5M16 22c.5-3 2-4.500 4-4.500s3.500 1.500 4 4.500" },
    troops_sighted: { label: "Troops", color: "#229ED9", glyph: "M8 22v-9l8-5 8 5v9M12 22v-5h8v5" },
    police_intervention: { label: "Police", color: "#229ED9", glyph: "M16 7l7 3v5c0 4-3 6.500-7 8-4-1.500-7-4-7-8v-5z" },
}
const FALLBACK = ACTS.police_intervention

const _icons = {}
/** The badge: a dark round disc, the act's colour ring and glyph. One family; `muted` draws it fainter. */
export function actIcon(act, { muted = false, bearing = null } = {}) {
    const b = Number.isFinite(bearing) ? Math.round(bearing / 15) * 15 : null     // a moving crowd: an arrowhead on the ring toward where it goes
    const key = `${act}|${muted ? 1 : 0}|${b}`
    if (_icons[key]) return _icons[key]
    const a = ACTS[act] || FALLBACK
    const op = muted ? 0.45 : 1
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" opacity="${op}">
      <circle cx="16" cy="16" r="13" fill="#0b1220" stroke="${a.color}" stroke-width="2.5"/>
      <path d="${a.glyph}" fill="none" stroke="${a.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      ${b === null ? "" : `<path d="M16 0.5l4 5h-8z" fill="${a.color}" transform="rotate(${b} 16 16)"/>`}</svg>`
    _icons[key] = `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(svg) : Buffer.from(svg).toString("base64")}`
    return _icons[key]
}

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** Is a signal still on the map at `now`? 60 min after its latest event; a crowd 3 h after its first. */
export function liveSignalDrawn(s, now = Date.now()) {
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

/** The cluster's own size on screen, so a cluster is itself a box the collision pass can treat. */
export const clusterSize = (n) => (n >= 100 ? 44 : n >= 20 ? 38 : 32)

/** Declutter to a fixed point: a cluster is bigger than a marker and may touch a neighbour, so merge again until none touch. */
export function declutterAll(items, gap = 2) {
    let cur = items.map((it) => ({ ...it, members: [it] }))
    for (let guard = 0; guard < 8; guard++) {
        const out = declutter(cur.map((g) => ({ id: g.id, x: g.x, y: g.y, sev: g.sev, size: g.members.length > 1 ? clusterSize(g.members.length) : g.size, _g: g })), gap)
        if (out.every((o) => !o.cluster)) break
        cur = out.map((o) => {
            const members = o.members.flatMap((m) => m._g.members)
            return { id: members.length === 1 ? members[0].id : `cl:${members.map((m) => m.id).sort().join("|")}`, x: o.x, y: o.y, sev: members[0].sev, size: members.length === 1 ? members[0].size : clusterSize(members.length), members }
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

const _cl = {}
/** A cluster's badge: the count on a dark disc. The same on the phone (m2-cluster) in spirit; the globe draws it as a billboard. */
export function clusterIconUri(n) {
    const d = clusterSize(n)
    const key = `${d}|${n}`
    if (_cl[key]) return _cl[key]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d * 2}" height="${d * 2}" viewBox="0 0 ${d} ${d}">
      <circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 1.5}" fill="#0b1220" stroke="#e8eaed" stroke-width="2"/>
      <text x="${d / 2}" y="${d / 2 + 4.5}" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#e8eaed">${n > 99 ? "99+" : n}</text></svg>`
    _cl[key] = `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(svg) : Buffer.from(svg).toString("base64")}`
    return _cl[key]
}

/** Is a point on the near side of the globe seen from the camera (both ECEF, metres)? A sphere's horizon. */
export function onNearSide(p, cam, R = 6371000) {
    const pl = Math.hypot(p.x, p.y, p.z), cl = Math.hypot(cam.x, cam.y, cam.z)
    if (!pl || !cl || cl <= R) return true
    return (p.x * cam.x + p.y * cam.y + p.z * cam.z) / (pl * cl) >= R / cl - 1e-9
}
