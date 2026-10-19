import { describe, expect, it } from "vitest"
import { FRESH_MIN, MAX_AGE_H, demoStale, dropStaleDemos, freshAlpha, isDemoItem, lastActivity } from "./freshness.js"

const NOW = Date.parse("2026-10-19T20:00:00Z")
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString()

describe("freshness — a demonstration's mark is never dimmed for hours (owner, 2026-10-19)", () => {
    it("full strength through the first three hours, whatever the kind", () => {
        for (const m of [0, 1, 30, 60, 61, 120, FRESH_MIN]) expect(freshAlpha(m)).toBe(1)
    })
    it("then eases, never below the floor, and is gone after a day", () => {
        expect(freshAlpha(6 * 60)).toBeLessThan(1)
        expect(freshAlpha(23.9 * 60)).toBeGreaterThanOrEqual(0.55)
        expect(freshAlpha(MAX_AGE_H * 60 + 1)).toBe(0)
    })
    it("unknown age: full", () => {
        expect(freshAlpha(undefined)).toBe(1)
        expect(freshAlpha(NaN)).toBe(1)
    })
})

describe("freshness — a demonstration leaves every list 24 h after its last activity", () => {
    it("knows a demonstration's item", () => {
        expect(isDemoItem({ category: "unrest" })).toBe(true)
        expect(isDemoItem({ street_report: true })).toBe(true)
        expect(isDemoItem({ on_ground: true })).toBe(true)
        expect(isDemoItem({ kind: "protest" })).toBe(true)
        expect(isDemoItem({ signal_kind: "intent" })).toBe(true)
        expect(isDemoItem({ category: "conflict" })).toBe(false)
    })
    it("its last activity is its newest time, its status's included", () => {
        const p = { kind: "protest", starts_utc: ago(30), status: { last_report_at: ago(3) } }
        expect(lastActivity(p)).toBe(NOW - 3 * 3_600_000)
    })
    it("drops a day-old demonstration and keeps everything else", () => {
        const items = [
            { id: "old", category: "unrest", posted_at: ago(25) },
            { id: "new", category: "unrest", posted_at: ago(2) },
            { id: "war", category: "conflict", posted_at: ago(60) },
            { id: "ann", kind: "announcement", created_at: ago(40), starts_at: new Date(NOW + 3_600_000).toISOString() },
            { id: "bare", category: "unrest" },
        ]
        expect(dropStaleDemos(items, NOW).map((x) => x.id)).toEqual(["new", "war", "ann", "bare"])
        expect(demoStale(items[0], NOW)).toBe(true)
    })
})
