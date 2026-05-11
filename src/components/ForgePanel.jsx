import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import PipelineCanvas, { TYPE_COLORS, STATUS_DOT } from "./forge/PipelineCanvas.jsx"

const API = API_BASE

function forgeHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}
function forgeFormHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

// ── Passcode gate ──────────────────────────────────────────────────────────────
export function ForgeGate({ children }) {
    const [ok, setOk] = useState(() => localStorage.getItem("forge_access") === "true")
    const [code, setCode] = useState("")
    const [err, setErr] = useState("")
    const [busy, setBusy] = useState(false)
    const submit = async () => {
        setBusy(true); setErr("")
        try {
            const res = await fetch(`${API}/api/forge/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: code }) })
            const d = await res.json()
            if (d.access) { localStorage.setItem("forge_access", "true"); localStorage.setItem("forge_passcode", code); setOk(true) }
            else setErr("Invalid passcode")
        } catch { setErr("Connection failed") }
        finally { setBusy(false) }
    }
    if (ok) return children
    return (
        <div style={{ position: "absolute", inset: 0, background: "rgba(8,12,24,0.98)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#111827", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 10, padding: 32, width: 320 }}>
                <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, marginBottom: 6, letterSpacing: "0.06em" }}>FORGE</div>
                <div style={{ color: "#475569", fontSize: 12, marginBottom: 20 }}>Intelligence Training Lab — restricted access</div>
                <input type="password" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="Enter passcode" style={{ width: "100%", padding: "10px 12px", marginBottom: 10, background: "rgba(30,41,59,0.8)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 6, color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                {err && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{err}</div>}
                <button onClick={submit} disabled={busy} style={{ width: "100%", padding: "10px 0", borderRadius: 6, border: "none", background: busy ? "#1e293b" : "#60a5fa", color: busy ? "#475569" : "#0f172a", fontWeight: 700, cursor: busy ? "default" : "pointer", fontSize: 13 }}>{busy ? "Authenticating…" : "Access Forge"}</button>
            </div>
        </div>
    )
}

// ── Pipeline data ──────────────────────────────────────────────────────────────
export const PIPELINE_NODES = [
    { id: 'src_ais',         label: 'AIS Vessel Feed',      column: 0, type: 'source',       status: 'active',     config: {} },
    { id: 'src_adsb',        label: 'ADS-B Aircraft',        column: 0, type: 'source',       status: 'active',     config: {} },
    { id: 'src_news',        label: 'RSS News Feeds',        column: 0, type: 'source',       status: 'active',     config: { feeds: 277 } },
    { id: 'src_satellite',   label: 'Sentinel-2 Imagery',    column: 0, type: 'source',       status: 'configured', config: {} },
    { id: 'src_osint',       label: 'GDELT Events',          column: 0, type: 'source',       status: 'active',     config: {} },
    { id: 'src_uploads',     label: 'Custom Uploads',        column: 0, type: 'source',       status: 'active',     config: {} },
    { id: 'det_ais',         label: 'AIS Anomaly Detector',  column: 1, type: 'detector',     status: 'active',     config: {} },
    { id: 'det_adsb',        label: 'ADSB Pattern Detector', column: 1, type: 'detector',     status: 'active',     config: {} },
    { id: 'det_news',        label: 'News Scorer',           column: 1, type: 'detector',     status: 'active',     config: {} },
    { id: 'det_overwatch',   label: 'Overwatch ML',          column: 1, type: 'detector',     status: 'active',     config: { model: 'yolov8n-obb.onnx' } },
    { id: 'enr_correlation', label: 'Correlation Engine',    column: 2, type: 'enrichment',   status: 'active',     config: {} },
    { id: 'enr_ontology',    label: 'Entity Ontology',       column: 2, type: 'enrichment',   status: 'active',     config: {} },
    { id: 'enr_geocode',     label: 'Geocoder',              column: 2, type: 'enrichment',   status: 'active',     config: {} },
    { id: 'int_threat',      label: 'Threat Scoring',        column: 3, type: 'intelligence', status: 'active',     config: {} },
    { id: 'int_patterns',    label: 'Pattern Recognition',   column: 3, type: 'intelligence', status: 'active',     config: {} },
    { id: 'int_escalation',  label: 'Escalation Detector',   column: 3, type: 'intelligence', status: 'active',     config: {} },
    { id: 'out_alerts',      label: 'Alert System',          column: 4, type: 'output',       status: 'active',     config: {} },
    { id: 'out_briefings',   label: 'Director Briefings',    column: 4, type: 'output',       status: 'active',     config: {} },
    { id: 'out_reports',     label: 'Reports',               column: 4, type: 'output',       status: 'active',     config: {} },
]

export const PIPELINE_EDGES = [
    { from: 'src_ais', to: 'det_ais' }, { from: 'src_adsb', to: 'det_adsb' },
    { from: 'src_news', to: 'det_news' }, { from: 'src_satellite', to: 'det_overwatch' },
    { from: 'src_uploads', to: 'enr_ontology' }, { from: 'src_osint', to: 'det_news' },
    { from: 'det_ais', to: 'enr_correlation' }, { from: 'det_adsb', to: 'enr_correlation' },
    { from: 'det_news', to: 'enr_correlation' }, { from: 'det_overwatch', to: 'enr_correlation' },
    { from: 'det_ais', to: 'enr_ontology' }, { from: 'det_news', to: 'enr_ontology' },
    { from: 'enr_correlation', to: 'int_threat' }, { from: 'enr_correlation', to: 'int_patterns' },
    { from: 'enr_ontology', to: 'int_threat' }, { from: 'enr_ontology', to: 'int_escalation' },
    { from: 'enr_geocode', to: 'int_threat' },
    { from: 'int_threat', to: 'out_alerts' }, { from: 'int_patterns', to: 'out_alerts' },
    { from: 'int_escalation', to: 'out_alerts' }, { from: 'int_threat', to: 'out_briefings' },
    { from: 'int_patterns', to: 'out_reports' },
]

const WS_MAP = {
    src_ais: 'ais-source', src_adsb: 'adsb-source', src_news: 'news-source',
    src_satellite: 'satellite-source', src_uploads: 'uploads-source', src_osint: 'osint-source',
    det_ais: 'ais-detector', det_adsb: 'adsb-detector', det_news: 'news-detector', det_overwatch: 'ml-detector',
    enr_correlation: 'brain', enr_ontology: 'ontology', enr_geocode: 'geocoder',
    int_threat: 'brain', int_patterns: 'brain', int_escalation: 'brain',
    out_alerts: 'alerts', out_briefings: 'briefings', out_reports: 'reports',
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const inputStyle = {
    padding: "6px 10px", background: "#111827", border: "1px solid rgba(148,163,184,0.1)",
    borderRadius: 3, color: "#cbd5e1", fontSize: 11, outline: "none",
}
const cellStyle = { color: "#94a3b8", fontSize: 11, padding: "5px 8px" }
const tabBtn = (active) => ({
    padding: "5px 12px", borderRadius: 3, border: "none", cursor: "pointer", fontSize: 11,
    background: active ? "rgba(96,165,250,0.1)" : "transparent",
    color: active ? "#60a5fa" : "#475569",
})
function actionBtn(color) {
    return { fontSize: 10, padding: "3px 8px", borderRadius: 2, border: `1px solid ${color}44`, background: "transparent", color, cursor: "pointer" }
}
const ghostBtn = { fontSize: 11, padding: "5px 12px", borderRadius: 3, border: "1px solid rgba(148,163,184,0.15)", background: "transparent", color: "#94a3b8", cursor: "pointer" }

// ── Alert Detail Drawer ────────────────────────────────────────────────────────
function ProvenanceStep({ label, value, detail }) {
    return (
        <div style={{ background: "#111827", borderRadius: 4, padding: "8px 10px", marginBottom: 2 }}>
            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase" }}>{label}</div>
            <div style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>{value || "—"}</div>
            {detail && <div style={{ color: "#475569", fontSize: 10 }}>{detail}</div>}
        </div>
    )
}
function ProvenanceArrow() {
    return <div style={{ textAlign: "center", color: "#1e293b", fontSize: 12, margin: "2px 0" }}>↓</div>
}
function AlertDetail({ alert, onClose, onFeedback }) {
    if (!alert) return null
    const sevColor = alert.severity === "critical" ? "#f87171" : alert.severity === "high" ? "#fbbf24" : "#94a3b8"
    const sevBg    = alert.severity === "critical" ? "rgba(248,113,113,0.12)" : alert.severity === "high" ? "rgba(251,191,36,0.12)" : "rgba(148,163,184,0.08)"
    return (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, background: "#0f1219", borderLeft: "1px solid rgba(148,163,184,0.08)", zIndex: 100, display: "flex", flexDirection: "column", overflow: "auto", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(148,163,184,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>Alert Detail</span>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: 16, overflow: "auto" }}>
                <div style={{ marginBottom: 16 }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 2, background: sevBg, color: sevColor }}>{(alert.severity || "medium").toUpperCase()}</span>
                    <div style={{ color: "#e2e8f0", fontSize: 14, marginTop: 8, lineHeight: 1.4 }}>{alert.message}</div>
                    <div style={{ color: "#334155", fontSize: 10, marginTop: 4 }}>{alert.timestamp}</div>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Provenance Chain</div>
                    <ProvenanceStep label="Source" value={alert.provenance?.source_type || alert.source} detail={alert.provenance?.source_entity || alert.mmsi || alert.aircraft} />
                    <ProvenanceArrow />
                    <ProvenanceStep label="Detection Rule" value={alert.rule_name} detail={alert.provenance?.trigger_reason || alert.rule_trigger} />
                    <ProvenanceArrow />
                    <ProvenanceStep label="Alert" value={alert.severity} detail={alert.timestamp?.slice(11, 19)} />
                </div>

                {Object.keys(alert.provenance?.params_at_trigger || {}).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Rule Parameters</div>
                        {Object.entries(alert.provenance.params_at_trigger).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                <span style={{ color: "#475569", fontSize: 11 }}>{k.replace(/_/g, " ")}</span>
                                <span style={{ color: "#94a3b8", fontSize: 11 }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                            </div>
                        ))}
                    </div>
                )}

                {alert.source === "AIS" && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Vessel</div>
                        {[["Name", alert.vessel], ["MMSI", alert.mmsi], ["Position", alert.lat != null ? `${Number(alert.lat).toFixed(4)}, ${Number(alert.lng).toFixed(4)}` : null], ["Speed", alert.speed != null ? `${alert.speed} kn` : null], ["Flag", alert.flag], ["Destination", alert.destination]].filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                <span style={{ color: "#475569", fontSize: 11 }}>{k}</span>
                                <span style={{ color: "#94a3b8", fontSize: 11 }}>{v}</span>
                            </div>
                        ))}
                    </div>
                )}

                {alert.source === "ADSB" && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Aircraft</div>
                        {[["Callsign", alert.aircraft], ["Hex", alert.hex], ["Position", alert.lat != null ? `${Number(alert.lat).toFixed(4)}, ${Number(alert.lng).toFixed(4)}` : null]].filter(([, v]) => v).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                <span style={{ color: "#475569", fontSize: 11 }}>{k}</span>
                                <span style={{ color: "#94a3b8", fontSize: 11 }}>{v}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {onFeedback && <>
                        <button onClick={() => onFeedback("confirm")} style={actionBtn("#4ade80")}>✓ Confirm</button>
                        <button onClick={() => onFeedback("false_alarm")} style={actionBtn("#f87171")}>✕ False Alarm</button>
                    </>}
                </div>
            </div>
        </div>
    )
}

// ── Shared components ──────────────────────────────────────────────────────────
function StatBox({ label, value, color }) {
    return (
        <div style={{ background: "#111827", border: "1px solid rgba(148,163,184,0.06)", padding: "8px 14px", borderRadius: 4, minWidth: 80 }}>
            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ color: color || "#cbd5e1", fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value ?? "—"}</div>
        </div>
    )
}
function Section({ title, children }) {
    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(148,163,184,0.05)" }}>{title}</div>
            {children}
        </div>
    )
}
function ConfigRow({ label, value }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
            <span style={{ color: "#475569", fontSize: 11 }}>{label}</span>
            <span style={{ color: "#94a3b8", fontSize: 11 }}>{value}</span>
        </div>
    )
}
function Toolbar({ children }) {
    return (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(148,163,184,0.06)", display: "flex", gap: 6, alignItems: "center", background: "#080c14", flexShrink: 0 }}>
            {children}
        </div>
    )
}
function WorkspaceBody({ children }) {
    return <div style={{ flex: 1, overflow: "auto", padding: 20 }}>{children}</div>
}

// ── Header ─────────────────────────────────────────────────────────────────────
function ForgeHeader({ brainStatus, activeNode, onBack }) {
    return (
        <div style={{ padding: "0 16px", height: 44, borderBottom: "1px solid rgba(148,163,184,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#080c14", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span onClick={onBack} style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", cursor: "pointer" }}>FORGE</span>
                {activeNode && (
                    <>
                        <span style={{ color: "#1e293b", fontSize: 13 }}>/</span>
                        <span style={{ color: "#60a5fa", fontSize: 12 }}>{activeNode.label}</span>
                    </>
                )}
            </div>
            {brainStatus && (
                <span style={{ color: "#334155", fontSize: 10 }}>
                    {brainStatus.last_cycle ? new Date(brainStatus.last_cycle).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    {" · "}{brainStatus.vessels_tracked ?? 0} vessels · {brainStatus.alerts_24h ?? 0} alerts
                </span>
            )}
        </div>
    )
}

// ── Workspace router ───────────────────────────────────────────────────────────
function WorkspaceRouter({ workspace, node, brainStatus }) {
    switch (workspace) {
        case "ais-source":      return <AISSourceWorkspace />
        case "adsb-source":     return <ADSBSourceWorkspace />
        case "news-source":     return <NewsSourceWorkspace />
        case "satellite-source":return <SatelliteSourceWorkspace />
        case "uploads-source":  return <UploadsWorkspace />
        case "osint-source":    return <OsintWorkspace />
        case "ais-detector":    return <DetectorWorkspace source="AIS" />
        case "adsb-detector":   return <DetectorWorkspace source="ADSB" />
        case "news-detector":   return <DetectorWorkspace source="NEWS" />
        case "ml-detector":     return <MLDetectorWorkspace />
        case "brain":           return <BrainWorkspace brainStatus={brainStatus} />
        case "ontology":        return <OntologyWorkspace />
        case "alerts":          return <AlertsWorkspace />
        case "geocoder":        return <SimpleInfo title="Geocoder" body="Provides lat/lng resolution for news events and uploaded entity data. Feeds the threat scoring engine." />
        case "briefings":       return <SimpleInfo title="Director Briefings" body="AI-generated intelligence briefings from threat scores and correlation assessments. Delivered via the Director system." />
        case "reports":         return <SimpleInfo title="Reports" body="Export-ready PDF and JSON reports generated from pattern recognition and threat assessments." />
        default:                return <SimpleInfo title={workspace} body="Workspace under construction." />
    }
}

function SimpleInfo({ title, body }) {
    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 500 }}>
                <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{title}</div>
                <div style={{ color: "#475569", fontSize: 13, lineHeight: 1.6 }}>{body}</div>
            </div>
        </WorkspaceBody>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE WORKSPACES
// ═══════════════════════════════════════════════════════════════════════════════

function AISSourceWorkspace() {
    const [vessels, setVessels] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [tab, setTab] = useState("vessels")
    const [config, setConfig] = useState(null)
    const [watchlist, setWatchlist] = useState([])
    const [watchInput, setWatchInput] = useState("")

    useEffect(() => {
        fetch(`${API}/api/ais/vessels`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { vessels: [] })
            .then(d => { setVessels(d.vessels || []); setLoading(false) })
            .catch(() => setLoading(false))
        fetch(`${API}/api/forge/source/src_ais/config`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {}).then(setConfig).catch(() => {})
    }, [])

    const filtered = vessels.filter(v => {
        if (!search) return true
        const q = search.toLowerCase()
        return (v.name || "").toLowerCase().includes(q) || String(v.mmsi || "").includes(q) || (v.flag || "").toLowerCase().includes(q)
    })

    const addWatch = () => {
        const t = watchInput.trim()
        if (!t) return
        setWatchlist(w => [...w, t]); setWatchInput("")
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                {["vessels", "config", "watchlist"].map(t => <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
                {tab === "vessels" && <>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, MMSI, flag…" style={{ ...inputStyle, flex: 1, maxWidth: 320 }} />
                    <span style={{ color: "#334155", fontSize: 10 }}>{filtered.length} vessels</span>
                </>}
            </Toolbar>
            <WorkspaceBody>
                {tab === "vessels" && (
                    loading ? <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div> :
                    filtered.length === 0 ? <div style={{ color: "#334155", fontSize: 12, padding: 40, textAlign: "center" }}>No vessels in live feed. AIS WebSocket may not be connected.</div> :
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                {["Name", "MMSI", "Type", "Flag", "Speed", "Lat", "Lng", "Destination"].map(h => (
                                    <th key={h} style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", textAlign: "left", padding: "6px 8px", fontWeight: 600, letterSpacing: "0.04em" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.slice(0, 300).map((v, i) => {
                                const spd = v.speed || v.sog || 0
                                return (
                                    <tr key={i} style={{ borderBottom: "1px solid rgba(148,163,184,0.03)" }}
                                        onMouseEnter={e => e.currentTarget.style.background = "#0d1422"}
                                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                        <td style={{ ...cellStyle, color: "#cbd5e1", fontWeight: 500 }}>{v.name || v.shipName || "—"}</td>
                                        <td style={cellStyle}>{v.mmsi || "—"}</td>
                                        <td style={cellStyle}>{v.ship_type || v.type || "—"}</td>
                                        <td style={cellStyle}>{v.flag || v.country || "—"}</td>
                                        <td style={{ ...cellStyle, color: spd < 0.5 ? "#f87171" : "#4ade80" }}>{spd.toFixed(1)} kn</td>
                                        <td style={cellStyle}>{(v.lat || 0).toFixed(3)}</td>
                                        <td style={cellStyle}>{(v.lon || v.lng || 0).toFixed(3)}</td>
                                        <td style={cellStyle}>{v.destination || "—"}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
                {tab === "config" && config && (
                    <div style={{ maxWidth: 560 }}>
                        <Section title="Coverage Statistics">
                            <ConfigRow label="Vessels tracked" value={vessels.length} />
                            <ConfigRow label="Bounding boxes" value={config.bboxes ?? 15} />
                            <ConfigRow label="Regions" value="Persian Gulf, Red Sea, Mediterranean, SE Asia + 11 more" />
                        </Section>
                        <Section title="Active Filters">
                            {(config.filters || []).length === 0 ? <div style={{ color: "#334155", fontSize: 11 }}>No filters — all vessels in scope.</div> :
                                (config.filters || []).map(f => <div key={f} style={{ color: "#94a3b8", fontSize: 11, padding: "3px 0" }}>{f}</div>)}
                        </Section>
                    </div>
                )}
                {tab === "watchlist" && (
                    <div style={{ maxWidth: 560 }}>
                        <Section title="Vessel Watchlist">
                            <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>Flag specific MMSIs or names for priority alerting.</div>
                            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                                <input value={watchInput} onChange={e => setWatchInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addWatch()} placeholder="MMSI or vessel name…" style={{ ...inputStyle, flex: 1 }} />
                                <button onClick={addWatch} style={ghostBtn}>Add</button>
                            </div>
                            {watchlist.map((w, i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#111827", borderRadius: 3, marginBottom: 4 }}>
                                    <span style={{ color: "#cbd5e1", fontSize: 11 }}>{w}</span>
                                    <button onClick={() => setWatchlist(wl => wl.filter((_, j) => j !== i))} style={{ ...actionBtn("#f87171"), fontSize: 11 }}>Remove</button>
                                </div>
                            ))}
                            {watchlist.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No vessels on watchlist.</div>}
                        </Section>
                    </div>
                )}
            </WorkspaceBody>
        </div>
    )
}

function ADSBSourceWorkspace() {
    const [aircraft, setAircraft] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")

    useEffect(() => {
        fetch(`${API}/api/forge/aircraft`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { aircraft: [] })
            .then(d => { setAircraft(d.aircraft || []); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    const filtered = aircraft.filter(a => {
        if (!search) return true
        const q = search.toLowerCase()
        return (a.flight || a.callsign || "").toLowerCase().includes(q) || (a.hex || a.icao || "").toLowerCase().includes(q)
    })

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search callsign, ICAO…" style={{ ...inputStyle, flex: 1, maxWidth: 320 }} />
                <span style={{ color: "#334155", fontSize: 10 }}>{filtered.length} aircraft tracked</span>
            </Toolbar>
            <WorkspaceBody>
                {loading ? <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div> :
                filtered.length === 0 ? <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: 40 }}>No aircraft in global cache.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                            {["Callsign", "ICAO", "Squawk", "Alt (ft)", "Speed", "Lat", "Lng"].map(h => (
                                <th key={h} style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", textAlign: "left", padding: "6px 8px", fontWeight: 600 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.slice(0, 300).map((a, i) => {
                            const sq = a.squawk || ""
                            const isEmergency = ["7500","7600","7700"].includes(sq)
                            return (
                                <tr key={i} style={{ borderBottom: "1px solid rgba(148,163,184,0.03)", background: isEmergency ? "rgba(239,68,68,0.04)" : "transparent" }}
                                    onMouseEnter={e => e.currentTarget.style.background = isEmergency ? "rgba(239,68,68,0.08)" : "#0d1422"}
                                    onMouseLeave={e => e.currentTarget.style.background = isEmergency ? "rgba(239,68,68,0.04)" : "transparent"}>
                                    <td style={{ ...cellStyle, color: isEmergency ? "#f87171" : "#cbd5e1", fontWeight: 500 }}>{a.flight || a.callsign || "—"}</td>
                                    <td style={cellStyle}>{a.hex || a.icao || "—"}</td>
                                    <td style={{ ...cellStyle, color: isEmergency ? "#f87171" : "#94a3b8" }}>{sq || "—"}</td>
                                    <td style={cellStyle}>{a.alt_baro || a.altitude || "—"}</td>
                                    <td style={cellStyle}>{a.speed || a.gs ? `${(a.speed || a.gs || 0).toFixed(0)} kt` : "—"}</td>
                                    <td style={cellStyle}>{a.lat ? a.lat.toFixed(3) : "—"}</td>
                                    <td style={cellStyle}>{a.lon ? a.lon.toFixed(3) : "—"}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>}
            </WorkspaceBody>
        </div>
    )
}

function NewsSourceWorkspace() {
    const [config, setConfig] = useState(null)
    const [newKw, setNewKw] = useState("")

    useEffect(() => {
        fetch(`${API}/api/forge/source/src_news/config`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {}).then(setConfig).catch(() => setConfig({}))
    }, [])

    const save = async (patch) => {
        const res = await fetch(`${API}/api/forge/source/src_news/config`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify(patch) })
        if (res.ok) setConfig(await res.json())
    }
    const addKw = () => {
        const kw = newKw.trim(); if (!kw) return
        const kws = [...(config?.keywords || []), kw]
        setConfig(c => ({ ...c, keywords: kws })); setNewKw(""); save({ keywords: kws })
    }
    const removeKw = kw => {
        const kws = (config?.keywords || []).filter(k => k !== kw)
        setConfig(c => ({ ...c, keywords: kws })); save({ keywords: kws })
    }

    if (!config) return <WorkspaceBody><div style={{ color: "#475569", fontSize: 12 }}>Loading…</div></WorkspaceBody>

    const health = config.feed_health || {}
    const failCount = Object.values(health).filter(v => v > 0).length

    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 680, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
                <div>
                    <Section title="Feed Statistics">
                        <ConfigRow label="Total feeds" value={config.feed_count ?? 277} />
                        <ConfigRow label="Failing feeds" value={failCount > 0 ? failCount : "None"} />
                    </Section>
                    <Section title="Keywords">
                        <div style={{ color: "#475569", fontSize: 10, marginBottom: 8 }}>Filter news to events containing these terms.</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                            {(config.keywords || []).map(kw => (
                                <span key={kw} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, fontSize: 11, background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)", color: "#60a5fa" }}>
                                    {kw}
                                    <button onClick={() => removeKw(kw)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
                                </span>
                            ))}
                            {!(config.keywords || []).length && <span style={{ color: "#334155", fontSize: 11 }}>No keywords — scoring all events.</span>}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => e.key === "Enter" && addKw()} placeholder="Add keyword…" style={{ ...inputStyle, flex: 1 }} />
                            <button onClick={addKw} style={ghostBtn}>Add</button>
                        </div>
                    </Section>
                </div>
                <div>
                    <Section title={`Feed Health (${Object.keys(health).length} feeds)`}>
                        {Object.keys(health).length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No health data yet.</div>}
                        {Object.entries(health).slice(0, 20).map(([name, failures]) => (
                            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                <span style={{ color: "#94a3b8", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{name}</span>
                                <span style={{ color: failures > 0 ? "#f87171" : "#4ade80", fontSize: 10, flexShrink: 0, marginLeft: 8 }}>{failures > 0 ? `${failures} fail${failures > 1 ? "s" : ""}` : "ok"}</span>
                            </div>
                        ))}
                    </Section>
                </div>
            </div>
        </WorkspaceBody>
    )
}

function SatelliteSourceWorkspace() {
    const [config, setConfig] = useState(null)
    const [token, setToken] = useState("")
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState("")

    useEffect(() => {
        fetch(`${API}/api/forge/source/src_satellite/config`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {}).then(d => { setConfig(d); setToken(d.sentinel_token || "") }).catch(() => setConfig({}))
    }, [])

    const save = async () => {
        setSaving(true); setMsg("")
        try {
            const res = await fetch(`${API}/api/forge/source/src_satellite/config`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ sentinel_token: token }) })
            if (res.ok) { setMsg("Saved"); setTimeout(() => setMsg(""), 2000) }
        } catch { setMsg("Failed") }
        finally { setSaving(false) }
    }

    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 480 }}>
                <Section title="Sentinel-2 Configuration">
                    <ConfigRow label="Resolution" value="10 m" />
                    <ConfigRow label="Coverage" value="Global" />
                    <ConfigRow label="Token status" value={config?.token_set ? "Configured" : "Not set"} />
                </Section>
                <Section title="Authentication Token">
                    <div style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>Sentinel Hub OAuth token for live imagery. Without it, watch-area scans use simulated data.</div>
                    <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste Sentinel Hub token…" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }} />
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={save} disabled={saving} style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)" }}>{saving ? "Saving…" : "Save Token"}</button>
                        {msg && <span style={{ color: msg === "Saved" ? "#4ade80" : "#f87171", fontSize: 11 }}>{msg}</span>}
                    </div>
                </Section>
            </div>
        </WorkspaceBody>
    )
}

function UploadsWorkspace() {
    const [uploads, setUploads] = useState([])
    const [uploading, setUploading] = useState(false)
    const [msg, setMsg] = useState("")
    const fileRef = useRef(null)

    const reload = () =>
        fetch(`${API}/api/forge/uploads`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : []).then(d => setUploads(Array.isArray(d) ? d : [])).catch(() => {})

    useEffect(() => { reload() }, [])

    const upload = async (e) => {
        const file = e.target.files?.[0]; if (!file) return
        setUploading(true); setMsg("")
        const fd = new FormData(); fd.append("file", file)
        try {
            const res = await fetch(`${API}/api/forge/upload`, { method: "POST", headers: forgeFormHeaders(), body: fd })
            const d = await res.json()
            setMsg(res.ok ? `Uploaded: ${d.original_name || file.name}` : d.detail || "Failed")
            if (res.ok) reload()
        } catch { setMsg("Upload failed") }
        finally { setUploading(false); if (fileRef.current) fileRef.current.value = "" }
    }

    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 640 }}>
                <Section title="Upload Intelligence File">
                    <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>CSV, KML, GeoJSON, and PDF files are parsed for entities and added to the ontology graph.</div>
                    <input ref={fileRef} type="file" accept=".csv,.kml,.geojson,.json,.pdf" onChange={upload} disabled={uploading} style={{ display: "none" }} id="upload-file-input" />
                    <label htmlFor="upload-file-input" style={{ ...ghostBtn, display: "inline-block", cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.5 : 1 }}>
                        {uploading ? "Uploading…" : "+ Choose File"}
                    </label>
                    {msg && <div style={{ color: msg.startsWith("Uploaded") ? "#4ade80" : "#f87171", fontSize: 11, marginTop: 8 }}>{msg}</div>}
                </Section>
                <Section title={`Uploaded Files (${uploads.length})`}>
                    {uploads.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No files uploaded yet.</div>}
                    {uploads.map((u, i) => (
                        <div key={i} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 500 }}>{u.original_name || u.filename}</div>
                                <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{u.data_type || "auto"} · {u.entities_added || 0} entities · {u.uploaded_at?.slice(0, 10) || "—"}</div>
                            </div>
                        </div>
                    ))}
                </Section>
            </div>
        </WorkspaceBody>
    )
}

function OsintWorkspace() {
    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 480 }}>
                <Section title="GDELT Event Stream">
                    <ConfigRow label="Source" value="GDELT Project" />
                    <ConfigRow label="Coverage" value="Global" />
                    <ConfigRow label="Update frequency" value="15 min" />
                    <ConfigRow label="Entity types" value="Events, actors, locations" />
                </Section>
                <div style={{ color: "#475569", fontSize: 12, lineHeight: 1.7 }}>
                    GDELT ingests news from 100+ countries in 65 languages, extracting geolocated events. These feed the news scorer and correlation engine.
                </div>
            </div>
        </WorkspaceBody>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETECTOR WORKSPACES
// ═══════════════════════════════════════════════════════════════════════════════

const TRIGGER_TYPES = {
    AIS: [
        { value: "stationary_near_infrastructure", label: "Stationary near infrastructure", params: { infra_type: "cable", max_speed_knots: 0.5, proximity_km: 10, min_duration_minutes: 120 } },
        { value: "speed_anomaly", label: "Speed anomaly", params: { max_speed_knots: 25 } },
        { value: "transponder_gap", label: "Dark ship (AIS gap)", params: { gap_minutes: 30, proximity_km: 100 } },
        { value: "ship_to_ship", label: "Ship-to-ship proximity", params: { proximity_meters: 500, max_speed_knots: 2 } },
        { value: "route_deviation", label: "Route deviation", params: { chokepoints: [] } },
        { value: "chokepoint_loitering", label: "Chokepoint loitering", params: { chokepoint: "Hormuz", max_speed_knots: 1.0, min_minutes: 60 } },
    ],
    ADSB: [
        { value: "military_callsign", label: "Military callsign", params: { callsign_prefixes: ["RCH", "NAVY", "RRR", "DUKE"] } },
        { value: "emergency_squawk", label: "Emergency squawk", params: { squawk_codes: ["7500", "7600", "7700"] } },
        { value: "restricted_airspace", label: "Restricted airspace entry", params: { zone_ids: [] } },
    ],
    NEWS: [
        { value: "event_surge", label: "Event frequency surge", params: { multiplier: 3, window_days: 7, keywords: [] } },
        { value: "severity_threshold", label: "High-severity event", params: { min_severity: "high", keywords: [] } },
    ],
}

function CreateRuleModal({ source, onClose, onCreated }) {
    const [name, setName] = useState("")
    const [triggerType, setTriggerType] = useState("")
    const [severity, setSeverity] = useState("high")
    const [params, setParams] = useState({})
    const [saving, setSaving] = useState(false)

    const triggers = TRIGGER_TYPES[source] || []

    const selectTrigger = (val) => {
        setTriggerType(val)
        const t = triggers.find(t => t.value === val)
        setParams(t?.params ? JSON.parse(JSON.stringify(t.params)) : {})
    }

    const save = async () => {
        if (!name || !triggerType) return
        setSaving(true)
        try {
            const res = await fetch(`${API}/api/forge/rules`, {
                method: "POST", headers: forgeHeaders(),
                body: JSON.stringify({ name, source, trigger_type: triggerType, severity, params, status: "active", description: triggers.find(t => t.value === triggerType)?.label || triggerType }),
            })
            const d = await res.json()
            if (res.ok) onCreated(d.id ? d : { id: crypto.randomUUID(), name, source, trigger_type: triggerType, severity, params, status: "active" })
        } catch { }
        finally { setSaving(false) }
    }

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div style={{ background: "#0f1219", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 6, padding: 24, width: 460, maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Create {source} Rule</div>
                {[
                    ["Rule Name", <input value={name} onChange={e => setName(e.target.value)} placeholder={`e.g., Dark ship — Hormuz`} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />],
                    ["Trigger Type", (
                        <select value={triggerType} onChange={e => selectTrigger(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                            <option value="">Select trigger…</option>
                            {triggers.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    )],
                    ["Severity", (
                        <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                            {["info", "medium", "high", "critical"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    )],
                ].map(([label, ctrl]) => (
                    <div key={label} style={{ marginBottom: 12 }}>
                        <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                        {ctrl}
                    </div>
                ))}
                {triggerType && Object.keys(params).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Parameters</label>
                        {Object.entries(params).map(([key, value]) => (
                            <div key={key} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "center" }}>
                                <span style={{ color: "#475569", fontSize: 10, width: 140, flexShrink: 0 }}>{key.replace(/_/g, " ")}</span>
                                <input value={typeof value === "object" ? JSON.stringify(value) : String(value)}
                                    onChange={e => { let v = e.target.value; try { v = JSON.parse(v) } catch {} setParams(p => ({ ...p, [key]: v })) }}
                                    style={{ flex: 1, padding: "3px 6px", background: "#111827", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 2, color: "#cbd5e1", fontSize: 10, outline: "none" }} />
                            </div>
                        ))}
                    </div>
                )}
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={onClose} style={ghostBtn}>Cancel</button>
                    <button onClick={save} disabled={!name || !triggerType || saving} style={{ padding: "6px 16px", borderRadius: 3, border: "none", background: (name && triggerType && !saving) ? "#60a5fa" : "#1e293b", color: (name && triggerType && !saving) ? "#0a0e1a" : "#475569", cursor: (name && triggerType && !saving) ? "pointer" : "default", fontSize: 11, fontWeight: 600 }}>
                        {saving ? "Creating…" : "Create Rule"}
                    </button>
                </div>
            </div>
        </div>
    )
}

function DetectorWorkspace({ source }) {
    const [rules, setRules] = useState([])
    const [alerts, setAlerts] = useState([])
    const [tab, setTab] = useState("rules")
    const [expandedRule, setExpandedRule] = useState(null)
    const [dryResults, setDryResults] = useState({})
    const [dryRunning, setDryRunning] = useState({})
    const [showCreate, setShowCreate] = useState(false)
    const [selectedAlert, setSelectedAlert] = useState(null)

    const reload = () => {
        fetch(`${API}/api/forge/rules`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {})
            .then(d => {
                const list = Array.isArray(d) ? d : (d.rules || [])
                setRules(list.filter(r => r.source === source || r.source === source?.toLowerCase()))
            }).catch(() => {})
        fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => {
                const all = Array.isArray(d) ? d : []
                setAlerts(all.map((a, idx) => ({ ...a, _idx: idx })).filter(a =>
                    source === "AIS" ? (!a.source || a.source === "AIS") : a.source === source
                ))
            }).catch(() => {})
    }
    useEffect(() => { reload() }, [source])

    const saveParam = async (rule, key, raw) => {
        let val = raw; try { val = JSON.parse(raw) } catch {}
        const updated = { ...rule, params: { ...rule.params, [key]: val } }
        await fetch(`${API}/api/forge/rules/${rule.id}`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify(updated) })
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
    }
    const toggle = async (rule) => {
        const updated = { ...rule, status: rule.status === "active" ? "paused" : "active" }
        await fetch(`${API}/api/forge/rules/${rule.id}`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify(updated) })
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
    }
    const del = async (ruleId) => {
        if (!confirm("Delete this rule?")) return
        await fetch(`${API}/api/forge/rules/${ruleId}`, { method: "DELETE", headers: forgeHeaders() })
        setRules(prev => prev.filter(r => r.id !== ruleId))
    }
    const dryRun = async (ruleId) => {
        setDryRunning(p => ({ ...p, [ruleId]: true }))
        try {
            const res = await fetch(`${API}/api/forge/rules/${ruleId}/test`, { method: "POST", headers: forgeHeaders() })
            const data = await res.json()
            setDryResults(p => ({ ...p, [ruleId]: data }))
        } catch { setDryResults(p => ({ ...p, [ruleId]: { error: "Request failed" } })) }
        finally { setDryRunning(p => ({ ...p, [ruleId]: false })) }
    }
    const feedback = async (alert, action) => {
        if (alert._idx == null) return
        await fetch(`${API}/api/forge/alerts/${alert._idx}/feedback`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ action }) })
        setAlerts(prev => prev.filter(a => a._idx !== alert._idx))
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                {["rules", "alerts", "training"].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}{t === "rules" ? ` (${rules.length})` : t === "alerts" ? ` (${alerts.length})` : ""}
                    </button>
                ))}
                <div style={{ flex: 1 }} />
                {tab === "rules" && (
                    <button onClick={() => setShowCreate(true)} style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.25)" }}>+ Create Rule</button>
                )}
            </Toolbar>
            <WorkspaceBody>
                {tab === "rules" && (
                    <div style={{ maxWidth: 760 }}>
                        {rules.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>No rules for {source}. Create one above or auto-generate from your uploaded data.</div>}
                        {rules.map(rule => {
                            const isActive = rule.status === "active"
                            const expanded = expandedRule === rule.id
                            const dry = dryResults[rule.id]
                            return (
                                <div key={rule.id} style={{ background: "#111827", borderRadius: 4, marginBottom: 6, overflow: "hidden", borderLeft: `2px solid ${isActive ? "#4ade80" : "#334155"}` }}>
                                    <div style={{ padding: "10px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                        onClick={() => setExpandedRule(expanded ? null : rule.id)}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{rule.name}</span>
                                            <span style={{ color: "#334155", fontSize: 10, marginLeft: 10 }}>{rule.trigger_type}</span>
                                        </div>
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: rule.severity === "critical" ? "rgba(248,113,113,0.12)" : rule.severity === "high" ? "rgba(251,191,36,0.12)" : "rgba(148,163,184,0.08)", color: rule.severity === "critical" ? "#f87171" : rule.severity === "high" ? "#fbbf24" : "#94a3b8" }}>{rule.severity}</span>
                                            <span style={{ color: "#334155", fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
                                        </div>
                                    </div>
                                    {expanded && (
                                        <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(148,163,184,0.04)" }}>
                                            {rule.description && <div style={{ color: "#475569", fontSize: 11, marginTop: 8, marginBottom: 8 }}>{rule.description}</div>}
                                            {Object.keys(rule.params || {}).length > 0 && (
                                                <>
                                                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, marginTop: 4 }}>Parameters</div>
                                                    {Object.entries(rule.params || {}).map(([key, val]) => (
                                                        <div key={key} style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
                                                            <span style={{ color: "#475569", fontSize: 10, width: 150, flexShrink: 0 }}>{key.replace(/_/g, " ")}</span>
                                                            <input defaultValue={typeof val === "object" ? JSON.stringify(val) : String(val)}
                                                                onBlur={e => saveParam(rule, key, e.target.value)}
                                                                style={{ flex: 1, padding: "3px 6px", background: "#0a0e1a", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 2, color: "#cbd5e1", fontSize: 10, outline: "none" }} />
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                            {dry && (
                                                <div style={{ marginTop: 8, padding: "8px 10px", background: "#0a0e1a", borderRadius: 3 }}>
                                                    {dry.error ? <span style={{ color: "#f87171", fontSize: 10 }}>{dry.error}</span> :
                                                        <span style={{ color: "#94a3b8", fontSize: 10 }}>
                                                            Tested {dry.vessels_tested ?? dry.vessels_checked ?? "?"} vessels →{" "}
                                                            <span style={{ color: (dry.hits || dry.would_trigger || 0) > 0 ? "#fbbf24" : "#4ade80", fontWeight: 700 }}>
                                                                {dry.hits ?? dry.would_trigger ?? 0} triggers
                                                            </span>
                                                        </span>
                                                    }
                                                    {(dry.sample || dry.sample_alerts || []).slice(0, 3).map((a, i) => (
                                                        <div key={i} style={{ color: "#475569", fontSize: 10, marginTop: 3 }}>· {a.message || JSON.stringify(a)}</div>
                                                    ))}
                                                </div>
                                            )}
                                            <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                                                <button onClick={() => dryRun(rule.id)} disabled={dryRunning[rule.id]} style={actionBtn("#60a5fa")}>{dryRunning[rule.id] ? "Running…" : "▶ Dry Run"}</button>
                                                <button onClick={() => toggle(rule)} style={actionBtn(isActive ? "#f87171" : "#4ade80")}>{isActive ? "⏸ Pause" : "▶ Activate"}</button>
                                                <button onClick={() => del(rule.id)} style={actionBtn("#f87171")}>Delete</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
                {tab === "alerts" && (
                    <div style={{ maxWidth: 760 }}>
                        {alerts.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>No {source} alerts in the last 24 hours.</div>}
                        {alerts.slice(0, 100).map((a, i) => (
                            <div key={i} onClick={() => setSelectedAlert(a)} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 5, cursor: "pointer", borderLeft: `2px solid ${a.severity === "critical" ? "#f87171" : a.severity === "high" ? "#fbbf24" : "#334155"}` }}>
                                <div style={{ color: "#cbd5e1", fontSize: 12 }}>{a.message}</div>
                                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                                    {a.rule_name && <span style={{ color: "#334155", fontSize: 9 }}>{a.rule_name}</span>}
                                    {a.timestamp && <span style={{ color: "#334155", fontSize: 9 }}>{a.timestamp.slice(11, 19)}</span>}
                                    {a.mmsi && <span style={{ color: "#475569", fontSize: 9 }}>MMSI: {a.mmsi}</span>}
                                    {a.aircraft && <span style={{ color: "#475569", fontSize: 9 }}>{a.aircraft}</span>}
                                </div>
                                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                                    <button onClick={e => { e.stopPropagation(); feedback(a, "confirm") }} style={actionBtn("#4ade80")}>✓ Confirm</button>
                                    <button onClick={e => { e.stopPropagation(); feedback(a, "false_alarm") }} style={actionBtn("#f87171")}>✕ False Alarm</button>
                                </div>
                            </div>
                        ))}
                        {selectedAlert && (
                            <AlertDetail
                                alert={selectedAlert}
                                onClose={() => setSelectedAlert(null)}
                                onFeedback={(action) => { feedback(selectedAlert, action); setSelectedAlert(null) }}
                            />
                        )}
                    </div>
                )}
                {tab === "training" && <TrainingWorkspace detectorSource={source} />}
            </WorkspaceBody>
            {showCreate && <CreateRuleModal source={source} onClose={() => setShowCreate(false)} onCreated={rule => { setRules(prev => [rule, ...prev]); setShowCreate(false) }} />}
        </div>
    )
}

function MLDetectorWorkspace() {
    const [tab, setTab] = useState("training")
    const [models, setModels] = useState([])

    useEffect(() => {
        fetch(`${API}/api/forge/models`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {}).then(d => setModels(d.models || [])).catch(() => {})
    }, [])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                {["training", "models"].map(t => <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
            </Toolbar>
            <WorkspaceBody>
                {tab === "training" && <TrainingWorkspace detectorSource="SATELLITE" />}
                {tab === "models" && (
                    <div style={{ maxWidth: 600 }}>
                        <Section title="Active Models">
                            {models.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No .onnx models found in backend directory.</div>}
                            {models.map(m => (
                                <div key={m.name} style={{ background: "#111827", borderRadius: 4, padding: "12px 14px", marginBottom: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: m.status === "active" ? "rgba(74,222,128,0.12)" : "rgba(148,163,184,0.08)", color: m.status === "active" ? "#4ade80" : "#475569" }}>{m.status}</span>
                                    </div>
                                    <div style={{ color: "#475569", fontSize: 10, marginTop: 4 }}>{m.type} · {m.classes} classes · {m.size_mb} MB</div>
                                    <button onClick={() => {
                                        fetch(`${API}/api/forge/models/download/${encodeURIComponent(m.name)}`, { headers: forgeHeaders() })
                                            .then(r => r.blob()).then(blob => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = m.name; a.click(); URL.revokeObjectURL(u) })
                                    }} style={{ ...actionBtn("#94a3b8"), marginTop: 8, fontSize: 11 }}>↓ Download</button>
                                </div>
                            ))}
                        </Section>
                    </div>
                )}
            </WorkspaceBody>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════════

function esriTile(lat, lon, z = 10) {
    const n = 2 ** z
    const x = Math.floor((lon + 180) / 360 * n)
    const latR = lat * Math.PI / 180
    const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n)
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
}

function AISReviewCard({ item, onLabel }) {
    const [showSubs, setShowSubs] = useState(false)
    const isStationary = (item.speed ?? 0) < 0.5
    const isHighSpeed = (item.speed ?? 0) > 22
    const color = isStationary ? "#f59e0b" : isHighSpeed ? "#ef4444" : "#22c55e"
    const assessment = isStationary ? "Vessel stationary — possible loitering" : isHighSpeed ? "High speed — possible military/pursuit" : "Normal transit behaviour"
    return (
        <div style={{ background: "#111827", borderRadius: 6, padding: 14, border: "1px solid rgba(148,163,184,0.1)" }}>
            {item.lat && item.lon && (
                <div style={{ height: 140, borderRadius: 5, overflow: "hidden", marginBottom: 12, background: "#0f172a", position: "relative" }}>
                    <img src={esriTile(item.lat, item.lon, 10)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.65 }} onError={e => { e.target.style.display = "none" }} />
                    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 10, height: 10, borderRadius: "50%", background: color, border: "2px solid white" }} />
                    <div style={{ position: "absolute", bottom: 6, right: 8, background: "rgba(0,0,0,0.75)", padding: "2px 7px", borderRadius: 3, color: "#e2e8f0", fontSize: 10 }}>{isStationary ? "STATIONARY" : `${(item.speed ?? 0).toFixed(1)} kn`}</div>
                </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 10 }}>
                {[["Vessel", item.name || `MMSI ${item.mmsi}`], ["Type", item.ship_type || "Unknown"], ["Flag", item.flag || "—"], ["Destination", item.destination || "Not declared"]].map(([l, v]) => (
                    <div key={l}><div style={{ color: "#334155", fontSize: 9 }}>{l}</div><div style={{ color: "#e2e8f0", fontSize: 11 }}>{v}</div></div>
                ))}
            </div>
            <div style={{ padding: "6px 8px", background: "rgba(30,41,59,0.5)", borderRadius: 4, marginBottom: 10 }}>
                <div style={{ color: color, fontSize: 11 }}>{assessment}</div>
            </div>
            {showSubs && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {["Loitering near infrastructure", "Dark transit (AIS gap)", "Route deviation", "Ship-to-ship transfer", "Military formation", "Sanctions evasion", "Other"].map(cat => (
                        <button key={cat} onClick={() => { onLabel(item, "suspicious", { reason: cat }); setShowSubs(false) }} style={{ padding: "4px 8px", borderRadius: 3, border: "1px solid rgba(239,68,68,0.25)", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 10 }}>{cat}</button>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onLabel(item, "normal")} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(74,222,128,0.3)", background: "rgba(74,222,128,0.06)", color: "#4ade80", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✓ Normal</button>
                <button onClick={() => setShowSubs(v => !v)} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>⚠ Suspicious</button>
                <button onClick={() => onLabel(item, "skip")} style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.12)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 11 }}>Skip</button>
            </div>
        </div>
    )
}

const SEV_COLORS = { critical: "#f87171", significant: "#fbbf24", elevated: "#60a5fa", low: "#94a3b8" }

function NewsReviewCard({ item, onLabel }) {
    const [showAdj, setShowAdj] = useState(false)
    const [adjSev, setAdjSev] = useState(item.severity_tier || "elevated")
    const [adjType, setAdjType] = useState(item.event_type || "Conflict")
    const sc = SEV_COLORS[item.severity_tier] || SEV_COLORS.low
    return (
        <div style={{ background: "#111827", borderRadius: 6, padding: 14, border: "1px solid rgba(148,163,184,0.1)" }}>
            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, lineHeight: 1.45, marginBottom: 8 }}>{item.title || "Untitled"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>{item.source || "Unknown"}</span>
                {item.published && <span style={{ fontSize: 10, color: "#475569" }}>{new Date(item.published).toLocaleDateString()}</span>}
                <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 8, background: `${sc}18`, color: sc, fontWeight: 700 }}>{(item.severity_tier || "low").toUpperCase()}</span>
                {item.event_type && <span style={{ fontSize: 10, color: "#94a3b8", padding: "1px 6px", borderRadius: 8, background: "rgba(30,41,59,0.7)" }}>{item.event_type}</span>}
            </div>
            {showAdj && (
                <div style={{ marginBottom: 10, padding: 10, background: "rgba(30,41,59,0.5)", borderRadius: 4, border: "1px solid rgba(148,163,184,0.08)" }}>
                    {[["Severity", ["critical", "significant", "elevated", "low"], adjSev, setAdjSev],
                      ["Event Type", ["Conflict", "Explosion / Remote Violence", "Protests", "Riots", "Strategic Developments", "Violence Against Civilians", "Other"], adjType, setAdjType]].map(([lbl, opts, val, setter]) => (
                        <div key={lbl} style={{ marginBottom: 6 }}>
                            <label style={{ color: "#475569", fontSize: 9, display: "block", marginBottom: 3 }}>{lbl}</label>
                            <select value={val} onChange={e => setter(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
                                {opts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </div>
                    ))}
                    <button onClick={() => { onLabel(item, "adjusted", { severity: adjSev, event_type: adjType }); setShowAdj(false) }} style={ghostBtn}>Apply Adjustment</button>
                </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onLabel(item, "correct")} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(74,222,128,0.3)", background: "rgba(74,222,128,0.06)", color: "#4ade80", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✓ Correct</button>
                <button onClick={() => setShowAdj(v => !v)} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.06)", color: "#fbbf24", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✎ Adjust</button>
                <button onClick={() => onLabel(item, "skip")} style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.12)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 11 }}>Skip</button>
            </div>
        </div>
    )
}

const OW_OPTIONS = ["Aircraft — Fixed Wing", "Aircraft — Rotary Wing", "Vehicle — Large", "Vehicle — Small", "Vessel — Military", "Vessel — Cargo", "Infrastructure — Launcher", "Infrastructure — Radar", "Storage Tank", "Building", "Other / Unknown"]

function ObjectReviewCard({ item, onLabel }) {
    const [showCorrect, setShowCorrect] = useState(false)
    const [correction, setCorrection] = useState(OW_OPTIONS[0])
    const [fsOpen, setFsOpen] = useState(false)
    const imgSrc = item.crop_image || item.crop_b64
    const color = item.color || "#38bdf8"
    return (
        <div style={{ background: "#111827", borderRadius: 6, padding: 14, border: "1px solid rgba(148,163,184,0.1)" }}>
            <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
                <div style={{ width: 130, height: 130, flexShrink: 0, background: "#0f172a", borderRadius: 5, overflow: "hidden", border: "1px solid rgba(148,163,184,0.08)", cursor: imgSrc ? "zoom-in" : "default", position: "relative" }}
                    onClick={() => imgSrc && setFsOpen(true)}>
                    {imgSrc ? <img src={`data:image/jpeg;base64,${imgSrc}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 10 }}>No image</div>}
                </div>
                <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, textTransform: "capitalize" }}>{item.class || "Unknown"}</span>
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(96,165,250,0.1)", color: "#60a5fa", fontWeight: 700 }}>{Math.round((item.confidence || 0) * 100)}%</span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>Site: <span style={{ color: "#94a3b8" }}>{item.site || "Unknown"}</span></div>
                    {item.center && <div style={{ color: "#64748b", fontSize: 11 }}>Coords: <span style={{ color: "#94a3b8" }}>{item.center[0]?.toFixed(4)}°N, {item.center[1]?.toFixed(4)}°E</span></div>}
                </div>
            </div>
            {showCorrect && (
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <select value={correction} onChange={e => setCorrection(e.target.value)} style={{ flex: 1, ...inputStyle }}>
                        {OW_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button onClick={() => { onLabel(item, "correct", { correction, original_label: item.class }); setShowCorrect(false) }} style={ghostBtn}>Submit</button>
                </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onLabel(item, "confirm", { original_label: item.class })} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(74,222,128,0.3)", background: "rgba(74,222,128,0.06)", color: "#4ade80", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✓ Confirm</button>
                <button onClick={() => setShowCorrect(v => !v)} style={{ flex: 1, padding: "8px 0", borderRadius: 4, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.06)", color: "#fbbf24", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✎ Correct As</button>
                <button onClick={() => onLabel(item, "skip", { original_label: item.class })} style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.12)", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 11 }}>Skip</button>
            </div>
            {fsOpen && (
                <div onClick={() => setFsOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img src={`data:image/jpeg;base64,${item.full_image || imgSrc}`} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 6 }} onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    )
}

function TrainingWorkspace({ detectorSource }) {
    const [subTab, setSubTab] = useState("review")
    const [stats, setStats] = useState(null)
    const [batch, setBatch] = useState([])
    const [idx, setIdx] = useState(0)
    const [generating, setGenerating] = useState(false)
    const [sessionStats, setSessionStats] = useState({ total: 0, confirmed: 0, corrected: 0, skipped: 0 })

    const detMap = { AIS: "det_ais", ADSB: "det_adsb", NEWS: "det_news", SATELLITE: "det_overwatch" }
    const detId = detMap[detectorSource] || detectorSource

    useEffect(() => {
        fetch(`${API}/api/forge/training/stats/${detId}`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null).then(setStats).catch(() => {})
    }, [detId])

    const generate = async () => {
        setGenerating(true); setBatch([]); setIdx(0)
        const ep = detectorSource === "AIS" ? "/api/forge/ais/generate-batch"
            : detectorSource === "NEWS" ? "/api/forge/news/generate-batch"
            : "/api/forge/overwatch/generate-batch"
        try {
            const res = await fetch(`${API}${ep}`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ n: 15 }) })
            const d = await res.json()
            const items = d.vessels || d.articles || d.detections || []
            setBatch(items.map(i => ({ ...i, _id: i.id || i.review_id || crypto.randomUUID() })))
        } catch {}
        finally { setGenerating(false) }
    }

    const labelItem = async (item, label, extra = {}) => {
        const sourceType = detectorSource === "AIS" ? "ais" : detectorSource === "NEWS" ? "news" : "overwatch"
        fetch(`${API}/api/forge/detection/label`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ id: item._id, label, source_type: sourceType, ...extra }) }).catch(() => {})
        setSessionStats(prev => ({ total: prev.total + 1, confirmed: label === "confirm" || label === "correct" || label === "normal" ? prev.confirmed + 1 : prev.confirmed, corrected: label === "correct" || label === "adjusted" || label === "suspicious" ? prev.corrected + 1 : prev.corrected, skipped: label === "skip" ? prev.skipped + 1 : prev.skipped }))
        if (idx < batch.length - 1) setIdx(i => i + 1)
        else setBatch([])
    }

    const accBar = stats ? Math.min(100, stats.accuracy) : 0
    const accColor = stats ? (stats.accuracy >= 80 ? "#4ade80" : stats.accuracy >= 60 ? "#fbbf24" : "#f87171") : "#334155"
    const classes = Object.entries(stats?.classes || {}).sort((a, b) => b[1].total - a[1].total)

    return (
        <div>
            {stats && (
                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                    <StatBox label="Total reviewed" value={stats.total} />
                    <StatBox label="Accuracy" value={`${stats.accuracy}%`} color={accColor} />
                    <StatBox label="Session" value={sessionStats.total} color="#60a5fa" />
                    <StatBox label="Skipped" value={stats.skipped} color="#475569" />
                </div>
            )}
            <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
                {["review", "history", "export"].map(t => <button key={t} onClick={() => setSubTab(t)} style={tabBtn(subTab === t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
            </div>

            {subTab === "review" && (
                <div style={{ maxWidth: 560 }}>
                    {batch.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 40 }}>
                            <div style={{ color: "#475569", fontSize: 13, marginBottom: 14 }}>Generate samples to review and label for training.</div>
                            <button onClick={generate} disabled={generating} style={{ padding: "10px 24px", borderRadius: 4, border: "none", background: generating ? "#1e293b" : "#60a5fa", color: generating ? "#475569" : "#0a0e1a", fontWeight: 700, cursor: generating ? "default" : "pointer", fontSize: 12 }}>
                                {generating ? "Generating…" : `Generate ${detectorSource} Batch`}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ color: "#475569", fontSize: 10 }}>Item {idx + 1} / {batch.length}</span>
                                <button onClick={() => setBatch([])} style={{ ...actionBtn("#475569"), fontSize: 10 }}>Cancel</button>
                            </div>
                            <div style={{ height: 3, background: "#1e293b", borderRadius: 2, marginBottom: 14 }}>
                                <div style={{ height: "100%", width: `${((idx + 1) / batch.length) * 100}%`, background: "#60a5fa", borderRadius: 2, transition: "width 0.2s" }} />
                            </div>
                            {detectorSource === "AIS" && <AISReviewCard item={batch[idx]} onLabel={labelItem} />}
                            {detectorSource === "NEWS" && <NewsReviewCard item={batch[idx]} onLabel={labelItem} />}
                            {(detectorSource === "SATELLITE" || detectorSource === "ADSB") && <ObjectReviewCard item={batch[idx]} onLabel={labelItem} />}
                        </>
                    )}
                </div>
            )}

            {subTab === "history" && (
                <div style={{ maxWidth: 560 }}>
                    <Section title="Overall Accuracy">
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
                            <div style={{ color: accColor, fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{stats?.accuracy ?? 0}%</div>
                            <div style={{ color: "#475569", fontSize: 11 }}>{stats?.total ?? 0} samples · {stats?.confirmed ?? 0} confirmed · {stats?.corrected ?? 0} corrected</div>
                        </div>
                        <div style={{ height: 6, background: "#1e293b", borderRadius: 3 }}>
                            <div style={{ width: `${accBar}%`, height: "100%", background: accColor, borderRadius: 3, transition: "width 0.4s" }} />
                        </div>
                    </Section>
                    {classes.length > 0 && (
                        <Section title="Per-Class Breakdown">
                            {classes.map(([cls, c]) => {
                                const acc = Math.round(c.confirmed / Math.max(c.confirmed + c.corrected, 1) * 100)
                                const clsColor = acc >= 80 ? "#4ade80" : acc >= 60 ? "#fbbf24" : "#f87171"
                                return (
                                    <div key={cls} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                                        <span style={{ color: "#94a3b8", fontSize: 11, width: 130, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cls}</span>
                                        <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2 }}>
                                            <div style={{ width: `${acc}%`, height: "100%", background: clsColor, borderRadius: 2 }} />
                                        </div>
                                        <span style={{ color: "#475569", fontSize: 10, width: 36, textAlign: "right" }}>{acc}%</span>
                                        <span style={{ color: "#334155", fontSize: 10, width: 28, textAlign: "right" }}>{c.total}</span>
                                    </div>
                                )
                            })}
                        </Section>
                    )}
                    {stats?.recent?.length > 0 && (
                        <Section title="Recent Labels">
                            {stats.recent.slice(0, 12).map((l, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: l.label === "confirm" || l.label === "correct" || l.label === "normal" ? "rgba(74,222,128,0.1)" : l.label === "skip" ? "rgba(71,85,105,0.1)" : "rgba(251,191,36,0.1)", color: l.label === "confirm" || l.label === "correct" || l.label === "normal" ? "#4ade80" : l.label === "skip" ? "#475569" : "#fbbf24" }}>{l.label}</span>
                                    <span style={{ color: "#64748b", fontSize: 10, flex: 1 }}>{l.original_label || l.correction || l.class || "—"}</span>
                                    <span style={{ color: "#1e293b", fontSize: 9 }}>{l.labeled_at?.slice(0, 10)}</span>
                                </div>
                            ))}
                        </Section>
                    )}
                </div>
            )}

            {subTab === "export" && (
                <div style={{ maxWidth: 560 }}>
                    <Section title="Training Data">
                        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                            <StatBox label="Labels" value={stats?.total ?? 0} />
                            <StatBox label="Target" value="500" />
                            <StatBox label="Ready" value={stats?.total >= 500 ? "Yes" : "No"} color={stats?.total >= 500 ? "#4ade80" : "#475569"} />
                        </div>
                        <div style={{ height: 4, background: "#1e293b", borderRadius: 2, marginBottom: 12 }}>
                            <div style={{ height: "100%", width: `${Math.min(100, ((stats?.total || 0) / 5))}%`, background: "#60a5fa", borderRadius: 2 }} />
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            {["json", "csv", "yolo"].map(fmt => (
                                <button key={fmt} onClick={() => {
                                    fetch(`${API}/api/forge/training/export/${fmt}`, { headers: forgeHeaders() })
                                        .then(r => r.blob()).then(blob => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = `forge_labels.${fmt === "yolo" ? "zip" : fmt}`; a.click(); URL.revokeObjectURL(u) })
                                }} style={actionBtn("#60a5fa")}>↓ {fmt.toUpperCase()}</button>
                            ))}
                        </div>
                    </Section>
                    <Section title="Current Model">
                        <button onClick={() => {
                            fetch(`${API}/api/forge/models/download/yolov8n-obb.onnx`, { headers: forgeHeaders() })
                                .then(r => r.blob()).then(blob => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = "yolov8n-obb.onnx"; a.click(); URL.revokeObjectURL(u) })
                        }} style={actionBtn("#94a3b8")}>↓ Download yolov8n-obb.onnx</button>
                    </Section>
                    <Section title="Upload Retrained Model">
                        <ModelUploadZone />
                    </Section>
                </div>
            )}
        </div>
    )
}

function ModelUploadZone() {
    const [uploading, setUploading] = useState(false)
    const [msg, setMsg] = useState("")
    const fileRef = useRef(null)
    const upload = async (e) => {
        const file = e.target.files?.[0]; if (!file) return
        setUploading(true); setMsg("")
        const fd = new FormData(); fd.append("file", file)
        try {
            const res = await fetch(`${API}/api/forge/models/upload`, { method: "POST", headers: forgeFormHeaders(), body: fd })
            const d = await res.json()
            setMsg(res.ok ? `Uploaded: ${d.name || file.name}` : d.detail || "Failed")
        } catch { setMsg("Upload failed") }
        finally { setUploading(false); if (fileRef.current) fileRef.current.value = "" }
    }
    return (
        <div>
            <input ref={fileRef} type="file" accept=".onnx" onChange={upload} disabled={uploading} style={{ display: "none" }} id="model-upload" />
            <label htmlFor="model-upload" style={{ display: "block", border: "1px dashed rgba(148,163,184,0.12)", borderRadius: 4, padding: 20, textAlign: "center", cursor: uploading ? "default" : "pointer", color: "#475569", fontSize: 11 }}>
                {uploading ? "Uploading…" : "Drop .onnx file or click to upload"}
            </label>
            {msg && <div style={{ color: msg.startsWith("Uploaded") ? "#4ade80" : "#f87171", fontSize: 11, marginTop: 6 }}>{msg}</div>}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRAIN WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════════

function BrainWorkspace({ brainStatus }) {
    const [data, setData] = useState(null)
    const [tab, setTab] = useState("weights")

    useEffect(() => {
        fetch(`${API}/api/forge/brain/inspect`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null).then(setData).catch(() => {})
    }, [])

    if (!data) return <WorkspaceBody><div style={{ color: "#475569", fontSize: 12 }}>Loading brain state…</div></WorkspaceBody>

    const weights = Object.entries(data.weights || {})
    const history = data.cycle_history || []

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                {["weights", "cycles", "models", "rules"].map(t => <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
            </Toolbar>
            <WorkspaceBody>
                {tab === "weights" && (
                    <div style={{ maxWidth: 640 }}>
                        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                            <StatBox label="Vessels" value={data.live?.vessels ?? 0} color="#3b82f6" />
                            <StatBox label="Aircraft" value={data.live?.aircraft ?? 0} color="#60a5fa" />
                            <StatBox label="Alerts 24h" value={data.live?.alerts_24h ?? 0} color="#fbbf24" />
                            <StatBox label="Correlations" value={data.live?.correlations ?? 0} color="#8b5cf6" />
                        </div>
                        <Section title="Threat Engine Weights">
                            <div style={{ color: "#334155", fontSize: 10, marginBottom: 10 }}>Adjusted automatically by confirm/dismiss feedback on alerts.</div>
                            {weights.map(([key, val]) => {
                                const pct = Math.round((val || 0) * 100)
                                return (
                                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                                        <span style={{ color: "#94a3b8", fontSize: 11, width: 130, flexShrink: 0 }}>{key.replace(/_/g, " ")}</span>
                                        <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3 }}>
                                            <div style={{ width: `${pct}%`, height: "100%", background: "#8b5cf6", borderRadius: 3, transition: "width 0.3s" }} />
                                        </div>
                                        <span style={{ color: "#475569", fontSize: 10, width: 36, textAlign: "right" }}>{pct}%</span>
                                    </div>
                                )
                            })}
                            {weights.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No weight data — detection cycle hasn't run yet.</div>}
                        </Section>
                        {Object.keys(data.corr_params || {}).length > 0 && (
                            <Section title="Correlation Parameters">
                                {Object.entries(data.corr_params).map(([k, v]) => <ConfigRow key={k} label={k.replace(/_/g, " ")} value={v} />)}
                            </Section>
                        )}
                    </div>
                )}
                {tab === "cycles" && (
                    <div style={{ maxWidth: 800 }}>
                        <Section title={`Detection Cycle Log (last ${history.length})`}>
                            {history.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No cycles recorded yet. Cycles run every 5 minutes.</div>}
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                        {["Time", "Vessels", "Aircraft", "Rules", "AIS Alerts", "ADSB Alerts", "Correlations", "24h Total"].map(h => (
                                            <th key={h} style={{ color: "#334155", fontSize: 9, textAlign: "left", padding: "5px 8px", fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((c, i) => (
                                        <tr key={i} style={{ borderBottom: "1px solid rgba(148,163,184,0.03)" }}
                                            onMouseEnter={e => e.currentTarget.style.background = "#0d1422"}
                                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                            <td style={cellStyle}>{new Date(c.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                                            <td style={cellStyle}>{c.vessels}</td>
                                            <td style={cellStyle}>{c.aircraft}</td>
                                            <td style={cellStyle}>{c.rules}</td>
                                            <td style={{ ...cellStyle, color: c.ais_alerts > 0 ? "#fbbf24" : "#4ade80" }}>{c.ais_alerts}</td>
                                            <td style={{ ...cellStyle, color: c.adsb_alerts > 0 ? "#fbbf24" : "#4ade80" }}>{c.adsb_alerts}</td>
                                            <td style={{ ...cellStyle, color: c.correlations > 0 ? "#8b5cf6" : "#475569" }}>{c.correlations}</td>
                                            <td style={cellStyle}>{c.alerts_24h}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>
                    </div>
                )}
                {tab === "models" && (
                    <div style={{ maxWidth: 600 }}>
                        <Section title="ML Models">
                            {(data.models || []).length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No .onnx models found.</div>}
                            {(data.models || []).map(m => (
                                <div key={m.name} style={{ background: "#111827", borderRadius: 4, padding: "12px 14px", marginBottom: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 2, background: m.status === "active" ? "rgba(74,222,128,0.1)" : "rgba(148,163,184,0.08)", color: m.status === "active" ? "#4ade80" : "#475569" }}>{m.status}</span>
                                    </div>
                                    <div style={{ color: "#475569", fontSize: 10, marginTop: 3 }}>{m.size_mb} MB</div>
                                </div>
                            ))}
                        </Section>
                        <Section title="Training Progress">
                            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                                <StatBox label="Labels" value={data.training_labels ?? 0} />
                                <StatBox label="Accuracy" value={`${data.training_accuracy ?? 0}%`} color={data.training_accuracy >= 80 ? "#4ade80" : data.training_accuracy >= 60 ? "#fbbf24" : "#f87171"} />
                            </div>
                            <div style={{ height: 4, background: "#1e293b", borderRadius: 2 }}>
                                <div style={{ height: "100%", width: `${Math.min(100, (data.training_labels || 0) / 5)}%`, background: "#60a5fa", borderRadius: 2 }} />
                            </div>
                            <div style={{ color: "#334155", fontSize: 9, marginTop: 4 }}>{data.training_labels || 0} / 500 labels needed</div>
                        </Section>
                    </div>
                )}
                {tab === "rules" && (
                    <div style={{ maxWidth: 600 }}>
                        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                            <StatBox label="Total Rules" value={data.rules_total} />
                            <StatBox label="Active" value={data.rules_active} color="#4ade80" />
                        </div>
                        <Section title="Rules by Source">
                            {Object.entries(data.rules_by_source || {}).map(([src, cnt]) => (
                                <div key={src} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 12 }}>{src}</span>
                                    <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>{cnt}</span>
                                </div>
                            ))}
                        </Section>
                    </div>
                )}
            </WorkspaceBody>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONTOLOGY + ALERTS WORKSPACES
// ═══════════════════════════════════════════════════════════════════════════════

function OntologyWorkspace() {
    const [data, setData] = useState(null)
    const [search, setSearch] = useState("")

    useEffect(() => {
        fetch(`${API}/api/forge/ontology`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { nodes: [], edges: [] }).then(setData).catch(() => {})
    }, [])

    const nodes = (data?.nodes || []).filter(n => !search || (n.id || n.label || "").toLowerCase().includes(search.toLowerCase()))

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities…" style={{ ...inputStyle, flex: 1, maxWidth: 320 }} />
                <span style={{ color: "#334155", fontSize: 10 }}>{data?.nodes?.length ?? 0} entities · {data?.edges?.length ?? 0} connections</span>
            </Toolbar>
            <WorkspaceBody>
                {!data ? <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div> :
                nodes.length === 0 ? <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: 40 }}>No entities yet. Upload intelligence files to populate the ontology.</div> :
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                            {["Entity", "Type", "Source", "Created"].map(h => (
                                <th key={h} style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {nodes.slice(0, 200).map((n, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid rgba(148,163,184,0.03)" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#0d1422"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <td style={{ ...cellStyle, color: "#cbd5e1" }}>{n.id || n.label || "—"}</td>
                                <td style={cellStyle}>{n.type || "—"}</td>
                                <td style={cellStyle}>{n.source || "—"}</td>
                                <td style={cellStyle}>{n.created_at?.slice(0, 10) || "—"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>}
            </WorkspaceBody>
        </div>
    )
}

function AlertsWorkspace() {
    const [alerts, setAlerts] = useState([])
    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState("all")

    const reload = () =>
        fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setAlerts((Array.isArray(d) ? d : []).map((a, i) => ({ ...a, _idx: i }))))
            .catch(() => {})

    useEffect(() => { reload() }, [])

    const filtered = alerts.filter(a => {
        if (filter !== "all" && a.severity !== filter) return false
        if (search && !(a.message || "").toLowerCase().includes(search.toLowerCase())) return false
        return true
    })

    const feedback = async (alert, action) => {
        if (alert._idx == null) return
        await fetch(`${API}/api/forge/alerts/${alert._idx}/feedback`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ action }) })
        setAlerts(prev => prev.filter(a => a._idx !== alert._idx))
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alerts…" style={{ ...inputStyle, flex: 1, maxWidth: 320 }} />
                {["all", "critical", "high", "medium", "info"].map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={tabBtn(filter === f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
                ))}
                <span style={{ color: "#334155", fontSize: 10 }}>{filtered.length}</span>
            </Toolbar>
            <WorkspaceBody>
                {filtered.length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>No alerts in last 24 hours.</div>}
                {filtered.slice(0, 150).map((a, i) => (
                    <div key={i} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 5, borderLeft: `2px solid ${a.severity === "critical" ? "#f87171" : a.severity === "high" ? "#fbbf24" : "#334155"}` }}>
                        <div style={{ color: "#cbd5e1", fontSize: 12, marginBottom: 4 }}>{a.message}</div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span style={{ color: "#334155", fontSize: 9 }}>{a.source || "AIS"}</span>
                            {a.rule_name && <span style={{ color: "#334155", fontSize: 9 }}>{a.rule_name}</span>}
                            {a.timestamp && <span style={{ color: "#334155", fontSize: 9 }}>{a.timestamp.slice(11, 19)}</span>}
                            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                <button onClick={() => feedback(a, "confirm")} style={actionBtn("#4ade80")}>✓ Confirm</button>
                                <button onClick={() => feedback(a, "false_alarm")} style={actionBtn("#f87171")}>✕ False Alarm</button>
                            </div>
                        </div>
                    </div>
                ))}
            </WorkspaceBody>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════

export default function ForgePanel({ user, onClose }) {
    const [brainStatus, setBrainStatus]   = useState(null)
    const [activeWorkspace, setActiveWorkspace] = useState(null)
    const [activeNode, setActiveNode]     = useState(null)
    const [pipelineNodes, setPipelineNodes] = useState(PIPELINE_NODES)
    const [pipelineEdges, setPipelineEdges] = useState(PIPELINE_EDGES)

    // Poll brain status
    useEffect(() => {
        const load = () =>
            fetch(`${API}/api/forge/brain-status`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setBrainStatus(d) })
                .catch(() => {})
        load()
        const id = setInterval(load, 30_000)
        return () => clearInterval(id)
    }, [])

    // Load persisted pipeline layout
    useEffect(() => {
        fetch(`${API}/api/forge/pipeline`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d?.nodes?.length > 0) {
                    setPipelineNodes(d.nodes)
                    setPipelineEdges(d.edges || [])
                }
            })
            .catch(() => {})
    }, [])

    const openWorkspace = (nodeId, node) => {
        setActiveNode(node)
        setActiveWorkspace(WS_MAP[nodeId] || "generic")
    }

    const goBack = () => {
        setActiveWorkspace(null)
        setActiveNode(null)
    }

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", zIndex: 50, display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <ForgeHeader brainStatus={brainStatus} activeNode={activeNode} onBack={goBack} />
            {!activeWorkspace ? (
                <div style={{ flex: 1, position: "relative" }}>
                    <PipelineCanvas
                        initialNodes={pipelineNodes}
                        initialEdges={pipelineEdges}
                        brainStatus={brainStatus}
                        onNodeClick={openWorkspace}
                    />
                </div>
            ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <WorkspaceRouter workspace={activeWorkspace} node={activeNode} brainStatus={brainStatus} />
                </div>
            )}
        </div>
    )
}
