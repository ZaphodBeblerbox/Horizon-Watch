import { describe, it, expect } from "vitest"
import { sunPosition } from "../utils/solarPosition.js"
import { elevationFromShadow, sunWindows, bearing, headingFromFrame, compass, segAngle, angDiff, solarClock } from "./locateMath.js"

// Sanaa, 2026-10-06
const SANAA = { lat: 15.35, lon: 44.21 }
const day = Date.parse("2026-10-06T00:00:00Z")

describe("time from shadows", () => {
    it("reads the sun's elevation from an object and its shadow", () => {
        expect(elevationFromShadow({ x1: 0, y1: 0, x2: 0, y2: -100 }, { x1: 0, y1: 0, x2: 100, y2: 0 })).toBeCloseTo(45)
        expect(elevationFromShadow({ x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 0, y1: 0, x2: 1, y2: 0 })).toBeNull()
    })

    it("finds the morning and the afternoon time for one elevation, and the shadow's bearing picks one", () => {
        const truth = Date.parse("2026-10-06T05:30:00Z")                  // 08:30 in Sanaa
        const sp = sunPosition(SANAA.lat, SANAA.lon, new Date(truth))
        const both = sunWindows({ ...SANAA, fromMs: day, toMs: day + 86400_000, elevation: sp.elevation, tol: 1 })
        expect(both.length).toBe(2)
        expect(Math.abs(both[0].mid - truth)).toBeLessThan(10 * 60_000)
        const shadowBearing = (sp.azimuth + 180) % 360
        const one = sunWindows({ ...SANAA, fromMs: day, toMs: day + 86400_000, elevation: sp.elevation, tol: 1,
                                 azimuth: (shadowBearing + 180) % 360 })
        expect(one.length).toBe(1)
        expect(Math.abs(one[0].mid - truth)).toBeLessThan(10 * 60_000)
        expect(solarClock(one[0].mid, SANAA.lon)).toMatch(/^08:/)
    })

    it("finds nothing for an elevation the sun never reaches that day", () => {
        expect(sunWindows({ ...SANAA, fromMs: day, toMs: day + 86400_000, elevation: 89 })).toEqual([])
    })
})

describe("direction", () => {
    it("bearings and compass points", () => {
        expect(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0)
        expect(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90)
        expect(compass(22)).toBe("NNE")
        expect(compass(359)).toBe("N")
        expect(angDiff(350, 10)).toBe(20)
    })

    it("turns a frame motion into a heading through a shadow of known bearing", () => {
        // frame: shadow points right (90° from up), vehicle moves up (0°): motion is 90° left of the shadow
        const shadow = { x1: 0, y1: 0, x2: 10, y2: 0 }, motion = { x1: 0, y1: 0, x2: 0, y2: -10 }
        expect(segAngle(shadow)).toBeCloseTo(90)
        expect(headingFromFrame(motion, shadow, 300)).toBeCloseTo(210)   // shadow toward WNW → vehicle heading SSW
    })
})
