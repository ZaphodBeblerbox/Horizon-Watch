/**
 * connectivity.js — "you are offline" only when the device has no network.
 *
 * WHY THIS EXISTS. On Android (2026-10-18) the app kept telling a second
 * user they were offline while their phone had a network and Railway was
 * up. The server was not down, it was slow: its event loop was blocked for
 * up to a minute at a time, so GET /api/auth/me ran past its 10 s deadline
 * four times in a row and the boot gate concluded "transient failure",
 * which it rendered as "Working offline. The server cannot be reached".
 * A request that times out, a 502 from the edge (which carries no CORS
 * header and so reaches the page as a TypeError) and a device with no
 * network all looked the same.
 *
 * They are different facts and the reader needs different advice:
 *
 *   offline       the DEVICE has no network (navigator.onLine === false)
 *   slow          the server accepted the request and did not answer in time
 *   server-error  the server answered with a 5xx
 *   unreachable   the request reached nobody, though the device says it is
 *                 online (server restarting, edge 502, captive portal)
 *
 * Only the first is "offline". The others are the server's problem, are
 * retried with backoff, and say so.
 */

/** True only when the browser positively reports no network. */
export function deviceOffline(nav = typeof navigator !== "undefined" ? navigator : undefined) {
    return !!nav && nav.onLine === false
}

/**
 * What a failed request means.
 *
 * `error` is what fetch threw (or null when a response arrived), `status`
 * the HTTP status when there was one, `timedOut` whether OUR deadline fired.
 */
export function classifyFailure({ online = true, error = null, status = null, timedOut = false } = {}) {
    if (!online) return "offline"
    if (timedOut || error?.name === "TimeoutError" || error?.name === "AbortError") return "slow"
    if (status != null && status >= 500) return "server-error"
    if (error) return "unreachable"
    return "server-error"
}

/** Wording for each reason — the reader is told whose problem it is. */
export const CONNECTION_COPY = {
    offline: {
        title: "You're offline",
        body: "This device has no network connection. Parallax will reconnect by itself when it is back.",
    },
    slow: {
        title: "The server is slow to answer — reconnecting…",
        body: "Your connection is fine; the server is busy. Parallax keeps trying and opens as soon as it answers.",
    },
    "server-error": {
        title: "The server is having trouble — reconnecting…",
        body: "Your connection is fine; the server answered with an error. Parallax keeps trying.",
    },
    unreachable: {
        title: "Can't reach the server — reconnecting…",
        body: "Your device reports a network, but the server did not answer. It may be restarting; Parallax keeps trying.",
    },
}

export function connectionCopy(reason) {
    return CONNECTION_COPY[reason] || CONNECTION_COPY.unreachable
}

/** Backoff for automatic reconnects: 5 s, 10 s, 20 s, then every 30 s. */
export function retryDelayMs(attempt) {
    const n = Math.max(0, attempt | 0)
    return Math.min(30_000, 5_000 * 2 ** n)
}

/**
 * Does anything answer at the API's address?
 *
 * A `no-cors` request resolves with an opaque response whenever ANY server
 * answers — even an edge 502 without CORS headers — and rejects only when
 * nothing does. So it separates "the server is up but slow or erroring"
 * from "nothing is there" without needing the API to cooperate.
 */
export async function probeServer({
    apiBase,
    fetchImpl = typeof fetch === "function" ? fetch : null,
    timeoutMs = 8000,
} = {}) {
    if (!fetchImpl || !apiBase) return false
    const ctl = typeof AbortController === "function" ? new AbortController() : null
    const t = ctl ? setTimeout(() => { try { ctl.abort() } catch { /* gone */ } }, timeoutMs) : null
    try {
        await fetchImpl(`${apiBase}/api/health/live?probe=${Date.now()}`, {
            mode: "no-cors", cache: "no-store", credentials: "omit",
            ...(ctl ? { signal: ctl.signal } : {}),
        })
        return true
    } catch {
        return false
    } finally {
        if (t) clearTimeout(t)
    }
}

/**
 * The boot gate's decision, as data so it is testable without React.
 *
 *   app            signed in
 *   login          not signed in (a real 401, or never signed in)
 *   login-offline  sign in against this device's stored credentials
 *   reconnecting   the server is slow/unreachable: say so and keep trying
 */
export function bootGate({ authUser, transient, reason, offlineLoginAvailable, useLocalData = false }) {
    if (authUser) return "app"
    if (!transient) return "login"
    // Only a device with no network goes straight to the offline sign-in.
    // A slow or restarting server gets "reconnecting", with the local
    // sign-in offered as a choice rather than presented as the situation.
    if (offlineLoginAvailable && (reason === "offline" || useLocalData)) return "login-offline"
    return "reconnecting"
}
