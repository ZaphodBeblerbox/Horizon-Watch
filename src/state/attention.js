/**
 * attention.js — what this user is looking at now, told to the server (POST /api/attention,
 * backend/attention.py; DATAMINR_PLAN B0): the map's view, the active theater, the open event, the time zone.
 * The server spends model calls where someone is looking first. Sent every 60 s while the page is visible and
 * soon after a change (debounced), on desktop and phone alike. Never throws.
 */
import API_BASE from "../apiBase.js"

const state = { viewport: null, active_theater_id: null, open_event_id: null }
let timer = null
let pending = null
let started = false

function platform() {
    try { return document.querySelector(".m2") ? "phone" : "desktop" } catch { return "desktop" }
}

export function payload() {
    let tz = null
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { /* old engine */ }
    return { ...state, platform: platform(), tz }
}

function send() {
    pending = null
    try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return
        fetch(`${API_BASE}/api/attention`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload()) }).catch(() => {})
    } catch { /* never break the page */ }
}

/** Merge what changed ({viewport: {west, south, east, north}}, {open_event_id}, {active_theater_id}) and send soon. */
export function setAttention(part) {
    Object.assign(state, part || {})
    if (!started) startAttention()
    if (pending) clearTimeout(pending)
    pending = setTimeout(send, 1500)
}

export function startAttention() {
    if (started || typeof window === "undefined") return
    started = true
    timer = setInterval(send, 60_000)
}

export function stopAttention() {
    if (timer) clearInterval(timer)
    if (pending) clearTimeout(pending)
    timer = null
    pending = null
    started = false
}
