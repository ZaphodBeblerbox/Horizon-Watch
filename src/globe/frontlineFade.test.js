import { describe, it, expect } from "vitest"
import { clamp01, ease, crossfade, progress, FADE_MS } from "./frontlineFade.js"

describe("clamp01", () => {
    it("holds the ends", () => {
        expect(clamp01(-3)).toBe(0)
        expect(clamp01(4)).toBe(1)
        expect(clamp01(0.5)).toBe(0.5)
    })
    it("treats nonsense as the start, never NaN", () => {
        for (const v of [NaN, undefined, null, "x", {}]) expect(clamp01(v)).toBe(0)
    })
})

describe("ease", () => {
    it("starts at 0 and ends at 1", () => {
        expect(ease(0)).toBe(0)
        expect(ease(1)).toBe(1)
    })
    it("is symmetric about the middle", () => {
        expect(ease(0.5)).toBeCloseTo(0.5, 6)
        expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 6)
    })
})

describe("crossfade", () => {
    it("shows only the old snapshot at the start and only the new at the end", () => {
        expect(crossfade(0)).toEqual({ outgoing: 1, incoming: 0 })
        const end = crossfade(1)
        expect(end.outgoing).toBe(0)
        expect(end.incoming).toBe(1)
    })

    it("never blanks the map mid-fade", () => {
        // Some real geometry must be visible at every point, or the
        // scrub flashes an empty country between dates.
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const { outgoing, incoming } = crossfade(t)
            expect(Math.max(outgoing, incoming)).toBeGreaterThan(0.3)
        }
    })

    it("keeps combined cover roughly constant so the overlap does not pulse", () => {
        // Translucent areas overlap; a linear pair darkens in the middle
        // of every transition and reads as a change in the data.
        for (let t = 0; t <= 1.0001; t += 0.1) {
            const { outgoing, incoming } = crossfade(t)
            const combined = outgoing * outgoing + incoming * incoming
            expect(combined).toBeCloseTo(1, 6)
        }
    })

    it("is monotonic in both directions", () => {
        let prevIn = -1, prevOut = 2
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const { outgoing, incoming } = crossfade(t)
            expect(incoming).toBeGreaterThanOrEqual(prevIn)
            expect(outgoing).toBeLessThanOrEqual(prevOut)
            prevIn = incoming; prevOut = outgoing
        }
    })
})

describe("progress", () => {
    it("runs 0 to 1 across the duration", () => {
        expect(progress(1000, 1000)).toBe(0)
        expect(progress(1000 + FADE_MS / 2, 1000)).toBeCloseTo(0.5, 6)
        expect(progress(1000 + FADE_MS, 1000)).toBe(1)
    })
    it("completes instantly rather than dividing by zero", () => {
        expect(progress(5, 0, 0)).toBe(1)
        expect(progress(5, 0, NaN)).toBe(1)
    })
})
