import { describe, it, expect } from "vitest"
import { fmtWhen } from "./formatTime.js"

describe("fmtWhen", () => {
    it("writes a day-precision date without inventing a time", () => {
        expect(fmtWhen("2026-10-05T00:00:00")).toBe("5 Oct 2026")
        expect(fmtWhen("2026-10-05")).toBe("5 Oct 2026")
        expect(fmtWhen("2026-10-05T14:00:00Z", { precision: "day" })).toBe("5 Oct 2026")
    })

    it("writes a moment in UTC with a Z", () => {
        expect(fmtWhen("2026-10-05T12:14:14.925761+00:00")).toBe("5 Oct 2026, 12:14Z")
        expect(fmtWhen("2026-10-05T14:32:00+02:00")).toBe("5 Oct 2026, 12:32Z")
    })

    it("passes through what it cannot parse and is empty for nothing", () => {
        expect(fmtWhen("last Tuesday")).toBe("last Tuesday")
        expect(fmtWhen(null)).toBe(null)
        expect(fmtWhen("")).toBe(null)
    })
})
