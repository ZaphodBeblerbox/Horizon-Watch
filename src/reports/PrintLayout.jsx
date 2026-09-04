import { useState, useEffect } from "react"
import { getReport, getReportSections } from "./reportApi.js"
import DocumentRenderer from "./DocumentRenderer.jsx"

// PrintLayout — #view-doc. Reachable only from the reader or Generate's
// printable-briefing button, never the module rail (a hidden view). Renders
// the exact same DocumentRenderer as the reader/editor (mode="print" — the
// same renderer, so this page and the reader/editor can never structurally
// diverge), then defers to the browser's native print/save-as-PDF via the
// print CSS below — one real export path, not a second implementation
// alongside the (currently unused) server-rendered reportlab PDF.

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
}
`

export default function PrintLayout({ reportId, onBack }) {
    const [report, setReport] = useState(null)
    const [sections, setSections] = useState(null)
    const [zoom, setZoom] = useState(100)

    useEffect(() => {
        if (!reportId) return
        Promise.all([getReport(reportId), getReportSections(reportId)]).then(([r, s]) => { setReport(r); setSections(s) })
    }, [reportId])

    return (
        <div id="view-doc" className="view" style={{ display: "grid", gridTemplateColumns: "242px 1fr", height: "100%", overflow: "hidden" }}>
            <style>{PRINT_CSS}</style>
            {/* Toolbar (on-screen only, hidden by print CSS via .doctools) */}
            <div className="doctools" style={{ borderRight: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <button className="btn" onClick={onBack}>← back</button>
                <div className="field"><label>Zoom</label>
                    <div className="seg">{[75, 100, 125].map((z) => <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z}%</button>)}</div>
                </div>
                <button className="btn primary" onClick={() => window.print()}>print / pdf</button>
                {/* distribute — omitted: no real distribution-list feature
                    exists in the backend (checked main.py/database.py) — a
                    button here would confirm something that doesn't happen. */}
            </div>

            <div className="docdesk" style={{ overflow: "auto", background: "#3a3d42", padding: 24 }}>
                <div className="panes" style={{ display: "flex", justifyContent: "center" }}>
                    {!report || !sections ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Loading…</div>
                    ) : (
                        <div className="pane" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
                            <div className="docpage" style={{
                                width: 816, minHeight: 1056, background: "#f4f2ee", color: "#1b1f24",
                                padding: "62px 70px 54px", boxShadow: "0 10px 26px rgba(0,0,0,.42)",
                                display: "flex", flexDirection: "column",
                            }}>
                                <div style={{ flex: 1 }}>
                                    <DocumentRenderer report={report} sections={sections} mode="print" />
                                </div>
                                <div style={{ marginTop: "auto", paddingTop: 20, display: "flex", justifyContent: "space-between", font: "400 10px var(--mono)", color: "#6b6f76" }}>
                                    <span>{report.report_id}</span>
                                    <span>Page 1</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
