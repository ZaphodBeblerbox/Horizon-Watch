import { describe, expect, it } from "vitest"
import { ageLabel, isLive, liveLabel, whenOf, LIVE_WINDOW_MIN } from "./liveIncident.js"

const NOW = Date.parse("2026-10-22T14:00:00Z")
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString()

describe("liveIncident", () => {
    it("the window is the server's", () => { expect(LIVE_WINDOW_MIN).toBe(60) })

    it("measures an item from its event, else from its post", () => {
        expect(whenOf({ event_time: "E", posted_at: "P" })).toBe("E")
        expect(whenOf({ posted_at: "P" })).toBe("P")
        expect(whenOf(null)).toBe(null)
    })

    it("is live only when the server vouched for it and the event is inside the window of now", () => {
        const p = { live_state: "live", event_time: at(10), posted_at: at(2) }
        expect(isLive(p, NOW)).toBe(true)
        expect(liveLabel(p, NOW)).toBe("Live · 10 min ago")          // the event's age, not the post's 2 min
        expect(isLive({ ...p, event_time: at(61) }, NOW)).toBe(false) // leaves the live set 60 min after the event
        expect(isLive({ ...p, live_state: "past" }, NOW)).toBe(true)  // the client's clock decides, not the response's
        expect(isLive({ ...p, live_state: "not_live" }, NOW)).toBe(false)
        expect(isLive({ ...p, live_state: "unchecked" }, NOW)).toBe(false)
        expect(isLive({ live_state: "live", event_time: null }, NOW)).toBe(false)
        expect(isLive({ live_state: "live", event_time: at(-30) }, NOW)).toBe(false)   // from the future
    })

    it("a post nobody vouched for is only ever 'reported', never 'live'", () => {
        expect(ageLabel({ posted_at: at(5) }, NOW)).toBe("Reported 5 min ago")
        expect(ageLabel({ live_state: "unchecked", posted_at: at(180) }, NOW)).toBe("Reported 3 h ago")
        expect(liveLabel({ posted_at: at(1) }, NOW)).toBe(null)
    })

    it("a past event says when it happened", () => {
        expect(ageLabel({ live_state: "past", event_time: at(125), posted_at: at(120) }, NOW)).toBe("Happened 2 h ago")
        expect(ageLabel({ live_state: "live", event_time: at(0.2) }, NOW)).toBe("Live · just now")
        expect(ageLabel({}, NOW)).toBe("")
    })
})
