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
 */
import { isDesktop } from "../apiBase.js"
import { setOffScreenHandler } from "../state/notificationStore.js"

const KEY = "plx-desktop-notify"

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
    setOffScreenHandler(async (item) => {
        try {
            const n = await plugin()
            const body = [item.advice || item.expect, item.sub].filter(Boolean).join(" · ")
            n.sendNotification({ title: item.title, body: body.slice(0, 220) })
        } catch { /* the plugin is missing in an older build: stay quiet */ }
    })
}
