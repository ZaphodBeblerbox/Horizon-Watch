// Pure, dependency-free helpers shared by TaskList.jsx and TaskStatusBar.jsx.
// Kept free of React so they can be unit-tested in plain Node — see
// taskDisplay.test.js — following the src/globe/markerRenderer.js precedent.

// All 10 real ReportTask status values (backend/routes for /api/reports/tasks).
// `approved`/`rejected` are real reachable branches beyond the 8 commonly
// cited ones (council_review -> human_review -> approved|rejected), so they
// get real colors here too — never a silent fallback to undefined.
export const TASK_STATUSES = [
    "queued", "collecting", "ready_to_draft", "drafting",
    "council_review", "human_review", "approved", "rejected",
    "published", "archived",
]

// Status -> Round 1 design-token color mapping.
//
// Reasoning:
//   queued/collecting     — nothing to review yet, dim/neutral (--text-dim / --sev-medium for the
//                            "in progress" collecting state, so it reads as active-but-not-actionable)
//   ready_to_draft/drafting — this task is now actionable by the analyst -> --accent
//   council_review/human_review — needs a human's attention/judgment -> --sev-high (amber)
//   approved            — favorable outcome, on its way to publish -> --accent (still "in the drafting/approval pipeline")
//   rejected            — a real dead-end/failure outcome -> --sev-critical
//   published           — done, successful, live -> --sev-low (green)
//   archived            — finished, inactive -> --text-dim
const STATUS_COLORS = {
    queued:          "var(--text-dim)",
    collecting:      "var(--sev-medium)",
    ready_to_draft:  "var(--accent)",
    drafting:        "var(--accent)",
    council_review:  "var(--sev-high)",
    human_review:    "var(--sev-high)",
    approved:        "var(--accent)",
    rejected:        "var(--sev-critical)",
    published:       "var(--sev-low)",
    archived:        "var(--text-dim)",
}

/**
 * Resolve the badge color token for a real ReportTask status value.
 * Every one of the 10 real statuses is mapped explicitly; an unrecognized
 * value (should not happen with the real backend) falls back to
 * --text-dim rather than undefined, so a badge never renders unstyled.
 */
export function statusBadgeColor(status) {
    return STATUS_COLORS[status] || "var(--text-dim)"
}

/**
 * Format a ReportTask's `region` field for display.
 * Real shapes: an explicit array of region-name strings, the literal
 * string "auto" (Mission Profile's focus regions), or null/undefined
 * (unscoped — pre-dates the auto/explicit distinction, or never set).
 */
export function formatTaskRegion(task) {
    const region = task?.region
    if (Array.isArray(region)) return region.join(", ")
    // "auto" (real literal) passes through as-is; null/undefined -> "unscoped"
    return region || "unscoped"
}
