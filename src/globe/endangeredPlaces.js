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
import { markerUri, clusterIcon, priorityOf, PRIORITY } from "../lib/mapIcons.js"

export const ALARM_COLOR = { red: PRIORITY.flash, amber: PRIORITY.urgent, grey: PRIORITY.info }

export const KIND_LABEL = {
    refinery: "Refinery", fuel_depot: "Fuel depot", fuel_station: "Fuel station",
    gathering: "Gathering point", roundabout: "Roundabout", arms_company: "Arms-industry company",
    // other countries (backend/endangered_sources.py)
    assembly: "Notified assembly", strike: "Strike", action: "Called action",
    lobby_office: "Arms-lobby office / EU body", listed_site: "Site on an activist map",
}

// The kind's glyph in lib/mapIcons.js GLYPH (line glyphs, one weight).
const GLYPH_KEY = {
    refinery: "refinery", fuel_depot: "fuel_depot", fuel_station: "fuel_station", gathering: "gathering",
    roundabout: "roundabout", arms_company: "arms_company", assembly: "assembly", strike: "raised_fist",
    action: "action", lobby_office: "lobby_office", listed_site: "gathering",
}

/**
 * The marker for one place, in the one typology (lib/mapIcons.js): a triangle (a warning we derived) when a
 * call names it, a circle otherwise; the kind's glyph inside; the alarm as priority (red = flash, amber =
 * urgent, grey = info). One constant size: `size` is accepted for old callers and ignored.
 */
export function placeIconUri({ kind, alarm = "grey", hasCall = false }) {
    return markerUri({ kind: hasCall ? "derived" : "event", glyph: GLYPH_KEY[kind] || "gathering", priority: priorityOf(alarm, "info") })
}

/** A cluster of places on the phone: the one cluster badge (lib/mapIcons.js), ringed in the worst alarm inside. */
export function clusterIconUri({ count, alarm = "grey" }) {
    return clusterIcon(count, priorityOf(alarm, "info")).uri
}

const RANK = { red: 0, amber: 1, grey: 2 }
export const worstAlarm = (a, b) => ((RANK[a] ?? 2) <= (RANK[b] ?? 2) ? a : b)

/** One line per place on a list: "Fuel depot · Cusset (03) · TotalEnergies";
 *  outside France the country is named: "Notified assembly · Berlin · Germany". */
export function placeSubtitle(p) {
    const where = p.city ? `${p.city}${p.dept ? ` (${p.dept})` : ""}` : null
    const country = p.country && p.country !== "FR" ? (p.country_name || p.country) : null
    return [p.kind_label || KIND_LABEL[p.kind], where, p.operator ? String(p.operator).split(" (")[0] : null, country]
        .filter(Boolean).join(" · ")
}

/** The calls, each in plain English with its date, time and source. */
export function callLines(p) {
    return (Array.isArray(p.calls) ? p.calls : []).map((c) => c.line || c.label_en).filter(Boolean)
}

/** What the card says when there is no dated call. */
export function listedNote(p) {
    if (p.note) return p.note
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
    const near = nearbyLine(p)
    if (near && p.active === "nearby") parts.unshift(`Nearby call: ${near}.`)
    if (p.operator) parts.push(`Operator: ${p.operator}.`)
    if (p.kind === "arms_company" || p.kind === "lobby_office" || p.kind === "listed_site") {
        const what = [p.sector, p.domain].filter(Boolean).join(" — ")
        if (what) parts.push(`Activity: ${what}.`)
        if (Array.isArray(p.lists) && p.lists.length) parts.push(`On the map's lists: ${p.lists.join("; ")}.`)
    }
    if (p.approx) parts.push(`Position ${p.approx}.`)
    parts.push(`Status: ${p.status}.`)
    const credit = creditLine(p)
    if (credit) parts.push(credit)
    return parts.join(" ")
}

/** "Source: Polizei Berlin — notified assemblies. Credit: …" — every place
 *  says where it comes from and under which terms. */
export function creditLine(p) {
    if (!p || (!p.source && !p.credit)) return null
    const src = p.source ? `Source: ${p.source}.` : ""
    const credit = p.credit && p.credit !== p.source ? ` Credit: ${p.credit}.` : ""
    return `${src}${credit}`.trim().replace(/\.\./g, ".")
}

// ── the country filter (desktop layer card, phone sheet) ─────────────────

const COUNTRY_KEY = "endangered:countries"
let _countries = (() => {
    try {
        const v = JSON.parse(localStorage.getItem(COUNTRY_KEY) || "[]")
        return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []
    } catch { return [] }
})()
const _subs = new Set()

/** The ISO2 codes chosen, [] for every country. */
export const getCountryFilter = () => _countries

export function setCountryFilter(list) {
    _countries = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).toUpperCase()))].sort()
    try { localStorage.setItem(COUNTRY_KEY, JSON.stringify(_countries)) } catch { /* private window */ }
    _subs.forEach((fn) => { try { fn(_countries) } catch { /* a listener's own problem */ } })
}

export function toggleCountry(code) {
    const c = String(code).toUpperCase()
    setCountryFilter(_countries.includes(c) ? _countries.filter((x) => x !== c) : [..._countries, c])
}

export function subscribeCountryFilter(fn) {
    _subs.add(fn)
    return () => _subs.delete(fn)
}

/** Is this place in the chosen countries (a place without one is French). */
export const inCountries = (p, sel = _countries) => !sel || !sel.length || sel.includes(p?.country || "FR")

export const filterByCountry = (places, sel = _countries) =>
    (Array.isArray(places) ? places : []).filter((p) => inCountries(p, sel))

// ── "Active only" (desktop layer card, phone Filters sheet) ──────────────
// Only the places with a dated call today or to come, plus the places within
// a couple of kilometres of one (backend endangered_places.query active=1,
// which computes the proximity — the phone stays light). Remembered per device.

const ACTIVE_KEY = "endangered:activeOnly"
let _active = (() => {
    try { return localStorage.getItem(ACTIVE_KEY) === "1" } catch { return false }
})()
const _activeSubs = new Set()

export const getActiveOnly = () => _active

export function setActiveOnly(v) {
    _active = !!v
    try { localStorage.setItem(ACTIVE_KEY, _active ? "1" : "0") } catch { /* private window */ }
    _activeSubs.forEach((fn) => { try { fn(_active) } catch { /* a listener's own problem */ } })
}

export function subscribeActiveOnly(fn) {
    _activeSubs.add(fn)
    return () => _activeSubs.delete(fn)
}

/** The layer's request: every place, or only the active ones. */
export const placesUrl = (base, active = _active) => `${base}/api/endangered-places${active ? "?active=1" : ""}`

/** "1.2 km" / "350 m" */
export function distanceLabel(km) {
    const d = Number(km)
    if (!Number.isFinite(d)) return ""
    return d < 1 ? `${Math.max(10, Math.round(d * 100) * 10)} m` : `${d.toFixed(1)} km`
}

/** The nearest call close to a place that has none of its own:
 *  "Nearby call, 800 m away at Place Bellecour (Lyon): March / demonstration called for Sat 17 Oct, 14:00 — source: …" */
export function nearbyLine(p) {
    const n = Array.isArray(p?.nearby_calls) ? p.nearby_calls[0] : null
    if (!n) return null
    const where = `${n.name || "a called place"}${n.city && !String(n.name || "").includes(n.city) ? ` (${n.city})` : ""}`
    const more = (p.nearby_count || 0) > 1 ? ` — and ${p.nearby_count - 1} more call${p.nearby_count > 2 ? "s" : ""} within reach` : ""
    return `${distanceLabel(n.distance_km)} away at ${where}: ${n.line || n.call || "a call to act"}${more}`
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
