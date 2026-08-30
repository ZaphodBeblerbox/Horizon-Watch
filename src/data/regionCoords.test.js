import { describe, it, expect } from "vitest"
import { REGION_COORDS, coordsForRegion } from "./regionCoords.js"

describe("coordsForRegion", () => {
    it("resolves the first recognized region name in an explicit list", () => {
        const c = coordsForRegion(["Nonexistent Region", "Middle East"])
        expect(c).toEqual(REGION_COORDS["Middle East"])
    })

    it("falls back to a neutral world view for an unrecognized region", () => {
        expect(coordsForRegion(["Nonexistent Region"])).toEqual({ lat: 20, lon: 0, zoom: 2 })
    })

    it("falls back to a neutral world view for null/unscoped", () => {
        expect(coordsForRegion(null)).toEqual({ lat: 20, lon: 0, zoom: 2 })
        expect(coordsForRegion(undefined)).toEqual({ lat: 20, lon: 0, zoom: 2 })
    })

    it("falls back to a neutral world view for the literal string 'auto' (already-resolved region names are expected, not the raw literal)", () => {
        expect(coordsForRegion("auto")).toEqual({ lat: 20, lon: 0, zoom: 2 })
    })

    it("never fabricates a location for an empty explicit list", () => {
        expect(coordsForRegion([])).toEqual({ lat: 20, lon: 0, zoom: 2 })
    })
})
