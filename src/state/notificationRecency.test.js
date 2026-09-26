import { describe, it, expect, beforeEach } from "vitest"
import {
    pushNotification, getNotifications, __resetNotifications,
    MAX_INTERRUPT_AGE_MS, setMuted,
} from "./notificationStore.js"

describe("only what is happening now may interrupt", () => {
    // A notification says "this is happening". Something from five hours
    // ago is not happening — it is a record, and it belongs in the tray
    // where records go. Raising a card for it teaches the reader that
    // cards are not urgent, which costs them the one that is.
    beforeEach(() => { __resetNotifications(); setMuted(false) })

    const push = (over = {}) => pushNotification({
        id: `n-${Math.random()}`, title: "Strike reported", sev: "critical",
        kind: "signal", ts: Date.now(), ...over,
    })

    it("a signal from moments ago raises a card", () => {
        expect(push({ ts: Date.now() - 30_000 })).toBe(true)
    })

    it("a signal from five hours ago does not", () => {
        expect(push({ ts: Date.now() - 5 * 3600 * 1000 })).toBe(false)
    })

    it("but it is still recorded in the tray", () => {
        // Suppressing the card must not suppress the record — that would
        // turn "do not interrupt me" into "lose it".
        push({ id: "old-one", ts: Date.now() - 5 * 3600 * 1000 })
        expect(getNotifications().items.some((i) => i.id === "old-one")).toBe(true)
    })

    it("the boundary is the stated window, not a guess", () => {
        expect(push({ ts: Date.now() - (MAX_INTERRUPT_AGE_MS - 60_000) })).toBe(true)
        expect(push({ ts: Date.now() - (MAX_INTERRUPT_AGE_MS + 60_000) })).toBe(false)
    })

    it("an item with no usable timestamp is still allowed through", () => {
        // Unknown age is not old age. Refusing these would silently drop
        // every notification from a source that does not stamp its events.
        expect(push({ ts: undefined })).toBe(true)
        expect(push({ ts: NaN })).toBe(true)
    })

    it("a critical from five hours ago is still not an interruption", () => {
        // Severity does not make something current.
        expect(push({ sev: "critical", ts: Date.now() - 6 * 3600 * 1000 })).toBe(false)
    })
})
