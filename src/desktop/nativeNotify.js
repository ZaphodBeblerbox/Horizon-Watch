/**
 * nativeNotify.js — macOS notifications from the desktop app while its
 * window is hidden.
 *
 * The packaged app has no service worker, so web push cannot reach it.
 * Instead, closing the window hides it (src-tauri/src/lib.rs) and the app
 * keeps running in the dock; whatever would have popped up on screen is
 * shown as a native notification (notificationStore.setOffScreenHandler).
 * Quitting (⌘Q) stops it — there is then nothing running to notify from.
 *
 * Opt-in per device: the "desktopNotify" flag in this machine's storage,
 * set by the "Notify me when Parallax is closed" control.
 *
 * WHAT IT SHOWS (owner, 2026-10-10): the app's icon (the Parallax X, which
 * macOS takes from the bundle), "Parallax", and the headline — nothing else.
 * CLICKING IT brings Parallax forward. Tauri gives a desktop notification no
 * click callback, so the app coming forward within CLICK_WINDOW_MS of a
 * notification is taken as that click, and the notification's own signal is
 * opened (app.jsx, plx:open-notification).
 */
import { isDesktop } from "../apiBase.js"
import { setOffScreenHandler } from "../state/notificationStore.js"

const KEY = "plx-desktop-notify"
const CLICK_WINDOW_MS = 2 * 60_000
let lastShown = null                 // {item, at}

function openLastOnReturn() {
    if (!lastShown || Date.now() - lastShown.at > CLICK_WINDOW_MS) return
    const { item } = lastShown
    lastShown = null
    window.dispatchEvent(new CustomEvent("plx:open-notification", { detail: {
        id: item.alertId || item.id, lat: item.ref?.lat ?? null, lon: item.ref?.lon ?? null,
        livestreamId: item.livestreamId || null, assetId: item.assetId || null, title: item.title || "",
    } }))
}

/** The notification's text: the headline only. */
export function nativeContent(item) {
    // the system's notification sound with it (macOS: a named system sound)
    return { title: "Parallax", body: String(item?.title || "").slice(0, 220), sound: "Ping" }
}

export function desktopNotifyOn() {
    try { return localStorage.getItem(KEY) === "1" } catch { return false }
}

async function plugin() {
    return import("@tauri-apps/plugin-notification")
}

export async function enableDesktopNotify() {
    if (!isDesktop()) return { ok: false, error: "not the desktop app" }
    try {
        const n = await plugin()
        let granted = await n.isPermissionGranted()
        if (!granted) granted = (await n.requestPermission()) === "granted"
        if (!granted) return { ok: false, error: "macOS did not allow notifications — System Settings › Notifications › Parallax" }
        try { localStorage.setItem(KEY, "1") } catch { /* private storage */ }
        installNativeNotify()
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e?.message || String(e) }
    }
}

export function disableDesktopNotify() {
    try { localStorage.removeItem(KEY) } catch { /* nothing to remove */ }
    setOffScreenHandler(null)
}

/** Called once at start; does nothing unless the user turned it on. */
export function installNativeNotify() {
    if (!isDesktop() || !desktopNotifyOn()) return
    if (!window.__plxNotifyReturn) {
        window.__plxNotifyReturn = true
        window.addEventListener("focus", openLastOnReturn)
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") openLastOnReturn() })
    }
    setOffScreenHandler(async (item) => {
        try {
            const n = await plugin()
            n.sendNotification(nativeContent(item))
            lastShown = { item, at: Date.now() }
        } catch { /* the plugin is missing in an older build: stay quiet */ }
    })
}
