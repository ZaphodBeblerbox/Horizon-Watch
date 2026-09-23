import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    matchCountry, ringsOf, bboxOf, viewFor, project, unproject, pathFor, outside,
} from "./forecastTerrain.js"

const WORLD = JSON.parse(readFileSync("public/data/world-countries.json", "utf8"))
const BOX = { w: 560, h: 240 }

describe("forecastTerrain", () => {
    it("matches the board's country names to the world file's", () => {
        // UCDP names countries historically and the world file names them
        // currently, so every board would otherwise lose its terrain.
        for (const n of ["Sudan", "Ukraine", "Mexico", "Yemen (North Yemen)",
                         "Myanmar (Burma)", "Russia (Soviet Union)",
                         "DR Congo (Zaire)", "Serbia (Yugoslavia)",
                         "Bosnia-Herzegovina"]) {
            expect(matchCountry(n, WORLD.features), n).toBeTruthy()
        }
    })

    it("returns null rather than guessing at an unknown country", () => {
        // A near-match would draw the wrong coastline under real units.
        expect(matchCountry("Atlantis", WORLD.features)).toBeNull()
        expect(matchCountry("", WORLD.features)).toBeNull()
        expect(matchCountry("Sudan", null)).toBeNull()
    })

    it("does not confuse the two Congos", () => {
        const drc = matchCountry("DR Congo (Zaire)", WORLD.features)
        expect(drc.properties.a3).toBe("COD")
    })

    it("reads rings from both Polygon and MultiPolygon", () => {
        expect(ringsOf({ type: "Polygon", coordinates: [[[0, 0]]] })).toHaveLength(1)
        expect(ringsOf({ type: "MultiPolygon",
                        coordinates: [[[[0, 0]]], [[[1, 1]]]] })).toHaveLength(2)
        expect(ringsOf(null)).toEqual([])
        expect(ringsOf({ type: "Point", coordinates: [0, 0] })).toEqual([])
    })

    it("computes a bbox and survives junk coordinates", () => {
        const g = { type: "Polygon", coordinates: [[[10, 20], [30, 40], [null, 5]]] }
        expect(bboxOf(g)).toEqual([10, 20, 30, 40])
        expect(bboxOf({ type: "Polygon", coordinates: [[]] })).toBeNull()
    })

    it("fits the country, so there is something to check the axes against", () => {
        // A fixed operational-scale window centred on Sudan lands entirely
        // inside Sudan: featureless interior, and nothing to judge the
        // geometry against, which is the only reason this face exists.
        const sudan = matchCountry("Sudan", WORLD.features)
        const bb = bboxOf(sudan.geometry)
        const v = viewFor(bb, BOX)
        expect(v.minLon).toBeLessThan(bb[0])
        expect(v.maxLon).toBeGreaterThan(bb[2])
        expect(v.minLat).toBeLessThan(bb[1])
        expect(v.maxLat).toBeGreaterThan(bb[3])
    })

    it("preserves the box aspect ratio so countries are not distorted", () => {
        const v = viewFor([30, 10, 40, 20], BOX)
        const k = Math.cos((v.cLat * Math.PI) / 180)
        const screenLon = (v.maxLon - v.minLon) * k
        const screenLat = v.maxLat - v.minLat
        expect(screenLon / screenLat).toBeCloseTo(BOX.w / BOX.h, 6)
    })

    it("fits a tall country and a wide one alike", () => {
        for (const n of ["Chile", "Russia", "Sudan", "Ukraine"]) {
            const f = matchCountry(n, WORLD.features)
            if (!f) continue
            const bb = bboxOf(f.geometry)
            const v = viewFor(bb, BOX)
            expect(v.minLon, n).toBeLessThanOrEqual(bb[0])
            expect(v.maxLat, n).toBeGreaterThanOrEqual(bb[3])
        }
    })

    it("projects linearly and inverts exactly", () => {
        const v = viewFor([30, 10, 40, 20], BOX)
        const [x, y] = project(v.cLon, v.cLat, v)
        expect(x).toBeCloseTo(BOX.w / 2, 6)
        expect(y).toBeCloseTo(BOX.h / 2, 6)
        const [lon, lat] = unproject(x, y, v)
        expect(lon).toBeCloseTo(v.cLon, 9)
        expect(lat).toBeCloseTo(v.cLat, 9)
    })

    it("puts north at the top", () => {
        // SVG y grows downward and latitude grows upward; getting this
        // backwards mirrors every template without looking broken.
        const v = viewFor([30, 10, 40, 20], BOX)
        const north = project(v.cLon, v.maxLat, v)
        const south = project(v.cLon, v.minLat, v)
        expect(north[1]).toBeLessThan(south[1])
    })

    it("drops rings that miss the window, so the path stays small", () => {
        const v = viewFor([30, 10, 40, 20], BOX)
        const far = { type: "Polygon", coordinates: [[[-170, -80], [-169, -80], [-169, -79]]] }
        expect(pathFor(far, v)).toBe("")
        expect(outside([[-170, -80], [-169, -79]], v)).toBe(true)
        expect(outside([[35, 15], [35.1, 15.1]], v)).toBe(false)
    })

    it("emits a closed path for a country inside the window", () => {
        const sudan = matchCountry("Sudan", WORLD.features)
        const v = viewFor(bboxOf(sudan.geometry), BOX)
        const d = pathFor(sudan.geometry, v)
        expect(d.startsWith("M")).toBe(true)
        expect(d.endsWith("Z")).toBe(true)
        expect(d).not.toContain("NaN")
    })

    it("never emits NaN into path data for any real country", () => {
        // One NaN makes an SVG path silently render nothing, which on
        // this face would read as "no land here".
        for (const f of WORLD.features) {
            const bb = bboxOf(f.geometry)
            if (!bb) continue
            const d = pathFor(f.geometry, viewFor(bb, BOX))
            expect(d, f.properties.n).not.toContain("NaN")
        }
    })

    it("returns safe empties without a view", () => {
        expect(project(0, 0, null)).toBeNull()
        expect(unproject(0, 0, null)).toBeNull()
        expect(pathFor({ type: "Polygon", coordinates: [[[0, 0]]] }, null)).toBe("")
        expect(viewFor(null, BOX)).toBeNull()
    })
})
