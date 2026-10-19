/**
 * policeActions.js — street reports on the map (backend/street_reports.py,
 * GET /api/routes/demonstrations/street), drawn the same on the globe
 * (GlobePoliceActionsLayer.jsx, under "Demonstrations, live") and the phone
 * (mobile/mapLayers.js, "demonstrations:police").
 *
 * The owner, 2026-10-18: "'ça gaz à Répu' … a signal saying: gaz
 * lacrymogène employed at République … 'ça nasse à Répu' should show the
 * police lines blocking all the exit points of République."
 *
 *   tear gas       an area: a faint filled disc on the ground (the globe) and
 *                  its dashed edge, with the gas mark at its centre;
 *   kettle         a police line across every exit street of the square
 *                  (exits from OpenStreetMap; radial when the place has none
 *                  on file) and "Kettled — exits blocked (reported HH:MM)";
 *   police moving  an arrow from the street they came by, when said; else a
 *                  marker. A charge on a named street draws the street too;
 *   everything else a marker with its words (arrests, LBD, shots, water
 *                  cannon, barricades, fires, a crowd, footage).
 * A report is CURRENT for its own life (valid_min, from the server): only
 * then are its area, police lines and arrow drawn — they say what is so
 * now. Its mark stays after that, at FULL strength for the first three
 * hours like every other icon (globe/freshness.js; owner, 2026-10-19: "the
 * police interventions at Châtelet were dimmer than the other icons,
 * although they happened literally 1 hour ago"), easing after, and is gone
 * once a day old. Colour only in the marks and lines; words white on a
 * dark halo; no monospace.
 */
import { freshAlpha } from "./freshness.js"

export const POLICE_PATH = "/api/routes/demonstrations/street"
export const POLICE_REFRESH_MS = 30_000
export const POLICE_COLOUR = "#4C8DFF"
export const GAS_COLOUR = "#C8D44E"
const TACTIC = {
    kettle: { colour: POLICE_COLOUR, short: "Kettled" },
    tear_gas: { colour: GAS_COLOUR, short: "Tear gas" },
    charge: { colour: POLICE_COLOUR, short: "Police charge" },
    lbd: { colour: "#FF5C7A", short: "LBD / rubber bullets" },
    gunfire: { colour: "#FF3B3B", short: "Shots fired" },
    water_cannon: { colour: "#4FC3F7", short: "Water cannon" },
    arrests: { colour: POLICE_COLOUR, short: "Arrests" },
    police_arrival: { colour: POLICE_COLOUR, short: "Police moving in" },
    barricade: { colour: "#F5A524", short: "Barricades" },
    fire: { colour: "#FF7A3D", short: "Fires" },
    crowd: { colour: "#F5A524", short: "Crowd" },
    footage: { colour: "#C9CED8", short: "Footage" },
}
export const POLICE_TACTICS = Object.keys(TACTIC)
export const tacticColour = (t) => (TACTIC[t] || TACTIC.footage).colour

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const arr = (v) => (Array.isArray(v) ? v : [])
const fin = (p) => p?.lat != null && p?.lon != null && p.lat !== "" && Number.isFinite(+p.lat) && Number.isFinite(+p.lon)
const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }
const R = 6_371_000
const STACK_PX = 30

export function rgba(hex, a) {
    const h = String(hex).replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`
}

/** The point `m` metres from (lat, lon) on a bearing (degrees from north). [lat, lon]. */
export function offset(lat, lon, bearingDeg, m) {
    const b = (bearingDeg * Math.PI) / 180
    const dLat = (m * Math.cos(b)) / R
    const dLon = (m * Math.sin(b)) / (R * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
    return [+(lat + (dLat * 180) / Math.PI).toFixed(6), +(lon + (dLon * 180) / Math.PI).toFixed(6)]
}

export function metres(aLat, aLon, bLat, bLon) {
    const r = (d) => (d * Math.PI) / 180
    const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function bearing(aLat, aLon, bLat, bLon) {
    const r = (d) => (d * Math.PI) / 180
    const y = Math.sin(r(bLon - aLon)) * Math.cos(r(bLat))
    const x = Math.cos(r(aLat)) * Math.sin(r(bLat)) - Math.sin(r(aLat)) * Math.cos(r(bLat)) * Math.cos(r(bLon - aLon))
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** A closed ring of `n` points `radius` metres around a point: [[lat, lon] …]. */
export function circleRing(lat, lon, radius, n = 40) {
    const out = []
    for (let i = 0; i <= n; i++) out.push(offset(lat, lon, (i * 360) / n, radius))
    return out
}

/** A police line across one exit: a bar `2 × half` metres long, across the street's axis at the exit point. */
export function exitBar(exit, half = 22) {
    const axis = Number.isFinite(+exit?.axis) ? +exit.axis : +exit?.bearing || 0
    return [offset(+exit.lat, +exit.lon, axis + 90, half), offset(+exit.lat, +exit.lon, axis - 90, half)]
}

/** An arrow from → to: [shaft, head] with the head's barbs `headM` metres back, `spread` degrees apart. */
export function arrowCoords(from, to, headM = 45, spread = 28) {
    const b = bearing(+from.lat, +from.lon, +to.lat, +to.lon)
    const tip = [+to.lat, +to.lon]
    return [[[+from.lat, +from.lon], tip], [offset(tip[0], tip[1], b + 180 - spread, headM), tip, offset(tip[0], tip[1], b + 180 + spread, headM)]]
}

/** How strong a mark is by age: the shared rule (freshness.js) — full for
 *  hours, never dimmed within its own life; 0 once a day old. */
export function reportAlpha(ageMin, validMin = 60) {
    const a = Number(ageMin), v = Math.max(1, Number(validMin) || 60)
    if (Number.isFinite(a) && a <= v) return 1
    return freshAlpha(a)
}

/** Still current: within the report's own life, when its area, lines and arrow say what is so now. */
export function reportCurrent(ageMin, validMin = 60) {
    const a = Number(ageMin)
    return !Number.isFinite(a) || a <= Math.max(1, Number(validMin) || 60)
}

export function ageLabel(ageMin) {
    const m = Math.round(Number(ageMin))
    if (!Number.isFinite(m)) return ""
    if (m < 1) return "just now"
    if (m < 60) return `${m} min ago`
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} ago`
}

// White glyphs on the tactic's disc (24 × 24, centre 12, 12).
const GLYPH = {
    tear_gas: `<circle cx="9" cy="13" r="3.4" fill="#fff"/><circle cx="13.5" cy="10.5" r="4" fill="#fff"/><circle cx="15.5" cy="14" r="3" fill="#fff"/>`,
    kettle: `<circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" stroke="#fff" stroke-width="2.4"/>`,
    charge: `<path d="M6 8l4 4-4 4M11 8l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    police_arrival: `<path d="M12 5.5l5.5 2v4c0 3.4-2.4 5.8-5.5 7-3.1-1.2-5.5-3.6-5.5-7v-4z" fill="#fff"/>`,
    arrests: `<circle cx="9" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="2"/><circle cx="15" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="2"/>`,
    lbd: `<circle cx="12" cy="12" r="4.5" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="1.6" fill="#fff"/><path d="M12 5v2.5M12 16.5V19M5 12h2.5M16.5 12H19" stroke="#fff" stroke-width="1.8"/>`,
    gunfire: `<path d="M12 5l1.6 4.2 4.4.4-3.4 2.9 1 4.3L12 14.6 8.4 16.8l1-4.3L6 9.6l4.4-.4z" fill="#fff"/>`,
    water_cannon: `<path d="M12 5.5c2.6 3.4 4 5.6 4 7.6a4 4 0 0 1-8 0c0-2 1.4-4.2 4-7.6z" fill="#fff"/>`,
    barricade: `<rect x="5.5" y="9" width="13" height="5" fill="#fff"/><path d="M8 9l-2.5 5M12 9l-2.5 5M16 9l-2.5 5" stroke="#05070C" stroke-width="1.4"/><path d="M7.5 14v4M16.5 14v4" stroke="#fff" stroke-width="1.8"/>`,
    fire: `<path d="M12 5c.5 2.6 3.8 4 3.8 7.6A3.8 3.8 0 0 1 8.2 13c0-1.6.9-2.6 1.7-3.4.1 1.2.7 1.9 1.4 2.1C11.2 9.6 11 7.4 12 5z" fill="#fff"/>`,
    crowd: `<circle cx="8.5" cy="10" r="2" fill="#fff"/><circle cx="15.5" cy="10" r="2" fill="#fff"/><circle cx="12" cy="9" r="2.2" fill="#fff"/><path d="M5.5 17c.4-2.4 1.6-3.6 3-3.6s2.6 1.2 3 3.6M12.5 17c.4-2.4 1.6-3.6 3-3.6s2.6 1.2 3 3.6M8.6 16.5c.5-2.6 1.8-3.9 3.4-3.9s2.9 1.3 3.4 3.9" fill="#fff"/>`,
    footage: `<rect x="5.5" y="8.5" width="9.5" height="7" rx="1.2" fill="#fff"/><path d="M15.5 11l3.5-2v6l-3.5-2z" fill="#fff"/>`,
}

function textW(t, size) { return Math.round(String(t).length * size * 0.58) }

/** A tactic's mark: its disc and glyph, its words to the right; faded by age. {uri, width, height, anchor}. */
export function tacticIcon(tactic, label = "", alpha = 1) {
    const c = tacticColour(tactic)
    const text = String(label || "")
    const width = 28 + (text ? textW(text, 11) + 6 : 0), height = 28
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g opacity="${a}">`
        + `<g transform="translate(2 2)"><circle cx="12" cy="12" r="11.2" fill="${c}" stroke="#05070C" stroke-opacity=".55" stroke-width="1.2"/>`
        + (GLYPH[tactic] || GLYPH.footage) + "</g>"
        + (text ? `<text x="30" y="18" font-family="${FONT}" font-size="11" font-weight="600" fill="#F2F4F7" stroke="#05070C" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>` : "")
        + "</g></svg>"
    return { uri: svgUri(svg), width, height, anchor: [14, 14] }
}

const short = (s) => (s ? String(s).split(",")[0].trim() : "")

/** The card: what, where, when, and every post behind it — original, translation, chat, link. */
export function policeDetail(r) {
    const srcs = arr(r?.sources)
    return [
        `${r?.title || "Street report"}.`,
        `Reported ${srcs.length > 1 ? `${srcs.length} times, ` : ""}last at ${r?.hhmm || "?"} (${ageLabel(r?.age_min)}), ${r?.n_channels > 1 ? `in ${r.n_channels} chats` : `in ${srcs[0]?.channel_title || "a Telegram chat"}`}. Unverified.`,
        r?.tactic === "kettle" && arr(r?.exits).length
            ? `Exits drawn closed: ${arr(r.exits).map((e) => e.name).filter(Boolean).join(", ") || `${r.exits.length} around the place`}${r.exits_from === "radial" ? " (no street plan on file: the lines are around the place, not on its streets)" : ""}.`
            : null,
        r?.from_place ? `Coming from ${r.from_place}.` : null,
        "What was written:",
        ...srcs.slice().reverse().slice(0, 8).map((s) => `• ${s.hhmm || ""} ${s.channel_title || s.channel}: “${String(s.text || "").replace(/\s+/g, " ").slice(0, 200)}”`
            + `${s.translation ? ` — ${s.translation}` : ""}${s.media && s.media !== "none" ? ` [${s.media}]` : ""}${s.url ? ` (${s.url})` : ""}`),
    ].filter(Boolean).join("\n")
}

/**
 * The reports as map features, one list for the phone (a "lines" layer: a
 * point is a zero-length line carrying its marker) and the globe. Each:
 * {id, type: "police_area"|"police_line"|"police_arrow"|"police_street"|"police_mark",
 *  coords, color, weight, dash, marker?, area?, title, sub, raw, alpha}.
 * Older first, so the newest draw on top.
 */
export function policeFeatures(data, now = Date.now()) {
    const out = []
    const reports = arr(data?.reports).filter(fin).slice().sort((a, b) => (ms(a.at) || 0) - (ms(b.at) || 0))
    const stacked = new Map()
    for (const r of reports) {
        const age = Number.isFinite(ms(r.at)) ? (now - ms(r.at)) / 60_000 : Number(r.age_min)
        const alpha = reportAlpha(age, r.valid_min)
        if (alpha <= 0) continue
        const current = reportCurrent(age, r.valid_min)
        const lat = +r.lat, lon = +r.lon
        const colour = tacticColour(r.tactic)
        const title = r.title || "Street report"
        const raw = {
            ...r, kind: "police_action", title, detail: policeDetail({ ...r, age_min: age }), published_at: r.at, current,
            source: "Telegram, from the street", url: r.url || arr(r.sources).slice().reverse().find((s) => s?.url)?.url || null,
        }
        const sub = `${(TACTIC[r.tactic] || TACTIC.footage).short} · reported ${r.hhmm || ""} · ${ageLabel(age)}`
        const base = { title, sub, raw, alpha }
        if (current && r.tactic === "tear_gas") {
            const radius = +r.area?.radius_m || 120
            out.push({ ...base, id: `pol-gas-${r.id}`, type: "police_area", coords: circleRing(lat, lon, radius),
                       color: rgba(GAS_COLOUR, 0.85 * alpha), weight: 2, dash: "5 5",
                       area: { lat, lon, radius_m: radius, fill: rgba(GAS_COLOUR, 0.22 * alpha) } })
        }
        if (current && r.tactic === "kettle" && arr(r.exits).length) {
            const bars = arr(r.exits).filter(fin).map((e) => exitBar(e))
            if (bars.length) {
                out.push({ ...base, id: `pol-kettle-${r.id}`, type: "police_line", coords: bars, color: rgba(POLICE_COLOUR, alpha),
                           weight: 5, dash: null })
            }
        }
        if (current && arr(r.street_line).length >= 2) {
            out.push({ ...base, id: `pol-street-${r.id}`, type: "police_street", coords: arr(r.street_line).map((p) => [+p[0], +p[1]]),
                       color: rgba(colour, 0.6 * alpha), weight: 4, dash: "2 6" })
        }
        if (current && (r.tactic === "police_arrival" || r.tactic === "charge") && fin(r.from)) {
            out.push({ ...base, id: `pol-arrow-${r.id}`, type: "police_arrow", coords: arrowCoords(r.from, { lat, lon }),
                       color: rgba(POLICE_COLOUR, alpha), weight: 3.5, dash: null })
        }
        const label = r.tactic === "kettle"
            ? (current ? (r.label || `Kettled — exits blocked (reported ${r.hhmm || "?"})`) : `Kettle reported ${r.hhmm || ageLabel(age)}`)
            : `${(TACTIC[r.tactic] || TACTIC.footage).short} · ${r.hhmm || ageLabel(age)}`
        const ic = tacticIcon(r.tactic, label, alpha)
        // several reports at one place (gas, a kettle and police arriving at
        // République): their marks stack downward instead of writing over each other
        const spot = `${lat.toFixed(4)},${lon.toFixed(4)}`
        const nth = stacked.get(spot) || 0
        stacked.set(spot, nth + 1)
        out.push({
            ...base, id: `pol-mark-${r.id}`, type: "police_mark", coords: [[lat, lon], [lat, lon]], color: rgba(colour, 0), weight: 0, dash: null,
            marker: { lat, lon, iconUri: ic.uri, iconWidth: ic.width, iconHeight: ic.height,
                      iconAnchor: [ic.anchor[0], ic.anchor[1] - STACK_PX * nth] },
        })
    }
    return out
}
