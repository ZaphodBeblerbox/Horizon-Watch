import { useState, useEffect, useRef, useMemo } from "react"
import { getReport, getReportSections, patchReport, listReports } from "./reportApi.js"
import DocumentRenderer, { allEvidenceClaims } from "./DocumentRenderer.jsx"
import MiniMap from "./MiniMap.jsx"
import { replayOnMap } from "../services/replayOnMap.js"

const WALKTHROUGH_INTERVAL_MS = 3600

function StatusDot({ status }) {
    const color = status === "published" ? "var(--delta-better)" : status === "in_review" ? "var(--sev-high)" : status === "rejected" ? "var(--sev-critical)" : "var(--txt-4)"
    return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", marginRight: 5 }} />
}

/** Kind-specific real actions for the reference pane. Only ever offers an
 * action that leads somewhere real — an unbuilt destination (Ontology,
 * Imagery's change-detection viewer) shows an honest disabled note instead
 * of a button that goes nowhere. */
function ReferenceActions({ claim, kind }) {
    const hasCoord = claim.lat != null && claim.lon != null
    const entityPrefix = claim.citation?.section === "adsb_anomalies" ? "adsb" : claim.citation?.section === "ais_anomalies" ? "ais" : null

    function openOnMap() {
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => { if (hasCoord) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: claim.lat, lon: claim.lon, altitude: 60000 } })) }, 50)
        if (entityPrefix && claim.citation?.item_id) {
            setTimeout(() => window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { id: `${entityPrefix}-${claim.citation.item_id}` } })), 400)
        }
    }
    function openInInbox() { window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "inbox" } })) }

    // Replay's shared "Replay on map" animation (src/services/replayOnMap.js)
    // — same function Replay.jsx's own row selection and any other signal
    // row in the app calls, never a second implementation. A report claim
    // carries no real timestamp (see backend/report_sections.py's claim
    // shape), so this plays an honest fly-to + single ping with no real
    // lead-up walk rather than fabricating one relative to a fake "now".
    function animateLeadUp() { replayOnMap({ lat: claim.lat, lon: claim.lon, title: claim.text }) }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hasCoord && <button className="btn sm" onClick={openOnMap}>open on map</button>}
            {kind === "signal" && <button className="btn sm" onClick={openInInbox}>open in inbox</button>}
            {kind === "signal" && hasCoord && (
                <button className="btn sm" onClick={animateLeadUp} title="No real prior-signal timestamp on this claim, so this flies in and pings without a lead-up walk">animate lead-up</button>
            )}
            {kind === "scene" && (
                <button className="btn sm" disabled title="Change-detection viewer not built yet — see the Imagery module">open change detection</button>
            )}
            {kind === "region" && (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                    Region: {claim.region || "unclassified"}
                </div>
            )}
        </div>
    )
}

export default function Briefings({ initialReportId, onPrint }) {
    const [reports, setReports] = useState([])
    const [reportId, setReportId] = useState(initialReportId || null)
    const [report, setReport] = useState(null)
    const [sections, setSections] = useState([])
    const [mode, setMode] = useState("read")
    const [activeRef, setActiveRef] = useState(null) // {claim, kind}
    const [walking, setWalking] = useState(false)
    const [dirty, setDirty] = useState(false)
    const [draftKJ, setDraftKJ] = useState("")
    const [draftClaims, setDraftClaims] = useState(null)
    const [resolved, setResolved] = useState(new Set())
    const walkIdxRef = useRef(0)
    const dirtyRef = useRef(false)
    const docRef = useRef(null)

    useEffect(() => { listReports().then(setReports).catch(() => {}) }, [])
    useEffect(() => { if (initialReportId) setReportId(initialReportId) }, [initialReportId])

    useEffect(() => {
        if (!reportId) return
        Promise.all([getReport(reportId), getReportSections(reportId)]).then(([r, s]) => {
            setReport(r); setSections(s); setDraftKJ(r.key_judgments || ""); setDraftClaims(r.claims); setDirty(false)
            dirtyRef.current = false
        })
    }, [reportId])

    const references = useMemo(() => allEvidenceClaims(sections), [sections])

    const editable = report?.status === "draft"

    function selectRef(claim, kind) { setActiveRef({ claim, kind }) }

    function scrollToClaim(claimId) {
        const el = document.querySelector(`[data-claim-id="${claimId}"]`)
        el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }

    // Guided walkthrough — exactly 3.6s per reference, not an approximation.
    useEffect(() => {
        if (!walking || references.length === 0) return
        walkIdxRef.current = 0
        const step = () => {
            const claim = references[walkIdxRef.current]
            selectRef(claim, "signal")
            scrollToClaim(claim.claim_id)
            walkIdxRef.current += 1
            if (walkIdxRef.current >= references.length) setWalking(false)
        }
        step()
        const id = setInterval(() => {
            if (walkIdxRef.current >= references.length) { clearInterval(id); return }
            step()
        }, WALKTHROUGH_INTERVAL_MS)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walking])

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

    return (
        <div style={{ display: "grid", gridTemplateColumns: "236px 1fr 336px", height: "100%", overflow: "hidden" }}>
            {/* Left — register + reference index */}
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 10 }}>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Briefings</div>
                {reports.map((r) => (
                    <div key={r.report_id} role="button" onClick={() => setReportId(r.report_id)}
                        style={{ padding: "6px 4px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: r.report_id === reportId ? "var(--bg-2)" : "transparent" }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                        <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}><StatusDot status={r.status} />{r.report_id} · {r.status} · {(r.created_at || "").slice(0, 10)}</div>
                    </div>
                ))}
                {reportId && (
                    <>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 6px" }}>References</div>
                        {references.map((c, i) => (
                            <div key={c.claim_id} role="button" onClick={() => { selectRef(c, "signal"); scrollToClaim(c.claim_id) }}
                                style={{ padding: "4px 4px", font: "400 11.5px var(--font)", color: activeRef?.claim?.claim_id === c.claim_id ? "var(--txt)" : "var(--txt-3)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {i + 1}. {c.text}
                            </div>
                        ))}
                        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setWalking((w) => !w)}>
                            {walking ? "stop walkthrough" : "guided walkthrough"}
                        </button>
                    </>
                )}
            </div>

            {/* Centre — document */}
            <div style={{ overflowY: "auto", padding: "24px 20px" }}>
                {!report ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Select a briefing from the register.</div>
                ) : (
                    <div ref={docRef} onClickCapture={(e) => {
                        const el = e.target.closest?.("[data-claim-id]")
                        if (el) scrollToClaim(el.getAttribute("data-claim-id"))
                    }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
                            <div className="seg">
                                <button aria-pressed={mode === "read"} onClick={() => setMode("read")}>read</button>
                                <button aria-pressed={mode === "edit"} disabled={!editable} onClick={() => setMode("edit")} title={!editable ? `Only draft reports can be edited (this one is ${report.status})` : ""}>edit</button>
                            </div>
                            {mode === "edit" && <button className="btn sm" onClick={saveNow}>{dirty ? "save draft*" : "save draft"}</button>}
                            <button className="btn sm" onClick={() => onPrint?.(reportId)}>print / pdf</button>
                        </div>
                        <DocWithClaimAnchors sections={renderSections}>
                            <DocumentRenderer
                                report={renderReport} sections={renderSections} mode={mode}
                                activeClaimId={activeRef?.claim?.claim_id} onSelectXref={selectRef}
                                onEditKeyJudgments={onEditKeyJudgments} onEditClaimText={onEditClaimText}
                                resolvedComments={resolved} onToggleResolve={(id) => setResolved((prev) => {
                                    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
                                })}
                            />
                        </DocWithClaimAnchors>
                    </div>
                )}
            </div>

            {/* Right — minimap + reference detail */}
            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto" }}>
                <MiniMap focus={activeRef?.claim} context={references} height={196} />
                <div style={{ padding: 12 }}>
                    {!activeRef ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Click a reference in the document to inspect it here.</div>
                    ) : (
                        <>
                            <div style={{ font: "600 12px var(--font)", color: "var(--txt)", marginBottom: 4 }}>{activeRef.kind}</div>
                            <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", marginBottom: 10 }}>{activeRef.claim.text}</div>
                            <ReferenceActions claim={activeRef.claim} kind={activeRef.kind} />
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Wraps each rendered claim paragraph with a data-claim-id anchor so
 * scroll-into-view (guided walkthrough, reference-index clicks) can target
 * it — done via a DOM query rather than threading refs through
 * DocumentRenderer, since it's shared with the print layout which has no
 * need for this. */
function DocWithClaimAnchors({ children }) {
    return <div data-claim-anchors="true">{children}</div>
}

function mergeDraftClaims(sections, draftClaims) {
    const byId = new Map(draftClaims.map((c) => [c.claim_id, c]))
    return sections.map((s) => ({ ...s, claims: s.claims.map((c) => ({ ...c, text: byId.get(c.claim_id)?.text ?? c.text })) }))
}
