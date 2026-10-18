import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RowMarks, TopUnrest } from "./MMood.jsx"

const row = { name: "Iran", trend: { daily: { direction: "rising", ratio: 2.4, enough: true } },
              likelihood: { level: "Elevated", reasons: ["5 calls to gather, strike or block in 4 channels in 24 h"] } }

describe("phone mood: trend and likelihood", () => {
    it("marks a row with a coloured arrow and dot, the words left out", () => {
        const html = renderToStaticMarkup(<RowMarks c={row} />)
        expect(html).toContain("↑")
        expect(html).toContain('aria-label="Demonstrations: Elevated"')
        expect(renderToStaticMarkup(<RowMarks c={{ name: "X", trend: { daily: { direction: "unclear" } }, likelihood: null }} />)).toBe("")
    })
    it("shows the top country's chip, arrow, reasons and claim", () => {
        const u = { ...row, likelihood: { ...row.likelihood, forecast: { statement: "Gatherings in Tehran by Sun 19 Oct 12:00 UTC", criterion: "Wrong if none is reported by 2026-10-19 12:00 UTC" } },
                    calibration_line: "No Elevated readings in the stored posts yet to check it against." }
        const html = renderToStaticMarkup(<TopUnrest u={u} />)
        expect(html).toContain("Demonstrations: Elevated")
        expect(html).toContain("Tension: Rising 2.4× · 24 h")
        expect(html).toContain("5 calls to gather")
        expect(html).toContain("Wrong if none is reported")
        expect(html).toContain("No Elevated readings")
        expect(html).not.toMatch(/mono/i)
    })
    it("falls back to the list's reading while the country loads", () => {
        expect(renderToStaticMarkup(<TopUnrest u={null} fallback={row} />)).toContain("Demonstrations: Elevated")
        expect(renderToStaticMarkup(<TopUnrest u={null} fallback={{}} />)).toBe("")
    })
})
