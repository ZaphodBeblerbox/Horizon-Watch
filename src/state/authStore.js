// authStore.js — real authentication round. Real session state: a real
// login()/logout() against the real /api/auth/* endpoints (httpOnly JWT
// cookie — this module never sees or stores the token itself, only the
// resulting user object), module-level pub/sub matching this app's
// established pattern (cameraState.js, situationFilterState.js). Replaces
// the previous self-reported "Acting as" picker (profile.userId) as the
// real source of "who is this" — see MissionProfilePanel.jsx's own
// removal note for that decision.
import API_BASE from "../apiBase.js"

let _currentUser = null
let _authChecked = false
// Real auth/performance round — the confirmed root cause of "closing the
// tab forces a re-login": checkSession() used to catch EVERY failure of
// GET /api/auth/me (a genuine 401, but also a network error, a timeout, a
// 5xx from a cold-starting backend) in one single catch block and treat
// all of them identically as "not logged in." A cold/sleeping backend or
// a transient network blip — much more likely right after a period of tab-
// closed inactivity than during active use — forced a real, still-valid
// session back to the login screen. _authTransientError distinguishes
// that case so app.jsx can show a real "reconnecting" state instead of
// silently discarding a session that was never actually invalid.
let _authTransientError = false
const _listeners = new Set()

function _publish() {
    for (const fn of _listeners) fn(_currentUser)
}

export function getCurrentUser() { return _currentUser }
export function isAuthChecked() { return _authChecked }
export function isAuthTransientError() { return _authTransientError }
export function subscribeAuth(fn) {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
}

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...opts,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const body = await r.json(); if (body?.detail) detail = body.detail } catch { /* no body */ }
        throw new Error(detail)
    }
    return r.json()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Real GET /api/auth/me attempt — returns a real, explicit outcome
 * rather than throwing, so the caller can tell a genuine "not logged in"
 * (401) apart from a transient failure (network error, timeout, 5xx) that
 * says nothing real about whether the session is actually still valid. */
async function _tryFetchMe() {
    let r
    try {
        r = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { "Content-Type": "application/json" },
            credentials: "include",
        })
    } catch {
        return { outcome: "transient" }
    }
    if (r.status === 401) return { outcome: "unauthenticated" }
    if (!r.ok) return { outcome: "transient" }
    try {
        return { outcome: "ok", user: await r.json() }
    } catch {
        return { outcome: "transient" }
    }
}

/** Real app-boot (and periodic re-validation) check. Retries a real
 * transient failure with backoff before giving up — only a genuine 401
 * ever clears a session here; a still-unresolved transient failure after
 * every retry leaves the previous real _currentUser value standing
 * (never assumed logged-out) and sets _authTransientError so the caller
 * can show a real "couldn't reach the server" state instead of the login
 * screen. */
export async function checkSession() {
    const MAX_ATTEMPTS = 4
    const BASE_DELAY_MS = 700
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const result = await _tryFetchMe()
        if (result.outcome === "ok") {
            _currentUser = result.user
            _authTransientError = false
            _authChecked = true
            _publish()
            return _currentUser
        }
        if (result.outcome === "unauthenticated") {
            _currentUser = null
            _authTransientError = false
            _authChecked = true
            _publish()
            return null
        }
        if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_DELAY_MS * 2 ** attempt)
    }
    _authTransientError = true
    _authChecked = true
    _publish()
    return _currentUser
}

export async function login(email, password) {
    const user = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
    _currentUser = user
    _publish()
    return user
}

export async function logout() {
    try { await req("/api/auth/logout", { method: "POST" }) } catch { /* real network hiccup — clear local state anyway */ }
    _currentUser = null
    _publish()
}
