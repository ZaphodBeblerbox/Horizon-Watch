/**
 * protests.js — the PROTESTS layer, phone and desktop alike (owner, 2026-10-23: "Protests should be an actual
 * layer ... make sure it actually works"; "this is happening right now, live ... what will take place in this
 * area tomorrow ... this happened during the day"). Pure but for the small frame store, so both maps and the
 * tests share it.
 *
 *   FRAMES            live / today / upcoming, the segmented control's three choices
 *   frame store       getFrame / setFrame / subscribeFrame (one choice for the phone map and the globe,
 *                     remembered on this device)
 *   protestBadge       the item's badge from lib/mapIcons.js: a circle for what is on the ground (a protest, a
 *                     crowd, police, arrests, clashes; the crowd's and the police's movement carry an arrowhead),
 *                     a diamond for an announced protest; "today" is the same badge, quieter
 *   cardOf            the card in plain words: title, one line (when, what), the latest messages, the source
 *   protestFeatures   GET /api/protests answer -> map features (collide: the shared collision pass)
 *   frameNote         what the layer says when the frame is empty in the user's areas
 *   refreshMs         15 s while something is live in the user's areas, 60 s otherwise (demoLive.js cadence)
 *
 * Data: backend/protests.py, GET /api/protests?frame=live|today|upcoming.
 */
import { badgeUri, ICON_PX, PALETTE } from "./mapIcons.js"
import { ACTS, stripEmoji } from "./liveSignals.js"

export const PROTESTS_PATH = "/api/protests"
export const FRAMES = [
    { key: "live", label: "Live now" },
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
]
export const LIVE_REFRESH_MS = 15_000
export const IDLE_REFRESH_MS = 60_000
export { ICON_PX }

// ── the frame, shared by the phone map and the globe ─────────────────────
const KEY = "plx.protests.frame"
let _frame = (() => {
    try { const v = globalThis.localStorage?.getItem(KEY); return FRAMES.some((f) => f.key === v) ? v : "live" } catch { return "live" }
})()
const _subs = new Set()
export function getFrame() { return _frame }
export function setFrame(f) {
    if (!FRAMES.some((x) => x.key === f) || f === _frame) return
    _frame = f
    try { globalThis.localStorage?.setItem(KEY, f) } catch { /* private mode: this session only */ }
    _subs.forEach((cb) => { try { cb(f) } catch { /* a listener's error is its own */ } })
}
export function subscribeFrame(cb) { _subs.add(cb); return () => _subs.delete(cb) }

// the last answer's counts and note, for the chips (phone map chip, desktop layer row)
let _meta = { counts: null, note: null, any_live: false, frame: null }
const _metaSubs = new Set()
export function getMeta() { return _meta }
export function setMeta(m) { _meta = { ..._meta, ...m }; _metaSubs.forEach((cb) => { try { cb(_meta) } catch { /* ignore */ } }) }
export function subscribeMeta(cb) { _metaSubs.add(cb); return () => _metaSubs.delete(cb) }

// ── icons ─────────────────────────────────────────────────────────────────
const PLACARD = "M11 9h10v7H11zM16 16v8M13 24h6"
const CLASH = "M10 10l12 12M22 10L10 22M16 7v3M16 22v3"
export const KINDS = {
    protest: { label: "Protest", color: PALETTE.amber, glyph: PLACARD, shape: "circle" },
    crowd: { label: "Crowd", color: PALETTE.amber, glyph: ACTS.crowd_movement.glyph, shape: "circle" },
    crowd_track: { label: "Crowd movement", color: PALETTE.amber, glyph: ACTS.crowd_movement.glyph, shape: "circle" },
    police: { label: "Police", color: PALETTE.blue, glyph: ACTS.police_intervention.glyph, shape: "circle" },
    police_track: { label: "Police movement", color: PALETTE.blue, glyph: ACTS.police_intervention.glyph, shape: "circle" },
    arrest: { label: "Arrests", color: PALETTE.red, glyph: ACTS.arrest.glyph, shape: "circle" },
    clash: { label: "Clashes", color: PALETTE.red, glyph: CLASH, shape: "circle" },
    planned: { label: "Planned protest", color: PALETTE.sky, glyph: PLACARD, shape: "diamond" },
}
export const TRACK_COLOR = { crowd_track: PALETTE.amber, police_track: PALETTE.blue }

/** Where the item is heading, in degrees: a track's heading; police that came by a street move away from it. */
export function headingOf(it) {
    const b = Number(it?.track?.bearing)
    if (Number.isFinite(b) && it?.track) return b
    const f = Number(it?.from?.bearing)
    if (Number.isFinite(f)) return (f + 180) % 360
    return null
}

/** The item's badge: one style (lib/mapIcons.js); "today" quieter; movement with an arrowhead. */
export function protestBadge(it) {
    const k = KINDS[it?.kind] || KINDS.protest
    return badgeUri({ shape: k.shape, color: k.color, glyph: k.glyph, bearing: headingOf(it), muted: it?.frame === "today" || !!it?.muted })
}

// ── words ─────────────────────────────────────────────────────────────────
const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** The card: { title, line, lines }. Title: what and where. Line: when, and the one-sentence context. */
export function cardOf(it) {
    const title = stripEmoji(it?.title || KINDS[it?.kind]?.label || "Protest")
    const when = stripEmoji(it?.when || "")
    let ctx = stripEmoji(it?.line || "")
    if (ctx.startsWith(title)) ctx = ctx.slice(title.length).replace(/^[,;\s]+/, "")
    const line = [when && !ctx.includes(when) ? when : null, ctx || null].filter(Boolean).join(" · ")
    const lines = []
    for (const l of it?.lines || []) { const s = stripEmoji(l); if (s && s !== title) lines.push(s) }
    for (const m of it?.messages || []) { const s = stripEmoji(m.text); if (s) lines.push(m.hhmm ? `${m.hhmm} · ${s}` : s) }
    const src = stripEmoji(it?.corroboration?.line || "")
    const by = stripEmoji(it?.sources?.[0]?.channel_title || "")
    if (src || by) lines.push([src, by && `via ${by}`].filter(Boolean).join(", "))
    return { title, line, lines: lines.slice(0, 7) }
}

/** The media of an item as the sources ReportMedia reads (only what belongs to it: backend attachment rule). */
export function mediaOf(it) {
    return (it?.all_media?.length ? it.all_media : (it?.media ? [it.media] : [])).filter(Boolean).map((m) => ({
        media: m.kind, thumb_url: m.thumb_url, video_url: m.video_url, channel: m.channel, msg_id: m.msg_id,
        channel_title: it.sources?.[0]?.channel_title, posted_at: it.last_update,
    }))
}

/** What the inspector and the phone card read: the live-signal card shape. */
export function inspectorData(it) {
    const c = cardOf(it)
    return { ...it, kind: "live_signal", protest_kind: it.kind, headline: c.title, title: c.title, status_label: c.line,
             card_lines: c.lines, sources: mediaOf(it), thumb_url: null, layerLabel: "Protests",
             channel_title: it.sources?.[0]?.channel_title }
}

const finite = (...v) => v.every((x) => Number.isFinite(Number(x)) && x !== null && x !== "")

/** The answer -> map features: one marker per item (constant ICON_PX, collide), a track carries its path. */
export function protestFeatures(d) {
    const items = Array.isArray(d?.items) ? d.items : []
    return items.filter((it) => finite(it.lat, it.lon)).map((it) => {
        const c = cardOf(it)
        const path = Array.isArray(it.track?.points) && it.track.points.length > 1
            ? it.track.points.filter((p) => finite(p.lat, p.lon)).map((p) => [Number(p.lat), Number(p.lon)]) : null
        return {
            id: it.id, lat: Number(it.lat), lon: Number(it.lon), size: ICON_PX, collide: true,
            iconUri: protestBadge(it), title: c.title, sub: c.line,
            severity: it.kind === "arrest" || it.kind === "clash" ? "high" : null,
            path, pathColor: TRACK_COLOR[it.kind] || null, pathDash: it.kind === "police_track" ? "6 5" : null,
            raw: inspectorData(it),
        }
    })
}

/** The note under the frames: the server's when the frame is empty, else a count. */
export function frameNote(d, frame) {
    if (!d) return "Loading…"
    if (d.note) return stripEmoji(d.note)
    const n = (Array.isArray(d.items) ? d.items : []).filter((i) => !String(i.kind).endsWith("_track")).length
    const word = { live: "live now", today: "today", upcoming: "upcoming" }[frame] || ""
    return `${n} ${n === 1 ? "item" : "items"} ${word} in your areas`
}

/** How long until the next read: fast while something is live in the user's areas. */
export function refreshMs(d) { return d?.any_live ? LIVE_REFRESH_MS : IDLE_REFRESH_MS }

/** Is the item's last update older than its frame allows (a stale answer between polls)? */
export function stale(it, now = Date.now()) {
    if (it?.frame !== "live") return false
    const t = ms(it.last_update)
    return Number.isFinite(t) && now - t > 3 * 3600_000
}
