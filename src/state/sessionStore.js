// sessionStore.js — V3 Phase 1, §5.1/§5.2: the real, server-persisted
// Session (a whole desk) and View (a named filter preset inside a
// session) concept. Real backend CRUD (backend/main.py's /api/sessions*
// endpoints, DeskSession/DeskView in database.py) — no client-only store
// standing in for it. See database.py's DeskSession docstring for the
// real, disclosed limitation: no live per-request auth exists to enforce
// per-user isolation yet.
//
// captureCurrentSession()/applySession() are the real atomic capture/
// restore orchestration: they read/write the live mirrors this app's
// other real modules already publish to (cameraState.js,
// situationFilterState.js, briefingBasket.js, the tabs localStorage key)
// rather than needing a new shared owner for state that already has one.

import API_BASE from "../apiBase.js"
import { getCameraState, restoreCameraState } from "../globe/cameraState.js"
import { getFilterState, restoreFilterState } from "../state/situationFilterState.js"
import { getBriefingItems, clearBriefing, addToBriefing } from "./briefingBasket.js"

const TAB_STORAGE_KEY = "akili_tabs_v2"

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    })
    if (!r.ok) throw new Error(`${opts?.method || "GET"} ${path} failed: HTTP ${r.status}`)
    return r.json()
}

export const listSessions = () => req("/api/sessions")
export const getSession = (sessionId) => req(`/api/sessions/${encodeURIComponent(sessionId)}`)
export const deleteSession = (sessionId) => req(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
export const listViews = (sessionId) => req(`/api/sessions/${encodeURIComponent(sessionId)}/views`)
export const deleteView = (sessionId, viewId) =>
    req(`/api/sessions/${encodeURIComponent(sessionId)}/views/${encodeURIComponent(viewId)}`, { method: "DELETE" })

/** Real current state of every real piece a session covers, pulled from
 * whichever module actually owns each one. */
export function captureCurrentSession() {
    const filters = getFilterState() || {}
    const camera = getCameraState()
    let tabs = []
    let activeTabId = null
    try {
        tabs = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY) || "[]")
        activeTabId = localStorage.getItem(TAB_STORAGE_KEY + "-active")
    } catch { /* real tabs unavailable — session saves without them rather than fabricating some */ }
    const basket = getBriefingItems().map((i) => i.id)

    return {
        time_window: filters.timeWindow || "72h",
        severity_floor: filters.severityFloor || "low",
        domains: Object.entries(filters.groupsOn || {}).filter(([, on]) => on).map(([k]) => k),
        context_layers: filters.contextOn || {},
        track_layers: filters.tracksOn || {},
        camera,
        tabs,
        _activeTabId: activeTabId,
        basket,
    }
}

export async function createSession(name) {
    const captured = captureCurrentSession()
    const { _activeTabId, ...payload } = captured
    return req("/api/sessions", { method: "POST", body: JSON.stringify({ name, ...payload }) })
}

export async function saveSession(sessionId) {
    const captured = captureCurrentSession()
    const { _activeTabId, ...payload } = captured
    return req(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "PUT", body: JSON.stringify(payload) })
}

/** Real atomic restore — every real piece of a session is applied here,
 * in one call, so a session switch never leaves the desk half-restored. */
export function applySession(session) {
    if (!session) return
    restoreFilterState({
        severityFloor: session.severity_floor,
        timeWindow: session.time_window,
        groupsOn: Object.fromEntries((session.domains || []).map((d) => [d, true])),
        contextOn: session.context_layers || {},
        tracksOn: session.track_layers || {},
    })
    restoreCameraState(session.camera)
    if (Array.isArray(session.tabs) && session.tabs.length) {
        window.dispatchEvent(new CustomEvent("akili:restore-tabs", {
            detail: { tabs: session.tabs, activeTabId: session.tabs[session.tabs.length - 1]?.id },
        }))
    }
    clearBriefing()
    for (const ref of session.basket || []) addToBriefing(ref, ref)
}

export async function createView(sessionId, name) {
    const filters = getFilterState() || {}
    return req(`/api/sessions/${encodeURIComponent(sessionId)}/views`, {
        method: "POST",
        body: JSON.stringify({
            name,
            time_window: filters.timeWindow || "72h",
            severity_floor: filters.severityFloor || "low",
            domains: Object.entries(filters.groupsOn || {}).filter(([, on]) => on).map(([k]) => k),
            context_layers: filters.contextOn || {},
        }),
    })
}

/** Applying a view changes ONLY filter-level state — never camera, tabs,
 * or basket, which stay whole-session concerns (V3 Phase 1, §5.2). */
export function applyView(view) {
    if (!view) return
    restoreFilterState({
        severityFloor: view.severity_floor,
        timeWindow: view.time_window,
        groupsOn: Object.fromEntries((view.domains || []).map((d) => [d, true])),
        contextOn: view.context_layers || {},
    })
}
