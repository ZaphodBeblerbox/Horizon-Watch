import { useMemo, useState } from "react"
import { claimMetaLine } from "./citationLine.js"
import { bucketForKind } from "./findingBucket.js"

// DocumentRenderer.jsx — the one shared renderer for a Report's content,
// used identically by the reader, the editor, and the print layout (§3 of
// the Generate/Briefings rebuild: "build one shared document renderer and
// use it... so none of these can ever visually diverge"). Consumes the real
// GET /api/reports/{id}/sections shape (backend/report_sections.py) plus the
// Report's own `narrative`/`exposure` fields — never a separate re-derived
// document shape.
//
// mode: "read" (plain, xrefs clickable) | "edit" (claims/key_judgments
// editable, AI Council comment wells shown) | "print" (identical to read,
// but never renders comment wells, per the "never in the printed PDF" rule).

const THEME_SECTION_IDS = ["maritime_activity", "aerial_activity", "imagery_detection", "alerts_events", "open_source_context"]
const EVIDENCE_SECTION_IDS = [...THEME_SECTION_IDS, "area_overview", "outlook_watch"]

function xrefKindFor(citation) {
    if (!citation || citation.type !== "snapshot_ref") return "external"
    const s = citation.section
    if (s === "ais_anomalies" || s === "adsb_anomalies") return "signal"
    if (s === "sentinel_detections") return "scene"
    if (s === "strategic_zones") return "region"
    return "signal"
}

export function XrefSpan({ claim, active, onSelect, children }) {
    const kind = xrefKindFor(claim.citation)
    if (claim.citation?.type !== "snapshot_ref" && claim.citation?.type !== "external") {
        return <span>{children}</span>
    }
    return (
        <span
            role="button" tabIndex={0}
            onClick={() => onSelect?.(claim, kind)}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(claim, kind) }}
            className="xref"
            style={{
                textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "pointer",
                background: active ? "var(--acc-dim)" : "transparent",
            }}
        >
            {children}
        </span>
    )
}

function EmptyNote({ children }) {
    return <div style={{ font: "italic 12.5px var(--font)", color: "var(--txt-3)" }}>{children}</div>
}

function ClaimList({ claims, mode, activeClaimId, onSelectXref, onEditClaim, resolvedComments, onToggleResolve }) {
    if (!claims.length) return <EmptyNote>No claims cite this section's data in this report.</EmptyNote>
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {claims.map((claim) => (
                <div key={claim.claim_id} data-claim-id={claim.claim_id}>
                    {mode === "edit" ? (
                        <textarea
                            className="input" style={{ width: "100%", minHeight: 44, font: "400 13.5px/1.5 var(--serif, georgia)", resize: "vertical" }}
                            value={claim.text}
                            onChange={(e) => onEditClaim?.(claim.claim_id, e.target.value)}
                        />
                    ) : (
                        <p style={{ margin: 0 }}>
                            <XrefSpan claim={claim} active={activeClaimId === claim.claim_id} onSelect={onSelectXref}>
                                {claim.text}
                            </XrefSpan>
                        </p>
                    )}
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginTop: 2 }}>
                        {claimMetaLine(claim)}
                    </div>
                    {mode === "edit" && (claim.findings || []).map((f, i) => {
                        const id = `${claim.claim_id}::${f.kind}::${i}`
                        const resolved = resolvedComments?.has(id)
                        return (
                            <div key={id} style={{
                                background: "var(--acc-dim)", border: "1px solid var(--acc-line)", borderRadius: "var(--r)",
                                padding: 8, marginTop: 6, opacity: resolved ? 0.5 : 1,
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", font: "600 11px var(--font)", color: "var(--txt)" }}>
                                    <span>AI Council Comment · {bucketForKind(f.kind)}</span>
                                    <span
                                        role="button" onClick={() => onToggleResolve?.(id)}
                                        style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}
                                    >{resolved ? "Reopen" : "Resolve"}</span>
                                </div>
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginTop: 3, textDecoration: resolved ? "line-through" : "none" }}>
                                    {f.detail || f.comment || (f.passed === false ? "Deterministic check failed." : "Flagged for review.")}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}

function SectionBlock({ section, mode, keyJudgments, onEditKeyJudgments, ...claimProps }) {
    return (
        <section style={{ marginBottom: 26 }} data-section-id={section.section_id}>
            <div style={{
                font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em",
                color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10,
            }}>
                {section.number}. {section.title}
            </div>
            {section.section_id === "key_judgments" && (
                mode === "edit" ? (
                    <textarea
                        className="input" style={{ width: "100%", minHeight: 90, font: "400 13.5px/1.6 var(--serif, georgia)", resize: "vertical" }}
                        value={keyJudgments || ""} onChange={(e) => onEditKeyJudgments?.(e.target.value)}
                    />
                ) : (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.68, fontSize: 13.5 }}>
                        {keyJudgments || <EmptyNote>No key judgements drafted for this report.</EmptyNote>}
                    </div>
                )
            )}
            {section.note && <EmptyNote>{section.note}</EmptyNote>}
            {section.section_id !== "key_judgments" && (
                <ClaimList claims={section.claims} mode={mode} {...claimProps} />
            )}
        </section>
    )
}

/** Groups sections' claims by theme id for the "Assessment by theme" page —
 * a real, computed one-line summary per theme (from real claim counts),
 * never a fabricated narrative paragraph. */
export function buildThemes(sections) {
    return THEME_SECTION_IDS
        .map((id) => sections.find((s) => s.section_id === id))
        .filter(Boolean)
        .map((s) => ({
            id: s.section_id, title: s.title, claims: s.claims,
            paragraph: s.claims.length
                ? `${s.claims.length} claim${s.claims.length === 1 ? "" : "s"} recorded for ${s.title.toLowerCase()} in this window.`
                : `No claims recorded for ${s.title.toLowerCase()} in this window.`,
        }))
        .filter((t) => t.claims.length || true)
}

/** Real region distribution — every evidence claim that carries a real
 * lat/lon (see backend/report_sections.py's _claim_region) tallied by the
 * same on-the-fly bbox classification Analytics uses; claims with no real
 * coordinate are honestly excluded, never guessed into a region. */
export function buildRegionDistribution(sections) {
    const tally = new Map()
    for (const s of sections) {
        if (!EVIDENCE_SECTION_IDS.includes(s.section_id)) continue
        for (const c of s.claims || []) {
            if (!c.region) continue
            tally.set(c.region, (tally.get(c.region) || 0) + 1)
        }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([region, count]) => ({ region, count }))
}

export function allEvidenceClaims(sections) {
    const out = []
    for (const s of sections) if (EVIDENCE_SECTION_IDS.includes(s.section_id)) out.push(...(s.claims || []))
    return out
}

/**
 * Props:
 *   report, sections — real data (see backend/report_sections.py, main.py's
 *     _report_to_dict). mode — "read"|"edit"|"print". activeClaimId,
 *     onSelectXref(claim, kind) — xref click-through. Edit-mode callbacks:
 *     onEditKeyJudgments(text), onEditClaimText(claimId, text),
 *     resolvedComments (Set), onToggleResolve(id).
 */
export default function DocumentRenderer({ report, sections, mode = "read", activeClaimId, onSelectXref,
    onEditKeyJudgments, onEditClaimText, resolvedComments, onToggleResolve }) {
    const narrative = report?.narrative || {}
    const themes = useMemo(() => buildThemes(sections || []), [sections])
    const regionDist = useMemo(() => buildRegionDistribution(sections || []), [sections])
    const evidenceClaims = useMemo(() => allEvidenceClaims(sections || []), [sections])
    const areaOverview = (sections || []).find((s) => s.section_id === "area_overview")
    const collectionGaps = (sections || []).find((s) => s.section_id === "collection_gaps")
    const exposure = report?.exposure

    const claimProps = { activeClaimId, onSelectXref, onEditClaim: onEditClaimText, resolvedComments, onToggleResolve }

    return (
        <article className="docbody" style={{
            maxWidth: 720, margin: "0 auto", fontFamily: "var(--serif, Georgia, 'Times New Roman', serif)",
            fontSize: 13.5, lineHeight: 1.68, color: "var(--ink, var(--txt))",
        }}>
            {/* Kicker + H1 + rule + metadata */}
            <div style={{ font: "600 10.5px var(--font)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--txt-3)" }}>
                {report?.classification}
            </div>
            <h1 style={{ font: "700 22px var(--serif, Georgia, serif)", margin: "6px 0 10px" }}>{report?.title}</h1>
            <div style={{ borderBottom: "2px solid var(--line-strong)", marginBottom: 14 }} />
            <table style={{ width: "100%", fontSize: 12, color: "var(--txt-2)", marginBottom: 22, borderCollapse: "collapse" }}>
                <tbody>
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "var(--txt-4)" }}>Report ID</td><td style={{ fontFamily: "var(--mono)" }}>{report?.report_id}</td>
                        <td style={{ padding: "2px 12px 2px 24px", color: "var(--txt-4)" }}>Status</td><td>{report?.status}</td></tr>
                    <tr><td style={{ padding: "2px 12px 2px 0", color: "var(--txt-4)" }}>Scope</td><td>{areaOverview?.focus || "—"}</td>
                        <td style={{ padding: "2px 12px 2px 24px", color: "var(--txt-4)" }}>Period</td>
                        <td>{areaOverview?.period_start ? `${areaOverview.period_start.slice(0, 10)} → ${(areaOverview.period_end || "").slice(0, 10) || "now"}` : "—"}</td></tr>
                </tbody>
            </table>

            {/* Executive judgement */}
            <SectionBlock
                section={(sections || []).find((s) => s.section_id === "key_judgments") || { number: "1", section_id: "key_judgments", title: "Executive Judgement", claims: [], note: null }}
                mode={mode} keyJudgments={report?.key_judgments} onEditKeyJudgments={onEditKeyJudgments}
            />
            {narrative.second_para && <p style={{ marginTop: -14 }}>{narrative.second_para}</p>}
            {narrative.bottom_line && (
                <div style={{ background: "var(--bg-2)", borderLeft: "3px solid var(--acc-hi)", padding: "8px 12px", margin: "10px 0 20px", fontWeight: 600 }}>
                    Bottom line. {narrative.bottom_line}
                </div>
            )}

            {/* Signals driving this assessment — the one canonical, editable
                list for every evidence claim across every section (edit-mode
                textareas + comment wells + scroll anchors all live here;
                "Assessment by theme" below cross-references the same real
                claims read-only, rather than a second, conflicting editable
                copy of the same text). */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Signals driving this assessment
                </div>
                <ClaimList claims={evidenceClaims} mode={mode} {...claimProps} />
            </section>

            {/* Assessment by theme */}
            <div style={{ font: "700 13px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>Assessment by theme</div>
            {themes.map((t) => (
                <section key={t.id} style={{ marginBottom: 20 }}>
                    <div style={{ font: "700 12px var(--font)", color: "var(--txt-2)", marginBottom: 6 }}>{t.title}</div>
                    <p style={{ margin: "0 0 6px" }}>{t.paragraph}</p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {t.claims.slice(0, 3).map((c) => (
                            <li key={c.claim_id}><XrefSpan claim={c} active={activeClaimId === c.claim_id} onSelect={onSelectXref}>{c.text}</XrefSpan></li>
                        ))}
                    </ul>
                </section>
            ))}

            {/* Regional distribution */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Regional distribution
                </div>
                {regionDist.length === 0 ? (
                    <EmptyNote>No geolocated signals to distribute by region in this window.</EmptyNote>
                ) : (
                    <table className="grid" style={{ width: "100%" }}>
                        <thead><tr><th>Region</th><th>Signals</th></tr></thead>
                        <tbody>{regionDist.map((r) => (<tr key={r.region}><td>{r.region}</td><td style={{ fontFamily: "var(--mono)" }}>{r.count}</td></tr>))}</tbody>
                    </table>
                )}
            </section>

            {/* Exposure and continuity impact */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Exposure and continuity impact
                </div>
                {!exposure || exposure.asset_count === 0 ? (
                    <EmptyNote>{exposure ? "The real asset register is currently empty — no exposure could be scored." : "No exposure scoring was run for this report."}</EmptyNote>
                ) : exposure.matches.length === 0 ? (
                    <EmptyNote>{exposure.checked_items} geolocated signal(s) checked against {exposure.asset_count} registered asset(s) — no real-world assets within {exposure.matches.length ? "" : "25km"} of this window's evidence.</EmptyNote>
                ) : (
                    <table className="grid" style={{ width: "100%" }}>
                        <thead><tr><th>Asset</th><th>Type</th><th>Distance</th></tr></thead>
                        <tbody>{exposure.matches.map((m, i) => (
                            <tr key={i}><td>{m.asset_name}</td><td>{m.asset_type}</td><td style={{ fontFamily: "var(--mono)" }}>{m.distance_km} km</td></tr>
                        ))}</tbody>
                    </table>
                )}
            </section>

            {/* Indicators and warnings */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Indicators and warnings
                </div>
                {(!narrative.warnings || narrative.warnings.length === 0) ? (
                    <EmptyNote>No warnings identified from current evidence.</EmptyNote>
                ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{narrative.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
            </section>

            {/* Recommended actions */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Recommended actions
                </div>
                {(!narrative.actions || narrative.actions.length === 0) ? (
                    <EmptyNote>No recommended actions generated for this cycle.</EmptyNote>
                ) : (
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                        {narrative.actions.map((a, i) => (<li key={i}>{a[0]} <span style={{ color: "var(--txt-3)" }}>— {a[1]}, by {a[2]}</span></li>))}
                    </ol>
                )}
            </section>

            {/* Sourcing and method */}
            <section style={{ marginBottom: 10 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Sourcing and method
                </div>
                {evidenceClaims.length === 0 ? (
                    <EmptyNote>No sourcing to report for an evidence-free briefing.</EmptyNote>
                ) : (
                    <div style={{ fontSize: 12, color: "var(--txt-2)" }}>
                        {evidenceClaims.length} claims · {new Set(evidenceClaims.map((c) => c.citation?.section).filter(Boolean)).size} distinct feeds cited
                        {collectionGaps?.overall_comment ? ` · ${collectionGaps.overall_comment}` : ""}
                    </div>
                )}
            </section>
        </article>
    )
}
