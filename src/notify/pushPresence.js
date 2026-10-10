/**
 * pushPresence.js — "Parallax is on screen here", told to the server.
 *
 * NO SYSTEM NOTIFICATION WHILE THE APP IS OPEN (owner, 2026-10-10): while
 * this device shows Parallax, it says so every 30 s by its push endpoint
 * (/api/push/presence), and the server skips pushing to it — the app's own
 * cards show the same thing. Hidden or closed, it says so at once, and
 * pushes resume. The server forgets a device it has not heard from in 75 s.
 */
import API_BASE from "../apiBase.js"

const EVERY_MS = 30_000
let started = false

async function endpoint() {
    try {
        if (!("serviceWorker" in navigator)) return null
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager?.getSubscription()
        return sub?.endpoint || null
    } catch { return null }
}

async function tell(gone = false) {
    const ep = await endpoint()
    if (!ep) return
    try {
        await fetch(`${API_BASE}/api/push/presence`, {
            method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gone ? { endpoint: ep, gone: true } : { endpoint: ep }),
        })
    } catch { /* offline: the server forgets us in 75 s anyway */ }
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible"

export function startPushPresence() {
    if (started || typeof window === "undefined") return
    started = true
    if (visible()) tell()
    setInterval(() => { if (visible()) tell() }, EVERY_MS)
    document.addEventListener("visibilitychange", () => tell(!visible()))
    window.addEventListener("pagehide", () => tell(true))
}
