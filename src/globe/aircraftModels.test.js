import { describe, it, expect } from "vitest"
import { familyFor, isSurfaceVehicle, modelUrl, modelHeadingRadians, FAMILIES } from "./aircraftModels.js"

describe("familyFor", () => {
    it("maps the types that actually dominate the feed", () => {
        // From one live sample of 724: A320 102, B738 94, A21N 58,
        // A20N 49, A319 46, BCS3 38, B38M 34, A321 25.
        for (const t of ["A320", "B738", "A21N", "A20N", "A319", "BCS3", "B38M", "A321"])
            expect(familyFor({ type: t })).toBe("narrowbody")
        for (const t of ["B77W", "B789", "B77L"]) expect(familyFor({ type: t })).toBe("widebody")
        for (const t of ["E190", "E195", "E295"]) expect(familyFor({ type: t })).toBe("regional")
        expect(familyFor({ type: "PC12" })).toBe("lightprop")
        expect(familyFor({ type: "A388" })).toBe("heavy4")
    })

    it("does not draw a service truck as an airliner", () => {
        // C* is the ADS-B surface category: tugs, emergency vehicles and
        // fixed obstructions. About 5% of a live sample.
        expect(familyFor({ type: "GND", category: "C2" })).toBeNull()
        expect(familyFor({ type: "TWR", category: "C1" })).toBeNull()
        expect(isSurfaceVehicle({ category: "C0" })).toBe(true)
        expect(isSurfaceVehicle({ category: "A3" })).toBe(false)
    })

    it("falls back to the emitter category when the type is unknown", () => {
        // 41 of 724 had no type at all, but category is near-universal.
        expect(familyFor({ category: "A3" })).toBe("narrowbody")
        expect(familyFor({ category: "A5" })).toBe("widebody")
        expect(familyFor({ category: "A7" })).toBe("helicopter")
    })

    it("returns null rather than inventing an airframe", () => {
        // An unidentified return must not be given a specific aircraft
        // it was never reported to be.
        expect(familyFor({})).toBeNull()
        expect(familyFor({ type: "ZZZZ" })).toBeNull()
        expect(familyFor(null)).toBeNull()
    })

    it("only ever names a family that has a model", () => {
        for (const ac of [{ type: "A320" }, { type: "B77W" }, { category: "A7" },
                          { type: "EC35" }, { type: "F16" }, { type: "AT76" }])
            expect(FAMILIES).toContain(familyFor(ac))
    })
})

describe("modelUrl", () => {
    it("points at a generated model", () => {
        expect(modelUrl("narrowbody")).toMatch(/^\/models\/aircraft\/narrowbody\.glb\?v=\d+$/)
    })
    it("refuses a family that does not exist", () => {
        expect(modelUrl("spaceship")).toBeNull()
        expect(modelUrl(null)).toBeNull()
    })
})

describe("modelHeadingRadians", () => {
    const deg = (r) => (r * 180) / Math.PI
    it("applies the measured offset that puts the nose on the track", () => {
        // Not derived — see the module. Getting this wrong by 180° is
        // what made every aircraft fly tail-first.
        expect(deg(modelHeadingRadians(0))).toBeCloseTo(270, 9)
        expect(deg(modelHeadingRadians(90))).toBeCloseTo(360, 9)
    })
    it("never returns NaN", () => {
        for (const v of [null, undefined, NaN, "x", {}])
            expect(Number.isFinite(modelHeadingRadians(v))).toBe(true)
    })
})
