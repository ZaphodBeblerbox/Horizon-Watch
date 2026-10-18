/**
 * demoSituation.js — the city situation's drawing rules, for the globe
 * (GlobeDemonstrationsLayer.jsx) and the phone (mobile/mapLayers.js,
 * "demonstrations:situation"). Owner, 2026-10-17: "align where the
 * demonstrators are: last known locations, probable points of convergence.
 * That needs to be shown on the map … Movements displayed in real time, and
 * probable future points of convergence."
 *
 * One answer, GET /api/routes/demonstrations/situation (backend/demo_situation.py),
 * read every 30 s while on. Per city:
 *   crowds      — last known place of each crowd: a ring with a dot, its
 *                 words "Concorde · 12 min ago" beside it; the whole mark
 *                 fades with age (gone at 3 h). Its recent path, solid amber.
 *   routes      — each crowd's walking route toward a top convergence point,
 *                 dashed (a straight dashed line, fainter, while the router
 *                 has not answered: "estimated").
 *   convergence — ranked probable convergence points: a target mark (two
 *                 rings and a centre) with "1 · Élysée · est. 72%". An
 *                 ESTIMATE, labelled so on the map and in the card.
 * Tapping any of them opens the evidence: the messages with links and times.
 * Colour only in icons and lines; every word white on a dark halo.
 */

export const SITUATION_PATH = "/api/routes/demonstrations/situation"
export const SITUATION_REFRESH_MS = 30_000
export const CROWD_COLOUR = "#F5A524"          // the protest amber of the movement layer
export const CONVERGE_COLOUR = "#FF5C7A"       // a target, distinct from any crowd or hazard mark
export const ROUTE_COLOUR = "#F5A524"
export const ESTIMATE_NOTE = "Estimate from Telegram calls and reports and walking times, not a confirmed prediction"
const CROWD_MAX_AGE_MIN = 180

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }
const short = (place) => (place ? String(place).split(",")[0].trim() : "")
const arr = (v) => (Array.isArray(v) ? v : [])
const fin = (p) => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lon)

/** "just now", "12 min ago", "1 h 20 ago". */
export function ageLabel(ageMin) {
    const m = Math.round(Number(ageMin))
    if (!Number.isFinite(m)) return ""
    if (m < 1) return "just now"
    if (m < 60) return `${m} min ago`
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} ago`
}

/** A crowd mark's strength by age: full when fresh, a third at 3 h. */
export function crowdAlpha(ageMin) {
    const a = Number(ageMin)
    if (!Number.isFinite(a) || a <= 0) return 1
    return Math.max(0.35, 1 - (0.65 * Math.min(a, CROWD_MAX_AGE_MIN)) / CROWD_MAX_AGE_MIN)
}

export function rgba(hex, a) {
    const h = String(hex).replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`
}

/** "est. 72%" — always says estimate. */
export function scoreLabel(score) {
    const s = Number(score)
    return Number.isFinite(s) ? `est. ${Math.round(s * 100)}%` : "estimate"
}

function textW(t, size) { return Math.round(String(t).length * size * 0.58) }

/** A crowd: amber ring and dot, words to its right; faded by age. {uri, width, height, anchor}. */
export function crowdIcon(label, alpha = 1) {
    const text = String(label || "")
    const width = 24 + textW(text, 11) + 6, height = 22
    const a = Math.round(alpha * 100) / 100
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g opacity="${a}">`
        + `<circle cx="11" cy="11" r="8" fill="${rgba(CROWD_COLOUR, 0.25)}" stroke="${CROWD_COLOUR}" stroke-width="2.4"/>`
        + `<circle cx="11" cy="11" r="3.2" fill="${CROWD_COLOUR}"/>`
        + (text ? `<text x="23" y="15" font-family="${FONT}" font-size="11" font-weight="600" fill="#F2F4F7" stroke="#05070C" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>` : "")
        + "</g></svg>"
    return { uri: svgUri(svg), width, height, anchor: [11, 11] }
}

/** A probable convergence point: two rings, a cross and a centre, its words below. Junctions get one ring, dashed. */
export function convergenceIcon(label, { junction = false } = {}) {
    const text = String(label || "")
    const tw = textW(text, 11)
    const width = Math.max(34, tw + 10), height = 34 + (text ? 16 : 0)
    const cx = width / 2
    const c = CONVERGE_COLOUR
    const rings = junction
        ? `<circle cx="${cx}" cy="17" r="11" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/>`
        : `<circle cx="${cx}" cy="17" r="15" fill="none" stroke="${c}" stroke-width="1.6" stroke-opacity="0.75"/>`
          + `<circle cx="${cx}" cy="17" r="9.5" fill="${rgba(c, 0.18)}" stroke="${c}" stroke-width="2.4"/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + rings
        + `<path d="M${cx} 3v6M${cx} 25v6M${cx - 14} 17h6M${cx + 8} 17h6" stroke="${c}" stroke-width="1.6"/>`
        + `<circle cx="${cx}" cy="17" r="3" fill="${c}"/>`
        + (text ? `<text x="${cx}" y="${height - 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#F2F4F7" stroke="#05070C" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>` : "")
        + "</svg>"
    return { uri: svgUri(svg), width, height, anchor: [Math.round(cx), 17] }
}

const hhmmUtc = (iso) => { const t = ms(iso); return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : "" }
const srcLine = (s) => `• ${s.hhmm || hhmmUtc(s.published_at || s.at)}${s.source ? ` ${s.source}` : ""}: ${s.title || s.text || ""}${s.url ? ` (${s.url})` : ""}`

/** A crowd's card: where and when, its path, the posts behind it. */
export function crowdDetail(g) {
    const path = arr(g?.path).map((p) => short(p.place)).filter(Boolean)
    return [
        `A crowd was last reported at ${short(g?.place) || "this place"}${g?.hhmm ? ` at ${g.hhmm}` : ""} (${ageLabel(g?.age_min)}), ${g?.n_reports || 1} report${g?.n_reports === 1 ? "" : "s"}.`,
        path.length > 1 ? `Its path: ${path.join(" → ")}.` : null,
        g?.heading_to?.name ? `Said to be heading to ${g.heading_to.name}.` : null,
        g?.self_reported ? "Includes positions people reported themselves." : null,
        "Reconstructed from Telegram reports, not tracked.",
        "Reports:",
        ...arr(g?.sources).slice().reverse().map(srcLine),
    ].filter(Boolean).join("\n")
}

/** A convergence point's card: the explanation, the score as an estimate, the calls and the crowds. */
export function convergenceDetail(c, crowdsById = {}) {
    const calls = arr(c?.calls).filter((x) => x.kind !== "heading")
    const reach = arr(c?.reach)
    return [
        `${c?.rank ? `#${c.rank} ` : ""}probable convergence point: ${c?.name || "?"} (${scoreLabel(c?.score)}).`,
        c?.explanation ? `Why: ${c.explanation}.` : null,
        arr(c?.acts).length ? `Called to: ${c.acts.join(", ")}.` : null,
        reach.length ? "Crowds:" : null,
        ...reach.map((r) => `• ${short(crowdsById[r.crowd_id]?.place || r.place) || "a crowd"}${r.hhmm ? ` (seen ${r.hhmm})` : ""}: `
            + `${r.there ? "already there" : `${Math.round(r.eta_min)} min walk${r.routed ? "" : " (estimated)"}`}${r.heading ? ", said to be heading there" : ""}`),
        calls.length ? "Calls naming it:" : null,
        ...calls.slice().reverse().slice(0, 12).map((x) => srcLine({ ...x, published_at: x.at })),
        ESTIMATE_NOTE + ".",
    ].filter(Boolean).join("\n")
}

/**
 * The situation as map features, every city: one list for the phone (a
 * "lines" layer: a point is a zero-length line carrying its marker) and the
 * globe. Each: {id, type: "demo_crowd"|"demo_path"|"demo_route"|"demo_convergence",
 * coords, color, weight, dash, marker?, title, sub, raw}. Newest crowds and the
 * best points last, so they draw on top.
 */
export function situationFeatures(data, now = Date.now()) {
    const out = []
    for (const city of arr(data?.cities)) {
        const crowds = arr(city.crowds).filter(fin)
        const byId = Object.fromEntries(crowds.map((g) => [g.id, g]))
        const conv = arr(city.convergence).filter(fin)
        const convIds = new Set(conv.map((c) => c.id))
        for (const r of arr(city.routes)) {
            const coords = arr(r.coords).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [+p[0], +p[1]])
            if (coords.length < 2 || !convIds.has(r.target_id)) continue
            const t = conv.find((c) => c.id === r.target_id)
            const title = `${Math.round(r.eta_min)} min walk to ${t?.name || "a convergence point"}${r.routed ? "" : " (estimated)"}`
            out.push({
                id: `sit-${r.id}`, type: "demo_route", coords, color: rgba(ROUTE_COLOUR, r.routed ? 0.85 : 0.5),
                weight: r.routed ? 2.5 : 2, dash: r.routed ? "7 6" : "2 7", title,
                sub: `From ${short(byId[r.crowd_id]?.place) || "a crowd"} · ${r.routed ? "walking route" : "straight line, routing pending"}`,
                raw: { ...r, kind: "demo_route", title, lat: coords[coords.length - 1][0], lon: coords[coords.length - 1][1],
                       detail: `${title}. ${r.routed ? "Walking route on the street network (OSRM, OpenStreetMap)" : "Straight line; the walking route is being computed"}; `
                           + "a crowd walks at about 4 km/h. " + ESTIMATE_NOTE + ".",
                       source: "Route estimate", url: null, published_at: data?.generated_at || null },
            })
        }
        for (const g of crowds.slice().reverse()) {
            const age = Number.isFinite(ms(g.at)) ? (now - ms(g.at)) / 60_000 : g.age_min
            const alpha = crowdAlpha(age)
            const path = arr(g.path).filter(fin).map((p) => [+p.lat, +p.lon])
            const title = `Crowd at ${short(g.place) || "a reported place"}, ${ageLabel(age)}`
            const raw = { ...g, kind: "demo_crowd", title, detail: crowdDetail({ ...g, age_min: age }), published_at: g.at,
                          url: arr(g.sources).slice().reverse().find((s) => s?.url)?.url || null, source: "Reconstructed from Telegram reports",
                          sources: arr(g.sources) }
            if (path.length >= 2) {
                out.push({ id: `sit-path-${g.id}`, type: "demo_path", coords: path, color: rgba(CROWD_COLOUR, alpha * 0.9), weight: 3, dash: null,
                           title, sub: arr(g.path).map((p) => short(p.place)).join(" → "), raw })
            }
            const ic = crowdIcon(`${short(g.place)} · ${ageLabel(age)}`, alpha)
            out.push({
                id: `sit-crowd-${g.id}`, type: "demo_crowd", coords: [[+g.lat, +g.lon], [+g.lat, +g.lon]], color: rgba(CROWD_COLOUR, 0), weight: 0,
                marker: { lat: +g.lat, lon: +g.lon, iconUri: ic.uri, iconWidth: ic.width, iconHeight: ic.height, iconAnchor: ic.anchor },
                title, sub: `${g.n_reports || 1} reports${g.heading_to?.name ? ` · heading to ${g.heading_to.name}` : ""}`, raw, alpha,
            })
        }
        for (const c of conv.slice().reverse()) {
            const junction = c.kind === "junction"
            const label = `${c.rank ? `${c.rank} · ` : ""}${short(c.name)} · ${scoreLabel(c.score)}`
            const ic = convergenceIcon(label, { junction })
            const title = `Probable convergence: ${short(c.name)} (${scoreLabel(c.score)})`
            out.push({
                id: `sit-conv-${c.id}`, type: "demo_convergence", coords: [[+c.lat, +c.lon], [+c.lat, +c.lon]], color: rgba(CONVERGE_COLOUR, 0), weight: 0,
                marker: { lat: +c.lat, lon: +c.lon, iconUri: ic.uri, iconWidth: ic.width, iconHeight: ic.height, iconAnchor: ic.anchor },
                title, sub: c.explanation || null,
                raw: { ...c, kind: "demo_convergence", title, sub: c.explanation || null, detail: convergenceDetail(c, byId),
                       url: arr(c.calls).slice().reverse().find((x) => x?.url)?.url || null, source: "Estimate",
                       published_at: data?.generated_at || null, estimate: true, note: ESTIMATE_NOTE },
            })
        }
    }
    return out
}

/** "What is happening in <city> now": the city's latest developments as lines for a card. */
export function developmentLines(city, n = 8) {
    return arr(city?.developments).slice(0, n).map((d) => `${d.hhmm || hhmmUtc(d.at)} · ${d.kind} · ${short(d.place)}: ${d.title || ""}`)
}
