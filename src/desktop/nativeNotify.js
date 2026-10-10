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

/** Send one, through our own command (src-tauri lib.rs plx_notify), so an
 *  error comes back instead of vanishing in the plugin's script. */
export async function nativeSend({ title, body }) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("plx_notify", { title, body: body || "" })
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
        // one now: it registers Parallax with macOS (System Settings ›
        // Notifications lists it from then on) and shows that it works
        try { await nativeSend({ title: "Parallax", body: "Notifications are on — they arrive when Parallax is in the background or closed." }) }
        catch (e) { return { ok: false, error: `macOS refused it: ${e?.message || e}` } }
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
            await nativeSend(nativeContent(item))
            lastShown = { item, at: Date.now() }
        } catch (e) { console.warn("[notify] native notification failed:", e) }
    })
}

/** A test, in `delayMs` (time to switch to another app): the same call a
 *  real notification makes. Resolves with what happened. */
export async function testNativeNotify(delayMs = 5000) {
    if (!isDesktop()) return { ok: false, error: "not the desktop app" }
    await new Promise((ok) => setTimeout(ok, delayMs))
    try {
        await nativeSend(nativeContent({ title: "Test notification — notifications reach this Mac." }))
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e?.message || String(e) }
    }
}
