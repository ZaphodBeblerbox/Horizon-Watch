import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(__dirname, "RiskIndexPanel.jsx"), "utf8")

describe("§15 — the index is falsifiable", () => {
    it("exposes all four components as weights", () => {
        for (const k of ["vol", "tone", "gold", "conf"]) {
            expect(src.includes(`key: "${k}"`), `${k} must be an adjustable weight`).toBe(true)
        }
    })

    it("offers reset and refresh, and posts weights back", () => {
        expect(src).toMatch(/risk-index\/weights\/reset/)
        expect(src).toMatch(/risk-index\/weights/)
        expect(src).toMatch(/reset weights/)
    })

    it("ranks the top twelve", () => {
        expect(src).toMatch(/slice\(0,\s*12\)/)
    })
})

describe("§15 — never a number where there is no data", () => {
    it("renders a component's status instead of a zero when it is null", () => {
        // The GDELT cache here is routinely thin: three of four components
        // come back null. Rendering 0 would report "calm" when the truth is
        // "we did not look".
        expect(src).toMatch(/STATUS_TEXT/)
        expect(src).toMatch(/insufficient_history/)
        expect(src).toMatch(/no_real_tone_data/)
        expect(src).toMatch(/m\.score == null/)
    })

    it("shows an em dash, not 0, for a country with no score", () => {
        expect(src).toMatch(/c\.score == null \? "—"/)
    })

    it("warns when a score used fewer than four components", () => {
        // Re-normalised weights make such a score incomparable to a full one.
        expect(src).toMatch(/weights_used/)
        expect(src).toMatch(/not comparable/)
    })
})

describe("§15 — the source tag describes the DATA, not the request", () => {
    it("is 'seeded' on a thin corpus even when the fetch succeeded", () => {
        // A live 200 carrying six events is still seeded.
        expect(src).toMatch(/real_gdelt_history_days/)
        expect(src).toMatch(/real_total_gdelt_events/)
        expect(src).toMatch(/live \? "GDELT live" : "seeded"/)
    })
})

describe("§15 — the delta is not invented", () => {
    it("compares successive refreshes rather than claiming a stored history", () => {
        expect(src).toMatch(/prevScores/)
        // "·" is the honest answer before a second observation exists.
        expect(src).toMatch(/dir === "flat" \? "·"/)
    })
})

describe("§15 — the index ranks, it does not score sites", () => {
    it("states the separation from exposure scoring", () => {
        expect(src).toMatch(/exposure scoring never reads it/i)
    })
})
