import { describe, it, expect } from "vitest"
import { pickNiceScale, scaleBarWidthPx, NICE_SCALE_KM, pickNiceScaleMetres, scaleBarWidthPxMetres, formatScale } from "./scaleBarMath.js"

describe("pickNiceScale — realistic metersPerPixel inputs", () => {
    it("floors to the smallest defined nice value when very zoomed in (sub-km per 100px)", () => {
        // 1 m/pixel over a 100px sample = 100m covered — smaller than the
        // smallest defined nice value (1km), so it floors to 1.
        expect(pickNiceScale(1, 100)).toBe(1)
    })

    it("picks a small round value for a city-scale view", () => {
        // 50 m/pixel over 100px = 5000m = 5km covered -> largest nice <= 5 is 5
        expect(pickNiceScale(50, 100)).toBe(5)
    })

    it("picks a mid-range round value for a metro-scale view", () => {
        // 200 m/pixel over 100px = 20,000m = 20km covered -> 20
        expect(pickNiceScale(200, 100)).toBe(20)
    })

    it("picks a large round value for a regional-scale view", () => {
        // 1000 m/pixel over 100px = 100,000m = 100km covered -> 100
        expect(pickNiceScale(1000, 100)).toBe(100)
    })

    it("picks a very large round value for a continental-scale view", () => {
        // 20,000 m/pixel over 100px = 2,000,000m = 2000km covered -> 2000
        expect(pickNiceScale(20_000, 100)).toBe(2000)
    })

    it("caps at the largest defined nice value for a whole-globe/space view", () => {
        // 600,000 m/pixel over 100px = 60,000km covered, past the largest
        // defined value (50,000km) — caps rather than returning undefined.
        expect(pickNiceScale(600_000, 100)).toBe(NICE_SCALE_KM[NICE_SCALE_KM.length - 1])
    })

    it("monotonically increases as the camera zooms out (larger metersPerPixel)", () => {
        const zoomedIn  = pickNiceScale(2, 100)
        const midZoom   = pickNiceScale(200, 100)
        const zoomedOut = pickNiceScale(20_000, 100)
        expect(zoomedIn).toBeLessThan(midZoom)
        expect(midZoom).toBeLessThan(zoomedOut)
    })

    it("always returns a value from the defined nice-scale set across a zoom range", () => {
        for (const mpp of [0.5, 2, 10, 100, 2000, 50_000, 1_000_000]) {
            expect(NICE_SCALE_KM).toContain(pickNiceScale(mpp, 100))
        }
    })

    it("returns null for invalid metersPerPixel (e.g. camera looking at horizon/space, no ellipsoid hit)", () => {
        expect(pickNiceScale(0, 100)).toBeNull()
        expect(pickNiceScale(-5, 100)).toBeNull()
        expect(pickNiceScale(NaN, 100)).toBeNull()
        expect(pickNiceScale(Infinity, 100)).toBeNull()
    })

    it("returns null for an invalid targetPixelWidth", () => {
        expect(pickNiceScale(50, 0)).toBeNull()
        expect(pickNiceScale(50, -100)).toBeNull()
    })
})

describe("scaleBarWidthPx", () => {
    it("computes the on-screen pixel width for a given km value and metersPerPixel", () => {
        expect(scaleBarWidthPx(5, 50)).toBe(100) // 5km = 5000m / 50 m-per-px = 100px
        expect(scaleBarWidthPx(100, 1000)).toBe(100) // 100km = 100,000m / 1000 m-per-px = 100px
    })

    it("returns 0 for invalid input rather than NaN/Infinity", () => {
        expect(scaleBarWidthPx(5, 0)).toBe(0)
        expect(scaleBarWidthPx(NaN, 50)).toBe(0)
        expect(scaleBarWidthPx(5, -50)).toBe(0)
    })
})

describe("scale below a kilometre", () => {
    it("keeps going down instead of sticking at 1 km", () => {
        // The reported bug: zooming in past 1 km left the readout at
        // "1 km" forever, which is the wrong number rather than a
        // rounded one — and it is wrong exactly where the imagery is
        // most detailed.
        expect(pickNiceScaleMetres(0.5, 100)).toBe(50)
        expect(pickNiceScaleMetres(0.05, 100)).toBe(5)
        expect(pickNiceScaleMetres(0.005, 100)).toBe(1)
    })

    it("bottoms out at one metre, not at zero", () => {
        expect(pickNiceScaleMetres(0.0000001, 100)).toBe(1)
    })

    it("still picks the same values as before above a kilometre", () => {
        for (const km of [1, 5, 100, 5000]) {
            const mpp = (km * 1000) / 100
            expect(pickNiceScaleMetres(mpp, 100)).toBe(km * 1000)
        }
    })

    it("labels metres as metres and never as a fraction of a kilometre", () => {
        expect(formatScale(500)).toBe("500 m")
        expect(formatScale(1)).toBe("1 m")
        expect(formatScale(1000)).toBe("1 km")
        expect(formatScale(20000)).toBe("20 km")
        expect(formatScale(0)).toBe("")
    })

    it("returns null for a camera looking at space", () => {
        expect(pickNiceScaleMetres(0, 100)).toBe(null)
        expect(pickNiceScaleMetres(NaN, 100)).toBe(null)
    })

    it("width in pixels is the distance over the scale", () => {
        expect(scaleBarWidthPxMetres(500, 5)).toBe(100)
        expect(scaleBarWidthPxMetres(500, 0)).toBe(0)
    })
})
