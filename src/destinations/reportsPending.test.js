import { describe, it, expect } from "vitest"
import { isPendingCouncilReview, countPendingCouncilReviews } from "./reportsPending.js"

describe("isPendingCouncilReview", () => {
    it("is true for an in_review report with council_run_at set", () => {
        expect(isPendingCouncilReview({ status: "in_review", council_run_at: "2026-08-29T14:00:00" })).toBe(true)
    })

    it("is false for a draft report", () => {
        expect(isPendingCouncilReview({ status: "draft", council_run_at: null })).toBe(false)
    })

    it("is false for an approved/published/rejected report even if council_run_at is set", () => {
        expect(isPendingCouncilReview({ status: "approved", council_run_at: "2026-08-29T14:00:00" })).toBe(false)
        expect(isPendingCouncilReview({ status: "published", council_run_at: "2026-08-29T14:00:00" })).toBe(false)
    })

    it("is false for an in_review report whose council_run_at is not yet set (transient race window)", () => {
        expect(isPendingCouncilReview({ status: "in_review", council_run_at: null })).toBe(false)
    })

    it("is false for null/undefined input", () => {
        expect(isPendingCouncilReview(null)).toBe(false)
        expect(isPendingCouncilReview(undefined)).toBe(false)
    })
})

describe("countPendingCouncilReviews", () => {
    it("counts only genuinely-pending reports in a mixed list", () => {
        const reports = [
            { status: "in_review", council_run_at: "t1" },
            { status: "in_review", council_run_at: "t2" },
            { status: "in_review", council_run_at: null },
            { status: "draft", council_run_at: null },
            { status: "approved", council_run_at: "t3" },
        ]
        expect(countPendingCouncilReviews(reports)).toBe(2)
    })

    it("returns 0 for a non-array input", () => {
        expect(countPendingCouncilReviews(null)).toBe(0)
        expect(countPendingCouncilReviews(undefined)).toBe(0)
    })

    it("returns 0 for an empty list", () => {
        expect(countPendingCouncilReviews([])).toBe(0)
    })
})
