import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import { FlowChart } from "./ChokepointFlowSection.jsx"

const series = [
    { day: "2026-10-01", share_pct: 3.4, positions: 34000 },
    { day: "2026-10-02", share_pct: 3.6, positions: 36000 },
    { day: "2026-10-03", share_pct: 3.3, positions: 33000 },
]

describe("FlowChart", () => {
    it("draws the series with its normal and reads out the latest day", () => {
        const out = html(<FlowChart series={series} baseline={3.5} />)
        expect(out).toContain("<path")
        expect(out).toContain('stroke-dasharray="3 3"')
        expect(out).toContain("3.30%")
        expect(out).toContain("10-03")
        expect(out).toContain("normal 3.50%")
    })

    it("draws nothing from a single day", () => {
        expect(html(<FlowChart series={series.slice(0, 1)} baseline={3.5} />)).toBe("")
    })
})
