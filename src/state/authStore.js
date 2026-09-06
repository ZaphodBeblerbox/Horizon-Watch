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
const _listeners = new Set()

function _publish() {
    for (const fn of _listeners) fn(_currentUser)
}

export function getCurrentUser() { return _currentUser }
export function isAuthChecked() { return _authChecked }
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

/** Real app-boot check — is there already a valid session cookie? Never
 * throws; a 401 here just means "not logged in yet", not an error. */
export async function checkSession() {
    try {
        _currentUser = await req("/api/auth/me")
    } catch {
        _currentUser = null
    }
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
