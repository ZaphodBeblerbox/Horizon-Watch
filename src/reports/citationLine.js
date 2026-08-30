// Pure, dependency-free mirror of backend/report_pdf.py's `_citation_line`
// and `_source_eval_line` — the exact real string format the exported PDF
// prints under each claim. Kept as a byte-for-byte JS port (not a
// reinterpretation) so a claim's citation line reads identically on screen
// (Reading mode) and in the downloaded PDF — the whole point of both reading
// from GET /api/reports/{id}/sections in the first place.
//
// Python source (backend/report_pdf.py):
//   def _citation_line(citation: dict) -> str:
//       if not isinstance(citation, dict):
//           return "Citation: none provided"
//       if citation.get("type") == "snapshot_ref":
//           return f"Source: snapshot data — {citation.get('section', '?')} / {citation.get('item_id', '?')}"
//       if citation.get("type") == "external":
//           return f"Source: {citation.get('url', 'no URL provided')}"
//       return "Citation: unrecognized format"
//
//   def _source_eval_line(ev) -> str:
//       if not isinstance(ev, dict) or not (ev.get("reliability") or ev.get("credibility")):
//           return ""
//       code = f"{ev.get('reliability', '?')}{ev.get('credibility', '?')}"
//       label = ev.get("confidence_label")
//       return f"Source Evaluation: {code}" + (f" / Confidence: {label}" if label else "")
//
// Note on Python's dict.get(key, default) vs JS: Python's .get() only uses
// the default when the key is entirely ABSENT; a key present with value
// `null`/`None` is returned as-is (rendering "None", not "?"). Real claims
// built through backend/main.py's _validate_claims() never set these keys to
// null (either the key is present with a real string, or omitted entirely),
// so `??` (which also treats null the same as missing) reproduces the real
// behavior for every real claim shape this app can ever construct.

export function citationLine(citation) {
    if (!citation || typeof citation !== "object") return "Citation: none provided"
    if (citation.type === "snapshot_ref") {
        const section = citation.section ?? "?"
        const itemId = citation.item_id ?? "?"
        return `Source: snapshot data — ${section} / ${itemId}`
    }
    if (citation.type === "external") {
        return `Source: ${citation.url || "no URL provided"}`
    }
    return "Citation: unrecognized format"
}

export function sourceEvalLine(evaluation) {
    if (!evaluation || typeof evaluation !== "object") return ""
    if (!(evaluation.reliability || evaluation.credibility)) return ""
    const code = `${evaluation.reliability ?? "?"}${evaluation.credibility ?? "?"}`
    const label = evaluation.confidence_label
    return `Source Evaluation: ${code}` + (label ? ` / Confidence: ${label}` : "")
}

/**
 * The full meta line rendered under a claim, matching how report_pdf.py's
 * _render_claims() joins the two (`meta += "  ·  " + ev_line` when present).
 */
export function claimMetaLine(claim) {
    const citation = citationLine(claim?.citation)
    const evalLine = sourceEvalLine(claim?.source_evaluation)
    return evalLine ? `${citation}  ·  ${evalLine}` : citation
}
