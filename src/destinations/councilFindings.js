// Pure, dependency-free helpers for AICouncil.jsx — kept free of React so
// they're directly unit-testable (see councilFindings.test.js).
//
// Real shape source: backend/report_council.py's run_council(), whose return
// value is stored verbatim (json.dumps) as Report.council_findings_json and
// exposed by _report_to_dict() as report.council_findings:
//   {
//     deterministic:     [{claim_id, check, passed, detail}],
//     citation_fidelity: {status: "ok"|"skipped"|"error", reason?, findings: [{claim_id, verdict, comment}]},
//     completeness:      {status: "ok"|"skipped"|"error", reason?, overall_comment?, per_claim?: [{claim_id, comment}]},
//   }
// The 3 real kinds the spec calls out map 1:1 onto these 3 top-level keys —
// both of `deterministic`'s real check names (citation_exists, geo_sanity)
// collapse into the single "Citation Check" label since they're both the
// cheap, no-model-call fact-check pass, distinct from the model-based
// "Citation Fidelity" lens.

export const FINDING_TYPE = {
    DETERMINISTIC:      "Citation Check",
    CITATION_FIDELITY:  "Citation Fidelity",
    COMPLETENESS:       "Completeness",
}

/**
 * Flatten one report's real council_findings into feed rows. Returns []
 * if the report has no council_findings yet (defensive — every report this
 * component fetches should have one, since GET /api/reports?status=in_review
 * only returns reports whose council pass already ran, but a report seeded
 * directly into the DB without going through submit-for-review could lack
 * one).
 *
 * @param {object} report - real Report dict (_report_to_dict shape)
 * @returns {object[]} rows: {key, reportId, reportTitle, type, claimId, status, detail}
 */
export function flattenReportFindings(report) {
    const cf = report?.council_findings
    if (!cf) return []
    const reportId = report.report_id
    const reportTitle = report.title || reportId
    const rows = []

    for (const f of (Array.isArray(cf.deterministic) ? cf.deterministic : [])) {
        rows.push({
            key: `${reportId}-det-${f.claim_id}-${f.check}`,
            reportId, reportTitle,
            type: FINDING_TYPE.DETERMINISTIC,
            claimId: f.claim_id ?? null,
            status: f.passed ? "passed" : "failed",
            detail: f.detail || "",
        })
    }

    const fidelity = cf.citation_fidelity
    if (fidelity) {
        const findings = Array.isArray(fidelity.findings) ? fidelity.findings : []
        for (const f of findings) {
            rows.push({
                key: `${reportId}-fid-${f.claim_id}`,
                reportId, reportTitle,
                type: FINDING_TYPE.CITATION_FIDELITY,
                claimId: f.claim_id ?? null,
                status: f.verdict || "unknown",
                detail: f.comment || "",
            })
        }
        // Lens didn't actually produce per-claim findings (skipped — no
        // Claude client configured — or errored) — surface that honestly
        // instead of silently omitting the whole lens from the feed.
        if (fidelity.status && fidelity.status !== "ok" && findings.length === 0) {
            rows.push({
                key: `${reportId}-fid-status`,
                reportId, reportTitle,
                type: FINDING_TYPE.CITATION_FIDELITY,
                claimId: null,
                status: fidelity.status,
                detail: fidelity.reason || "",
            })
        }
    }

    const completeness = cf.completeness
    if (completeness) {
        if (completeness.overall_comment) {
            rows.push({
                key: `${reportId}-comp-overall`,
                reportId, reportTitle,
                type: FINDING_TYPE.COMPLETENESS,
                claimId: null,
                status: completeness.status || "ok",
                detail: completeness.overall_comment,
            })
        }
        for (const c of (Array.isArray(completeness.per_claim) ? completeness.per_claim : [])) {
            rows.push({
                key: `${reportId}-comp-${c.claim_id}`,
                reportId, reportTitle,
                type: FINDING_TYPE.COMPLETENESS,
                claimId: c.claim_id ?? null,
                status: completeness.status || "ok",
                detail: c.comment || "",
            })
        }
        if (completeness.status && completeness.status !== "ok"
            && !completeness.overall_comment
            && (!Array.isArray(completeness.per_claim) || completeness.per_claim.length === 0)) {
            rows.push({
                key: `${reportId}-comp-status`,
                reportId, reportTitle,
                type: FINDING_TYPE.COMPLETENESS,
                claimId: null,
                status: completeness.status,
                detail: completeness.reason || "",
            })
        }
    }

    return rows
}

/**
 * Flatten every real finding across a whole GET /api/reports?status=in_review
 * response into one feed, in the same report order the caller passed in
 * (list_reports() already orders by created_at desc).
 *
 * @param {object[]} reports
 * @returns {object[]}
 */
export function flattenCouncilFindings(reports) {
    if (!Array.isArray(reports)) return []
    return reports.flatMap(flattenReportFindings)
}
