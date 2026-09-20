import { describe, it, expect } from "vitest"
import { deadReckon, MAX_COAST_SECONDS } from "./deadReckon.js"

const base = (o = {}) => ({ lat: 50, lon: 8, track: 90, gs: 450, ts: 1_000_000, ...o })

describe("deadReckon", () => {
    it("advances along the track at ground speed", () => {
        // 450kt for 10s is about 2.3km; due east, so longitude only.
        const r = deadReckon(base(), 1_010_000)
        expect(r.lat).toBeCloseTo(50, 3)
        expect(r.lon).toBeGreaterThan(8)
        const km = (r.lon - 8) * 111.32 * Math.cos(50 * Math.PI / 180)
        expect(km).toBeGreaterThan(2.0)
        expect(km).toBeLessThan(2.6)
    })

    it("moves north for a northerly track", () => {
        const r = deadReckon(base({ track: 0 }), 1_010_000)
        expect(r.lat).toBeGreaterThan(50)
        expect(r.lon).toBeCloseTo(8, 6)
    })

    it("does not move an aircraft that is not moving", () => {
        // A parked aircraft must not drift across the apron.
        expect(deadReckon(base({ gs: 0 }), 1_060_000)).toEqual({ lat: 50, lon: 8 })
        expect(deadReckon(base({ gs: 3 }), 1_060_000)).toEqual({ lat: 50, lon: 8 })
    })

    it("stops coasting once the report is stale", () => {
        // Continuing from a minute-old report draws a guess in the same
        // style as a measurement.
        const r = deadReckon(base(), 1_000_000 + (MAX_COAST_SECONDS + 5) * 1000)
        expect(r).toEqual({ lat: 50, lon: 8 })
    })

    it("does not extrapolate backwards or on a stale clock", () => {
        expect(deadReckon(base(), 999_000)).toEqual({ lat: 50, lon: 8 })
    })

    it("returns null when there is no usable fix", () => {
        expect(deadReckon(null, 1)).toBeNull()
        expect(deadReckon({ lat: null, lon: 8 }, 1)).toBeNull()
        expect(deadReckon({ lat: "x", lon: "y" }, 1)).toBeNull()
    })

    it("survives missing speed, track or timestamp", () => {
        for (const k of ["gs", "track", "ts"]) {
            const b = base(); delete b[k]
            const r = deadReckon(b, 1_010_000)
            expect(Number.isFinite(r.lat) && Number.isFinite(r.lon)).toBe(true)
        }
    })

    it("wraps longitude across the antimeridian", () => {
        // Crossing 180 must not produce 180.4, which is off the globe
        // and throws in Cesium.
        const r = deadReckon({ lat: 0, lon: 179.99, track: 90, gs: 600, ts: 0 }, 20_000)
        expect(r.lon).toBeGreaterThanOrEqual(-180)
        expect(r.lon).toBeLessThanOrEqual(180)
        expect(r.lon).toBeLessThan(0)
    })
})
