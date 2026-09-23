/**
 * The generator, against the real world file and a real airfield set.
 *
 * These are not fixtures. The whole claim of this module is that a
 * laydown is derived from actual geography, so a test on invented
 * geography would prove nothing.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    contactPoints, boundaryPoints, isMilitaryField, fieldKind, rankPlaces,
    nearestOf, towards, buildScenario, ORIGIN_REACH_KM,
} from "./forecastScenario.js"
import { matchCountry } from "./forecastTerrain.js"
import { kmBetween } from "./forecastFeasibility.js"

const WORLD = JSON.parse(readFileSync("public/data/world-countries.json", "utf8")).features
const C = (n) => matchCountry(n, WORLD)

// A small, real airfield set — enough to rank, cheap to carry.
const FIELDS = [
    { name: "Smuravyovo Air Base", type: "medium_airport", cc: "RU", lon: 28.53, lat: 57.72 },
    { name: "Ostrov Naval Air Base", type: "medium_airport", cc: "RU", lon: 28.42, lat: 57.31 },
    { name: "Levashovo Air Base", type: "medium_airport", cc: "RU", lon: 30.21, lat: 60.10 },
    { name: "Vladivostok Intl", type: "large_airport", cc: "RU", lon: 132.15, lat: 43.40 },
    { name: "Ämari Air Base", type: "medium_airport", cc: "EE", lon: 24.21, lat: 59.26 },
    { name: "Lennart Meri Tallinn", type: "large_airport", cc: "EE", lon: 24.83, lat: 59.41 },
    { name: "Kuressaare Airport", type: "small_airport", cc: "EE", lon: 22.51, lat: 58.23 },
]
const NARVA = { name: "Narva", lon: 28.1903, lat: 59.3772 }

describe("scenario generation from real geography", () => {
    it("finds the border the movement would actually cross", () => {
        // Estonia's contact with Russia is the Narva line; the first
        // point should be within a short drive of the town.
        const c = contactPoints(C("Estonia"), C("Russia"))
        expect(c.length).toBeGreaterThan(0)
        const nearNarva = c.some((p) => kmBetween(p, [NARVA.lon, NARVA.lat]) < 120)
        expect(nearNarva).toBe(true)
    })

    it("spreads contact points, so axes do not stack on one village", () => {
        const c = contactPoints(C("Ukraine"), C("Russia"))
        expect(c.length).toBeGreaterThan(3)
        for (let i = 0; i < c.length; i++) {
            for (let j = i + 1; j < c.length; j++) {
                expect(kmBetween(c[i], c[j])).toBeGreaterThan(40)
            }
        }
    })

    it("returns nothing for countries that do not touch", () => {
        // Refusing is the honest answer; inventing a border is not.
        expect(contactPoints(C("Chile"), C("Japan"))).toEqual([])
    })

    it("recognises military airfields by name", () => {
        expect(isMilitaryField("Smuravyovo Air Base")).toBe(true)
        expect(isMilitaryField("Ostrov Naval Air Base")).toBe(true)
        expect(isMilitaryField("Kursk East Airport")).toBe(false)
        expect(isMilitaryField(null)).toBe(false)
        expect(fieldKind({ name: "X Air Base" })).toBe("military_air")
        expect(fieldKind({ name: "X", type: "large_airport" })).toBe("large_air")
        expect(fieldKind({ name: "X", type: "small_airport" })).toBeNull()
    })

    it("ranks by what a place is AND how near the fight it is", () => {
        // A major airfield 900km to the rear is not part of this fight,
        // and a map of every airport in the region answers no question.
        const contact = contactPoints(C("Estonia"), C("Russia"))
        const ranked = rankPlaces(FIELDS.filter((f) => f.cc === "RU"), contact,
                                  { maxKm: ORIGIN_REACH_KM })
        expect(ranked.length).toBeGreaterThan(0)
        expect(ranked.map((r) => r.name)).not.toContain("Vladivostok Intl")
        expect(ranked[0].kind).toBe("military_air")
    })

    it("drops small strips entirely rather than drawing them faintly", () => {
        const contact = contactPoints(C("Estonia"), C("Russia"))
        const ranked = rankPlaces(FIELDS.filter((f) => f.cc === "EE"), contact)
        expect(ranked.map((r) => r.name)).not.toContain("Kuressaare Airport")
    })

    it("builds a Narva laydown with many units, facing the right way", () => {
        const sc = buildScenario({
            target: C("Estonia"), aggressor: C("Russia"), focus: NARVA,
            targetPlaces: FIELDS.filter((f) => f.cc === "EE"),
            aggressorFields: FIELDS.filter((f) => f.cc === "RU"),
        })
        expect(sc.ok).toBe(true)
        // One arrow is not an invasion.
        expect(sc.units.length).toBeGreaterThan(6)
        expect(sc.objectives[0].name).toBe("Narva")
        // Aggressor red, defender blue — not neutral green and unknown
        // yellow, which says nobody knows who is who in a scenario that
        // names both sides.
        expect(sc.units.some((u) => u.aff === "hostile")).toBe(true)
        expect(sc.units.some((u) => u.aff === "friendly")).toBe(true)
        expect(sc.units.every((u) => ["hostile", "friendly"].includes(u.aff))).toBe(true)
        // Air begins at a real, named airfield.
        const air = sc.units.filter((u) => u.domain === "air")
        expect(air.length).toBeGreaterThan(0)
        for (const a of air) expect(a.what).toMatch(/Air Base|Airport/)
    })

    it("gives every unit a sentence, so clicking it explains itself", () => {
        const sc = buildScenario({
            target: C("Estonia"), aggressor: C("Russia"), focus: NARVA,
            targetPlaces: FIELDS.filter((f) => f.cc === "EE"),
            aggressorFields: FIELDS.filter((f) => f.cc === "RU"),
        })
        for (const u of sc.units) {
            expect(u.what, u.id).toBeTruthy()
            expect(u.what.length, u.id).toBeGreaterThan(20)
        }
    })

    it("refuses rather than inventing when there is no border", () => {
        const sc = buildScenario({ target: C("Chile"), aggressor: C("Japan") })
        expect(sc.ok).toBe(false)
        expect(sc.reason).toMatch(/border|contact/)
    })

    it("refuses when nothing on the target side ranks", () => {
        const sc = buildScenario({
            target: C("Estonia"), aggressor: C("Russia"),
            targetPlaces: [], aggressorFields: FIELDS,
        })
        expect(sc.ok).toBe(false)
        expect(sc.reason).toMatch(/objective/)
    })

    it("places artillery short of the line, because it fires across it", () => {
        const sc = buildScenario({
            target: C("Estonia"), aggressor: C("Russia"), focus: NARVA,
            targetPlaces: FIELDS.filter((f) => f.cc === "EE"),
            aggressorFields: FIELDS.filter((f) => f.cc === "RU"),
        })
        const guns = sc.units.filter((u) => u.icon === "artillery" && u.aff === "hostile")
        expect(guns.length).toBeGreaterThan(0)
        for (const g of guns) expect(g.what).toMatch(/fires across/)
    })

    it("moves a point toward another, and backwards on a negative", () => {
        const a = [0, 0], b = [0, 10]
        expect(towards(a, b, 111)[1]).toBeCloseTo(1, 1)
        expect(towards(a, b, -111)[1]).toBeCloseTo(-1, 1)
        expect(towards(a, a, 50)).toEqual([0, 0])
    })

    it("finds the nearest of a list", () => {
        expect(nearestOf([0, 0], [{ lon: 10, lat: 0 }, { lon: 1, lat: 0 }]).lon).toBe(1)
        expect(nearestOf([0, 0], [])).toBeNull()
    })

    it("samples a boundary without choking on a big country", () => {
        const pts = boundaryPoints(C("Russia"), 5)
        expect(pts.length).toBeGreaterThan(50)
        for (const [lon, lat] of pts.slice(0, 50)) {
            expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true)
        }
    })
})
