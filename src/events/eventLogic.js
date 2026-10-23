/**
 * eventLogic.js — what an event card says, the same on the desktop and the phone (backend/events.py,
 * DATAMINR_PLAN B1-B4). Pure: no fetch, no React.
 *
 *   status        Developing / Ongoing / Ended / Contradicted, as a chip
 *   updated       "Updated 14:32 · v3" (the brief's version; a quiet update bumps it without a notification)
 *   first seen    "First seen 13:58 · 34 min ago"
 *   priority      Critical / Urgent / Alert for THIS user, and why ("2 km from your office HQ")
 *   connection    which of the user's assets (or where they are) it is near, and how far
 *   follow        what following this item means: the event itself, or the place of a protest / alert / fusion
 */
import { agoLabel } from "../utils/formatTime.js"

export const STATUS = {
    developing: { label: "Developing", tone: "hot" },
    ongoing: { label: "Ongoing", tone: "warm" },
    ended: { label: "Ended", tone: "cold" },
    contradicted: { label: "Contradicted", tone: "cold" },
    waiting: { label: "Waiting for reports", tone: "cold" },
}
export const PRIORITY = { flash: { label: "Critical", rank: 0 }, urgent: { label: "Urgent", rank: 1 }, alert: { label: "Alert", rank: 2 } }

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

export function clock(v) {
    const t = ms(v)
    if (!Number.isFinite(t)) return ""
    return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function statusChip(status) {
    const s = STATUS[status] || null
    return s ? { key: status, ...s } : null
}

/** "Updated 14:32 · v3", or "" when there is no brief. */
export function updatedLine(brief) {
    if (!brief || !brief.version) return ""
    return `${brief.version > 1 ? "Updated" : "First brief"} ${clock(brief.created_at)} · v${brief.version}`
}

export function firstSeenLine(ev, now = Date.now()) {
    if (!ev?.first_seen) return ""
    const ago = agoLabel(ev.first_seen, now)
    return `First seen ${clock(ev.first_seen)}${ago ? ` · ${ago}` : ""}`
}

export function lastUpdateLine(ev, now = Date.now()) {
    const t = ev?.last_update || ev?.updated_at
    if (!t) return ""
    const ago = agoLabel(t, now)
    return `Last report ${clock(t)}${ago ? ` · ${ago}` : ""}`
}

export function priorityOf(item) {
    const p = item?.priority
    return PRIORITY[p] ? { key: p, ...PRIORITY[p] } : null
}

/** The event id an item stands for, whatever its shape (an event, a live signal, a Protests item, a card). */
export function eventIdOf(item) {
    if (!item) return null
    if (typeof item.event_id === "string" && item.event_id) return item.event_id
    if (typeof item.id === "string" && /^ev_[0-9a-f]{8}$/.test(item.id)) return item.id
    const key = item.event_key || item.eventKey || (typeof item.id === "string" ? item.id : "")
    const m = /^ev:(ev_[0-9a-f]{8})/.exec(String(key))
    return m ? m[1] : (item.event?.id || null)
}

const FOLLOW_KIND = { protest: "protest", planned: "protest", crowd: "protest", police: "protest", arrest: "protest", crowd_track: "protest",
                      police_track: "protest", fusion: "fusion", live_signal: "live_signal" }

/** What a Follow on this item sends: {target, kind, label, lat, lon}, or null when there is nothing to follow. */
export function followTargetOf(item) {
    if (!item) return null
    const eid = eventIdOf(item)
    const label = String(item.headline || item.title || item.label || "").slice(0, 160)
    if (eid) return { target: eid, kind: "event", label }
    const lat = Number(item.lat ?? item.latitude), lon = Number(item.lon ?? item.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    const kind = FOLLOW_KIND[item.kind] || (String(item.source_type || "").includes("fusion") ? "fusion" : "alert")
    const id = String(item.id ?? item.alert_id ?? `${lat.toFixed(4)},${lon.toFixed(4)}`)
    return { target: `${kind}:${id}`.slice(0, 120), kind, label, lat, lon }
}

export function km(aLat, aLon, bLat, bLon) {
    const r = Math.PI / 180
    const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function distLabel(d) {
    if (!Number.isFinite(d)) return ""
    return d < 1 ? `${Math.max(50, Math.round(d * 1000 / 50) * 50)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`
}

/** Which of the user's assets (and their own position) the item lies near, nearest first:
 *  [{name, kind, km, inside}] — inside = within the asset's watch radius (at least 5 km). */
export function assetConnection(item, assets = [], here = null) {
    const lat = Number(item?.lat), lon = Number(item?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
    const out = []
    for (const a of Array.isArray(assets) ? assets : []) {
        const aLat = Number(a?.lat), aLon = Number(a?.lon)
        if (!Number.isFinite(aLat) || !Number.isFinite(aLon)) continue
        const d = km(aLat, aLon, lat, lon)
        const radius = Math.max(5, Number(a.radius_km) || 25)
        if (d <= Math.max(radius, 50)) out.push({ name: a.name || "asset", kind: (a.kind_label || a.kind || "asset").toLowerCase(), km: d, inside: d <= radius, id: a.id })
    }
    if (here && Number.isFinite(Number(here.lat)) && Number.isFinite(Number(here.lon))) {
        const d = km(Number(here.lat), Number(here.lon), lat, lon)
        const radius = Math.max(5, Number(here.radius_km) || 30)
        if (d <= Math.max(radius, 50)) out.push({ name: "where you are", kind: "position", km: d, inside: d <= radius, me: true })
    }
    return out.sort((a, b) => a.km - b.km)
}

export function connectionLine(c) {
    if (!c) return ""
    return c.me ? `${distLabel(c.km)} from where you are` : `${distLabel(c.km)} from your ${c.kind === "asset" ? "" : `${c.kind} `}${c.name}`
}

/** Why this item is on the user's Home, in plain lines: the priority, its reason, the nearest asset, its status. */
export function homeReasons(item, conn = []) {
    const out = []
    const p = priorityOf(item)
    if (p) out.push(`${p.label} for you${item.why ? `: ${item.why}` : ""}`)
    else if (item?.why || item?._whyMine || item?.reason) out.push(String(item.why || item._whyMine || item.reason))
    if (conn[0] && !out.some((l) => l.includes(conn[0].name))) out.push(connectionLine(conn[0]))
    if (item?.followed) out.push("You follow it")
    const corr = item?.corroboration?.line || item?.event?.corroboration?.line
    if (corr) out.push(corr)
    if (item?.status === "developing") out.push("Still developing: new reports in the last minutes")
    return [...new Set(out.filter(Boolean))]
}

/** "Developing in your areas": developing first, then by the user's priority, then the newest. */
export function rankEvents(items) {
    const st = { developing: 0, ongoing: 1, ended: 2, contradicted: 3 }
    return [...(Array.isArray(items) ? items : [])].sort((a, b) =>
        ((st[a.status] ?? 4) - (st[b.status] ?? 4))
        || ((PRIORITY[a.priority]?.rank ?? 3) - (PRIORITY[b.priority]?.rank ?? 3))
        || ((ms(b.last_update) || 0) - (ms(a.last_update) || 0)))
}

/** One timeline entry as a line: {time, text, sub, kind}. */
export function timelineLine(e) {
    if (!e) return null
    const time = clock(e.at)
    if (e.kind === "brief") return { time, kind: "brief", text: e.what_changed ? `Update: ${e.what_changed}` : (e.version === 1 ? "First brief" : "Brief rewritten"),
                                     sub: e.text ? `v${e.version} · ${e.text}` : `v${e.version}` }
    if (e.kind === "movement") return { time, kind: "movement", text: e.text, sub: e.who === "police" ? "Police position" : "Crowd position" }
    if (e.kind === "status") return { time, kind: "status", text: e.text, sub: "" }
    if (e.kind === "protest") return { time, kind: "protest", text: e.text, sub: e.line || "" }
    return { time, kind: "report", text: e.text, sub: e.source || "" }
}

/** A notification card's own label: "New event · Urgent" or "Update · Critical alert" (event_watch.personalize). */
export function cardLabel(card) {
    if (!card) return ""
    if (card.event_id || card.event_key) return card.alert_type || (card.update ? "Update" : "New event")
    return card.alert_type || ""
}
