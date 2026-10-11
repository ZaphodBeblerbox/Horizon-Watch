import { describe, it, expect } from "vitest"
import { hitKind, parseSizeKm, sizeForKind, squareKm } from "./watchPlace.js"
import { stepToAction } from "../voice/voiceFallback.js"

describe("watchPlace — sizing an area by what the place is", () => {
    it("airports by class, ports, cities, the rest", () => {
        expect(sizeForKind("airport", "large_airport")).toBe(8)
        expect(sizeForKind("airport", "small_airport")).toBe(3)
        expect(sizeForKind("port")).toBe(6)
        expect(sizeForKind("city")).toBe(15)
        expect(sizeForKind("place")).toBe(5)
        expect(hitKind({ type: "airport" })).toBe("airport")
        expect(hitKind({ type: "location", category: "place" })).toBe("city")
        expect(hitKind({ type: "location", category: "aeroway" })).toBe("airport")
    })
    it("the square is the size asked for", () => {
        const [[w, s], , [e, n]] = squareKm(26.4691, 49.798209, 8).coordinates[0]
        expect((n - s) * 110.574).toBeCloseTo(8, 2)
        expect((e - w) * 111.32 * Math.cos((26.4691 * Math.PI) / 180)).toBeCloseTo(8, 1)
    })
    it("reads a spoken size", () => {
        expect(parseSizeKm("around Tartus with 20 km")).toBe(20)
        expect(parseSizeKm("a 2,5 km box")).toBe(2.5)
        expect(parseSizeKm("around Tartus")).toBeNull()
        expect(parseSizeKm("900 km")).toBe(50)
    })
    it("the model's watch_place step becomes the same action as the rule's", () => {
        const o = stepToAction({ intent: "watch_place", slots: { place: "King Fahd Airport", size_km: 8 } }, {})
        expect(o.action).toEqual({ type: "watch_place", query: "King Fahd Airport", place: "King Fahd Airport", sizeKm: 8 })
    })
})
