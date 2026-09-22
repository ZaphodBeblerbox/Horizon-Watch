import { describe, it, expect } from "vitest"
import { formatBucket, densityTooltip } from "./TimeStrip.jsx"

const FROM = Date.UTC(2026, 0, 2, 9, 0)
const TO = Date.UTC(2026, 0, 2, 10, 30)

describe("density bar labelling", () => {
    it("says how wide a bar is in words", () => {
        expect(formatBucket(90)).toBe("1.5 h")
        expect(formatBucket(60)).toBe("1 h")
        expect(formatBucket(30)).toBe("30 min")
        expect(formatBucket(0)).toBe("")
    })

    it("an empty bar says nothing happened, not nothing at all", () => {
        // A bar with no tooltip is indistinguishable from a broken one.
        const t = densityTooltip({ count: 0, from: FROM, to: TO })
        expect(t).toContain("nothing reported")
    })

    it("a bar reports what it is made of, not just a count", () => {
        // "14 signals" is a count without a subject — it does not say
        // when, how bad, or where, so there is nothing to do with it.
        const t = densityTooltip({
            count: 14, critical: 3, from: FROM, to: TO,
            topRegion: "Donetsk Oblast", topRegionCount: 9,
        })
        expect(t).toContain("14 signals")
        expect(t).toContain("3 critical or high")
        expect(t).toContain("Donetsk Oblast")
        expect(t).toContain("9")
    })

    it("says 'all in' rather than 'most in' when it is all of them", () => {
        const t = densityTooltip({
            count: 4, critical: 0, from: FROM, to: TO,
            topRegion: "Kharkiv", topRegionCount: 4,
        })
        expect(t).toContain("all in Kharkiv")
        expect(t).not.toContain("most in")
    })

    it("omits severity when nothing was severe", () => {
        const t = densityTooltip({ count: 2, critical: 0, from: FROM, to: TO })
        expect(t).not.toContain("critical")
    })

    it("survives a missing cell", () => {
        expect(densityTooltip(null)).toBe("")
    })
})
