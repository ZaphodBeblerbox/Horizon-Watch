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
 *                 words "Concorde · 12 min ago" beside it; at full
 *                 strength like every other icon (freshness.js: never
 *                 dimmed within hours; the server drops it at 3 h). Its recent path, solid amber,
 *                 each hop on the streets it was walked (path_legs; a fainter
 *                 dotted straight line while that route is computed).
 *                 Where it probably is NOW (now_est): a dashed ring, no dot,
 *                 "probably here now", the dashed way there from the
 *                 last-seen mark, which then reads "Concorde · last seen
 *                 15:48 · 12 min ago". How far it could be by now (reach_m):
 *                 a faint ground circle (its size on the ground at every
 *                 zoom, never a ring that swells), from street level only.
 *   routes      — each crowd's walking route toward a top convergence point,
 *                 dashed (a straight dashed line, fainter, while the router
 *                 has not answered: "estimated").
 *   convergence — ranked probable convergence points: a target mark (two
 *                 rings and a centre) with "1 · Élysée · est. 72%". An
 *                 ESTIMATE, labelled so on the map and in the card.
 * Tapping any of them opens the evidence: the messages with links and times.
 * Colour only in icons and lines; every word white on a dark halo.
 */

import { markerIcon } from "../lib/mapIcons.js"
import { freshAlpha } from "./freshness.js"

export const SITUATION_PATH = "/api/routes/demonstrations/situation"
export const SITUATION_REFRESH_MS = 30_000
export const CROWD_COLOUR = "#F5A524"          // the protest amber of the movement layer
export const CONVERGE_COLOUR = "#FF5C7A"       // a target, distinct from any crowd or hazard mark
export const ROUTE_COLOUR = "#F5A524"
export const ESTIMATE_NOTE = "Estimate from Telegram calls and reports and walking times, not a confirmed prediction"

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }
const short = (place) => (place ? String(place).split(",")[0].trim() : "")
const arr = (v) => (Array.isArray(v) ? v : [])
const fin = (p) => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lon)
const okCoords = (cs) => arr(cs).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [+p[0], +p[1]])

/** "just now", "12 min ago", "1 h 20 ago". */
export function ageLabel(ageMin) {
    const m = Math.round(Number(ageMin))
    if (!Number.isFinite(m)) return ""
    if (m < 1) return "just now"
    if (m < 60) return `${m} min ago`
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} ago`
}

/** A crowd mark's strength by age: the shared rule (freshness.js) — never
 *  dimmed within hours (owner, 2026-10-19), never gone while on the map. */
export function crowdAlpha(ageMin) {
    return Math.max(freshAlpha(ageMin), 0.55)
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


// THE ONE TYPOLOGY (lib/mapIcons.js, owner 2026-10-23): a crowd is a reported event (a circle, the crowd glyph), its
// "probably here now" estimate the same marker uncorroborated (muted), a probable convergence point a warning we
// derived (a triangle, the fusion glyph; a junction muted). One constant size, no rings, no text in the image: the
// words are the card's. `label` is kept for old callers; `alpha` is the age fade.
const asOld = (i) => ({ uri: i.uri, width: i.w, height: i.h, anchor: i.anchor })
/** A crowd. {uri, width, height, anchor}. */
export function crowdIcon(label, alpha = 1) {
    return asOld(markerIcon({ kind: "event", glyph: "crowd", priority: "urgent", state: alpha < 0.75 ? "past" : "live" }))
}

/** Where a crowd probably is now: the same marker, uncorroborated. */
export function nowIcon() {
    return asOld(markerIcon({ kind: "event", glyph: "crowd", priority: "urgent", state: "muted" }))
}

/** A ground circle (radius in metres) as a closed line: it keeps its size on the ground at every zoom. */
export function groundCircle(lat, lon, radiusM, n = 64) {
    const out = []
    const dLat = radiusM / 111_320
    const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
    for (let i = 0; i <= n; i++) {
        const a = (2 * Math.PI * i) / n
        out.push([lat + dLat * Math.sin(a), lon + dLon * Math.cos(a)])
    }
    return out
}

/** The reach ring shows from about street level only (map zoom 12; the globe: camera under ~25 km). */
export const REACH_MIN_ZOOM = 12
export const REACH_MAX_CAMERA_M = 25_000
/** The "probably here now" mark and its way there: from zoom 13 (the globe: under ~40 km), where they do not cover the last-seen words. */
export const NOW_MIN_ZOOM = 13
export const NOW_MAX_CAMERA_M = 40_000
const NOW_MIN_ADVANCE_M = 60          // closer than this to where it was seen: the last-seen mark says it

/** "Concorde · last seen 15:48 · 12 min ago" */
export function lastSeenLabel(g, ageMin) {
    return [short(g?.place), g?.hhmm ? `last seen ${g.hhmm}` : "last seen", ageLabel(ageMin)].filter(Boolean).join(" · ")
}

/** A probable convergence point: a derived warning (triangle, fusion glyph); a junction is less certain (muted). */
export function convergenceIcon(label, { junction = false } = {}) {
    return asOld(markerIcon({ kind: "derived", glyph: "fusion", priority: "urgent", state: junction ? "muted" : "live" }))
}

const hhmmUtc = (iso) => { const t = ms(iso); return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : "" }
const srcLine = (s) => `• ${s.hhmm || hhmmUtc(s.published_at || s.at)}${s.source ? ` ${s.source}` : ""}: ${s.title || s.text || ""}${s.url ? ` (${s.url})` : ""}`

/** A crowd's card: where and when, its path, the posts behind it. */
export function crowdDetail(g) {
    const path = arr(g?.path).map((p) => short(p.place)).filter(Boolean)
    const est = g?.now_est
    const legs = arr(g?.path_legs)
    const reach = Number(g?.reach_m)
    return [
        `A crowd was last reported at ${short(g?.place) || "this place"}${g?.hhmm ? ` at ${g.hhmm}` : ""} (${ageLabel(g?.age_min)}), ${g?.n_reports || 1} report${g?.n_reports === 1 ? "" : "s"}.`,
        path.length > 1 ? `Its path: ${path.join(" → ")}.` : null,
        legs.some((x) => x.estimated) ? "Parts of its path are straight lines while the walking route is computed (estimated)." : null,
        g?.heading_to?.name ? `Said to be heading to ${g.heading_to.name}.` : null,
        est && fin(est) && est.advanced_m >= NOW_MIN_ADVANCE_M
            ? `Probably near the dashed mark now (estimate): about ${est.advanced_m >= 1000 ? `${(est.advanced_m / 1000).toFixed(1)} km` : `${Math.round(est.advanced_m / 10) * 10} m`} on toward ${est.to || "where it was heading"}`
              + `${est.basis === "heading_to" ? ", where it said it was heading" : ", its most likely convergence point"}, at a crowd's ~${est.kmh || 4} km/h`
              + `${est.routed ? " along the walking route" : " (straight line)"}${est.arrived ? "; it may be there already" : ""}.`
            : null,
        Number.isFinite(reach) && reach >= 150 ? `By now it could be up to ${reach >= 1000 ? `${(reach / 1000).toFixed(1)} km` : `${Math.round(reach / 10) * 10} m`} from where it was last seen.` : null,
        g?.self_reported ? "Its place is the one people there reported themselves." : null,
        ...arr(g?.outranked).map((o) => `A later report (${o.position || "second-hand"}) put it at ${short(o.place)}${o.at ? ` at ${hhmmUtc(o.at)}` : ""}; the people there said otherwise.`),
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
            const pathSub = arr(g.path).map((p) => short(p.place)).join(" → ")
            const legs = arr(g.path_legs).map((l) => ({ ...l, coords: okCoords(l.coords) })).filter((l) => l.coords.length >= 2)
            if (legs.length) {
                // each hop on the streets it was walked (routed), or straight and fainter while that is computed
                for (const l of legs) {
                    out.push({ id: `sit-path-${g.id}-${l.i}`, type: "demo_path", coords: l.coords,
                               color: rgba(CROWD_COLOUR, alpha * (l.estimated ? 0.55 : 0.9)), weight: l.estimated ? 2.5 : 3,
                               dash: l.estimated ? "2 7" : null, title,
                               sub: `${pathSub}${l.estimated ? " · straight line, walking route pending" : ""}`, raw })
                }
            } else if (path.length >= 2) {
                out.push({ id: `sit-path-${g.id}`, type: "demo_path", coords: path, color: rgba(CROWD_COLOUR, alpha * 0.9), weight: 3, dash: null,
                           title, sub: pathSub, raw })
            }
            // how far it could be by now: a faint ground circle, street level only
            const reach = Number(g.reach_m)
            if (Number.isFinite(reach) && reach >= 150) {
                out.push({ id: `sit-reach-${g.id}`, type: "demo_path", coords: groundCircle(+g.lat, +g.lon, reach),
                           color: rgba(CROWD_COLOUR, 0.22 * alpha), weight: 1, dash: "3 6", minZoom: REACH_MIN_ZOOM,
                           maxCameraM: REACH_MAX_CAMERA_M, title: `${title}: could be up to ${Math.round(reach / 100) / 10} km away by now`,
                           sub: "how far a crowd walks at ~4 km/h since it was last seen", raw })
            }
            const est = g.now_est
            const drawNow = est && fin(est) && Number(est.advanced_m) >= NOW_MIN_ADVANCE_M
            if (drawNow) {
                const trail = okCoords(est.trail)
                const nowTitle = `Crowd probably here now (estimate), last seen at ${short(g.place) || "a reported place"} ${ageLabel(age)}`
                if (trail.length >= 2) {
                    out.push({ id: `sit-trail-${g.id}`, type: "demo_path", coords: trail, color: rgba(CROWD_COLOUR, 0.6 * alpha), weight: 2,
                               dash: "4 6", minZoom: NOW_MIN_ZOOM, maxCameraM: NOW_MAX_CAMERA_M,
                               title: nowTitle, sub: `toward ${est.to || "where it was heading"}`, raw })
                }
                const ni = nowIcon("probably here now", Math.max(0.6, alpha))
                out.push({
                    id: `sit-now-${g.id}`, type: "demo_crowd", coords: [[+est.lat, +est.lon], [+est.lat, +est.lon]], color: rgba(CROWD_COLOUR, 0), weight: 0,
                    marker: { lat: +est.lat, lon: +est.lon, iconUri: ni.uri, iconWidth: ni.width, iconHeight: ni.height, iconAnchor: ni.anchor },
                    minZoom: NOW_MIN_ZOOM, maxCameraM: NOW_MAX_CAMERA_M,
                    title: nowTitle, sub: `estimate: ~${est.kmh || 4} km/h toward ${est.to || "where it was heading"}`,
                    raw: { ...raw, title: nowTitle, lat: +est.lat, lon: +est.lon, estimate: true }, alpha,
                })
            }
            const ic = crowdIcon(drawNow ? lastSeenLabel(g, age) : `${short(g.place)} · ${ageLabel(age)}`, alpha)
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
