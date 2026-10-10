import { describe, it, expect } from "vitest"
import { shouldSend } from "./liveShare.js"

describe("live sharing", () => {
    it("sends the first fix, a move of 100 m, or a minute's silence — not every jitter", () => {
        const t = 1_000_000
        expect(shouldSend(null, { lat: 48.85, lon: 2.35 }, t)).toBe(true)
        const prev = { lat: 48.85, lon: 2.35, at: t }
        expect(shouldSend(prev, { lat: 48.8502, lon: 2.3502 }, t + 5000)).toBe(false)     // ~27 m
        expect(shouldSend(prev, { lat: 48.8512, lon: 2.35 }, t + 5000)).toBe(true)        // ~133 m
        expect(shouldSend(prev, { lat: 48.85, lon: 2.35 }, t + 61_000)).toBe(true)
    })
})
