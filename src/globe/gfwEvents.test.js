import { describe, it, expect } from "vitest"
import { styleFor, summaryOf, ageLabel, freshnessNote, KINDS } from "./gfwEvents.js"

describe("styleFor", () => {
    it("has a style for every kind the backend serves", () => {
        expect(KINDS.sort()).toEqual(["encounters", "gaps", "loitering", "port-visits"])
        for (const k of KINDS) {
            expect(styleFor(k).color).toMatch(/^#[0-9A-F]{6}$/i)
            expect(styleFor(k).shape).toBeTruthy()
        }
    })
    it("falls back rather than returning undefined", () => {
        expect(styleFor("nonsense").shape).toBeTruthy()
        expect(styleFor(undefined).shape).toBeTruthy()
    })
})

describe("summaryOf", () => {
    it("names both vessels in an encounter", () => {
        expect(summaryOf({ kind: "encounters", vessels: [{ name: "ALPHA" }, { name: "BETA" }] }))
            .toBe("Encounter — ALPHA and BETA")
    })

    it("uses the MMSI when a vessel has no name", () => {
        // "unknown vessel" is not actionable; an MMSI is.
        expect(summaryOf({ kind: "gaps", vessels: [{ mmsi: "123456789" }] }))
            .toBe("AIS gap — MMSI 123456789")
    })

    it("degrades to the kind alone when there is nothing to name", () => {
        expect(summaryOf({ kind: "loitering", vessels: [] })).toBe("Loitering")
        expect(summaryOf({})).toBeTruthy()
        expect(summaryOf(null)).toBeTruthy()
    })
})

describe("ageLabel", () => {
    const now = Date.parse("2026-09-21T12:00:00Z")

    it("is coarse, because these are never fresh", () => {
        // A precise "3h 12m ago" on a four-day-old record is false
        // precision dressed up as rigour.
        expect(ageLabel("2026-09-21T06:00:00Z", now)).toBe("within the last day")
        expect(ageLabel("2026-09-20T06:00:00Z", now)).toBe("1 day ago")
        expect(ageLabel("2026-09-17T12:00:00Z", now)).toBe("4 days ago")
    })

    it("handles a clock that disagrees rather than showing a negative age", () => {
        expect(ageLabel("2026-09-22T12:00:00Z", now)).toBe("just published")
    })

    it("returns null when there is no usable timestamp", () => {
        expect(ageLabel(null)).toBeNull()
        expect(ageLabel("not-a-date")).toBeNull()
    })
})

describe("freshnessNote", () => {
    it("always says these are not live", () => {
        for (const v of [null, undefined, NaN, "x", 0, 3.4]) {
            expect(freshnessNote(v)).toMatch(/not a live position/)
        }
    })
    it("quotes the measured lag when there is one", () => {
        expect(freshnessNote(3.4)).toMatch(/3\.4 days old/)
        expect(freshnessNote(1)).toMatch(/1 day old/)
    })
})
