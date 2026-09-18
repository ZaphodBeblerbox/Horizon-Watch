import { describe, it, expect } from "vitest"
import {
    classifyFeed, classifyAll, summarise, ageHours, ageLabel,
    suspensionNote, STALE_AFTER_H,
} from "./feedHealth.js"

const NOW = Date.parse("2026-09-18T12:00:00Z")
const agoH = (h) => new Date(NOW - h * 3_600_000).toISOString()

describe("§33.3 — the four-state vocabulary", () => {
    it("reports a fresh feed as live", () => {
        expect(classifyFeed({ type: "maritime", status: "ok", last_fetch: agoH(0.1) }, NOW).key).toBe("live")
    })

    it("reports a failing feed as degraded", () => {
        expect(classifyFeed({ type: "news", status: "degraded", last_fetch: agoH(0.2) }, NOW).key).toBe("degraded")
        expect(classifyFeed({ type: "news", status: "ok", failures: 3, last_fetch: agoH(0.2) }, NOW).key).toBe("degraded")
    })

    it("reports an errored feed as off", () => {
        expect(classifyFeed({ type: "news", status: "error", last_fetch: agoH(0.1) }, NOW).key).toBe("off")
    })

    it("treats a feed that NEVER delivered as off, not stale", () => {
        // "Stale" implies we once had data and it aged — a different and less
        // alarming claim than never having heard from the source at all.
        const c = classifyFeed({ type: "news", status: "pending", last_fetch: null }, NOW)
        expect(c.key).toBe("off")
        expect(c.age).toBeNull()
    })
})

describe("§33.3 — staleness is measured against the feed's OWN cadence", () => {
    it("calls a two-hour-old vessel position stale", () => {
        expect(classifyFeed({ type: "maritime", status: "ok", last_fetch: agoH(2) }, NOW).key).toBe("stale")
    })

    it("calls a two-hour-old port index FRESH", () => {
        // One threshold for everything would mark every reference dataset
        // stale forever, and an alert nobody can act on is an alert nobody
        // reads.
        expect(classifyFeed({ type: "infrastructure", status: "ok", last_fetch: agoH(2) }, NOW).key).toBe("live")
    })

    it("still calls a two-week-old port index stale", () => {
        expect(classifyFeed({ type: "infrastructure", status: "ok", last_fetch: agoH(24 * 14) }, NOW).key).toBe("stale")
    })

    it("leaves a type it has no cadence for unjudged rather than guessing", () => {
        const c = classifyFeed({ type: "something-new", status: "weird", last_fetch: agoH(9999) }, NOW)
        expect(c.key).toBe("unknown")
    })

    it("has a cadence for every type this app actually serves", () => {
        for (const t of ["real-time alerts", "news", "maritime", "infrastructure", "satellite"]) {
            expect(STALE_AFTER_H[t], `no cadence for ${t}`).toBeGreaterThan(0)
        }
    })
})

describe("§33.3 — the suspension list", () => {
    const sources = [
        { id: "ais", type: "maritime", status: "ok", last_fetch: agoH(0.1) },
        { id: "usgs", type: "real-time alerts", status: "ok", last_fetch: agoH(9) },
        { id: "oref", type: "real-time alerts", status: "degraded", last_fetch: null },
        { id: "ports", type: "infrastructure", status: "ok", last_fetch: agoH(2) },
    ]

    it("suspends stale and off feeds, and only those", () => {
        // "A detector whose feed is stale is SUSPENDED, not left firing on
        // old data."
        const s = summarise(classifyAll(sources, NOW))
        expect(s.suspended.map((c) => c.source.id).sort()).toEqual(["oref", "usgs"])
        expect(s.counts.live).toBe(2)
    })

    it("leads with the worst thing currently true", () => {
        expect(summarise(classifyAll(sources, NOW)).worst).toBe("off")
        expect(summarise(classifyAll([sources[0], sources[3]], NOW)).worst).toBe("live")
    })
})

describe("the copy distinguishes 'no data' from 'we stopped looking'", () => {
    it("says unknown, not absent, for a dead feed", () => {
        const note = suspensionNote("OREF", { key: "off", age: null })
        expect(note).toMatch(/unknown, not absent/)
    })

    it("names the age and warns that absence may be unreported", () => {
        const note = suspensionNote("USGS", { key: "stale", age: 9 })
        expect(note).toMatch(/9h ago/)
        expect(note).toMatch(/may simply be unreported/)
    })
})

describe("ages", () => {
    it("reads minutes, hours then days, and says never for nothing", () => {
        expect(ageLabel(null)).toBe("never")
        expect(ageLabel(0.25)).toBe("15m")
        expect(ageLabel(9)).toBe("9h")
        expect(ageLabel(72)).toBe("3d")
    })

    it("returns null rather than NaN for an unparseable timestamp", () => {
        expect(ageHours("not a date", NOW)).toBeNull()
        expect(ageHours(null, NOW)).toBeNull()
    })
})

describe("cadence overrides — type is a domain, not a schedule", () => {
    it("does not call a 13-hour-old sanctions list stale", () => {
        // The backend types it "maritime" because that is the domain it
        // serves, but OFAC and its peers publish weekly. Measured against
        // AIS's half-hour expectation it read stale within the hour.
        const c = classifyFeed({ id: "sanctions", type: "maritime", status: "ok", last_fetch: agoH(13) }, NOW)
        expect(c.key).toBe("live")
    })

    it("still calls a two-week-old sanctions list stale", () => {
        const c = classifyFeed({ id: "sanctions", type: "maritime", status: "ok", last_fetch: agoH(24 * 14) }, NOW)
        expect(c.key).toBe("stale")
    })

    it("leaves a vessel feed on the maritime cadence", () => {
        expect(classifyFeed({ id: "ais", type: "maritime", status: "ok", last_fetch: agoH(2) }, NOW).key).toBe("stale")
    })
})
