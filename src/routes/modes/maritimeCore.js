/**
 * maritimeCore.js — the sea-route planner's store, requests and pure helpers
 * (no React, no map library: tested in maritime.test.js).
 *
 *   POST /api/routes/sea           {origin, destination, speed_kn?, ship_type?, departure?, avoid?, day_value?}
 *   GET  /api/routes/sea/context   ?mmsi= → {relevant, reasons, destination, default_speed_kn, offer}
 *   GET  /api/routes/sea/ports     ?q=
 *
 * backend/sea_route.py does the work: searoute's marine network, hazards with
 * sources (sea_hazards.json + our live data), exposure in risk-hours.
 */
import API_BASE from "../../apiBase.js"

// ── the store: is the sea panel open, for what request, and the plan ─────

let state = { open: false, request: null, plan: null, seq: 0 }
const subs = new Set()
export function getSeaRoute() { return state }
export function subscribeSeaRoute(fn) { subs.add(fn); return () => subs.delete(fn) }
function set(patch) { state = { ...state, ...patch }; subs.forEach((f) => { try { f(state) } catch { /* listener */ } }) }

/** request = {origin: {mmsi}|{lat,lon,name}|{port}, destination: same|null, speed_kn?, departure?, avoid?, day_value?} */
export function openSeaRoute(request) {
    set({ open: true, request: { origin: null, destination: null, avoid: [], ...(request || {}) }, plan: null, seq: state.seq + 1 })
    try { window.dispatchEvent(new CustomEvent("plx:sea-route", { detail: state })) } catch { /* no window */ }
}
export function closeSeaRoute() { set({ open: false, plan: null }) }
export function updateSeaRequest(patch) { set({ request: { ...state.request, ...patch }, seq: state.seq + 1 }) }
export function publishSeaPlan(plan) { if (state.plan !== plan) set({ plan }) }

// ── requests ──────────────────────────────────────────────────────────────

async function json(r) {
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(d.detail || `HTTP ${r.status}`); e.status = r.status; throw e }
    return d
}
export function planSeaRoute(body, doFetch = fetch) {
    return doFetch(`${API_BASE}/api/routes/sea`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(json)
}
export function seaContext(mmsi, doFetch = fetch) {
    return doFetch(`${API_BASE}/api/routes/sea/context?mmsi=${encodeURIComponent(mmsi)}`, { credentials: "include" }).then(json)
}
export function searchPorts(q, doFetch = fetch) {
    return doFetch(`${API_BASE}/api/routes/sea/ports?q=${encodeURIComponent(q)}`, { credentials: "include" }).then(json).then((d) => d.ports || [])
}

// ── words and numbers ────────────────────────────────────────────────────

export const PASSAGES = [
    ["babalmandab", "Bab-el-Mandeb"], ["suez", "Suez Canal"], ["ormuz", "Hormuz"], ["malacca", "Malacca"],
    ["gibraltar", "Gibraltar"], ["bosporus", "Bosporus"], ["panama", "Panama Canal"], ["sunda", "Sunda Strait"],
]

export const fmtNm = (n) => `${Math.round(+n || 0).toLocaleString("en-GB")} nm`
export const fmtDays = (d) => `${(+d || 0).toFixed(1)} days`

/** "+8.6 days, +3,488 nm" against the shortest; "Shortest" for the shortest. */
export function deltaText(c) {
    if (!c || c.shortest) return "Shortest"
    const sign = (x) => (x >= 0 ? "+" : "−")
    return `${sign(c.extra_days)}${Math.abs(c.extra_days).toFixed(1)} days, ${sign(c.extra_nm)}${Math.abs(Math.round(c.extra_nm)).toLocaleString("en-GB")} nm`
}

/** Risk-hours as a level word. */
export function riskLevel(riskHours) {
    const r = +riskHours || 0
    if (r < 5) return "low"
    if (r < 25) return "moderate"
    if (r < 60) return "high"
    return "severe"
}

export const LEVEL_COLOR = { low: "#3ddc84", moderate: "#F5A524", high: "#F76B15", severe: "#E5484D" }

/** {pct, color, label} for a candidate's exposure bar, scaled to the plan's worst candidate. */
export function exposureBar(c, maxRisk) {
    const r = +c?.exposure?.risk_hours || 0
    const mx = Math.max(+maxRisk || 0, r, 1)
    const level = riskLevel(r)
    return { pct: Math.max(r > 0 ? 3 : 0, Math.round((r / mx) * 100)), color: LEVEL_COLOR[level], label: `${Math.round(r)} risk-hours · ${level}` }
}

export const KIND_COLOR = { strike: "#E5484D", "war-risk": "#F76B15", piracy: "#F5A524", gnss: "#A78BFA", chokepoint: "#F472B6" }
export const KIND_LABEL = { strike: "Strike zone", "war-risk": "War-risk area", piracy: "Piracy", gnss: "GPS interference", chokepoint: "Chokepoint" }
export const hazardColor = (h) => KIND_COLOR[h?.kind] || "#E5484D"

/** A polygon hazard's ring, closed, as [lat, lon]. */
export function ringLatLngs(h) {
    const r = (h?.ring || []).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [+p[0], +p[1]])
    if (r.length > 2) {
        const [a, b] = [r[0], r[r.length - 1]]
        if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]])
    }
    return r
}

/** The zones a candidate crosses, as one short line: "Red Sea strike zone 69 h · Somali basin piracy area 43 h". */
export function zonesLine(c, max = 3) {
    const zs = (c?.exposure?.zones || []).filter((z) => z.risk >= 0.5).slice(0, max)
    return zs.length ? zs.map((z) => `${z.name} ${Math.round(z.hours)} h`).join(" · ") : "No listed hazard on the way"
}

/** The hazard's stats in words (live zones). */
export function hazardStats(h) {
    const s = h?.stats || {}
    const out = []
    if (s.events_30d) out.push(`${s.events_30d} conflict events in 30 days`)
    if (s.shipping_30d) out.push(`${s.shipping_30d} against shipping or at sea`)
    if (s.ucdp_60d) out.push(`${s.ucdp_60d} UCDP events in 60 days`)
    if (s.pct != null) out.push(`${Math.round(s.pct)}% of aircraft without a fix`)
    if (s.events_14d) out.push(`${s.events_14d} attack-type events in 14 days`)
    return out.join(", ")
}

/** The sources a plan cites, unique by label. */
export function sourceList(plan) {
    const seen = new Set()
    return (plan?.sources || []).filter((s) => s && s.label && !seen.has(s.label) && seen.add(s.label))
}

// ── the request ───────────────────────────────────────────────────────────

const point = (p) => p && (p.mmsi || p.port || (Number.isFinite(+p.lat) && Number.isFinite(+p.lon)))

export function canPlan(req) { return Boolean(req && point(req.origin) && point(req.destination)) }

/** The POST body from the panel request. */
export function toBody(req) {
    const b = { origin: req.origin, destination: req.destination, avoid: req.avoid || [] }
    if (req.speed_kn !== "" && req.speed_kn != null && Number.isFinite(+req.speed_kn)) b.speed_kn = +req.speed_kn
    if (req.departure) b.departure = req.departure
    if (req.day_value !== "" && req.day_value != null && Number.isFinite(+req.day_value)) b.day_value = +req.day_value
    if (req.ship_type) b.ship_type = req.ship_type
    return b
}

export function placeLabel(p) {
    if (!p) return "—"
    if (p.name) return p.name
    if (p.mmsi) return `MMSI ${p.mmsi}`
    if (p.port) return p.port
    return `${(+p.lat).toFixed(2)}, ${(+p.lon).toFixed(2)}`
}

// ── when to offer it ──────────────────────────────────────────────────────

/**
 * relevant(ctx) — should the vessel inspector offer "Plan a safer sea route"?
 * ctx = {entityType, mmsi, seaContext?: GET /api/routes/sea/context}. False
 * without a vessel; {offer, why, reasons} when the server says a hazard is on
 * its way (or it is a vessel of concern); false otherwise.
 */
export function relevant(ctx) {
    if (!ctx || (ctx.entityType && ctx.entityType !== "vessel") || !ctx.mmsi) return false
    const s = ctx.seaContext
    if (!s || !s.relevant) return false
    return { offer: s.offer || "Plan a safer sea route", why: (s.reasons || [])[0] || "", reasons: s.reasons || [] }
}

/** The panel request a context opens: from the vessel, to its resolved destination (if any). */
export function requestFromContext(ctx) {
    const s = ctx?.seaContext || {}
    const v = s.vessel || {}
    const d = s.destination
    return {
        origin: { mmsi: String(ctx?.mmsi || v.mmsi), name: v.name || `MMSI ${ctx?.mmsi || v.mmsi}` },
        destination: d ? { lat: d.lat, lon: d.lon, name: `${d.name}${d.locode ? ` (${d.locode})` : ""}` } : null,
        speed_kn: s.default_speed_kn ?? "",
        ship_type: v.ship_type || null,
        avoid: [],
    }
}

/** The hazards any candidate crosses, heaviest first; the GPS-interference cells as one entry. */
export function hazardsUsed(plan) {
    const used = new Set((plan?.candidates || []).flatMap((c) => (c.exposure?.zones || []).flatMap((z) => z.members || [z.id])))
    const hz = (plan?.hazards || []).filter((h) => used.has(h.id))
    const out = hz.filter((h) => h.kind !== "gnss").sort((a, b) => b.weight - a.weight)
    const g = hz.filter((h) => h.kind === "gnss")
    if (g.length) {
        out.push({ id: "gnss", kind: "gnss", name: "GPS interference", live: true, cells: g.length, weight: Math.max(...g.map((h) => h.weight)),
                   why: "Aircraft overhead losing their satellite fix in the last 24 h: ships nearby may see jammed or spoofed GPS/AIS.",
                   sources: g[0].sources || [] })
    }
    return out
}
