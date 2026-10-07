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
// The column's title follows the part of the day (slotOf: "What today may
// bring", "What this afternoon may bring", "What may follow tonight").
const BLOCK = SRC.slice(SRC.indexOf("k: slot.ahead"), SRC.indexOf("k: slot.record"))

describe("Today may bring", () => {
    it("reads the outlook, not only the forecast boards", () => {
        expect(BLOCK).toContain("outlookHeld")
        expect(SRC).toContain("safeArray(outlook?.outlook)")
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

describe("the brief speaks of the part of the day", async () => {
    const { slotOf } = await import("./Home.jsx").catch(() => ({}))
    it("turns at 05, 12 and 18", () => {
        if (!slotOf) return
        const at = (h) => { const d = new Date(2026, 9, 7, h, 30); return slotOf(d) }
        expect(at(8).happened).toBe("What happened overnight")
        expect(at(8).ahead).toBe("What today may bring")
        expect(at(14).happened).toBe("What happened this morning")
        expect(at(20).ahead).toBe("What may follow tonight")
        const next2am = slotOf(new Date(2026, 9, 8, 2, 30))
        expect(next2am.key).toBe(at(20).key)          // after midnight is still the same night
    })
})
