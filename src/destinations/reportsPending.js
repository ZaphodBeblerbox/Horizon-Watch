// Shared "is this report actually awaiting human review" predicate — used by
// both Dashboard.jsx's stat-tile band ("pending AI Council reviews count")
// and AICouncil.jsx's nav-badge count, so the two destinations never quietly
// disagree about what "pending" means.
//
// Real field source: backend/main.py's submit-for-review endpoint
// (~line 18280) sets status="in_review", council_findings_json, and
// council_run_at all in the same synchronous transaction — so in practice
// every "in_review" report already has council_run_at set. A docstring
// elsewhere in main.py (~line 17861) notes a moment where a Report can be
// in_review with council_run_at still unset (a narrower/older code path) —
// checking council_run_at defensively costs nothing and avoids counting a
// report that hasn't actually finished its council pass yet.

/**
 * @param {object} report - a real Report dict from GET /api/reports (_report_to_dict shape)
 * @returns {boolean}
 */
export function isPendingCouncilReview(report) {
    if (!report) return false
    return report.status === "in_review" && !!report.council_run_at
}

/**
 * @param {object[]} reports
 * @returns {number}
 */
export function countPendingCouncilReviews(reports) {
    if (!Array.isArray(reports)) return 0
    return reports.filter(isPendingCouncilReview).length
}
