import { describe, it, expect } from "vitest"
import { cardLabel, assetConnection, connectionLine, eventIdOf, firstSeenLine, followTargetOf, homeReasons, rankEvents, statusChip,
         timelineLine, updatedLine } from "./eventLogic.js"

const T = (m) => new Date(Date.UTC(2026, 9, 24, 12, m)).toISOString()

describe("event card logic", () => {
    it("names the status and the brief's version", () => {
        expect(statusChip("developing")).toMatchObject({ label: "Developing", tone: "hot" })
        expect(statusChip("nonsense")).toBeNull()
        expect(updatedLine({ version: 3, created_at: T(32) })).toMatch(/^Updated \d\d:\d\d · v3$/)
        expect(updatedLine({ version: 1, created_at: T(0) })).toMatch(/^First brief \d\d:\d\d · v1$/)
        expect(updatedLine(null)).toBe("")
        expect(firstSeenLine({ first_seen: T(0) }, Date.parse(T(34)))).toMatch(/^First seen \d\d:\d\d · 34 min ago$/)
    })

    it("finds the event id whatever the item's shape", () => {
        expect(eventIdOf({ event_id: "ev_12ab34cd" })).toBe("ev_12ab34cd")
        expect(eventIdOf({ id: "ev_12ab34cd" })).toBe("ev_12ab34cd")
        expect(eventIdOf({ id: "ev:ev_12ab34cd:v3" })).toBe("ev_12ab34cd")
        expect(eventIdOf({ event: { id: "ev_00000000" } })).toBe("ev_00000000")
        expect(eventIdOf({ id: "ALT-1" })).toBeNull()
    })

    it("follows an event by its id and anything else by its place", () => {
        expect(followTargetOf({ event_id: "ev_12ab34cd", headline: "Arrest at Bastille" })).toEqual({ target: "ev_12ab34cd", kind: "event", label: "Arrest at Bastille" })
        expect(followTargetOf({ id: "pr-p1-live", kind: "protest", title: "March", lat: 48.85, lon: 2.37 }))
            .toEqual({ target: "protest:pr-p1-live", kind: "protest", label: "March", lat: 48.85, lon: 2.37 })
        expect(followTargetOf({ id: "x", title: "no place" })).toBeNull()
    })

    it("says which asset it is near and why it is on Home", () => {
        const assets = [{ name: "HQ", kind: "office", lat: 48.8532, lon: 2.3692, radius_km: 10 }, { name: "Depot", kind: "site", lat: 49.5, lon: 2.3692 }]
        const c = assetConnection({ lat: 48.8622, lon: 2.3692 }, assets, { lat: 48.85, lon: 2.35 })
        expect(c[0].name).toBe("HQ")
        expect(c[0].inside).toBe(true)
        expect(connectionLine(c[0])).toBe("1.0 km from your office HQ")
        expect(c.some((x) => x.me)).toBe(true)
        const r = homeReasons({ priority: "urgent", why: "1 km from your office HQ", status: "developing", corroboration: { line: "Corroborated by 2 sources" } }, c)
        expect(r[0]).toBe("Urgent for you: 1 km from your office HQ")
        expect(r).toContain("Corroborated by 2 sources")
        expect(r).toContain("Still developing: new reports in the last minutes")
    })

    it("ranks developing first, then by the user's priority, then the newest", () => {
        const out = rankEvents([
            { id: "a", status: "ongoing", priority: "flash", last_update: T(10) },
            { id: "b", status: "developing", priority: "alert", last_update: T(5) },
            { id: "c", status: "developing", priority: "urgent", last_update: T(1) },
            { id: "d", status: "ended", priority: "flash", last_update: T(20) },
        ])
        expect(out.map((x) => x.id)).toEqual(["c", "b", "a", "d"])
    })

    it("turns the timeline into lines, crowd and police positions included", () => {
        expect(timelineLine({ kind: "brief", at: T(3), version: 2, text: "A crowd", what_changed: "Arrest now reported" }).text).toBe("Update: Arrest now reported")
        expect(timelineLine({ kind: "movement", who: "police", at: T(4), text: "Police at Saint-Paul" })).toMatchObject({ kind: "movement", sub: "Police position" })
    })

    it("labels a notification New event or Update", () => {
        expect(cardLabel({ event_key: "ev:ev_1", alert_type: "Update · Urgent" })).toBe("Update · Urgent")
        expect(cardLabel({ event_key: "ev:ev_1" })).toBe("New event")
    })
})
