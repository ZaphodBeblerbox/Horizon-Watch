// authStore.js — real authentication round. Real session state: a real
// login()/logout() against the real /api/auth/* endpoints (httpOnly JWT
// cookie — this module never sees or stores the token itself, only the
// resulting user object), module-level pub/sub matching this app's
// established pattern (cameraState.js, situationFilterState.js). Replaces
// the previous self-reported "Acting as" picker (profile.userId) as the
// real source of "who is this" — see MissionProfilePanel.jsx's own
// removal note for that decision.
import API_BASE from "../apiBase.js"
import { enrol, offlineLogin, forgetEnrolment, enrolmentFor, OFFLINE_GRACE_MS } from "../lib/offlineAuth.js"
import { indexedDbStore, memoryStore } from "../lib/offlineCache.js"
import { storeDesktopToken, clearDesktopToken } from "../lib/desktopAuth.js"
import { classifyFailure, deviceOffline, probeServer } from "../lib/connectivity.js"

// One store for the enrolment record, created lazily so importing this
// module in a test environment never touches IndexedDB.
let _store = null
function _enrolStore() {
    if (!_store) {
        _store = (typeof window !== "undefined" && window.indexedDB)
            ? indexedDbStore(window.indexedDB)
            : memoryStore()
    }
    return _store
}

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
// WHY the last check failed (connectivity.js): "offline" only when the
// device has no network; "slow", "server-error" or "unreachable" when the
// server is the problem. The boot gate words its screen from this.
let _authTransientReason = null
// True when the session was granted by offlineAuth rather than the server.
let _offlineSession = false
const _listeners = new Set()

function _publish() {
    for (const fn of _listeners) fn(_currentUser)
}

export function getCurrentUser() { return _currentUser }

/**
 * Replace the signed-in user with a fresher copy of themselves.
 *
 * Profile saves through PUT /api/users/{id} and gets the updated row back.
 * Without this, that row lived in Profile's own state: you could change
 * your picture and watch the rail and Home keep showing the old initials
 * until the next full reload, which reads as the save not having worked.
 *
 * It refuses a different user on purpose — this is "I changed my own
 * details", never "become someone else", and a store that accepts an
 * arbitrary identity from a component is one bug away from a session mix-up.
 */
export function updateCurrentUser(next) {
    if (!next?.id || !_currentUser || next.id !== _currentUser.id) return _currentUser
    _currentUser = { ..._currentUser, ...next }
    _publish()
    return _currentUser
}
export function isAuthChecked() { return _authChecked }
export function isAuthTransientError() { return _authTransientError }
export function authTransientReason() { return _authTransientReason }
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
 * says nothing real about whether the session is actually still valid.
 *
 * Real root-cause fix, live-reproduced: this fetch had no timeout at all.
 * The production backend was confirmed (repeatedly, directly) to
 * intermittently accept the connection and then never respond — not a
 * network error, not a 5xx, just a promise that never settles. checkSession
 * ()'s own retry loop below is powerless against that: it only runs again
 * AFTER _tryFetchMe() returns, and an unbounded fetch that never resolves
 * or rejects never returns at all. app.jsx's `if (!authChecked) return
 * null` render gate then stays blank forever — the real, confirmed cause
 * of the reported "the app doesn't work" blank-page incidents, not a
 * stale-build/CDN issue. A real 10s AbortController timeout turns a hung
 * connection into the same "transient" outcome a network error already
 * gets, so the existing retry-then-honest-fallback logic actually runs. */
/** How long one GET /api/auth/me may take. 10 s was shorter than the
 *  production server's slow spells (2026-10-18: the loop blocked 30-60 s),
 *  so a busy server read as "offline" on the phone. */
export const ME_TIMEOUT_MS = 15_000

async function _tryFetchMe() {
    let r
    const controller = new AbortController()
    let timedOut = false
    const timeoutId = setTimeout(() => { timedOut = true; controller.abort() }, ME_TIMEOUT_MS)
    try {
        r = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal: controller.signal,
        })
    } catch (error) {
        return { outcome: "transient", reason: classifyFailure({ online: !deviceOffline(), error, timedOut }) }
    } finally {
        clearTimeout(timeoutId)
    }
    if (r.status === 401) return { outcome: "unauthenticated" }
    if (!r.ok) return { outcome: "transient", reason: classifyFailure({ online: !deviceOffline(), status: r.status }) }
    try {
        const user = await r.json()
        // the renewed token, for a client that holds its own (desktopAuth)
        if (user?.session_token) { storeDesktopToken(user.session_token); delete user.session_token }
        return { outcome: "ok", user }
    } catch {
        return { outcome: "transient", reason: "server-error" }
    }
}

/**
 * Settle WHY the server could not be asked, once every retry has failed.
 * The device says it is offline: offline. Otherwise ask whether anything
 * answers at the API's address at all — if it does, the server is up and
 * merely slow or erroring, which is not the user's connection.
 */
async function _settleReason(last) {
    if (deviceOffline()) return "offline"
    if (last === "slow" || last === "server-error") return last
    try {
        return (await probeServer({ apiBase: API_BASE })) ? "slow" : "unreachable"
    } catch {
        return "unreachable"
    }
}

/* THE LAST PROFILE THE SERVER GAVE, KEPT ON THIS MACHINE. A sign-in without
   the server (offlineAuth) knew who you were but not your picture, header or
   settings, so an outage took the profile picture and the saved default
   layers with it (the owner, 2026-10-08). The copy is refreshed on every
   successful check and only ever read back for the same account. */
const PROFILE_KEY = (email) => `plx-profile:${String(email || "").toLowerCase()}`
function _keepProfile(user) {
    if (!user?.email) return
    try { localStorage.setItem(PROFILE_KEY(user.email), JSON.stringify(user)) } catch { /* full or blocked: the next check tries again */ }
}
export function lastProfile(email) {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY(email)) || "null") } catch { return null }
}

/** Real app-boot (and periodic re-validation) check. Retries a real
 * transient failure with backoff before giving up — only a genuine 401
 * ever clears a session here; a still-unresolved transient failure after
 * every retry leaves the previous real _currentUser value standing
 * (never assumed logged-out) and sets _authTransientError so the caller
 * can show a real "couldn't reach the server" state instead of the login
 * screen. */
export async function checkSession() {
    const MAX_ATTEMPTS = 3
    const BASE_DELAY_MS = 700
    let lastReason = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const result = await _tryFetchMe()
        if (result.outcome === "ok") {
            _currentUser = result.user
            _keepProfile(result.user)
            _authTransientError = false
            _authTransientReason = null
            _authChecked = true
            _publish()
            return _currentUser
        }
        if (result.outcome === "unauthenticated") {
            _currentUser = null
            _authTransientError = false
            _authTransientReason = null
            _authChecked = true
            _publish()
            return null
        }
        lastReason = result.reason || lastReason
        // No network on the device: retrying now cannot help, and the
        // gate reconnects by itself on the browser's "online" event.
        if (lastReason === "offline") break
        if (attempt < MAX_ATTEMPTS - 1) await sleep(BASE_DELAY_MS * 2 ** attempt)
    }
    _authTransientReason = await _settleReason(lastReason)
    _authTransientError = true
    _authChecked = true
    _publish()
    return _currentUser
}

/** True when the current session was granted locally, with no server. */
export function isOfflineSession() { return _offlineSession }

/**
 * Can this machine sign in without a server?
 *
 * The boot gate needs this to decide what to show when GET /api/auth/me
 * cannot be reached. Without it the app showed a dead-end "couldn't reach
 * the server" screen and never rendered the login form — which made every
 * piece of offline machinery below it unreachable, because the user could
 * never get past that screen to use it. That is the whole "the desktop app
 * does not work offline" report: the capability existed and had no door.
 */
export async function canLoginOffline(now = Date.now()) {
    try {
        const rec = await enrolmentFor(_enrolStore())
        if (!rec?.digest) return false
        // Same expiry the offline login itself enforces. Offering a door
        // that is going to refuse is worse than not offering one.
        return (now - (rec.lastServerLoginAt || rec.enrolledAt || 0)) < OFFLINE_GRACE_MS
    } catch {
        return false
    }
}

/** A sign-in may wait this long; it had no deadline and could hang forever
 *  on a server that accepted the connection and never answered. */
export const LOGIN_TIMEOUT_MS = 30_000

export async function login(email, password, { allowLocal = false } = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), LOGIN_TIMEOUT_MS)
    try {
        const user = await req("/api/auth/login", {
            method: "POST", body: JSON.stringify({ email, password }), signal: ctl.signal,
        })
        clearTimeout(t)
        _currentUser = user
        _offlineSession = false
        // The packaged app cannot keep the session cookie — its origin
        // makes hw_session third-party and WKWebView drops it — so the
        // server hands the desktop build a bearer token instead, and it is
        // kept here. A browser never receives this field.
        if (user?.session_token) storeDesktopToken(user.session_token)
        // Remember this machine so the same person can get in when the
        // server cannot be reached. Enrolment is deliberately tied to a
        // SUCCESSFUL server login and to nothing else.
        try {
            await enrol({ email, password, user, store: _enrolStore(), crypto: window.crypto })
        } catch { /* a machine that cannot enrol still logged in fine */ }
        _keepProfile(user)
        _publish()
        return user
    } catch (e) {
        // A SERVER THAT ANSWERED IS THE AUTHORITY. A 401 means the
        // password is wrong, and falling back to a local check would turn
        // a rejection into an acceptance. Only a request that reached
        // nobody may fall back.
        clearTimeout(t)
        if (!_reachedNobody(e)) throw e
        // A SLOW SERVER IS NOT NO SERVER. If the device has a network and
        // something answers at the API's address, the server is up and
        // busy: say that, rather than signing in "offline" against stale
        // local data and telling the user they have no connection.
        // `allowLocal`: the reader chose "use the data on this device".
        if (!allowLocal && !deviceOffline() && await probeServer({ apiBase: API_BASE }).catch(() => false)) {
            throw new Error(e?.name === "AbortError"
                ? "The server is slow to answer right now. Your connection is fine — try again in a moment."
                : "The server could not complete the sign-in. Your connection is fine — try again in a moment.")
        }

        const r = await offlineLogin({ email, password, store: _enrolStore(), crypto: window.crypto })
        if (!r.ok) throw new Error(r.reason)
        // who you are from the enrolment; your picture, header and settings from the last profile
        const kept = lastProfile(r.user?.email || email)
        _currentUser = kept && (!r.user?.id || kept.id === r.user.id) ? { ...kept, ...r.user, avatar: kept.avatar, cover: kept.cover, settings: kept.settings } : r.user
        _offlineSession = true
        _authChecked = true
        _publish()
        return _currentUser
    }
}

/** Did this error mean "nobody answered", as opposed to "the server said no"? */
function _reachedNobody(e) {
    // req() throws Error("HTTP 401") / Error(detail) for a real response,
    // and fetch throws TypeError/AbortError when the request never landed.
    if (e instanceof TypeError) return true
    if (e?.name === "AbortError") return true
    return /failed to fetch|networkerror|load failed|timed out/i.test(e?.message || "")
}

export async function logout() {
    try { await req("/api/auth/logout", { method: "POST" }) } catch { /* real network hiccup — clear local state anyway */ }
    // Signing out is explicit, so it also withdraws this machine's
    // permission to sign in offline. Leaving the enrolment behind would
    // let the next person at the laptop back in with the old password.
    clearDesktopToken()
    await forgetEnrolment(_enrolStore())
    _currentUser = null
    _offlineSession = false
    _publish()
}
