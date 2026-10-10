import { describe, it, expect } from "vitest"
import { layersFor, tourStops, overview } from "./director.js"

const S = [
    { headline: "a", source: "telegram", severity: "moderate", lat: 15, lon: 44 },
    { headline: "b", source: "GDELT", severity: "critical", lat: 16, lon: 45 },
    { headline: "c", source: "FIRMS", severity: "high", lat: 14, lon: 43 },
    { headline: "d", source: "rss", severity: "critical" },
]
describe("director", () => {
    it("switches on the layers the evidence comes from", () => {
        expect(layersFor(S).sort()).toEqual(["alerts", "gdelt", "heat", "telegram"])
    })
    it("visits the strongest located signals first", () => {
        expect(tourStops(S).map((s) => s.headline)).toEqual(["b", "c", "a"])
    })
    it("frames them all", () => {
        const o = overview(S)
        expect(o.lat).toBe(15); expect(o.lon).toBe(44); expect(o.altitude).toBeGreaterThanOrEqual(400_000)
        expect(overview([])).toBe(null)
    })
})
