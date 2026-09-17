import { describe, it, expect } from "vitest"
import {
    COLUMNS, toInboxRow, nextSort, sortRows, applyFilters,
    emptyStateMessage, severityDistribution, distribution, unreadCount, hhmm,
} from "./inboxLogic.js"

// `??`/`||` on every field would coerce an EXPLICIT null or "" back to the
// default, which is how a helper quietly stops testing the case it was
// written for. Only fields the caller omitted get a default.
const D = {
    id: "x", ts: 1_700_000_000_000, sev: "high", title: "A thing happened",
    place: "Kherson", domain: "news_event", conf: 0.7,
    source: "geoconfirmed", status: "new",
}
const row = (over = {}) => ({ ...D, ...over })

describe("§S2.3 — seven columns, in the spec's order", () => {
    it("is exactly the addendum's column set", () => {
        expect(COLUMNS.map((c) => c.key)).toEqual(["ts", "sev", "title", "place", "domain", "conf", "source"])
    })

    it("does NOT give escalation a column", () => {
        // "It is rare; a column for it would be 90% empty." It is an inline
        // tag in the title cell instead.
        expect(COLUMNS.find((c) => c.key === "esc")).toBeUndefined()
        expect(COLUMNS.find((c) => c.key === "status")).toBeUndefined()
    })
})

describe("toInboxRow — one source of truth", () => {
    it("reads the shared watch-queue row rather than re-deriving it", () => {
        const r = toInboxRow({
            id: "geoconfirmed_1", publishedAt: "2026-09-15T00:00:00",
            title: "Destroyed truck", aoi: "Drobysheve", confidencePct: 70,
            kind: "event", raw: { severity_tier: "critical", source: "geoconfirmed", type: "explosion" },
        })
        expect(r.sev).toBe("critical")
        expect(r.conf).toBeCloseTo(0.7)
        expect(r.source).toBe("geoconfirmed")
        expect(r.domain).toBe("explosion")
        expect(r.status).toBe("new")
    })

    it("carries a caller-supplied triage status", () => {
        expect(toInboxRow({ id: "a", raw: {} }, { a: "ack" }).status).toBe("ack")
    })

    it("never invents a timestamp it was not given", () => {
        expect(toInboxRow({ id: "a", raw: {} }).ts).toBe(0)
        expect(hhmm(0)).toBe("—")
    })
})

describe("§S2.4 — sorting", () => {
    it("sets the key, then flips direction on the active key", () => {
        expect(nextSort({ key: "ts", dir: "desc" }, "sev")).toEqual({ key: "sev", dir: "asc" })
        expect(nextSort({ key: "sev", dir: "asc" }, "sev")).toEqual({ key: "sev", dir: "desc" })
    })

    it("defaults Received to descending — newest first", () => {
        expect(nextSort({ key: "sev", dir: "asc" }, "ts")).toEqual({ key: "ts", dir: "desc" })
    })

    it("SORTS SEVERITY BY URGENCY, not alphabetically", () => {
        // A string sort puts "elevated" before "high" before "critical",
        // which is the exact inverse of what the column is for.
        const rows = [row({ id: "e", sev: "elevated" }), row({ id: "c", sev: "critical" }), row({ id: "h", sev: "high" })]
        expect(sortRows(rows, { key: "sev", dir: "asc" }).map((r) => r.id)).toEqual(["c", "h", "e"])
    })

    it("is stable on ties, so rows never shuffle under the cursor", () => {
        const rows = [row({ id: "a", sev: "high", ts: 1 }), row({ id: "b", sev: "high", ts: 2 })]
        expect(sortRows(rows, { key: "sev", dir: "asc" }).map((r) => r.id)).toEqual(["b", "a"])
        expect(sortRows(rows, { key: "sev", dir: "asc" }).map((r) => r.id)).toEqual(["b", "a"])
    })

    it("sorts confidence numerically and puts the unknown last", () => {
        const rows = [row({ id: "lo", conf: 0.4 }), row({ id: "none", conf: null }), row({ id: "hi", conf: 0.9 })]
        expect(sortRows(rows, { key: "conf", dir: "desc" }).map((r) => r.id)).toEqual(["hi", "lo", "none"])
    })
})

describe("§S2.7 — an empty state names the stage that emptied it", () => {
    const rows = [row({ id: "a", sev: "low" }), row({ id: "b", sev: "low" }), row({ id: "c", sev: "moderate" })]

    it("names the severity floor and how many exist below it", () => {
        // "No signals above the moderate floor in the last 72 hours. 41
        // exist below it."
        const { rows: out, stages } = applyFilters(rows, { sevFloor: "critical" })
        expect(out).toHaveLength(0)
        const msg = emptyStateMessage({ total: rows.length, stages, windowHours: 72 })
        expect(msg.headline).toMatch(/above the critical floor/)
        expect(msg.headline).toMatch(/last 72 hours/)
        expect(msg.detail).toMatch(/3 exist below it/)
    })

    it("names the search when the search is what emptied it", () => {
        const { stages } = applyFilters(rows, { q: "nonsense" })
        expect(emptyStateMessage({ total: rows.length, stages }).headline).toMatch(/matching/)
    })

    it("blames the LAST stage that actually removed something", () => {
        // Not the first filter in the chain — the one that did the damage.
        const { stages } = applyFilters(rows, { sevFloor: "low", q: "nonsense" })
        expect(emptyStateMessage({ total: rows.length, stages }).headline).toMatch(/matching/)
    })

    it("never says 'No results'", () => {
        const { stages } = applyFilters(rows, { q: "zzz" })
        const m = emptyStateMessage({ total: rows.length, stages })
        expect(`${m.headline} ${m.detail}`.toLowerCase()).not.toContain("no results")
    })

    it("says so plainly when the queue itself is genuinely empty", () => {
        const m = emptyStateMessage({ total: 0, stages: [] })
        expect(m.headline).toMatch(/No signals in the queue/)
    })
})

describe("§S2.6 — distributions, not checkboxes", () => {
    it("gives each value a count and a bar proportional to the largest", () => {
        const rows = [row({ sev: "critical" }), row({ sev: "high" }), row({ sev: "high" })]
        const d = severityDistribution(rows)
        expect(d.find((x) => x.key === "high").n).toBe(2)
        expect(d.find((x) => x.key === "high").pct).toBe(100)
        expect(d.find((x) => x.key === "critical").pct).toBe(50)
    })

    it("orders severity by urgency so the queue's shape reads top-down", () => {
        const rows = [row({ sev: "low" }), row({ sev: "critical" })]
        expect(severityDistribution(rows).map((x) => x.key)).toEqual(["critical", "low"])
    })

    it("skips blank keys rather than charting an empty bucket", () => {
        expect(distribution([row({ place: "" })], (r) => r.place)).toEqual([])
    })
})

describe("unread", () => {
    it("counts only what has not been selected", () => {
        expect(unreadCount([row({ status: "new" }), row({ status: "ack" }), row({ status: "esc" })])).toBe(1)
    })
})
