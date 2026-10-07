import { describe, it, expect } from "vitest"
import { createMotion, angleDiff, AIRCRAFT, VESSEL } from "./smoothMotion.js"

const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111_000, (a.lon - b.lon) * 111_000 * Math.cos((a.lat * Math.PI) / 180))

describe("smooth motion", () => {
    it("continues along the track at the reported speed", () => {
        const m = createMotion(AIRCRAFT)
        m.update("a", { lat: 50, lon: 5, track: 90, gs: 400, alt: 10000, ts: 0 }, 0)
        const p = m.get("a", 10_000)                     // 10 s at 400 kt ≈ 2058 m east
        expect(p.lat).toBeCloseTo(50, 3)
        expect(dist(p, { lat: 50, lon: 5 })).toBeGreaterThan(2000)
        expect(dist(p, { lat: 50, lon: 5 })).toBeLessThan(2100)
    })

    it("never jumps when a late report lands behind where it was drawn", () => {
        const m = createMotion(AIRCRAFT)
        m.update("a", { lat: 50, lon: 5, track: 90, gs: 400, ts: 0 }, 0)
        const before = m.get("a", 10_000)
        // the next report is 3 s old: on the track, but behind the drawn position
        m.update("a", { lat: 50, lon: 5.0233, track: 90, gs: 400, ts: 10_000 }, 10_000)
        const after = m.get("a", 10_000)
        expect(dist(before, after)).toBeLessThan(1)       // no jump at the moment it lands
        // …and it converges onto the reported track within the blend
        const settled = m.get("a", 10_000 + AIRCRAFT.blendMs + 10)
        const onTrack = m.get("a", 10_000 + AIRCRAFT.blendMs + 10)
        expect(dist(settled, onTrack)).toBeLessThan(1)
    })

    it("moves forward every frame, never backwards, across a correction", () => {
        const m = createMotion(AIRCRAFT)
        m.update("a", { lat: 0, lon: 0, track: 90, gs: 300, ts: 0 }, 0)
        m.update("a", { lat: 0, lon: 0.012, track: 90, gs: 300, ts: 9000 }, 10_000)
        let last = m.get("a", 10_000).lon
        for (let t = 10_050; t < 16_000; t += 50) {
            const lon = m.get("a", t).lon
            expect(lon).toBeGreaterThanOrEqual(last - 1e-9)
            last = lon
        }
    })

    it("holds where the reckoning reached after the coast cap, rather than snapping back", () => {
        const m = createMotion(VESSEL)
        m.update("v", { lat: 10, lon: 10, track: 0, gs: 12, ts: 0 }, 0)
        const atCap = m.get("v", VESSEL.maxCoastS * 1000)
        const later = m.get("v", VESSEL.maxCoastS * 1000 * 3)
        expect(dist(atCap, later)).toBeLessThan(0.01)
        expect(atCap.lat).toBeGreaterThan(10)
    })

    it("a stationary contact stays put; a far-off report is taken as is", () => {
        const m = createMotion(VESSEL)
        m.update("v", { lat: 10, lon: 10, track: 0, gs: 0.1, ts: 0 }, 0)
        expect(m.get("v", 60_000)).toMatchObject({ lat: 10, lon: 10 })
        m.update("v", { lat: 11, lon: 10, track: 0, gs: 0, ts: 60_000 }, 60_000)   // 111 km away: no blending
        expect(m.get("v", 60_000).lat).toBe(11)
    })

    it("turns the short way round", () => {
        expect(angleDiff(350, 10)).toBe(-20)
        expect(angleDiff(10, 350)).toBe(20)
        const m = createMotion(AIRCRAFT)
        m.update("a", { lat: 0, lon: 0, track: 350, gs: 300, ts: 0 }, 0)
        m.update("a", { lat: 0.001, lon: 0, track: 10, gs: 300, ts: 1000 }, 1000)
        const mid = m.get("a", 1000 + AIRCRAFT.blendMs / 2).track
        expect(mid > 340 || mid < 20).toBe(true)
    })
})
