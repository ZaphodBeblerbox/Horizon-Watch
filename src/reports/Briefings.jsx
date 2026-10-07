import { useState, useEffect, useRef, useMemo } from "react"
import { getReportBundle, patchReport, listReports } from "./reportApi.js"
import DocumentRenderer, { allEvidenceClaims, buildRegionDistribution } from "./DocumentRenderer.jsx"
import Minimap from "../components/Minimap.jsx"
import { replayOnMap } from "../services/replayOnMap.js"
import { safeArray } from "../utils/safeArray.js"
import { shareToDesk } from "../desk/shareToDesk.js"

const WALKTHROUGH_INTERVAL_MS = 3600

// Real per-kind minimap framing span (implementation manual v1.0 §4.4) — a
// region needs the wide frame to show distribution, a scene the tight one
// to show a single site.
const MINIMAP_SPAN = { signal: 16, scene: 10, node: 20, region: 46 }

const RB = { height: 30, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 0, textAlign: "left" }

function StatusDot({ status }) {
    const color = status === "published" ? "var(--delta-better)" : status === "in_review" ? "var(--sev-high)" : status === "rejected" ? "var(--sev-critical)" : "var(--txt-4)"
    return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", marginRight: 5 }} />
}

/** Real per-kind reference-pane content + onward actions. Every action
 * calls the exact real shared function the target module itself exposes
 * (map fly-to/select, replayOnMap, Imagery's scene loader, Ontology's
 * locate/select) — never a reader-specific re-implementation, so clicking
 * through lands in the identical state a direct visit would. */
function ReferencePane({ record, documentClaims, onSelectRef }) {
    if (!record) {
        return <div style={{ fontSize: 13, color: "var(--txt3)", lineHeight: 1.55 }}>Click an underlined reference in the briefing — a signal, an image, a place — to see it here, on the map above, and to open it where it lives.</div>
    }
    const { kind } = record
    const hasCoord = record.lat != null && record.lon != null

    function openOnMap() {
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => { if (hasCoord) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: record.lat, lon: record.lon, altitude: 60000 } })) }, 50)
    }
    function openInInbox() { window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "inbox" } })) }
    // Real, single shared "Replay on map" animation (src/services/
    // replayOnMap.js) — same function Replay.jsx's own row selection and
    // every other signal row in the app calls, never a second copy.
    function animateLeadUp() { replayOnMap({ lat: record.lat, lon: record.lon, publishedAt: record.created_at, title: record.text || record.label }) }
    function openChangeDetection() {
        window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "imagery" } }))
        window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", { detail: { detectionId: record.id } }))
    }
    function openInOntology() {
        window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "ontology" } }))
        window.dispatchEvent(new CustomEvent("akili:ontology-select-node", { detail: { id: record.id } }))
    }

    return (
        <>
            <div style={{ font: "600 12px var(--font)", color: "var(--txt)", marginBottom: 4, textTransform: "capitalize" }}>{kind}</div>

            {kind === "signal" && (
                <>
                    <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", marginBottom: 10 }}>{record.text || record.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {hasCoord && <button onClick={openOnMap} style={RB}>Open on the map</button>}
                        {hasCoord && <button onClick={animateLeadUp} style={RB}>Replay the lead-up</button>}
                        <button onClick={openInInbox} style={RB}>Open in the Inbox</button>
                    </div>
                </>
            )}

            {kind === "scene" && (
                <>
                    <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", marginBottom: 4 }}>{record.label}</div>
                    <dl className="kv" style={{ marginBottom: 10 }}>
                        <dt>Object</dt><dd style={{ textTransform: "capitalize" }}>{record.object_type || "—"}</dd>
                        <dt>Place</dt><dd>{record.nearest_port || record.nearest_chokepoint || "—"}</dd>
                        <dt>Scan date</dt><dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{(record.scan_timestamp || "").slice(0, 16).replace("T", " ") || "—"}</dd>
                        <dt>Sensor</dt><dd>{record.instrument || "—"}</dd>
                    </dl>
                    <button onClick={openChangeDetection} style={RB}>Open the imagery</button>
                </>
            )}

            {kind === "node" && (
                <>
                    <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", marginBottom: 4 }}>{record.label}</div>
                    <dl className="kv" style={{ marginBottom: 10 }}>
                        <dt>Type</dt><dd style={{ textTransform: "capitalize" }}>{record.type || "—"}</dd>
                    </dl>
                    <button onClick={openInOntology} style={RB}>Open in the graph</button>
                </>
            )}

            {kind === "region" && (() => {
                // Scoped to THIS document's own evidence set — never every
                // signal in that region globally.
                const matches = documentClaims.filter((c) => c.region === record.id)
                return (
                    <>
                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>
                            {matches.length} signal{matches.length === 1 ? "" : "s"} from this document in {record.label}
                        </div>
                        {matches.length === 0 ? (
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No claims in this document fall in this region.</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {matches.map((c) => (
                                    <div key={c.claim_id} role="button" onClick={() => onSelectRef("signal", String(c.citation?.item_id ?? c.claim_id))}
                                        style={{ font: "400 12px var(--font)", color: "var(--txt-2)", cursor: "pointer", paddingBottom: 6, borderBottom: "1px solid var(--line-soft)" }}>
                                        {c.text}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )
            })()}
        </>
    )
}

/** Real merged record lookup — every reference kind's full real data in one
 * map, keyed "kind:id", so a click on ANY .xref span (wherever its text
 * happens to appear in the document) resolves to the same real record. */
function buildRecordLookup(xrefIndex, evidenceClaims, regionNames) {
    const map = new Map()
    for (const s of xrefIndex?.signals || []) map.set(`signal:${s.id}`, { kind: "signal", ...s })
    for (const s of xrefIndex?.scenes || []) map.set(`scene:${s.id}`, { kind: "scene", ...s })
    for (const n of xrefIndex?.nodes || []) map.set(`node:${n.id}`, { kind: "node", ...n })
    for (const r of regionNames) map.set(`region:${r}`, { kind: "region", id: r, label: r })
    // Claims enrich whichever real record their own citation resolves to
    // (real text, lat/lon) — a claim's own citation.section decides which
    // real kind it belongs to, same mapping report_sections.py/xref-index use.
    for (const c of evidenceClaims) {
        const sec = c.citation?.section
        const itemId = c.citation?.item_id
        if (!sec || itemId == null) continue
        const k = sec === "sentinel_detections" ? "scene" : sec === "strategic_zones" ? "region" : "signal"
        const key = `${k}:${itemId}`
        const existing = map.get(key) || { kind: k, id: String(itemId) }
        map.set(key, { ...existing, text: c.text, lat: c.lat ?? existing.lat, lon: c.lon ?? existing.lon, created_at: c.created_at, claim_id: c.claim_id })
    }
    return map
}

const PANE = { border: "1px solid var(--gline)", background: "var(--glass2)", minWidth: 0, minHeight: 0 }
const BT = { height: 28, padding: "0 11px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt2)", font: "inherit", fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" }
const BT_ON = { background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }
const SEGB = { height: 28, padding: "0 12px", border: 0, background: "transparent", color: "var(--txt3)", font: "inherit", fontSize: 12.5, cursor: "pointer" }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` }

export default function Briefings({ initialReportId, onPrint, onOpenDeck, onOpenGenerate, isVisible = true }) {
    const [reports, setReports] = useState([])
    const [find, setFind] = useState("")
    const [reportId, setReportId] = useState(initialReportId || null)
    const [report, setReport] = useState(null)
    const [sections, setSections] = useState([])
    const [xrefIndex, setXrefIndex] = useState(null)
    const [mode, setMode] = useState("read")
    const [activeRef, setActiveRef] = useState(null) // {kind, id}
    const [docXrefs, setDocXrefs] = useState([])     // [{k,id,label}] in real document order
    const [walking, setWalking] = useState(false)
    const [refsCollapsed, setRefsCollapsed] = useState(false)
    const [dirty, setDirty] = useState(false)
    const [draftKJ, setDraftKJ] = useState("")
    const [draftClaims, setDraftClaims] = useState(null)
    const [resolved, setResolved] = useState(new Set())
    const walkIdxRef = useRef(0)
    const dirtyRef = useRef(false)
    const docRef = useRef(null)

    useEffect(() => { listReports().then((v) => setReports(safeArray(v))).catch(() => {}) }, [])
    useEffect(() => { if (initialReportId) setReportId(initialReportId) }, [initialReportId])

    useEffect(() => {
        if (!reportId) return
        setActiveRef(null)
        getReportBundle(reportId).then(({ report: r, sections: s, xrefIndex: x }) => {
            setReport(r); setSections(s); setXrefIndex(x); setDraftKJ(r.key_judgments || ""); setDraftClaims(r.claims); setDirty(false)
            dirtyRef.current = false
        })
    }, [reportId])

    const evidenceClaims = useMemo(() => allEvidenceClaims(sections), [sections])
    const regionNames = useMemo(() => buildRegionDistribution(sections).map((r) => r.region), [sections])
    const recordLookup = useMemo(() => buildRecordLookup(xrefIndex, evidenceClaims, regionNames), [xrefIndex, evidenceClaims, regionNames])

    const editable = report?.status === "draft"

    // The one real "activate a reference" function — the click delegate
    // below, the left-pane reference index, and the guided walkthrough all
    // call this exact function, never a parallel implementation of what
    // happens when a reference is activated.
    function selectRef(kind, id) {
        setActiveRef({ kind, id: String(id) })
    }

    function scrollToXrefOccurrence(kind, id) {
        if (!docRef.current) return
        const el = Array.from(docRef.current.querySelectorAll(".xref")).find((e) => e.dataset.k === kind && e.dataset.id === String(id))
        el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }

    function activateReference(kind, id) {
        selectRef(kind, id)
        scrollToXrefOccurrence(kind, id)
    }

    // Real click delegation — .xref spans are raw HTML (wrapped by
    // xrefEngine.js), not React elements, so their click handling lives here
    // rather than per-span.
    function handleDocClick(e) {
        const el = e.target.closest?.(".xref")
        if (!el) return
        activateReference(el.dataset.k, el.dataset.id)
    }

    // A span isn't natively activatable — real keyboard support (Enter/Space)
    // for the same delegated .xref targets, since a <button> here is a real
    // bug (it won't wrap across lines at the reader's 720px measure).
    function handleDocKeyDown(e) {
        if (e.key !== "Enter" && e.key !== " ") return
        const el = e.target.closest?.(".xref")
        if (!el) return
        e.preventDefault()
        activateReference(el.dataset.k, el.dataset.id)
    }

    // Real enumerated index of every .xref actually present, in true
    // document order — rebuilt after each real render of the compiled text
    // (DOM query order === document order regardless of which field a given
    // reference happens to live in: a claim, key judgments, narrative prose,
    // a warning, an action).
    useEffect(() => {
        if (!docRef.current) { setDocXrefs([]); return }
        const els = Array.from(docRef.current.querySelectorAll(".xref"))
        setDocXrefs(els.map((el) => ({ k: el.dataset.k, id: el.dataset.id, label: el.textContent })))
    }, [sections, xrefIndex, mode, draftClaims])

    // Imperative active-highlight — toggles .xref-active on every span
    // matching the active reference (a label can appear more than once).
    useEffect(() => {
        if (!docRef.current) return
        const all = docRef.current.querySelectorAll(".xref")
        all.forEach((el) => el.classList.remove("xref-active"))
        if (!activeRef) return
        docRef.current.querySelectorAll(`.xref[data-k="${activeRef.kind}"][data-id="${CSS.escape(activeRef.id)}"]`)
            .forEach((el) => el.classList.add("xref-active"))
    }, [activeRef, docXrefs])

    // Guided walkthrough — exactly 3.6s per reference, invoking the same
    // activateReference() a manual click calls, never a second parallel
    // "what happens when a reference activates" implementation.
    useEffect(() => {
        if (!walking || docXrefs.length === 0) return
        walkIdxRef.current = 0
        const step = () => {
            const ref = docXrefs[walkIdxRef.current]
            if (ref) activateReference(ref.k, ref.id)
            walkIdxRef.current += 1
            if (walkIdxRef.current >= docXrefs.length) setWalking(false)
        }
        step()
        const id = setInterval(() => {
            if (walkIdxRef.current >= docXrefs.length) { clearInterval(id); return }
            step()
        }, WALKTHROUGH_INTERVAL_MS)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walking])

    // Real bug fix (implementation manual v1.0 §4.5/§10.6): this app keeps
    // every tab mounted (display:none, not unmounted) while another tab is
    // active — so leaving Briefings for another tab mid-walkthrough would
    // otherwise leave the interval running invisibly against a hidden view.
    // Never let an interval keep firing against a view the analyst can't see.
    useEffect(() => {
        if (!isVisible && walking) setWalking(false)
    }, [isVisible, walking])

    // Autosave — every 8s if dirty, mirroring the previous EditingWorkspace's
    // real, working pattern (server-side PATCH already gates on draft-only).
    useEffect(() => {
        if (!editable) return
        const iv = setInterval(async () => {
            if (!dirtyRef.current || !reportId) return
            await patchReport(reportId, { key_judgments: draftKJRef.current, claims: draftClaimsRef.current })
            dirtyRef.current = false
            setDirty(false)
        }, 8000)
        return () => clearInterval(iv)
    }, [editable, reportId])
    const draftKJRef = useRef(draftKJ); draftKJRef.current = draftKJ
    const draftClaimsRef = useRef(draftClaims); draftClaimsRef.current = draftClaims

    function onEditKeyJudgments(text) { setDraftKJ(text); setDirty(true); dirtyRef.current = true }
    function onEditClaimText(claimId, text) {
        setDraftClaims((prev) => prev.map((c) => (c.claim_id === claimId ? { ...c, text } : c)))
        setDirty(true); dirtyRef.current = true
    }
    async function saveNow() {
        if (!reportId) return
        await patchReport(reportId, { key_judgments: draftKJ, claims: draftClaims })
        setDirty(false); dirtyRef.current = false
    }

    const renderReport = mode === "edit" ? { ...report, key_judgments: draftKJ } : report
    const renderSections = mode === "edit" && draftClaims ? mergeDraftClaims(sections, draftClaims) : sections

    const activeRecord = activeRef ? recordLookup.get(`${activeRef.kind}:${activeRef.id}`) || { kind: activeRef.kind, id: activeRef.id, label: activeRef.id } : null

    return (
        <div data-testid="view-root-briefings" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr) minmax(320px, 380px)", gap: 14, padding: 14, boxSizing: "border-box", height: "100%", overflow: "hidden" }}>
            {/* Left — register + reference index */}
            <div style={{ ...PANE, overflowY: "auto", padding: "14px 16px" }}>
                {/* §S4.1 — "Briefings owns both faces." Dossiers, Ontology and
                    Imagery each had a route into Generate; the surface the
                    briefings actually live on did not, so the only way in was
                    a tab that had to already be open. It sits in the header
                    rather than the document toolbar because that toolbar only
                    renders once a briefing is selected — on an empty register
                    there was no route at all, which is exactly when you most
                    need one. */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Briefings</span>
                    <button data-testid="briefings-generate" onClick={() => onOpenGenerate?.()} style={{ ...BT, ...BT_ON }}>+ New</button>
                </div>
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a briefing…" style={{
                    width: "100%", boxSizing: "border-box", height: 30, padding: "0 10px", marginBottom: 8, border: "1px solid var(--gline2)",
                    background: "var(--glass2)", color: "var(--txt)", font: "inherit", fontSize: 13, outline: "none",
                }} />
                {reports.length === 0 && (
                    <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)", padding: "6px 2px" }}>
                        No briefings yet. Generate writes one from the signals you select.
                    </div>
                )}
                {reports.filter((r) => !find.trim() || `${r.title} ${r.report_id}`.toLowerCase().includes(find.trim().toLowerCase())).map((r) => (
                    <div key={r.report_id} role="button" onClick={() => setReportId(r.report_id)}
                        style={{ padding: "10px 10px", margin: "0 -10px", borderLeft: `2px solid ${r.report_id === reportId ? "var(--acchi)" : "transparent"}`, cursor: "pointer", background: r.report_id === reportId ? "var(--accdim)" : "transparent" }}>
                        <div style={{ fontSize: 13.5, color: "var(--txt)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 11.5, color: "var(--txt3)" }}>
                            <StatusDot status={r.status} />{({ draft: "Draft", in_review: "In review", published: "Published", rejected: "Rejected" })[r.status] || r.status}
                            <span>· {fmtDate(r.created_at)}</span>
                        </div>
                    </div>
                ))}
                {reportId && (
                    <>
                        <div role="button" onClick={() => setRefsCollapsed((c) => !c)}
                            style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", font: "600 11px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 6px" }}>
                            <span style={{ display: "inline-block", transition: "transform 120ms", transform: refsCollapsed ? "rotate(-90deg)" : "none" }}>▾</span>
                            References in this briefing
                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", textTransform: "none", letterSpacing: 0 }}>({docXrefs.length})</span>
                        </div>
                        {!refsCollapsed && (docXrefs.length === 0 ? (
                            <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No cross-references in this document.</div>
                        ) : docXrefs.map((ref, i) => (
                            <div key={`${ref.k}-${ref.id}-${i}`} role="button" onClick={() => activateReference(ref.k, ref.id)}
                                style={{ padding: "4px 4px", font: "400 11.5px var(--font)", color: activeRef?.kind === ref.k && activeRef?.id === ref.id ? "var(--txt)" : "var(--txt-3)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {i + 1}. <span style={{ textTransform: "capitalize" }}>{ref.k}</span> · {ref.label}
                            </div>
                        )))}
                        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setWalking((w) => !w)} disabled={docXrefs.length === 0}>
                            {walking ? "stop walkthrough" : "guided walkthrough"}
                        </button>
                    </>
                )}
            </div>

            {/* Centre — the document, on a reading column */}
            <div style={{ ...PANE, overflowY: "auto", padding: "24px 32px" }}>
                {!report ? (
                    <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--txt3)", fontSize: 14, textAlign: "center", lineHeight: 1.6 }}>
                        <div>Choose a briefing on the left to read it here.<br />
                            <button onClick={() => onOpenGenerate?.()} style={{ ...BT, ...BT_ON, marginTop: 12 }}>Write a new one</button></div>
                    </div>
                ) : (
                    <div ref={docRef} onClickCapture={handleDocClick} onKeyDownCapture={handleDocKeyDown} style={{ maxWidth: 820, margin: "0 auto" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginBottom: 18, position: "sticky", top: -24, padding: "8px 0", background: "var(--bar, var(--glass2))", zIndex: 2 }}>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)", marginRight: "auto" }}>
                                <button onClick={() => setMode("read")} style={{ ...SEGB, ...(mode === "read" ? BT_ON : null) }}>Read</button>
                                <button disabled={!editable} onClick={() => setMode("edit")} title={!editable ? `Only drafts can be edited (this one is ${report.status})` : ""} style={{ ...SEGB, ...(mode === "edit" ? BT_ON : null), opacity: editable ? 1 : 0.45 }}>Edit</button>
                            </div>
                            {mode === "edit" && <button onClick={saveNow} style={BT}>{dirty ? "Save draft •" : "Saved"}</button>}
                            <button onClick={() => shareToDesk({ kind: "briefing", report_id: reportId, title: report.title, status: report.status, created_at: report.created_at, summary: (report.key_judgments || "").slice(0, 220) || null })} style={BT}>Share to the desk</button>
                            <button onClick={() => onPrint?.(reportId)} style={BT}>Print / PDF</button>
                            <button onClick={() => onOpenDeck?.(reportId)} style={{ ...BT, ...BT_ON }}>Present as a deck</button>
                        </div>
                        <DocumentRenderer
                            report={renderReport} sections={renderSections} mode={mode} xrefIndex={xrefIndex}
                            onEditKeyJudgments={onEditKeyJudgments} onEditClaimText={onEditClaimText}
                            resolvedComments={resolved} onToggleResolve={(id) => setResolved((prev) => {
                                const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
                            })}
                        />
                    </div>
                )}
            </div>

            {/* Right — where it is, and the reference in focus */}
            <div style={{ ...PANE, overflowY: "auto" }}>
                <Minimap
                    focus={activeRecord?.lat != null ? activeRecord : null}
                    context={evidenceClaims}
                    span={MINIMAP_SPAN[activeRecord?.kind] || undefined}
                    label={activeRecord?.title ? String(activeRecord.title).slice(0, 28) : ""}
                    title="Locator"
                />
                <div style={{ padding: 12 }}>
                    <ReferencePane record={activeRecord} documentClaims={evidenceClaims} onSelectRef={activateReference} />
                </div>
            </div>
        </div>
    )
}

function mergeDraftClaims(sections, draftClaims) {
    const byId = new Map(draftClaims.map((c) => [c.claim_id, c]))
    return sections.map((s) => ({ ...s, claims: s.claims.map((c) => ({ ...c, text: byId.get(c.claim_id)?.text ?? c.text })) }))
}
