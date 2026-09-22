import { describe, it, expect } from "vitest"
import { tintAlpha, tintBackground, MAX_ALPHA, MIN_ALPHA, FADE_END_MS } from "./criticalTint.js"

const NOW = 1_700_000_000_000

describe("critical tint", () => {
    it("tints a fresh critical hardest", () => {
        expect(tintAlpha(0, NOW - 60_000, NOW)).toBe(MAX_ALPHA)
    })

    it("never lets high outshout critical", () => {
        expect(tintAlpha(1, NOW - 60_000, NOW)).toBeLessThan(tintAlpha(0, NOW - 60_000, NOW))
    })

    it("fades with age but never to nothing", () => {
        const fresh = tintAlpha(0, NOW - 60_000, NOW)
        const old = tintAlpha(0, NOW - FADE_END_MS * 2, NOW)
        expect(old).toBeLessThan(fresh)
        expect(old).toBe(MIN_ALPHA)
        expect(old).toBeGreaterThan(0)
    })

    it("decays monotonically", () => {
        let prev = Infinity
        for (const h of [0, 1, 2, 4, 8, 12, 24]) {
            const a = tintAlpha(0, NOW - h * 3600_000, NOW)
            expect(a).toBeLessThanOrEqual(prev)
            prev = a
        }
    })

    it("leaves moderate and below alone entirely", () => {
        for (const rank of [2, 3, 4]) {
            expect(tintAlpha(rank, NOW, NOW)).toBe(0)
            expect(tintBackground(rank, NOW, NOW)).toBeUndefined()
        }
    })

    it("does not shout when the age is unknown", () => {
        const a = tintAlpha(0, null, NOW)
        expect(a).toBeGreaterThan(0)
        expect(a).toBeLessThan(MAX_ALPHA)
    })

    it("returns undefined rather than a background of none", () => {
        // React must leave the stylesheet's own background in place.
        expect(tintBackground(9, NOW, NOW)).toBeUndefined()
        expect(tintBackground(0, NOW, NOW)).toContain("linear-gradient")
    })
})
