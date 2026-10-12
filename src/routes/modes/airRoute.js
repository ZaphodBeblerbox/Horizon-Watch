/**
 * airRoute.js — the Flights route mode on the client: its store (is the
 * panel open, for which flight), its requests, and the pure helpers the
 * panel, the globe layer and the phone map share (tested in airRoute.test.js).
 *
 * The server (backend/air_route.py) holds the hazards and does the routing:
 *   POST /api/routes/air                {from, to, mode} | {icao, mode}
 *   GET  /api/routes/air/context        ?icao= | ?from&to — relevant, and why
 *   GET  /api/routes/air/airports       ?q=
 */
import API_BASE from "../../apiBase.js"

// ── the store ─────────────────────────────────────────────────────────────

let state = { open: false, ctx: null, plan: null, selected: null, seq: 0 }
const subs = new Set()
export function getAirRoute() { return state }
export function subscribeAirRoute(fn) { subs.add(fn); return () => subs.delete(fn) }
function set(patch) { state = { ...state, ...patch }; subs.forEach((f) => { try { f(state) } catch { /* listener */ } }) }

/** ctx: {icao} (a live aircraft) | {from, to} (airport codes) | {} (empty form). */
export function openAirRoute(ctx = {}) {
    set({ open: true, ctx: { ...ctx }, plan: null, selected: null, seq: state.seq + 1 })
    try { window.dispatchEvent(new CustomEvent("plx:air-route", { detail: state })) } catch { /* no window */ }
}
export function closeAirRoute() { set({ open: false, plan: null, selected: null }) }
export function publishAirPlan(plan) { if (state.plan !== plan) set({ plan }) }
export function selectAirCandidate(key) { set({ selected: key }) }

// ── requests ──────────────────────────────────────────────────────────────

async function json(r) {
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(d.detail || `HTTP ${r.status}`); e.status = r.status; throw e }
    return d
}

/** The body for POST /api/routes/air from a ctx, or null when it is not complete. */
export function planBody(ctx, mode = "plan") {
    if (!ctx) return null
    if (ctx.icao) return { icao: String(ctx.icao).toLowerCase(), mode }
    if (ctx.from && ctx.to) return { from: ctx.from, to: ctx.to, mode }
    return null
}

export function fetchAirPlan(ctx, mode = "plan", doFetch = fetch) {
    const body = planBody(ctx, mode)
    if (!body) return Promise.reject(new Error("Choose where from and where to"))
    return doFetch(`${API_BASE}/api/routes/air`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(json)
}

export function fetchAirContext(ctx, doFetch = fetch) {
    const q = ctx.icao ? `icao=${encodeURIComponent(String(ctx.icao).toLowerCase())}`
        : `from=${encodeURIComponent(ctx.from)}&to=${encodeURIComponent(ctx.to)}`
    return doFetch(`${API_BASE}/api/routes/air/context?${q}`, { credentials: "include" }).then(json)
}

export function searchAirports(q, doFetch = fetch) {
    return doFetch(`${API_BASE}/api/routes/air/airports?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then(json).then((d) => d.airports || [])
}

// ── context: is a selection a flight? ─────────────────────────────────────

/** The ICAO24 of an inspected aircraft ("trk:adsb-4b1805", {icao}, {kind:"aircraft", id}), else null. */
export function aircraftHex(ctx) {
    if (!ctx) return null
    if (typeof ctx === "string") ctx = { recordRef: ctx }
    const raw = ctx.icao || ctx.hex || (ctx.kind === "aircraft" || ctx.entityType === "aircraft" ? ctx.id || ctx.entityId : null)
        || (typeof ctx.recordRef === "string" && /^trk:adsb-/i.test(ctx.recordRef) ? ctx.recordRef : null)
    if (!raw) return null
    const m = String(raw).match(/([0-9a-f]{6})$/i)
    return m ? m[1].toLowerCase() : null
}

/** Whether the Flights mode applies to a context at all (the server says whether it is worth it). */
export function isFlightContext(ctx) {
    if (!ctx) return false
    if (aircraftHex(ctx)) return true
    return Boolean(ctx.kind === "trip" && ctx.travel === "air" && ctx.from && ctx.to) || Boolean(ctx.from && ctx.to && ctx.air)
}

// ── words and numbers ─────────────────────────────────────────────────────

export function fmtMinutes(m) {
    const v = Math.round(Math.abs(Number(m) || 0))
    if (v < 60) return `${v} min`
    const h = Math.floor(v / 60), r = v % 60
    return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`
}

export function fmtExtra(m) {
    const v = Number(m) || 0
    if (Math.abs(v) < 1) return "no extra time"
    return `${v > 0 ? "+" : "−"}${fmtMinutes(v)}`
}

export const RISK_TEXT = {
    high: "Crosses a do-not-operate area",
    elevated: "Elevated exposure",
    low: "Low exposure",
    clear: "No known hazard",
}
export const RISK_COLOR = { high: "#E5484D", elevated: "#F5A524", low: "#8fb4e8", clear: "#3ddc84" }

/** Bar width 0..100 for a candidate's exposure, against the worst on show (the direct path, usually). */
export function exposureBar(c, cands) {
    const top = Math.max(0, ...(cands || []).map((x) => x?.score?.exposure || 0))
    if (!top) return 0
    const e = c?.score?.exposure || 0
    return e > 0 ? Math.max(3, Math.round((e / top) * 100)) : 0
}

export function crossingLine(x) {
    const w = x.max_weight >= 0.75 ? "do-not-operate" : x.max_weight >= 0.3 ? "caution" : "low weight"
    return `${x.name} · ${fmtMinutes(x.minutes)} · ${w}`
}

/** The colour a hazard zone is shaded in, by family. */
export function hazardColor(h) {
    if (!h) return "#E5484D"
    if (h.kind === "gps") return "#F5A524"
    if (h.kind === "ucdp") return "#b07cff"
    if (["air_defence", "missile", "airstrike"].includes(h.kind)) return "#ff5a36"
    if (h.kind === "sam") return "#ff7ab6"
    if (h.kind === "openaip") return "#8fb4e8"
    return h.weight >= 0.75 ? "#E5484D" : "#F08A4B"
}

export function hazardAlpha(h) {
    const w = Math.max(0.05, Math.min(1, Number(h?.weight) || 0.3))
    return 0.08 + 0.22 * w
}

/** Every source once ("EASA CZIB-2026-04-R2 · revised 2026-09-30 · valid until 2026-11-16"). */
export function sourceLines(plan) {
    const out = []
    const seen = new Set()
    for (const s of plan?.sources || []) {
        const k = `${s.issuer}|${s.ref}`
        if (seen.has(k)) continue
        seen.add(k)
        const dates = [s.revised ? `revised ${s.revised}` : s.issued ? `issued ${String(s.issued).slice(0, 10)}` : null,
                       s.valid_until ? `valid until ${s.valid_until}` : null].filter(Boolean).join(" · ")
        out.push({ key: k, text: `${s.issuer} — ${s.ref}`, dates, url: s.url || null, note: s.note || null, for: s.for })
    }
    return out
}

// ── drawing ───────────────────────────────────────────────────────────────

/** Height (m) at each point of an arc: a climb over the first `ramp` of the
 *  path, level, then a descent — drawn above the ground, NOT to scale. */
export function arcHeights(n, peak = 60_000, ramp = 0.18) {
    if (n <= 1) return [0]
    const out = []
    for (let i = 0; i < n; i++) {
        const f = i / (n - 1)
        const up = Math.min(1, f / ramp), down = Math.min(1, (1 - f) / ramp)
        const k = Math.min(up, down)
        out.push(Math.round(peak * Math.sin((k * Math.PI) / 2)))
    }
    return out
}

/** [lon, lat, h, lon, lat, h, …] for Cartesian3.fromDegreesArrayHeights, longitudes continuous across ±180. */
export function arcDegreesHeights(coords, peak) {
    const hs = arcHeights(coords.length, peak)
    const out = []
    let prev = null
    coords.forEach(([lat, lon], i) => {
        let x = lon
        if (prev !== null) { while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360 }
        prev = x
        out.push(x, lat, hs[i])
    })
    return out
}

/** Peak drawing height for a path of this length — visible from the camera that frames it. */
export function arcPeak(distanceKm) {
    return Math.round(Math.min(220_000, Math.max(25_000, (Number(distanceKm) || 0) * 14)))
}

/** The bounding view for a plan: centre and a camera altitude (m). */
export function planView(plan) {
    const pts = (plan?.candidates || []).flatMap((c) => c.coords || [])
    if (!pts.length) return null
    let lats = pts.map((p) => p[0])
    let lons = pts.map((p) => p[1])
    const span = Math.max(...lons) - Math.min(...lons)
    if (span > 180) lons = lons.map((x) => (x < 0 ? x + 360 : x))
    const lat = (Math.max(...lats) + Math.min(...lats)) / 2
    let lon = (Math.max(...lons) + Math.min(...lons)) / 2
    if (lon > 180) lon -= 360
    const dLat = (Math.max(...lats) - Math.min(...lats)) * 111
    const dLon = (Math.max(...lons) - Math.min(...lons)) * 111 * Math.cos((lat * Math.PI) / 180)
    const km = Math.max(dLat, dLon, 300)
    return { lat, lon, altitude: Math.round(Math.min(20_000_000, km * 1000 * 1.9)) }
}

export const CAND_COLOR = { direct: "#c9ced6", avoid: "#3ddc84", balanced: "#5fb6ff" }
export function candidateColor(c) { return CAND_COLOR[c?.key] || "#5fb6ff" }
