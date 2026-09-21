import { describe, it, expect } from "vitest"
import { familyFor, modelUrl, modelHeadingRadians, FAMILIES } from "./vesselModels.js"

describe("familyFor", () => {
    it("maps the types the feed actually carries", () => {
        expect(familyFor({ ship_type: "cargo" })).toBe("cargo")
        expect(familyFor({ ship_type: "tanker" })).toBe("tanker")
        expect(familyFor({ ship_type: "passenger" })).toBe("passenger")
        expect(familyFor({ ship_type: "military" })).toBe("military")
    })

    it("gives an untyped vessel the generic hull, not a guess", () => {
        // 34% of a live sample report "other" and another 34% report
        // nothing at all.
        expect(familyFor({ ship_type: "other" })).toBe("other")
        expect(familyFor({ ship_type: null })).toBe("other")
        expect(familyFor({})).toBe("other")
    })

    it("only ever names a family that has a model", () => {
        for (const v of [{ ship_type: "cargo" }, { ship_type: "zzz" }, {}])
            expect(FAMILIES).toContain(familyFor(v))
    })

    it("has nothing to draw for no vessel at all", () => {
        expect(familyFor(null)).toBeNull()
    })
})

describe("modelHeadingRadians", () => {
    const deg = (r) => (r * 180) / Math.PI

    it("applies the same measured offset as the aircraft", () => {
        expect(deg(modelHeadingRadians({ heading: 0 }))).toBeCloseTo(270, 9)
        expect(deg(modelHeadingRadians({ heading: 90 }))).toBeCloseTo(360, 9)
    })

    it("refuses to point a hull that has not reported a heading", () => {
        // A glyph pointing nowhere is honest; a ship pointing north is
        // not. 511 is the AIS "not available" sentinel.
        expect(modelHeadingRadians({ heading: 511 })).toBeNull()
        expect(modelHeadingRadians({})).toBeNull()
        expect(modelHeadingRadians({ heading: null })).toBeNull()
    })
})

describe("modelUrl", () => {
    it("points at a generated hull", () => {
        expect(modelUrl("tanker")).toMatch(/^\/models\/vessel\/tanker\.glb\?v=\d+$/)
    })
    it("refuses a family that does not exist", () => {
        expect(modelUrl("submarine")).toBeNull()
    })
})
