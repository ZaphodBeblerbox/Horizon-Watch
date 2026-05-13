import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import PipelineCanvas, { TYPE_COLORS, STATUS_DOT } from "./forge/PipelineCanvas.jsx"
import { ALERT_ICONS } from "../constants/alertIcons.js"
import { esriSatelliteProvider } from "../globe/imageryProviders.js"

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
        } catch (_e) { setErr("Connection failed") }
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
    { id: 'det_sentinel',   label: 'Surveillance Zones',     column: 1, type: 'detector',     status: 'active',     config: {} },
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
    { from: 'src_news', to: 'det_news' }, { from: 'src_satellite', to: 'det_overwatch' }, { from: 'src_satellite', to: 'det_sentinel' },
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
    det_ais: 'ais-detector', det_adsb: 'adsb-detector', det_news: 'news-detector', det_overwatch: 'ml-detector', det_sentinel: 'surveillance-zones',
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
function WorkspaceBody({ children, style }) {
    return <div style={{ flex: 1, overflow: "auto", padding: 20, ...style }}>{children}</div>
}

// ── Header ─────────────────────────────────────────────────────────────────────
function ForgeHeader({ brainStatus, activeNode, onBack }) {
    const [muted, setMuted] = useState(() => localStorage.getItem("forge_notifications_muted") === "true")
    const toggleMute = () => {
        const next = !muted
        setMuted(next)
        localStorage.setItem("forge_notifications_muted", String(next))
    }
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {brainStatus && (
                    <span style={{ color: "#334155", fontSize: 10 }}>
                        {brainStatus.last_cycle ? new Date(brainStatus.last_cycle).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                        {" · "}{brainStatus.vessels_tracked ?? 0} vessels · {brainStatus.alerts_24h ?? 0} alerts
                    </span>
                )}
                <button onClick={toggleMute} title={muted ? "Unmute notifications" : "Mute notifications"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, opacity: muted ? 0.4 : 0.7, padding: "2px 4px", lineHeight: 1 }}>
                    {muted ? "🔇" : "🔔"}
                </button>
            </div>
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
        case "surveillance-zones": return <SurveillanceZonesWorkspace />
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
        } catch (_e) { setMsg("Failed") }
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
        } catch (_e) { setMsg("Upload failed") }
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
        { value: "stationary_near_infrastructure", label: "Loitering near infrastructure (cable / port)", params: { infra_type: "cable", max_speed_knots: 0.5, proximity_km: 10, min_duration_minutes: 120 } },
        { value: "AIS_STS_PROXIMITY",              label: "Ship-to-Ship Proximity (outside port)", params: { proximity_metres: 500, min_duration_minutes: 15, max_speed_knots: 2.0 } },
        { value: "AIS_DARK_SHIP",                  label: "AIS Dark Ship (gap detection)", params: { min_gap_minutes: 60, min_speed_before_gap: 2.0 } },
        { value: "AIS_CHOKEPOINT_ACTIVITY",        label: "AIS Chokepoint Activity (transit / loitering)", params: { target: "ALL", monitor_transit: true, monitor_loitering: false, min_loiter_duration_minutes: 45, max_loiter_speed_knots: 1.0 } },
    ],
    ADSB: [
        { value: "ADSB_LOITERING_NEAR_AIRPORT", label: "ADSB Loitering near airport", params: { airport_types: ["large_airport", "medium_airport"], proximity_km: 5, min_duration_minutes: 20, max_speed_knots: 200 } },
    ],
    NEWS: [],
}

const INFRA_TYPES = ["Submarine Cable", "Port", "Airport"]

const AIRPORT_TYPE_LABELS = {
    large_airport:   "Large airports",
    medium_airport:  "Medium airports",
    small_airport:   "Small airports",
    seaplane_base:   "Seaplane bases",
}

const REGION_LABELS = {
    "REG-ARCTIC":  "Arctic",
    "REG-NORSEA":  "North Sea / Baltic",
    "REG-MED":     "Mediterranean",
    "REG-REDSEA":  "Red Sea / Gulf",
    "REG-SEASIA":  "Southeast Asia",
    "REG-CARIB":   "Caribbean",
    "REG-ATL-N":   "North Atlantic",
    "REG-ATL-S":   "South Atlantic",
    "REG-IND":     "Indian Ocean",
    "REG-PAC-N":   "North Pacific",
    "REG-PAC-S":   "South Pacific",
}

function CreateRuleModal({ source, onClose, onCreated }) {
    const [name, setName]               = useState("")
    const [triggerType, setTriggerType] = useState("")
    const [severity, setSeverity]       = useState("high")
    const [params, setParams]           = useState({})
    const [saving, setSaving]           = useState(false)
    const [toast, setToast]             = useState("")

    // Infra-targeting state (AIS stationary_near_infrastructure)
    const [infraType, setInfraType]     = useState("Submarine Cable")
    const [scopeMode, setScopeMode]     = useState("ALL")       // ALL | REGION | SINGLE
    const [scopeRegion, setScopeRegion] = useState("")
    const [scopeSingle, setScopeSingle] = useState("")
    const [regions, setRegions]         = useState([])

    // STS / Dark ship state
    const [darkRegion, setDarkRegion]   = useState("")   // last_known_region for dark ship
    const [iconType, setIconType]       = useState("")   // optional ALERT_ICONS key override

    // ADSB loiter state
    const [loiterScopeMode, setLoiterScopeMode]     = useState("ALL")
    const [loiterScopeRegion, setLoiterScopeRegion] = useState("")
    const [loiterScopeSingle, setLoiterScopeSingle] = useState("")

    // Chokepoint activity state
    const [chokepoints, setChokepoints]           = useState([])    // [{system_id, name}]
    const [chokeTarget, setChokeTarget]           = useState("ALL") // ALL | IDs...
    const [chokeSelected, setChokeSelected]       = useState([])    // selected choke system_ids
    const [monitorTransit, setMonitorTransit]     = useState(true)
    const [monitorLoitering, setMonitorLoitering] = useState(false)
    const [vesselTypes, setVesselTypes]           = useState([])
    const [flagStates, setFlagStates]             = useState("")

    const isInfraRule   = source === "AIS"  && triggerType === "stationary_near_infrastructure"
    const isStsRule     = source === "AIS"  && triggerType === "AIS_STS_PROXIMITY"
    const isDarkRule    = source === "AIS"  && triggerType === "AIS_DARK_SHIP"
    const isLoiterRule  = source === "ADSB" && triggerType === "ADSB_LOITERING_NEAR_AIRPORT"
    const isChokeRule   = source === "AIS"  && triggerType === "AIS_CHOKEPOINT_ACTIVITY"
    const isDbRule      = isInfraRule || isStsRule || isDarkRule || isLoiterRule || isChokeRule

    useEffect(() => {
        if ((isInfraRule || isDarkRule || isLoiterRule) && regions.length === 0) {
            fetch(`${API}/api/cables/regions`)
                .then(r => r.ok ? r.json() : { regions: [] })
                .then(d => setRegions(d.regions || []))
                .catch(() => {})
        }
    }, [isInfraRule, isDarkRule, isLoiterRule])

    useEffect(() => {
        if (isChokeRule && chokepoints.length === 0) {
            fetch(`${API}/api/chokepoints`)
                .then(r => r.ok ? r.json() : { features: [] })
                .then(d => setChokepoints((d.features || []).map(f => ({
                    system_id: f.properties?.system_id,
                    name:      f.properties?.name,
                })).filter(c => c.system_id)))
                .catch(() => {})
        }
    }, [isChokeRule])

    const triggers = TRIGGER_TYPES[source] || []

    const selectTrigger = (val) => {
        setTriggerType(val)
        const t = triggers.find(t => t.value === val)
        setParams(t?.params ? JSON.parse(JSON.stringify(t.params)) : {})
        setScopeMode("ALL"); setScopeRegion(""); setScopeSingle("")
        setDarkRegion(""); setIconType("")
        setLoiterScopeMode("ALL"); setLoiterScopeRegion(""); setLoiterScopeSingle("")
        setChokeTarget("ALL"); setChokeSelected([]); setMonitorTransit(true)
        setMonitorLoitering(false); setVesselTypes([]); setFlagStates("")
    }

    const save = async () => {
        if (!name || !triggerType) return
        setSaving(true)
        try {
            if (isDbRule) {
                // DB-backed rule via /api/rules
                let ruleBody = null
                if (isInfraRule) {
                    let target = "ALL"
                    if (scopeMode === "REGION" && scopeRegion) target = scopeRegion
                    else if (scopeMode === "SINGLE" && scopeSingle) target = scopeSingle.trim().toUpperCase()
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "AIS_LOITERING_NEAR_INFRA",
                        severity,
                        params: {
                            infra_type:           infraType,
                            target,
                            proximity_km:         parseFloat(params.proximity_km ?? 0.5),
                            max_speed_knots:      parseFloat(params.max_speed_knots ?? 2.0),
                            min_duration_minutes: parseFloat(params.min_duration_minutes ?? 30),
                            distance_metres:      Math.round((parseFloat(params.proximity_km ?? 0.5)) * 1000),
                            duration_minutes:     parseFloat(params.min_duration_minutes ?? 30),
                            ...(iconType ? { icon_type: iconType } : {}),
                        },
                    }
                } else if (isStsRule) {
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "AIS_STS_PROXIMITY",
                        severity,
                        params: {
                            proximity_metres:     parseFloat(params.proximity_metres ?? 500),
                            min_duration_minutes: parseFloat(params.min_duration_minutes ?? 15),
                            max_speed_knots:      parseFloat(params.max_speed_knots ?? 2.0),
                            ...(iconType ? { icon_type: iconType } : {}),
                        },
                    }
                } else if (isDarkRule) {
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "AIS_DARK_SHIP",
                        severity,
                        params: {
                            min_gap_minutes:      parseFloat(params.min_gap_minutes ?? 60),
                            min_speed_before_gap: parseFloat(params.min_speed_before_gap ?? 2.0),
                            ...(darkRegion ? { last_known_region: darkRegion } : {}),
                            ...(iconType ? { icon_type: iconType } : {}),
                        },
                    }
                } else if (isLoiterRule) {
                    let target = "ALL"
                    if (loiterScopeMode === "REGION" && loiterScopeRegion) target = `REGION:${loiterScopeRegion}`
                    else if (loiterScopeMode === "SINGLE" && loiterScopeSingle) target = `ID:${loiterScopeSingle.trim()}`
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "ADSB_LOITERING_NEAR_AIRPORT",
                        severity,
                        params: {
                            target,
                            airport_types:        (params.airport_types || []).filter(Boolean),
                            proximity_km:         parseFloat(params.proximity_km ?? 5),
                            min_duration_minutes: parseFloat(params.min_duration_minutes ?? 20),
                            max_speed_knots:      parseFloat(params.max_speed_knots ?? 200),
                            ...(iconType ? { icon_type: iconType } : {}),
                        },
                    }
                } else if (isChokeRule) {
                    const target = chokeTarget === "ALL" || chokeSelected.length === 0
                        ? "ALL"
                        : chokeSelected.map(id => `ID:${id}`).join(",")
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "AIS_CHOKEPOINT_ACTIVITY",
                        severity,
                        icon_type: monitorLoitering ? "CHOKEPOINT_LOITER" : "CHOKEPOINT_TRANSIT",
                        params: {
                            target,
                            monitor_transit:              monitorTransit,
                            monitor_loitering:            monitorLoitering,
                            min_loiter_duration_minutes:  parseFloat(params.min_loiter_duration_minutes ?? 45),
                            max_loiter_speed_knots:       parseFloat(params.max_loiter_speed_knots ?? 1.0),
                            ...(vesselTypes.length > 0 ? { vessel_types: vesselTypes } : {}),
                            ...(flagStates.trim() ? { flag_states: flagStates.split(",").map(s => s.trim()).filter(Boolean) } : {}),
                            ...(iconType ? { icon_type: iconType } : {}),
                        },
                    }
                }
                if (!ruleBody) return
                const res = await fetch(`${API}/api/rules`, {
                    method: "POST", headers: forgeHeaders(), body: JSON.stringify(ruleBody),
                })
                const d = await res.json()
                if (res.ok) {
                    setToast("Rule created")
                    setTimeout(() => { setToast(""); onCreated({ ...d, _db: true }) }, 1000)
                } else {
                    setToast(`Error: ${d.detail || "Failed to create rule"}`)
                    setTimeout(() => setToast(""), 3000)
                }
            }
        } catch (_e) { }
        finally { setSaving(false) }
    }

    const fld = (label, ctrl) => (
        <div style={{ marginBottom: 12 }}>
            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
            {ctrl}
        </div>
    )

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div style={{ background: "#0f1219", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 6, padding: 24, width: 500, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Create {source} Rule</div>

                {toast && <div style={{ marginBottom: 12, padding: "6px 10px", background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 3, color: "#4ade80", fontSize: 11 }}>{toast}</div>}

                {fld("Rule Name", <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Med cable watch" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                {fld("Trigger Type", (
                    <select value={triggerType} onChange={e => selectTrigger(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                        <option value="">Select trigger…</option>
                        {triggers.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                ))}
                {fld("Severity", (
                    <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                        {["info", "medium", "high", "critical"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                ))}

                {isInfraRule ? (
                    <>
                        {fld("Infrastructure Type", (
                            <select value={infraType} onChange={e => setInfraType(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                {INFRA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        ))}

                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            {[
                                ["proximity_km", "Proximity (km)", params.proximity_km ?? 0.5],
                                ["max_speed_knots", "Max speed (kn)", params.max_speed_knots ?? 2.0],
                                ["min_duration_minutes", "Duration (min)", params.min_duration_minutes ?? 30],
                            ].map(([key, label, def]) => (
                                <div key={key}>
                                    <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                                    <input type="number" step="any"
                                        value={params[key] ?? def}
                                        onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                                </div>
                            ))}
                        </div>

                        {fld("Target Scope", (
                            <select value={scopeMode} onChange={e => setScopeMode(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                <option value="ALL">All cables globally</option>
                                <option value="REGION">By region</option>
                                <option value="SINGLE">Single cable ID</option>
                            </select>
                        ))}

                        {scopeMode === "REGION" && (
                            <>
                                {fld("Region", (
                                    <select value={scopeRegion} onChange={e => setScopeRegion(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                        <option value="">Select region…</option>
                                        {regions.map(r => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
                                    </select>
                                ))}
                                {regions.length > 0 && (
                                    <div style={{ marginBottom: 12, padding: "8px 10px", background: "#111827", borderRadius: 3, border: "1px solid rgba(148,163,184,0.06)" }}>
                                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Region legend</div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px" }}>
                                            {regions.map(r => (
                                                <div key={r.region_id} style={{ display: "flex", gap: 6, alignItems: "baseline", cursor: "pointer" }}
                                                    onClick={() => setScopeRegion(r.region_id)}>
                                                    <span style={{ fontFamily: "monospace", fontSize: 9, color: scopeRegion === r.region_id ? "#60a5fa" : "#334155", flexShrink: 0 }}>{r.region_id}</span>
                                                    <span style={{ fontSize: 9, color: scopeRegion === r.region_id ? "#94a3b8" : "#475569" }}>{r.region_name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {scopeMode === "SINGLE" && fld("Cable System ID (e.g. CABLE-042)", (
                            <input value={scopeSingle} onChange={e => setScopeSingle(e.target.value)} placeholder="CABLE-NNN" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        ))}
                    </>
                ) : isStsRule ? (
                    <>
                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            {[
                                ["proximity_metres",     "Proximity (m)",   params.proximity_metres ?? 500],
                                ["min_duration_minutes", "Duration (min)",  params.min_duration_minutes ?? 15],
                                ["max_speed_knots",      "Max speed (kn)",  params.max_speed_knots ?? 2.0],
                            ].map(([key, label, def]) => (
                                <div key={key}>
                                    <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                                    <input type="number" step="any"
                                        value={params[key] ?? def}
                                        onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                                </div>
                            ))}
                        </div>
                        <div style={{ marginBottom: 10, padding: "7px 10px", background: "rgba(96,165,250,0.06)", borderRadius: 3, border: "1px solid rgba(96,165,250,0.12)", color: "#475569", fontSize: 10 }}>
                            Fires when two vessels are within proximity for the set duration, <em>outside</em> any port boundary.
                        </div>
                    </>
                ) : isDarkRule ? (
                    <>
                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {[
                                ["min_gap_minutes",      "AIS gap (min)",       params.min_gap_minutes ?? 60],
                                ["min_speed_before_gap", "Min speed before (kn)", params.min_speed_before_gap ?? 2.0],
                            ].map(([key, label, def]) => (
                                <div key={key}>
                                    <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                                    <input type="number" step="any"
                                        value={params[key] ?? def}
                                        onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                                </div>
                            ))}
                        </div>
                        {fld("Last known region (optional filter)", (
                            <select value={darkRegion} onChange={e => setDarkRegion(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                <option value="">Any region</option>
                                {regions.map(r => <option key={r.region_id} value={r.region_id}>{r.region_name} ({r.region_id})</option>)}
                            </select>
                        ))}
                    </>
                ) : isLoiterRule ? (
                    <>
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Airport Types to Monitor</label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                                {Object.entries(AIRPORT_TYPE_LABELS).map(([val, label]) => (
                                    <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 10 }}>
                                        <input type="checkbox"
                                            checked={(params.airport_types || []).includes(val)}
                                            onChange={e => setParams(p => ({
                                                ...p,
                                                airport_types: e.target.checked
                                                    ? [...(p.airport_types || []), val]
                                                    : (p.airport_types || []).filter(t => t !== val)
                                            }))}
                                            style={{ accentColor: "#60a5fa" }}
                                        />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            {[
                                ["proximity_km",         "Proximity (km)",    params.proximity_km ?? 5],
                                ["min_duration_minutes", "Duration (min)",    params.min_duration_minutes ?? 20],
                                ["max_speed_knots",      "Max speed (kts)",   params.max_speed_knots ?? 200],
                            ].map(([key, label, def]) => (
                                <div key={key}>
                                    <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                                    <input type="number" step="any"
                                        value={params[key] ?? def}
                                        onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                                </div>
                            ))}
                        </div>

                        {fld("ID Scope", (
                            <select value={loiterScopeMode} onChange={e => setLoiterScopeMode(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                <option value="ALL">All airports globally</option>
                                <option value="REGION">By region</option>
                                <option value="SINGLE">Single ID (ARPT-XXXXX or ICAO)</option>
                            </select>
                        ))}

                        {loiterScopeMode === "REGION" && (
                            <>
                                {fld("Region", (
                                    <select value={loiterScopeRegion} onChange={e => setLoiterScopeRegion(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                        <option value="">Select region…</option>
                                        {regions.map(r => <option key={r.region_id} value={r.region_id}>{r.region_name} ({r.region_id})</option>)}
                                    </select>
                                ))}
                                {regions.length > 0 && (
                                    <div style={{ marginBottom: 12, padding: "8px 10px", background: "#111827", borderRadius: 3, border: "1px solid rgba(148,163,184,0.06)" }}>
                                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Region legend</div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px" }}>
                                            {regions.map(r => (
                                                <div key={r.region_id} style={{ display: "flex", gap: 6, alignItems: "baseline", cursor: "pointer" }}
                                                    onClick={() => setLoiterScopeRegion(r.region_id)}>
                                                    <span style={{ fontFamily: "monospace", fontSize: 9, color: loiterScopeRegion === r.region_id ? "#60a5fa" : "#334155", flexShrink: 0 }}>{r.region_id}</span>
                                                    <span style={{ fontSize: 9, color: loiterScopeRegion === r.region_id ? "#94a3b8" : "#475569" }}>{r.region_name}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {loiterScopeMode === "SINGLE" && fld("Airport ID or ICAO code", (
                            <input value={loiterScopeSingle} onChange={e => setLoiterScopeSingle(e.target.value)}
                                placeholder="ARPT-00001 or EGLL"
                                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        ))}
                    </>
                ) : isChokeRule ? (
                    <>
                        {fld("Chokepoint Scope", (
                            <select value={chokeTarget} onChange={e => { setChokeTarget(e.target.value); setChokeSelected([]) }} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                <option value="ALL">All strategic chokepoints</option>
                                <option value="SPECIFIC">Specific chokepoints</option>
                            </select>
                        ))}
                        {chokeTarget === "SPECIFIC" && chokepoints.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                                <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Select Chokepoints</label>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", maxHeight: 140, overflowY: "auto", padding: "4px 0" }}>
                                    {chokepoints.map(cp => (
                                        <label key={cp.system_id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 10 }}>
                                            <input type="checkbox"
                                                checked={chokeSelected.includes(cp.system_id)}
                                                onChange={e => setChokeSelected(prev => e.target.checked ? [...prev, cp.system_id] : prev.filter(id => id !== cp.system_id))}
                                                style={{ accentColor: "#60a5fa" }} />
                                            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#475569" }}>{cp.system_id}</span>
                                            {cp.name}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div style={{ marginBottom: 12, display: "flex", gap: 16 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 11 }}>
                                <input type="checkbox" checked={monitorTransit} onChange={e => setMonitorTransit(e.target.checked)} style={{ accentColor: "#60a5fa" }} />
                                Monitor Transit (fire on entry)
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 11 }}>
                                <input type="checkbox" checked={monitorLoitering} onChange={e => setMonitorLoitering(e.target.checked)} style={{ accentColor: "#f97316" }} />
                                Monitor Loitering
                            </label>
                        </div>
                        {monitorLoitering && (
                            <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                {[
                                    ["min_loiter_duration_minutes", "Min loiter duration (min)", params.min_loiter_duration_minutes ?? 45],
                                    ["max_loiter_speed_knots",      "Max loiter speed (kn)",     params.max_loiter_speed_knots ?? 1.0],
                                ].map(([key, label, def]) => (
                                    <div key={key}>
                                        <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 4 }}>{label}</label>
                                        <input type="number" step="any"
                                            value={params[key] ?? def}
                                            onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                                            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Vessel Types to Monitor</label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px" }}>
                                {["Tanker", "Cargo", "Military", "Fishing", "Unknown"].map(vt => (
                                    <label key={vt} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 10 }}>
                                        <input type="checkbox"
                                            checked={vesselTypes.includes(vt)}
                                            onChange={e => setVesselTypes(prev => e.target.checked ? [...prev, vt] : prev.filter(t => t !== vt))}
                                            style={{ accentColor: "#60a5fa" }} />
                                        {vt}
                                    </label>
                                ))}
                            </div>
                        </div>
                        {fld("Flag states filter (comma-sep ISO-2, leave blank for all)", (
                            <input value={flagStates} onChange={e => setFlagStates(e.target.value)}
                                placeholder="e.g. IR,RU,CN"
                                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        ))}
                    </>
                ) : (
                    triggerType && Object.keys(params).length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Parameters</label>
                            {Object.entries(params).map(([key, value]) => (
                                <div key={key} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "center" }}>
                                    <span style={{ color: "#475569", fontSize: 10, width: 140, flexShrink: 0 }}>{key.replace(/_/g, " ")}</span>
                                    <input value={typeof value === "object" ? JSON.stringify(value) : String(value)}
                                        onChange={e => { let v = e.target.value; try { v = JSON.parse(v) } catch (_e) {} setParams(p => ({ ...p, [key]: v })) }}
                                        style={{ flex: 1, padding: "3px 6px", background: "#111827", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 2, color: "#cbd5e1", fontSize: 10, outline: "none" }} />
                                </div>
                            ))}
                        </div>
                    )
                )}

                {isDbRule && fld("Alert Icon (optional)", (
                    <select value={iconType} onChange={e => setIconType(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                        <option value="">Default for rule type</option>
                        {Object.entries(ALERT_ICONS).map(([key, def]) => (
                            <option key={key} value={key}>{def.label}</option>
                        ))}
                    </select>
                ))}

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
    const [dbRules, setDbRules] = useState([])
    const [chains, setChains] = useState([])
    const [alerts, setAlerts] = useState([])
    const [tab, setTab] = useState("rules")
    const [expandedRule, setExpandedRule] = useState(null)
    const [expandedChain, setExpandedChain] = useState(null)
    const [showCreate, setShowCreate] = useState(false)
    const [selectedAlert, setSelectedAlert] = useState(null)

    const reload = () => {
        fetch(`${API}/api/rules`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {})
            .then(d => setDbRules(d.rules || []))
            .catch(() => {})
        if (source === "AIS") {
            fetch(`${API}/api/escalation-chains`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(d => setChains(Array.isArray(d) ? d : []))
                .catch(() => {})
        }
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
                        {t.charAt(0).toUpperCase() + t.slice(1)}{t === "rules" ? ` (${dbRules.filter(r => (r.trigger_type||r.rule_name||"").startsWith(source === "ADSB" ? "ADSB_" : "AIS_")).length})` : t === "alerts" ? ` (${alerts.length})` : ""}
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
                        {dbRules.filter(r => (r.trigger_type||r.rule_name||"").startsWith(source === "ADSB" ? "ADSB_" : "AIS_")).length === 0 && <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>No rules configured.</div>}

                        {/* ── DB-backed surveillance rules ─────────────────── */}
                        {(() => {
                            const prefix = source === "ADSB" ? "ADSB_" : "AIS_"
                            const visible = dbRules.filter(r => (r.trigger_type || r.rule_name || "").startsWith(prefix))
                            if (!visible.length) return null
                            const SEV_COLOR = { critical: "#f87171", high: "#fbbf24", medium: "#94a3b8", low: "#64748b", info: "#475569" }
                            return (
                                <>
                                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                        Surveillance rules ({visible.length})
                                    </div>
                                    {visible.map(rule => {
                                        const isEnabled = rule.enabled !== false
                                        const expanded  = expandedRule === `db-${rule.id}`
                                        const p         = rule.params || {}
                                        const sevColor  = SEV_COLOR[rule.severity] || "#94a3b8"
                                        return (
                                            <div key={`db-${rule.id}`} style={{ background: "#111827", borderRadius: 4, marginBottom: 5, overflow: "hidden", borderLeft: `2px solid ${isEnabled ? sevColor : "#334155"}` }}>
                                                <div style={{ padding: "9px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                                    onClick={() => setExpandedRule(expanded ? null : `db-${rule.id}`)}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{rule.name || rule.rule_name}</span>
                                                        <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{rule.trigger_type || rule.rule_name}</span>
                                                    </div>
                                                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                                        {rule.severity && (
                                                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: sevColor + "18", color: sevColor, fontWeight: 600 }}>{rule.severity}</span>
                                                        )}
                                                        {rule.icon_type && (
                                                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: "rgba(148,163,184,0.08)", color: "#64748b" }}>{rule.icon_type}</span>
                                                        )}
                                                        {!isEnabled && <span style={{ fontSize: 9, color: "#334155" }}>disabled</span>}
                                                        <span style={{ color: "#334155", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
                                                    </div>
                                                </div>
                                                {expanded && (
                                                    <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(148,163,184,0.04)" }}>
                                                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", margin: "8px 0 5px" }}>Parameters</div>
                                                        {[
                                                            ["system id",   rule.system_id],
                                                            ["trigger",     rule.trigger_type || rule.rule_name],
                                                            ["target",      p.target || "ALL"],
                                                            ["infra type",  p.infra_type],
                                                            ["proximity",   p.proximity_km != null ? `${p.proximity_km} km` : p.distance_metres != null ? `${p.distance_metres} m` : null],
                                                            ["max speed",   p.max_speed_knots != null ? `${p.max_speed_knots} kn` : null],
                                                            ["duration",    p.min_duration_minutes != null ? `${p.min_duration_minutes} min` : null],
                                                            ["min gap",     p.min_gap_minutes != null ? `${p.min_gap_minutes} min` : null],
                                                            ["squawk codes", p.squawk_codes ? p.squawk_codes.join(", ") : null],
                                                        ].filter(([, v]) => v != null).map(([k, v]) => (
                                                            <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                                                                <span style={{ color: "#475569", fontSize: 10, width: 110, flexShrink: 0 }}>{k}</span>
                                                                <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>
                                                            </div>
                                                        ))}
                                                        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                                                            <button onClick={async () => {
                                                                await fetch(`${API}/api/rules/${rule.id}`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ enabled: !isEnabled }) })
                                                                reload()
                                                            }} style={actionBtn(isEnabled ? "#f87171" : "#4ade80")}>{isEnabled ? "⏸ Disable" : "▶ Enable"}</button>
                                                            <button onClick={async () => {
                                                                if (!confirm("Delete this rule?")) return
                                                                await fetch(`${API}/api/rules/${rule.id}`, { method: "DELETE", headers: forgeHeaders() })
                                                                reload()
                                                            }} style={actionBtn("#f87171")}>Delete</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}

                                    {/* ── Escalation Chains (AIS tab only) ──────── */}
                                    {source === "AIS" && chains.length > 0 && (
                                        <div style={{ marginTop: 16 }}>
                                            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                                Escalation chains ({chains.length})
                                            </div>
                                            {chains.map(ch => {
                                                const exp = expandedChain === ch.id
                                                const SEV = SEV_COLOR[ch.escalated_severity] || "#f97316"
                                                return (
                                                    <div key={ch.id} style={{ background: "#111827", borderRadius: 4, marginBottom: 5, overflow: "hidden", borderLeft: `2px solid ${SEV}` }}>
                                                        <div style={{ padding: "9px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                                            onClick={() => setExpandedChain(exp ? null : ch.id)}>
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{ch.chain_name}</span>
                                                            </div>
                                                            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                                                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: SEV + "18", color: SEV, fontWeight: 600 }}>{ch.escalated_severity}</span>
                                                                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: "rgba(249,115,22,0.08)", color: "#f97316" }}>{ch.escalated_icon_type}</span>
                                                                <span style={{ color: "#334155", fontSize: 10 }}>{exp ? "▲" : "▼"}</span>
                                                            </div>
                                                        </div>
                                                        {exp && (
                                                            <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(148,163,184,0.04)" }}>
                                                                <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", margin: "8px 0 5px" }}>Chain details</div>
                                                                {[
                                                                    ["system id",    ch.system_id],
                                                                    ["window",       `${ch.time_window_minutes} min`],
                                                                    ["escalates to", `${ch.escalated_severity} / ${ch.escalated_icon_type}`],
                                                                    ["rules",        (ch.rule_names || ch.rule_ids || []).join(" · ")],
                                                                ].map(([k, v]) => (
                                                                    <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                                                                        <span style={{ color: "#475569", fontSize: 10, width: 110, flexShrink: 0 }}>{k}</span>
                                                                        <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>
                                                                    </div>
                                                                ))}
                                                                <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                                                                    <button onClick={async () => {
                                                                        if (!confirm("Delete this chain?")) return
                                                                        await fetch(`${API}/api/escalation-chains/${ch.id}`, { method: "DELETE", headers: forgeHeaders() })
                                                                        reload()
                                                                    }} style={actionBtn("#f87171")}>Delete</button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </>
                            )
                        })()}
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
            {showCreate && <CreateRuleModal source={source} onClose={() => setShowCreate(false)} onCreated={() => { reload(); setShowCreate(false) }} />}
        </div>
    )
}

// ── Surveillance Zones ─────────────────────────────────────────────────────────

const PRIORITY_COLORS = { critical: "#f87171", high: "#fbbf24", medium: "#94a3b8", low: "#64748b" }
const ML_TASK_LABELS = {
    ship_detection:                 "Ship detection",
    vessel_cluster_detection:       "Vessel cluster detection",
    smoke_plume_detection:          "Smoke plume detection",
    fire_detection:                 "Fire detection",
    burn_scar_detection:            "Burn scar detection",
    oil_slick_detection:            "Oil slick detection",
    infrastructure_change_detection:"Infrastructure change detection",
    vessel_without_ais_detection:   "Vessel without AIS detection",
}
const DET_COLORS = {
    vessel: "#f97316", fire: "#ef4444", smoke_plume: "#94a3b8",
    oil_slick: "#1d4ed8", vessel_cluster: "#eab308",
    infrastructure_change: "#a855f7", vessel_without_ais: "#dc2626",
    burn_scar: "#78350f",
}

function _fmtCountdown(nextScanAt) {
    if (!nextScanAt) return null
    const diff = new Date(nextScanAt) - Date.now()
    if (diff <= 0) return "due now"
    const h = Math.floor(diff / 3_600_000)
    const m = Math.floor((diff % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Embedded Cesium polygon draw for zone creation ────────────────────────────
function DrawZoneGlobe({ onPolygon }) {
    const containerRef   = useRef(null)
    const viewerRef      = useRef(null)
    const verticesRef    = useRef([])      // [[lon, lat], ...]
    const markerEntRef   = useRef([])      // point entity objects
    const polyEntRef     = useRef(null)    // filled polygon entity
    const lineEntRef     = useRef(null)    // preview polyline entity
    const isClosedRef    = useRef(false)
    const [uiState, setUiState] = useState({ count: 0, area: null, closed: false, err: null })

    function _calcAreaKm2(verts) {
        if (verts.length < 3) return 0
        let area = 0
        const n = verts.length
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            area += verts[i][0] * verts[j][1]
            area -= verts[j][0] * verts[i][1]
        }
        const degArea = Math.abs(area) / 2
        const cosLat  = Math.cos(verts[0][1] * Math.PI / 180)
        return Math.round(degArea * 111 * 111 * cosLat)
    }

    useEffect(() => {
        if (!containerRef.current) return
        let viewer = null
        let handler = null

        import("cesium").then(C => {
            if (!containerRef.current) return  // unmounted
            const {
                Viewer: CV, ScreenSpaceEventHandler: SEH, ScreenSpaceEventType: SET,
                Cartographic, Math: CM, Color, Cartesian3, PolygonHierarchy,
            } = C

            try {
                viewer = new CV(containerRef.current, {
                    animation: false, timeline: false, baseLayerPicker: false,
                    navigationHelpButton: false, homeButton: false,
                    sceneModePicker: false, geocoder: false,
                    fullscreenButton: false, selectionIndicator: false,
                    infoBox: false, shadows: false,
                    creditContainer: document.createElement("div"),
                    shouldAnimate: false,
                })
            } catch (_e) {
                setUiState(s => ({ ...s, err: "Globe init failed" }))
                return
            }
            viewerRef.current = viewer
            viewer.imageryLayers.removeAll()
            viewer.imageryLayers.addImageryProvider(esriSatelliteProvider)
            viewer.camera.setView({ destination: Cartesian3.fromDegrees(0, 20, 15_000_000) })

            handler = new SEH(viewer.scene.canvas)

            function _pickLonLat(pos) {
                const cart = viewer.camera.pickEllipsoid(pos)
                if (!cart) return null
                const carto = Cartographic.fromCartesian(cart)
                return [CM.toDegrees(carto.longitude), CM.toDegrees(carto.latitude)]
            }

            function _refreshLine() {
                if (lineEntRef.current) { try { viewer.entities.remove(lineEntRef.current) } catch (_e) {} lineEntRef.current = null }
                const verts = verticesRef.current
                if (verts.length < 2) return
                const positions = [...verts.map(([ln, lt]) => Cartesian3.fromDegrees(ln, lt)), Cartesian3.fromDegrees(verts[0][0], verts[0][1])]
                lineEntRef.current = viewer.entities.add({
                    polyline: { positions, width: 1.5, material: Color.fromCssColorString("#60a5fa").withAlpha(0.6), clampToGround: true },
                })
            }

            handler.setInputAction((evt) => {
                if (isClosedRef.current) return
                const pt = _pickLonLat(evt.position)
                if (!pt) return
                verticesRef.current = [...verticesRef.current, pt]
                const ent = viewer.entities.add({
                    position: Cartesian3.fromDegrees(pt[0], pt[1]),
                    point: { pixelSize: 7, color: Color.fromCssColorString("#60a5fa"), outlineColor: Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
                })
                markerEntRef.current = [...markerEntRef.current, ent]
                _refreshLine()
                setUiState(s => ({ ...s, count: verticesRef.current.length }))
            }, SET.LEFT_CLICK)

            handler.setInputAction((_evt) => {
                if (isClosedRef.current) return
                // Double-click fires after two LEFT_CLICKs — undo the extra vertex from the 2nd click
                if (verticesRef.current.length > 0) {
                    const lastM = markerEntRef.current[markerEntRef.current.length - 1]
                    if (lastM) { try { viewer.entities.remove(lastM) } catch (_e) {} }
                    markerEntRef.current = markerEntRef.current.slice(0, -1)
                    verticesRef.current = verticesRef.current.slice(0, -1)
                }
                const verts = verticesRef.current
                if (verts.length < 3) return
                isClosedRef.current = true
                markerEntRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_e) {} })
                markerEntRef.current = []
                if (lineEntRef.current) { try { viewer.entities.remove(lineEntRef.current) } catch (_e) {} lineEntRef.current = null }
                const positions = verts.map(([ln, lt]) => Cartesian3.fromDegrees(ln, lt))
                if (polyEntRef.current) { try { viewer.entities.remove(polyEntRef.current) } catch (_e) {} }
                polyEntRef.current = viewer.entities.add({
                    polygon: {
                        hierarchy: new PolygonHierarchy(positions),
                        material: Color.fromCssColorString("#3b82f6").withAlpha(0.35),
                        outline: true, outlineColor: Color.fromCssColorString("#60a5fa"), outlineWidth: 2, heightReference: 1,
                    },
                })
                setUiState({ count: verts.length, area: _calcAreaKm2(verts), closed: true, err: null })
            }, SET.LEFT_DOUBLE_CLICK)
        }).catch(_e => setUiState(s => ({ ...s, err: "Cesium load failed" })))

        return () => {
            if (handler) { try { handler.destroy() } catch (_e) {} }
            if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.destroy()
                viewerRef.current = null
            }
        }
    }, [])

    function handleClear() {
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return
        markerEntRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_e) {} })
        markerEntRef.current = []
        if (polyEntRef.current) { try { viewer.entities.remove(polyEntRef.current) } catch (_e) {} polyEntRef.current = null }
        if (lineEntRef.current) { try { viewer.entities.remove(lineEntRef.current) } catch (_e) {} lineEntRef.current = null }
        verticesRef.current = []
        isClosedRef.current = false
        setUiState({ count: 0, area: null, closed: false, err: null })
    }

    function handleContinue() {
        const verts = verticesRef.current
        if (verts.length < 3) return
        const ring = [...verts, verts[0]]
        onPolygon({ type: "Polygon", coordinates: [ring] })
    }

    const { count, area, closed, err } = uiState

    return (
        <div>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>
                Fly to your area of interest and draw a polygon. Click to place points, double-click to close.
            </div>
            {err
                ? <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{err}</div>
                : <div ref={containerRef} style={{ width: "100%", height: 400, borderRadius: 4, overflow: "hidden", background: "#0a0e14" }} />
            }
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ color: "#64748b", fontSize: 11 }}>
                    {count} {count === 1 ? "vertex" : "vertices"}{area !== null ? ` · ~${area.toLocaleString()} km²` : ""}
                    {!closed && count > 0 ? " — double-click to close" : ""}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleClear} style={ghostBtn}>Clear</button>
                    <button
                        onClick={handleContinue}
                        disabled={!closed}
                        style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)", opacity: closed ? 1 : 0.35 }}
                    >
                        Continue →
                    </button>
                </div>
            </div>
        </div>
    )
}

function CreateZoneModal({ onClose, onCreated }) {
    const [step, setStep] = useState(1)
    const [polygon, setPolygon] = useState(null)  // GeoJSON Polygon
    const [bboxStr, setBboxStr] = useState("")    // human-readable bbox
    const [name, setName] = useState("")
    const [desc, setDesc] = useState("")
    const [priority, setPriority] = useState("high")
    const [interval, setInterval] = useState(24)
    const [threshold, setThreshold] = useState("both")
    const [mlTasks, setMlTasks] = useState(["ship_detection", "fire_detection"])
    const [saving, setSaving] = useState(false)
    const [toast, setToast] = useState("")

    const handleBboxNext = (poly) => {
        setPolygon(poly)
        const coords = poly.coordinates[0]
        const lons = coords.map(c => c[0]), lats = coords.map(c => c[1])
        const [w, e] = [Math.min(...lons), Math.max(...lons)]
        const [s, n] = [Math.min(...lats), Math.max(...lats)]
        setBboxStr(`${s.toFixed(3)}°N – ${n.toFixed(3)}°N, ${w.toFixed(3)}°E – ${e.toFixed(3)}°E`)
        setStep(2)
    }

    const toggleTask = (t) => setMlTasks(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])

    const save = async () => {
        if (!name.trim()) { setToast("Zone name required"); return }
        if (!polygon) { setToast("No polygon defined"); return }
        setSaving(true)
        try {
            const res = await fetch(`${API}/api/watch-zones`, {
                method: "POST", headers: forgeHeaders(),
                body: JSON.stringify({
                    name: name.trim(), description: desc || null,
                    polygon_geojson: polygon,
                    priority, scan_interval_hours: Number(interval),
                    ml_tasks: mlTasks, alert_threshold: threshold,
                }),
            })
            const d = await res.json()
            if (res.ok) { setToast("Zone created"); setTimeout(() => onCreated(d), 800) }
            else { setToast(d.detail || "Failed to create zone"); setSaving(false) }
        } catch (e) { setToast("Network error"); setSaving(false) }
    }

    const overlayStyle = {
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000,
    }
    const modalStyle = {
        background: "#0d1117", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 8,
        padding: 24, width: step === 1 ? 640 : 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto",
    }
    const row = { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }
    const lbl = { color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }
    const inp = { ...inputStyle, width: "100%", boxSizing: "border-box" }
    const sel = { ...inp, background: "#111827" }

    return (
        <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={modalStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <span style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>
                        {step === 1 ? "Step 1 — Draw surveillance zone" : step === 2 ? "Step 2 — Configure" : "Step 3 — Confirm"}
                    </span>
                    <button onClick={onClose} style={{ ...ghostBtn, padding: "2px 8px" }}>✕</button>
                </div>

                {toast && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{toast}</div>}

                {step === 1 && (
                    <DrawZoneGlobe onPolygon={handleBboxNext} />
                )}

                {step === 2 && (
                    <div>
                        <div style={row}>
                            <span style={lbl}>Zone name *</span>
                            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Strait of Hormuz — Critical Zone" />
                        </div>
                        <div style={row}>
                            <span style={lbl}>Description</span>
                            <textarea style={{ ...inp, height: 52, resize: "vertical" }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                            <div style={row}>
                                <span style={lbl}>Priority</span>
                                <select style={sel} value={priority} onChange={e => setPriority(e.target.value)}>
                                    {["critical","high","medium","low"].map(p => <option key={p}>{p}</option>)}
                                </select>
                            </div>
                            <div style={row}>
                                <span style={lbl}>Scan interval</span>
                                <select style={sel} value={interval} onChange={e => setInterval(e.target.value)}>
                                    <option value={6}>Every 6h</option>
                                    <option value={12}>Every 12h</option>
                                    <option value={24}>Every 24h</option>
                                </select>
                            </div>
                            <div style={row}>
                                <span style={lbl}>Alert threshold</span>
                                <select style={sel} value={threshold} onChange={e => setThreshold(e.target.value)}>
                                    <option value="digest">Digest only</option>
                                    <option value="immediate">Immediate only</option>
                                    <option value="both">Both</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ ...row, marginTop: 4 }}>
                            <span style={lbl}>ML tasks</span>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                {Object.entries(ML_TASK_LABELS).map(([k, v]) => (
                                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#94a3b8", fontSize: 11, padding: "3px 0" }}>
                                        <input type="checkbox" checked={mlTasks.includes(k)} onChange={() => toggleTask(k)}
                                            style={{ accentColor: "#60a5fa" }} />
                                        {v}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                            <button onClick={() => setStep(1)} style={{ ...ghostBtn }}>← Back</button>
                            <button onClick={() => setStep(3)} style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)" }}>
                                Review →
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div>
                        <div style={{ background: "#111827", borderRadius: 4, padding: 12, marginBottom: 12 }}>
                            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{name || "(unnamed)"}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                {[
                                    ["Area", bboxStr], ["Priority", priority],
                                    ["Scan interval", `Every ${interval}h`], ["Alerts", threshold],
                                    ["ML tasks", mlTasks.length + " selected"],
                                ].map(([k, v]) => (
                                    <div key={k} style={{ display: "flex", gap: 8 }}>
                                        <span style={{ color: "#475569", fontSize: 10, width: 90, flexShrink: 0 }}>{k}</span>
                                        <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setStep(2)} style={{ ...ghostBtn }}>← Back</button>
                            <button onClick={save} disabled={saving} style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>
                                {saving ? "Creating…" : "Create Zone"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function ScanDetailPanel({ zone, scan, onClose }) {
    const [dets, setDets] = useState([])
    const [selectedDet, setSelectedDet] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!scan?.scan_id) return
        setLoading(true)
        fetch(`${API}/api/watch-zones/${zone.system_id}/scans/${scan.scan_id}/detections`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { features: [] })
            .then(d => {
                // Extract centroid features only for table
                const centroids = (d.features || []).filter(f => f.properties?.feature_role === "centroid")
                setDets(centroids)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [scan?.scan_id])

    if (!scan) return null
    const summary = scan.result_summary || {}

    const panelStyle = {
        background: "#0d1117", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 6,
        marginTop: 8, padding: 12,
    }
    const thStyle = { color: "#475569", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 8px", textAlign: "left" }
    const tdStyle = { color: "#94a3b8", fontSize: 10, padding: "4px 8px", borderTop: "1px solid rgba(148,163,184,0.04)" }

    const det_by_type = summary.by_type || {}

    return (
        <div style={panelStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{scan.scan_id}</span>
                <button onClick={onClose} style={{ ...ghostBtn, padding: "1px 6px", fontSize: 10 }}>✕</button>
            </div>

            {/* Image info bar */}
            <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
                {[
                    ["Scene", scan.image_id || "—"],
                    ["Time", scan.image_timestamp_utc ? scan.image_timestamp_utc.slice(0, 16).replace("T", " ") + " UTC" : "—"],
                    ["Cloud", scan.cloud_cover_percent != null ? `${scan.cloud_cover_percent.toFixed(0)}%` : "—"],
                    ["Image age", scan.image_age_hours != null ? `${scan.image_age_hours.toFixed(1)}h` : "—"],
                ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 4 }}>
                        <span style={{ color: "#475569", fontSize: 10 }}>{k}:</span>
                        <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Detection summary */}
            <div style={{ marginBottom: 8 }}>
                <span style={{ color: "#e2e8f0", fontSize: 11 }}>Total: {summary.total_detections ?? 0}</span>
                <span style={{ color: "#475569", fontSize: 10, marginLeft: 10 }}>
                    {Object.entries(det_by_type).map(([t, n]) => `${t.replace(/_/g, " ")}: ${n}`).join(" | ")}
                </span>
            </div>

            {/* Detection bbox map (colour-coded squares on a dark canvas) */}
            {dets.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ color: "#475569", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Detection map</div>
                    <div style={{ position: "relative", background: "#060a14", border: "1px solid rgba(148,163,184,0.06)", borderRadius: 3, height: 180, overflow: "hidden" }}>
                        {dets.map((f, i) => {
                            const p = f.properties
                            const bbox = zone.bbox
                            if (!bbox) return null
                            const xPct = ((p.centroid_lon || 0) - bbox.min_lon) / (bbox.max_lon - bbox.min_lon) * 100
                            const yPct = (1 - ((p.centroid_lat || 0) - bbox.min_lat) / (bbox.max_lat - bbox.min_lat)) * 100
                            const col = DET_COLORS[p.object_type] || "#ffffff"
                            const isSelected = selectedDet === i
                            return (
                                <div key={i} onClick={() => setSelectedDet(isSelected ? null : i)}
                                    title={`${p.object_type} (${(p.confidence * 100).toFixed(0)}%)`}
                                    style={{
                                        position: "absolute",
                                        left: `${Math.max(0, Math.min(96, xPct))}%`,
                                        top:  `${Math.max(0, Math.min(96, yPct))}%`,
                                        width: 8, height: 8,
                                        background: col, opacity: isSelected ? 1 : 0.7,
                                        border: isSelected ? `2px solid #fff` : `1px solid ${col}`,
                                        borderRadius: 2, cursor: "pointer", transform: "translate(-50%,-50%)",
                                    }}
                                />
                            )
                        })}
                        {selectedDet != null && dets[selectedDet] && (() => {
                            const p = dets[selectedDet].properties
                            const attrs = typeof p.attributes === "object" ? p.attributes : {}
                            return (
                                <div style={{
                                    position: "absolute", bottom: 4, left: 4, right: 4,
                                    background: "rgba(0,0,0,0.8)", borderRadius: 3, padding: "5px 8px",
                                    fontSize: 10, color: "#e2e8f0",
                                }}>
                                    <span style={{ color: DET_COLORS[p.object_type] || "#fff", fontWeight: 600 }}>{p.object_type?.replace(/_/g, " ")}</span>
                                    {" "}{(p.confidence * 100).toFixed(0)}% conf
                                    {attrs.estimated_length_m ? ` · ${attrs.estimated_length_m}×${attrs.estimated_width_m}m` : ""}
                                    {p.centroid_lat ? ` · ${Number(p.centroid_lat).toFixed(4)}°N, ${Number(p.centroid_lon).toFixed(4)}°E` : ""}
                                    {" · AIS: "}{p.matched_to_ais ? "yes" : "no"}
                                </div>
                            )
                        })()}
                    </div>
                    {/* Legend */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                        {Object.entries(DET_COLORS).map(([k, c]) => (
                            <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                <div style={{ width: 8, height: 8, background: c, borderRadius: 1 }} />
                                <span style={{ color: "#475569", fontSize: 9 }}>{k.replace(/_/g, " ")}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Detection table */}
            {loading ? <div style={{ color: "#475569", fontSize: 11, padding: 8 }}>Loading detections…</div> :
             dets.length === 0 ? <div style={{ color: "#475569", fontSize: 11, padding: 8 }}>No detections in this scan.</div> :
            (
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                        <thead>
                            <tr>
                                {["Type","Conf","Length m","Width m","Lat","Lon","AIS"].map(h => (
                                    <th key={h} style={thStyle}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {dets.map((f, i) => {
                                const p = f.properties
                                const attrs = typeof p.attributes === "object" ? p.attributes :
                                    (p.attributes ? (() => { try { return JSON.parse(p.attributes) } catch (_e) { return {} } })() : {})
                                const isSelected = selectedDet === i
                                return (
                                    <tr key={i} onClick={() => setSelectedDet(isSelected ? null : i)}
                                        style={{ cursor: "pointer", background: isSelected ? "rgba(96,165,250,0.08)" : "transparent" }}>
                                        <td style={{ ...tdStyle, color: DET_COLORS[p.object_type] || "#94a3b8" }}>{p.object_type?.replace(/_/g, " ")}</td>
                                        <td style={tdStyle}>{(p.confidence * 100).toFixed(0)}%</td>
                                        <td style={tdStyle}>{attrs.estimated_length_m ?? "—"}</td>
                                        <td style={tdStyle}>{attrs.estimated_width_m ?? "—"}</td>
                                        <td style={tdStyle}>{Number(p.centroid_lat).toFixed(4)}</td>
                                        <td style={tdStyle}>{Number(p.centroid_lon).toFixed(4)}</td>
                                        <td style={tdStyle}>{p.matched_to_ais ? "✓" : "—"}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

function SurveillanceZonesWorkspace() {
    const [zones, setZones] = useState([])
    const [showCreate, setShowCreate] = useState(false)
    const [expandedZone, setExpandedZone] = useState(null)
    const [zoneScans, setZoneScans] = useState({})   // system_id → scans[]
    const [selectedScan, setSelectedScan] = useState({})  // system_id → scan
    const [analytics, setAnalytics] = useState({})  // system_id → analytics
    const [showAnalytics, setShowAnalytics] = useState(null)
    const [toast, setToast] = useState("")

    const reload = () =>
        fetch(`${API}/api/watch-zones`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setZones(Array.isArray(d) ? d : []))
            .catch(() => {})

    useEffect(() => { reload() }, [])

    const loadScans = (zone) => {
        fetch(`${API}/api/watch-zones/${zone.system_id}/scans`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setZoneScans(prev => ({ ...prev, [zone.system_id]: Array.isArray(d) ? d : [] })))
            .catch(() => {})
    }

    const loadAnalytics = (zone) => {
        fetch(`${API}/api/watch-zones/${zone.system_id}/analytics`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setAnalytics(prev => ({ ...prev, [zone.system_id]: d })) })
            .catch(() => {})
    }

    const scanNow = async (zone) => {
        const r = await fetch(`${API}/api/watch-zones/${zone.system_id}/scan-now`, {
            method: "POST", headers: forgeHeaders(),
        })
        const d = await r.json()
        setToast(`Scan triggered: ${d.scan_id || d.message || "pending"}`)
        setTimeout(() => setToast(""), 3000)
        setTimeout(() => loadScans(zone), 2000)
    }

    const toggleEnabled = async (zone) => {
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
            method: "PUT", headers: forgeHeaders(),
            body: JSON.stringify({ enabled: !zone.enabled }),
        })
        reload()
    }

    const deleteZone = async (zone) => {
        if (!confirm(`Disable zone "${zone.name}"? Scan history will be preserved.`)) return
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
            method: "DELETE", headers: forgeHeaders(),
        })
        reload()
    }

    const toggleExpand = (zone) => {
        if (expandedZone === zone.system_id) {
            setExpandedZone(null)
        } else {
            setExpandedZone(zone.system_id)
            loadScans(zone)
            loadAnalytics(zone)
        }
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <span style={{ color: "#475569", fontSize: 11 }}>Surveillance Zones ({zones.length})</span>
                <div style={{ flex: 1 }} />
                {toast && <span style={{ color: "#4ade80", fontSize: 10 }}>{toast}</span>}
                <button onClick={() => setShowCreate(true)} style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.25)" }}>
                    + Create Zone
                </button>
            </Toolbar>
            <WorkspaceBody>
                <div style={{ maxWidth: 760 }}>
                    {zones.length === 0 && (
                        <div style={{ color: "#475569", fontSize: 12, textAlign: "center", padding: 40 }}>
                            No surveillance zones configured. Create one to start scheduled Sentinel-2 scanning.
                        </div>
                    )}

                    {zones.map(zone => {
                        const priColor = PRIORITY_COLORS[zone.priority] || "#94a3b8"
                        const isExpanded = expandedZone === zone.system_id
                        const scans = zoneScans[zone.system_id] || []
                        const latestScan = scans[0]
                        const ana = analytics[zone.system_id]
                        const detSummary = latestScan?.result_summary?.by_type || {}

                        return (
                            <div key={zone.system_id} style={{
                                background: "#111827", borderRadius: 5, marginBottom: 6,
                                overflow: "hidden", borderLeft: `2px solid ${zone.enabled ? priColor : "#334155"}`,
                                opacity: zone.enabled ? 1 : 0.6,
                            }}>
                                {/* Header row */}
                                <div style={{ padding: "10px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                    onClick={() => toggleExpand(zone)}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{zone.name}</span>
                                        <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{zone.system_id}</span>
                                        {!zone.enabled && <span style={{ color: "#334155", fontSize: 9, marginLeft: 6 }}>disabled</span>}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 2, background: priColor + "18", color: priColor, fontWeight: 600 }}>
                                            {zone.priority}
                                        </span>
                                        <span style={{ color: "#475569", fontSize: 9 }}>every {zone.scan_interval_hours}h</span>
                                        {zone.next_scan_at && (
                                            <span style={{ color: "#334155", fontSize: 9 }}>
                                                next: {_fmtCountdown(zone.next_scan_at)}
                                            </span>
                                        )}
                                        {zone.last_scanned_at && (
                                            <span style={{ color: "#334155", fontSize: 9 }}>
                                                last: {new Date(zone.last_scanned_at).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" })}
                                            </span>
                                        )}
                                        {/* Latest scan findings */}
                                        {Object.entries(detSummary).slice(0, 3).map(([t, n]) => (
                                            <span key={t} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: (DET_COLORS[t] || "#475569") + "22", color: DET_COLORS[t] || "#475569" }}>
                                                {t.replace(/_/g, " ")}: {n}
                                            </span>
                                        ))}
                                        <span style={{ color: "#334155", fontSize: 10 }}>{isExpanded ? "▲" : "▼"}</span>
                                    </div>
                                </div>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(148,163,184,0.04)" }}>
                                        {/* Actions */}
                                        <div style={{ display: "flex", gap: 4, marginTop: 10, marginBottom: 12, flexWrap: "wrap" }}>
                                            <button onClick={() => scanNow(zone)} style={actionBtn("#60a5fa")}>▶ Scan Now</button>
                                            <button onClick={() => toggleEnabled(zone)} style={actionBtn(zone.enabled ? "#f87171" : "#4ade80")}>
                                                {zone.enabled ? "⏸ Disable" : "▶ Enable"}
                                            </button>
                                            <button onClick={() => deleteZone(zone)} style={actionBtn("#f87171")}>Delete</button>
                                        </div>

                                        {/* Zone info */}
                                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Zone details</div>
                                        {zone.bbox && (
                                            <div style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                                                <span style={{ color: "#475569", fontSize: 10, width: 100 }}>bbox</span>
                                                <span style={{ color: "#64748b", fontSize: 10 }}>
                                                    {zone.bbox.min_lat.toFixed(2)}°–{zone.bbox.max_lat.toFixed(2)}°N,{" "}
                                                    {zone.bbox.min_lon.toFixed(2)}°–{zone.bbox.max_lon.toFixed(2)}°E
                                                </span>
                                            </div>
                                        )}
                                        {[
                                            ["ml tasks", (zone.ml_tasks || []).map(t => ML_TASK_LABELS[t] || t).join(", ") || "none"],
                                            ["alert threshold", zone.alert_threshold],
                                        ].map(([k, v]) => (
                                            <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                                                <span style={{ color: "#475569", fontSize: 10, width: 100, flexShrink: 0 }}>{k}</span>
                                                <span style={{ color: "#64748b", fontSize: 10 }}>{v}</span>
                                            </div>
                                        ))}

                                        {/* Analytics summary */}
                                        {ana && (
                                            <div style={{ marginTop: 10 }}>
                                                <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Analytics</div>
                                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                                                    {[
                                                        ["Total scans", ana.scans_total],
                                                        ["Last 30d scans", ana.scans_last_30_days],
                                                        ["Vessel trend", ana.vessel_activity_trend],
                                                        ["vs baseline", ana.change_vs_baseline_pct != null ? `${ana.change_vs_baseline_pct > 0 ? "+" : ""}${ana.change_vs_baseline_pct}%` : "—"],
                                                        ["Last fire", ana.last_fire_detected ? ana.last_fire_detected.slice(0, 10) : "none"],
                                                        ["Last smoke", ana.last_smoke_detected ? ana.last_smoke_detected.slice(0, 10) : "none"],
                                                    ].map(([k, v]) => (
                                                        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                                            <span style={{ color: "#334155", fontSize: 9 }}>{k}</span>
                                                            <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>{v}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Scan history */}
                                        {scans.length > 0 && (
                                            <div style={{ marginTop: 12 }}>
                                                <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
                                                    Scan history ({scans.length})
                                                </div>
                                                {scans.slice(0, 10).map(scan => {
                                                    const rs = scan.result_summary || {}
                                                    const statusColor = scan.status === "complete" ? "#4ade80" : scan.status === "failed" ? "#f87171" : "#fbbf24"
                                                    const isSelScan = selectedScan[zone.system_id]?.scan_id === scan.scan_id
                                                    return (
                                                        <div key={scan.scan_id}>
                                                            <div
                                                                onClick={() => setSelectedScan(prev => ({
                                                                    ...prev,
                                                                    [zone.system_id]: isSelScan ? null : scan,
                                                                }))}
                                                                style={{
                                                                    display: "flex", gap: 8, alignItems: "center",
                                                                    padding: "5px 8px", borderRadius: 3, cursor: "pointer", marginBottom: 2,
                                                                    background: isSelScan ? "rgba(96,165,250,0.06)" : "rgba(148,163,184,0.03)",
                                                                }}>
                                                                <span style={{ color: statusColor, fontSize: 9, fontWeight: 600, width: 55 }}>{scan.status}</span>
                                                                <span style={{ color: "#475569", fontSize: 9, width: 70 }}>{scan.scan_id}</span>
                                                                <span style={{ color: "#334155", fontSize: 9 }}>
                                                                    {scan.created_at ? new Date(scan.created_at).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" }) : "—"}
                                                                </span>
                                                                <span style={{ color: "#475569", fontSize: 9 }}>
                                                                    {scan.triggered_by}
                                                                </span>
                                                                {rs.total_detections != null && (
                                                                    <span style={{ color: "#64748b", fontSize: 9 }}>{rs.total_detections} det.</span>
                                                                )}
                                                                {scan.cloud_cover_percent != null && (
                                                                    <span style={{ color: "#334155", fontSize: 9 }}>{scan.cloud_cover_percent.toFixed(0)}% cloud</span>
                                                                )}
                                                            </div>
                                                            {isSelScan && (
                                                                <ScanDetailPanel
                                                                    zone={zone}
                                                                    scan={scan}
                                                                    onClose={() => setSelectedScan(prev => ({ ...prev, [zone.system_id]: null }))}
                                                                />
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {/* Detections from latest scan */}
                                        {latestScan?.result_summary?.total_detections > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                                                    Latest scan detections
                                                </div>
                                                {Object.entries(latestScan.result_summary.by_type || {}).map(([t, n]) => (
                                                    <span key={t} style={{ display: "inline-block", marginRight: 8, fontSize: 10 }}>
                                                        <span style={{ color: DET_COLORS[t] || "#94a3b8" }}>●</span>
                                                        <span style={{ color: "#64748b", marginLeft: 3 }}>{t.replace(/_/g, " ")}: {n}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </WorkspaceBody>
            {showCreate && (
                <CreateZoneModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { reload(); setShowCreate(false); setToast("Surveillance zone created. First scan scheduled."); setTimeout(() => setToast(""), 4000) }}
                />
            )}
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
        } catch (_e) {}
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
        } catch (_e) { setMsg("Upload failed") }
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

const ONTOLOGY_TYPE_COLORS = {
    vessel: "#60a5fa", aircraft: "#a78bfa", country: "#34d399", group: "#fb923c",
    event: "#f87171", cable: "#fbbf24", rule: "#94a3b8", alert: "#ef4444",
    person: "#e879f9", chokepoint: "#22d3ee", facility: "#38bdf8", port: "#fb7185",
    airport: "#c084fc", "escalation chain": "#f97316", "rule connection": "#5856D6",
}
const ONTOLOGY_TYPES = ["all", "vessel", "aircraft", "country", "group", "event", "cable", "rule", "escalation chain", "rule connection", "alert", "person", "chokepoint", "facility", "port", "airport"]
const ENTITY_TYPES   = ["country","chokepoint","group","person","vessel","aircraft","event","facility","cable","port","airport","rule","alert"]
const REL_TYPES      = ["operates_in","threatens","located_in","ally","adversary","monitors","connects","leads","sponsors","supports","rivals","relates_to"]

const inpS = { padding: "4px 6px", background: "#111827", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 3, color: "#cbd5e1", fontSize: 10 }
const selS = { ...inpS, padding: "4px" }

function AddEntityRow({ onAdd }) {
    const [name, setName] = useState("")
    const [type, setType] = useState("facility")
    const [desc, setDesc] = useState("")
    const [lat,  setLat]  = useState("")
    const [lng,  setLng]  = useState("")
    const submit = () => {
        if (!name.trim()) return
        onAdd({ label: name.trim(), type, description: desc, lat: lat ? parseFloat(lat) : null, lng: lng ? parseFloat(lng) : null })
        setName(""); setDesc(""); setLat(""); setLng("")
    }
    return (
        <div style={{ display: "flex", gap: 4, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.06)", flexWrap: "wrap" }}>
            <select value={type} onChange={e => setType(e.target.value)} style={{ ...selS, width: 90 }}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="Name *" style={{ ...inpS, flex: 2 }} />
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" style={{ ...inpS, flex: 2 }} />
            <input value={lat}  onChange={e => setLat(e.target.value)}  placeholder="Lat" style={{ ...inpS, width: 55 }} />
            <input value={lng}  onChange={e => setLng(e.target.value)}  placeholder="Lng" style={{ ...inpS, width: 55 }} />
            <button onClick={submit} style={{ padding: "4px 10px", borderRadius: 3, border: "none", background: "#60a5fa", color: "#0a0e1a", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>Add</button>
        </div>
    )
}

function EntitySelect({ nodes, value, onChange, placeholder }) {
    const [search,    setSearch]    = useState("")
    const [open,      setOpen]      = useState(false)
    const [collapsed, setCollapsed] = useState({})
    const ref = useRef(null)
    useEffect(() => {
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener("mousedown", close)
        return () => document.removeEventListener("mousedown", close)
    }, [])
    const grouped = {}
    nodes.forEach(n => { if (!grouped[n.type]) grouped[n.type] = []; grouped[n.type].push(n) })
    Object.values(grouped).forEach(arr => arr.sort((a, b) => (a.label || "").localeCompare(b.label || "")))
    const selected = nodes.find(n => n.id === value)
    const flat = search ? nodes.filter(n => (n.label || "").toLowerCase().includes(search.toLowerCase())) : null
    return (
        <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <button onClick={() => setOpen(o => !o)} style={{ width: "100%", padding: "4px 8px", background: "#111827", textAlign: "left", border: "1px solid rgba(148,163,184,0.08)", borderRadius: 3, color: selected ? "#cbd5e1" : "#475569", fontSize: 10, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected ? `${selected.label} (${selected.type})` : placeholder || "Select…"}
            </button>
            {open && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40, background: "#0f1219", border: "1px solid rgba(148,163,184,0.1)", borderRadius: 4, maxHeight: 240, overflow: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
                    <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                        style={{ width: "100%", padding: "6px 8px", background: "#111827", border: "none", borderBottom: "1px solid rgba(148,163,184,0.06)", color: "#cbd5e1", fontSize: 10, outline: "none", boxSizing: "border-box" }} />
                    {flat ? flat.slice(0, 40).map(n => (
                        <button key={n.id} onClick={() => { onChange(n.id); setOpen(false); setSearch("") }}
                            style={{ display: "block", width: "100%", padding: "4px 10px", border: "none", background: "transparent", color: "#cbd5e1", fontSize: 10, textAlign: "left", cursor: "pointer" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            {n.label} <span style={{ color: "#475569" }}>({n.type})</span>
                        </button>
                    )) : Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([type, items]) => (
                        <div key={type}>
                            <button onClick={() => setCollapsed(p => ({ ...p, [type]: !p[type] }))}
                                style={{ display: "block", width: "100%", padding: "3px 8px", border: "none", background: "rgba(148,163,184,0.03)", color: "#64748b", fontSize: 9, textAlign: "left", cursor: "pointer", textTransform: "uppercase", fontWeight: 600 }}>
                                {collapsed[type] ? "▶" : "▼"} {type} ({items.length})
                            </button>
                            {!collapsed[type] && items.map(n => (
                                <button key={n.id} onClick={() => { onChange(n.id); setOpen(false); setSearch("") }}
                                    style={{ display: "block", width: "100%", padding: "3px 10px 3px 20px", border: "none", background: "transparent", color: "#94a3b8", fontSize: 10, textAlign: "left", cursor: "pointer" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                    {n.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function AddConnectionRow({ nodes, onAdd }) {
    const [from, setFrom] = useState("")
    const [to,   setTo]   = useState("")
    const [rel,  setRel]  = useState("relates_to")
    const canLink = from && to && from !== to
    const submit = () => { if (canLink) { onAdd(from, to, rel); setFrom(""); setTo("") } }
    return (
        <div style={{ display: "flex", gap: 4, padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.06)", alignItems: "center" }}>
            <EntitySelect nodes={nodes} value={from} onChange={setFrom} placeholder="From…" />
            <select value={rel} onChange={e => setRel(e.target.value)} style={{ ...selS, width: 110, flexShrink: 0 }}>
                {REL_TYPES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <EntitySelect nodes={nodes} value={to} onChange={setTo} placeholder="To…" />
            <button onClick={submit} disabled={!canLink} style={{ padding: "4px 10px", borderRadius: 3, border: "none", background: canLink ? "#60a5fa" : "#1e293b", color: canLink ? "#0a0e1a" : "#475569", fontSize: 10, cursor: canLink ? "pointer" : "default", fontWeight: 600, flexShrink: 0 }}>Link</button>
        </div>
    )
}

const GRAPH_COLORS = {
    country: "#16a34a", chokepoint: "#dc2626", group: "#b91c1c", person: "#be185d",
    vessel: "#d97706", aircraft: "#2563eb", event: "#ea580c", facility: "#0d9488",
    cable: "#7c3aed", port: "#0891b2", airport: "#6d28d9", rule: "#ea580c", alert: "#dc2626",
    "escalation chain": "#f97316", "rule connection": "#5856D6",
}

const RULE_CONN_COLORS = {
    ESCALATION:  "#FF3B30",
    CORRELATION: "#34AADC",
    SEQUENCE:    "#FFCC00",
    SUPPRESSION: "#8E8E93",
}

const BOX_W = 160, BOX_H = 36, GAP_X = 60, GAP_Y = 8, PAD = 30
const TYPE_ORDER = ["country","group","person","chokepoint","facility","port","airport","cable","vessel","aircraft","event","rule","escalation chain","rule connection","alert"]

function OntologyGraph({ nodes, edges, onNodeClick, onDblClickNode, onRuleConnectRequest, onEdgeClick }) {
    const canvasRef          = useRef(null)
    const posRef             = useRef({})
    const nodesRef           = useRef(nodes)
    const edgesRef           = useRef(edges)
    const onClickRef         = useRef(onNodeClick)
    const onDblClickRef      = useRef(onDblClickNode)
    const onRuleConnectRef   = useRef(onRuleConnectRequest)
    const onEdgeClickRef     = useRef(onEdgeClick)
    const animRef            = useRef(null)
    const draggingRef        = useRef(null)
    const connectingRef      = useRef(null)   // {sourceNode, curX, curY} when drawing a live rule connection
    const panRef             = useRef({ x: 0, y: 0 })
    const zoomRef            = useRef(1)
    const panStartRef        = useRef(null)
    const selectedRef        = useRef(null)

    // Keep refs live — no loop restart needed when data changes
    useEffect(() => { onClickRef.current = onNodeClick },                 [onNodeClick])
    useEffect(() => { onDblClickRef.current = onDblClickNode },           [onDblClickNode])
    useEffect(() => { onRuleConnectRef.current = onRuleConnectRequest },  [onRuleConnectRequest])
    useEffect(() => { onEdgeClickRef.current = onEdgeClick },             [onEdgeClick])

    useEffect(() => {
        edgesRef.current = edges
    }, [edges])

    useEffect(() => {
        nodesRef.current = nodes
        // Assign default positions for any node not yet placed
        TYPE_ORDER.forEach((t, ci) => {
            nodes.filter(n => n.type === t).forEach((n, ri) => {
                if (!posRef.current[n.id])
                    posRef.current[n.id] = { x: PAD + ci * (BOX_W + GAP_X), y: PAD + 20 + ri * (BOX_H + GAP_Y) }
            })
        })
        nodes.filter(n => !TYPE_ORDER.includes(n.type)).forEach((n, i) => {
            if (!posRef.current[n.id])
                posRef.current[n.id] = { x: PAD + TYPE_ORDER.length * (BOX_W + GAP_X), y: PAD + 20 + i * (BOX_H + GAP_Y) }
        })
    }, [nodes])

    // Load saved positions once
    useEffect(() => {
        fetch(`${API}/api/forge/ontology/positions`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {})
            .then(saved => { posRef.current = { ...posRef.current, ...saved } })
            .catch(() => {})
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Draw loop — starts once, reads everything from refs
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const parent = canvas.parentElement
        const W = parent.clientWidth || 800
        const H = parent.clientHeight || 500
        canvas.width  = W * 2; canvas.height = H * 2
        canvas.style.width = W + "px"; canvas.style.height = H + "px"
        const ctx = canvas.getContext("2d")
        ctx.scale(2, 2)

        function draw() {
            const ns  = nodesRef.current
            const es  = edgesRef.current
            const pos = posRef.current
            const pan = panRef.current
            const zoom = zoomRef.current
            const selId = selectedRef.current

            ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, W, H)
            ctx.save()
            ctx.translate(pan.x, pan.y)
            ctx.scale(zoom, zoom)

            // Column headers
            TYPE_ORDER.forEach((t, ci) => {
                if (!ns.some(n => n.type === t)) return
                ctx.fillStyle = "#9ca3af"; ctx.font = "600 8px system-ui"; ctx.textAlign = "left"
                ctx.fillText(t.toUpperCase(), PAD + ci * (BOX_W + GAP_X), PAD + 10)
            })

            // Build selection sets
            const selConnected = new Set()
            const selEdgeIds   = new Set()
            if (selId) {
                for (const e of es) {
                    if (e.source === selId || e.target === selId) {
                        selConnected.add(e.source); selConnected.add(e.target)
                        selEdgeIds.add(e.id)
                    }
                }
            }

            // Edges
            for (const e of es) {
                const ap = pos[e.source], bp = pos[e.target]
                if (!ap || !bp) continue
                const fx = ap.x + BOX_W, fy = ap.y + BOX_H / 2
                const tx = bp.x,         ty = bp.y + BOX_H / 2
                const cpX = (fx + tx) / 2
                const isLit     = selId && selEdgeIds.has(e.id)
                const isRuleConn = !!e.isRuleConn
                const rcColor   = isRuleConn ? (RULE_CONN_COLORS[e.relationship_type] || "#5856D6") : null
                const srcNode   = ns.find(n => n.id === e.source)
                const color     = rcColor || (isLit ? (GRAPH_COLORS[srcNode?.type] || "#2563eb") : null)
                ctx.beginPath()
                ctx.moveTo(fx, fy)
                ctx.bezierCurveTo(cpX, fy, cpX, ty, tx, ty)
                ctx.strokeStyle = isRuleConn ? rcColor + "cc" : (isLit ? color + "cc" : "rgba(0,0,0,0.08)")
                ctx.lineWidth   = isRuleConn ? 2 : (isLit ? 2 : 0.8)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(tx, ty); ctx.lineTo(tx - 5, ty - 3); ctx.lineTo(tx - 5, ty + 3)
                ctx.closePath()
                ctx.fillStyle = isRuleConn ? rcColor + "cc" : (isLit ? color + "cc" : "rgba(0,0,0,0.08)"); ctx.fill()
                if (isRuleConn || (isLit && e.type)) {
                    const label = isRuleConn ? (e.relationship_type || "") : e.type.replace(/_/g, " ")
                    ctx.fillStyle = rcColor || "#6b7280"; ctx.font = "7px system-ui"; ctx.textAlign = "center"
                    ctx.fillText(label, cpX, Math.min(fy, ty) - 4)
                    ctx.textAlign = "left"
                }
            }

            // Live connection line (shift-drag mode)
            const conn = connectingRef.current
            if (conn) {
                const sp = pos[conn.sourceNode.id]
                if (sp) {
                    ctx.beginPath()
                    ctx.moveTo(sp.x + BOX_W, sp.y + BOX_H / 2)
                    ctx.lineTo(conn.curX, conn.curY)
                    ctx.strokeStyle = "#60a5fa"
                    ctx.lineWidth = 1.5
                    ctx.setLineDash([4, 3])
                    ctx.stroke()
                    ctx.setLineDash([])
                }
            }

            // Nodes
            for (const n of ns) {
                const p = pos[n.id]
                if (!p) continue
                const color = GRAPH_COLORS[n.type] || "#6b7280"
                const isSel  = n.id === selId
                const isConn = selId && selConnected.has(n.id) && !isSel
                const isDrag = draggingRef.current?.id === n.id
                const lit = isSel || isConn || isDrag
                ctx.fillStyle = "#ffffff"
                ctx.strokeStyle = isSel ? color : isConn ? color + "99" : "#d1d5db"
                ctx.lineWidth = isSel ? 2.5 : isConn ? 1.5 : 1
                ctx.beginPath(); ctx.roundRect(p.x, p.y, BOX_W, BOX_H, 3); ctx.fill(); ctx.stroke()
                ctx.fillStyle = color; ctx.globalAlpha = lit ? 1 : 0.7
                ctx.fillRect(p.x + 1, p.y + 4, 2, BOX_H - 8); ctx.globalAlpha = 1
                ctx.fillStyle = lit ? "#111827" : "#374151"
                ctx.font = `${isSel ? "600 " : ""}10px system-ui`; ctx.textAlign = "left"
                const lbl = (n.label || "").length > 19 ? (n.label || "").slice(0, 17) + "…" : (n.label || "")
                ctx.fillText(lbl, p.x + 10, p.y + 15)
                ctx.fillStyle = isSel || isConn ? color : "#9ca3af"
                ctx.font = "7px system-ui"; ctx.fillText(n.type, p.x + 10, p.y + 27)
                ctx.beginPath(); ctx.arc(p.x + BOX_W, p.y + BOX_H / 2, 3, 0, Math.PI * 2)
                ctx.fillStyle = "#e5e7eb"; ctx.fill()
                ctx.beginPath(); ctx.arc(p.x, p.y + BOX_H / 2, 3, 0, Math.PI * 2); ctx.fill()
            }

            ctx.restore()
            animRef.current = requestAnimationFrame(draw)
        }
        draw()

        function toCanvas(e) {
            const r = canvas.getBoundingClientRect()
            return { x: (e.clientX - r.left - panRef.current.x) / zoomRef.current,
                     y: (e.clientY - r.top  - panRef.current.y) / zoomRef.current }
        }
        function nodeAt(x, y) {
            for (const n of nodesRef.current) {
                const p = posRef.current[n.id]
                if (p && x >= p.x && x <= p.x + BOX_W && y >= p.y && y <= p.y + BOX_H) return n
            }
            return null
        }
        function edgeAt(x, y) {
            for (const e of edgesRef.current) {
                if (!e.isRuleConn) continue
                const ap = posRef.current[e.source], bp = posRef.current[e.target]
                if (!ap || !bp) continue
                const fx = ap.x + BOX_W, fy = ap.y + BOX_H / 2
                const tx = bp.x,         ty = bp.y + BOX_H / 2
                const cpX = (fx + tx) / 2
                for (let t2 = 0; t2 <= 1; t2 += 0.08) {
                    const bx = Math.pow(1-t2,3)*fx + 3*Math.pow(1-t2,2)*t2*cpX + 3*(1-t2)*Math.pow(t2,2)*cpX + Math.pow(t2,3)*tx
                    const by = Math.pow(1-t2,3)*fy + 3*Math.pow(1-t2,2)*t2*fy  + 3*(1-t2)*Math.pow(t2,2)*ty  + Math.pow(t2,3)*ty
                    if (Math.hypot(bx - x, by - y) < 8) return e
                }
            }
            return null
        }
        function onDown(e) {
            const { x, y } = toCanvas(e)
            const n = nodeAt(x, y)
            if (n && e.shiftKey && n.type === "rule") {
                connectingRef.current = { sourceNode: n, curX: x, curY: y }
                canvas.style.cursor = "crosshair"
            } else if (n) {
                const p = posRef.current[n.id]
                draggingRef.current = { id: n.id, ox: x - p.x, oy: y - p.y }
            } else {
                panStartRef.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
            }
        }
        function onMove(e) {
            if (connectingRef.current) {
                const { x, y } = toCanvas(e)
                connectingRef.current.curX = x; connectingRef.current.curY = y
                const t = nodeAt(x, y)
                canvas.style.cursor = (t && t.type === "rule" && t.id !== connectingRef.current.sourceNode.id) ? "cell" : "crosshair"
                return
            }
            if (draggingRef.current) {
                const { x, y } = toCanvas(e)
                posRef.current[draggingRef.current.id] = { x: x - draggingRef.current.ox, y: y - draggingRef.current.oy }
            } else if (panStartRef.current) {
                panRef.current = { x: panStartRef.current.px + e.clientX - panStartRef.current.mx,
                                   y: panStartRef.current.py + e.clientY - panStartRef.current.my }
            } else {
                canvas.style.cursor = nodeAt(...Object.values(toCanvas(e))) ? "pointer" : "grab"
            }
        }
        function savePos() {
            fetch(`${API}/api/forge/ontology/positions`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify(posRef.current) }).catch(() => {})
        }
        function onUp(e) {
            if (connectingRef.current) {
                const { x, y } = toCanvas(e)
                const target = nodeAt(x, y)
                if (target && target.type === "rule" && target.id !== connectingRef.current.sourceNode.id) {
                    if (onRuleConnectRef.current) onRuleConnectRef.current(connectingRef.current.sourceNode, target)
                }
                connectingRef.current = null
                canvas.style.cursor = "grab"
                return
            }
            if (draggingRef.current) savePos()
            draggingRef.current = null; panStartRef.current = null
        }
        function onClick(e) {
            if (connectingRef.current) return
            const { x, y } = toCanvas(e)
            const n = nodeAt(x, y)
            if (n) { selectedRef.current = selectedRef.current === n.id ? null : n.id; onClickRef.current(n) }
            else {
                const edge = edgeAt(x, y)
                if (edge && onEdgeClickRef.current) { onEdgeClickRef.current(edge, false) }
                else selectedRef.current = null
            }
        }
        function onDblClick(e) {
            const { x, y } = toCanvas(e)
            const n = nodeAt(x, y)
            if (n && onDblClickRef.current) onDblClickRef.current(n)
        }
        function onContextMenu(e) {
            const { x, y } = toCanvas(e)
            const edge = edgeAt(x, y)
            if (edge && onEdgeClickRef.current) {
                e.preventDefault()
                onEdgeClickRef.current(edge, true)  // true = right-click (delete intent)
            }
        }
        function onWheel(e) {
            e.preventDefault()
            zoomRef.current = Math.max(0.2, Math.min(3, zoomRef.current * (e.deltaY > 0 ? 0.95 : 1.05)))
        }
        canvas.addEventListener("mousedown",     onDown)
        canvas.addEventListener("mousemove",     onMove)
        canvas.addEventListener("mouseup",       onUp)
        canvas.addEventListener("mouseleave",    onUp)
        canvas.addEventListener("click",         onClick)
        canvas.addEventListener("dblclick",      onDblClick)
        canvas.addEventListener("wheel",         onWheel, { passive: false })
        canvas.addEventListener("contextmenu",   onContextMenu)
        return () => {
            cancelAnimationFrame(animRef.current)
            canvas.removeEventListener("mousedown",     onDown)
            canvas.removeEventListener("mousemove",     onMove)
            canvas.removeEventListener("mouseup",       onUp)
            canvas.removeEventListener("mouseleave",    onUp)
            canvas.removeEventListener("click",         onClick)
            canvas.removeEventListener("dblclick",      onDblClick)
            canvas.removeEventListener("wheel",         onWheel)
            canvas.removeEventListener("contextmenu",   onContextMenu)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    if (!nodes.length) return <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: 40 }}>No entities to visualize.</div>
    return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
}

function DefineConnectionModal({ nodeA, nodeB, existing, onClose, onSave }) {
    const [connName,    setConnName]    = useState(existing?.connection_name || `${nodeA?.label || "?"} ↔ ${nodeB?.label || "?"}`)
    const [relType,     setRelType]     = useState(existing?.relationship_type || "ESCALATION")
    const [escSev,      setEscSev]      = useState(existing?.escalated_severity || "critical")
    const [escIcon,     setEscIcon]     = useState(existing?.escalated_icon_type || "ESCALATED_DUAL")
    const [seqWin,      setSeqWin]      = useState(existing?.sequence_window_minutes ?? 30)
    const [suppWin,     setSuppWin]     = useState(existing?.suppression_window_minutes ?? 30)
    const [timeWin,     setTimeWin]     = useState(existing?.time_window_minutes ?? 30)
    const [notes,       setNotes]       = useState(existing?.notes || "")
    const [saving,      setSaving]      = useState(false)

    const relColors = { ESCALATION: "#FF3B30", CORRELATION: "#34AADC", SEQUENCE: "#FFCC00", SUPPRESSION: "#8E8E93" }

    const save = async () => {
        setSaving(true)
        try {
            const body = {
                connection_name: connName,
                rule_id_a: existing ? existing.rule_id_a : parseInt(nodeA.id.replace(/\D/g, "") || 0),
                rule_id_b: existing ? existing.rule_id_b : parseInt(nodeB.id.replace(/\D/g, "") || 0),
                relationship_type: relType,
                time_window_minutes: parseInt(timeWin) || 30,
                notes,
                ...(relType === "ESCALATION"  ? { escalated_severity: escSev, escalated_icon_type: escIcon } : {}),
                ...(relType === "SEQUENCE"    ? { sequence_window_minutes: parseInt(seqWin) || 30 } : {}),
                ...(relType === "SUPPRESSION" ? { suppression_window_minutes: parseInt(suppWin) || 30 } : {}),
            }
            const url    = existing ? `${API}/api/rule-connections/${existing.id}` : `${API}/api/rule-connections`
            const method = existing ? "PUT" : "POST"
            const res    = await fetch(url, { method, headers: forgeHeaders(), body: JSON.stringify(body) })
            const d = await res.json()
            if (res.ok) onSave(d)
        } catch (_e) {}
        finally { setSaving(false) }
    }

    const relColor = relColors[relType] || "#5856D6"
    const fld = (label, ctrl) => (
        <div style={{ marginBottom: 10 }}>
            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 3 }}>{label}</label>
            {ctrl}
        </div>
    )

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div style={{ background: "#0f1219", border: `1px solid ${relColor}44`, borderRadius: 6, padding: 22, width: 440, maxHeight: "84vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
                    {existing ? "Edit" : "Define"} Rule Connection
                    {nodeA && nodeB && <span style={{ fontSize: 11, color: "#475569", fontWeight: 400, marginLeft: 8 }}>{nodeA.label} → {nodeB.label}</span>}
                </div>
                {fld("Connection Name", <input value={connName} onChange={e => setConnName(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                {fld("Relationship Type", (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["ESCALATION","CORRELATION","SEQUENCE","SUPPRESSION"].map(rt => (
                            <button key={rt} onClick={() => setRelType(rt)} style={{ padding: "4px 10px", borderRadius: 3, border: `1px solid ${relColors[rt]}66`, background: relType === rt ? relColors[rt] + "22" : "transparent", color: relType === rt ? relColors[rt] : "#475569", fontSize: 10, cursor: "pointer", fontWeight: relType === rt ? 700 : 400 }}>{rt}</button>
                        ))}
                    </div>
                ))}
                <div style={{ marginBottom: 10, padding: "6px 10px", background: "rgba(148,163,184,0.05)", borderRadius: 3, border: `1px solid ${relColor}33`, color: "#64748b", fontSize: 10 }}>
                    {relType === "ESCALATION"  && "Both rules fire on same vessel within time window → emit one escalated alert."}
                    {relType === "CORRELATION" && "Both rules fire on same vessel → tag both alerts as correlated (no suppression)."}
                    {relType === "SEQUENCE"    && "Suppress rule B if rule A hasn't fired on the same vessel within the window."}
                    {relType === "SUPPRESSION" && "Suppress rule B whenever rule A fires on the same vessel."}
                </div>
                {fld("Time Window (minutes)", <input type="number" value={timeWin} onChange={e => setTimeWin(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                {relType === "ESCALATION" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <div>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 3 }}>Escalated Severity</label>
                            <select value={escSev} onChange={e => setEscSev(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                {["medium","high","critical"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 3 }}>Icon Type</label>
                            <input value={escIcon} onChange={e => setEscIcon(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        </div>
                    </div>
                )}
                {relType === "SEQUENCE" && fld("Sequence Window (minutes)", <input type="number" value={seqWin} onChange={e => setSeqWin(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                {relType === "SUPPRESSION" && fld("Suppression Window (minutes)", <input type="number" value={suppWin} onChange={e => setSuppWin(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                {fld("Notes (optional)", <input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />)}
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 14 }}>
                    <button onClick={onClose} style={ghostBtn}>Cancel</button>
                    <button onClick={save} disabled={!connName || saving} style={{ padding: "6px 16px", borderRadius: 3, border: "none", background: connName && !saving ? relColor : "#1e293b", color: connName && !saving ? "#fff" : "#475569", cursor: connName && !saving ? "pointer" : "default", fontSize: 11, fontWeight: 600 }}>
                        {saving ? "Saving…" : existing ? "Update" : "Create"}
                    </button>
                </div>
            </div>
        </div>
    )
}

function EditNodeModal({ en, nodes, edges, onClose, onDeleteEntity, onDeleteConnection, onAddConnection }) {
    const [showAdd, setShowAdd] = useState(false)
    const [to,      setTo]      = useState("")
    const [rel,     setRel]     = useState("relates_to")
    const typeColor = ONTOLOGY_TYPE_COLORS[en.type] || "#475569"
    const connEdges = edges.filter(e => e.source === en.id || e.target === en.id)
    const otherNodes = nodes.filter(n => n.id !== en.id)
    const submitConn = () => {
        if (!to) return
        onAddConnection(en.id, to, rel)
        setTo(""); setShowAdd(false)
    }
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={onClose}>
            <div style={{ background: "#111827", border: "1px solid rgba(148,163,184,0.12)", borderRadius: 10, width: 420, maxHeight: "82vh", overflow: "auto", padding: 20 }}
                onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <span style={{ padding: "2px 8px", borderRadius: 10, background: typeColor + "22", color: typeColor, fontSize: 10, fontWeight: 700 }}>{en.type}</span>
                    <span style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, flex: 1 }}>{en.label || en.id}</span>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                </div>
                {en.description && <div style={{ color: "#64748b", fontSize: 11, marginBottom: 14, lineHeight: 1.5 }}>{en.description}</div>}
                {(en.lat != null || en.lng != null) && (
                    <div style={{ color: "#475569", fontSize: 10, marginBottom: 14 }}>{en.lat?.toFixed(4)}, {en.lng?.toFixed(4)}</div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Connections ({connEdges.length})</div>
                    <button onClick={() => setShowAdd(v => !v)} style={{ padding: "2px 8px", borderRadius: 3, border: "1px solid rgba(96,165,250,0.3)", background: showAdd ? "rgba(96,165,250,0.12)" : "transparent", color: "#60a5fa", fontSize: 10, cursor: "pointer" }}>
                        {showAdd ? "Cancel" : "+ Add"}
                    </button>
                </div>

                {showAdd && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
                        <EntitySelect nodes={otherNodes} value={to} onChange={setTo} placeholder="Connect to…" />
                        <select value={rel} onChange={e => setRel(e.target.value)} style={{ ...selS, width: 110, flexShrink: 0 }}>
                            {REL_TYPES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                        </select>
                        <button onClick={submitConn} disabled={!to} style={{ padding: "4px 10px", borderRadius: 3, border: "none", background: to ? "#60a5fa" : "#1e293b", color: to ? "#0a0e1a" : "#475569", fontSize: 10, cursor: to ? "pointer" : "default", fontWeight: 600, flexShrink: 0 }}>Link</button>
                    </div>
                )}

                {connEdges.length === 0 && !showAdd && <div style={{ color: "#334155", fontSize: 11, marginBottom: 12 }}>No connections</div>}
                {connEdges.map(e => {
                    const otherId = e.source === en.id ? e.target : e.source
                    const other = nodes.find(n => n.id === otherId)
                    const dir = e.source === en.id ? "→" : "←"
                    return (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", borderRadius: 4, background: "#0d1422", marginBottom: 3 }}>
                            <span style={{ color: "#64748b", fontSize: 10 }}>
                                {dir} <span style={{ color: "#60a5fa" }}>{other?.label || otherId}</span>
                                {e.type && <span style={{ color: "#334155" }}> · {e.type.replace(/_/g, " ")}</span>}
                            </span>
                            <button onClick={() => onDeleteConnection(e.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 11, padding: "0 4px" }}>✕</button>
                        </div>
                    )
                })}
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.08)", marginTop: 16, paddingTop: 12 }}>
                    <button onClick={() => onDeleteEntity(en.id)}
                        style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        Delete Entity
                    </button>
                </div>
            </div>
        </div>
    )
}

function OntologyWorkspace() {
    const [nodes,        setNodes]        = useState([])
    const [edges,        setEdges]        = useState([])
    const [ruleConns,    setRuleConns]    = useState([])   // RuleConnection rows from /api/rule-connections
    const [loaded,       setLoaded]       = useState(false)
    const [search,       setSearch]       = useState("")
    const [typeFilter,   setTypeFilter]   = useState("all")
    const [building,     setBuilding]     = useState(false)
    const [buildMsg,     setBuildMsg]     = useState(null)
    const [selectedNode, setSelectedNode] = useState(null)
    const [editNode,     setEditNode]     = useState(null)
    const [showAdd,      setShowAdd]      = useState(false)
    const [showLink,     setShowLink]     = useState(false)
    const [view,         setView]         = useState("table")
    // Drag-to-connect state
    const [pendingConnect, setPendingConnect] = useState(null)  // {nodeA, nodeB}
    const [editConn,       setEditConn]       = useState(null)  // RuleConnection being edited

    const loadOntology = () =>
        fetch(`${API}/api/forge/ontology`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { nodes: [], edges: [] })
            .then(d => { setNodes(d.nodes || []); setEdges(d.edges || []); setLoaded(true) })
            .catch(() => { setLoaded(true) })

    const loadRuleConns = () =>
        fetch(`${API}/api/rule-connections`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setRuleConns(Array.isArray(d) ? d : []))
            .catch(() => {})

    useEffect(() => { loadOntology(); loadRuleConns() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Merge rule connections into the edges array for OntologyGraph rendering
    const allEdges = [
        ...edges,
        ...ruleConns.map(rc => ({
            id:                `ruleconn-${rc.id}`,
            source:            `RULE-${rc.rule_id_a}`,
            target:            `RULE-${rc.rule_id_b}`,
            type:              rc.relationship_type,
            isRuleConn:        true,
            ruleConnId:        rc.id,
            relationship_type: rc.relationship_type,
            connection_name:   rc.connection_name,
        })),
    ]

    const buildOntology = async () => {
        setBuilding(true); setBuildMsg(null)
        try {
            const res = await fetch(`${API}/api/forge/ontology/build`, { method: "POST", headers: forgeHeaders() })
            const d = await res.json()
            if (res.ok) {
                setBuildMsg(`Built: ${d.nodes} entities · ${d.edges} connections`)
                await loadOntology()
            } else {
                setBuildMsg(`Error: ${d.detail || "Build failed"}`)
            }
        } catch (e) {
            setBuildMsg(`Error: ${e.message}`)
        } finally {
            setBuilding(false)
        }
    }

    const addEntity = async (entity) => {
        try {
            const res = await fetch(`${API}/api/forge/ontology/node`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify(entity) })
            const node = await res.json()
            setNodes(prev => [...prev, node])
        } catch (_e) {}
    }

    const deleteEntity = async (nodeId, e) => {
        e?.stopPropagation()
        try {
            await fetch(`${API}/api/forge/ontology/node/${nodeId}`, { method: "DELETE", headers: forgeHeaders() })
            setNodes(prev => prev.filter(n => n.id !== nodeId))
            setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId))
            if (selectedNode?.id === nodeId) setSelectedNode(null)
        } catch (_e) {}
    }

    const addConnection = async (fromId, toId, type) => {
        try {
            const res = await fetch(`${API}/api/forge/ontology/edge`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ source: fromId, target: toId, type }) })
            const edge = await res.json()
            setEdges(prev => [...prev, edge])
        } catch (_e) {}
    }

    const deleteConnection = async (edgeId) => {
        try {
            await fetch(`${API}/api/forge/ontology/edge/${edgeId}`, { method: "DELETE", headers: forgeHeaders() })
            setEdges(prev => prev.filter(e => e.id !== edgeId))
        } catch (_e) {}
    }

    const edgeCounts = {}
    for (const e of edges) {
        edgeCounts[e.source] = (edgeCounts[e.source] || 0) + 1
        edgeCounts[e.target] = (edgeCounts[e.target] || 0) + 1
    }

    const filtered = nodes.filter(n => {
        if (typeFilter !== "all" && n.type !== typeFilter) return false
        if (search && !(n.label || n.id || "").toLowerCase().includes(search.toLowerCase())) return false
        return true
    })

    // Group filtered nodes by type for the "all" view; prioritise cable/rule at top
    const TYPE_PRIORITY = { cable: 0, rule: 1, "escalation chain": 2, "rule connection": 3, chokepoint: 4, country: 5, group: 6, person: 7, vessel: 8, aircraft: 9, event: 10, alert: 11 }
    const groupedFiltered = (() => {
        if (typeFilter !== "all") return null
        const groups = {}
        for (const n of filtered) {
            if (!groups[n.type]) groups[n.type] = []
            groups[n.type].push(n)
        }
        return Object.entries(groups).sort(([a], [b]) => (TYPE_PRIORITY[a] ?? 99) - (TYPE_PRIORITY[b] ?? 99))
    })()

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities…" style={{ ...inputStyle, flex: 1, maxWidth: 200 }} />
                <div style={{ display: "flex", gap: 2, background: "#0a0e1a", borderRadius: 4, padding: 2 }}>
                    {["table", "graph"].map(v => (
                        <button key={v} onClick={() => setView(v)} style={{ padding: "3px 10px", borderRadius: 3, border: "none", cursor: "pointer", background: view === v ? "rgba(96,165,250,0.12)" : "transparent", color: view === v ? "#60a5fa" : "#475569", fontSize: 10, fontWeight: view === v ? 600 : 400 }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                    ))}
                </div>
                <button onClick={() => { setShowAdd(v => !v); setShowLink(false) }} style={{ padding: "5px 10px", borderRadius: 5, border: "none", background: showAdd ? "#60a5fa" : "#1e293b", color: showAdd ? "#0f172a" : "#94a3b8", fontWeight: 600, cursor: "pointer", fontSize: 10 }}>+ Entity</button>
                <button onClick={() => { setShowLink(v => !v); setShowAdd(false) }} style={{ padding: "5px 10px", borderRadius: 5, border: "none", background: showLink ? "#60a5fa" : "#1e293b", color: showLink ? "#0f172a" : "#94a3b8", fontWeight: 600, cursor: "pointer", fontSize: 10 }}>+ Link</button>
                <button onClick={buildOntology} disabled={building} style={{ padding: "5px 12px", borderRadius: 5, border: "none", background: building ? "#1e293b" : "#334155", color: building ? "#475569" : "#94a3b8", fontWeight: 600, cursor: building ? "default" : "pointer", fontSize: 10 }}>
                    {building ? "Building…" : "Build"}
                </button>
                <span style={{ color: "#334155", fontSize: 10 }}>{nodes.length} · {edges.length}</span>
                {buildMsg && <span style={{ color: buildMsg.startsWith("Error") ? "#f87171" : "#4ade80", fontSize: 10 }}>{buildMsg}</span>}
            </Toolbar>
            {(showAdd || showLink) && (
                <div style={{ padding: "4px 12px", borderBottom: "1px solid rgba(148,163,184,0.06)", background: "#080c16" }}>
                    {showAdd  && <AddEntityRow     onAdd={entity => addEntity(entity)} />}
                    {showLink && <AddConnectionRow nodes={nodes} onAdd={(f, t, r) => addConnection(f, t, r)} />}
                </div>
            )}
            {view === "table" && (
                <div style={{ display: "flex", gap: 4, padding: "6px 12px", flexWrap: "wrap", borderBottom: "1px solid rgba(148,163,184,0.06)" }}>
                    {ONTOLOGY_TYPES.map(t => (
                        <button key={t} onClick={() => setTypeFilter(t)} style={{ padding: "2px 8px", borderRadius: 10, border: "1px solid " + (typeFilter === t ? (ONTOLOGY_TYPE_COLORS[t] || "#60a5fa") : "rgba(148,163,184,0.15)"), background: typeFilter === t ? (ONTOLOGY_TYPE_COLORS[t] || "#60a5fa") + "22" : "transparent", color: typeFilter === t ? (ONTOLOGY_TYPE_COLORS[t] || "#60a5fa") : "#475569", fontSize: 10, cursor: "pointer", fontWeight: typeFilter === t ? 700 : 400 }}>{t}</button>
                    ))}
                </div>
            )}
            <WorkspaceBody style={view === "graph" ? { padding: 0, overflow: "hidden" } : {}}>
                {!loaded ? <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div> :
                view === "graph" ? <OntologyGraph
                    nodes={nodes} edges={allEdges}
                    onNodeClick={setSelectedNode}
                    onDblClickNode={n => { setEditNode(n); setSelectedNode(n) }}
                    onRuleConnectRequest={(nA, nB) => {
                        // Resolve rule_id from node id (format "RULE-N")
                        const getNumericId = n => {
                            const m = (n.id || "").match(/(\d+)$/)
                            return m ? parseInt(m[1]) : null
                        }
                        const ridA = getNumericId(nA), ridB = getNumericId(nB)
                        if (ridA && ridB) setPendingConnect({ nodeA: { ...nA, _rid: ridA }, nodeB: { ...nB, _rid: ridB } })
                    }}
                    onEdgeClick={(edge, isRightClick) => {
                        if (!edge.isRuleConn) return
                        const rc = ruleConns.find(r => r.id === edge.ruleConnId)
                        if (!rc) return
                        if (isRightClick) {
                            if (confirm(`Delete rule connection "${rc.connection_name}"?`)) {
                                fetch(`${API}/api/rule-connections/${rc.id}`, { method: "DELETE", headers: forgeHeaders() })
                                    .then(() => loadRuleConns())
                                    .catch(() => {})
                            }
                        } else {
                            setEditConn(rc)
                        }
                    }}
                /> :
                filtered.length === 0 ? (
                    <div style={{ color: "#334155", fontSize: 12, textAlign: "center", padding: 40 }}>
                        {nodes.length === 0 ? "No entities yet — click Build to populate from live data, or + Entity to add manually." : `No ${typeFilter === "all" ? "" : typeFilter + " "}entities match.`}
                    </div>
                ) : (() => {
                    const NodeRow = ({ n }) => {
                        const typeColor = ONTOLOGY_TYPE_COLORS[n.type] || "#475569"
                        const connCount = edgeCounts[n.id] || 0
                        const isSelected = selectedNode?.id === n.id
                        return (
                            <tr key={n.id}
                                onClick={() => setSelectedNode(isSelected ? null : n)}
                                style={{ borderBottom: "1px solid rgba(148,163,184,0.03)", cursor: "pointer", background: isSelected ? "#0d1422" : "transparent" }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#0a0f1a" }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent" }}>
                                <td style={cellStyle}>
                                    <span style={{ padding: "1px 6px", borderRadius: 8, background: typeColor + "22", color: typeColor, fontSize: 9, fontWeight: 600 }}>{n.type || "—"}</span>
                                </td>
                                <td style={{ ...cellStyle, color: "#cbd5e1", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label || n.id || "—"}</td>
                                <td style={{ ...cellStyle, color: "#475569", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.description || "—"}</td>
                                <td style={cellStyle}>{n.lat != null ? n.lat.toFixed(2) : "—"}</td>
                                <td style={cellStyle}>{n.lng != null ? n.lng.toFixed(2) : "—"}</td>
                                <td style={{ ...cellStyle, color: connCount > 0 ? "#60a5fa" : "#334155" }}>{connCount || "—"}</td>
                                <td style={cellStyle}>
                                    <button onClick={e => deleteEntity(n.id, e)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 11, padding: "0 4px", lineHeight: 1 }} title="Delete entity">✕</button>
                                </td>
                            </tr>
                        )
                    }
                    const thead = (
                        <thead>
                            <tr style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                                {["Type", "Name", "Description", "Lat", "Lng", "Conn", ""].map(h => (
                                    <th key={h} style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", textAlign: "left", padding: "5px 8px", fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                    )
                    if (groupedFiltered) {
                        // Grouped view: one section per entity type
                        return (
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                {thead}
                                <tbody>
                                    {groupedFiltered.map(([type, items]) => {
                                        const typeColor = ONTOLOGY_TYPE_COLORS[type] || "#475569"
                                        return [
                                            <tr key={`hdr-${type}`}>
                                                <td colSpan={7} style={{ padding: "8px 8px 4px", borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                                                    <span style={{ padding: "2px 8px", borderRadius: 8, background: typeColor + "22", color: typeColor, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{type}</span>
                                                    <span style={{ color: "#334155", fontSize: 9, marginLeft: 6 }}>{items.length} {items.length === 1 ? "entry" : "entries"}</span>
                                                </td>
                                            </tr>,
                                            ...items.slice(0, 300).map(n => <NodeRow key={n.id} n={n} />),
                                        ]
                                    })}
                                </tbody>
                            </table>
                        )
                    }
                    return (
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            {thead}
                            <tbody>
                                {filtered.slice(0, 300).map(n => <NodeRow key={n.id} n={n} />)}
                            </tbody>
                        </table>
                    )
                })()}
            </WorkspaceBody>
            {selectedNode && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.08)", padding: "10px 14px", background: "#080c16", maxHeight: 180, overflowY: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: (ONTOLOGY_TYPE_COLORS[selectedNode.type] || "#475569") + "22", color: ONTOLOGY_TYPE_COLORS[selectedNode.type] || "#475569", fontSize: 10, fontWeight: 700 }}>{selectedNode.type}</span>
                        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{selectedNode.label || selectedNode.id}</span>
                        {selectedNode.description && <span style={{ color: "#475569", fontSize: 10 }}>{selectedNode.description}</span>}
                        <button onClick={() => setSelectedNode(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13 }}>✕</button>
                    </div>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", marginBottom: 4 }}>Connections</div>
                    {edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).map(e => {
                        const otherId = e.source === selectedNode.id ? e.target : e.source
                        const other = nodes.find(n => n.id === otherId)
                        return (
                            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.03)" }}>
                                <span style={{ color: "#94a3b8", fontSize: 10 }}>{(e.type || "").replace(/_/g, " ")} → <span style={{ color: "#60a5fa" }}>{other?.label || otherId}</span></span>
                                <button onClick={() => deleteConnection(e.id)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 10, padding: "0 4px" }}>✕</button>
                            </div>
                        )
                    })}
                    {edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).length === 0 && (
                        <div style={{ color: "#1e293b", fontSize: 10 }}>No connections</div>
                    )}
                </div>
            )}
            {editNode && (
                <EditNodeModal
                    en={nodes.find(n => n.id === editNode.id) || editNode}
                    nodes={nodes}
                    edges={edges}
                    onClose={() => setEditNode(null)}
                    onDeleteEntity={id => { deleteEntity(id); setEditNode(null) }}
                    onDeleteConnection={deleteConnection}
                    onAddConnection={addConnection}
                />
            )}
            {pendingConnect && (
                <DefineConnectionModal
                    nodeA={pendingConnect.nodeA}
                    nodeB={pendingConnect.nodeB}
                    existing={null}
                    onClose={() => setPendingConnect(null)}
                    onSave={d => { loadRuleConns(); setPendingConnect(null) }}
                />
            )}
            {editConn && (
                <DefineConnectionModal
                    nodeA={null}
                    nodeB={null}
                    existing={editConn}
                    onClose={() => setEditConn(null)}
                    onSave={d => { loadRuleConns(); setEditConn(null) }}
                />
            )}
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
