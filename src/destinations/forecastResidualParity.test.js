/**
 * The two residual implementations must agree.
 *
 * The server computes it for the board it sends, and the client
 * recomputes it whenever an analyst proposes a scenario — F7 requires
 * that it move. Two implementations of one formula in two languages is
 * exactly the shape that drifts in silence, and a residual that differs
 * between the payload and the screen would be invisible: both are
 * plausible numbers.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { residualOf } from "./forecastBars.js"

describe("residual parity with the server", () => {
    it("computes the product of complements, like forecast_board.residual_of", () => {
        const py = readFileSync("backend/forecast_board.py", "utf8")
        const fn = py.slice(py.indexOf("def residual_of"))
        const body = fn.slice(0, fn.indexOf("\ndef ", 1))
        // The server multiplies complements and clamps each p into [0,1].
        expect(body).toContain("r *= 1.0 - max(0.0, min(1.0, p))")
        expect(body).toContain("r = 1.0")
        expect(body).not.toContain("1.0 - total")
    })

    it("agrees on the cases that mattered", () => {
        // Computed from the same formula the server uses; if either side
        // changes shape, one of these moves and the other does not.
        const cases = [
            [[0.07, 0.24, 0.13], 0.93 * 0.76 * 0.87],
            [[0.573, 0.275, 0.273], 0.427 * 0.725 * 0.727],   // Sudan, was 0.0
            [[0.5, 0.25, 0.15], 0.5 * 0.75 * 0.85],           // Ukraine, was 0.1
            [[], 1],
            [[1, 0.5], 0],
        ]
        for (const [ps, want] of cases) {
            expect(residualOf(ps.map((p) => ({ p }))), String(ps)).toBeCloseTo(want, 9)
        }
    })

    it("neither side uses 1 - sum any more", () => {
        const js = readFileSync("src/destinations/forecastBars.js", "utf8")
        const fn = js.slice(js.indexOf("export function residualOf"))
        expect(fn.slice(0, fn.indexOf("\n}"))).not.toMatch(/1\s*-\s*total/)
    })
})
