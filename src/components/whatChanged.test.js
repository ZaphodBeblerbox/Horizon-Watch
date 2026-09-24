import { describe, it, expect } from "vitest"
import {
    windowFor, changedItems, summarise, sevRank, humanAge,
    readLastSeen, writeLastSeen, LAST_SEEN_KEY, MAX_AGE_MS,
} from "./whatChanged.js"

const NOW = Date.parse("2026-09-24T12:00:00Z")
const at = (iso, severity) => ({ id: iso, severity, published_at: iso })

describe("what changed", () => {
    it("shows the last 24h on a first visit", () => {
        const w = windowFor(null, NOW)
        expect(w.label).toBe("LAST 24 HOURS")
        expect(w.firstVisit).toBe(true)
    })

    it("never produces an empty card after a reload", () => {
        // "Since you last looked: nothing" two seconds after a refresh
        // teaches a reader to stop reading the one panel that must be
        // worth reading.
        const w = windowFor(NOW - 2000, NOW)
        expect(w.label).toBe("LAST 24 HOURS")
        expect(w.since).toBe(NOW - 24 * 3600 * 1000)
    })

    it("describes the real gap once it is over a day", () => {
        const w = windowFor(NOW - 6 * 3600 * 1000 - 24 * 3600 * 1000, NOW)
        expect(w.label).toMatch(/SINCE YOU LAST LOOKED · 1d ago/)
        expect(w.firstVisit).toBe(false)
    })

    it("treats a stale mark as a first visit", () => {
        expect(windowFor(NOW - MAX_AGE_MS - 1, NOW).firstVisit).toBe(true)
    })

    it("ignores a mark from the future, which means the clock moved", () => {
        expect(windowFor(NOW + 60000, NOW).firstVisit).toBe(true)
    })

    it("orders by severity first, then recency", () => {
        const items = [
            at("2026-09-24T11:59:00Z", "moderate"),
            at("2026-09-24T09:00:00Z", "critical"),
            at("2026-09-24T11:00:00Z", "high"),
            at("2026-09-24T11:30:00Z", "critical"),
        ]
        const got = changedItems(items, NOW - 24 * 3600 * 1000).map((i) => i.severity)
        expect(got).toEqual(["critical", "critical", "high", "moderate"])
        // and the newer of the two criticals leads
        expect(changedItems(items, NOW - 24 * 3600 * 1000)[0].id)
            .toBe("2026-09-24T11:30:00Z")
    })

    it("drops anything outside the window or undateable", () => {
        const items = [at("2026-09-20T10:00:00Z", "critical"),
                       { id: "x", severity: "high" }]
        expect(changedItems(items, NOW - 3600 * 1000)).toEqual([])
    })

    it("counts high and critical together, because both interrupt", () => {
        const items = [at("2026-09-24T11:00:00Z", "critical"),
                       at("2026-09-24T11:00:00Z", "high"),
                       at("2026-09-24T11:00:00Z", "low")]
        expect(summarise(items)).toBe("3 new signals, 2 high or critical")
        expect(summarise([items[2]])).toBe("1 new signal, 0 high or critical")
        expect(summarise([])).toBe("Nothing new in this window.")
    })

    it("ranks unknown severities at the bottom rather than throwing", () => {
        expect(sevRank("critical")).toBeGreaterThan(sevRank("moderate"))
        expect(sevRank(null)).toBe(0)
        expect(sevRank("nonsense")).toBe(0)
    })

    it("survives storage that throws, as private mode does", () => {
        const bad = { getItem() { throw new Error("denied") },
                      setItem() { throw new Error("denied") } }
        expect(readLastSeen(bad)).toBeNull()
        expect(() => writeLastSeen(bad)).not.toThrow()
        expect(readLastSeen(null)).toBeNull()
    })

    it("round-trips through a real store", () => {
        const mem = new Map()
        const store = { getItem: (k) => mem.get(k) ?? null,
                        setItem: (k, v) => mem.set(k, v) }
        writeLastSeen(store, NOW)
        expect(readLastSeen(store)).toBe(NOW)
        expect(mem.get(LAST_SEEN_KEY)).toBe(String(NOW))
    })

    it("phrases an age a person would say", () => {
        expect(humanAge(30 * 60000)).toBe("moments ago")
        expect(humanAge(6 * 3600000)).toBe("6h ago")
        expect(humanAge(50 * 3600000)).toBe("2d ago")
    })
})
