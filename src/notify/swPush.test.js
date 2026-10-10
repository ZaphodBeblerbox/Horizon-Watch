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
    it("shows the push when no Parallax window is in front", async () => {
        const sw = load()
        await sw.fire("push", push({ title: "Police are kettling protesters on Boulevard Saint-Germain", body: "Leave by Rue du Bac", id: "now:x", kind: "live", lat: 48.85, lon: 2.32 }))
        expect(sw.shown).toHaveLength(1)
        expect(sw.shown[0][0]).toMatch(/Saint-Germain/)
        expect(sw.shown[0][1]).toMatchObject({ body: "Leave by Rue du Bac", tag: "now:x", requireInteraction: true })
    })
    it("leaves it to the app when a window is focused", async () => {
        const w = { focused: true, visibilityState: "visible", postMessage: vi.fn() }
        const sw = load({ windows: [w] })
        await sw.fire("push", push({ title: "x", id: "a" }))
        expect(sw.shown).toHaveLength(0)
        expect(w.postMessage).toHaveBeenCalledWith({ type: "PUSH_WHILE_OPEN", id: "a" })
    })
    it("opens the app at the place when clicked with nothing open", async () => {
        const sw = load()
        await sw.fire("notificationclick", { notification: { close() {}, data: { eventId: "a", lat: 48.85, lon: 2.32 } } })
        expect(sw.clients.openWindow).toHaveBeenCalledWith("/?focus=48.85,2.32")
    })
})
