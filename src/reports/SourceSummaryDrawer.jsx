import { claimMetaLine } from "./citationLine.js"
import { bucketForKind, synthesizeFindingId } from "./findingBucket.js"
import Icon from "../ui/Icon.jsx"

/**
 * "View Source Summary" drawer — Reading mode. Real claim -> citation ->
 * council-finding chain for every claim in the report (flattened across all
 * 11 sections, same source the confidence strip counts from), so an analyst
 * can audit exactly what was cited and what the council found without
 * hunting through 10 sections individually. Surface uses --bg-card per the
 * task's own instruction to reuse that token for drawer/panel surfaces.
 *
 * Props:
 *   open     — bool
 *   onClose  — () => void
 *   sections — the real sections array from GET /api/reports/{id}/sections
 */
export default function SourceSummaryDrawer({ open, onClose, sections }) {
    if (!open) return null
    const claims = (sections || []).flatMap((s) =>
        (s.claims || []).map((c) => ({ ...c, sectionTitle: s.title, sectionNumber: s.number }))
    )

    return (
        <div
            style={{
                position: "absolute", inset: 0, background: "rgba(7,11,20,0.6)",
                display: "flex", justifyContent: "flex-end", zIndex: 40,
            }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(480px, 92%)", height: "100%", background: "var(--bg-card)",
                    borderLeft: "1px solid var(--border-strong)", overflowY: "auto",
                    padding: "var(--space-4)", boxShadow: "var(--shadow-callout)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
                    <span style={{ color: "var(--text-primary)", fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)" }}>
                        Source Summary
                    </span>
                    <button
                        onClick={onClose}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4 }}
                        aria-label="Close"
                    >
                        <Icon name="close" size={18} />
                    </button>
                </div>
                {claims.length === 0 && (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No claims in this report yet.</div>
                )}
                {claims.map((claim, i) => (
                    <div key={claim.claim_id || i} style={{ marginBottom: "var(--space-4)", paddingBottom: "var(--space-3)", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ color: "var(--text-muted)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                            {claim.sectionNumber}. {claim.sectionTitle}
                        </div>
                        <div style={{ color: "var(--text-primary)", fontSize: "var(--text-body)", marginBottom: 4 }}>{claim.text}</div>
                        <div style={{ color: "var(--text-secondary)", fontSize: "10px", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
                            {claimMetaLine(claim)}
                        </div>
                        {(claim.findings || []).length === 0 && (
                            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>No council findings recorded for this claim.</div>
                        )}
                        {(claim.findings || []).map((f) => (
                            <div
                                key={synthesizeFindingId(claim.claim_id, f.kind)}
                                style={{
                                    display: "flex", gap: 6, alignItems: "baseline", fontSize: "var(--text-xs)",
                                    color: f.passed === false || ["overstated", "unsupported"].includes(f.verdict) ? "var(--danger)" : "var(--text-secondary)",
                                    marginBottom: 2,
                                }}
                            >
                                <span style={{ fontWeight: "var(--weight-semibold)" }}>{bucketForKind(f.kind)}:</span>
                                <span>{f.detail || f.comment || f.verdict || (f.passed === false ? "failed" : "passed")}</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}
