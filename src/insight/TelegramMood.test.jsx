import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConflictChip, UnrestPanel } from "./TelegramMood.jsx"

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

describe("tension trend and demonstration likelihood panel", () => {
    const u = {
        trend: { daily: { direction: "rising", ratio: 3, enough: true, label: "rising · hostile posts 30% of 40 in 24 h against 10% over two weeks (3.0×, z 4.2)" },
                 intraday: { direction: "unclear", ratio: 0, enough: false, label: "too little to read" } },
        likelihood: { level: "High", score: 5, capped: null, context: [],
                      reasons: ["14 calls to gather, strike or block in 9 channels in 24 h, 3.0× the two-week rate", "2 dated gatherings announced for Saturday in Mashhad and Tehran"],
                      forecast: { statement: "Gatherings, strikes or blockades in Mashhad and Tehran by Sun 19 Oct 12:00 UTC", criterion: "Wrong if no protest … by 2026-10-19 12:00 UTC" },
                      citations: [{ channel: "Organisers", text: "Rally at Azadi", url: "https://t.me/x/1" }] },
        places: [{ place: "Tehran", level: "High", trend: "rising", trend_label: "rising", reasons: [], n_24h: 20, calls_24h: 8, announced: 1 }],
        calibration_line: "In the stored posts, 3 of 4 High readings were followed by protest reports in the country within 48 h (any reading: 20% of 50) — too few to call it calibrated.",
    }
    it("shows the trend, the level with its reasons, the falsifiable claim and the backtest", () => {
        const html = renderToStaticMarkup(<UnrestPanel u={u} name="Iran" />)
        expect(html).toContain("Rising 3× · 24 h")
        expect(html).toContain("Too few posts to read the trend (6 h)")
        expect(html).toContain("Demonstrations: High")
        expect(html).toContain("14 calls to gather, strike or block in 9 channels in 24 h")
        expect(html).toContain("Wrong if no protest")
        expect(html).toContain("3 of 4 High readings")
        expect(html).toContain("Tehran")
        expect(html).not.toMatch(/mono/i)
    })
    it("says when it has not been checked yet, and nothing without a reading", () => {
        expect(renderToStaticMarkup(<UnrestPanel u={{ ...u, calibration_line: null }} name="Iran" />)).toContain("Not yet checked against the stored posts")
        expect(renderToStaticMarkup(<UnrestPanel u={null} name="Iran" />)).toBe("")
    })
})
