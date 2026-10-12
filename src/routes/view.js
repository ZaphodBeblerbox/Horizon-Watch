/**
 * view.js — what the route panel says, as pure functions (tested in routes.test.js).
 */
export const RECHECK_MS = 60_000

/** One word for the panel: loading · error · no_route · no_safe_route · unsafe · rerouting · clear · ok */
export function viewState({ loading, error, plan, check, rerouting }) {
    if (rerouting) return "rerouting"
    if (!plan) return error ? "error" : "loading"
    if (check && check.safe === false && !plan.rerouted) return "unsafe"
    if (plan.status === "no_route") return "no_route"
    if (plan.status === "no_safe_route") return "no_safe_route"
    if (!plan.hazards?.length) return "clear"
    return loading ? "loading" : "ok"
}

export const STATE_TEXT = {
    loading: "Finding the safest way…",
    rerouting: "The route has become unsafe — finding another…",
    error: "Could not get a route.",
    no_route: "The routing services did not answer.",
    no_safe_route: "No route found that avoids every danger.",
    unsafe: "A new danger is on this route.",
    clear: "No live danger on the way.",
    ok: "Safest route ready.",
}

export function distanceLabel(m) {
    if (!Number.isFinite(+m)) return ""
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`
}
export function summary(route) {
    return route ? `${distanceLabel(route.distance_m)} · ${route.duration_label || `${Math.round(route.duration_s / 60)} min`}` : ""
}
/** Exposure in words: hazard weight × minutes near it, summed. */
export function exposureLabel(x) {
    if (!Number.isFinite(+x)) return ""
    if (x < 0.05) return "no exposure"
    if (x < 1) return `low exposure (${x.toFixed(2)})`
    if (x < 4) return `some exposure (${x.toFixed(1)})`
    return `high exposure (${x.toFixed(1)})`
}

/** "kettle · Place de la République · 12 min ago" */
export function hazardLine(h, now = Date.now()) {
    const parts = [h.label, h.place ? String(h.place).split(",")[0] : null]
    if (h.starts_utc) {
        const mins = Math.round((Date.parse(h.starts_utc) - now) / 60_000)
        if (Number.isFinite(mins)) parts.push(mins > 0 ? `starts in ${mins} min` : `under way for ${-mins} min`)
    } else if (h.at) {
        const mins = Math.round((now - Date.parse(h.at)) / 60_000)
        if (Number.isFinite(mins) && mins >= 0) parts.push(mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`)
    }
    return parts.filter(Boolean).join(" · ")
}

/** Ring style by weight: a fading kettle is a fainter ring; a hard hazard (never crossed) is solid. */
export function ringStyle(h) {
    const w = Math.max(0.1, Math.min(1, h.weight || 0.5))
    return { color: "#E5484D", weight: h.hard ? 3 : 2, opacity: 0.45 + 0.5 * w, fillColor: "#E5484D", fillOpacity: 0.08 + 0.18 * w, dashArray: h.hard ? null : null }
}

/** The request's "from" in words. */
export function fromLabel(req, plan) {
    const f = req?.from || {}
    if (f.me) return "You — this device"
    if (f.asset_id) return plan?.subject?.name || "the asset"
    if (Number.isFinite(+f.lat)) return f.label || `${(+f.lat).toFixed(4)}, ${(+f.lon).toFixed(4)}`
    return plan?.subject?.name || "outside, away from the dangers"
}
export function toLabel(req, plan) {
    const t = req?.to
    if (!t) return "Nearest safe point (automatic)"
    return t.name || plan?.destinations?.[0]?.name || (t.asset_id ? "the site" : `${(+t.lat).toFixed(4)}, ${(+t.lon).toFixed(4)}`)
}

/** datetime-local value ↔ ISO */
export function toLocalInput(iso) {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = (n) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function fromLocalInput(v) {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
