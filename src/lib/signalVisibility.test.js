import { describe, it, expect } from "vitest"
import { isSignalVisible, ageHoursSince, rankForRawSeverity } from "./signalVisibility.js"

describe("rankForRawSeverity", () => {
    it("ranks critical as 0 (most severe)", () => {
        expect(rankForRawSeverity("critical")).toBe(0)
    })
    it("ranks high as 1", () => {
        expect(rankForRawSeverity("high")).toBe(1)
    })
    it("treats medium and moderate as the same real tier (rank 2)", () => {
        expect(rankForRawSeverity("medium")).toBe(2)
        expect(rankForRawSeverity("moderate")).toBe(2)
    })
    it("ranks low as 3", () => {
        expect(rankForRawSeverity("low")).toBe(3)
    })
    it("is case-insensitive", () => {
        expect(rankForRawSeverity("CRITICAL")).toBe(0)
    })
    it("ranks an unrecognized or missing value last, never assumed more urgent", () => {
        expect(rankForRawSeverity("unknown")).toBe(3)
        expect(rankForRawSeverity(undefined)).toBe(3)
        expect(rankForRawSeverity(null)).toBe(3)
    })
})

describe("ageHoursSince", () => {
    it("computes real elapsed hours from an ISO timestamp", () => {
        const now = new Date("2026-01-02T00:00:00Z").getTime()
        const ts = "2026-01-01T00:00:00Z"
        expect(ageHoursSince(ts, now)).toBeCloseTo(24, 5)
    })
    it("accepts a Date instance", () => {
        const now = Date.now()
        const ts = new Date(now - 3600000)
        expect(ageHoursSince(ts, now)).toBeCloseTo(1, 5)
    })
    it("accepts an epoch-ms number", () => {
        const now = Date.now()
        expect(ageHoursSince(now - 7200000, now)).toBeCloseTo(2, 5)
    })
    it("returns null for a missing timestamp — never assumed stale", () => {
        expect(ageHoursSince(null)).toBeNull()
        expect(ageHoursSince(undefined)).toBeNull()
        expect(ageHoursSince("")).toBeNull()
    })
    it("returns null for an unparseable timestamp", () => {
        expect(ageHoursSince("not-a-date")).toBeNull()
    })
})

describe("isSignalVisible", () => {
    it("passes when within both the window and the severity floor", () => {
        expect(isSignalVisible({ ageHours: 10, severityRank: 0 }, { windowHours: 24, maxRank: 3 })).toBe(true)
    })
    it("fails when older than the real window", () => {
        expect(isSignalVisible({ ageHours: 100, severityRank: 0 }, { windowHours: 24, maxRank: 3 })).toBe(false)
    })
    it("fails when less severe than the real floor allows", () => {
        // rank 3 (low) fails a floor of maxRank 1 (High+)
        expect(isSignalVisible({ ageHours: 1, severityRank: 3 }, { windowHours: 24, maxRank: 1 })).toBe(false)
    })
    it("an item exactly at the window boundary is visible (<=, not <)", () => {
        expect(isSignalVisible({ ageHours: 24, severityRank: 0 }, { windowHours: 24, maxRank: 3 })).toBe(true)
    })
    it("an item exactly at the severity floor boundary is visible (<=, not <)", () => {
        expect(isSignalVisible({ ageHours: 1, severityRank: 1 }, { windowHours: 24, maxRank: 1 })).toBe(true)
    })
    it("a missing real age is never assumed out of window", () => {
        expect(isSignalVisible({ ageHours: null, severityRank: 0 }, { windowHours: 24, maxRank: 3 })).toBe(true)
    })
    it("a missing real severity rank is never assumed to fail the floor", () => {
        expect(isSignalVisible({ ageHours: 1, severityRank: null }, { windowHours: 24, maxRank: 0 })).toBe(true)
    })
    it("with no window/floor passed at all (both null), everything passes", () => {
        expect(isSignalVisible({ ageHours: 1000, severityRank: 3 }, { windowHours: null, maxRank: null })).toBe(true)
    })
    it("with no options object passed at all, everything passes (safe default)", () => {
        expect(isSignalVisible({ ageHours: 1000, severityRank: 3 })).toBe(true)
    })
})
