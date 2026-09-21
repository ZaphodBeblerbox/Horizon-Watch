/**
 * Every family a layer can choose must have a file on disk.
 *
 * This became load-bearing the moment the flat placeholder glyphs were
 * removed: a contact whose family has no .glb now draws NOTHING at all,
 * where before it would have fallen back to a square. A missing mesh
 * used to be a cosmetic downgrade and is now an invisible contact, so
 * the mapping is checked rather than assumed.
 */
import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { FAMILIES as AIRCRAFT, FALLBACK_FAMILY } from "./aircraftModels.js"
import { FAMILIES as VESSEL } from "./vesselModels.js"

describe("3D model coverage", () => {
    for (const f of AIRCRAFT) {
        it(`aircraft family ${f} has a mesh`, () => {
            expect(existsSync(`public/models/aircraft/${f}.glb`)).toBe(true)
        })
    }
    for (const f of VESSEL) {
        it(`vessel family ${f} has a mesh`, () => {
            expect(existsSync(`public/models/vessel/${f}.glb`)).toBe(true)
        })
    }
    it("the aircraft fallback is itself a real family", () => {
        expect(AIRCRAFT).toContain(FALLBACK_FAMILY)
    })
    it("the vessel catch-all is a real family", () => {
        // vesselModels.familyFor() returns "other" for any unrecognised
        // ship type, so "other" existing is what stops an unknown
        // vessel from vanishing.
        expect(VESSEL).toContain("other")
    })
})
