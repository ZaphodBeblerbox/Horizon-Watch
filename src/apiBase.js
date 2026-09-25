// Where the app talks to. One rule decides it, and the desktop build is
// the case that gets it wrong if you are not careful.
//
// THE BUG THIS EXISTS TO PREVENT. The old rule read
// window.location.hostname and treated "localhost" as "the developer is
// running a backend on this machine". Inside a Tauri webview on macOS the
// page is served from tauri://localhost, so the packaged app matched that
// branch and pointed itself at http://localhost:8000 — a server that does
// not exist on anyone's laptop. The DMG therefore reached no backend at
// all, while both URLs sat in the shipped bundle and the wrong one won.
//
// So the desktop build is decided FIRST, and never by hostname.

const PRODUCTION = "https://horizon-watch-production.up.railway.app"

/** True inside the packaged desktop app, in any Tauri version. */
export function isDesktop(w = typeof window !== "undefined" ? window : undefined) {
    if (!w) return false
    // Tauri v2 injects __TAURI_INTERNALS__; v1 injected __TAURI__. The
    // protocol check catches a webview that exposes neither, which is
    // what happens when withGlobalTauri is off.
    return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__)
        || /^tauri:$/.test(w.location?.protocol || "")
        || /\.localhost$/.test(w.location?.hostname || "")   // Windows: tauri.localhost
}

function resolve(w = typeof window !== "undefined" ? window : undefined) {
    // An explicit build-time override always wins, in every environment.
    const configured = import.meta.env?.VITE_API_BASE
    if (configured) return configured

    // The desktop app ships to other people's machines. There is no
    // backend on those machines, so "local" is never the right guess.
    if (isDesktop(w)) return PRODUCTION

    const host = w?.location?.hostname || "localhost"
    const local = host === "localhost" || host === "127.0.0.1"
        || host.startsWith("192.168.") || host.startsWith("10.")
    return local ? "http://localhost:8000" : PRODUCTION
}

export const API_BASE = resolve()
export default API_BASE
