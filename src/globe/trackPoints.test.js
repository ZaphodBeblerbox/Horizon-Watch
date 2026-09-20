import { describe, it, expect } from "vitest"
import { Cartesian3 } from "cesium"
import { usablePoints, vertexHeight, drawable, safeDegreesArray } from "./trackPoints.js"

describe("usablePoints", () => {
    it("keeps a clean track intact", () => {
        const pts = [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]
        expect(usablePoints(pts)).toHaveLength(2)
    })

    it("drops the point that kills the render loop", () => {
        // A single null coordinate becomes a NaN cartesian, and the
        // first ground clamp throws inside the render loop, which stops
        // Cesium rendering entirely.
        const pts = [{ lat: 1, lon: 2 }, { lat: null, lon: 4 }, { lat: 5, lon: undefined }, { lat: 6, lon: 7 }]
        expect(usablePoints(pts)).toHaveLength(2)
    })

    it("produces coordinates Cesium will actually accept", () => {
        const dirty = [{ lat: 1, lon: 2 }, { lat: "x", lon: 4 }, { lat: 3, lon: "5" }]
        const flat = usablePoints(dirty).flatMap(p => [p.lon, p.lat])
        expect(() => Cartesian3.fromDegreesArray(flat)).not.toThrow()
        for (const c of Cartesian3.fromDegreesArray(flat)) {
            expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true)
        }
    })

    it("does not place a missing coordinate at Null Island", () => {
        expect(usablePoints([{ lat: null, lon: null }])).toHaveLength(0)
        expect(usablePoints([{ lat: 0, lon: 0 }])).toHaveLength(1)
    })

    it("accepts lng as well as lon", () => {
        expect(usablePoints([{ lat: 1, lng: 2 }])[0].lon).toBe(2)
    })

    it("rejects coordinates off the globe", () => {
        expect(usablePoints([{ lat: 91, lon: 0 }, { lat: 0, lon: 999 }])).toHaveLength(0)
    })
})

describe("vertexHeight", () => {
    it("converts feet to metres", () => {
        expect(vertexHeight(1000)).toBeCloseTo(304.8, 3)
    })
    it("never returns NaN, including for the string \"ground\"", () => {
        for (const v of ["ground", null, undefined, NaN, "", {}, -5])
            expect(vertexHeight(v)).toBe(0)
    })
})

describe("drawable", () => {
    it("needs two usable points", () => {
        expect(drawable([{ lat: 1, lon: 2 }, { lat: null, lon: 3 }])).toBe(false)
        expect(drawable([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }])).toBe(true)
    })
})

describe("safeDegreesArray", () => {
    it("flattens a good pair of points", () => {
        expect(safeDegreesArray([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4])
    })

    it("refuses the whole line when either end is unknown", () => {
        // A connector from a known place to an unknown one is not a
        // shorter line, it is not a line.
        expect(safeDegreesArray([[1, 2], [null, 4]])).toBeNull()
        expect(safeDegreesArray([[undefined, 2], [3, 4]])).toBeNull()
        expect(safeDegreesArray([[1, 2], [3, NaN]])).toBeNull()
    })

    it("refuses a line with fewer than two points", () => {
        expect(safeDegreesArray([[1, 2]])).toBeNull()
        expect(safeDegreesArray([])).toBeNull()
    })
})
