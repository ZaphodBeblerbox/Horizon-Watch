import { useMemo, useState } from "react"
import ReportMapTab from "./ReportMapTab.jsx"
import SectionHeader from "./SectionHeader.jsx"
import SourceSummaryDrawer from "./SourceSummaryDrawer.jsx"
import { claimMetaLine } from "./citationLine.js"
import { summarizeConfidence, confidenceLevelColor } from "./confidenceSummary.js"
import { coordsForRegion } from "../data/regionCoords.js"
import { Button } from "../ui/index.js"

// Real Report status -> color, distinct from taskDisplay.js's ReportTask
// status mapping (a different status machine: draft/in_review/approved/
// rejected/published, not the 10 ReportTask states).
const REPORT_STATUS_COLORS = {
    draft: "var(--text-muted)",
    in_review: "var(--warn)",
    approved: "var(--accent-blue)",
    rejected: "var(--danger)",
    published: "var(--live)",
}

function StatusPill({ report, task }) {
    const archived = task?.status === "archived"
    const label = archived ? "ARCHIVED" : report?.status === "published" ? "LIVE" : (report?.status || "draft").replace("_", " ").toUpperCase()
    const color = archived ? "var(--text-muted)" : (REPORT_STATUS_COLORS[report?.status] || "var(--text-muted)")
    return (
        <span style={{
            fontSize: "var(--text-chip)", padding: "2px 8px", borderRadius: "var(--radius-pill)",
            background: `color-mix(in srgb, ${color} 18%, transparent)`, color, fontWeight: "var(--weight-semibold)",
            textTransform: "uppercase", letterSpacing: "0.04em",
        }}>{label}</span>
    )
}

// geoById: claim_id -> {lat, lon}, derived from the real Report.claims array
// (GET /api/reports/{id}), NOT the sections endpoint's claim view — see
// backend/report_sections.py's `_claim_view()`, which intentionally strips a
// claim down to {claim_id, text, citation, source_evaluation, findings} and
// does not carry lat/lon through. The raw Report.claims a claim was created
// with (backend/main.py's `_validate_claims`) DOES keep lat/lon, so this
// component fetches the full report separately and merges the two by
// claim_id to know which claims have a real, derivable location to jump to.
function ClaimList({ claims, geoById, onJump, emptyMessage }) {
    if (!claims || claims.length === 0) {
        return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{emptyMessage}</div>
    }
    return claims.map((claim, i) => {
        const geo = geoById?.[claim.claim_id]
        const jumpable = claim?.citation?.type === "snapshot_ref" && !!geo
        return (
            <div key={claim.claim_id || i} style={{ marginBottom: "var(--space-3)", maxWidth: "68ch" }}>
                {jumpable ? (
                    <span
                        role="button" tabIndex={0}
                        onClick={() => onJump(claim, geo)}
                        onKeyDown={(e) => { if (e.key === "Enter") onJump(claim, geo) }}
                        style={{ color: "var(--text-link)", cursor: "pointer", fontSize: "var(--text-body)", lineHeight: "20px" }}
                    >
                        {i + 1}. {claim.text}
                    </span>
                ) : (
                    <span style={{ color: "var(--text-primary)", fontSize: "var(--text-body)", lineHeight: "20px" }}>
                        {i + 1}. {claim.text}
                    </span>
                )}
                <div style={{ color: "var(--text-secondary)", fontSize: "10px", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {claimMetaLine(claim)}
                </div>
            </div>
        )
    })
}

/**
 * Renders one section's body content, mirroring backend/report_pdf.py's
 * `_render_section()` switch on section_id exactly (same section types, same
 * fallback empty-messages) so the screen and the exported PDF never
 * structurally diverge.
 */
function SectionBody({ section, geoById, onJump }) {
    switch (section.section_id) {
        case "key_judgments": {
            const kj = section.key_judgments
            if (!kj) return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No key judgments have been written for this report.</div>
            return kj.split("\n\n").filter((p) => p.trim()).map((para, i) => (
                <p key={i} style={{ color: "var(--text-primary)", fontSize: "var(--text-body)", lineHeight: "20px", maxWidth: "68ch", marginBottom: 8 }}>{para.trim()}</p>
            ))
        }
        case "area_overview": {
            const bits = []
            if (section.focus) bits.push(section.focus)
            if (section.period_start || section.period_end) bits.push(`Period: ${section.period_start || "—"} to ${section.period_end || "present"}`)
            if (section.label) bits.push(`Snapshot: ${section.label}`)
            return (
                <>
                    {bits.length > 0 && <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: 6 }}>{bits.join(" · ")}</div>}
                    {(section.elevated_regions || []).length > 0 && (
                        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: 8 }}>
                            Elevated regions: {section.elevated_regions.join(", ")}
                        </div>
                    )}
                    <ClaimList claims={section.claims} geoById={geoById} onJump={onJump} emptyMessage="No zone-scoped claims in this report." />
                </>
            )
        }
        case "collection_gaps":
            return (
                <>
                    {section.completeness_status === "skipped" ? (
                        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Completeness review was not run for this report (no review model configured).</div>
                    ) : section.overall_comment ? (
                        <p style={{ color: "var(--text-primary)", fontSize: "var(--text-body)", maxWidth: "68ch" }}>{section.overall_comment}</p>
                    ) : (
                        <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No completeness findings recorded for this report.</div>
                    )}
                    {section.alerts_excluded_low_quality ? (
                        <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: 6 }}>
                            Alerts excluded for low data quality this period: {section.alerts_excluded_low_quality}
                        </div>
                    ) : null}
                </>
            )
        case "annex": {
            const counts = section.raw_counts || {}
            return (
                <>
                    {Object.keys(counts).length > 0 && (
                        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, fontSize: "var(--text-xs)" }}>
                            <thead>
                                <tr>
                                    <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-strong)" }}>Category</th>
                                    <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-strong)" }}>Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(counts).map(([k, v]) => (
                                    <tr key={k}>
                                        <td style={{ padding: "4px 8px", color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}>{k.replaceAll("_", " ")}</td>
                                        <td style={{ padding: "4px 8px", color: "var(--text-primary)", textAlign: "right", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>{v}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {(section.claims || []).length > 0 && (
                        <>
                            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: 6 }}>Claims not covered by a fixed section above:</div>
                            <ClaimList claims={section.claims} geoById={geoById} onJump={onJump} emptyMessage="" />
                        </>
                    )}
                </>
            )
        }
        default:
            // The 5 claims-driven sections (maritime, aerial, imagery, alerts,
            // OSINT, outlook) and poi_changes (note-only — no real backing data).
            return (
                <>
                    {section.note && <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: 8, maxWidth: "68ch" }}>{section.note}</div>}
                    <ClaimList claims={section.claims} geoById={geoById} onJump={onJump} emptyMessage={`No claims cite ${section.title.toLowerCase()} data in this report.`} />
                </>
            )
    }
}

/**
 * Reading mode — ~58% scrollable document / ~42% embedded map, per spec.
 *
 * onJumpToLocation is an optional prop (no-op default) fired whenever an
 * analyst clicks a claim with a real, derivable lat/lon — the caller may
 * want to react outside this component too. Independently of that prop,
 * this component ALSO directly re-centers its own adjacent ReportMapTab: it
 * dispatches the real `akili:fly-to` window event GlobeView already listens
 * for (see src/components/GlobeView.jsx, used elsewhere by GlobalSearch),
 * rather than mutating ReportMapTab's `center` prop — GlobeView only reads
 * `center` once on mount (useMemo with an empty dep array) to build its
 * initial camera destination, so changing that prop after mount would not
 * actually move the camera. `akili:fly-to` is the real, already-existing
 * mechanism for a post-mount camera move.
 */
export default function ReadingWorkspace({ report, sections, task, onJumpToLocation = () => {} }) {
    const [drawerOpen, setDrawerOpen] = useState(false)
    const initialCoords = useMemo(() => coordsForRegion(task?.region), [task?.task_id])

    const confidence = useMemo(() => summarizeConfidence(sections), [sections])
    const dateLabel = report?.published_at || report?.created_at

    const geoById = useMemo(() => {
        const out = {}
        for (const c of report?.claims || []) {
            if (typeof c.lat === "number" && typeof c.lon === "number") out[c.claim_id] = { lat: c.lat, lon: c.lon }
        }
        return out
    }, [report])

    const handleJump = (claim, geo) => {
        onJumpToLocation(claim.citation)
        if (geo && typeof geo.lat === "number" && typeof geo.lon === "number") {
            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: geo.lat, lon: geo.lon, altitude: 150_000 } }))
        }
    }

    return (
        <div style={{ position: "relative", display: "flex", height: "100%", minHeight: 0 }}>
            <div style={{ flex: "0 0 58%", display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-panel)", borderRight: "1px solid var(--border)" }}>
                <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-5) 28px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
                        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)" }}>{report?.report_id}</span>
                        {dateLabel && <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{new Date(dateLabel).toLocaleString()}</span>}
                        <StatusPill report={report} task={task} />
                    </div>
                    <div style={{ color: "var(--text-primary)", fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)", lineHeight: 1.2, marginBottom: "var(--space-2)" }}>
                        {report?.title || "Untitled report"}
                    </div>
                    {(sections || []).map((section) => (
                        <div key={section.section_id}>
                            <SectionHeader number={section.number} title={section.title} />
                            <SectionBody section={section} geoById={geoById} onJump={handleJump} />
                        </div>
                    ))}
                </div>
                <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-strong)", padding: "var(--space-3) 28px", display: "flex", alignItems: "center", gap: "var(--space-3)", background: "var(--bg-panel)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: confidenceLevelColor(confidence.level), flexShrink: 0 }} />
                    <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", flex: 1 }}>
                        {confidence.flaggedClaims === 0
                            ? `All ${confidence.totalClaims} claim${confidence.totalClaims === 1 ? "" : "s"} passed source review.`
                            : `${confidence.flaggedClaims} of ${confidence.totalClaims} claims flagged by council review (${confidence.criticalClaims} citation problem${confidence.criticalClaims === 1 ? "" : "s"}, ${confidence.warnClaims} sourcing concern${confidence.warnClaims === 1 ? "" : "s"}).`}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(true)}>View Source Summary</Button>
                </div>
            </div>
            <div style={{ flex: "1 1 42%", minWidth: 0 }}>
                <ReportMapTab center={[initialCoords.lat, initialCoords.lon]} zoom={initialCoords.zoom} task={task} />
            </div>
            <SourceSummaryDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sections={sections} />
        </div>
    )
}
