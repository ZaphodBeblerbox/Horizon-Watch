/**
 * ReportCard.jsx — a user report's marker card, phone and desktop: who reported it and when, that it is
 * unverified, when it expires, the note and the media; "End now" (and Delete) for its author.
 * Re-reads the clock every 30 s so "Expires in" stays true while the card is open.
 */
import { useEffect, useState } from "react"
import { reportIcon, reportLines, endReport, deleteReport, reportActive } from "../lib/fieldReports.js"
import { ReportMediaList } from "./ReportForm.jsx"
import "./fieldReports.css"

export default function ReportCard({ r, onDone = null, compact = false }) {
    const [now, setNow] = useState(() => Date.now())
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState("")
    const [state, setState] = useState(r)
    useEffect(() => { setState(r) }, [r])
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])
    if (!state) return null
    const kind = state.report_kind || state.kind
    const c = reportLines(state, now)
    const act = async (fn, after) => {
        setBusy(true); setErr("")
        try { const out = await fn(state.id); if (after) after(out) } catch (ex) { setErr(ex.message || "That did not work") }
        setBusy(false)
    }
    return (
        <div className="fr-card" data-testid="fr-card">
            <div className="fr-card-head">
                <img src={reportIcon(kind)} alt="" />
                <div style={{ minWidth: 0 }}>
                    <h3 data-testid="fr-card-title">{c.title}</h3>
                    <div className="fr-meta" data-testid="fr-card-who">{c.who}{c.when ? `, ${c.when}` : ""}</div>
                    <div className="fr-meta" data-testid="fr-card-expiry">{c.expiry}{state.place ? ` · ${state.place}` : ""}</div>
                </div>
            </div>
            {state.note && <div className="fr-note">{compact && state.note.length > 220 ? `${state.note.slice(0, 220)}…` : state.note}</div>}
            <ReportMediaList media={state.media} />
            {err && <div className="fr-err" role="alert">{err}</div>}
            {state.mine && (
                <div className="fr-acts" style={{ justifyContent: "flex-start" }}>
                    {reportActive(state, now) && (
                        <button className="fr-btn" disabled={busy} data-testid="fr-end"
                                onClick={() => act(endReport, (out) => { setState({ ...state, ...out, kind: state.kind, report_kind: kind }); onDone?.("ended") })}>
                            End now
                        </button>
                    )}
                    <button className="fr-btn ghost" disabled={busy}
                            onClick={() => act(deleteReport, () => onDone?.("deleted"))}>Delete</button>
                </div>
            )}
        </div>
    )
}

/** The desktop Inspector's extension (inspector/extensionRegistry.js): the card under a user report's record. */
export function ReportInspectorExtension({ record }) {
    if (!record || record.kind !== "field_report") return null
    return <div style={{ marginTop: 10 }}><ReportCard r={record} /></div>
}
