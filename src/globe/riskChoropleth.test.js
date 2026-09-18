import { describe, it, expect } from "vitest"
import { riskAlpha, resolveIso3, indexByIso3, buildA2ToA3, FLOOR, BANDS } from "./riskChoropleth.js"

const A2 = buildA2ToA3([
    { properties: { a2: "DE", a3: "DEU" } }, { properties: { a2: "UA", a3: "UKR" } },
    { properties: { a2: "PH", a3: "PHL" } }, { properties: { a2: "IR", a3: "IRN" } },
    { properties: { a2: "RU", a3: "RUS" } },
])

describe("density carries severity, and quiet carries none", () => {
    it("draws NOTHING below the floor", () => {
        // 13 of the 16 scored countries sit under 25, most under 5. A ramp
        // anchored at zero washes the map in a colour meaning "we found one
        // article" — inventing a global picture out of sampling noise.
        expect(riskAlpha(0.18, 1)).toBe(0)
        expect(riskAlpha(4.75, 1)).toBe(0)
        expect(riskAlpha(FLOOR - 0.01, 1)).toBe(0)
    })

    it("deepens with the score", () => {
        const a = riskAlpha(30, 3), b = riskAlpha(60, 4), c = riskAlpha(100, 5)
        expect(a).toBeGreaterThan(0)
        expect(b).toBeGreaterThan(a)
        expect(c).toBeGreaterThan(b)
        expect(c).toBeLessThanOrEqual(0.7)
    })

    it("keeps the top of the scale distinguishable", () => {
        // 100 must read hotter than 78, not pin with it.
        expect(riskAlpha(100, 5)).toBeGreaterThan(riskAlpha(78.57, 5))
    })

    it("survives junk instead of painting it", () => {
        for (const v of [null, undefined, NaN, "x"]) expect(riskAlpha(v, 3)).toBe(0)
    })

    it("has a band vocabulary with low meaning invisible", () => {
        expect(BANDS.find((b) => b.band === 1).alpha).toBe(0)
        expect(BANDS).toHaveLength(5)
    })
})

describe("ISO reconciliation — the endpoint mixes three schemes", () => {
    it("passes alpha-3 through", () => {
        expect(resolveIso3("PHL", A2)).toBe("PHL")
    })

    it("maps alpha-2 via the geometry's own table", () => {
        expect(resolveIso3("DE", A2)).toBe("DEU")
        expect(resolveIso3("UA", A2)).toBe("UKR")
    })

    it("maps a FIPS code that is not an ISO code at all", () => {
        // 'RP' is FIPS 10-4 for the Philippines and is not ISO anything.
        expect(resolveIso3("RP", A2)).toBe("PHL")
    })

    it("prefers ISO over FIPS where the two collide", () => {
        // 'IR' is ISO alpha-2 for Iran AND FIPS for Iran — but the principle
        // matters: a real ISO code must win, or a country gets repainted as
        // a different one.
        expect(resolveIso3("IR", A2)).toBe("IRN")
    })

    it("reports what it cannot place rather than swallowing it", () => {
        const { unresolved } = indexByIso3([{ iso_code: "ZZZZ", score: 9 }], A2)
        expect(unresolved).toEqual(["ZZZZ"])
    })
})

describe("the Philippines arrives twice", () => {
    it("collapses PHL and RP into one country", () => {
        const { byIso } = indexByIso3([
            { iso_code: "PHL", score: 78.57, band: 5 },
            { iso_code: "RP", score: 78.57, band: 5 },
            { iso_code: "UA", score: 100, band: 5 },
        ], A2)
        expect(byIso.size).toBe(2)
        expect(byIso.get("PHL").score).toBe(78.57)
        expect(byIso.get("UKR").score).toBe(100)
    })

    it("keeps the higher score when a duplicate disagrees", () => {
        const { byIso } = indexByIso3([
            { iso_code: "PHL", score: 12, band: 2 },
            { iso_code: "RP", score: 78.57, band: 5 },
        ], A2)
        expect(byIso.get("PHL").score).toBe(78.57)
    })
})
