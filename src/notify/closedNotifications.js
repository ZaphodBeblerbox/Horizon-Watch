/**
 * closedNotifications.js — "notify me on this device when Parallax is
 * closed", one control for every platform.
 *
 *   web (desktop browser, Android)   Web Push: the server sends what would
 *                                    have popped up on screen, once
 *                                    (backend/event_watch.sweep).
 *   iPhone / iPad in Safari          Apple allows web push only to the app
 *                                    added to the Home Screen; say how.
 *   desktop app                      native macOS notifications while the
 *                                    window is hidden (desktop/nativeNotify).
 */
import { isDesktop } from "../apiBase.js"
import { getPushSubscription, requestPushPermission, unsubscribePush } from "../utils/pushNotifications.js"
import { desktopNotifyOn, enableDesktopNotify, disableDesktopNotify } from "../desktop/nativeNotify.js"

export function platform(w = typeof window !== "undefined" ? window : undefined) {
    if (!w) return "unsupported"
    if (isDesktop(w)) return "desktop"
    const ua = w.navigator?.userAgent || ""
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (w.navigator?.maxTouchPoints || 0) > 1)
    const standalone = w.navigator?.standalone === true || w.matchMedia?.("(display-mode: standalone)")?.matches
    if (ios && !standalone) return "ios-browser"
    if (!("serviceWorker" in (w.navigator || {})) || !("PushManager" in w) || !("Notification" in w)) return "unsupported"
    return "web"
}

/** {platform, on, blocked} */
export async function closedNotifyStatus() {
    const p = platform()
    if (p === "desktop") return { platform: p, on: desktopNotifyOn(), blocked: false }
    if (p !== "web") return { platform: p, on: false, blocked: false }
    const blocked = typeof Notification !== "undefined" && Notification.permission === "denied"
    const sub = await getPushSubscription()
    return { platform: p, on: !!sub && Notification.permission === "granted", blocked }
}

export async function enableClosedNotify() {
    const p = platform()
    if (p === "desktop") return enableDesktopNotify()
    if (p !== "web") return { ok: false, error: p }
    const r = await requestPushPermission()
    return r.granted ? { ok: true } : { ok: false, error: r.error?.message || (Notification.permission === "denied" ? "blocked" : "not allowed") }
}

export async function disableClosedNotify() {
    if (platform() === "desktop") { disableDesktopNotify(); return { ok: true } }
    const r = await unsubscribePush()
    return { ok: !!r.success }
}
