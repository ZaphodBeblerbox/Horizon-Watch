import { describe, it, expect } from "vitest"
import { TASK_STATUSES, statusBadgeColor, formatTaskRegion } from "./taskDisplay.js"

describe("statusBadgeColor — every real ReportTask status maps to a real color", () => {
    it("covers all 10 real status values with a defined (non-fallback) color", () => {
        expect(TASK_STATUSES).toHaveLength(10)
        for (const status of TASK_STATUSES) {
            const color = statusBadgeColor(status)
            expect(color).toBeTruthy()
            expect(typeof color).toBe("string")
            expect(color.startsWith("var(--")).toBe(true)
        }
    })

    it("maps the two commonly-missed real branches (approved/rejected) distinctly", () => {
        // approved is a favorable outcome moving toward publish; rejected is a
        // real dead-end failure — these must not collapse to the same color.
        expect(statusBadgeColor("approved")).not.toBe(statusBadgeColor("rejected"))
        expect(statusBadgeColor("rejected")).toBe("var(--danger)")
    })

    it("maps council_review and human_review to the attention-needed color", () => {
        expect(statusBadgeColor("council_review")).toBe("var(--warn)")
        expect(statusBadgeColor("human_review")).toBe("var(--warn)")
    })

    it("maps published to the success color and archived to a dim/inactive color", () => {
        expect(statusBadgeColor("published")).toBe("var(--live)")
        expect(statusBadgeColor("archived")).toBe("var(--text-muted)")
    })

    it("falls back to a defined dim color for an unrecognized status rather than undefined", () => {
        expect(statusBadgeColor("some_future_status")).toBe("var(--text-muted)")
        expect(statusBadgeColor(undefined)).toBe("var(--text-muted)")
    })
})

describe("formatTaskRegion — explicit list vs auto vs unscoped", () => {
    it("joins an explicit region array", () => {
        expect(formatTaskRegion({ region: ["Red Sea / Arabian Peninsula", "Yemen"] }))
            .toBe("Red Sea / Arabian Peninsula, Yemen")
    })

    it("joins a single-element region array without a trailing separator", () => {
        expect(formatTaskRegion({ region: ["Horn of Africa"] })).toBe("Horn of Africa")
    })

    it("passes through the real 'auto' literal", () => {
        expect(formatTaskRegion({ region: "auto" })).toBe("auto")
    })

    it("shows 'unscoped' for null region", () => {
        expect(formatTaskRegion({ region: null })).toBe("unscoped")
    })

    it("shows 'unscoped' for undefined/missing region", () => {
        expect(formatTaskRegion({})).toBe("unscoped")
        expect(formatTaskRegion(undefined)).toBe("unscoped")
    })
})
