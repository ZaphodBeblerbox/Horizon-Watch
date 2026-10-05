import { describe, it, expect } from "vitest"
import { leadSentence, placeOf, theaterLines } from "./homeLead.js"
import { THEATER_SCOPE } from "../data/theaterScope.js"

const sig = (headline, country, tier = "significant", at = "2026-10-05T08:00:00Z", location) => ({
    headline, location_country: country, severity_tier: tier, published_at: at,
    location: location ?? `Somewhere, ${country}`,
})

describe("placeOf", () => {
    it("drops the (general) region suffix and repeats the country once", () => {
        expect(placeOf({ location: "Riyom, Nigeria (general), Nigeria", location_country: "Nigeria" })).toBe("Riyom, Nigeria")
        expect(placeOf({ location: "Gaza, Israel (general), Israel", location_country: "Israel" })).toBe("Gaza, Israel")
        expect(placeOf({ location: "Kenya", location_country: "Kenya" })).toBe("Kenya")
    })
})

describe("leadSentence", () => {
    it("names the leading signal, its place, and where the rest are", () => {
        const s = [
            sig("Gunmen attack village in Riyom", "Nigeria", "critical", "2026-10-05T07:53:00Z", "Riyom, Nigeria (general), Nigeria"),
            sig("Strike reported in Gaza", "Israel", "critical", "2026-10-05T11:07:00Z", "Gaza, Israel (general), Israel"),
            sig("Protest in Tel Aviv", "Israel"),
            sig("Flood warning", "Kenya"),
        ]
        const out = leadSentence(s)
        expect(out).toContain("Newest critical: Strike reported in Gaza — Gaza, Israel.")
        expect(out).toContain("4 signals across 3 countries, most in Israel (2), Kenya (1) and Nigeria (1); 2 critical.")
        expect(out).not.toMatch(/on the surface/)
    })

    it("still refuses to launder an all-critical surface into alarm", () => {
        const s = [1, 2, 3, 4].map((i) => sig(`Event ${i}`, "Sudan", "critical"))
        expect(leadSentence(s)).toMatch(/tagging fault/)
    })

    it("says nothing has come in when the surface is empty", () => {
        expect(leadSentence([])).toBe("Nothing has come in yet on this watch.")
    })
})

describe("theaterLines", () => {
    it("counts a theater from its own countries and names its top signal", () => {
        const s = [sig("Houthi drone hits tanker", "Yemen", "critical"), sig("Flood warning", "Kenya")]
        const red = theaterLines(s, THEATER_SCOPE).find((t) => t.key === "redsea")
        expect(red.level).toBe("critical")
        expect(red.line).toContain("1 signal, 1 critical. Houthi drone hits tanker — Somewhere, Yemen.")
    })

    it("names a quiet theater's countries instead of inventing a status", () => {
        const hormuz = theaterLines([], THEATER_SCOPE).find((t) => t.key === "hormuz")
        expect(hormuz.level).toBe("quiet")
        expect(hormuz.line).toContain("Iran, Iraq and Oman")
        expect(hormuz.line).not.toMatch(/baseline|transit volume/i)
    })
})
