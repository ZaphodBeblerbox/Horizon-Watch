import { useState, useEffect, useRef } from "react"
import { getReportBundle } from "./reportApi.js"
import { XrefText, EmptyNote, buildThemes, buildRegionDistribution, allEvidenceClaims } from "./DocumentRenderer.jsx"
import { buildXrefCandidates } from "./xrefEngine.js"

// PrintLayout — #view-doc. Reachable only from the reader or Generate's
// printable-briefing button, never the module rail (a hidden view). Real
// pagination (implementation manual v1.0 §6.2): four named pages built from
// the exact same shared data helpers the reader's DocumentRenderer uses
// (buildThemes/buildRegionDistribution/allEvidenceClaims/buildXrefCandidates)
// — never a second, independently-recomputed rollup — so the reader and
// print output can never structurally disagree, even though print's fixed
// page plan means the two surfaces don't share literal JSX. Defers to the
// browser's native print/save-as-PDF via the print CSS below — one real
// export path, not a second implementation alongside the (currently unused)
// server-rendered reportlab PDF.

const SEV_RANK = { critical: 4, high: 3, moderate: 2, low: 1 }

// Real "place" text on a snapshot item isn't reliably a geographic place —
// confirmed live: a sanctioned-vessel alert's real location_name field holds
// its alert headline ("⚠ SANCTIONED: HORIZZON detected"), not a location.
// Region (computed the same on-the-fly bbox classification Analytics uses)
// or, failing that, the claim's own real lat/lon is always honest regardless
// of which alert type produced it — a place-looking string that might
// actually be something else is not.
function formatLocation(claim, signal) {
    if (claim.region) return claim.region
    const lat = claim.lat ?? signal?.lat, lon = claim.lon ?? signal?.lon
    if (lat == null || lon == null) return "—"
    return `${lat.toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${lon.toFixed(2)}°${lon >= 0 ? "E" : "W"}`
}

const PRINT_CSS = `
@media print{
  @page{margin:0;size:letter}
  body{overflow:visible;background:#fff}
  #app{display:block;height:auto}
  .topbar,.tabstrip,.statusbar,#toasts,.scrim,.doctools,.docaside{display:none!important}
  .view{display:none!important}
  .view#view-doc{display:block!important;overflow:visible;height:auto}
  .docdesk{overflow:visible;height:auto;padding:0;background:#fff}
  #view-doc .panes{display:block!important}
  .pane{border:0!important}
  .docpage{box-shadow:none;margin:0;width:8.5in;min-height:11in;padding:.72in .8in .6in;
           break-after:page}
  .docpage:last-child{break-after:auto}

  /* COLOUR HAS TO BE ASKED FOR. Browsers drop background colours when
     printing unless told otherwise, so every severity bar, callout rule
     and shaded cell in the briefing came out white — which is most of
     why the PDF read as a broken screenshot of the screen rather than a
     document. */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* NOTHING SPLITS ACROSS A PAGE MID-THOUGHT. A table row broken over a
     page boundary loses its header and reads as corrupted; a heading
     stranded at the foot of a page belongs to nothing. */
  table,figure,blockquote{break-inside:avoid}
  tr,li{break-inside:avoid}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  h1,h2,h3,h4{break-after:avoid;break-inside:avoid}

  /* An image wider than the text block silently pushed the page out and
     clipped the right margin. */
  img,svg,canvas{max-width:100%;height:auto}

  /* A link printed as blue underlined text with no destination is
     noise on paper; the reference grammar already carries the source. */
  a{color:inherit;text-decoration:none}
}
`

const PAGE_H2 = { font: "700 12px var(--font)", textTransform: "uppercase", letterSpacing: "0.05em", color: "#33383f", borderBottom: "1px solid #b9b5ac", paddingBottom: 4, margin: "24px 0 8px" }
const PAGE_H3 = { fontSize: 13.5, margin: "15px 0 4px", fontWeight: 700 }
const CALLOUT = { borderLeft: "2px solid #1b1f24", padding: "2px 0 2px 12px", margin: "11px 0", fontSize: 13, lineHeight: 1.58 }

function Folio({ cls, id, page }) {
    return (
        <div style={{ marginTop: "auto", paddingTop: 20, display: "flex", justifyContent: "space-between", font: "400 8.5px var(--font)", letterSpacing: "0.11em", color: "#7d7870", borderTop: "1px solid #cdc8bf" }}>
            <span>{cls}</span><span>{id}</span><span>PAGE {page}</span>
        </div>
    )
}

function Kicker({ children }) {
    return <div style={{ font: "400 9px var(--font)", letterSpacing: "0.17em", textTransform: "uppercase", color: "#5f6772", marginBottom: 13 }}>{children}</div>
}

function Grid({ head, rows, empty }) {
    if (!rows.length) return <EmptyNote>{empty}</EmptyNote>
    return (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "6px 0 12px", fontSize: 12 }}>
            <thead><tr>{head.map((h) => (
                <th key={h} style={{ textAlign: "left", font: "700 8.5px var(--font)", letterSpacing: "0.1em", textTransform: "uppercase", color: "#5a6270", borderBottom: "1px solid #1b1f24", padding: "0 8px 4px 0" }}>{h}</th>
            ))}</tr></thead>
            <tbody>{rows}</tbody>
        </table>
    )
}

const TD = { padding: "4px 8px 4px 0", borderBottom: "1px solid #d7d2c9", verticalAlign: "top", color: "#22272d" }

export default function PrintLayout({ reportId, onBack, onOpenDeck }) {
    const [bundle, setBundle] = useState(null)
    const [zoom, setZoom] = useState(100)
    const deskRef = useRef(null)

    useEffect(() => {
        if (!reportId) return
        setBundle(null)
        getReportBundle(reportId).then(setBundle)
    }, [reportId])

    // Zoom — all four real pages render inside one shared `.pane` wrapper
    // (rather than each page scaled independently), so `transform: scale()`
    // on that wrapper scales the whole subtree as one coordinate space —
    // the 20px real margin between pages scales right along with it (20px
    // at 100%, 15px at 75%, 25px at 125% — confirmed live, no overlap, no
    // gap). This trailing correction only tidies up the dead space this
    // scaling leaves after the LAST page's own real bottom margin.
    function marginFor(z) {
        return 22 * z - (1 - z) * 1056
    }

    // Contents navigation scrolls the desk element itself — never
    // scrollIntoView on an element inside it, which scrolls ancestor
    // containers too and displaces the whole app shell (implementation
    // manual v1.0 §6.3, a real, previously-easy-to-miss bug). Real bug this
    // adaptation had to catch too: offsetTop is relative to the nearest
    // *positioned* ancestor, and `.pane`'s own zoom transform (above) makes
    // IT that ancestor — not the desk — so an offsetTop-based delta silently
    // resolves to the wrong target the moment zoom isn't 100%. getBoundingClientRect()
    // deltas are always viewport-relative regardless of transforms/positioning.
    function jumpTo(pageId) {
        const el = document.getElementById(pageId)
        const desk = deskRef.current
        if (!el || !desk) return
        const delta = el.getBoundingClientRect().top - desk.getBoundingClientRect().top
        desk.scrollTo({ top: desk.scrollTop + delta - 16, behavior: "auto" })
    }

    if (!reportId) return null
    const { report, sections, xrefIndex, linkAnalysis } = bundle || {}

    return (
        <div id="view-doc" className="view" style={{ display: "grid", gridTemplateColumns: "242px 1fr", height: "100%", overflow: "hidden" }}>
            <style>{PRINT_CSS}</style>
            <div className="docaside" style={{ borderRight: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
                <button className="btn" onClick={onBack}>← back to reader</button>
                {report && (
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)", lineHeight: 1.6 }}>
                        {report.report_id}<br />{report.classification}<br />
                        {(sections ? allEvidenceClaims(sections) : []).length} evidence claim(s)
                    </div>
                )}
                <div className="field"><label style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>Zoom</label>
                    <div className="seg" style={{ marginTop: 4 }}>{[75, 100, 125].map((z) => <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z}%</button>)}</div>
                </div>
                {/* SAYS WHERE THE PDF COMES FROM. The export works — the
                    layout below is a real paginated document, not a
                    screenshot — but it arrives through the browser's own
                    print dialog, and "print" on a button is not a
                    discoverable way to say "this is how you get a PDF".
                    Choose "Save as PDF" as the destination. */}
                <button className="btn primary" onClick={() => window.print()}
                        title={'Opens the print dialog — choose "Save as PDF" as the '
                               + "destination. The pages below are what you get, at letter size."}>
                    export pdf
                </button>
                {report && <button className="btn" onClick={() => onOpenDeck?.(reportId)}>deck</button>}
                {/* distribute — omitted: no real distribution-list feature
                    exists in the backend (checked main.py/database.py) — a
                    button here would confirm something that doesn't happen. */}
                {report && (
                    <>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 10 }}>Contents</div>
                        {[["pg1", "Judgement"], ["pg2", "Themes"], ["pg3", "Consequence"], ["pg4", "Appendix A — link analysis"]].map(([id, label]) => (
                            <div key={id} role="button" onClick={() => jumpTo(id)} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", cursor: "pointer", padding: "2px 0" }}>{label}</div>
                        ))}
                    </>
                )}
            </div>

            <div className="docdesk" ref={deskRef} style={{ overflow: "auto", background: "#3a3d42", padding: 24 }}>
                <div className="panes" style={{ display: "flex", justifyContent: "center" }}>
                    {!report || !sections ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Loading…</div>
                    ) : (
                        <div className="pane" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center", marginBottom: marginFor(zoom / 100) }}>
                            <PrintPages report={report} sections={sections} xrefIndex={xrefIndex} linkAnalysis={linkAnalysis} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

const DOCPAGE_STYLE = {
    width: 816, minHeight: 1056, background: "#f4f2ee", color: "#1b1f24",
    padding: "62px 70px 54px", boxShadow: "0 8px 30px rgba(0,0,0,.5)", position: "relative",
    display: "flex", flexDirection: "column", fontFamily: "'Times New Roman', Times, Georgia, serif",
    marginBottom: 20,
}

function PrintPages({ report, sections, xrefIndex, linkAnalysis }) {
    const narrative = report?.narrative || {}
    const evidenceClaims = allEvidenceClaims(sections)
    const themes = buildThemes(sections)
    const regionDist = buildRegionDistribution(sections)
    const exposure = report?.exposure
    const areaOverview = sections.find((s) => s.section_id === "area_overview")
    const regionNames = regionDist.map((r) => r.region)
    const candidates = buildXrefCandidates(xrefIndex, regionNames)

    // Real per-signal severity/place — same real fields
    // GET /api/reports/{id}/xref-index's signals now carry (backend/main.py's
    // get_report_xref_index), joined back onto each real claim by its own
    // citation.item_id — never a fabricated severity/location.
    const signalById = new Map((xrefIndex?.signals || []).map((s) => [s.id, s]))
    const signalRows = evidenceClaims
        .map((c) => ({ claim: c, signal: signalById.get(String(c.citation?.item_id)) }))
        .sort((a, b) => (SEV_RANK[b.signal?.severity] || 0) - (SEV_RANK[a.signal?.severity] || 0))
        .slice(0, 9)

    const period = areaOverview?.period_start ? `${areaOverview.period_start.slice(0, 10)} → ${(areaOverview.period_end || "").slice(0, 10) || "now"}` : "—"

    return (
        <>
            {/* Page 1 — Judgement */}
            <section className="docpage" id="pg1" style={DOCPAGE_STYLE}>
                <div style={{ position: "absolute", top: 20, right: 70, font: "400 8.5px var(--font)", letterSpacing: "0.14em", color: "#7d7870" }}>{report.classification}</div>
                <Kicker>{report.classification}</Kicker>
                <h1 style={{ fontSize: 26, lineHeight: 1.16, margin: "0 0 10px", fontWeight: 700, letterSpacing: "-.01em" }}>{report.title}</h1>
                <div style={{ borderBottom: "1px solid #1b1f24", marginBottom: 14 }} />
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 6 }}>
                    <tbody>
                        <tr>
                            <td style={TD}><b>Report ID</b> {report.report_id}</td>
                            <td style={TD}><b>Status</b> {report.status}</td>
                            <td style={TD}><b>Classification</b> {report.classification}</td>
                        </tr>
                        <tr>
                            <td style={TD}><b>Scope</b> {areaOverview?.focus || "—"}</td>
                            <td style={TD}><b>Period</b> {period}</td>
                            <td style={TD}><b>Author</b> {report.created_by || "—"}</td>
                        </tr>
                    </tbody>
                </table>

                <div style={PAGE_H2}>Executive judgement</div>
                {report.key_judgments ? (
                    <XrefText text={report.key_judgments} candidates={candidates} style={{ whiteSpace: "pre-wrap", lineHeight: 1.58, fontSize: 14 }} />
                ) : <EmptyNote>No key judgements drafted for this report.</EmptyNote>}
                {narrative.second_para && <XrefText text={narrative.second_para} candidates={candidates} style={{ fontSize: 13, lineHeight: 1.6 }} />}
                {narrative.bottom_line && (
                    <div style={CALLOUT}><b>Bottom line.</b> <XrefText as="span" text={narrative.bottom_line} candidates={candidates} /></div>
                )}

                <div style={PAGE_H2}>Signals driving this assessment</div>
                <Grid head={["Ref", "Severity", "Signal", "Location"]} empty="No evidence claims in this report." rows={signalRows.map(({ claim, signal }, i) => (
                    <tr key={claim.claim_id}>
                        <td style={TD}>{String(i + 1).padStart(2, "0")}</td>
                        <td style={TD}>
                            {signal?.severity && <span style={{ display: "inline-block", width: 7, height: 7, transform: "rotate(45deg)", marginRight: 6, background: SEV_COLOR[signal.severity] || "#8a8f98" }} />}
                            {signal?.severity || "—"}
                        </td>
                        <td style={TD}>{claim.text}</td>
                        <td style={TD}>{formatLocation(claim, signal)}</td>
                    </tr>
                ))} />

                <Folio cls={report.classification} id={report.report_id} page={1} />
            </section>

            {/* Page 2 — Themes */}
            <section className="docpage" id="pg2" style={DOCPAGE_STYLE}>
                <div style={PAGE_H2}>Assessment by theme</div>
                {themes.map((t) => (
                    <div key={t.id}>
                        <div style={PAGE_H3}>{t.title} · {t.claims.length} signal{t.claims.length === 1 ? "" : "s"}</div>
                        <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 6px" }}>{t.paragraph}</p>
                        <ul style={{ margin: "0 0 9px", paddingLeft: 18 }}>
                            {t.claims.slice(0, 3).map((c) => (
                                <li key={c.claim_id} style={{ fontSize: 13, lineHeight: 1.6 }}><XrefText as="span" text={c.text} candidates={candidates} /></li>
                            ))}
                        </ul>
                    </div>
                ))}

                <div style={PAGE_H2}>Regional distribution</div>
                <Grid head={["Region", "Signals"]} empty="No geolocated signals to distribute by region in this window." rows={regionDist.map((r) => (
                    <tr key={r.region}><td style={TD}>{r.region}</td><td style={TD}>{r.count}</td></tr>
                ))} />

                <Folio cls={report.classification} id={report.report_id} page={2} />
            </section>

            {/* Page 3 — Consequence */}
            <section className="docpage" id="pg3" style={DOCPAGE_STYLE}>
                <div style={PAGE_H2}>Exposure and continuity impact</div>
                {!exposure || exposure.asset_count === 0 ? (
                    <EmptyNote>{exposure ? "The real asset register is currently empty — no exposure could be scored." : "No exposure scoring was run for this report."}</EmptyNote>
                ) : (
                    <Grid head={["Asset", "Type", "Distance"]} empty="No real-world assets within range of this window's evidence." rows={(exposure.matches || []).map((m, i) => (
                        <tr key={i}><td style={TD}>{m.asset_name}</td><td style={TD}>{m.asset_type}</td><td style={TD}>{m.distance_km} km</td></tr>
                    ))} />
                )}

                <div style={PAGE_H2}>Indicators and warnings</div>
                {(!narrative.warnings || narrative.warnings.length === 0) ? (
                    <EmptyNote>No warnings identified from current evidence.</EmptyNote>
                ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{narrative.warnings.map((w, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}><XrefText as="span" text={w} candidates={candidates} /></li>)}</ul>
                )}

                <div style={PAGE_H2}>Recommended actions</div>
                {(!narrative.actions || narrative.actions.length === 0) ? (
                    <EmptyNote>No recommended actions generated for this cycle.</EmptyNote>
                ) : (
                    <ol style={{ margin: 0, paddingLeft: 18 }}>{narrative.actions.map((a, i) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}><XrefText as="span" text={a[0]} candidates={candidates} />{" "}<span style={{ color: "#5a6270" }}>— {a[1]}, by {a[2]}</span></li>
                    ))}</ol>
                )}

                <div style={PAGE_H2}>Sourcing and method</div>
                {evidenceClaims.length === 0 ? (
                    <EmptyNote>No sourcing to report for an evidence-free briefing.</EmptyNote>
                ) : (
                    <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {evidenceClaims.length} claims · {new Set(evidenceClaims.map((c) => c.citation?.section).filter(Boolean)).size} distinct feeds cited · references are clickable in the reader · generated from this deployment's real current data.
                    </p>
                )}

                <Folio cls={report.classification} id={report.report_id} page={3} />
            </section>

            {/* Page 4 — Appendix A: link analysis */}
            <AppendixA report={report} linkAnalysis={linkAnalysis} />
        </>
    )
}

const SEV_COLOR = { critical: "#c4453c", high: "#c98a2c", moderate: "#3f6fa8", low: "#6b7280" }

function AppendixA({ report, linkAnalysis }) {
    const objects = (linkAnalysis?.objects || []).slice(0, 10)
    const links = (linkAnalysis?.links || []).slice(0, 15)
    const inferredCount = (linkAnalysis?.links || []).filter((l) => l.inferred).length
    return (
        <section className="docpage" id="pg4" style={DOCPAGE_STYLE}>
            <div style={{ position: "absolute", top: 20, right: 70, font: "400 8.5px var(--font)", letterSpacing: "0.14em", color: "#7d7870" }}>{report.classification}</div>
            <div style={PAGE_H2}>Appendix A — link analysis</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                Objects and relationships in the ontology that bear on this evidence set. Asserted relationships come
                from manually-curated or claim-backed ontology edges; inferred relationships are generated by this
                deployment's automatic detection-rule wiring and should not be treated as established.
            </p>
            <Grid head={["Object", "Type"]} empty="No ontology objects are linked to this document's evidence set." rows={objects.map((o) => (
                <tr key={o.id}><td style={TD}>{o.label}</td><td style={{ ...TD, textTransform: "capitalize" }}>{o.type || "—"}</td></tr>
            ))} />
            <div style={PAGE_H3}>Relationships</div>
            <Grid head={["From", "Relationship", "To", "Basis"]} empty="No real relationships found between this document's ontology objects." rows={links.map((l) => (
                <tr key={l.id}>
                    <td style={TD}>{l.source_label}</td><td style={TD}>{l.type}</td><td style={TD}>{l.target_label}</td>
                    <td style={TD}>{l.inferred ? "Inferred" : "Asserted"}</td>
                </tr>
            ))} />
            <div style={CALLOUT}>
                <b>Method note.</b> {(linkAnalysis?.links || []).length} relationship{(linkAnalysis?.links || []).length === 1 ? "" : "s"}, {inferredCount} of them inferred.
                Inferred links are generated from this deployment's real automatic detection-rule wiring (real co-occurrence
                and shared registry data, not a stated fact); they are review candidates, not conclusions.
            </div>
            <Folio cls={report.classification} id={report.report_id} page={4} />
        </section>
    )
}
