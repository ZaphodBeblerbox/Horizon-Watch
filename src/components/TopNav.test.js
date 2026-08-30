import { describe, it, expect } from "vitest"
import { MODES } from "./TopNav.jsx"

describe("TopNav MODES", () => {
    it("is exactly the 4 fixed top-level modes, in order", () => {
        expect(MODES.map(m => m.type)).toEqual(["map", "news", "briefing", "forge"])
    })

    it("labels the existing briefing tab as Reports, not a placeholder name", () => {
        const reports = MODES.find(m => m.type === "briefing")
        expect(reports.label).toBe("Reports")
    })

    it("contains no leftover entries for deleted functionality", () => {
        const labels = MODES.map(m => m.label.toLowerCase())
        for (const banned of ["admin", "permission", "drone", "poi", "basemap"]) {
            expect(labels.some(l => l.includes(banned))).toBe(false)
        }
    })
})
