import { useState, useEffect, useMemo } from "react"
import { listReports, getReport, getReportSections, getXrefIndex } from "../mobileApi.js"
import { buildXrefCandidates, wrapXrefsHtml } from "../../reports/xrefEngine.js"
import Loading from "../../ui/Loading.jsx"

const EVIDENCE_SECTION_IDS = ["maritime_activity", "aerial_activity", "imagery_detection", "alerts_events", "open_source_context", "area_overview", "outlook_watch"]

function regionDistribution(sections) {
    const tally = new Map()
    for (const s of sections) {
        if (!EVIDENCE_SECTION_IDS.includes(s.section_id)) continue
        for (const c of s.claims || []) { if (c.region) tally.set(c.region, (tally.get(c.region) || 0) + 1) }
    }
    return [...tally.entries()].map(([region, count]) => ({ region, count }))
}
function allClaims(sections) {
    const out = []
    for (const s of sections) if (EVIDENCE_SECTION_IDS.includes(s.section_id)) out.push(...(s.claims || []))
    return out
}

/** Real .xref span rendering at phone measure — same real wrapXrefsHtml()
 * the console reader uses (never a second wrapping implementation), click
 * handling delegated at the container per the same reason as the reader:
 * these are raw HTML strings, not React elements. */
function XrefText({ text, candidates, style }) {
    const html = useMemo(() => wrapXrefsHtml(text, candidates), [text, candidates])
    // eslint-disable-next-line react/no-danger
    return <p style={{ fontSize: 15, lineHeight: 1.68, color: "var(--txt-2)", margin: "0 0 10px", ...style }} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function BriefTab({ onOpenNoteWithReference, initialReportId }) {
    const [reports, setReports] = useState([])
    // Real session continuity (app.jsx's phoneMode correction): if the
    // desktop console had a specific briefing open, Brief opens to that
    // exact same document across the mode switch — never a second,
    // independently-defaulted "most recent" choice when a real one exists.
    const [reportId, setReportId] = useState(initialReportId || null)
    const [report, setReport] = useState(null)
    const [sections, setSections] = useState(null)
    const [xrefIndex, setXrefIndex] = useState(null)
    const [sheetRecord, setSheetRecord] = useState(null)

    useEffect(() => { listReports().then((r) => { setReports(r); if (r[0] && !initialReportId) setReportId(r[0].report_id) }).catch(() => {}) }, [initialReportId])
    useEffect(() => {
        if (!reportId) return
        Promise.all([getReport(reportId), getReportSections(reportId), getXrefIndex(reportId).catch(() => null)])
            .then(([r, s, x]) => { setReport(r); setSections(s); setXrefIndex(x) })
    }, [reportId])

    const evidenceClaims = useMemo(() => (sections ? allClaims(sections) : []), [sections])
    const regionNames = useMemo(() => (sections ? regionDistribution(sections).map((r) => r.region) : []), [sections])
    const candidates = useMemo(() => buildXrefCandidates(xrefIndex, regionNames), [xrefIndex, regionNames])

    function handleClick(e) {
        const el = e.target.closest?.(".xref")
        if (!el) return
        const kind = el.dataset.k, id = el.dataset.id
        const label = el.textContent
        if (kind === "signal") {
            const rec = (xrefIndex?.signals || []).find((s) => s.id === id)
            setSheetRecord({ kind, id, label, ...rec })
        } else if (kind === "scene") {
            const rec = (xrefIndex?.scenes || []).find((s) => s.id === id)
            setSheetRecord({ kind, id, label, ...rec })
        } else if (kind === "node") {
            const rec = (xrefIndex?.nodes || []).find((n) => n.id === id)
            setSheetRecord({ kind, id, label, ...rec })
        } else if (kind === "region") {
            const matches = evidenceClaims.filter((c) => c.region === id)
            setSheetRecord({ kind, id, label, matches })
        }
    }

    if (!reportId) return <div style={{ padding: 20, color: "var(--txt-3)", fontSize: 14 }}>No real briefings available yet.</div>

    function handleKeyDown(e) {
        if (e.key !== "Enter" && e.key !== " ") return
        const el = e.target.closest?.(".xref")
        if (!el) return
        e.preventDefault()
        handleClick(e)
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }} onClickCapture={handleClick} onKeyDownCapture={handleKeyDown}>
            <div style={{ padding: "10px 16px 6px", font: "700 20px var(--font)" }}>Brief</div>
            <div className="m-chiprow">
                {reports.map((r) => (
                    <button key={r.report_id} className="chip" aria-pressed={r.report_id === reportId} onClick={() => setReportId(r.report_id)}>{r.title.slice(0, 24)}</button>
                ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 18px 24px" }}>
                {!report || !sections ? (
                    <Loading label="Loading briefing" />
                ) : (
                    <>
                        <div style={{ font: "700 20px var(--font)", margin: "4px 0 4px" }}>{report.title}</div>
                        <div style={{ fontSize: 12.5, color: "var(--txt-3)", marginBottom: 14 }}>{report.report_id} · {report.status}</div>
                        {report.key_judgments && <XrefText text={report.key_judgments} candidates={candidates} style={{ whiteSpace: "pre-wrap" }} />}
                        {evidenceClaims.map((c) => (
                            <XrefText key={c.claim_id} text={c.text} candidates={candidates} />
                        ))}
                    </>
                )}
            </div>

            {sheetRecord && (
                <ReferenceSheet record={sheetRecord} onClose={() => setSheetRecord(null)} onNoteToDesk={() => {
                    onOpenNoteWithReference({ kind: sheetRecord.kind, id: sheetRecord.id, label: sheetRecord.label })
                    setSheetRecord(null)
                }} />
            )}
        </div>
    )
}

function ReferenceSheet({ record, onClose, onNoteToDesk }) {
    return (
        <>
            <div className="m-sheet-scrim" onClick={onClose} />
            <div className="m-sheet">
                <div className="m-sheet-handle" />
                <div className="m-sheet-body">
                    <div style={{ textTransform: "uppercase", fontSize: 12, letterSpacing: "0.05em", color: "var(--txt-3)", marginBottom: 6 }}>{record.kind}</div>
                    <div style={{ font: "700 18px var(--font)", marginBottom: 10 }}>{record.label}</div>
                    {record.kind === "region" ? (
                        record.matches.length === 0 ? (
                            <p style={{ color: "var(--txt-3)", fontSize: 14 }}>No real signals from this briefing fall in this region.</p>
                        ) : record.matches.map((c) => <p key={c.claim_id} style={{ fontSize: 14, color: "var(--txt-2)" }}>{c.text}</p>)
                    ) : (
                        <dl className="kv">
                            {record.lat != null && <><dt>Location</dt><dd>{record.lat.toFixed(2)}°, {record.lon?.toFixed(2)}°</dd></>}
                            {record.object_type && <><dt>Object</dt><dd style={{ textTransform: "capitalize" }}>{record.object_type}</dd></>}
                            {record.scan_timestamp && <><dt>Scan date</dt><dd>{record.scan_timestamp.slice(0, 16).replace("T", " ")}</dd></>}
                            {record.instrument && <><dt>Sensor</dt><dd>{record.instrument}</dd></>}
                            {record.type && <><dt>Type</dt><dd style={{ textTransform: "capitalize" }}>{record.type}</dd></>}
                        </dl>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                        <button className="btn m-tap" onClick={onNoteToDesk}>Note to desk</button>
                    </div>
                </div>
            </div>
        </>
    )
}
