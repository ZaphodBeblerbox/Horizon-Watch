import { useState, useEffect, useMemo } from "react"
import { getForgeAlerts, acknowledgeAlert, escalateAlert } from "../mobileApi.js"

const SEV_RANK = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1 }
// Real .dia severity modifier classes (designSystem.css) — "medium" is the
// only real backend severity string with no matching CSS modifier of its
// own; it maps to the same visual step "moderate" already uses.
const SEV_CLASS = { critical: "critical", high: "high", moderate: "moderate", medium: "moderate", low: "low" }

const FILTERS = [
    { id: "needs_action", label: "Needs action" },
    { id: "escalated", label: "Escalated" },
    { id: "critical", label: "Critical" },
    { id: "all", label: "All" },
]

function timeAgo(iso) {
    if (!iso) return "—"
    const ms = Date.now() - new Date(iso).getTime()
    const min = Math.round(ms / 60000)
    if (min < 1) return "just now"
    if (min < 60) return `${min}m ago`
    const hr = Math.round(min / 60)
    if (hr < 24) return `${hr}h ago`
    return `${Math.round(hr / 24)}d ago`
}

export default function AlertsTab({ onOpenNoteWithReference, onShowOnMap }) {
    const [alerts, setAlerts] = useState([])
    const [filter, setFilter] = useState("needs_action")
    const [sheetAlert, setSheetAlert] = useState(null)
    const [busy, setBusy] = useState(false)

    function load() {
        getForgeAlerts().then((d) => setAlerts(Array.isArray(d) ? d : [])).catch(() => {})
    }
    useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t) }, [])

    const filtered = useMemo(() => {
        const acked = (a) => a.status === "acknowledged"
        const escalated = (a) => (a.tags || []).includes("escalated")
        let rows = alerts
        if (filter === "needs_action") rows = rows.filter((a) => !acked(a))
        else if (filter === "escalated") rows = rows.filter(escalated)
        else if (filter === "critical") rows = rows.filter((a) => a.severity === "critical")
        return rows.slice().sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || (b.timestamp || "").localeCompare(a.timestamp || ""))
    }, [alerts, filter])

    const badgeCount = alerts.filter((a) => a.status !== "acknowledged").length

    async function doAcknowledge(alert) {
        setBusy(true)
        try {
            await acknowledgeAlert(alert.id, "operator")
            setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, status: "acknowledged" } : a)))
            setSheetAlert(null)
        } finally { setBusy(false) }
    }
    async function doEscalate(alert) {
        setBusy(true)
        try {
            await escalateAlert(alert.id, "operator")
            setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, tags: [...(a.tags || []), "escalated"] } : a)))
        } finally { setBusy(false) }
    }
    function showOnMap(alert) {
        onShowOnMap(alert.lat, alert.lon ?? alert.lng)
    }
    function noteToDesk(alert) {
        onOpenNoteWithReference({ kind: "signal", id: alert.id, label: alert.title })
        setSheetAlert(null)
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 4px" }}>
                <div style={{ font: "700 20px var(--font)" }}>Alerts</div>
                {badgeCount > 0 && (
                    <div style={{ background: "var(--sev-critical)", color: "#fff", borderRadius: 12, minWidth: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", font: "700 12px var(--mono)", padding: "0 6px" }}>
                        {badgeCount}
                    </div>
                )}
            </div>
            <div className="m-chiprow">
                {FILTERS.map((f) => (
                    <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px 16px" }}>
                {filtered.length === 0 ? (
                    <div style={{ color: "var(--txt-3)", fontSize: 14, padding: "20px 0" }}>No real alerts match this filter right now.</div>
                ) : filtered.map((a, i) => {
                    const acked = a.status === "acknowledged"
                    return (
                        // Real data occasionally repeats the same alert id (confirmed
                        // live — a duplicate fusion-event id) — appending the index
                        // keeps React's key unique without masking that as a bug fixed
                        // here; it's a pre-existing backend dedup quirk, out of scope.
                        <div key={`${a.id}-${i}`} role="button" className="m-tap" onClick={() => setSheetAlert(a)}
                            style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid var(--line-soft)", opacity: acked ? 0.55 : 1, cursor: "pointer" }}>
                            <span className={`dia ${SEV_CLASS[a.severity] || ""}`} style={{ marginTop: 5 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15, color: "var(--txt)", lineHeight: 1.4 }}>{a.title}</div>
                                <div style={{ fontSize: 12.5, color: "var(--txt-3)", marginTop: 2 }}>
                                    {a.source} · {timeAgo(a.timestamp)}{(a.tags || []).includes("escalated") ? " · escalated" : ""}{acked ? " · acknowledged" : ""}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {sheetAlert && (
                <>
                    <div className="m-sheet-scrim" onClick={() => setSheetAlert(null)} />
                    <div className="m-sheet">
                        <div className="m-sheet-handle" />
                        <div className="m-sheet-body">
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span className={`dia ${SEV_CLASS[sheetAlert.severity] || ""}`} />
                                <span style={{ textTransform: "uppercase", fontSize: 12, letterSpacing: "0.05em", color: "var(--txt-3)" }}>{sheetAlert.severity || "unknown"} · {sheetAlert.source}</span>
                            </div>
                            <div style={{ font: "700 18px var(--font)", margin: "4px 0 8px" }}>{sheetAlert.title}</div>
                            {sheetAlert.message && <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--txt-2)", margin: "0 0 6px" }}>{sheetAlert.message}</p>}
                            <dl className="kv">
                                <dt>Location</dt><dd>{sheetAlert.lat != null ? `${sheetAlert.lat.toFixed(2)}°, ${(sheetAlert.lon ?? sheetAlert.lng)?.toFixed(2)}°` : "—"}</dd>
                                <dt>Received</dt><dd>{sheetAlert.timestamp ? new Date(sheetAlert.timestamp).toLocaleString() : "—"}</dd>
                                <dt>Source</dt><dd>{sheetAlert.source || "—"}{sheetAlert.correlation_domains ? ` (${sheetAlert.correlation_domains}, multi-source)` : " (single-source)"}</dd>
                                <dt>Confidence</dt><dd>{sheetAlert.confidence != null ? `${Math.round(sheetAlert.confidence * (sheetAlert.confidence <= 1 ? 100 : 1))}%` : "—"}</dd>
                                <dt>Corroboration</dt><dd>{(sheetAlert.correlated_alert_ids || []).length} real linked alert(s)</dd>
                                <dt>Dependencies</dt><dd>{(sheetAlert.zone_ids || []).length ? `${sheetAlert.zone_ids.length} zone(s) touched` : "—"}</dd>
                            </dl>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                                <button className="btn primary m-tap" style={{ justifyContent: "center" }} disabled={busy || sheetAlert.status === "acknowledged"} onClick={() => doAcknowledge(sheetAlert)}>
                                    {sheetAlert.status === "acknowledged" ? "Acknowledged" : "Acknowledge"}
                                </button>
                                <button className="btn m-tap" style={{ justifyContent: "center" }} disabled={busy} onClick={() => doEscalate(sheetAlert)}>Escalate</button>
                                <button className="btn m-tap" style={{ justifyContent: "center" }} onClick={() => showOnMap(sheetAlert)}>Show on map</button>
                                <button className="btn m-tap" style={{ justifyContent: "center" }} onClick={() => noteToDesk(sheetAlert)}>Note to desk</button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
