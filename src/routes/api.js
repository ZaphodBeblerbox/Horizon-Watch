/**
 * api.js — the route planner's endpoints (backend/routers/routes.py).
 */
import API_BASE from "../apiBase.js"

async function json(r) {
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(d.detail || `HTTP ${r.status}`); e.status = r.status; throw e }
    return d
}
const post = (path, body, doFetch = fetch) => doFetch(`${API_BASE}${path}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
}).then(json)

export function planRoute(request, doFetch) { return post("/api/routes/plan", request, doFetch) }
export function getPlan(id, fix, doFetch = fetch) {
    const q = fix && Number.isFinite(+fix.lat) ? `?lat=${(+fix.lat).toFixed(6)}&lon=${(+fix.lon).toFixed(6)}` : ""
    return doFetch(`${API_BASE}/api/routes/${encodeURIComponent(id)}${q}`, { credentials: "include" }).then(json)
}
export function sendPlan(id, body, doFetch) { return post(`/api/routes/${encodeURIComponent(id)}/send`, body, doFetch) }
export function routeContext({ lat, lon, assetId }, doFetch = fetch) {
    const q = assetId ? `asset_id=${encodeURIComponent(assetId)}` : `lat=${lat}&lon=${lon}`
    return doFetch(`${API_BASE}/api/routes/context?${q}`, { credentials: "include" }).then(json)
}
