import { describe, it, expect } from "vitest"
import { health, recent, watchProvider, WINDOW_MS, UNHEALTHY_ERRORS } from "./tileHealth.js"

const NOW = 1_700_000_000_000

describe("basemap tile health", () => {
    it("says nothing when nothing has failed", () => {
        expect(health("dark", [], { nowMs: NOW })).toBeNull()
    })

    it("forgets errors older than the window", () => {
        // A handful of failures while panning fast is normal and
        // self-correcting; a readout that remembers them forever cries
        // wolf and gets ignored.
        const old = [NOW - WINDOW_MS - 1, NOW - WINDOW_MS - 5000]
        expect(recent(old, NOW)).toEqual([])
        expect(health("dark", old, { nowMs: NOW })).toBeNull()
    })

    it("calls a provider unhealthy only once it keeps failing", () => {
        const few = Array.from({ length: 2 }, () => NOW - 1000)
        expect(health("dark", few, { nowMs: NOW }).state).toBe("flaky")
        const many = Array.from({ length: UNHEALTHY_ERRORS }, () => NOW - 1000)
        expect(health("dark", many, { nowMs: NOW }).state).toBe("error")
    })

    it("distinguishes being past a provider's deepest level from being broken", () => {
        // These were indistinguishable and are completely different
        // problems: the dark basemap publishes nothing below zoom 16,
        // which is not a fault.
        const errs = Array.from({ length: 20 }, () => NOW - 500)
        const h = health("dark", errs, { nowMs: NOW, level: 18, maxLevel: 16 })
        expect(h.state).toBe("depth")
        expect(h.text).toContain("upsampled")
    })

    it("still reports a real fault at a depth the provider does publish", () => {
        const errs = Array.from({ length: 20 }, () => NOW - 500)
        expect(health("dark", errs, { nowMs: NOW, level: 10, maxLevel: 16 }).state)
            .toBe("error")
    })

    it("names the provider, because there are five of them", () => {
        const errs = Array.from({ length: 10 }, () => NOW - 500)
        expect(health("openInfra", errs, { nowMs: NOW }).text).toContain("openInfra")
    })

    it("never throws on a provider with no errorEvent", () => {
        // Cesium's provider shapes differ by version, and a throw here
        // would take the basemap swap down with it.
        expect(typeof watchProvider(null, () => {})).toBe("function")
        expect(typeof watchProvider({}, () => {})).toBe("function")
        expect(() => watchProvider(undefined, () => {})()).not.toThrow()
    })

    it("subscribes and unsubscribes a real event", () => {
        let handler = null
        const provider = {
            errorEvent: {
                addEventListener: (h) => { handler = h },
                removeEventListener: () => { handler = null },
            },
        }
        let count = 0
        const off = watchProvider(provider, () => { count += 1 })
        handler()
        expect(count).toBe(1)
        off()
        expect(handler).toBeNull()
    })

    it("swallows a throwing callback rather than breaking the render", () => {
        let handler = null
        const provider = {
            errorEvent: { addEventListener: (h) => { handler = h }, removeEventListener: () => {} },
        }
        watchProvider(provider, () => { throw new Error("boom") })
        expect(() => handler()).not.toThrow()
    })
})
