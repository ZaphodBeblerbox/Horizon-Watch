import { describe, it, expect } from "vitest"
import {
    CAT, CAT_KEYS, UNCATEGORISED, BUCKETS,
    foldBuckets, stackSegments, calendarTicks, monthStep,
    advance, barOpacity, spanDays, SPEEDS, TICK_MS, DAYS_PER_TICK,
} from "./timeStripMath.js"

const ms = (s) => Date.parse(`${s}T00:00:00Z`)

describe("§11.2 — the categories, verbatim", () => {
    it("is exactly GeoConfirmed's seven, in the spec's order", () => {
        expect(CAT_KEYS).toEqual([
            "conflict", "equipment", "infrastructure", "maritime", "air", "orbat", "civil",
        ])
    })

    it("keeps the source's own name and maps to a domain separately", () => {
        // "Remapping at ingest destroys the ability to ask what the source
        // actually said." Both fields must survive.
        expect(CAT.equipment.name).toBe("Equipment loss")
        expect(CAT.equipment.domain).toBe("conflict")
        expect(CAT.infrastructure.domain).toBe("energy")
    })

    it("uses tokens, never literal hex", () => {
        for (const [k, v] of Object.entries(CAT)) {
            expect(v.color.startsWith("var(--"), `${k} must use a token`).toBe(true)
        }
    })
})

describe("foldBuckets — §11.1's 132 columns", () => {
    const min = ms("2026-01-01"), max = ms("2026-12-31")

    it("always produces 132 columns regardless of input length", () => {
        expect(foldBuckets([], min, max)).toHaveLength(BUCKETS)
        expect(foldBuckets([{ bucket: "2026-06-01", count: 3 }], min, max)).toHaveLength(BUCKETS)
    })

    it("folds without inventing counts between rows", () => {
        const rows = [
            { bucket: "2026-01-01", count: 5, categories: { conflict: 5 } },
            { bucket: "2026-06-15", count: 7, categories: { maritime: 7 } },
        ]
        const cols = foldBuckets(rows, min, max)
        expect(cols.reduce((a, c) => a + c.total, 0)).toBe(12)
    })

    it("puts a row exactly on the upper bound in the last column, not past the end", () => {
        const cols = foldBuckets([{ bucket: "2026-12-31", count: 4 }], min, max)
        expect(cols[BUCKETS - 1].total).toBe(4)
        expect(cols.reduce((a, c) => a + c.total, 0)).toBe(4)
    })

    it("drops rows outside the span rather than clamping them into an edge bar", () => {
        const cols = foldBuckets([{ bucket: "2020-01-01", count: 9 }], min, max)
        expect(cols.reduce((a, c) => a + c.total, 0)).toBe(0)
    })

    it("sums categories per column alongside the total", () => {
        const rows = [
            { bucket: "2026-01-02", count: 3, categories: { conflict: 2, air: 1 } },
            { bucket: "2026-01-03", count: 2, categories: { conflict: 2 } },
        ]
        const cols = foldBuckets(rows, min, max)
        const hit = cols.find((c) => c.total > 0)
        expect(hit.categories.conflict).toBeGreaterThan(0)
    })

    it("survives a zero-width span instead of dividing by it", () => {
        expect(foldBuckets([{ bucket: "2026-01-01", count: 1 }], min, min)).toHaveLength(BUCKETS)
    })
})

describe("stackSegments", () => {
    it("stacks in a fixed order so a category never jumps between bars", () => {
        const a = stackSegments({ categories: { civil: 1, conflict: 9 } })
        const b = stackSegments({ categories: { civil: 9, conflict: 1 } })
        expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key))
        expect(a[0].key).toBe("conflict")
    })

    it("segments sum to the column total, uncategorised included", () => {
        // A stacked bar whose segments do not sum to its own total is a chart
        // lying about how much is there — 27% of the archive is uncategorised.
        const col = { categories: { conflict: 4, uncategorised: 3 } }
        expect(stackSegments(col).reduce((a, s) => a + s.value, 0)).toBe(7)
    })

    it("places uncategorised last and in the neutral colour", () => {
        const segs = stackSegments({ categories: { conflict: 1, uncategorised: 1 } })
        expect(segs[segs.length - 1].key).toBe(UNCATEGORISED.key)
        expect(segs[segs.length - 1].color).toBe(UNCATEGORISED.color)
    })

    it("still draws a column that has a count but no breakdown", () => {
        // /histogram answers with bare {bucket, count} unless asked for
        // categories, and an older deployment ignores the parameter entirely.
        // Without this the whole chart rendered empty while holding thousands
        // of real confirmations — which on screen is indistinguishable from an
        // empty archive.
        const segs = stackSegments({ total: 42, categories: {} })
        expect(segs).toHaveLength(1)
        expect(segs[0].value).toBe(42)
        expect(segs[0].color).toBe(UNCATEGORISED.color)
    })

    it("draws nothing for a column that genuinely has nothing", () => {
        expect(stackSegments({ total: 0, categories: {} })).toEqual([])
    })

    it("omits empty categories rather than drawing zero-height slivers", () => {
        expect(stackSegments({ categories: { conflict: 0, air: 2 } }).map((s) => s.key)).toEqual(["air"])
    })
})

describe("calendarTicks — §11.1's axis", () => {
    it("steps 1 / 3 / 6 months by span", () => {
        expect(monthStep(300)).toBe(1)
        expect(monthStep(800)).toBe(3)
        expect(monthStep(4000)).toBe(6)
    })

    it("gives January the year, other months a lowercase 3-letter label", () => {
        const ticks = calendarTicks(ms("2025-11-01"), ms("2026-04-01"))
        const jan = ticks.find((t) => t.year)
        expect(jan.label).toBe("2026")
        expect(ticks.filter((t) => !t.year).every((t) => /^[a-z]{3}$/.test(t.label))).toBe(true)
    })

    it("positions every tick inside 0-100%", () => {
        for (const t of calendarTicks(ms("2013-03-11"), ms("2026-09-17"))) {
            expect(t.pct).toBeGreaterThanOrEqual(0)
            expect(t.pct).toBeLessThanOrEqual(100)
        }
    })

    it("returns nothing for an inverted span rather than looping", () => {
        expect(calendarTicks(ms("2026-01-01"), ms("2025-01-01"))).toEqual([])
    })
})

describe("transport — §11.1 playback", () => {
    it("advances 2 days x speed per 90ms tick", () => {
        expect(TICK_MS).toBe(90)
        expect(DAYS_PER_TICK).toBe(2)
        expect(SPEEDS).toEqual([0.5, 1, 2, 5])
        expect(advance(0, 1, 1000).offset).toBe(2)
        expect(advance(0, 5, 1000).offset).toBe(10)
    })

    it("stops at the end instead of running past it", () => {
        const { offset, done } = advance(999, 5, 1000)
        expect(offset).toBe(1000)
        expect(done).toBe(true)
    })
})

describe("barOpacity — the playhead reads as a position, not a filter", () => {
    it("is .95 in the past and .3 in the future", () => {
        expect(barOpacity(ms("2026-01-01"), ms("2026-06-01"))).toBe(0.95)
        expect(barOpacity(ms("2026-09-01"), ms("2026-06-01"))).toBe(0.3)
    })
})

describe("spanDays", () => {
    it("never returns zero, so callers can divide by it", () => {
        expect(spanDays(ms("2026-01-01"), ms("2026-01-01"))).toBe(1)
        expect(spanDays(ms("2026-01-01"), ms("2026-01-31"))).toBe(30)
    })
})
