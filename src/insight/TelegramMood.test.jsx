import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConflictChip } from "./TelegramMood.jsx"

const rising = { rising: true, severity: "high", ratio: 3.14, calls_24h: 14, n_24h: 40, rate_24h: 0.35, base_rate: 0.1, channels_24h: 9 }

describe("calls for conflict marker", () => {
    it("marks a country whose calls for armed conflict are rising, with the ratio", () => {
        const html = renderToStaticMarkup(<ConflictChip c={rising} name="Sudan" />)
        expect(html).toContain("Sudan · Calls for conflict ↑ 3.1×")
        expect(html).toContain("14 of 40 posts in the last 24 h (35%), against 10% over the two weeks before · 9 channels")
        expect(html).not.toMatch(/mono/i)
    })
    it("shows nothing when it is not rising", () => {
        expect(renderToStaticMarkup(<ConflictChip c={{ ...rising, rising: false }} />)).toBe("")
        expect(renderToStaticMarkup(<ConflictChip c={null} />)).toBe("")
    })
})
