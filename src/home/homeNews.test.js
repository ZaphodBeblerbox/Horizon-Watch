import { describe, it, expect, beforeEach } from "vitest"
import { newOnHome, announceNew } from "./homeNews.js"
import { getNotifications, interrupts, __resetNotifications } from "../state/notificationStore.js"

describe("new on Home", () => {
    it("records the first look silently, then returns only what was not there", () => {
        const store = {}
        expect(newOnHome("ground", [{ id: 1 }, { id: 2 }], (x) => x.id, store)).toEqual([])
        expect(newOnHome("ground", [{ id: 1 }, { id: 2 }], (x) => x.id, store)).toEqual([])
        expect(newOnHome("ground", [{ id: 3 }, { id: 1 }], (x) => x.id, store)).toEqual([{ id: 3 }])
        // announced once: the same set again is not news
        expect(newOnHome("ground", [{ id: 3 }, { id: 1 }], (x) => x.id, store)).toEqual([])
        // and an item that left and came back was already announced
        expect(newOnHome("ground", [{ id: 2 }], (x) => x.id, store)).toEqual([])
    })
})

describe("announceNew", () => {
    beforeEach(() => { __resetNotifications(); globalThis.localStorage?.clear?.() })
    it("puts one notification in the tray per change, naming a single item", () => {
        const mem = {}
        globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }, clear: () => {} }
        announceNew("ground", [{ id: "a", headline: "Old" }])
        expect(getNotifications().items.length).toBe(0)
        announceNew("ground", [{ id: "b", headline: "Strike on a depot", place: "Sanaa" }, { id: "a", headline: "Old" }],
            { placeOf: (v) => v.place })
        const items = getNotifications().items
        expect(items.length).toBe(1)
        expect(items[0].kind).toBe("home")
        expect(items[0].title).toBe("New on Home: Strike on a depot")
        expect(items[0].sub).toContain("Sanaa")
    })
    it("takes the screen only when Home is not on it", () => {
        expect(interrupts({ kind: "home", sev: "moderate", onHome: false })).toBe(true)
        expect(interrupts({ kind: "home", sev: "moderate", onHome: true })).toBe(false)
    })
})
