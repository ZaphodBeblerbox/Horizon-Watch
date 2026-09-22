import { describe, it, expect } from "vitest"
import {
    MODES, MODE_KEYS, isMode, THEATRES, countriesForTheatre,
    layoutTier, confidenceRing, cappedConfidence, TIER_X, THEATRE_SLUGS,
} from "./ontologyModes.js"

describe("§17 — the modes of one frame", () => {
    it("is graph · clusters · orbat · open world · engine", () => {
        // A DELIBERATE DEVIATION FROM §17, which names four. "clusters"
        // was added on request: the flat graph is ~80,000 nodes of which
        // 50,450 edges say only "this thing is in that country", so
        // drawn at equal weight membership buries every finding. The
        // clustered view counts membership instead of drawing it. The
        // spec's four are all still here and unchanged; this is an
        // addition, not a replacement, and it is recorded rather than
        // quietly absorbed so the divergence is visible.
        expect(MODE_KEYS).toEqual(["graph", "clusters", "orbat", "pat", "engine"])
        expect(MODES.map((m) => m.label))
            .toEqual(["graph", "clusters", "orbat", "open world", "engine"])
    })

    it("every mode names its own nav and stage", () => {
        // §17's rule is that each mode owns all three columns; a mode
        // missing either identifier renders somebody else's pane.
        for (const m of MODES) {
            expect(m.nav, m.key).toBeTruthy()
            expect(m.stage, m.key).toBeTruthy()
        }
        expect(new Set(MODES.map((m) => m.stage)).size).toBe(MODES.length)
    })

    it("rejects an unknown mode rather than rendering a blank frame", () => {
        expect(isMode("graph")).toBe(true)
        expect(isMode("nonsense")).toBe(false)
    })
})

describe("§17.1 — a country with no held ORBAT draws hollow", () => {
    const blackSea = THEATRES.find((t) => t.id === "TH-BLACK")

    it("returns EVERY country in the theatre, not just the ones we hold", () => {
        // "Absence of evidence is a state worth showing, not a country worth
        // hiding." Filtering the empties is the bug this prevents.
        const rows = countriesForTheatre(blackSea, { UKR: 3433 })
        expect(rows).toHaveLength(blackSea.iso.length)
        expect(rows.map((r) => r.iso)).toEqual(blackSea.iso)
    })

    it("marks the ones we hold nothing for as hollow", () => {
        const rows = countriesForTheatre(blackSea, { UKR: 3433 })
        expect(rows.find((r) => r.iso === "UKR").hollow).toBe(false)
        expect(rows.find((r) => r.iso === "TUR").hollow).toBe(true)
        expect(rows.find((r) => r.iso === "TUR").held).toBe(0)
    })

    it("is empty for no theatre rather than throwing", () => {
        expect(countriesForTheatre(null, {})).toEqual([])
    })
})

describe("§17.1 — deterministic layout", () => {
    it("puts the same items in the same places every time", () => {
        const a = layoutTier(["x", "y", "z"], 1)
        const b = layoutTier(["x", "y", "z"], 1)
        expect(a).toEqual(b)
    })

    it("uses the spec's tier columns", () => {
        expect(TIER_X).toEqual([70, 250, 470, 700])
        expect(layoutTier(["a"], 3)[0].x).toBe(700)
    })
})

describe("§17.1 — confidence", () => {
    it("bands the ring at .75 / .55 / .4", () => {
        expect(confidenceRing(0.8)).toBe("var(--green)")
        expect(confidenceRing(0.6)).toBe("var(--steel)")
        expect(confidenceRing(0.45)).toBe("var(--amber)")
        expect(confidenceRing(0.2)).toBe("var(--red)")
    })

    it("CAPS A SINGLE-SOURCE FORMATION AT 50%", () => {
        // "Confidence is the agreement between these sources, not an average
        // of them." One source agrees with nothing.
        expect(cappedConfidence(1, 0.95)).toBe(0.5)
        expect(cappedConfidence(3, 0.95)).toBe(0.95)
        expect(cappedConfidence(0, 0.95)).toBe(0)
    })
})

describe("theatre → slug mapping is explicit", () => {
    it("maps by hand rather than guessing between two vocabularies", () => {
        // ISO codes and GeoConfirmed slugs are different vocabularies;
        // guessing between them is how one theatre shows another's formations.
        for (const t of THEATRES) expect(THEATRE_SLUGS[t.id]).toBeDefined()
        expect(THEATRE_SLUGS["TH-BLACK"]).toContain("ukraine")
    })
})
