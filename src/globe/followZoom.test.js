import { describe, it, expect } from "vitest"
import { nextRange, MIN_RANGE_M, MAX_RANGE_M, ZOOM_STEP } from "./followZoom.js"

describe("zooming a locked-on camera", () => {
    it("scrolling forward moves closer", () => {
        expect(nextRange(2000, 1)).toBeLessThan(2000)
    })

    it("scrolling back moves away", () => {
        expect(nextRange(2000, -1)).toBeGreaterThan(2000)
    })

    it("is multiplicative, so it feels the same at every distance", () => {
        // A fixed step that reads well at 1.5km is imperceptible at
        // 500km.
        expect(nextRange(2000, 1)).toBeCloseTo(2000 / ZOOM_STEP, 5)
        expect(nextRange(500000, 1)).toBeCloseTo(500000 / ZOOM_STEP, 5)
    })

    it("never goes inside the model", () => {
        let r = 400
        for (let i = 0; i < 50; i += 1) r = nextRange(r, 1)
        expect(r).toBe(MIN_RANGE_M)
    })

    it("releases rather than clamping when pulled far enough back", () => {
        // At that range the contact is a dot; continuing to pull is
        // somebody saying they are done following it.
        expect(nextRange(MAX_RANGE_M, -1)).toBeNull()
    })

    it("does not release just short of the limit", () => {
        const r = nextRange(MAX_RANGE_M / ZOOM_STEP / 2, -1)
        expect(r).not.toBeNull()
        expect(r).toBeLessThanOrEqual(MAX_RANGE_M)
    })

    it("recovers from a nonsense range instead of propagating NaN", () => {
        // A NaN range would be passed to HeadingPitchRange and throw
        // inside the render loop, which unmounts the globe.
        for (const bad of [NaN, 0, -5, null, undefined, "x"]) {
            expect(nextRange(bad, 1)).toBe(MIN_RANGE_M)
        }
    })

    it("every returned range is finite and positive", () => {
        let r = 5000
        for (let i = 0; i < 40; i += 1) {
            r = nextRange(r, i % 2 ? 1 : -1)
            if (r === null) break
            expect(Number.isFinite(r)).toBe(true)
            expect(r).toBeGreaterThan(0)
        }
    })
})
