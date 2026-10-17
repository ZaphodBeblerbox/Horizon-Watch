/**
 * demonstrations.js — the "Demonstrations, live" layer's drawing rules, for
 * the globe (GlobeDemonstrationsLayer.jsx) and the phone (mobile/mapLayers.js).
 *
 * One answer, GET /api/routes/demonstrations (backend/demonstrations.py):
 *   demonstrations — every current demonstration or happening the route
 *     planner ("Get me out") avoids, the world over: its own hazards, so the
 *     map and the planner never disagree;
 *   tracks — protester movement RECONSTRUCTED from located Telegram reports
 *     (A said "heading to Bastille", B is at Bastille 40 min later): a line
 *     through the reported places in time order, older hops fainter, an
 *     arrowhead on the latest and "last reported HH:MM" at its head. Nobody
 *     tracks the crowd, and every label says so.
 *
 * Colour lives in the icons and the lines only; every word is plain.
 */
import { hazardLine } from "../routes/view.js"

export const DEMOS_PATH = "/api/routes/demonstrations"
export const DEMOS_REFRESH_MS = 60_000
export const DEMO_SIZE = 20
/** The protest amber of the unrest layer (GlobeTelegramLayer.jsx unrestIcon). */
export const TRACK_COLOUR = "#F5A524"
export const RECONSTRUCTED = "Reconstructed from Telegram reports, not tracked"

const POLICE = new Set(["kettle", "charge", "tear_gas", "water_cannon", "clashes", "evacuation", "reinforcements", "kinetic"])
const BLOCK = new Set(["roadblock", "closure", "checkpoint"])
const FAMILY_COLOUR = { police: "#E5484D", crowd: "#F5A524", announced: "#F5A524", block: "#9AA9BC", strike: "#8FB4E8", other: "#F5A524" }

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** Which mark a hazard gets: police action, a crowd, one announced and not yet begun, a block, a strike picket. */
export function demoFamily(h, now = Date.now()) {
    const k = String(h?.kind || "")
    if (POLICE.has(k)) return "police"
    if (BLOCK.has(k)) return "block"
    if (k === "strike") return "strike"
    if (h?.starts_utc && ms(h.starts_utc) > now) return "announced"
    if (["march", "gathering", "call", "unrest"].includes(k)) return "crowd"
    return "other"
}

const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const _icons = new Map()

/**
 * A hazard's mark: the unrest layer's diamond inside the planner's ring (so
 * it reads as "the route planner avoids this"). Police action: red with an
 * exclamation. A crowd: amber with three heads. Announced, not begun: hollow
 * amber with a clock. A block: grey with a bar. A strike picket: blue with a flag.
 */
export function demoIconUri(h, now = Date.now()) {
    const fam = demoFamily(h, now)
    if (_icons.has(fam)) return _icons.get(fam)
    const c = FAMILY_COLOUR[fam]
    const hollow = fam === "announced"
    const ink = hollow ? c : "#0b1220"
    const glyph = {
        police: `<path d="M16 10.5v6.8" stroke="${ink}" stroke-width="2.6"/><circle cx="16" cy="21" r="1.6" fill="${ink}"/>`,
        crowd: `<g fill="${ink}"><circle cx="12.5" cy="14" r="1.7"/><circle cx="16" cy="13" r="1.9"/><circle cx="19.5" cy="14" r="1.7"/><path d="M10.5 19c.4-2 1.2-3 2-3s1.6 1 2 3zM14 19c.4-2.3 1.2-3.4 2-3.4s1.6 1.1 2 3.4zM17.5 19c.4-2 1.2-3 2-3s1.6 1 2 3z"/></g>`,
        other: `<g fill="${ink}"><circle cx="12.5" cy="14" r="1.7"/><circle cx="16" cy="13" r="1.9"/><circle cx="19.5" cy="14" r="1.7"/><path d="M10.5 19c.4-2 1.2-3 2-3s1.6 1 2 3zM14 19c.4-2.3 1.2-3.4 2-3.4s1.6 1.1 2 3.4zM17.5 19c.4-2 1.2-3 2-3s1.6 1 2 3z"/></g>`,
        announced: `<circle cx="16" cy="16" r="4.6" fill="none" stroke="${ink}" stroke-width="1.8"/><path d="M16 13.6V16l1.8 1.2" stroke="${ink}" stroke-width="1.6" fill="none"/>`,
        block: `<path d="M11 16h10" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`,
        strike: `<path d="M13 21V11M13 11h6l-1.5 2.2L19 15.4h-6" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`,
    }[fam]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="${c}" stroke-width="1.6" stroke-opacity="0.7"/>
      <rect x="8" y="8" width="16" height="16" transform="rotate(45 16 16)" fill="${hollow ? "#0b1220" : c}" stroke="${hollow ? c : "#0b1220"}" stroke-width="${hollow ? 2.6 : 2.2}"/>
      ${glyph}</svg>`
    const uri = svgUri(svg)
    _icons.set(fam, uri)
    return uri
}

const cap = (s) => (s ? `${String(s)[0].toUpperCase()}${String(s).slice(1)}` : s)
const short = (place) => (place ? String(place).split(",")[0].trim() : "")

/** "Kettle · Place de la République" */
export function demoTitle(h) {
    return [cap(h?.label || h?.kind || "Demonstration"), short(h?.place)].filter(Boolean).join(" · ")
}

/** "12 min ago · Telegram · Paris Luttes Info" (or "starts in 30 min …") */
export function demoSub(h, now = Date.now()) {
    const line = hazardLine({ ...h, label: null, place: null }, now)
    return [line, h?.source?.label].filter(Boolean).join(" · ") || null
}

/** The card's text: what, what to do, why it is on this layer. */
export function demoDetail(h) {
    return [
        h?.what || null,
        h?.advice ? `Do: ${h.advice}` : null,
        h?.crowd ? `About ${Number(h.crowd).toLocaleString("en-GB")} people, as reported.` : null,
        "One of the hazards the route planner (Get me out) avoids right now.",
    ].filter(Boolean).join("\n")
}

/** The fields the details card reads (title, sub, url/source, published_at), on top of the hazard. */
export function demoRaw(h, now = Date.now()) {
    return {
        ...h, kind: "demonstration", hazard_kind: h?.kind || null,
        title: demoTitle(h), sub: demoSub(h, now),
        url: h?.source?.url || null, source: h?.source?.label || null,
        published_at: h?.at || h?.starts_utc || null, detail: demoDetail(h),
    }
}

// ── reconstructed movement ────────────────────────────────────────────────

/** A hop's strength by age: full when fresh, half at 90 min, never below a quarter. */
export function segmentAlpha(ageMin) {
    const a = Number(ageMin)
    if (!Number.isFinite(a) || a <= 0) return 1
    return Math.max(0.25, Math.min(1, 0.5 ** (a / 90)))
}

export function trackRgba(hex, a) {
    const h = String(hex).replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`
}

const R = 6_371_000
function metres(a, b) {
    const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180
    const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
function offset(p, brgDeg, distM) {
    const d = distM / R, b = (brgDeg * Math.PI) / 180
    const p1 = (p.lat * Math.PI) / 180, l1 = (p.lon * Math.PI) / 180
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
    return { lat: (p2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI }
}
function bearing(a, b) {
    const p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180
    const dl = ((b.lon - a.lon) * Math.PI) / 180
    const y = Math.sin(dl) * Math.cos(p2)
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** The arrowhead at `to`, pointing from `from`: [left barb, to, right barb] —
 *  a quarter of the hop, between 60 and 300 m, so it scales with the map. */
export function arrowBarbs(from, to) {
    const len = Math.max(60, Math.min(300, metres(from, to) * 0.25))
    const back = (bearing(from, to) + 180) % 360
    return [offset(to, back - 28, len), { lat: +to.lat, lon: +to.lon }, offset(to, back + 28, len)]
}

const _heads = new Map()
/**
 * The head of a track: a ring at the last reported place and its words,
 * "last reported 15:30", white on a dark halo (no colour in the text).
 * Returns {uri, width, height, anchor} — anchor on the ring's centre.
 */
export function lastReportedIcon(label) {
    const text = String(label || "last reported").replace(/[<>&"]/g, "")
    if (_heads.has(text)) return _heads.get(text)
    const width = Math.round(26 + text.length * 6.6), height = 22
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <circle cx="11" cy="11" r="6.5" fill="#0b1220" stroke="${TRACK_COLOUR}" stroke-width="3"/>
      <circle cx="11" cy="11" r="2.2" fill="${TRACK_COLOUR}"/>
      <text x="22" y="15" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="11.5" font-weight="600"
            fill="#F2F4F7" stroke="#05070C" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${text}</text></svg>`
    const out = { uri: svgUri(svg), width, height, anchor: [11, 11] }
    _heads.set(text, out)
    return out
}

const hhmm = (iso) => { const t = ms(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) : "" }
function minutesLabel(a, b) {
    const m = Math.round((ms(b) - ms(a)) / 60_000)
    return Number.isFinite(m) ? (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`) : ""
}
const distLabel = (m) => (!Number.isFinite(+m) ? "" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`)

/** One hop's card text: what was linked, why, and every post behind it. */
export function segmentDetail(track, seg) {
    const from = short(seg?.from?.place), to = short(seg?.to?.place)
    const lines = [
        `${RECONSTRUCTED}. The crowd was reported at ${from || "one place"}, then at ${to || "another"}`
            + `${seg?.distance_m != null ? `, ${distLabel(seg.distance_m)} on` : ""}`
            + `${seg?.from?.at && seg?.to?.at ? `, ${minutesLabel(seg.from.at, seg.to.at)} later` : ""}.`,
        seg?.why?.length ? `Linked because: ${seg.why.join("; ")}.` : null,
        "Reports:",
        ...(seg?.sources || []).map((s) => `• ${hhmm(s.published_at)} UTC ${s.source ? `${s.source} — ` : ""}${s.title || ""}${s.url ? ` (${s.url})` : ""}`),
    ]
    return lines.filter(Boolean).join("\n")
}

/**
 * A track as lines, one per hop (each carries its own posts), oldest first:
 *   {id, coords: [[lat, lon], …] or, for the latest, [shaft, arrowhead],
 *    color (amber, faded by age), alpha, weight, latest, marker? (the head), title, sub, raw}
 */
export function trackSegments(track, now = Date.now()) {
    const segs = Array.isArray(track?.segments) ? track.segments : []
    const n = segs.length
    const label = track?.last?.label || (track?.last?.at ? `last reported ${hhmm(track.last.at)} UTC` : "last reported")
    return segs.map((s, i) => {
        const a = s.from, b = s.to
        if (![a?.lat, a?.lon, b?.lat, b?.lon].every((v) => Number.isFinite(+v))) return null
        const latest = i === n - 1
        const age = (now - ms(s.at)) / 60_000
        const alpha = segmentAlpha(age)
        const shaft = [[+a.lat, +a.lon], [+b.lat, +b.lon]]
        const head = latest ? arrowBarbs(a, b).map((p) => [p.lat, p.lon]) : null
        const title = latest ? `Crowd movement, ${label} (reconstructed)` : "Crowd movement, reconstructed from reports"
        const sub = [`${short(a.place) || "?"} → ${short(b.place) || "?"}`, `${(s.sources || []).length} reports`].join(" · ")
        const mk = latest ? lastReportedIcon(label) : null
        return {
            id: `${track.id}-${s.i ?? i}`, latest, alpha,
            coords: head ? [shaft, head] : shaft,
            color: trackRgba(TRACK_COLOUR, alpha), weight: latest ? 4 : 3,
            marker: mk ? { lat: +b.lat, lon: +b.lon, iconUri: mk.uri, iconWidth: mk.width, iconHeight: mk.height, iconAnchor: mk.anchor } : null,
            title, sub,
            raw: {
                ...s, kind: "protest_track", id: `${track.id}-${s.i ?? i}`, track_id: track.id, city: track.city,
                title, sub, label: latest ? label : null, reconstructed: true, note: RECONSTRUCTED,
                url: (s.sources || []).find((x) => x?.url)?.url || null, source: "Reconstructed from Telegram reports",
                published_at: s.at, lat: +b.lat, lon: +b.lon, sources: s.sources || [], why: s.why || [],
                n_reports: track.n_reports, detail: segmentDetail(track, s),
            },
        }
    }).filter(Boolean)
}
