import { describe, expect, it } from "vitest"
import { whenOf } from "./GeneralFeed.jsx"

describe("GeneralFeed time", () => {
    it("shows a day-precision GeoConfirmed event as its date, never 'just now'", () => {
        const s = whenOf({ kind: "geoconfirmed", at: "2026-09-20T23:59:59", at_precision: "day" })
        expect(s).toMatch(/20/)
        expect(s).not.toMatch(/now|ago|min/)
    })
    it("keeps the relative age for a timed item", () => {
        const s = whenOf({ kind: "signal", at: new Date(Date.now() - 5 * 60_000).toISOString() })
        expect(s).toMatch(/5/)
    })
})
