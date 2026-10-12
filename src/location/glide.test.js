import { describe, it, expect } from "vitest"
import { between, createGlide, freshness, metresBetween, JUMP_M, MAX_GLIDE_MS } from "./glide.js"

function frames() {
    let t = 0
    const q = []
    return {
        now: () => t,
        raf: (f) => { q.push(f); return q.length },
        caf: () => {},
        advance(ms) { t += ms; const fs = q.splice(0); fs.forEach((f) => f(t)) },
    }
}

describe("a marker glides between positions", () => {
    it("between: the ends, and the short way across the antimeridian", () => {
        const a = { lat: 0, lon: 0 }, b = { lat: 1, lon: 1 }
        expect(between(a, b, 0)).toEqual(a)
        expect(between(a, b, 1)).toEqual(b)
        const m = between(a, b, 0.5)
        expect(m.lat).toBeGreaterThan(0.5)                 // eased: most of the way early, a gentle arrival
        expect(m.lat).toBeLessThan(1)
        const w = between({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }, 1)
        expect(w.lon).toBeCloseTo(-179.9, 6)
        const half = between({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }, 0.2)
        expect(Math.abs(half.lon)).toBeGreaterThan(179.9)   // through 180, not across the globe
    })

    it("glides over about the time between fixes, never teleporting", () => {
        const f = frames()
        const drawn = []
        const g = createGlide({ onFrame: (p) => drawn.push(p), now: f.now, raf: f.raf, caf: f.caf })
        g.set({ lat: 48.85, lon: 2.35 })
        expect(drawn).toHaveLength(1)                       // the first is drawn where it is
        f.advance(3000)
        g.set({ lat: 48.851, lon: 2.35 }, 3000)            // 111 m, 3 s later
        f.advance(16)
        const p1 = g.position()
        expect(p1.lat).toBeGreaterThan(48.85)
        expect(p1.lat).toBeLessThan(48.851)
        // no frame jumps more than a fraction of the way
        let prev = p1
        for (let i = 0; i < 400 && g.moving(); i++) {
            f.advance(16)
            expect(metresBetween(prev, g.position())).toBeLessThan(20)
            prev = g.position()
        }
        expect(g.position()).toEqual({ lat: 48.851, lon: 2.35 })
        expect(g.moving()).toBe(false)
    })

    it("a new fix mid-glide starts from where it is drawn, not from the old target", () => {
        const f = frames()
        const g = createGlide({ now: f.now, raf: f.raf, caf: f.caf })
        g.set({ lat: 0, lon: 0 })
        g.set({ lat: 0.001, lon: 0 }, 2000)
        f.advance(500); f.advance(16)
        const mid = g.position()
        g.set({ lat: 0.002, lon: 0 }, 2000)
        f.advance(16)
        expect(g.position().lat).toBeGreaterThanOrEqual(mid.lat)
        expect(g.position().lat).toBeLessThan(0.002)
    })

    it("a jump of more than 5 km is drawn at once (no journey that never happened)", () => {
        const f = frames()
        const g = createGlide({ now: f.now, raf: f.raf, caf: f.caf })
        g.set({ lat: 47.37, lon: 8.55 })                   // a city-level fix
        g.set({ lat: 48.85, lon: 2.35 }, 3000)             // then GPS, far away
        expect(g.position()).toEqual({ lat: 48.85, lon: 2.35 })
        expect(JUMP_M).toBe(5000)
        expect(MAX_GLIDE_MS).toBe(3000)
    })
})

describe("freshness, in words", () => {
    const t = 1_000_000_000
    it("live while positions come, last seen after", () => {
        expect(freshness(t - 3_000, t)).toMatchObject({ live: true, label: "live · 3 s ago" })
        expect(freshness(t - 75_000, t)).toMatchObject({ live: true, label: "live · 1 min ago" })
        expect(freshness(t - 4 * 60_000, t)).toMatchObject({ live: false, label: "last seen 4 min ago" })
        expect(freshness(t - (2 * 3600 + 5 * 60) * 1000, t).label).toBe("last seen 2 h 5 min ago")
        expect(freshness(NaN, t).label).toBe("no position yet")
        expect(freshness(t + 2_000, t).label).toBe("live · 0 s ago")       // a clock a little ahead is not "in the future"
    })
})
