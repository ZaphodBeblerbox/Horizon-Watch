/**
 * The Home panel's "Today may bring" rows.
 *
 * What this replaced: "Escalation in non-state conflict · 90% · above its
 * own base rate of 33%". A category, a quarter-long window, and nothing
 * that could ever be shown to have been wrong.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const SRC = readFileSync(new URL("./Home.jsx", import.meta.url), "utf8")
const BLOCK = SRC.slice(SRC.indexOf('k: "Today may bring"'),
                        SRC.indexOf('k: "Last night\'s forecast"'))

describe("Today may bring", () => {
    it("reads the outlook, not only the forecast boards", () => {
        expect(BLOCK).toContain("outlook?.outlook")
    })

    it("leads with the place, because a forecast names where", () => {
        expect(BLOCK).toMatch(/o\.place.*o\.statement/s)
    })

    it("shows the reason and the resolution date", () => {
        expect(BLOCK).toContain("o.because")
        expect(BLOCK).toContain("o.resolves_by")
    })

    it("labels the base-rate fallback as a category rate, not a forecast", () => {
        // It is still shown when the outlook cannot be produced — that is
        // honest. Showing it AS the answer was the defect.
        expect(BLOCK).toContain("category rate, not a forecast")
    })
})
