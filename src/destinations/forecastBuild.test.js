import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { assembleScenario, splitFields } from "./forecastBuild.js"

const WORLD = JSON.parse(readFileSync("public/data/world-countries.json", "utf8")).features
const FIELDS = [
    { name: "Smuravyovo Air Base", type: "medium_airport", cc: "RU", lon: 28.53, lat: 57.72 },
    { name: "Ostrov Naval Air Base", type: "medium_airport", cc: "RU", lon: 28.42, lat: 57.31 },
    { name: "Ämari Air Base", type: "medium_airport", cc: "EE", lon: 24.21, lat: 59.26 },
    { name: "Tallinn", type: "large_airport", cc: "EE", lon: 24.83, lat: 59.41 },
    { name: "Bujumbura", type: "large_airport", cc: "BI", lon: 29.32, lat: -3.32 },
]
const NARVA = { name: "Narva", lon: 28.19, lat: 59.38 }
const FULL = ["aircraft", "missiles", "naval", "armour"]

describe("assembling a scenario", () => {
    it("splits airfields by side", () => {
        const { targetPlaces, aggressorFields } = splitFields(FIELDS, "EE", "RU")
        expect(targetPlaces).toHaveLength(2)
        expect(aggressorFields).toHaveLength(2)
    })

    it("builds the Narva pairing with real origins and objectives", () => {
        const r = assembleScenario({
            world: WORLD, fields: FIELDS, target: "Estonia", aggressor: "Russia",
            objective: NARVA, capabilities: FULL, coa: "ground",
        })
        expect(r.ok).toBe(true)
        expect(r.contiguous).toBe(true)
        expect(r.objectives[0].name).toBe("Narva")
        expect(r.origins.length).toBeGreaterThan(0)
        expect(r.laydown.ok).toBe(true)
        expect(r.laydown.units.length).toBeGreaterThan(5)
    })

    it("offers no ground or air option for a pairing with no border", () => {
        // Russia/Burundi: the builder must still answer, and the answer
        // must be that almost nothing is possible.
        const r = assembleScenario({
            world: WORLD, fields: FIELDS, target: "Burundi", aggressor: "Russia",
            capabilities: FULL,
        })
        expect(r.ok).toBe(true)
        expect(r.contiguous).toBe(false)
        const kinds = r.available.map((c) => c.kind)
        expect(kinds).not.toContain("ground")
        expect(kinds).not.toContain("air")
    })

    it("does not build a laydown for a course of action the theatre refuses", () => {
        const r = assembleScenario({
            world: WORLD, fields: FIELDS, target: "Burundi", aggressor: "Russia",
            capabilities: FULL, coa: "ground",
        })
        expect(r.laydown).toBeNull()
    })

    it("refuses a country it has no outline for, by name", () => {
        const r = assembleScenario({ world: WORLD, fields: FIELDS,
                                     target: "Atlantis", aggressor: "Russia" })
        expect(r.ok).toBe(false)
        expect(r.reason).toContain("Atlantis")
    })

    it("carries unknown capability through as unknown", () => {
        const r = assembleScenario({
            world: WORLD, fields: FIELDS, target: "Estonia", aggressor: "Russia",
            objective: NARVA, capabilities: null,
        })
        const air = r.available.find((c) => c.kind === "air")
        expect(air?.uncertain?.length).toBeGreaterThan(0)
    })
})
