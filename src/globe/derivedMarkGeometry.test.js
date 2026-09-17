import { describe, it, expect } from "vitest"
import {
    tickBearings, offset, pulseAlpha, overflowCount, agoStr,
    SURGE_HALO_M, FUSION_RING_M, FUSION_OUTER_M,
} from "./derivedMarkGeometry.js"

describe("§A8 — one radial tick per modality", () => {
    it("spaces the ticks evenly from due north", () => {
        expect(tickBearings(2)).toEqual([0, 180])
        expect(tickBearings(3)).toEqual([0, 120, 240])
        expect(tickBearings(4)).toEqual([0, 90, 180, 270])
    })

    it("is a pure function of the modality count — the tick count IS the finding", () => {
        expect(tickBearings(5)).toHaveLength(5)
        expect(tickBearings(0)).toEqual([])
        expect(tickBearings(null)).toEqual([])
    })
})

describe("offset — where a tick ends", () => {
    it("moves north for bearing 0 and east for bearing 90", () => {
        const n = offset(0, 0, 0, 100_000)
        expect(n.lat).toBeGreaterThan(0)
        expect(Math.abs(n.lon)).toBeLessThan(0.001)
        const e = offset(0, 0, 90, 100_000)
        expect(e.lon).toBeGreaterThan(0)
        expect(Math.abs(e.lat)).toBeLessThan(0.001)
    })

    it("wraps longitude across the antimeridian rather than returning 190°", () => {
        const p = offset(0, 179.9, 90, 100_000)
        expect(p.lon).toBeGreaterThanOrEqual(-180)
        expect(p.lon).toBeLessThanOrEqual(180)
    })
})

describe("§A8 — the marks sit inside a cell", () => {
    it("keeps every radius well under the 2.5° cell they describe", () => {
        // ~278 km across at the equator; a mark wider than its own cell would
        // overlap the neighbour it is being distinguished from.
        for (const r of [SURGE_HALO_M, FUSION_RING_M, FUSION_OUTER_M]) {
            expect(r).toBeLessThan(139_000)
        }
    })
})

describe("pulseAlpha", () => {
    it("stays within its bounds across a whole period", () => {
        for (let t = 0; t < 3400; t += 97) {
            const a = pulseAlpha(t, 3400, 0.45, 0.9)
            expect(a).toBeGreaterThanOrEqual(0.45 - 1e-9)
            expect(a).toBeLessThanOrEqual(0.9 + 1e-9)
        }
    })
})

describe("§A9 — the overflow and the age", () => {
    it("says how many it could not show, never a negative", () => {
        expect(overflowCount(9, 4)).toBe(5)
        expect(overflowCount(3, 4)).toBe(0)
        expect(overflowCount(undefined, 4)).toBe(0)
    })

    it("reads minutes, hours then days", () => {
        const now = 1_700_000_000_000
        expect(agoStr(now / 1000 - 600, now)).toBe("10m")
        expect(agoStr(now / 1000 - 7200, now)).toBe("2h")
        expect(agoStr(now / 1000 - 86400 * 3, now)).toBe("3d")
    })
})
