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
import { loadProfile } from "../constants/profile.js"

const TAB_STORAGE_KEY = "akili_tabs_v2"
const ACTIVE_SESSION_KEY = "akili-active-session-id"

// Real "who is this" signal for session ownership — the best available one
// in this app today. There is no real per-request auth (deliberately
// removed, see database.py's DeskSession docstring), so this is the
// profile's own analyst-entered displayName, not a cryptographic identity.
// When unset, sessions are created/listed without an owner and are
// honestly shared/global — matching this app's existing, already-disclosed
// single-shared-profile reality rather than faking per-user isolation with
// a random per-browser id (which would tie sessions to a device, not a
// user, and be a worse, quieter fiction than having no owner at all).
export function getCurrentUserId() {
    const p = loadProfile()
    const name = (p?.displayName || "").trim()
    return name || null
}

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    })
    if (!r.ok) throw new Error(`${opts?.method || "GET"} ${path} failed: HTTP ${r.status}`)
    return r.json()
}

export const listSessions = () => {
    const uid = getCurrentUserId()
    return req(`/api/sessions${uid ? `?owner_user_id=${encodeURIComponent(uid)}` : ""}`)
}
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

export async function createSession(name, capturedOverride) {
    const captured = capturedOverride || captureCurrentSession()
    const { _activeTabId, ...payload } = captured
    return req("/api/sessions", { method: "POST", body: JSON.stringify({ name, owner_user_id: getCurrentUserId(), ...payload }) })
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

// ── Active session — the real live mirror + switch/fork/seed orchestration ──
// (§3.4/§5.1 follow-up round.) A module-level pub/sub, matching this app's
// established pattern for cross-cutting shared state (cameraState.js,
// situationFilterState.js) — SessionControl.jsx publishes here on switch/
// create/rename/delete, and Situation.jsx's own Views group subscribes so
// it always renders the ACTIVE session's real views, not a stale copy.

let _activeSession = null
let _activeViews = []
const _sessionListeners = new Set()

function _publishActive() {
    for (const fn of _sessionListeners) fn(_activeSession, _activeViews)
}

export function getActiveSession() { return _activeSession }
export function getActiveViews() { return _activeViews }
export function subscribeActiveSession(fn) {
    _sessionListeners.add(fn)
    return () => _sessionListeners.delete(fn)
}

async function _refreshActiveViews() {
    if (!_activeSession) { _activeViews = []; return }
    try { _activeViews = await listViews(_activeSession.session_id) }
    catch { _activeViews = [] }
    _publishActive()
}

/** Writes the currently active session's real, current live state back —
 * used before every switch, on the 60s interval, and on real navigation-
 * away (beforeunload). A no-op (not an error) when there's no active
 * session yet (e.g. before the very first session is seeded/loaded). */
export async function persistActiveSessionNow() {
    if (!_activeSession) return
    try { await saveSession(_activeSession.session_id) }
    catch { /* real network hiccup — next 60s tick or the next switch retries */ }
}

/** Real atomic session switch (§3.4): writes back the OUTGOING session's
 * live state first (so nothing is lost), THEN applies the incoming one and
 * refreshes its real views. */
export async function switchToSession(session) {
    if (!session) return
    await persistActiveSessionNow()
    _activeSession = session
    try { localStorage.setItem(ACTIVE_SESSION_KEY, session.session_id) } catch { /* ignore */ }
    applySession(session)
    await _refreshActiveViews()
}

/** #ses-new (§3.4) — genuinely FORKS the current live desk (not a blank
 * template): captures real current state, creates a new real session from
 * it, and switches to it. The caller supplies the (inline-renamed) name. */
export async function forkCurrentSessionAsNew(name) {
    await persistActiveSessionNow()
    const captured = captureCurrentSession()
    const created = await createSession(name, captured)
    _activeSession = created
    try { localStorage.setItem(ACTIVE_SESSION_KEY, created.session_id) } catch { /* ignore */ }
    await _refreshActiveViews()
    return created
}

/** Renames any real session (active or not) — updates the live active-
 * session mirror too when it happens to be the one being renamed. */
export async function renameSession(sessionId, name) {
    const updated = await req(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PUT", body: JSON.stringify({ name }),
    })
    if (_activeSession?.session_id === sessionId) {
        _activeSession = updated
        _publishActive()
    }
    return updated
}

/** Real per-view actions inside the ACTIVE session — used by Situation.jsx's
 * Views group (the first group in the Layers panel, §5.2). */
export async function saveCurrentAsView(name) {
    if (!_activeSession) return
    await createView(_activeSession.session_id, name)
    await _refreshActiveViews()
}
export async function deleteActiveSessionView(viewId) {
    if (!_activeSession) return
    await deleteView(_activeSession.session_id, viewId)
    await _refreshActiveViews()
}

/** App-boot entry point (§3.4): loads this user's real sessions, restores
 * whichever one was last active in THIS browser if it still exists,
 * otherwise the most-recently-updated one, otherwise seeds a single honest
 * default ("Global watch" — broadest real view, no domains pre-selected,
 * world projection) rather than inventing named example sessions this org
 * doesn't actually track. Returns the now-active session. */
export async function ensureActiveSession() {
    let sessions = []
    try { sessions = await listSessions() } catch { sessions = [] }

    if (sessions.length === 0) {
        const seeded = await createSession("Global watch", {
            time_window: "72h", severity_floor: "low", domains: [],
            context_layers: {}, track_layers: {}, camera: null, tabs: [], basket: [],
        })
        _activeSession = seeded
        try { localStorage.setItem(ACTIVE_SESSION_KEY, seeded.session_id) } catch { /* ignore */ }
        await _refreshActiveViews()
        return seeded
    }

    let lastId = null
    try { lastId = localStorage.getItem(ACTIVE_SESSION_KEY) } catch { /* ignore */ }
    const restored = (lastId && sessions.find((s) => s.session_id === lastId)) || sessions[0]
    _activeSession = restored
    applySession(restored)
    try { localStorage.setItem(ACTIVE_SESSION_KEY, restored.session_id) } catch { /* ignore */ }
    await _refreshActiveViews()
    return restored
}

/** Belt-and-suspenders persistence (§3.4): a real 60s interval AND a real
 * beforeunload write-back — relying on only one would lose state if the
 * other path is the one that actually fires in a given real session. Call
 * once from app.jsx on mount; returns a real teardown function. */
export function startSessionAutoPersist() {
    const interval = setInterval(() => { persistActiveSessionNow() }, 60_000)
    const onUnload = () => {
        if (!_activeSession) return
        // navigator.sendBeacon can't carry our JSON+headers shape reliably
        // across browsers for a PUT-style save, and beforeunload doesn't
        // reliably await a fetch — best-effort fire-and-forget matches what
        // this real, non-critical desk-state save can honestly guarantee.
        persistActiveSessionNow()
    }
    window.addEventListener("beforeunload", onUnload)
    return () => {
        clearInterval(interval)
        window.removeEventListener("beforeunload", onUnload)
    }
}
