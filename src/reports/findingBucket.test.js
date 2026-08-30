import { describe, it, expect } from "vitest"
import { FILTER_BUCKETS, bucketForKind, matchesFilter, synthesizeFindingId } from "./findingBucket.js"

describe("bucketForKind — real findings.kind -> Substantive/Clarity/Source mapping", () => {
    it("maps the two deterministic citation-integrity checks to Source", () => {
        expect(bucketForKind("citation_exists")).toBe("Source")
        expect(bucketForKind("geo_sanity")).toBe("Source")
    })

    it("maps citation_fidelity (does the source really say that) to Substantive", () => {
        expect(bucketForKind("citation_fidelity")).toBe("Substantive")
    })

    it("maps completeness (is anything missing/unclear) to Clarity", () => {
        expect(bucketForKind("completeness")).toBe("Clarity")
    })

    it("falls back to 'Other' for an unrecognized kind rather than undefined", () => {
        expect(bucketForKind("some_future_check")).toBe("Other")
        expect(bucketForKind(undefined)).toBe("Other")
    })
})

describe("matchesFilter", () => {
    it("'All' matches every real kind", () => {
        for (const kind of ["citation_exists", "geo_sanity", "citation_fidelity", "completeness", "anything"]) {
            expect(matchesFilter(kind, "All")).toBe(true)
        }
    })

    it("a specific bucket only matches its own mapped kinds", () => {
        expect(matchesFilter("citation_exists", "Source")).toBe(true)
        expect(matchesFilter("citation_fidelity", "Source")).toBe(false)
        expect(matchesFilter("citation_fidelity", "Substantive")).toBe(true)
        expect(matchesFilter("completeness", "Clarity")).toBe(true)
        expect(matchesFilter("completeness", "Source")).toBe(false)
    })

    it("treats a missing/falsy filter the same as 'All'", () => {
        expect(matchesFilter("completeness", undefined)).toBe(true)
        expect(matchesFilter("completeness", "")).toBe(true)
    })

    it("FILTER_BUCKETS is the fixed, real 4-item order", () => {
        expect(FILTER_BUCKETS).toEqual(["All", "Substantive", "Clarity", "Source"])
    })
})

describe("synthesizeFindingId — stable id combining real claim_id + real kind", () => {
    it("combines claim_id and kind with a stable separator", () => {
        expect(synthesizeFindingId("RCLM-ABC123", "citation_exists")).toBe("RCLM-ABC123::citation_exists")
    })

    it("is stable across repeated calls with the same inputs", () => {
        expect(synthesizeFindingId("RCLM-X", "completeness")).toBe(synthesizeFindingId("RCLM-X", "completeness"))
    })

    it("distinguishes two different kinds on the same claim", () => {
        expect(synthesizeFindingId("RCLM-X", "citation_exists"))
            .not.toBe(synthesizeFindingId("RCLM-X", "geo_sanity"))
    })

    it("never crashes on missing claim_id/kind", () => {
        expect(() => synthesizeFindingId(undefined, undefined)).not.toThrow()
        expect(synthesizeFindingId(undefined, undefined)).toBe("UNKNOWN-CLAIM::unknown")
    })
})
