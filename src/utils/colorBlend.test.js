import { describe, it, expect } from "vitest"
import { blendColor, isParseableColor } from "./colorBlend.js"

describe("blendColor", () => {
    it("returns the start color exactly at t=0 and end color exactly at t=1", () => {
        expect(blendColor("#171b20", "#f5f0e6", 0)).toBe("rgb(23, 27, 32)")
        expect(blendColor("#171b20", "#f5f0e6", 1)).toBe("rgb(245, 240, 230)")
    })
    it("linearly interpolates the midpoint between two real hex tokens", () => {
        expect(blendColor("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)")
    })
    it("blends rgba alpha channels too", () => {
        const out = blendColor("rgba(0,0,0,0)", "rgba(0,0,0,1)", 0.5)
        expect(out).toMatch(/rgba\(0, 0, 0, 0\.5\d*\)/)
    })
    it("falls back to a safe instant swap for a non-color value instead of producing garbage", () => {
        const shadow = "0 10px 26px rgba(0,0,0,.42)"
        expect(blendColor(shadow, shadow, 0.9)).toBe(shadow)
    })
})

describe("isParseableColor", () => {
    it("accepts hex and rgb/rgba", () => {
        expect(isParseableColor("#171b20")).toBe(true)
        expect(isParseableColor("#fff")).toBe(true)
        expect(isParseableColor("rgba(1,2,3,.5)")).toBe(true)
    })
    it("rejects a multi-value shorthand", () => {
        expect(isParseableColor("0 10px 26px rgba(0,0,0,.42)")).toBe(false)
    })
})
