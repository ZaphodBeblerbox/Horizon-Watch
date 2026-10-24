import { describe, expect, it } from "vitest"
import { SWIPE_SKIP, swipeTarget } from "./tabSwipe.js"

const NAV = [["home"], ["map"], ["desk"], ["messages"], ["more"]]

describe("tab swipe", () => {
    it("moves one bottom tab per swipe, and holds at the edges", () => {
        expect(swipeTarget(NAV, "home", 1)).toBe("map")
        expect(swipeTarget(NAV, "desk", -1)).toBe("map")
        expect(swipeTarget(NAV, "messages", 1)).toBe("more")
        expect(swipeTarget(NAV, "home", -1)).toBe(null)
        expect(swipeTarget(NAV, "more", 1)).toBe(null)
    })
    it("a screen under More swipes back to Messages", () => {
        expect(swipeTarget(NAV, "alerts", -1)).toBe("messages")
        expect(swipeTarget(NAV, "settings", 1)).toBe(null)
    })
    it("leaves sideways scrollers, fields, sheets and small maps alone", () => {
        for (const s of [".dk-tabs", ".m2-hscroll", "video", ".leaflet-container", ".m2-sheet", "input"]) expect(SWIPE_SKIP).toContain(s)
    })
})
