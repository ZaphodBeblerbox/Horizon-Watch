import { describe, it, expect } from "vitest"
import { DESTINATIONS, DESTINATION_KEYS } from "./destinations.js"

describe("DESTINATIONS", () => {
    it("is exactly the 5 real top-level destinations, in the spec's exact order", () => {
        expect(DESTINATION_KEYS).toEqual(["dashboard", "reports", "watchlists", "sources", "aiCouncil"])
    })

    it("does not include Globe/Maritime as a destination — it's the home screen, not a nav item", () => {
        expect(DESTINATION_KEYS).not.toContain("map")
        expect(DESTINATION_KEYS).not.toContain("globe")
    })

    it("has no leftover News or Forge entries", () => {
        const labels = DESTINATIONS.map((d) => d.label.toLowerCase())
        expect(labels.some((l) => l.includes("news"))).toBe(false)
        expect(labels.some((l) => l.includes("forge"))).toBe(false)
    })
})
