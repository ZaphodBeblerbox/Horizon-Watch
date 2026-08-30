import { describe, it, expect } from "vitest"
import { flattenReportFindings, flattenCouncilFindings, FINDING_TYPE } from "./councilFindings.js"

// Realistic-shaped fixture — the exact real return shape of
// backend/report_council.py's run_council(), as stored on
// Report.council_findings_json and exposed via _report_to_dict().
const REPORT_WITH_FINDINGS = {
    report_id: "RPT-2026-0044",
    title: "Red Sea Chokepoint Pressure — Weekly Assessment",
    status: "in_review",
    council_run_at: "2026-08-29T14:10:00",
    council_findings: {
        deterministic: [
            { claim_id: "C1", check: "citation_exists", passed: true, detail: "found FUS-2026-0091 in snapshot section fusion_events" },
            { claim_id: "C1", check: "geo_sanity", passed: false, detail: "'Bab-el-Mandeb Strait' does NOT contain (12.6, 43.4)" },
            { claim_id: "C2", check: "citation_exists", passed: false, detail: "citation is missing or not an object" },
        ],
        citation_fidelity: {
            status: "ok",
            findings: [
                { claim_id: "C1", verdict: "overstated", comment: "Claim implies certainty the cited data doesn't support." },
                { claim_id: "C2", verdict: "supported", comment: "Wording matches the cited excerpt." },
            ],
        },
        completeness: {
            status: "ok",
            overall_comment: "Report doesn't mention the competing regional-actor hypothesis.",
            per_claim: [
                { claim_id: "C1", comment: "Consider noting confidence interval." },
            ],
        },
    },
}

const REPORT_SKIPPED_LENSES = {
    report_id: "RPT-2026-0045",
    title: "Horn of Africa Maritime Risk",
    status: "in_review",
    council_run_at: "2026-08-29T15:00:00",
    council_findings: {
        deterministic: [
            { claim_id: "C1", check: "citation_exists", passed: true, detail: "ok" },
        ],
        citation_fidelity: { status: "skipped", reason: "no Claude client configured", findings: [] },
        completeness: { status: "skipped", reason: "no Claude client configured", findings: [] },
    },
}

const REPORT_NO_FINDINGS = {
    report_id: "RPT-2026-0046",
    title: "Never submitted for review",
    status: "in_review",
    council_run_at: null,
    council_findings: null,
}

describe("flattenReportFindings", () => {
    it("flattens all 3 real kinds with the exact spec-mandated labels", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const types = new Set(rows.map(r => r.type))
        expect(types).toEqual(new Set([FINDING_TYPE.DETERMINISTIC, FINDING_TYPE.CITATION_FIDELITY, FINDING_TYPE.COMPLETENESS]))
    })

    it("labels both deterministic check kinds (citation_exists, geo_sanity) as 'Citation Check'", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const detRows = rows.filter(r => r.type === FINDING_TYPE.DETERMINISTIC)
        expect(detRows).toHaveLength(3)
        expect(detRows.every(r => r.type === "Citation Check")).toBe(true)
    })

    it("maps deterministic passed/failed to a status string", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const geo = rows.find(r => r.detail.includes("does NOT contain"))
        expect(geo.status).toBe("failed")
    })

    it("carries the citation_fidelity verdict through as status", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const fid = rows.filter(r => r.type === FINDING_TYPE.CITATION_FIDELITY)
        expect(fid).toHaveLength(2)
        expect(fid.find(r => r.claimId === "C1").status).toBe("overstated")
    })

    it("includes the completeness overall_comment as a report-level row (claimId null)", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const overall = rows.find(r => r.type === FINDING_TYPE.COMPLETENESS && r.claimId === null)
        expect(overall).toBeTruthy()
        expect(overall.detail).toMatch(/competing regional-actor/)
    })

    it("includes per-claim completeness rows too", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        const perClaim = rows.find(r => r.type === FINDING_TYPE.COMPLETENESS && r.claimId === "C1")
        expect(perClaim).toBeTruthy()
    })

    it("every row carries the reportId/reportTitle for the feed's grouping/link", () => {
        const rows = flattenReportFindings(REPORT_WITH_FINDINGS)
        expect(rows.every(r => r.reportId === "RPT-2026-0044")).toBe(true)
        expect(rows.every(r => r.reportTitle === "Red Sea Chokepoint Pressure — Weekly Assessment")).toBe(true)
    })

    it("surfaces a skipped model lens honestly instead of silently dropping it", () => {
        const rows = flattenReportFindings(REPORT_SKIPPED_LENSES)
        const fidRow = rows.find(r => r.type === FINDING_TYPE.CITATION_FIDELITY)
        expect(fidRow.status).toBe("skipped")
        expect(fidRow.detail).toBe("no Claude client configured")
        const compRow = rows.find(r => r.type === FINDING_TYPE.COMPLETENESS)
        expect(compRow.status).toBe("skipped")
    })

    it("returns [] for a report with no council_findings at all", () => {
        expect(flattenReportFindings(REPORT_NO_FINDINGS)).toEqual([])
    })

    it("never throws on malformed/empty input", () => {
        expect(() => flattenReportFindings({})).not.toThrow()
        expect(() => flattenReportFindings(null)).not.toThrow()
        expect(flattenReportFindings(null)).toEqual([])
    })
})

describe("flattenCouncilFindings", () => {
    it("flattens across multiple reports, preserving caller order", () => {
        const rows = flattenCouncilFindings([REPORT_WITH_FINDINGS, REPORT_SKIPPED_LENSES])
        expect(rows[0].reportId).toBe("RPT-2026-0044")
        expect(rows[rows.length - 1].reportId).toBe("RPT-2026-0045")
    })

    it("skips reports with no findings without throwing", () => {
        const rows = flattenCouncilFindings([REPORT_NO_FINDINGS, REPORT_WITH_FINDINGS])
        expect(rows.every(r => r.reportId === "RPT-2026-0044")).toBe(true)
    })

    it("returns [] for a non-array input", () => {
        expect(flattenCouncilFindings(null)).toEqual([])
        expect(flattenCouncilFindings(undefined)).toEqual([])
    })
})
