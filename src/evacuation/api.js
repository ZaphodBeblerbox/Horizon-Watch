/**
 * api.js — ADVISE EVACUATION and the safe houses (backend/evacuation.py).
 * The desktop bearer is added by lib/desktopAuth.js's fetch wrapper.
 */
import API_BASE from "../apiBase.js"

async function call(path, opts = {}) {
    const r = await fetch(`${API_BASE}${path}`, {
        credentials: "include", ...opts,
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(d.detail || `HTTP ${r.status}`); e.status = r.status; throw e }
    return d
}

export const listSafeHouses = () => call("/api/evacuations/safe-houses").then((d) => d.safe_houses || [])
/** Plan and send in one press: { asset_id, mode?, message?, house_id?, plan_id?, itinerary? } -> { warning, plan } */
export const adviseEvacuation = (body) => call("/api/evacuations", { method: "POST", body: JSON.stringify(body) })
export const previewEvacuation = (body) => call("/api/evacuations/plan", { method: "POST", body: JSON.stringify(body) })
export const latestEvacuation = (assetId) => call(`/api/evacuations/latest?asset_id=${encodeURIComponent(assetId)}`)
export const evacuationProgress = (wid) => call(`/api/evacuations/${encodeURIComponent(wid)}/progress`)
