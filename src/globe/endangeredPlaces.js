/**
 * endangeredPlaces.js — the "Endangered places" layer's shared pieces, for
 * the desktop globe (GlobeEndangeredPlacesLayer.jsx), the phone's Leaflet
 * registry (mobile/mapLayers.js) and the inspector (inspector/adapters.js).
 *
 * A place that a public call names for a blockade or another action
 * (backend/endangered_places.py): refineries, fuel depots, fuel stations
 * and rally points from the gilets jaunes' map, and arms-industry companies
 * an anti-militarist map lists as targets. Colour is the server's `alarm`:
 *   red    a roadblock, slow-drive convoy or picket within 48 h
 *   amber  any other call still to come
 *   grey   listed without a call, or the calls are over
 * Shape: a warning triangle when there is a call, a small disc when the
 * place is only listed; the glyph inside says what the place is.
 */
import { MARKER_SUPERSAMPLE } from "./entityIcons.js"

export const ALARM_COLOR = { red: "#E5484D", amber: "#F5A524", grey: "#8A94A3" }

export const KIND_LABEL = {
    refinery: "Refinery", fuel_depot: "Fuel depot", fuel_station: "Fuel station",
    gathering: "Gathering point", roundabout: "Roundabout", arms_company: "Arms-industry company",
}

// Glyphs on a 24-unit grid, drawn in one colour.
const GLYPH = {
    // a works with a chimney
    refinery: `<path d="M4 20 V11 L9 14 V11 L14 14 V5 H17 V20 Z"/>`,
    // a storage tank
    fuel_depot: `<path d="M5 9 Q12 5 19 9 V18 Q12 21.5 5 18 Z"/>`,
    // a pump and its hose
    fuel_station: `<path d="M6 5 H14 V20 H6 Z"/><path d="M14 9 L17.5 11 V17 Q17.5 19.5 19.5 18.5 V9" fill="none" stroke-width="1.8"/>`,
    // a raised flag
    gathering: `<path d="M7 3.5 V20.5" fill="none" stroke-width="2.2"/><path d="M7.5 4.5 H18 L15 8.5 L18 12.5 H7.5 Z"/>`,
    // a ring with its island
    roundabout: `<circle cx="12" cy="12" r="6.2" fill="none" stroke-width="2.6"/><circle cx="12" cy="12" r="2.2"/>`,
    // a cross-hair
    arms_company: `<circle cx="12" cy="12" r="6" fill="none" stroke-width="2.2"/><path d="M12 3 V8 M12 16 V21 M3 12 H8 M16 12 H21" fill="none" stroke-width="2.2"/>`,
}

const _cache = new Map()

/** The marker for one place: a warning triangle (with a call) or a disc (listed). */
export function placeIconUri({ kind, alarm = "grey", hasCall = false, size = 22 }) {
    const key = `${kind}:${alarm}:${hasCall}:${size}`
    if (_cache.has(key)) return _cache.get(key)
    const px = size * MARKER_SUPERSAMPLE
    const color = ALARM_COLOR[alarm] || ALARM_COLOR.grey
    const glyph = GLYPH[kind] || GLYPH.gathering
    let body
    if (hasCall) {
        // warning triangle, the glyph dark inside it, low in the triangle
        const g = px / 24
        body = `<path d="M ${px / 2} ${px * 0.06} L ${px * 0.96} ${px * 0.9} L ${px * 0.04} ${px * 0.9} Z" `
            + `fill="${color}" stroke="#0B0F1A" stroke-width="${1.6 * MARKER_SUPERSAMPLE}" stroke-linejoin="round"/>`
            + `<g transform="translate(${px * 0.29} ${px * 0.4}) scale(${(g * 0.42).toFixed(3)})" fill="#0B0F1A" stroke="#0B0F1A">${glyph}</g>`
    } else {
        body = `<circle cx="${px / 2}" cy="${px / 2}" r="${px * 0.44}" fill="#0B0F1A" fill-opacity="0.78" `
            + `stroke="${color}" stroke-width="${1.3 * MARKER_SUPERSAMPLE}"/>`
            + `<g transform="translate(${px * 0.2} ${px * 0.2}) scale(${(px / 24 * 0.6).toFixed(3)})" fill="${color}" stroke="${color}">${glyph}</g>`
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${body}</svg>`
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    _cache.set(key, uri)
    return uri
}

/** A cluster of places on the phone: a disc with the count, in the worst colour inside. */
export function clusterIconUri({ count, alarm = "grey", size = 30 }) {
    const key = `cl:${count}:${alarm}:${size}`
    if (_cache.has(key)) return _cache.get(key)
    const px = size * MARKER_SUPERSAMPLE
    const color = ALARM_COLOR[alarm] || ALARM_COLOR.grey
    const label = count > 999 ? "999+" : String(count)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">`
        + `<circle cx="${px / 2}" cy="${px / 2}" r="${px * 0.45}" fill="#0B0F1A" fill-opacity="0.85" stroke="${color}" stroke-width="${2.2 * MARKER_SUPERSAMPLE}"/>`
        + `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="#F1F3F5" `
        + `font-family="-apple-system, system-ui, 'Segoe UI', sans-serif" font-weight="600" font-size="${px * (label.length > 2 ? 0.3 : 0.38)}">${label}</text>`
        + `</svg>`
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    _cache.set(key, uri)
    return uri
}

const RANK = { red: 0, amber: 1, grey: 2 }
export const worstAlarm = (a, b) => ((RANK[a] ?? 2) <= (RANK[b] ?? 2) ? a : b)

/** One line per place on a list: "Fuel depot · Cusset (03) · TotalEnergies". */
export function placeSubtitle(p) {
    const where = p.city ? `${p.city}${p.dept ? ` (${p.dept})` : ""}` : null
    return [p.kind_label || KIND_LABEL[p.kind], where, p.operator ? String(p.operator).split(" (")[0] : null]
        .filter(Boolean).join(" · ")
}

/** The calls, each in plain English with its date, time and source. */
export function callLines(p) {
    return (Array.isArray(p.calls) ? p.calls : []).map((c) => c.line || c.label_en).filter(Boolean)
}

/** What the card says when there is no dated call. */
export function listedNote(p) {
    if (p.kind === "arms_company") {
        return p.note || "Listed by an anti-militarist map as a target for action — no dated call"
    }
    return "On the map of calls, with no action declared here yet"
}

/** The card's text block: calls, or why it is listed. */
export function placeDetail(p) {
    const lines = callLines(p)
    const parts = []
    if (lines.length) parts.push(lines.join(". ") + ".")
    else parts.push(listedNote(p) + ".")
    if (p.operator) parts.push(`Operator: ${p.operator}.`)
    if (p.kind === "arms_company") {
        const what = [p.sector, p.domain].filter(Boolean).join(" — ")
        if (what) parts.push(`Activity: ${what}.`)
        if (Array.isArray(p.lists) && p.lists.length) parts.push(`On the map's lists: ${p.lists.join("; ")}.`)
    }
    parts.push(`Status: ${p.status}.`)
    return parts.join(" ")
}

// ── default on while calls are within 7 days ─────────────────────────────

const STORE_KEY = "endangered:within7"
// The one action day the sources call for so far (backend GJ_ACTION_DATE),
// used only until the first answer from the server is remembered.
const KNOWN_ACTION_DAYS = ["2026-10-17"]

export function rememberWithin7(v) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: !!v, t: Date.now() })) } catch { /* private window */ }
}

/** Is the layer on by default: a call within the next 7 days. */
export function defaultOnNow(nowMs = Date.now()) {
    try {
        const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null")
        if (s && typeof s.v === "boolean" && nowMs - s.t < 12 * 3600_000) return s.v
    } catch { /* fall through */ }
    return KNOWN_ACTION_DAYS.some((d) => {
        const end = Date.parse(`${d}T23:59:00+02:00`)
        return end >= nowMs && end - nowMs <= 8 * 86_400_000
    })
}
