import { describe, it, expect } from "vitest"
import { nextRange, pitchForRange, MIN_RANGE_M, MAX_RANGE_M, ZOOM_STEP } from "./followZoom.js"

describe("zooming a locked-on camera", () => {
    it("scrolling forward moves closer", () => {
        expect(nextRange(2000, 120)).toBeLessThan(2000)
    })

    it("scrolling back moves away", () => {
        expect(nextRange(2000, -120)).toBeGreaterThan(2000)
    })

    it("is multiplicative, so it feels the same at every distance", () => {
        // A fixed step that reads well at 1.5km is imperceptible at
        // 500km.
        expect(nextRange(2000, 120)).toBeCloseTo(2000 / ZOOM_STEP, 5)
        expect(nextRange(50000, 120)).toBeCloseTo(50000 / ZOOM_STEP, 5)
    })

    it("never goes inside the model", () => {
        let r = 400
        for (let i = 0; i < 50; i += 1) r = nextRange(r, 120)
        expect(r).toBe(MIN_RANGE_M)
    })

    it("releases rather than clamping when pulled far enough back", () => {
        // At that range the contact is a dot; continuing to pull is
        // somebody saying they are done following it.
        expect(nextRange(MAX_RANGE_M, -120)).toBeNull()
    })

    it("does not release just short of the limit", () => {
        const r = nextRange(MAX_RANGE_M / ZOOM_STEP / 2, -120)
        expect(r).not.toBeNull()
        expect(r).toBeLessThanOrEqual(MAX_RANGE_M)
    })

    it("recovers from a nonsense range instead of propagating NaN", () => {
        // A NaN range would be passed to HeadingPitchRange and throw
        // inside the render loop, which unmounts the globe.
        for (const bad of [NaN, 0, -5, null, undefined, "x"]) {
            expect(nextRange(bad, 120)).toBe(MIN_RANGE_M)
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

describe("zooming out while locked keeps the earth in view", () => {
    it("a trackpad's small deltas step a little, a notch steps once", () => {
        expect(nextRange(2000, -120)).toBeCloseTo(2000 * ZOOM_STEP, 5)
        const small = nextRange(2000, -4)
        expect(small).toBeGreaterThan(2000)
        expect(small).toBeLessThan(2000 * 1.02)
    })
    it("fifty trackpad events do not throw the camera to the edge of space", () => {
        let r = 1500
        for (let i = 0; i < 50; i++) r = nextRange(r, -6) ?? r
        expect(r).toBeLessThan(10_000)
    })
    it("the view turns toward straight down as it pulls back", () => {
        const chosen = -25 * Math.PI / 180
        expect(pitchForRange(chosen, 1500)).toBeCloseTo(chosen, 5)
        expect(pitchForRange(chosen, MAX_RANGE_M)).toBeLessThan(-80 * Math.PI / 180)
    })
})
