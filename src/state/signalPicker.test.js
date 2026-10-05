/**
 * The picker's maths: one urgency vocabulary, sectors that survive the
 * cache, facet counts that do not over-promise, and buckets in reading
 * order.
 */
import { describe, it, expect } from "vitest"
import {
    URGENCY, urgencyRank, normaliseUrgency, sectorOfSnapshotSection,
    sectorOfSaved, urgencyOfSaved, facetCounts, sectorsPresent, urgenciesPresent,
    applyFilters, group, SAVED_READ,
} from "./signalPicker.js"

const S = (over = {}) => ({ id: Math.random().toString(36).slice(2), kind: "signal", ...over })

describe("normaliseUrgency", () => {
    it("passes the real bands through", () => {
        for (const u of URGENCY) expect(normaliseUrgency(u)).toBe(u)
    })
    it("folds the generator's words into the same five", () => {
        expect(normaliseUrgency("medium")).toBe("elevated")
        expect(normaliseUrgency("info")).toBe("routine")
        expect(normaliseUrgency("major")).toBe("significant")
        expect(normaliseUrgency("SEVERE")).toBe("critical")
    })
    it("calls an unknown word routine rather than inventing a band", () => {
        expect(normaliseUrgency("banana")).toBe("routine")
        expect(normaliseUrgency(null)).toBe("routine")
    })
})

describe("urgencyRank", () => {
    it("orders by urgency, not alphabetically", () => {
        const sorted = ["routine", "critical", "elevated"].sort((a, b) => urgencyRank(a) - urgencyRank(b))
        expect(sorted).toEqual(["critical", "elevated", "routine"])
    })
    it("puts an unknown band last", () => {
        expect(urgencyRank("banana")).toBeGreaterThan(urgencyRank("routine"))
    })
})

describe("sectorOfSnapshotSection", () => {
    it("uses the case tree's words, so Imagery means one thing", () => {
        expect(sectorOfSnapshotSection("sentinel_detections")).toBe("Imagery")
        expect(sectorOfSnapshotSection("ais_anomalies")).toBe("Vessels")
        expect(sectorOfSnapshotSection("fusion_events")).toBe("Surge & Fusion")
        expect(sectorOfSnapshotSection("surge_events")).toBe("Surge & Fusion")
    })
    it("does not drop an unknown bucket on the floor", () => {
        expect(sectorOfSnapshotSection("something_new")).toBe("Other")
    })
})

describe("sectorOfSaved", () => {
    // The cache keeps a thinned copy; the sector decided at filing time is
    // the only reliable one.
    it("prefers the stored sector over re-deriving it", () => {
        expect(sectorOfSaved({ sector: "Vessels", kind: "signal" })).toBe("Vessels")
    })
    it("falls back for an item saved before the sector was carried", () => {
        expect(sectorOfSaved({ kind: "signal", source: "ais" })).toBe("Vessels")
        expect(sectorOfSaved({ kind: "note" })).toBe("Notes")
    })
    it("ignores a blank stored sector rather than grouping under \"\"", () => {
        expect(sectorOfSaved({ sector: "  ", kind: "signal", domain: "adsb" })).toBe("Aircraft")
    })
})

describe("urgencyOfSaved", () => {
    it("reads either field and normalises it", () => {
        expect(urgencyOfSaved({ urgency: "critical" })).toBe("critical")
        expect(urgencyOfSaved({ severity: "medium" })).toBe("elevated")
        expect(urgencyOfSaved({})).toBe("routine")
    })
})

const CORPUS = [
    S({ sector: "Vessels", severity: "critical", headline: "Dark transit" }),
    S({ sector: "Vessels", severity: "routine", headline: "Port call" }),
    S({ sector: "Imagery", severity: "critical", headline: "New revetment" }),
    S({ sector: "Aircraft", severity: "elevated", headline: "ISR orbit" }),
]
const R = SAVED_READ

describe("facetCounts", () => {
    it("counts every band when nothing is filtered", () => {
        const { urgency, sector } = facetCounts(CORPUS, R)
        expect(urgency).toEqual({ critical: 2, routine: 1, elevated: 1 })
        expect(sector).toEqual({ Vessels: 2, Imagery: 1, Aircraft: 1 })
    })
    // A chip that says 2 and yields 0 rows is a lie about the data.
    it("counts each facet against the other's filter", () => {
        const { sector, urgency } = facetCounts(CORPUS, R, { urgency: new Set(["critical"]) })
        expect(sector).toEqual({ Vessels: 1, Imagery: 1 })
        // the urgency chips themselves still count the unfiltered-by-sector set
        expect(urgency).toEqual({ critical: 2, routine: 1, elevated: 1 })
    })
})

describe("applyFilters", () => {
    it("treats an empty facet as everything, not nothing", () => {
        expect(applyFilters(CORPUS, R, {}).length).toBe(4)
        expect(applyFilters(CORPUS, R, { urgency: new Set() }).length).toBe(4)
    })
    it("ands the two facets together", () => {
        const out = applyFilters(CORPUS, R, { urgency: new Set(["critical"]), sector: new Set(["Vessels"]) })
        expect(out.map((s) => s.headline)).toEqual(["Dark transit"])
    })
    it("searches the headline, region and source", () => {
        expect(applyFilters(CORPUS, R, { q: "revet" }).map((s) => s.headline)).toEqual(["New revetment"])
        expect(applyFilters(CORPUS, R, { q: "nothing here" })).toEqual([])
    })
})

describe("group", () => {
    it("orders urgency buckets by urgency", () => {
        expect(group(CORPUS, R, "urgency").map((g) => g.key)).toEqual(["critical", "elevated", "routine"])
    })
    it("orders sector buckets by how full they are", () => {
        expect(group(CORPUS, R, "sector").map((g) => g.key)).toEqual(["Vessels", "Aircraft", "Imagery"])
    })
    it("puts the most urgent first inside a sector bucket", () => {
        const vessels = group(CORPUS, R, "sector").find((g) => g.key === "Vessels")
        expect(vessels.items.map((s) => s.headline)).toEqual(["Dark transit", "Port call"])
    })
    it("is one unlabelled bucket when grouping is off", () => {
        const g = group(CORPUS, R, "none")
        expect(g.length).toBe(1)
        expect(g[0].key).toBe(null)
        expect(g[0].items.length).toBe(4)
    })
    it("is empty rather than one empty bucket", () => {
        expect(group([], R, "none")).toEqual([])
        expect(group([], R, "sector")).toEqual([])
    })
    it("does not mutate what it was given", () => {
        const before = CORPUS.map((s) => s.headline)
        group(CORPUS, R, "urgency")
        expect(CORPUS.map((s) => s.headline)).toEqual(before)
    })
})

describe("what is present", () => {
    it("lists urgencies in urgency order and sectors by size", () => {
        expect(urgenciesPresent(CORPUS, R)).toEqual(["critical", "elevated", "routine"])
        expect(sectorsPresent(CORPUS, R)).toEqual(["Vessels", "Aircraft", "Imagery"])
    })
})
