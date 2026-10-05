import { describe, it, expect } from "vitest"
import { maxOf, minOf, extentOf } from "./extent.js"

describe("extent without spreading", () => {
    it("agrees with Math.min/max on ordinary input", () => {
        const v = [3, -1, 7, 0, 7]
        expect(maxOf(v)).toBe(7)
        expect(minOf(v)).toBe(-1)
        expect(extentOf(v)).toEqual({ min: -1, max: 7 })
    })

    /* THE REASON THIS EXISTS. Math.max(...v) passes one argument per
       element and throws RangeError past roughly 100k — which presented as
       an intermittent "Maximum call stack size exceeded" on whichever
       screen happened to be open. */
    it("handles an array that would overflow the call stack", () => {
        const v = new Array(500_000)
        for (let i = 0; i < v.length; i++) v[i] = i % 1000
        expect(() => Math.max(...v)).toThrow(RangeError)
        expect(maxOf(v)).toBe(999)
        expect(minOf(v)).toBe(0)
        expect(extentOf(v)).toEqual({ min: 0, max: 999 })
    })

    it("skips a non-finite entry instead of returning NaN", () => {
        // One NaN in a coordinate list used to make the whole bounding box
        // NaN, which draws nothing and reports no error.
        expect(extentOf([1, NaN, 5, undefined, null, 3])).toEqual({ min: 1, max: 5 })
        expect(maxOf([NaN, Infinity, 2])).toBe(2)
    })

    it("returns the fallback for an empty or absent list", () => {
        expect(maxOf([], -1)).toBe(-1)
        expect(minOf(undefined, 9)).toBe(9)
        expect(extentOf([NaN], 0)).toEqual({ min: 0, max: 0 })
    })
})
