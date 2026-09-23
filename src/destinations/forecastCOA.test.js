import { describe, it, expect } from "vitest"
import { availableCOAs, coastalObjective, COA_KINDS, COA_META } from "./forecastCOA.js"
import { isLand } from "./forecastFeasibility.js"
import { readFileSync } from "node:fs"

const WORLD = JSON.parse(readFileSync("public/data/world-countries.json", "utf8")).features
const FULL = ["aircraft", "missiles", "naval", "armour", "artillery"]

describe("courses of action derived from the theatre", () => {
    it("describes every kind it can draw", () => {
        for (const k of COA_KINDS) {
            expect(COA_META[k]?.label, k).toBeTruthy()
            expect(COA_META[k]?.doctrine, k).toBeTruthy()
        }
    })

    it("offers a ground option only across a shared border", () => {
        const near = availableCOAs({ contiguous: true, caps: FULL, originsInRange: 2 })
        const far = availableCOAs({ contiguous: false, caps: FULL, originsInRange: 2 })
        expect(near.available.map((c) => c.kind)).toContain("ground")
        expect(far.available.map((c) => c.kind)).not.toContain("ground")
        expect(far.excluded.find((e) => e.kind === "ground").reason)
            .toMatch(/no shared land border/)
    })

    it("leaves a standoff option where nothing else is possible", () => {
        // Iran and Israel share no border and have fought: missiles are
        // how that dyad is real, and refusing every option would be
        // wrong about a conflict that actually happened.
        const r = availableCOAs({ contiguous: false, targetCoastal: true,
                                  originsInRange: 0, caps: ["missiles"] })
        expect(r.available.map((c) => c.kind)).toEqual(["missile"])
    })

    it("never offers an amphibious approach to an inland objective", () => {
        // This is the Gaza bug in its general form: landing craft aimed
        // at a city they cannot reach.
        const r = availableCOAs({ contiguous: true, targetCoastal: false,
                                  caps: FULL, originsInRange: 2 })
        expect(r.available.map((c) => c.kind)).not.toContain("amphibious")
        expect(r.excluded.find((e) => e.kind === "amphibious").reason)
            .toMatch(/not on a coast/)
    })

    it("refuses an air option when the force fields no aircraft", () => {
        const r = availableCOAs({ contiguous: true, caps: ["armour"], originsInRange: 4 })
        expect(r.available.map((c) => c.kind)).not.toContain("air")
        expect(r.excluded.find((e) => e.kind === "air").reason)
            .toMatch(/no aircraft/)
    })

    it("refuses an air option when no airfield is in range", () => {
        const r = availableCOAs({ contiguous: true, caps: FULL, originsInRange: 0 })
        expect(r.excluded.find((e) => e.kind === "air").reason)
            .toMatch(/no airfield within range/)
    })

    it("treats UNKNOWN capability as uncertain, never as absent", () => {
        // A force we failed to look up is not a force without an air
        // arm. Refusing an option for want of data is a finding we did
        // not make.
        const r = availableCOAs({ contiguous: true, targetCoastal: true,
                                  caps: null, originsInRange: 2 })
        const air = r.available.find((c) => c.kind === "air")
        expect(air).toBeTruthy()
        expect(air.uncertain.join(" ")).toMatch(/aircraft/)
        expect(r.excluded.find((e) => e.kind === "air")).toBeUndefined()
    })

    it("recognises a coastal objective from the real coastline", () => {
        // Tallinn is on the water; Tartu is not.
        expect(coastalObjective({ lon: 24.75, lat: 59.44 }, isLand, WORLD)).toBe(true)
        expect(coastalObjective({ lon: 26.72, lat: 58.38 }, isLand, WORLD)).toBe(false)
    })

    it("returns false for a malformed objective rather than guessing", () => {
        expect(coastalObjective(null, isLand, WORLD)).toBe(false)
        expect(coastalObjective({ lon: NaN, lat: 10 }, isLand, WORLD)).toBe(false)
        expect(coastalObjective({ lon: 1, lat: 1 }, null, WORLD)).toBe(false)
    })

    it("can return no options at all", () => {
        // A theatre where nothing is possible must produce no picture,
        // not a default one.
        const r = availableCOAs({ contiguous: false, targetCoastal: false, caps: [] })
        expect(r.available).toEqual([])
        expect(r.excluded.length).toBe(COA_KINDS.length)
    })
})
