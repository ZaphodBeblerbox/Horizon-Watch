import { describe, it, expect } from "vitest"
import { usablePasses, isSar, bboxAreaKm2, cornerCount, confidenceBand, detectionDiamond, fmtArea } from "./taskingMath.js"

describe("§12.1 — usable passes, not total passes", () => {
    it("applies the spec's cloud formula to optical", () => {
        // passes x (1 - min(.85, cloud/100 + .15))
        expect(usablePasses(100, 0, "sentinel2_optical")).toBe(85)
        expect(usablePasses(100, 20, "sentinel2_optical")).toBe(65)
        expect(usablePasses(100, 50, "sentinel2_optical")).toBe(35)
    })

    it("floors the loss at 85%, so a pass count never goes negative", () => {
        expect(usablePasses(100, 100, "sentinel2_optical")).toBe(15)
        expect(usablePasses(100, 999, "sentinel2_optical")).toBe(15)
    })

    it("leaves SAR untouched — radar sees through cloud", () => {
        expect(usablePasses(40, 90, "sentinel1_sar")).toBe(40)
        expect(isSar("sentinel1_sar")).toBe(true)
        expect(isSar("sentinel2_optical")).toBe(false)
    })

    it("returns 0 rather than NaN when there are no passes to estimate from", () => {
        expect(usablePasses(null, 20, "sentinel2_optical")).toBe(0)
        expect(usablePasses(undefined, 20, "sentinel1_sar")).toBe(0)
    })
})

describe("bboxAreaKm2", () => {
    it("narrows a degree of longitude with latitude", () => {
        const equator = bboxAreaKm2({ south: 0, north: 1, west: 0, east: 1 })
        const baltic = bboxAreaKm2({ south: 59, north: 60, west: 0, east: 1 })
        expect(baltic).toBeLessThan(equator * 0.55)
    })

    it("is 0 for a missing or malformed box, never NaN", () => {
        expect(bboxAreaKm2(null)).toBe(0)
        expect(bboxAreaKm2({ north: NaN, south: 0, east: 1, west: 0 })).toBe(0)
    })
})

describe("cornerCount", () => {
    it("counts a polygon's real vertices, and a box's four", () => {
        expect(cornerCount({ polygonVertices: [1, 2, 3, 4, 5] })).toBe(5)
        expect(cornerCount({ bounds: {} })).toBe(4)
        expect(cornerCount(null)).toBe(0)
    })
})

describe("§12.2 — the confidence and change vocabulary", () => {
    it("bands confidence at 85 and 70, accepting either scale", () => {
        expect(confidenceBand(0.9)).toBe("good")
        expect(confidenceBand(90)).toBe("good")
        expect(confidenceBand(0.75)).toBe("plain")
        expect(confidenceBand(0.5)).toBe("weak")
    })

    it("colours new red, removed steel, everything else amber", () => {
        expect(detectionDiamond({ change_type: "new" })).toBe("var(--red)")
        expect(detectionDiamond({ change_type: "removed" })).toBe("var(--steel)")
        expect(detectionDiamond({})).toBe("var(--amber)")
    })
})

describe("fmtArea", () => {
    it("reads at every magnitude without a wall of digits", () => {
        expect(fmtArea(0)).toBe("—")
        expect(fmtArea(12.34)).toBe("12.3")
        expect(fmtArea(540)).toBe("540")
        expect(fmtArea(25_000)).toBe("25k")
    })
})
