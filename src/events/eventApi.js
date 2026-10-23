/**
 * eventApi.js — the events, follows and "around" endpoints (backend/routers/events_api.py, main.py /api/around).
 * Every call carries the session (credentials) and never throws: a failure is null.
 */
import API_BASE from "../apiBase.js"

const opts = { credentials: "include" }
const json = (r) => (r.ok ? r.json() : null)
const send = (method, path, body) => fetch(`${API_BASE}${path}`, {
    ...opts, method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
}).then(json).catch(() => null)

export const getEvents = (q = "") => fetch(`${API_BASE}/api/events${q}`, opts).then(json).catch(() => null)
export const getEvent = (id) => fetch(`${API_BASE}/api/events/${encodeURIComponent(id)}`, opts).then(json).catch(() => null)
export const getFollows = () => fetch(`${API_BASE}/api/follows`, opts).then(json).catch(() => null)
export const getTimeline = (target) => fetch(`${API_BASE}/api/follows/${encodeURIComponent(target)}/timeline`, opts).then(json).catch(() => null)
export const follow = (t) => send("POST", "/api/follows", t).then((r) => { notifyFollows(); return r })
export const unfollow = (target) => send("DELETE", `/api/follows/${encodeURIComponent(target)}`).then((r) => { notifyFollows(); return r })
export const muteEvent = (id, hours = 24) => send("POST", `/api/events/${encodeURIComponent(id)}/mute`, { hours })
export const unmuteEvent = (id) => send("DELETE", `/api/events/${encodeURIComponent(id)}/mute`)

export function getAround({ lat, lon, at, eventId, domain, km = 5, hours = 6 }) {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), km: String(km), hours: String(hours) })
    if (at) q.set("at", at)
    if (eventId) q.set("event_id", eventId)
    if (domain) q.set("domain", domain)
    return fetch(`${API_BASE}/api/around?${q}`, opts).then(json).catch(() => null)
}

/** Lists that show follows (Following, the Follow buttons) refresh when one changes. */
export function notifyFollows() {
    try { window.dispatchEvent(new CustomEvent("plx:follows-changed")) } catch { /* no window */ }
}
export function onFollowsChanged(fn) {
    if (typeof window === "undefined") return () => {}
    window.addEventListener("plx:follows-changed", fn)
    return () => window.removeEventListener("plx:follows-changed", fn)
}

let assetsCache = null
/** The user's assets, read once per minute (for "how is it connected to my assets"). */
export function myAssets() {
    if (assetsCache && Date.now() - assetsCache.at < 60_000) return assetsCache.p
    const p = fetch(`${API_BASE}/api/my-assets`, opts).then(json).then((d) => d?.assets || []).catch(() => [])
    assetsCache = { at: Date.now(), p }
    return p
}
