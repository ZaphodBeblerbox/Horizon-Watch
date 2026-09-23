import { describe, it, expect } from "vitest"
import { pct, residualOf, departure, tickLeft, barWidth, rows } from "./forecastBars.js"

describe("the bar stack's arithmetic", () => {
    it("formats the way the spec's own board does", () => {
        expect(pct(0.07)).toBe("7.0%")
        expect(pct(0.56)).toBe("56%")
        expect(pct(null)).toBe("—")
    })

    it("computes the residual rather than trusting an authored one", () => {
        // The spec's Narva board: 7 / 24 / 13 leaves 56.
        expect(residualOf([{ p: 0.07 }, { p: 0.24 }, { p: 0.13 }])).toBeCloseTo(0.56, 6)
    })

    it("the residual moves when a scenario is added", () => {
        // F7's requirement: proposing recomputes it. A residual that
        // does not move is the exact failure the rule calls out.
        const before = residualOf([{ p: 0.3 }])
        const after = residualOf([{ p: 0.3 }, { p: 0.2 }])
        expect(before - after).toBeCloseTo(0.2, 6)
    })

    it("never goes negative when scenarios oversubscribe", () => {
        expect(residualOf([{ p: 0.8 }, { p: 0.9 }])).toBe(0)
    })

    it("names a bar sitting on its tick as telling you nothing new", () => {
        const d = departure(0.55, 0.55)
        expect(d.kind).toBe("flat")
        expect(d.text).toContain("history already said")
    })

    it("names a departure and its direction", () => {
        expect(departure(0.07, 0.02).kind).toBe("above")
        expect(departure(0.12, 0.49).kind).toBe("below")
        expect(departure(0.12, 0.49).text).toContain("below a base rate of 49%")
    })

    it("says an authored scenario has no base rate rather than inventing one", () => {
        const d = departure(0.3, null)
        expect(d.kind).toBe("none")
        expect(d.text).toContain("authored")
    })

    it("positions the tick from the base rate and clamps it into the bar", () => {
        expect(tickLeft(0.25)).toBe("25%")
        expect(tickLeft(1.4)).toBe("100%")
        expect(tickLeft(-1)).toBe("0%")
        expect(tickLeft(null)).toBeNull()
    })

    it("clamps the fill so a rogue probability cannot overflow the row", () => {
        expect(barWidth(0.5)).toBe("50%")
        expect(barWidth(9)).toBe("100%")
        expect(barWidth(NaN)).toBe("0%")
    })

    it("puts the residual last and flags it as a row, not a footnote", () => {
        const r = rows([{ id: "a", p: 0.1 }, { id: "b", p: 0.4 }])
        expect(r).toHaveLength(3)
        expect(r[0].id).toBe("b")            // ordered by probability
        expect(r[2].residual).toBe(true)
        expect(r[2].p).toBeCloseTo(0.5, 6)
    })

    it("still renders a residual row when there are no scenarios at all", () => {
        const r = rows([])
        expect(r).toHaveLength(1)
        expect(r[0].p).toBe(1)
    })
})
