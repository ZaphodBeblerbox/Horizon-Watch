/**
 * api.js — the warning channel's calls (backend/asset_warnings.py) and the
 * asset link (backend/routers/my_assets.py). The desktop bearer is added by
 * lib/desktopAuth.js's fetch wrapper.
 */
import API_BASE from "../apiBase.js"

async function call(path, opts = {}) {
    const r = await fetch(`${API_BASE}${path}`, {
        credentials: "include", ...opts,
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
    return d
}

/**
 * SEND A WARNING — the one call for anything that warns a person (a later
 * "advise evacuation" passes kind "evacuate" and a route:
 * { route_plan_id, ... }). `to` is { asset_id } or { to_user_id }.
 */
export function sendWarning({ asset_id, to_user_id, message, severity = "critical", route = null, kind = "warning" }) {
    return call("/api/warnings", { method: "POST", body: JSON.stringify({ asset_id, to_user_id, message, severity, route, kind }) })
}
export const warningInbox = (onScreen = true) => call(`/api/warnings/inbox?seen=${onScreen ? 1 : 0}`)
export const ackWarning = (id) => call(`/api/warnings/${encodeURIComponent(id)}/ack`, { method: "POST" })
export const cancelWarning = (id) => call(`/api/warnings/${encodeURIComponent(id)}/cancel`, { method: "POST" })
export const sentWarnings = ({ asset_id, user_id } = {}) =>
    call(`/api/warnings/sent?${asset_id ? `asset_id=${encodeURIComponent(asset_id)}` : `user_id=${encodeURIComponent(user_id || "")}`}`)

export const assetLink = (assetId) => call(`/api/my-assets/${encodeURIComponent(assetId)}/link`)
export const linkUser = (assetId, userId) => call(`/api/my-assets/${encodeURIComponent(assetId)}/link`, { method: "PUT", body: JSON.stringify({ user_id: userId }) })
export const unlinkUser = (assetId) => call(`/api/my-assets/${encodeURIComponent(assetId)}/link`, { method: "DELETE" })
export const linkableUsers = (q = "") => call(`/api/my-assets/linkable-users${q ? `?q=${encodeURIComponent(q)}` : ""}`)

/** "acknowledged 14:32" / "seen 14:31, not acknowledged" / "not yet seen". */
export function warningStatus(w, fmt = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) {
    if (!w) return ""
    if (w.status === "cancelled") return "withdrawn"
    if (w.acked_at) return `acknowledged ${fmt(w.acked_at)}`
    const again = (w.sends || 1) > 1 ? ` · sent ${w.sends}×` : ""
    if (w.seen_at) return `seen ${fmt(w.seen_at)}, not acknowledged${again}`
    return `not yet seen${again}`
}
