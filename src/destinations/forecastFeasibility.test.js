/**
 * The physical constraints, tested against the real country polygons the
 * app ships — not a fixture, because the question "is this point at sea"
 * is only interesting when the coastline is the real one.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    isLand, nearestAirfield, checkUnit, kmBetween, AIRFIELD_KM,
} from "./forecastFeasibility.js"

const WORLD = JSON.parse(readFileSync("public/data/world-countries.json", "utf8")).features

// A handful of real airfields, in the shape the component passes.
const FIELDS = [
    { name: "Kursk East", lat: 51.7506, lon: 36.2956 },
    { name: "Belgorod Intl", lat: 50.6438, lon: 36.5901 },
    { name: "Krymsk Air Base", lat: 44.9603, lon: 38.0017 },
]

describe("movement feasibility", () => {
    it("knows land from sea on the real coastline", () => {
        expect(isLand(31.0, 49.5, WORLD)).toBe(true)     // central Ukraine
        expect(isLand(31.0, 33.5, WORLD)).toBe(false)    // eastern Mediterranean
        expect(isLand(-30.0, 40.0, WORLD)).toBe(false)   // mid-Atlantic
        expect(isLand(37.6, 55.75, WORLD)).toBe(true)    // Moscow
    })

    it("treats a hole in a polygon as water, not land", () => {
        // GeoJSON puts holes after the outer ring. Ignoring them calls
        // inland seas and enclaves land.
        const donut = [{ geometry: { type: "Polygon", coordinates: [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],       // outer
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],           // hole
        ] } }]
        expect(isLand(1, 1, donut)).toBe(true)
        expect(isLand(5, 5, donut)).toBe(false)
    })

    it("returns null rather than guessing without polygons", () => {
        expect(isLand(0, 0, null)).toBeNull()
    })

    it("an air axis must start near a real airfield", () => {
        const ok = checkUnit(
            { domain: "air", aff: "hostile" },
            { from: [36.30, 51.75], to: [35.0, 50.4] },   // Kursk East
            WORLD, FIELDS)
        expect(ok.ok).toBe(true)
        expect(ok.reason).toContain("Kursk East")
    })

    it("refuses an air axis that originates from nowhere", () => {
        // Air units do not appear out of open country; asserting one
        // does is asserting a capability nobody has.
        const bad = checkUnit(
            { domain: "air" },
            { from: [20.0, 48.0], to: [30.0, 50.0] },
            WORLD, FIELDS)
        expect(bad.ok).toBe(false)
        expect(bad.status).toBe("impossible")
        expect(bad.reason).toContain("airfield")
    })

    it("refuses a naval unit striking inland", () => {
        // A naval symbol on a landlocked point is not aggressive, it is
        // impossible.
        const bad = checkUnit(
            { domain: "sea" },
            { from: [31.0, 44.0], to: [31.0, 49.5] },   // Black Sea -> inland UA
            WORLD, FIELDS)
        expect(bad.ok).toBe(false)
        expect(bad.status).toBe("impossible")
        expect(bad.reason).toMatch(/inland/)
    })

    it("refuses a naval unit that starts on land", () => {
        const bad = checkUnit({ domain: "sea" },
            { from: [31.0, 49.5], to: [31.0, 44.0] }, WORLD, FIELDS)
        expect(bad.status).toBe("impossible")
        expect(bad.reason).toContain("cannot originate on land")
    })

    it("allows a naval unit that stays at sea", () => {
        const ok = checkUnit({ domain: "sea" },
            { from: [31.0, 44.0], to: [32.5, 44.6] }, WORLD, FIELDS)
        expect(ok.ok).toBe(true)
    })

    it("refuses a ground axis across open water", () => {
        const bad = checkUnit({ domain: "ground" },
            { from: [31.0, 49.5], to: [31.0, 44.0] }, WORLD, FIELDS)
        expect(bad.status).toBe("impossible")
        expect(bad.reason).toContain("crossing")
    })

    it("says ground trafficability is UNKNOWN, never that it passed", () => {
        // There is no road network and no elevation model loaded. An
        // unknown that announces itself is a caveat; an unknown dressed
        // as a pass is a lie about the hardest part of the question.
        const g = checkUnit({ domain: "ground" },
            { from: [31.0, 49.5], to: [32.0, 49.8] }, WORLD, FIELDS)
        expect(g.status).toBe("unknown")
        expect(g.reason).toContain("road")
        expect(g.reason).toContain("armour")
    })

    it("measures distance in kilometres, roughly", () => {
        // Kursk to Belgorod is about 130km.
        const d = kmBetween([36.2956, 51.7506], [36.5901, 50.6438])
        expect(d).toBeGreaterThan(110)
        expect(d).toBeLessThan(150)
    })

    it("finds the nearest airfield and reports the distance", () => {
        const n = nearestAirfield(36.5, 50.7, FIELDS)
        expect(n.field.name).toBe("Belgorod Intl")
        expect(n.km).toBeLessThan(AIRFIELD_KM)
    })
})
