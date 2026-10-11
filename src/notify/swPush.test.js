import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"

// public/sw-push.js run against a stand-in service worker global.
function load({ windows = [] } = {}) {
    const handlers = {}
    const shown = []
    const self = {
        location: { origin: "https://parallax.example" },
        registration: { showNotification: vi.fn(async (t, o) => { shown.push([t, o]) }) },
        addEventListener: (type, fn) => { handlers[type] = fn },
    }
    const clients = { matchAll: async () => windows, openWindow: vi.fn(async () => {}) }
    new Function("self", "clients", readFileSync("public/sw-push.js", "utf8"))(self, clients)
    const fire = async (type, ev) => { let p; handlers[type]({ ...ev, waitUntil: (x) => { p = x } }); await p }
    return { fire, shown, clients }
}
const push = (obj) => ({ data: { json: () => obj, text: () => JSON.stringify(obj) } })

describe("sw-push.js", () => {
    it("shows the push when no Parallax window is in front: the kind as the title, the headline below (the system names the app)", async () => {
        const sw = load()
        await sw.fire("push", push({ title: "On the ground now", body: "Police are kettling protesters on Boulevard Saint-Germain", id: "now:x", kind: "live", lat: 48.85, lon: 2.32 }))
        expect(sw.shown).toHaveLength(1)
        expect(sw.shown[0][0]).toBe("On the ground now")
        expect(sw.shown[0][1]).toMatchObject({ body: "Police are kettling protesters on Boulevard Saint-Germain", icon: "/icon-192.png", tag: "now:x", requireInteraction: true })
    })
    it("leaves it to the app when a window is focused", async () => {
        const w = { focused: true, visibilityState: "visible", postMessage: vi.fn() }
        const sw = load({ windows: [w] })
        await sw.fire("push", push({ title: "x", id: "a" }))
        expect(sw.shown).toHaveLength(0)
        expect(w.postMessage).toHaveBeenCalledWith({ type: "PUSH_WHILE_OPEN", id: "a" })
    })
    it("opens the app on the signal when clicked with nothing open", async () => {
        const sw = load()
        await sw.fire("notificationclick", { notification: { close() {}, data: { eventId: "a", lat: 48.85, lon: 2.32 } } })
        expect(sw.clients.openWindow).toHaveBeenCalledWith("/?signal=a&focus=48.85%2C2.32")
    })
    it("opens a livestream to play it", async () => {
        const sw = load()
        await sw.fire("notificationclick", { notification: { close() {}, data: { eventId: "live:k", livestreamId: "k" } } })
        expect(sw.clients.openWindow).toHaveBeenCalledWith("/?signal=live%3Ak&live=k")
    })
    it("a vessel of concern carries its MMSI into the click, open or closed (src/notify/openSignal.js)", async () => {
        const sw = load()
        await sw.fire("push", push({ title: "Critical alert", body: "VIXENA loitering off Estonia", id: "RUL-667002574-1791715498", kind: "signal",
                                     severity: "critical", lat: 59.85, lon: 25.57, mmsi: "667002574", alert_type: "Russia-linked vessel loitering" }))
        expect(sw.shown[0][1].data).toMatchObject({ eventId: "RUL-667002574-1791715498", mmsi: "667002574", alertType: "Russia-linked vessel loitering" })
        const data = sw.shown[0][1].data
        await sw.fire("notificationclick", { notification: { close() {}, data } })
        const url = sw.clients.openWindow.mock.calls[0][0]
        const q = new URLSearchParams(url.slice(2))
        expect(q.get("signal")).toBe("RUL-667002574-1791715498")
        expect(q.get("vessel")).toBe("667002574")
        expect(q.get("type")).toBe("Russia-linked vessel loitering")
        expect(q.get("focus")).toBe("59.85,25.57")

        const w = { url: "https://parallax.example/", focus: vi.fn(async () => {}), postMessage: vi.fn() }
        const open = load({ windows: [w] })
        await open.fire("notificationclick", { notification: { close() {}, data } })
        expect(w.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "NOTIFICATION_CLICK", eventId: data.eventId, mmsi: "667002574", alertType: "Russia-linked vessel loitering" }))
    })
})
