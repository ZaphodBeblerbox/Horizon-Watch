// themeStore.js — Parallax theming round. Real per-user, server-persisted
// theme ("dark" | "light" — database.py's User.theme, read via GET
// /api/auth/me, written via PUT /api/users/me/theme). The only
// localStorage use in this module is "hw-theme-cache", a synchronous
// paint-time MIRROR that index.html's inline bootstrap script reads
// before the app renders to avoid a dark/light flash — it is never the
// source of truth. reconcileTheme() is what keeps that mirror honest
// against the real server value once the real session resolves.
import API_BASE from "../apiBase.js"

const CACHE_KEY = "hw-theme-cache"
const listeners = new Set()

export function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"
}

function apply(theme) {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light")
    else document.documentElement.removeAttribute("data-theme")
    try { localStorage.setItem(CACHE_KEY, theme) } catch { /* private mode / storage blocked — next load just misses the paint-time mirror */ }
    listeners.forEach((fn) => fn(theme))
}

export function subscribeTheme(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/** Called once app.jsx's real checkSession() resolves — reconciles the
 * paint-time localStorage mirror against the real per-user server value.
 * Only fires a visible change on a new device/browser (no mirror yet) or
 * right after the user changed theme elsewhere; on a normal repeat visit
 * the mirror already matches and this is a no-op. */
export function reconcileTheme(user) {
    const real = user?.theme === "light" ? "light" : "dark"
    if (real !== getTheme()) apply(real)
}

/** Real toggle — applies instantly (local paint + mirror) then persists to
 * the real per-user DB row. A failed PUT (network hiccup, no session)
 * leaves the local visual change standing rather than reverting it; it
 * will be corrected by reconcileTheme() on the next real session check. */
export async function setTheme(theme) {
    apply(theme)
    try {
        await fetch(`${API_BASE}/api/users/me/theme`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ theme }),
        })
    } catch { /* real network hiccup — local theme already applied */ }
}

export function toggleTheme() {
    setTheme(getTheme() === "light" ? "dark" : "light")
}
