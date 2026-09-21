import { describe, it, expect } from "vitest"
import { Cartesian3, Math as CesiumMath } from "cesium"
import { safeCartesian, billboardRotation, vesselHeading, bearingBetween } from "./markerOrientation.js"

describe("safeCartesian", () => {
    it("builds a position from real coordinates", () => {
        expect(safeCartesian(8.5, 50.0)).toBeInstanceOf(Cartesian3)
    })

    it("does not put a missing coordinate at Null Island", () => {
        // Number(null), Number("") and Number([]) are all 0, so a row
        // with no longitude would draw a perfectly convincing marker
        // off the coast of Ghana.
        expect(safeCartesian(null, 50)).toBeNull()
        expect(safeCartesian("", 50)).toBeNull()
        expect(safeCartesian([], 50)).toBeNull()
        // A real zero is still a real place.
        expect(safeCartesian(0, 0)).toBeInstanceOf(Cartesian3)
    })

    it("returns null instead of throwing on junk", () => {
        // Cesium throws on every one of these, and a throw in render
        // unmounts the whole globe rather than dropping one marker.
        for (const [lon, lat] of [[null, 50], [undefined, 50], [NaN, 50],
                                  [8.5, null], ["", 50], [{}, 50], [[], "x"]]) {
            expect(safeCartesian(lon, lat)).toBeNull()
        }
    })

    it("accepts a numeric string, which Cesium itself rejects", () => {
        // isFinite("8.5") is true, so the old guard passed it straight
        // into Cesium, which throws on a string longitude.
        expect(() => Cartesian3.fromDegrees("8.5", 50, 0)).toThrow()
        expect(safeCartesian("8.5", "50")).toBeInstanceOf(Cartesian3)
    })

    it("rejects coordinates outside the globe", () => {
        expect(safeCartesian(200, 50)).toBeNull()
        expect(safeCartesian(8.5, 91)).toBeNull()
    })

    it("falls back to ground for an unusable height", () => {
        expect(safeCartesian(8.5, 50, "ground")).toBeInstanceOf(Cartesian3)
    })
})

describe("billboardRotation", () => {
    const deg = (r) => CesiumMath.toDegrees(r)

    it("points the nose along the bearing when north is up", () => {
        expect(deg(billboardRotation(90, 0))).toBeCloseTo(-90, 6)
    })

    it("keeps the bearing true when the camera is rotated", () => {
        // Camera looking east: a contact heading north must appear to
        // point left of screen, i.e. a quarter turn counter-clockwise.
        const r = billboardRotation(0, CesiumMath.toRadians(90))
        expect(deg(r)).toBeCloseTo(90, 6)
    })

    it("draws a contact heading the same way as the camera as pointing up", () => {
        expect(deg(billboardRotation(45, CesiumMath.toRadians(45)))).toBeCloseTo(0, 6)
    })

    it("never returns NaN", () => {
        for (const v of [null, undefined, NaN, "x", {}]) {
            expect(Number.isFinite(billboardRotation(v, 0))).toBe(true)
            expect(Number.isFinite(billboardRotation(90, v))).toBe(true)
        }
    })
})

describe("vesselHeading", () => {
    it("rejects the AIS not-available sentinel", () => {
        // 511 drawn literally points every unknown ship due east.
        expect(vesselHeading({ heading: 511 })).toBeNull()
        expect(vesselHeading({ heading: 511, cog: 120 })).toBe(120)
    })

    it("prefers true heading over course over ground", () => {
        expect(vesselHeading({ heading: 30, cog: 120 })).toBe(30)
    })

    it("returns null when there is nothing, rather than north", () => {
        // Number(null) and Number("") are 0, a valid heading, so these
        // vessels were all being drawn pointing due north.
        expect(vesselHeading({})).toBeNull()
        expect(vesselHeading(null)).toBeNull()
        expect(vesselHeading({ heading: null })).toBeNull()
        expect(vesselHeading({ heading: "" })).toBeNull()
        expect(vesselHeading({ heading: [] })).toBeNull()
        // A real zero is a real heading.
        expect(vesselHeading({ heading: 0 })).toBe(0)
    })
})

describe("bearingBetween", () => {
    it("reads due east and due north correctly", () => {
        expect(bearingBetween(0, 0, 0, 0.01)).toBeCloseTo(90, 1)
        expect(bearingBetween(0, 0, 0.01, 0)).toBeCloseTo(0, 1)
        expect(bearingBetween(0, 0, -0.01, 0)).toBeCloseTo(180, 1)
    })

    it("refuses to turn AIS jitter into a course", () => {
        // A moored vessel's position wobbles by metres. Treating that as
        // movement spins the hull on the spot.
        expect(bearingBetween(50.0, 8.0, 50.00005, 8.00005)).toBeNull()
        expect(bearingBetween(50.0, 8.0, 50.0, 8.0)).toBeNull()
    })

    it("accepts movement once it is unambiguous", () => {
        // ~200m east at this latitude.
        expect(bearingBetween(50.0, 8.0, 50.0, 8.0028)).toBeCloseTo(90, 0)
    })

    it("returns null on unusable coordinates rather than a direction", () => {
        expect(bearingBetween(null, 0, 1, 1)).toBeNull()
        expect(bearingBetween(0, 0, "x", 1)).toBeNull()
    })
})
