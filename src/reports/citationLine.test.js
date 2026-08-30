import { describe, it, expect } from "vitest"
import { citationLine, sourceEvalLine, claimMetaLine } from "./citationLine.js"

describe("citationLine — mirrors backend/report_pdf.py's _citation_line exactly", () => {
    it("formats a snapshot_ref citation", () => {
        expect(citationLine({ type: "snapshot_ref", section: "ais_anomalies", item_id: "AIS-1" }))
            .toBe("Source: snapshot data — ais_anomalies / AIS-1")
    })

    it("falls back to '?' for a snapshot_ref missing section/item_id", () => {
        expect(citationLine({ type: "snapshot_ref" })).toBe("Source: snapshot data — ? / ?")
    })

    it("formats an external citation", () => {
        expect(citationLine({ type: "external", url: "https://example.org/x" }))
            .toBe("Source: https://example.org/x")
    })

    it("falls back to 'no URL provided' for an external citation missing a url", () => {
        expect(citationLine({ type: "external" })).toBe("Source: no URL provided")
    })

    it("reports 'unrecognized format' for an unknown citation type", () => {
        expect(citationLine({ type: "carrier_pigeon" })).toBe("Citation: unrecognized format")
    })

    it("reports 'none provided' for a missing/non-object citation", () => {
        expect(citationLine(null)).toBe("Citation: none provided")
        expect(citationLine(undefined)).toBe("Citation: none provided")
        expect(citationLine("not an object")).toBe("Citation: none provided")
    })
})

describe("sourceEvalLine — mirrors backend/report_pdf.py's _source_eval_line exactly", () => {
    it("returns empty when neither reliability nor credibility is present", () => {
        expect(sourceEvalLine(null)).toBe("")
        expect(sourceEvalLine({})).toBe("")
        expect(sourceEvalLine({ confidence_label: "High" })).toBe("")
    })

    it("formats the NATO Admiralty reliability/credibility code", () => {
        expect(sourceEvalLine({ reliability: "B", credibility: "2" })).toBe("Source Evaluation: B2")
    })

    it("appends the confidence label only when present", () => {
        expect(sourceEvalLine({ reliability: "B", credibility: "2", confidence_label: "High" }))
            .toBe("Source Evaluation: B2 / Confidence: High")
    })

    it("tolerates a partial code (only one of reliability/credibility present)", () => {
        expect(sourceEvalLine({ reliability: "A" })).toBe("Source Evaluation: A?")
    })
})

describe("claimMetaLine — joins citation + source evaluation the same way _render_claims does", () => {
    it("joins with the real '  ·  ' separator when a source evaluation is present", () => {
        const claim = {
            citation: { type: "snapshot_ref", section: "ais_anomalies", item_id: "AIS-1" },
            source_evaluation: { reliability: "B", credibility: "2" },
        }
        expect(claimMetaLine(claim)).toBe("Source: snapshot data — ais_anomalies / AIS-1  ·  Source Evaluation: B2")
    })

    it("omits the separator entirely when there is no source evaluation", () => {
        const claim = { citation: { type: "external", url: "https://example.org/x" } }
        expect(claimMetaLine(claim)).toBe("Source: https://example.org/x")
    })

    it("does not crash on a claim with no citation at all", () => {
        expect(claimMetaLine({})).toBe("Citation: none provided")
        expect(claimMetaLine(undefined)).toBe("Citation: none provided")
    })
})
