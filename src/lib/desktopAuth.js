/**
 * desktopAuth.js — carrying the session where a cookie cannot go.
 *
 * In the packaged app the page origin is tauri://localhost and the API is
 * on another registrable domain, so hw_session is a third-party cookie and
 * WKWebView blocks those by default. The cookie is set by the server,
 * never stored, never sent — and every launch asks for the password again.
 *
 * So the desktop build keeps the token itself and attaches it as a bearer.
 * ONE wrapper around fetch rather than a header argument threaded through
 * sixty-odd call sites: a scheme that has to be remembered at every call
 * site is a scheme that will be forgotten at one of them, and the failure
 * is a silent 401 on whichever screen was missed.
 *
 * THE BROWSER IS NOT CHANGED. There the cookie works, it is httpOnly, and
 * it is therefore out of reach of anything injected into the page. Holding
 * a raw JWT in localStorage is strictly weaker; it is worth it only where
 * the alternative is an app that cannot stay logged in at all.
 */

import API_BASE, { isDesktop } from "../apiBase.js"

/**
 * Whether this page has to carry the session itself: the packaged app, and
 * a web page on another site than the API (the Vercel frontend talking to
 * Railway), where hw_session is a third-party cookie that Safari and
 * Chrome's tracking protection drop. The server makes the same call
 * (main._needs_bearer) and only then returns the token.
 */
export function needsBearer(w = typeof window !== "undefined" ? window : undefined, apiBase = API_BASE) {
    if (isDesktop(w)) return true
    try {
        const site = (h) => h.split(".").slice(-2).join(".")
        const page = w?.location?.hostname || ""
        const api = new URL(apiBase, w?.location?.href).hostname
        return !!page && !!api && site(page) !== site(api)
    } catch { return false }
}

const KEY = "parallax.session"

export function storeDesktopToken(token) {
    if (!token || !needsBearer()) return
    try { localStorage.setItem(KEY, token) } catch { /* nothing to do */ }
}

export function getDesktopToken() {
    if (!needsBearer()) return null
    try { return localStorage.getItem(KEY) } catch { return null }
}

export function clearDesktopToken() {
    try { localStorage.removeItem(KEY) } catch { /* nothing to do */ }
}

/**
 * Attach the bearer to every request this app makes to its own API.
 * Installed before React mounts, alongside the offline cache.
 */
export function installDesktopAuth({ win = typeof window !== "undefined" ? window : undefined, apiBase } = {}) {
    if (!win || !apiBase || !needsBearer(win, apiBase)) return () => {}
    if (win.__parallaxAuthInstalled) return () => {}
    win.__parallaxAuthInstalled = true

    const native = win.fetch.bind(win)
    win.fetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input?.url
        const token = getDesktopToken()
        // Only our own API, and never overriding a header a caller set.
        if (!token || !url || !String(url).startsWith(apiBase)) return native(input, init)

        const headers = new Headers(
            init.headers || (typeof input === "object" ? input.headers : undefined) || {})
        if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`)
        return native(input, { ...init, headers })
    }
    return () => { win.fetch = native; win.__parallaxAuthInstalled = false }
}
