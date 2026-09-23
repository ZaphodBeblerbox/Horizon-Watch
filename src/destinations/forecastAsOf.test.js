/**
 * The as-of line. A forecast whose reader cannot tell how current it is
 * will be read as current, and this corpus is revised annually — so an
 * empty or wrong explanation here is a correctness bug, not a cosmetic
 * one.
 */
import { describe, it, expect } from "vitest"
import { asOfTitle } from "./Forecast.jsx"

describe("asOfTitle", () => {
    it("says when there is no live tail, rather than going quiet", () => {
        const t = asOfTitle({ as_of_month: "2025-12", tail: { tail: false } })
        expect(t).toContain("2025-12")
        expect(t).toContain("No live tail")
    })

    it("names the join and states that the tail is not trained on", () => {
        const t = asOfTitle({
            as_of_month: "2026-08",
            tail: { tail: true, corpus_to: "2025-12", tail_months: 8,
                    calibrated: true,
                    factors: { "one-sided violence against civilians": 0.7053,
                               "state-based conflict": 1.016 } },
        })
        expect(t).toContain("2025-12")
        expect(t).toContain("8 months")
        expect(t).toContain("not used to train")
        // The largest correction is the one worth naming.
        expect(t).toContain("one-sided violence against civilians")
        expect(t).toContain("0.7053")
        expect(t).not.toContain("state-based conflict")
    })

    it("says so when the tail could not be corrected", () => {
        const t = asOfTitle({
            as_of_month: "2026-08",
            tail: { tail: true, corpus_to: "2025-12", tail_months: 2,
                    calibrated: false, factors: {} },
        })
        expect(t).toContain("uncorrected")
        expect(t).toContain("2 months")
    })

    it("uses the singular for a one-month tail", () => {
        expect(asOfTitle({
            tail: { tail: true, corpus_to: "2025-12", tail_months: 1,
                    calibrated: false, factors: {} },
        })).toContain("1 month of")
    })

    it("does not crash on a board with no tail field at all", () => {
        expect(asOfTitle({})).toContain("unknown")
        expect(asOfTitle(null)).toContain("unknown")
    })
})
