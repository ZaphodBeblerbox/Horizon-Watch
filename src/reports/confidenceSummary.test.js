import { describe, it, expect } from "vitest"
import { summarizeConfidence, confidenceLevelColor } from "./confidenceSummary.js"

function section(claims) {
    return { number: "1", section_id: "key_judgments", title: "Key Judgments", claims }
}

describe("summarizeConfidence — real pass/fail counting mirroring report_pdf.py's _finding_lines", () => {
    it("an all-clean report has zero flagged claims and level 'live'", () => {
        const sections = [section([
            { claim_id: "A", findings: [{ kind: "citation_exists", passed: true }] },
            { claim_id: "B", findings: [] },
        ])]
        const result = summarizeConfidence(sections)
        expect(result).toEqual({
            totalClaims: 2, flaggedClaims: 0, criticalClaims: 0, warnClaims: 0, cleanClaims: 2, level: "live",
        })
    })

    it("a failing citation_exists or geo_sanity finding counts as critical", () => {
        const sections = [section([
            { claim_id: "A", findings: [{ kind: "citation_exists", passed: false }] },
            { claim_id: "B", findings: [{ kind: "geo_sanity", passed: false }] },
        ])]
        const result = summarizeConfidence(sections)
        expect(result.criticalClaims).toBe(2)
        expect(result.level).toBe("danger")
    })

    it("an overstated/unsupported citation_fidelity verdict counts as warn, not critical", () => {
        const sections = [section([
            { claim_id: "A", findings: [{ kind: "citation_fidelity", verdict: "overstated" }] },
            { claim_id: "B", findings: [{ kind: "citation_fidelity", verdict: "unsupported" }] },
        ])]
        const result = summarizeConfidence(sections)
        expect(result.warnClaims).toBe(2)
        expect(result.criticalClaims).toBe(0)
        expect(result.level).toBe("warn")
    })

    it("a 'supported' citation_fidelity verdict is not flagged at all", () => {
        const sections = [section([
            { claim_id: "A", findings: [{ kind: "citation_fidelity", verdict: "supported" }] },
        ])]
        expect(summarizeConfidence(sections).flaggedClaims).toBe(0)
    })

    it("a completeness finding is informational only — never flags a claim (matches the PDF's 'note:' treatment)", () => {
        const sections = [section([
            { claim_id: "A", findings: [{ kind: "completeness", comment: "Could use more detail." }] },
        ])]
        const result = summarizeConfidence(sections)
        expect(result.flaggedClaims).toBe(0)
        expect(result.level).toBe("live")
    })

    it("critical takes precedence over warn when a single claim has both", () => {
        const sections = [section([
            {
                claim_id: "A", findings: [
                    { kind: "citation_exists", passed: false },
                    { kind: "citation_fidelity", verdict: "overstated" },
                ],
            },
        ])]
        const result = summarizeConfidence(sections)
        expect(result.criticalClaims).toBe(1)
        expect(result.warnClaims).toBe(0)
        expect(result.level).toBe("danger")
    })

    it("flattens claims across every section including the Annex, without double-counting", () => {
        const sections = [
            section([{ claim_id: "A", findings: [] }]),
            { number: "A", section_id: "annex", title: "Annexes", claims: [{ claim_id: "B", findings: [] }] },
        ]
        expect(summarizeConfidence(sections).totalClaims).toBe(2)
    })

    it("handles missing/empty input without crashing", () => {
        expect(summarizeConfidence(undefined).totalClaims).toBe(0)
        expect(summarizeConfidence([]).level).toBe("live")
    })
})

describe("confidenceLevelColor — real design-token mapping", () => {
    it("maps each level to its real token", () => {
        expect(confidenceLevelColor("danger")).toBe("var(--danger)")
        expect(confidenceLevelColor("warn")).toBe("var(--warn)")
        expect(confidenceLevelColor("live")).toBe("var(--live)")
    })

    it("falls back to the live/clean color for an unrecognized level", () => {
        expect(confidenceLevelColor("unknown")).toBe("var(--live)")
    })
})
