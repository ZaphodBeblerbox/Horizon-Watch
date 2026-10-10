import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { platform } from "./closedNotifications.js"
import { pushNotification, setOffScreenHandler } from "../state/notificationStore.js"

const win = (ua, extra = {}) => ({
    navigator: { userAgent: ua, serviceWorker: {}, maxTouchPoints: 0, ...extra.nav },
    PushManager: function () {}, Notification: function () {},
    matchMedia: () => ({ matches: !!extra.standalone }), location: { protocol: "https:" }, ...extra.win,
})

describe("notifications with Parallax closed", () => {
    it("tells an iPhone in Safari to use the Home Screen app", () => {
        const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"
        expect(platform(win(ua))).toBe("ios-browser")
        expect(platform(win(ua, { standalone: true }))).toBe("web")
    })
    it("uses web push in a desktop browser and native notifications in the app", () => {
        expect(platform(win("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130"))).toBe("web")
        expect(platform(win("x", { win: { __TAURI_INTERNALS__: {} } }))).toBe("desktop")
    })
    it("ships the push handler in the generated service worker", () => {
        // The build replaces public/sw.js; only what importScripts names survives.
        expect(readFileSync("vite.config.js", "utf8")).toMatch(/importScripts:\s*\[[^\]]*'\/sw-push\.js'/)
        expect(readFileSync("public/sw-push.js", "utf8")).toContain("addEventListener('push'")
    })
    it("hands what would have popped up to the off-screen handler while hidden", () => {
        const seen = vi.fn()
        setOffScreenHandler(seen)
        const had = globalThis.document
        globalThis.document = { visibilityState: "hidden" }
        try {
            pushNotification({ id: "now:x", kind: "live", sev: "high", title: "Police are kettling protesters", ts: Date.now() })
            pushNotification({ id: "sig:y", kind: "signal", sev: "moderate", title: "Routine", ts: Date.now() })
        } finally {
            if (had === undefined) delete globalThis.document; else globalThis.document = had
            setOffScreenHandler(null)
        }
        expect(seen).toHaveBeenCalledTimes(1)
        expect(seen.mock.calls[0][0].title).toBe("Police are kettling protesters")
    })
})
