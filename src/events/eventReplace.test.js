import { describe, it, expect, beforeEach } from "vitest"
import { getNotifications, pushNotification, setMuted, __resetNotifications } from "../state/notificationStore.js"

beforeEach(() => { __resetNotifications(); setMuted(false) })

describe("an event's update replaces its notification (DATAMINR_PLAN B2)", () => {
    it("keeps one card per event: the update takes the earlier card's place, in the tray and on screen", () => {
        pushNotification({ id: "ev:ev_12ab34cd", eventKey: "ev:ev_12ab34cd", kind: "telegram", sev: "high", title: "Crowd at Bastille", label: "New event · Urgent" })
        pushNotification({ id: "other", kind: "telegram", sev: "high", title: "Something else" })
        expect(getNotifications().items).toHaveLength(2)
        pushNotification({ id: "ev:ev_12ab34cd:v3", eventKey: "ev:ev_12ab34cd", kind: "telegram", sev: "critical",
                           title: "Update: Arrest now reported — Crowd at Bastille", label: "Update · Critical alert" })
        const { items, cards } = getNotifications()
        expect(items.map((i) => i.id)).toEqual(["ev:ev_12ab34cd:v3", "other"])
        expect(cards.filter((c) => c.eventKey === "ev:ev_12ab34cd").map((c) => c.id)).toEqual(["ev:ev_12ab34cd:v3"])
        expect(items[0].label).toBe("Update · Critical alert")
    })

    it("cards of different events never replace each other", () => {
        pushNotification({ id: "ev:ev_1", eventKey: "ev:ev_00000001", kind: "telegram", sev: "high", title: "A" })
        pushNotification({ id: "ev:ev_2", eventKey: "ev:ev_00000002", kind: "telegram", sev: "high", title: "B" })
        expect(getNotifications().items).toHaveLength(2)
    })
})
