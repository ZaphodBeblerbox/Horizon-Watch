// Pure, dependency-free mapping from a real council finding's `kind` (as
// returned by GET /api/reports/{id}/sections — see backend/report_sections.py
// `_findings_for_claim()`) to the 3 filter/label buckets Editing mode uses:
// left-column comment filter (All/Substantive/Clarity/Source) AND each
// comment well's "AI Council Comment · {Type}" header — same mapping,
// documented once here so both stay in sync.
//
// Real finding kinds that exist in this codebase today (report_council.py /
// report_sections.py `_findings_for_claim`):
//   - "citation_exists" (deterministic, no model call) — does the cited
//     snapshot item_id actually exist?
//   - "geo_sanity" (deterministic, no model call) — is the claim's asserted
//     location geographically sane relative to its citation?
//   - "citation_fidelity" (model lens) — does the cited source actually
//     support what the claim asserts (verdict: supported/overstated/unsupported)?
//   - "completeness" (model lens) — report-level completeness commentary,
//     surfaced per-claim when the model attaches a per_claim comment.
//
// Bucket mapping (a REAL editorial choice, not a backend-defined field —
// documented explicitly per the task's own instruction, since the backend
// has no concept of "Substantive/Clarity/Source" buckets):
//   citation_exists, geo_sanity -> "Source"     (is the citation itself real/valid)
//   citation_fidelity           -> "Substantive" (does the source really say that)
//   completeness                -> "Clarity"     (is anything missing/unclear)
// Any unrecognized future kind maps to "Other" rather than silently
// vanishing from every filter bucket.
const KIND_TO_BUCKET = {
    citation_exists:    "Source",
    geo_sanity:         "Source",
    citation_fidelity:  "Substantive",
    completeness:       "Clarity",
}

// Fixed, real filter order shown in Editing mode's left column.
export const FILTER_BUCKETS = ["All", "Substantive", "Clarity", "Source"]

/**
 * Resolve a finding's real `kind` to its display bucket/label. Never
 * undefined — an unrecognized kind still gets a real, visible label.
 */
export function bucketForKind(kind) {
    return KIND_TO_BUCKET[kind] || "Other"
}

/**
 * Does this finding belong under the given left-column filter selection?
 * "All" (or any falsy filter) always matches.
 */
export function matchesFilter(kind, filter) {
    if (!filter || filter === "All") return true
    return bucketForKind(kind) === filter
}

/**
 * Synthesize a stable id for a finding so it can be displayed (mono, in the
 * comment well header) and used as a React key / local "resolved" state key.
 * Real findings have no id field of their own in the backend (they're
 * derived on the fly by report_sections.py, not a stored row) — this
 * combines the real claim_id they're anchored to with their real kind,
 * which is stable as long as the same claim doesn't get two findings of the
 * same kind (true for every real path in report_council.py today: at most
 * one citation_exists, one geo_sanity, one citation_fidelity verdict, and
 * one completeness comment per claim).
 */
export function synthesizeFindingId(claimId, kind) {
    return `${claimId ?? "UNKNOWN-CLAIM"}::${kind ?? "unknown"}`
}
