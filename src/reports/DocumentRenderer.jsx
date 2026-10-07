import { useMemo, useState } from "react"
import { claimMetaLine } from "./citationLine.js"
import { linkifyText } from "../lib/linkifyText.jsx"
import { bucketForKind } from "./findingBucket.js"
import { buildXrefCandidates, wrapXrefsHtml, checkForUnwrappedReferences } from "./xrefEngine.js"

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
//
// Reader rework: .xref spans are no longer "wrap the whole claim paragraph
// in one clickable span" — see xrefEngine.js's own docblock. Real
// identifiers/labels (GET /api/reports/{id}/sections's xrefIndex prop, real
// region names) are scanned for and wrapped, deterministically, in every
// real text field of the document (claim text, key judgments, narrative
// prose, warnings, actions) — never relying on the drafting model to have
// marked up its own citations.

const THEME_SECTION_IDS = ["maritime_activity", "aerial_activity", "imagery_detection", "alerts_events", "open_source_context"]
const EVIDENCE_SECTION_IDS = [...THEME_SECTION_IDS, "area_overview", "outlook_watch"]

export function EmptyNote({ children }) {
    return <div style={{ font: "italic 12.5px var(--font)", color: "var(--txt-3)" }}>{children}</div>
}

/** Renders `text` with real .xref spans wrapped in — click handling is
 * delegated at the document-container level (Briefings.jsx), not per-span,
 * since these are raw HTML strings, not React elements. Exported so
 * PrintLayout.jsx's own paginated pages render the exact same real xref
 * markup rather than a second wrapping implementation. */
export function XrefText({ text, candidates, as: Tag = "p", style }) {
    const html = useMemo(() => wrapXrefsHtml(text, candidates), [text, candidates])
    // eslint-disable-next-line react/no-danger
    return <Tag style={style} dangerouslySetInnerHTML={{ __html: html }} />
}

function ClaimList({ claims, mode, candidates, onEditClaim, resolvedComments, onToggleResolve }) {
    if (!claims.length) return <EmptyNote>No claims cite this section's data in this report.</EmptyNote>
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {claims.map((claim) => (
                <div key={claim.claim_id} data-claim-id={claim.claim_id}>
                    {mode === "edit" ? (
                        <textarea
                            className="input" style={{ width: "100%", minHeight: 44, font: "400 13.5px/1.68 var(--font)", color: "var(--txt-2)", resize: "vertical" }}
                            value={claim.text}
                            onChange={(e) => onEditClaim?.(claim.claim_id, e.target.value)}
                        />
                    ) : (
                        <XrefText text={claim.text} candidates={candidates} style={{ margin: 0 }} />
                    )}
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginTop: 2 }}>
                        {/* print stays byte-for-byte plain text, matching report_pdf.py's
                            PDF rendering exactly — only "read"/"edit" get real links. */}
                        {mode === "print" ? claimMetaLine(claim) : linkifyText(claimMetaLine(claim))}
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

function SectionBlock({ section, mode, keyJudgments, onEditKeyJudgments, candidates, ...claimProps }) {
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
                        className="input" style={{ width: "100%", minHeight: 90, font: "400 13.5px/1.68 var(--font)", color: "var(--txt-2)", resize: "vertical" }}
                        value={keyJudgments || ""} onChange={(e) => onEditKeyJudgments?.(e.target.value)}
                    />
                ) : keyJudgments ? (
                    <XrefText text={keyJudgments} candidates={candidates} style={{ whiteSpace: "pre-wrap", lineHeight: 1.68, fontSize: 13.5, margin: 0 }} />
                ) : (
                    <EmptyNote>No key judgements drafted for this report.</EmptyNote>
                )
            )}
            {section.note && <EmptyNote>{section.note}</EmptyNote>}
            {section.section_id !== "key_judgments" && (
                <ClaimList claims={section.claims} mode={mode} candidates={candidates} {...claimProps} />
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

// Real claim-strength scoring for "Network and attribution"'s strongest/
// weakest sentence — reuses the exact same real signal report_pdf.py's own
// _finding_lines() already treats as a flag-worthy negative (a failed
// citation_exists/geo_sanity check, or a citation_fidelity verdict of
// "overstated"/"unsupported"), never an invented confidence number. A claim
// with no findings at all wasn't reviewed, not "flawless" — never counted as
// the strongest.
function claimFlagCount(claim) {
    let flags = 0, reviewed = false
    for (const f of claim.findings || []) {
        if (f.kind === "citation_exists" || f.kind === "geo_sanity") {
            reviewed = true
            if (f.passed === false) flags += 1
        } else if (f.kind === "citation_fidelity") {
            reviewed = true
            if (f.verdict === "overstated" || f.verdict === "unsupported") flags += 1
        }
    }
    return { flags, reviewed }
}

/**
 * Props:
 *   report, sections — real data (see backend/report_sections.py, main.py's
 *     _report_to_dict). mode — "read"|"edit"|"print". xrefIndex — real
 *     GET /api/reports/{id}/xref-index response ({signals,scenes,nodes}),
 *     used to build the real .xref candidate list (see xrefEngine.js) —
 *     click handling on the resulting spans is delegated at the container
 *     level (Briefings.jsx), not a prop here, since spans are raw HTML.
 *     Edit-mode callbacks: onEditKeyJudgments(text), onEditClaimText(claimId,
 *     text), resolvedComments (Set), onToggleResolve(id).
 */
export default function DocumentRenderer({ report, sections, mode = "read", xrefIndex,
    onEditKeyJudgments, onEditClaimText, resolvedComments, onToggleResolve }) {
    const narrative = report?.narrative || {}
    const themes = useMemo(() => buildThemes(sections || []), [sections])
    const regionDist = useMemo(() => buildRegionDistribution(sections || []), [sections])
    const evidenceClaims = useMemo(() => allEvidenceClaims(sections || []), [sections])
    const areaOverview = (sections || []).find((s) => s.section_id === "area_overview")
    const collectionGaps = (sections || []).find((s) => s.section_id === "collection_gaps")
    const exposure = report?.exposure

    const regionNames = useMemo(() => regionDist.map((r) => r.region), [regionDist])
    const candidates = useMemo(() => buildXrefCandidates(xrefIndex, regionNames), [xrefIndex, regionNames])

    // Real content-validation pass — logs (never silently drops, never
    // throws) if the drafted text mentions what looks like a real signal/
    // scene id that isn't actually part of this document's real evidence
    // set. Runs once per document load, over every real free-text field.
    useMemo(() => {
        if (mode === "edit" || !xrefIndex) return
        const label = report?.report_id ? `report ${report.report_id}` : ""
        checkForUnwrappedReferences(report?.key_judgments, candidates, label)
        checkForUnwrappedReferences(narrative.second_para, candidates, label)
        checkForUnwrappedReferences(narrative.bottom_line, candidates, label)
        for (const w of narrative.warnings || []) checkForUnwrappedReferences(w, candidates, label)
        for (const a of narrative.actions || []) checkForUnwrappedReferences(a?.[0], candidates, label)
        for (const c of evidenceClaims) checkForUnwrappedReferences(c.text, candidates, label)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [report?.report_id, xrefIndex, candidates])

    const claimProps = { onEditClaim: onEditClaimText, resolvedComments, onToggleResolve }

    return (
        <article className="docbody" style={{
            maxWidth: 720, margin: "0 auto",
            fontFamily: mode === "print" ? "var(--serif, Georgia, 'Times New Roman', serif)" : "var(--font)",
            fontSize: 13.5, lineHeight: 1.68, color: mode === "print" ? "var(--ink, var(--txt))" : "var(--txt-2)",
        }}>
            {/* Kicker + H1 + rule + metadata */}
            <div style={{ font: "600 10.5px var(--font)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--txt-3)" }}>
                {report?.classification}
            </div>
            <h1 style={{ font: `700 22px ${mode === "print" ? "var(--serif, Georgia, serif)" : "var(--font)"}`, margin: "6px 0 10px" }}>{report?.title}</h1>
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
                mode={mode} keyJudgments={report?.key_judgments} onEditKeyJudgments={onEditKeyJudgments} candidates={candidates}
            />
            {narrative.second_para && <XrefText text={narrative.second_para} candidates={candidates} style={{ marginTop: -14 }} />}

            {/* THE REPORT ITSELF — continuous analytical prose.
                The signals are reference points; this is the argument built
                on them. Every paragraph runs through XrefText, so a vessel,
                port, cable or zone named in the prose is a live link into the
                record, which is what makes the document interactive rather
                than merely readable. */}
            {(narrative.sections || []).map((sec, i) => (
                <section key={sec.key || i} style={{ marginTop: 22 }}>
                    {sec.heading && (
                        <h3 style={{ font: "600 14px var(--font)", color: "var(--txt)", margin: "0 0 8px" }}>
                            {sec.heading}
                        </h3>
                    )}
                    {(sec.paragraphs || []).map((para, j) => (
                        <XrefText key={j} text={para} candidates={candidates}
                                  style={{ marginBottom: 10, lineHeight: 1.62 }} />
                    ))}
                    {sec.implication && (
                        <div style={{
                            border: "1px solid var(--line)", borderRadius: 6, padding: "7px 11px",
                            background: "var(--bg-2)", marginTop: 4,
                        }}>
                            <div style={{ font: "600 9.5px var(--font)", color: "var(--txt-3)",
                                          textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 3 }}>
                                What this means
                            </div>
                            <XrefText as="span" text={sec.implication} candidates={candidates} />
                        </div>
                    )}
                </section>
            ))}

            {/* Open sources consulted, listed separately from the cited
                evidence. A reader must be able to tell what the system
                OBSERVED from what the analyst READ. */}
            {(narrative.web_sources || []).length > 0 && (
                <section style={{ marginTop: 24 }}>
                    <h3 style={{ font: "600 12px var(--font)", color: "var(--txt-3)", textTransform: "uppercase",
                                 letterSpacing: ".05em", margin: "0 0 7px" }}>
                        Open sources consulted ({narrative.web_sources.length})
                    </h3>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                        {narrative.web_sources.slice(0, 40).map((src, i) => (
                            <li key={i} style={{ font: "400 11.5px var(--font)", color: "var(--txt-3)", marginBottom: 3 }}>
                                <a href={src.url} target="_blank" rel="noreferrer" style={{ color: "var(--acc-hi)" }}>
                                    {src.title || src.url}
                                </a>
                            </li>
                        ))}
                    </ol>
                </section>
            )}
            {narrative.bottom_line && (
                <div style={{ background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", margin: "10px 0 20px", fontWeight: 600 }}>
                    Bottom line. <XrefText as="span" text={narrative.bottom_line} candidates={candidates} />
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
                <ClaimList claims={evidenceClaims} mode={mode} candidates={candidates} {...claimProps} />
            </section>

            {/* Assessment by theme */}
            <div style={{ font: "700 13px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 14 }}>Assessment by theme</div>
            {/* Themes with nothing in them are one line, not one heading and
                one "no claims" sentence each. */}
            {themes.some((t) => !t.claims.length) && (
                <p style={{ margin: "0 0 18px", color: "var(--txt-3)" }}>
                    Not covered in this window: {themes.filter((t) => !t.claims.length).map((t) => t.title.toLowerCase()).join(", ")}.
                </p>
            )}
            {themes.filter((t) => t.claims.length).map((t) => (
                <section key={t.id} style={{ marginBottom: 20 }}>
                    <div style={{ font: "700 12px var(--font)", color: "var(--txt-2)", marginBottom: 6 }}>{t.title}</div>
                    <p style={{ margin: "0 0 6px" }}>{t.paragraph}</p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {t.claims.slice(0, 3).map((c) => (
                            <li key={c.claim_id} data-claim-id={c.claim_id}>
                                <XrefText as="span" text={c.text} candidates={candidates} />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            {/* Regional distribution + Exposure and continuity impact — print-only
                (implementation manual v1.0 §5/§6.2: these live on the print
                layout's Themes/Consequence pages as tables; the reader gets
                Network and attribution instead, below). Same shared
                regionDist/exposure data either way — never a second,
                independently-recomputed rollup for print. */}
            {mode === "print" && (
                <>
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
                </>
            )}

            {/* Network and attribution — reader-only (implementation manual
                v1.0 §5.4): print gets the full Appendix A instead, never
                this section duplicated onto paper. Real ontology object
                references (xrefIndex.nodes, already the same real
                cross-reference candidates every other .xref in this
                document draws from) plus an honest strongest/weakest
                assertion sentence — reusing the exact real signal
                report_pdf.py's own _finding_lines() already treats as
                flag-worthy (a failed citation_exists/geo_sanity check, or a
                citation_fidelity verdict of overstated/unsupported), never a
                fabricated confidence number. */}
            {mode !== "print" && (() => {
                const nodeRefs = (xrefIndex?.nodes || []).slice(0, 3)
                const reviewed = evidenceClaims.map((c) => ({ claim: c, ...claimFlagCount(c) })).filter((x) => x.reviewed)
                let strongest = null, weakest = null
                if (reviewed.length) {
                    strongest = reviewed.reduce((a, b) => (b.flags < a.flags ? b : a))
                    weakest = reviewed.reduce((a, b) => (b.flags > a.flags ? b : a))
                }
                return (
                    <section style={{ marginBottom: 26 }}>
                        <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                            Network and attribution
                        </div>
                        {nodeRefs.length === 0 ? (
                            <EmptyNote>No ontology objects are linked to this document's evidence set.</EmptyNote>
                        ) : (
                            <XrefText
                                text={`This assessment's evidence set connects to ${nodeRefs.length} ontology object${nodeRefs.length === 1 ? "" : "s"}: ${nodeRefs.map((n) => n.label).join(", ")}.`}
                                candidates={candidates} style={{ margin: "0 0 9px" }}
                            />
                        )}
                        {reviewed.length === 0 ? (
                            <EmptyNote>No AI Council review has been run on this report yet, so the relative strength of individual assertions cannot be assessed.</EmptyNote>
                        ) : strongest.claim.claim_id === weakest.claim.claim_id ? (
                            <p style={{ margin: 0 }}>Every AI Council-reviewed claim in this set carries the same flag count ({strongest.flags}) — no single assertion stands out as stronger or weaker on that basis.</p>
                        ) : (
                            <p style={{ margin: 0 }}>
                                The strongest-supported assertion in this set is <XrefText as="span" text={strongest.claim.text} candidates={candidates} /> — {strongest.flags === 0 ? "no AI Council findings were raised against it" : `only ${strongest.flags} AI Council finding${strongest.flags === 1 ? "" : "s"} raised against it`}.
                                {" "}The weakest is <XrefText as="span" text={weakest.claim.text} candidates={candidates} /> — flagged by {weakest.flags} AI Council finding{weakest.flags === 1 ? "" : "s"}.
                            </p>
                        )}
                    </section>
                )
            })()}

            {/* Indicators and warnings */}
            <section style={{ marginBottom: 26 }}>
                <div style={{ font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--txt-2)", borderBottom: "1px solid var(--line)", paddingBottom: 5, marginBottom: 10 }}>
                    Indicators and warnings
                </div>
                {(!narrative.warnings || narrative.warnings.length === 0) ? (
                    <EmptyNote>No warnings identified from current evidence.</EmptyNote>
                ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {narrative.warnings.map((w, i) => <li key={i}><XrefText as="span" text={w} candidates={candidates} /></li>)}
                    </ul>
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
                        {narrative.actions.map((a, i) => (
                            <li key={i}>
                                <XrefText as="span" text={a[0]} candidates={candidates} />
                                {" "}<span style={{ color: "var(--txt-3)" }}>— {a[1]}, by {a[2]}</span>
                            </li>
                        ))}
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
