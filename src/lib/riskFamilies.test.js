import { describe, it, expect } from "vitest"
import { familyRows, agreementText, totalEvidence, isCrossRef } from "./riskFamilies.js"
import { rankCountries, why } from "../destinations/riskRanking.js"
import { adaptCountryRisk } from "../inspector/adapters.js"

// The shape /api/risk-index/countries returns since the cross-reference
// (backend/risk_crossref.py), trimmed.
const VEN = {
    iso_code: "VEN", score: 58.5, band: 3, confidence: "medium", capped: false,
    corroborating: ["gdelt", "rss"],
    families: {
        gdelt: { label: "GDELT", score: 77.2, count: 47, window_days: 30, corroborates: true, summary: "47 events" },
        rss: { label: "News (RSS)", score: 45.1, count: 164, window_days: 7, corroborates: true, summary: "18 security articles of 164" },
        telegram: { label: "Telegram", score: 5.0, count: 5, window_days: 7, corroborates: false, summary: "mood 20 over 5 rated posts" },
        geoconfirmed: { label: "GeoConfirmed", score: null, count: 0, status: "no_placemarks" },
    },
    contributions: { gdelt: 28.1, rss: 27.0, telegram: 0.4, baseline: 3.0 },
    explanation: "GDELT and News (RSS) agree it is elevated.",
}
const THIN = {
    iso_code: "CRI", score: 27, band: 2, corroborating: [], confidence: "low",
    families: { gdelt: { label: "GDELT", score: 53, count: 2 }, rss: {}, telegram: {}, geoconfirmed: {} },
    contributions: { gdelt: 20, baseline: 7 },
}

describe("risk index source families", () => {
    it("lists all four families in a fixed order, unobserved ones said in words", () => {
        const rows = familyRows(VEN)
        expect(rows.map((r) => r.key)).toEqual(["gdelt", "rss", "telegram", "geoconfirmed"])
        expect(rows[1]).toMatchObject({ label: "News (RSS)", count: 164, corroborates: true, contribution: 27.0 })
        expect(rows[3].score).toBe(null)
        expect(rows[3].summary).toBe("no verified footage")
    })

    it("says how many sources agree", () => {
        expect(agreementText(VEN)).toBe("2 of 4 sources agree · 3 observe it")
        expect(agreementText(THIN)).toBe("0 of 4 sources agree · 1 observes it")
    })

    it("counts evidence across every family", () => {
        expect(totalEvidence(VEN)).toBe(47 + 164 + 5)
        expect(isCrossRef(VEN)).toBe(true)
        expect(isCrossRef({ components: {} })).toBe(false)
    })

    it("ranks and explains a cross-referenced country by its families", () => {
        expect(why(VEN)).toBe("GDELT 77 ✓ · News (RSS) 45 ✓ · Telegram 5")
        const rows = rankCountries([THIN, VEN], new Map([["VEN", "Venezuela"], ["CRI", "Costa Rica"]]))
        expect(rows.map((r) => r.name)).toEqual(["Venezuela", "Costa Rica"])
        expect(rows[0].agree).toBe(2)
        expect(rows[1].thin).toBe(true)
    })

    it("the inspector says which sources agree", () => {
        const a = adaptCountryRisk({ ...VEN, name: "Venezuela" })
        const labels = a.attributes.map((x) => x.label)
        expect(labels).toContain("Sources agreeing")
        expect(labels).toContain("GDELT")
        expect(labels).toContain("News (RSS)")
        expect(a.provenance.feed).toMatch(/Telegram/)
    })
})
