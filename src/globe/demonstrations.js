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
 *     through the reported places in time order, an
 *     arrowhead on the latest and "last reported HH:MM" at its head. Nobody
 *     tracks the crowd, and every label says so.
 *
 * Colour lives in the icons and the lines only; every word is plain.
 */
import { markerUri, markerIcon } from "../lib/mapIcons.js"
import { hazardLine } from "../routes/view.js"
import { freshAlpha } from "./freshness.js"
import { itemStatusLabel } from "./protests.js"

export const DEMOS_PATH = "/api/routes/demonstrations"
export const DEMOS_REFRESH_MS = 30_000     // "follow the demonstrations in real time" (owner, 2026-10-17); the backend memoises 30 s
export const DEMO_SIZE = 20
/** The protest amber of the unrest layer (GlobeTelegramLayer.jsx unrestIcon). */
export const TRACK_COLOUR = "#F5A524"
export const RECONSTRUCTED = "Reconstructed from Telegram reports, not tracked"

const POLICE = new Set(["kettle", "charge", "tear_gas", "water_cannon", "clashes", "evacuation", "reinforcements", "kinetic"])
const BLOCK = new Set(["roadblock", "closure", "checkpoint"])

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

// THE ONE TYPOLOGY (lib/mapIcons.js, owner 2026-10-23): a hazard is a reported event, a circle with what it is
// inside; announced, not begun = the upcoming state; police action urgent, the rest alert. No ring, no diamond.
const FAMILY_GLYPH = { police: "police", crowd: "crowd", other: "crowd", announced: "placard", block: "generic", strike: "raised_fist" }
/** A hazard's mark. */
export function demoIconUri(h, now = Date.now()) {
    const fam = demoFamily(h, now)
    return markerUri({ kind: "event", glyph: FAMILY_GLYPH[fam] || "crowd", priority: fam === "police" ? "urgent" : "alert",
                       state: fam === "announced" ? "upcoming" : "live" })
}

const cap = (s) => (s ? `${String(s)[0].toUpperCase()}${String(s).slice(1)}` : s)
const short = (place) => (place ? String(place).split(",")[0].trim() : "")

/** "Kettle · Place de la République" */
export function demoTitle(h) {
    return [cap(h?.label || h?.kind || "Demonstration"), short(h?.place)].filter(Boolean).join(" · ")
}

/** "12 min ago · Telegram · Paris Luttes Info" (or "starts in 30 min …") */
export function demoSub(h, now = Date.now()) {
    // an announced gathering says where it stands ("Ongoing · since 14:00"),
    // not "under way for 840 min" (backend protest_status.py)
    const line = itemStatusLabel(h, now) || hazardLine({ ...h, label: null, place: null }, now)
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
        published_at: h?.protest_status ? null : (h?.at || h?.starts_utc || null), detail: demoDetail(h),
        status_label: itemStatusLabel(h, now),
    }
}

// ── reconstructed movement ────────────────────────────────────────────────

/** A hop's strength by age: the shared rule (freshness.js) — never dimmed
 *  within hours (owner, 2026-10-19); the arrowhead says which is latest. */
export function segmentAlpha(ageMin) {
    return Math.max(freshAlpha(ageMin), 0.55)
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

/** The head of a track, at the last reported place: the crowd's marker (lib/mapIcons.js); the words are the card's. */
export function lastReportedIcon() {
    const i = markerIcon({ kind: "event", glyph: "crowd", priority: "alert" })
    return { uri: i.uri, width: i.w, height: i.h, anchor: i.anchor }
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
