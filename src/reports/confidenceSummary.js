// Pure, dependency-free counting for the bottom-of-document confidence /
// source-evaluation strip in Reading mode. Real input: the array of 11
// section objects returned by GET /api/reports/{id}/sections (10 fixed
// sections + Annex), each carrying `claims: [{..., findings: [...]}]`.
//
// "Worth flagging" mirrors backend/report_pdf.py's `_finding_lines()` exactly
// — the same 2 real finding shapes it prints with a "⚠" marker, so a claim
// this strip counts as a problem is the same claim that shows a warning
// line in the exported PDF (a "note:" completeness comment is informational,
// not a confidence problem, in both places):
//   - kind "citation_exists" or "geo_sanity" with passed === false
//     (a deterministic check actually failed — the citation itself is bad).
//   - kind "citation_fidelity" with verdict "overstated" or "unsupported"
//     (a model lens found the source doesn't really back the claim).
// A claim with a "citation_exists"/"geo_sanity" failure is counted as the
// more severe of the two if a claim somehow carries both (rare in practice —
// today's report_council.py runs deterministic checks and citation_fidelity
// independently per claim, so both firing on one claim is possible).

function isCriticalFinding(f) {
    return (f?.kind === "citation_exists" || f?.kind === "geo_sanity") && f?.passed === false
}

function isSubstantiveIssueFinding(f) {
    return f?.kind === "citation_fidelity" && (f?.verdict === "overstated" || f?.verdict === "unsupported")
}

/**
 * Summarize real pass/fail counts across every claim in the report (flattens
 * every section + Annex's `claims` — together they contain every real claim
 * exactly once, per report_sections.py's own claimed_ids bookkeeping).
 */
export function summarizeConfidence(sections) {
    const claims = Array.isArray(sections) ? sections.flatMap((s) => s?.claims || []) : []
    let criticalClaims = 0
    let warnClaims = 0
    for (const claim of claims) {
        const findings = claim?.findings || []
        if (findings.some(isCriticalFinding)) {
            criticalClaims += 1
        } else if (findings.some(isSubstantiveIssueFinding)) {
            warnClaims += 1
        }
    }
    const totalClaims = claims.length
    const flaggedClaims = criticalClaims + warnClaims
    return {
        totalClaims,
        flaggedClaims,
        criticalClaims,
        warnClaims,
        cleanClaims: totalClaims - flaggedClaims,
        level: criticalClaims > 0 ? "danger" : warnClaims > 0 ? "warn" : "live",
    }
}

/** Design-token color for a confidence level, per the spec's own instruction
 * ("colored via --danger/--warn/--live"). */
export function confidenceLevelColor(level) {
    if (level === "danger") return "var(--danger)"
    if (level === "warn") return "var(--warn)"
    return "var(--live)"
}
