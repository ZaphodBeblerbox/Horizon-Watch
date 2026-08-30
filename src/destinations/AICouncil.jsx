/**
 * AICouncil.jsx — one of the 5 fixed top-level destinations (full UI
 * rebuild spec, section 8.5). Self-contained: fetches its own real data;
 * not wired into app.jsx by this file — the integrator renders it and
 * wires `onOpenReport`.
 *
 * "A real feed of AI Council comments across all reports currently in
 * council_review/human_review status... a single scrollable list... is
 * sufficient" — deliberately simple per the spec's own instruction not to
 * over-build this one.
 *
 * Real data: GET /api/reports?status=in_review, flattened via the already-
 * built/tested src/destinations/councilFindings.js (shared logic, not a
 * second guess at the council_findings shape).
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { EmptyState } from "../ui/index.js"
import Icon from "../ui/Icon.jsx"
import { flattenCouncilFindings, FINDING_TYPE } from "./councilFindings.js"
import { isPendingCouncilReview } from "./reportsPending.js"

const API = API_BASE
const REFRESH_MS = 60000

const TYPE_COLOR = {
    [FINDING_TYPE.DETERMINISTIC]: "var(--accent-blue)",
    [FINDING_TYPE.CITATION_FIDELITY]: "var(--warn)",
    [FINDING_TYPE.COMPLETENESS]: "var(--accent-cyan)",
}

const STATUS_TOKEN = {
    passed: "var(--live)", failed: "var(--danger)",
    ok: "var(--live)", error: "var(--danger)", skipped: "var(--text-muted)",
    supported: "var(--live)", overstated: "var(--warn)", unsupported: "var(--danger)",
}

function FindingRow({ row, onOpenReport }) {
    return (
        <button
            onClick={() => onOpenReport?.(row.reportId, row.claimId)}
            style={{
                display: "flex", alignItems: "flex-start", gap: "var(--space-3)", width: "100%",
                textAlign: "left", padding: "var(--space-3)", background: "var(--bg-panel)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                cursor: "pointer", fontFamily: "var(--font-sans)", marginBottom: "var(--space-2)",
            }}
        >
            <div style={{
                width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                background: STATUS_TOKEN[row.status] || "var(--text-muted)",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span style={{
                        fontSize: "var(--text-chip)", fontWeight: "var(--weight-semibold)",
                        color: TYPE_COLOR[row.type] || "var(--text-secondary)", textTransform: "uppercase",
                        letterSpacing: "0.04em",
                    }}>
                        {row.type}
                    </span>
                    <span style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)" }}>
                        {row.status}
                    </span>
                </div>
                <div style={{
                    fontSize: "var(--text-body)", color: "var(--text-primary)", marginTop: 4,
                    fontWeight: "var(--weight-medium)",
                }}>
                    {row.reportTitle}
                    {row.claimId != null && (
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontWeight: "var(--weight-normal)" }}>
                            {" "}· claim {row.claimId}
                        </span>
                    )}
                </div>
                {row.detail && (
                    <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)", marginTop: 4 }}>
                        {row.detail}
                    </div>
                )}
            </div>
            <Icon name="jumpTo" size={14} color="var(--text-muted)" />
        </button>
    )
}

export default function AICouncil({ onOpenReport, onCountChange }) {
    const [reports, setReports] = useState([])

    useEffect(() => {
        let cancelled = false
        const load = () =>
            fetch(`${API}/api/reports?status=in_review`)
                .then((r) => (r.ok ? r.json() : []))
                .then((d) => { if (!cancelled) setReports(Array.isArray(d) ? d.filter(isPendingCouncilReview) : []) })
                .catch(() => {})
        load()
        const t = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const rows = useMemo(() => flattenCouncilFindings(reports), [reports])

    useEffect(() => { onCountChange?.(reports.length) }, [reports.length, onCountChange])

    return (
        <div style={{
            height: "100%", overflowY: "auto", padding: "var(--space-4)",
            background: "var(--bg-app)", fontFamily: "var(--font-sans)",
        }}>
            <div style={{
                fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)",
                color: "var(--text-primary)", marginBottom: "var(--space-4)",
            }}>
                AI Council
            </div>
            {rows.length === 0 ? (
                <EmptyState title="Nothing awaiting review" description="No reports currently have real AI Council findings pending." />
            ) : (
                <div style={{ maxWidth: 720 }}>
                    {rows.map((row) => (
                        <FindingRow key={row.key} row={row} onOpenReport={onOpenReport} />
                    ))}
                </div>
            )}
        </div>
    )
}
