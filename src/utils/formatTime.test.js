import { describe, it, expect } from "vitest"
import { agoLabel, fmtWhen, whenLabel } from "./formatTime.js"

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


describe("ago and when", () => {
    const now = Date.parse("2026-10-06T14:00:00Z")
    it("says how long ago in words", () => {
        expect(agoLabel("2026-10-06T13:59:40Z", now)).toBe("just now")
        expect(agoLabel("2026-10-06T13:48:00Z", now)).toBe("12 min ago")
        expect(agoLabel("2026-10-06T11:50:00Z", now)).toBe("2 h 10 min ago")
        expect(agoLabel("2026-10-04T14:00:00Z", now)).toBe("2 d ago")
        expect(agoLabel("2026-10-06T11:50:00", now)).toBe("2 h 10 min ago")   // naive = UTC
    })
    it("pairs the clock time with it, and the date when older than a day", () => {
        expect(whenLabel("2026-10-06T11:50:00Z", now)).toBe("11:50Z · 2 h 10 min ago")
        expect(whenLabel("2026-10-04T09:10:00Z", now)).toBe("4 Oct 2026, 09:10Z · 2 d ago")
    })
})
