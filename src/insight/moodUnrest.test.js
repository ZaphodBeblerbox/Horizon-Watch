import { describe, it, expect } from "vitest"
import { trendArrow, trendText, levelColor, levelText, unrestTitle } from "./moodUnrest.js"

describe("tension trend and demonstration likelihood words", () => {
    it("draws an arrow only when the trend can be read", () => {
        expect(trendArrow("rising")).toBe("↑")
        expect(trendArrow("falling")).toBe("↓")
        expect(trendArrow("steady")).toBe("→")
        expect(trendArrow("unclear")).toBe("")
    })
    it("says the multiple, or that there are too few posts", () => {
        expect(trendText({ enough: true, direction: "rising", ratio: 2.44 })).toBe("Rising 2.4× · 24 h")
        expect(trendText({ enough: false, direction: "unclear", ratio: 9 }, "6 h")).toBe("Too few posts to read the trend (6 h)")
    })
    it("keeps colour for the dot and writes the level", () => {
        expect(levelColor("High")).toContain("red")
        expect(levelColor("Low")).toBe("var(--txt4)")
        expect(levelText("Elevated")).toBe("Demonstrations: Elevated")
    })
    it("explains a row with its reasons", () => {
        const t = unrestTitle("Iran", { daily: { enough: true, direction: "rising", ratio: 3 } },
                              { level: "High", reasons: ["14 calls to gather in 9 channels in 24 h", "2 dated gatherings announced for Saturday in Tehran and Mashhad"] })
        expect(t).toBe("Iran: tension rising 3× · 24 h · demonstrations in the next 48 h High: 14 calls to gather in 9 channels in 24 h; 2 dated gatherings announced for Saturday in Tehran and Mashhad")
    })
})
