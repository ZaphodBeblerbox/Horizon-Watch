import { describe, it, expect } from "vitest"
import { conflictsNear, conflictsIn } from "./ConflictContext.jsx"

const L = [
    { id: "sudan", countries: ["sd"], country_names: ["sudan"], center: [14.5, 29], radius_km: 1100 },
    { id: "yemen", countries: ["ye"], country_names: ["yemen"], center: [15.5, 45.5], radius_km: 700 },
    { id: "ukraine", countries: ["ua", "ru"], country_names: ["ukraine", "russia"], center: [48.5, 35.5], radius_km: 900 },
]
describe("conflict context", () => {
    it("shows the wars around the map's view, nearest first", () => {
        expect(conflictsNear(L, { lat: 15, lon: 40, height: 1_500_000 }).map((c) => c.id)).toEqual(["yemen", "sudan"])
        expect(conflictsNear(L, { lat: 50, lon: 30, height: 800_000 }).map((c) => c.id)).toEqual(["ukraine"])
        expect(conflictsNear(L, null)).toEqual([])
    })
    it("finds an item's war by code or by name", () => {
        expect(conflictsIn(L, ["sd"]).map((c) => c.id)).toEqual(["sudan"])
        expect(conflictsIn(L, [], ["Yemen"]).map((c) => c.id)).toEqual(["yemen"])
        expect(conflictsIn(L, ["fr"], ["France"])).toEqual([])
    })
})
