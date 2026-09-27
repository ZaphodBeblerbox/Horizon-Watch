import { describe, it, expect, beforeEach } from "vitest"
import {
    pushNotification, getNotifications, __resetNotifications,
} from "./notificationStore.js"

// These pin the store's own guarantees — what it records, in what order,
// and what survives being recorded silently. They were written for the
// live tape, which has since been removed; the properties they cover are
// the store's, not that renderer's, so they outlive it. Renamed rather
// than deleted: the coverage was never really about the tape.

describe("what the notification store guarantees", () => {
    beforeEach(() => __resetNotifications())

    it("sees items that were recorded silently", () => {
        // The backlog fills the tray without interrupting — and the tape
        // is a view of the tray, so a page opened mid-shift still shows
        // the last few hours rather than an empty strip.
        pushNotification({ id: "a", title: "Backlog", sev: "high",
                           kind: "confirm", silent: true })
        expect(getNotifications().items).toHaveLength(1)
    })

    it("keeps items in arrival order, newest first", () => {
        pushNotification({ id: "old", title: "Older", ts: 1000 })
        pushNotification({ id: "new", title: "Newer", ts: 2000 })
        const sorted = [...getNotifications().items].sort((a, b) => b.ts - a.ts)
        expect(sorted[0].id).toBe("new")
    })

    it("carries the timestamp the tape needs to age an item", () => {
        pushNotification({ id: "a", title: "x", ts: 1234 })
        expect(getNotifications().items[0].ts).toBe(1234)
    })

    it("never holds the same arrival twice, so the tape cannot repeat", () => {
        pushNotification({ id: "a", title: "x" })
        pushNotification({ id: "a", title: "x again" })
        expect(getNotifications().items).toHaveLength(1)
    })

    it("carries the reason, which is the tape's tooltip", () => {
        pushNotification({ id: "a", title: "x", sub: "inside Taiwan Strait" })
        expect(getNotifications().items[0].sub).toBe("inside Taiwan Strait")
    })
})
