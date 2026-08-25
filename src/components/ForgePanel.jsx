import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import PipelineCanvas, { TYPE_COLORS, STATUS_DOT } from "./forge/PipelineCanvas.jsx"
import { ALERT_ICONS, NEWS_PATTERN_ICON_KEYS } from "../constants/alertIcons.js"
import { esriSatelliteProvider } from "../globe/imageryProviders.js"
import ForceGraph from "./forge/ForceGraph.jsx"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { locateReportClaim } from "../services/reportDeepLink.js"

const API = API_BASE

function forgeHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
    }
}
function forgeFormHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
    }
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
    { id: 'int_rule_logic',  label: 'Rule Logic',            column: 3, type: 'intelligence', status: 'active',     config: {} },
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
    enr_correlation: 'correlation-engine', enr_ontology: 'ontology', enr_geocode: 'geocoder',
    int_threat: 'brain', int_patterns: 'brain', int_escalation: 'brain', int_rule_logic: 'rule-logic',
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
// ── Rule Logic Canvas ──────────────────────────────────────────────────────────

const DOMAIN_COLORS = {
    ais:        "#34AADC",
    adsb:       "#5856D6",
    sentinel:   "#30D158",
    news:       "#FF9500",
    chokepoint: "#FFCC00",
}

const EDGE_COLORS = {
    ESCALATION:  "#FF3B30",
    CORRELATION: "#34AADC",
    SEQUENCE:    "#FFCC00",
    SUPPRESSION: "#8E8E93",
}

const NODE_W = 164
const NODE_H = 88
const COL_X  = [40, 240, 440, 640, 840]
const STORAGE_KEY = "forge-rule-logic-positions"

const DOMAIN_ORDER = ["ais", "adsb", "sentinel", "news", "chokepoint"]

function getDomain(rule) {
    const s = ((rule.rule_name || "") + " " + (rule.trigger_type || "") + " " + (rule.name || "")).toLowerCase()
    if (s.includes("adsb") || s.includes("aircraft") || s.includes("squawk")) return "adsb"
    if (s.includes("sentinel") || s.includes("satellite") || s.includes("overwatch") || s.includes("ml")) return "sentinel"
    if (s.includes("news") || s.includes("keyword") || s.includes("rss") || s.includes("article")) return "news"
    if (s.includes("chokepoint") || s.includes("strait")) return "chokepoint"
    return "ais"
}

function defaultPositions(rules) {
    const cols = Object.fromEntries(DOMAIN_ORDER.map(d => [d, []]))
    rules.forEach(r => cols[getDomain(r)].push(r))
    const pos = {}
    DOMAIN_ORDER.forEach((dom, ci) => {
        cols[dom].forEach((r, ri) => {
            pos[r.id] = { x: COL_X[ci], y: 50 + ri * (NODE_H + 28) }
        })
    })
    return pos
}

function loadPositions() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") } catch (_) { return {} }
}

function savePositions(pos) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)) } catch (_) {}
}

function edgePlainEnglish(conn) {
    const a = conn.rule_name_a || `Rule ${conn.rule_id_a}`
    const b = conn.rule_name_b || `Rule ${conn.rule_id_b}`
    const tw = conn.time_window_minutes ?? 30
    const sw = conn.sequence_window_minutes ?? 30
    const supW = conn.suppression_window_minutes ?? 30
    switch (conn.relationship_type) {
        case "ESCALATION":
            return `When both rules fire on the same vessel within ${tw}min, individual alerts are suppressed and a single combined ${conn.escalated_severity || "high"} alert fires instead.`
        case "CORRELATION":
            return `When both rules fire on the same vessel within ${tw}min, the alerts are flagged as correlated. No new alert fires but both are linked.`
        case "SEQUENCE":
            return `Rule B (${b}) will only fire if Rule A (${a}) has already fired for the same vessel within the past ${sw}min.`
        case "SUPPRESSION":
            return `When ${a} fires, ${b} is silenced for ${supW}min to prevent duplicate noise.`
        default:
            return ""
    }
}

function ConnModal({ rules, editConn, defaultFrom, defaultTo, onClose, onSaved }) {
    const [name,      setName]      = useState(editConn?.connection_name ?? "")
    const [ruleA,     setRuleA]     = useState(editConn?.rule_id_a ?? defaultFrom ?? "")
    const [ruleB,     setRuleB]     = useState(editConn?.rule_id_b ?? defaultTo ?? "")
    const [relType,   setRelType]   = useState(editConn?.relationship_type ?? "ESCALATION")
    const [twMin,     setTwMin]     = useState(editConn?.time_window_minutes ?? 30)
    const [seqMin,    setSeqMin]    = useState(editConn?.sequence_window_minutes ?? 30)
    const [supMin,    setSupMin]    = useState(editConn?.suppression_window_minutes ?? 30)
    const [escSev,    setEscSev]    = useState(editConn?.escalated_severity ?? "critical")
    const [escIcon,   setEscIcon]   = useState(editConn?.escalated_icon_type ?? "")
    const [notes,     setNotes]     = useState(editConn?.notes ?? "")
    const [saving,    setSaving]    = useState(false)

    const ruleNameA = rules.find(r => r.id === Number(ruleA))
    const ruleNameB = rules.find(r => r.id === Number(ruleB))
    const autoName  = ruleNameA && ruleNameB
        ? `${ruleNameA.name || ruleNameA.rule_name} → ${ruleNameB.name || ruleNameB.rule_name}`
        : ""

    async function handleSave() {
        if (!ruleA || !ruleB || ruleA === ruleB) return
        setSaving(true)
        const body = {
            connection_name:            name || autoName || "Connection",
            rule_id_a:                  Number(ruleA),
            rule_id_b:                  Number(ruleB),
            relationship_type:          relType,
            time_window_minutes:        Number(twMin),
            sequence_window_minutes:    relType === "SEQUENCE"    ? Number(seqMin)  : null,
            suppression_window_minutes: relType === "SUPPRESSION" ? Number(supMin)  : null,
            escalated_severity:         relType === "ESCALATION"  ? escSev          : null,
            escalated_icon_type:        relType === "ESCALATION"  ? (escIcon || null) : null,
            notes: notes || null,
        }
        const url = editConn
            ? `${API}/api/rule-connections/${editConn.id}`
            : `${API}/api/rule-connections`
        const method = editConn ? "PUT" : "POST"
        try {
            const r = await fetch(url, { method, headers: { ...forgeHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) })
            if (r.ok) { const d = await r.json(); onSaved(d) }
        } catch (_) {}
        setSaving(false)
    }

    const inp = { ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }
    const lbl = { color: "#475569", fontSize: 10, marginBottom: 3, display: "block" }

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
            <div style={{ position: "relative", background: "#0d1425", border: "1px solid rgba(148,163,184,0.1)", borderRadius: 10, padding: "20px 22px", width: 380, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", zIndex: 1 }}>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
                    {editConn ? "Edit Connection" : "Define Connection"}
                </div>

                <label style={lbl}>Connection name</label>
                <input style={inp} value={name} placeholder={autoName || "e.g. Dark Ship + Chokepoint"} onChange={e => setName(e.target.value)} />

                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                        <label style={lbl}>Rule A (source)</label>
                        <select style={{ ...inp, marginBottom: 0 }} value={ruleA} onChange={e => setRuleA(e.target.value)}>
                            <option value="">Select…</option>
                            {rules.map(r => <option key={r.id} value={r.id}>{r.name || r.rule_name}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={lbl}>Rule B (target)</label>
                        <select style={{ ...inp, marginBottom: 0 }} value={ruleB} onChange={e => setRuleB(e.target.value)}>
                            <option value="">Select…</option>
                            {rules.map(r => <option key={r.id} value={r.id}>{r.name || r.rule_name}</option>)}
                        </select>
                    </div>
                </div>

                <label style={lbl}>Relationship type</label>
                <select style={inp} value={relType} onChange={e => setRelType(e.target.value)}>
                    <option value="ESCALATION">Escalation — both fire → combined alert</option>
                    <option value="CORRELATION">Correlation — both fire → flagged as related</option>
                    <option value="SEQUENCE">Sequence — B only fires if A fired first</option>
                    <option value="SUPPRESSION">Suppression — A fires → B silenced</option>
                </select>

                {(relType === "ESCALATION" || relType === "CORRELATION") && (
                    <>
                        <label style={lbl}>Time window (minutes)</label>
                        <input type="number" style={inp} value={twMin} min={1} onChange={e => setTwMin(e.target.value)} />
                    </>
                )}
                {relType === "SEQUENCE" && (
                    <>
                        <label style={lbl}>Sequence window (minutes)</label>
                        <input type="number" style={inp} value={seqMin} min={1} onChange={e => setSeqMin(e.target.value)} />
                    </>
                )}
                {relType === "SUPPRESSION" && (
                    <>
                        <label style={lbl}>Suppression window (minutes)</label>
                        <input type="number" style={inp} value={supMin} min={1} onChange={e => setSupMin(e.target.value)} />
                    </>
                )}
                {relType === "ESCALATION" && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={lbl}>Escalated severity</label>
                            <select style={{ ...inp, marginBottom: 0 }} value={escSev} onChange={e => setEscSev(e.target.value)}>
                                {["info", "low", "medium", "high", "critical"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={lbl}>Escalated icon</label>
                            <select style={{ ...inp, marginBottom: 0 }} value={escIcon} onChange={e => setEscIcon(e.target.value)}>
                                <option value="">Default</option>
                                {Object.keys(ALERT_ICONS).map(k => <option key={k} value={k}>{ALERT_ICONS[k].label}</option>)}
                            </select>
                        </div>
                    </div>
                )}

                <label style={lbl}>Notes (optional)</label>
                <textarea
                    style={{ ...inp, minHeight: 60, resize: "vertical" }}
                    value={notes}
                    placeholder="Explain why these rules are connected and what the combined firing means operationally"
                    onChange={e => setNotes(e.target.value)}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                    <button onClick={onClose} style={ghostBtn}>Cancel</button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !ruleA || !ruleB || ruleA === ruleB}
                        style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)", opacity: (saving || !ruleA || !ruleB) ? 0.5 : 1 }}
                    >
                        {saving ? "Saving…" : editConn ? "Update" : "Create"}
                    </button>
                </div>
            </div>
        </div>
    )
}

function RuleNode({ rule, pos, onDragStart, onConnectStart, onConnectOver, onConnectUp, isConnectTarget, isMobile }) {
    const domain = getDomain(rule)
    const color  = DOMAIN_COLORS[domain]
    const label  = rule.name || rule.rule_name || "Rule"
    const sev    = rule.severity || "medium"
    const sevColor = sev === "critical" ? "#FF3B30" : sev === "high" ? "#FF9500" : sev === "medium" ? "#FFCC00" : "#8E8E93"

    return (
        <div
            onMouseDown={isMobile ? undefined : (e) => onDragStart(e, rule.id)}
            onMouseEnter={() => onConnectOver(rule.id)}
            onMouseUp={() => onConnectUp(rule.id)}
            style={{
                position:    "absolute",
                left:        pos.x,
                top:         pos.y,
                width:       NODE_W,
                height:      NODE_H,
                background:  "#0d1425",
                border:      `1px solid ${isConnectTarget ? "#60a5fa" : "rgba(148,163,184,0.12)"}`,
                borderLeft:  `3px solid ${color}`,
                borderRadius: 7,
                padding:     "8px 10px",
                cursor:      isMobile ? "default" : "grab",
                userSelect:  "none",
                boxSizing:   "border-box",
                boxShadow:   isConnectTarget ? `0 0 0 2px #60a5fa44` : "0 2px 8px rgba(0,0,0,0.4)",
                zIndex:      10,
            }}
        >
            <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: 4 }}>
                {label}
            </div>
            <div style={{ color: "#475569", fontSize: 9, marginBottom: 4 }}>
                {rule.trigger_type || rule.rule_name}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ background: `${sevColor}22`, color: sevColor, fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3 }}>{sev}</span>
                <span style={{ fontSize: 8, color: color, fontWeight: 600, letterSpacing: "0.05em" }}>{domain.toUpperCase()}</span>
            </div>
            {/* Connect port — right edge */}
            {!isMobile && (
                <div
                    title="Drag to connect"
                    onMouseDown={e => { e.stopPropagation(); onConnectStart(e, rule.id) }}
                    style={{
                        position:     "absolute",
                        right:        -6,
                        top:          "50%",
                        transform:    "translateY(-50%)",
                        width:        12,
                        height:       12,
                        borderRadius: "50%",
                        background:   color,
                        border:       "2px solid #0d1425",
                        cursor:       "crosshair",
                        zIndex:       20,
                    }}
                />
            )}
        </div>
    )
}

function RuleLogicWorkspace({ isMobile = false }) {
    const [rules,       setRules]       = useState([])
    const [conns,       setConns]       = useState([])
    const [nodePosMap,  setNodePosMap]  = useState({})
    const [loading,     setLoading]     = useState(true)
    // connection drawing
    const [drawFrom,    setDrawFrom]    = useState(null)
    const [drawPos,     setDrawPos]     = useState({ x: 0, y: 0 })
    const [connectOver, setConnectOver] = useState(null)
    // modal
    const [modal,       setModal]       = useState(null)  // null | { editConn?, defaultFrom?, defaultTo? }
    // hover card
    const [hoverConn,   setHoverConn]   = useState(null)  // { conn, x, y }
    const hoverTimerRef  = useRef(null)
    // context menu
    const [ctxMenu,     setCtxMenu]     = useState(null)  // { conn, x, y }
    // toast
    const [toast,       setToast]       = useState("")
    // add rule
    const [showAddRule, setShowAddRule] = useState(false)
    // mobile bottom sheet
    const [mobileSheet, setMobileSheet] = useState(null) // { type: "node"|"edge", data }
    // canvas container ref (for coordinate offset)
    const canvasRef = useRef(null)
    const draggingRef = useRef(null)  // { ruleId, startX, startY, origX, origY }

    function showToast(msg) {
        setToast(msg)
        setTimeout(() => setToast(""), 3000)
    }

    async function reload() {
        setLoading(true)
        const [rRes, cRes] = await Promise.all([
            fetch(`${API}/api/rules`, { headers: forgeHeaders() }),
            fetch(`${API}/api/rule-connections`, { headers: forgeHeaders() }),
        ])
        const rData = rRes.ok ? await rRes.json() : {}
        const cData = cRes.ok ? await cRes.json() : []
        const ruleList = rData.rules ?? []
        setRules(ruleList)
        setConns(Array.isArray(cData) ? cData : [])
        // Merge saved positions with defaults for new rules
        const saved = loadPositions()
        const defaults = defaultPositions(ruleList)
        const merged = { ...defaults }
        Object.entries(saved).forEach(([k, v]) => {
            if (defaults[k] !== undefined) merged[k] = v  // only keep if rule still exists
        })
        setNodePosMap(merged)
        setLoading(false)
    }

    useEffect(() => { reload() }, [])

    // Dismiss context menu on click elsewhere
    useEffect(() => {
        if (!ctxMenu) return
        const h = () => setCtxMenu(null)
        window.addEventListener("click", h)
        return () => window.removeEventListener("click", h)
    }, [ctxMenu])

    // ── Node drag ───────────────────────────────────────────────────────────
    function handleDragStart(e, ruleId) {
        if (e.button !== 0) return
        e.preventDefault()
        const pos = nodePosMap[ruleId] || { x: 0, y: 0 }
        draggingRef.current = { ruleId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }

        const onMove = (ev) => {
            const { ruleId, startX, startY, origX, origY } = draggingRef.current
            setNodePosMap(prev => ({
                ...prev,
                [ruleId]: { x: origX + ev.clientX - startX, y: origY + ev.clientY - startY },
            }))
        }
        const onUp = () => {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            // Persist
            setNodePosMap(prev => {
                savePositions(prev)
                return prev
            })
            draggingRef.current = null
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
    }

    // ── Connection drawing ─────────────────────────────────────────────────
    function handleConnectStart(e, ruleId) {
        if (e.button !== 0) return
        e.preventDefault()
        const rect = canvasRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
        setDrawFrom(ruleId)
        setDrawPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        setConnectOver(null)

        const onMove = (ev) => {
            setDrawPos({ x: ev.clientX - rect.left, y: ev.clientY - rect.top })
        }
        const onUp = () => {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            setDrawFrom(from => {
                setConnectOver(to => {
                    if (from && to && from !== to) {
                        setModal({ defaultFrom: from, defaultTo: to })
                    }
                    return null
                })
                return null
            })
        }
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
    }

    // ── Canvas dimensions ──────────────────────────────────────────────────
    const maxX = Object.values(nodePosMap).reduce((m, p) => Math.max(m, p.x + NODE_W + 40), 600)
    const maxY = Object.values(nodePosMap).reduce((m, p) => Math.max(m, p.y + NODE_H + 40), 400)

    // ── Edge path helper ───────────────────────────────────────────────────
    function edgePath(conn) {
        const posA = nodePosMap[conn.rule_id_a]
        const posB = nodePosMap[conn.rule_id_b]
        if (!posA || !posB) return null
        const x1 = posA.x + NODE_W
        const y1 = posA.y + NODE_H / 2
        const x2 = posB.x
        const y2 = posB.y + NODE_H / 2
        const cx = (x1 + x2) / 2
        const cy = Math.min(y1, y2) - 50
        return { path: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, mx: cx, my: cy + 25, x1, y1, x2, y2 }
    }

    async function handleDeleteConn(conn) {
        setCtxMenu(null)
        const r = await fetch(`${API}/api/rule-connections/${conn.id}`, {
            method: "DELETE", headers: forgeHeaders(),
        })
        if (r.ok) {
            setConns(prev => prev.filter(c => c.id !== conn.id))
            showToast("Connection removed")
        }
    }

    function handleEdgeHoverStart(e, conn) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = setTimeout(() => {
            setHoverConn({ conn, x: e.clientX, y: e.clientY })
        }, 500)
    }
    function handleEdgeHoverEnd() {
        clearTimeout(hoverTimerRef.current)
        setHoverConn(null)
    }

    if (loading) return (
        <WorkspaceBody>
            <div style={{ color: "#475569", fontSize: 12 }}>Loading rules and connections…</div>
        </WorkspaceBody>
    )

    // ── Mobile read-only view ─────────────────────────────────────────────
    if (isMobile) {
        return (
            <WorkspaceBody style={{ padding: 0, flexDirection: "column" }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
                    Rule Logic
                    <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{rules.length} rules · {conns.length} connections</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
                    {conns.length === 0 && <div style={{ color: "#475569", fontSize: 11, padding: "16px 0" }}>No connections yet. Use the desktop view to create rule connections.</div>}
                    {conns.map(c => {
                        const col = EDGE_COLORS[c.relationship_type] || "#8E8E93"
                        return (
                            <div key={c.id} onClick={() => setMobileSheet({ type: "edge", data: c })}
                                style={{ background: "#0d1425", border: "1px solid rgba(255,255,255,0.06)", borderLeft: `3px solid ${col}`, borderRadius: 6, padding: "8px 10px", marginBottom: 6, cursor: "pointer" }}>
                                <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600 }}>{c.connection_name}</div>
                                <div style={{ color: "#475569", fontSize: 9, marginTop: 2 }}>{c.rule_name_a} → {c.rule_name_b}</div>
                                <div style={{ color: col, fontSize: 8, marginTop: 3, fontWeight: 700 }}>{c.relationship_type}</div>
                            </div>
                        )
                    })}
                </div>
                {mobileSheet?.type === "edge" && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                        <div onClick={() => setMobileSheet(null)} style={{ flex: 1, background: "rgba(0,0,0,0.5)" }} />
                        <div style={{ background: "#0d1425", borderRadius: "12px 12px 0 0", padding: "16px 16px 32px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{mobileSheet.data.connection_name}</div>
                            <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.6 }}>{edgePlainEnglish(mobileSheet.data)}</div>
                            {mobileSheet.data.notes && <div style={{ color: "#475569", fontSize: 10, marginTop: 8, fontStyle: "italic" }}>{mobileSheet.data.notes}</div>}
                            <button onClick={() => setMobileSheet(null)} style={{ ...ghostBtn, marginTop: 12, width: "100%", textAlign: "center" }}>Close</button>
                        </div>
                    </div>
                )}
            </WorkspaceBody>
        )
    }

    // ── Desktop canvas view ───────────────────────────────────────────────
    return (
        <WorkspaceBody style={{ flexDirection: "column", padding: 0 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                <div>
                    <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>Rule Logic</span>
                    <span style={{ color: "#475569", fontSize: 10, marginLeft: 10 }}>{rules.length} rules · {conns.length} connections</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {/* Domain legend */}
                    {Object.entries(DOMAIN_COLORS).map(([d, c]) => (
                        <span key={d} style={{ fontSize: 9, color: c, fontWeight: 700 }}>
                            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: c, marginRight: 3 }} />
                            {d.charAt(0).toUpperCase() + d.slice(1)}
                        </span>
                    ))}
                    <button
                        onClick={() => setShowAddRule(true)}
                        style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.25)", marginLeft: 8 }}>
                        + Add Rule
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div ref={canvasRef} style={{ flex: 1, overflow: "auto", position: "relative", cursor: drawFrom ? "crosshair" : "default" }}>
                <div style={{ position: "relative", width: maxX, height: maxY, minWidth: "100%", minHeight: "100%" }}>
                    {/* SVG edge layer */}
                    <svg
                        style={{ position: "absolute", inset: 0, width: maxX, height: maxY, overflow: "visible", zIndex: 5 }}
                        pointerEvents="none"
                    >
                        <defs>
                            {Object.entries(EDGE_COLORS).map(([type, color]) => (
                                <marker key={type} id={`arrow-${type}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                                    <path d="M0,0 L0,6 L8,3 Z" fill={color} />
                                </marker>
                            ))}
                        </defs>

                        {/* Permanent edges */}
                        {conns.map(conn => {
                            const ep = edgePath(conn)
                            if (!ep) return null
                            const color = EDGE_COLORS[conn.relationship_type] || "#8E8E93"
                            return (
                                <g key={conn.id}>
                                    {/* Hit-area (wide transparent path) */}
                                    <path
                                        d={ep.path}
                                        stroke="transparent"
                                        strokeWidth={14}
                                        fill="none"
                                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                        onMouseEnter={e => handleEdgeHoverStart(e, conn)}
                                        onMouseLeave={handleEdgeHoverEnd}
                                        onClick={e => { e.stopPropagation(); setModal({ editConn: conn }) }}
                                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ conn, x: e.clientX, y: e.clientY }) }}
                                    />
                                    {/* Visible path */}
                                    <path
                                        d={ep.path}
                                        stroke={color}
                                        strokeWidth={2}
                                        fill="none"
                                        markerEnd={`url(#arrow-${conn.relationship_type})`}
                                        style={{ pointerEvents: "none" }}
                                    />
                                    {/* Midpoint label */}
                                    <rect x={ep.mx - 28} y={ep.my - 8} width={56} height={16} rx={8} fill="#0d1425" style={{ pointerEvents: "none" }} />
                                    <text x={ep.mx} y={ep.my + 4} textAnchor="middle" style={{ fontSize: 7, fill: color, fontWeight: 700, letterSpacing: "0.05em", pointerEvents: "none" }}>
                                        {conn.relationship_type}
                                    </text>
                                </g>
                            )
                        })}

                        {/* Live drawing line */}
                        {drawFrom && nodePosMap[drawFrom] && (() => {
                            const pos = nodePosMap[drawFrom]
                            const x1 = pos.x + NODE_W
                            const y1 = pos.y + NODE_H / 2
                            return (
                                <line
                                    x1={x1} y1={y1}
                                    x2={drawPos.x} y2={drawPos.y}
                                    stroke="#60a5fa" strokeWidth={2}
                                    strokeDasharray="6 3"
                                    style={{ pointerEvents: "none" }}
                                />
                            )
                        })()}
                    </svg>

                    {/* Rule nodes */}
                    {rules.map(rule => {
                        const pos = nodePosMap[rule.id] ?? { x: 40, y: 40 }
                        return (
                            <RuleNode
                                key={rule.id}
                                rule={rule}
                                pos={pos}
                                onDragStart={handleDragStart}
                                onConnectStart={handleConnectStart}
                                onConnectOver={id => drawFrom && setConnectOver(id)}
                                onConnectUp={id => drawFrom && id !== drawFrom && setConnectOver(id)}
                                isConnectTarget={connectOver === rule.id}
                                isMobile={false}
                            />
                        )
                    })}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "#0d1425", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 6, padding: "8px 16px", color: "#60a5fa", fontSize: 11, zIndex: 4000 }}>
                    {toast}
                </div>
            )}

            {/* Context menu */}
            {ctxMenu && (
                <div style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, background: "#0d1425", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 0", zIndex: 4000, minWidth: 160 }}>
                    <button onClick={() => { setModal({ editConn: ctxMenu.conn }); setCtxMenu(null) }}
                        style={{ ...ghostBtn, width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 0, border: "none" }}>
                        Edit connection
                    </button>
                    <button onClick={() => handleDeleteConn(ctxMenu.conn)}
                        style={{ ...ghostBtn, width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 0, border: "none", color: "#ef4444", borderColor: "transparent" }}>
                        Delete connection
                    </button>
                </div>
            )}

            {/* Hover explanation card */}
            {hoverConn && (
                <div
                    onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
                    onMouseLeave={handleEdgeHoverEnd}
                    style={{
                        position: "fixed", left: hoverConn.x + 12, top: hoverConn.y - 20,
                        maxWidth: 280, background: "#0d1425",
                        border: `1px solid ${EDGE_COLORS[hoverConn.conn.relationship_type] || "#8E8E93"}44`,
                        borderRadius: 7, padding: "10px 12px", zIndex: 3500,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                    }}
                >
                    <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{hoverConn.conn.connection_name}</div>
                    <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.6 }}>{edgePlainEnglish(hoverConn.conn)}</div>
                    {hoverConn.conn.notes && <div style={{ color: "#475569", fontSize: 9, marginTop: 6, fontStyle: "italic" }}>{hoverConn.conn.notes}</div>}
                    <button onClick={() => { setModal({ editConn: hoverConn.conn }); setHoverConn(null) }}
                        style={{ ...ghostBtn, marginTop: 8, fontSize: 9 }}>Edit</button>
                </div>
            )}

            {/* Connection modal */}
            {modal && (
                <ConnModal
                    rules={rules}
                    editConn={modal.editConn}
                    defaultFrom={modal.defaultFrom}
                    defaultTo={modal.defaultTo}
                    onClose={() => setModal(null)}
                    onSaved={conn => {
                        setConns(prev => {
                            const idx = prev.findIndex(c => c.id === conn.id)
                            if (idx >= 0) { const next = [...prev]; next[idx] = conn; return next }
                            return [...prev, conn]
                        })
                        setModal(null)
                        showToast(modal.editConn ? "Connection updated" : "Connection created")
                    }}
                />
            )}

            {/* Add Rule shortcut */}
            {showAddRule && (
                <CreateRuleModal
                    source="AIS"
                    onClose={() => setShowAddRule(false)}
                    onCreated={() => { reload(); setShowAddRule(false) }}
                />
            )}
        </WorkspaceBody>
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORRELATION ENGINE WORKSPACE  (Intelligence Fusion Engine UI)
// ═══════════════════════════════════════════════════════════════════════════════

const DOMAIN_COLOR_CE = {
    AIS: "#34AADC", NEWS: "#FF9500", SENTINEL: "#30D158", ADSB: "#5856D6", FUSION: "#BF5AF2",
}
const SEV_COLOR_CE = { critical: "#f87171", high: "#fb923c", medium: "#fbbf24", info: "#60a5fa" }

function CorrelationEngineWorkspace() {
    const [signals,       setSignals]       = useState([])
    const [fusions,       setFusions]       = useState([])
    const [settings,      setSettings]      = useState({ fusion_window_hours: 2, min_domains: 2, min_signals: 2 })
    const [settingsDraft, setSettingsDraft] = useState(null)
    const [filter,        setFilter]        = useState("ALL")
    const [detail,        setDetail]        = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [noteText,      setNoteText]      = useState("")
    const [noteSaving,    setNoteSaving]    = useState(false)
    const signalListRef = useRef(null)

    const reload = () => {
        fetch(`${API}/api/signals/recent?limit=50`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setSignals(safeArray(d)); setTimeout(() => { if (signalListRef.current) signalListRef.current.scrollTop = 0 }, 50) })
            .catch(() => {})
        fetch(`${API}/api/fusions?status=active&limit=50`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setFusions(safeArray(d)))
            .catch(() => {})
        fetch(`${API}/api/fusion-settings`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setSettings(d) })
            .catch(() => {})
    }

    useEffect(() => {
        reload()
        const iv = setInterval(reload, 30_000)
        return () => clearInterval(iv)
    }, [])

    const openDetail = async (f) => {
        setDetailLoading(true)
        setDetail({ ...f, resolved_signals: [] })
        setNoteText(f.analyst_notes || "")
        try {
            const r = await fetch(`${API}/api/fusions/${f.fusion_id}`, { headers: forgeHeaders() })
            if (r.ok) {
                const d = await r.json()
                setDetail(d)
                setNoteText(d.analyst_notes || "")
            }
        } catch { /* silent */ }
        setDetailLoading(false)
    }

    const saveNote = async () => {
        if (!detail) return
        setNoteSaving(true)
        try {
            await fetch(`${API}/api/fusions/${detail.fusion_id}`, {
                method: "PUT", headers: forgeHeaders(),
                body: JSON.stringify({ analyst_notes: noteText }),
            })
        } catch { /* silent */ }
        setNoteSaving(false)
    }

    const resolveFusion = async () => {
        if (!detail) return
        try {
            await fetch(`${API}/api/fusions/${detail.fusion_id}`, { method: "DELETE", headers: forgeHeaders() })
            setDetail(d => d ? { ...d, status: "resolved" } : d)
            reload()
        } catch { /* silent */ }
    }

    const saveSettings = async () => {
        const draft = settingsDraft || settings
        try {
            const r = await fetch(`${API}/api/fusion-settings`, {
                method: "PUT", headers: forgeHeaders(), body: JSON.stringify(draft),
            })
            if (r.ok) setSettings(await r.json())
        } catch { /* silent */ }
        setSettingsDraft(null)
    }

    const filtered = fusions.filter(f => filter === "ALL" || f.severity === filter.toLowerCase())

    return (
        <div style={{ flex: 1, display: "flex", overflow: "hidden", gap: 0 }}>

            {/* ── LEFT: Signal Monitor ── */}
            <div style={{
                width: 280, flexShrink: 0, borderRight: "1px solid #1e293b",
                display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
                <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #1e293b" }}>
                    <div style={{ color: "#4A9EE0", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em" }}>
                        SIGNAL MONITOR
                    </div>
                    <div style={{ color: "#334155", fontSize: 9, marginTop: 2 }}>
                        Live fusion input · last {signals.length} signals
                    </div>
                </div>
                <div ref={signalListRef} style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
                    {signals.length === 0 ? (
                        <div style={{ color: "#334155", fontSize: 11, padding: 12, textAlign: "center" }}>No recent signals</div>
                    ) : signals.map((s, i) => {
                        const dc = DOMAIN_COLOR_CE[s.domain] || "#64748b"
                        return (
                            <div key={i} style={{
                                padding: "5px 0", borderBottom: "1px solid rgba(148,163,184,0.05)",
                                display: "flex", gap: 7, alignItems: "flex-start",
                            }}>
                                <span style={{
                                    fontSize: 8, padding: "2px 5px", borderRadius: 2,
                                    background: dc + "22", color: dc, fontWeight: 700,
                                    flexShrink: 0, marginTop: 1,
                                }}>{s.domain || "?"}</span>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {s.rule_name || s.signal_id}
                                    </div>
                                    {s.summary && (
                                        <div style={{ fontSize: 9, color: "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.summary}</div>
                                    )}
                                    <div style={{ fontSize: 8, color: "#1e293b", marginTop: 1 }}>
                                        {s.location_name || (s.lat != null ? `${Number(s.lat).toFixed(2)}, ${Number(s.lon ?? 0).toFixed(2)}` : "")}
                                        {s.timestamp && ` · ${new Date(s.timestamp).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" })}`}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* ── CENTRE: Active Fusions ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #1e293b" }}>
                {/* Filter pills */}
                <div style={{ padding: "10px 14px 6px", borderBottom: "1px solid #1e293b", display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ color: "#4A9EE0", fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", marginRight: 4 }}>ACTIVE FUSIONS</span>
                    {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map(f => {
                        const fc = f === "ALL" ? "#4A9EE0" : SEV_COLOR_CE[f.toLowerCase()] || "#64748b"
                        return (
                            <button key={f} onClick={() => setFilter(f)} style={{
                                padding: "2px 8px", fontSize: 9, fontWeight: 700, borderRadius: 3,
                                background: filter === f ? fc + "33" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${filter === f ? fc + "66" : "rgba(255,255,255,0.06)"}`,
                                color: filter === f ? fc : "#334155", cursor: "pointer",
                            }}>{f}</button>
                        )
                    })}
                    <button onClick={reload} style={{
                        marginLeft: "auto", padding: "2px 8px", fontSize: 9, fontWeight: 600,
                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 3, color: "#334155", cursor: "pointer",
                    }}>↻ Refresh</button>
                </div>

                {/* Fusion cards */}
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
                    {filtered.length === 0 ? (
                        <div style={{ color: "#334155", fontSize: 11, padding: 16, textAlign: "center" }}>
                            {fusions.length === 0 ? "No active fusion events" : "No events at this severity"}
                        </div>
                    ) : filtered.map(f => {
                        const sc = SEV_COLOR_CE[f.severity] || "#60a5fa"
                        const pct = Math.round((f.confidence || 0) * 100)
                        const isSelected = detail?.fusion_id === f.fusion_id
                        return (
                            <div key={f.fusion_id} style={{
                                background: isSelected ? "rgba(191,90,242,0.07)" : "rgba(17,24,39,0.7)",
                                border: `1px solid ${isSelected ? "#BF5AF244" : "rgba(255,255,255,0.04)"}`,
                                borderRadius: 6, padding: "8px 10px", marginBottom: 6,
                                borderLeft: `3px solid ${sc}`,
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>
                                            {f.title || "Fusion Event"}
                                        </div>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: sc + "22", color: sc, fontWeight: 700 }}>
                                                {(f.severity || "?").toUpperCase()}
                                            </span>
                                            {safeArray(f.domains).map(d => (
                                                <span key={d} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: (DOMAIN_COLOR_CE[d] || "#64748b") + "22", color: DOMAIN_COLOR_CE[d] || "#64748b" }}>{d}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <button onClick={() => openDetail(f)} style={{
                                        padding: "3px 8px", fontSize: 9, fontWeight: 600, flexShrink: 0, marginLeft: 6,
                                        background: "rgba(191,90,242,0.12)", border: "1px solid rgba(191,90,242,0.25)",
                                        borderRadius: 3, color: "#BF5AF2", cursor: "pointer",
                                    }}>View</button>
                                </div>
                                {/* Confidence bar */}
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                        <div style={{ width: `${pct}%`, height: "100%", background: "#BF5AF2", borderRadius: 2 }} />
                                    </div>
                                    <span style={{ fontSize: 8, color: "#BF5AF2", minWidth: 24, textAlign: "right" }}>{pct}%</span>
                                    <span style={{ fontSize: 8, color: "#334155" }}>{f.signal_count || 0}sig</span>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Fusion Settings */}
                <div style={{ borderTop: "1px solid #1e293b", padding: "10px 14px" }}>
                    <div style={{ color: "#334155", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>FUSION SETTINGS</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[
                            { key: "fusion_window_hours", label: "Window (h)", step: 0.5, min: 0.5, max: 24 },
                            { key: "min_domains",         label: "Min Domains", step: 1,   min: 2,   max: 5 },
                            { key: "min_signals",         label: "Min Signals", step: 1,   min: 2,   max: 10 },
                        ].map(({ key, label, step, min, max }) => {
                            const val = (settingsDraft || settings)[key]
                            return (
                                <div key={key} style={{ flex: "1 1 80px" }}>
                                    <div style={{ fontSize: 8, color: "#475569", marginBottom: 2 }}>{label}</div>
                                    <input
                                        type="number" step={step} min={min} max={max}
                                        value={val}
                                        onChange={e => setSettingsDraft(prev => ({ ...(prev || settings), [key]: Number(e.target.value) }))}
                                        style={{
                                            width: "100%", padding: "3px 6px", fontSize: 11,
                                            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                                            borderRadius: 4, color: "#e2e8f0", outline: "none", boxSizing: "border-box",
                                        }}
                                    />
                                </div>
                            )
                        })}
                        <button onClick={saveSettings} style={{
                            alignSelf: "flex-end", padding: "4px 10px", fontSize: 9, fontWeight: 600,
                            background: "rgba(74,158,224,0.15)", border: "1px solid rgba(74,158,224,0.3)",
                            borderRadius: 4, color: "#4A9EE0", cursor: "pointer",
                        }}>Save</button>
                    </div>
                </div>
            </div>

            {/* ── RIGHT: Fusion Detail ── */}
            <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {!detail ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ color: "#1e293b", fontSize: 12, textAlign: "center" }}>
                            Select a fusion<br />to view details
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Detail header */}
                        <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #1e293b" }}>
                            <div style={{ color: "#BF5AF2", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>
                                ⚡ FUSION DETAIL
                            </div>
                            <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
                                {detail.title || "Fusion Event"}
                            </div>
                            {detail.subtitle && (
                                <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{detail.subtitle}</div>
                            )}
                        </div>

                        <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
                            {detailLoading && (
                                <div style={{ color: "#334155", fontSize: 10, textAlign: "center", padding: 8 }}>Loading signals…</div>
                            )}

                            {/* Confidence + domains */}
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                                    {safeArray(detail.domains).map(d => (
                                        <span key={d} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 2, background: (DOMAIN_COLOR_CE[d] || "#64748b") + "22", color: DOMAIN_COLOR_CE[d] || "#64748b", fontWeight: 700 }}>{d}</span>
                                    ))}
                                    <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 2, background: (SEV_COLOR_CE[detail.severity] || "#64748b") + "22", color: SEV_COLOR_CE[detail.severity] || "#64748b" }}>
                                        {(detail.severity || "").toUpperCase()}
                                    </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                        <div style={{ width: `${Math.round((detail.confidence || 0) * 100)}%`, height: "100%", background: "#BF5AF2", borderRadius: 2 }} />
                                    </div>
                                    <span style={{ fontSize: 9, color: "#BF5AF2", fontWeight: 700 }}>{Math.round((detail.confidence || 0) * 100)}%</span>
                                </div>
                                <div style={{ fontSize: 8, color: "#334155", marginTop: 4 }}>
                                    {detail.signal_count || 0} signals · {safeArray(detail.domains).length} domains
                                    {detail.location_name && ` · ${detail.location_name}`}
                                </div>
                            </div>

                            {/* Narrative */}
                            {detail.narrative && (
                                <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.55, marginBottom: 10 }}>
                                    {detail.narrative}
                                </div>
                            )}

                            {/* Key signals */}
                            {safeArray(detail.key_signals).length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 8, color: "#334155", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>KEY SIGNALS</div>
                                    {safeArray(detail.key_signals).map((s, i) => (
                                        <div key={i} style={{ fontSize: 10, color: "#64748b", padding: "2px 0", display: "flex", gap: 5 }}>
                                            <span style={{ color: "#BF5AF2", flexShrink: 0 }}>▸</span>{s}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Threat indicators */}
                            {safeArray(detail.threat_indicators).length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 8, color: "#7f1d1d", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>THREAT INDICATORS</div>
                                    {safeArray(detail.threat_indicators).map((t, i) => (
                                        <div key={i} style={{ fontSize: 10, color: "#f87171", padding: "2px 0", display: "flex", gap: 5 }}>
                                            <span style={{ flexShrink: 0 }}>⚠</span>{t}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Contributing signals */}
                            {safeArray(detail.resolved_signals).length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 8, color: "#334155", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>CONTRIBUTING SIGNALS</div>
                                    {safeArray(detail.resolved_signals).map((s, i) => {
                                        const dc = DOMAIN_COLOR_CE[s.domain] || "#64748b"
                                        return (
                                            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.05)" }}>
                                                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: dc + "22", color: dc, fontWeight: 600 }}>{s.domain}</span>
                                                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{s.rule_name || s.signal_id}</span>
                                                </div>
                                                {s.summary && <div style={{ fontSize: 9, color: "#475569", marginTop: 2, paddingLeft: 2 }}>{s.summary}</div>}
                                                {s.timestamp && <div style={{ fontSize: 8, color: "#1e293b", marginTop: 1 }}>{new Date(s.timestamp).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" })}</div>}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Analyst notes */}
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ fontSize: 8, color: "#334155", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>ANALYST NOTES</div>
                                <textarea
                                    value={noteText}
                                    onChange={e => setNoteText(e.target.value)}
                                    placeholder="Add analyst notes…"
                                    style={{
                                        width: "100%", boxSizing: "border-box", minHeight: 60,
                                        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                                        borderRadius: 4, color: "#e2e8f0", fontSize: 10,
                                        padding: "5px 7px", resize: "vertical", fontFamily: "system-ui, sans-serif",
                                    }}
                                />
                                <button onClick={saveNote} disabled={noteSaving} style={{
                                    marginTop: 4, padding: "3px 10px", fontSize: 9, fontWeight: 600,
                                    background: "rgba(191,90,242,0.12)", border: "1px solid rgba(191,90,242,0.25)",
                                    borderRadius: 4, color: "#BF5AF2", cursor: "pointer",
                                }}>{noteSaving ? "Saving…" : "Save Note"}</button>
                            </div>
                        </div>

                        {/* Action bar */}
                        <div style={{ borderTop: "1px solid #1e293b", padding: "8px 14px", display: "flex", gap: 6 }}>
                            {detail.status !== "resolved" && (
                                <button onClick={resolveFusion} style={{
                                    padding: "4px 10px", fontSize: 9, fontWeight: 600,
                                    background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)",
                                    borderRadius: 4, color: "#f87171", cursor: "pointer",
                                }}>Resolve</button>
                            )}
                            <button onClick={() => { window.dispatchEvent(new CustomEvent("open-globe-fusion", { detail: { fusion_id: detail.fusion_id, lat: detail.lat, lon: detail.lon } })) }} style={{
                                padding: "4px 10px", fontSize: 9, fontWeight: 600,
                                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 4, color: "#64748b", cursor: "pointer",
                            }}>Open on Globe</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

// ── Forge landing nav ──────────────────────────────────────────────────────────
const FORGE_NAV = [
    { ws: "correlation-engine", label: "Correlation Engine",    color: "#BF5AF2", desc: "Active fusion events · multi-domain signal monitor · fusion settings" },
    { ws: "ais-detector",       label: "AIS Anomaly Detector",  color: "#34AADC", desc: "Vessel tracking rules · loitering · dark ship · escalation" },
    { ws: "news-source",        label: "News Feed",             color: "#FF9500", desc: "RSS feeds · article ingestion · SURGE surge detection settings" },
    { ws: "rule-logic",         label: "Rule Logic",            color: "#fb923c", desc: "Forge rules · escalation chains · connections" },
    { ws: "surveillance-zones", label: "Surveillance Zones",    color: "#30D158", desc: "Sentinel satellite scan zones · zone analytics" },
    { ws: "strategic-zones",    label: "Strategic Zones",       color: "#FF3B30", desc: "Conflict zones · interest areas · relevance scoring · baseline zones" },
    { ws: "ontology",           label: "Entity Ontology",       color: "#60a5fa", desc: "Intelligence entity graph · cables · chokepoints · actors" },
    { ws: "reports",            label: "Reports",               color: "#FFD60A", desc: "Snapshots · draft reports · AI review council · PDF export" },
]

function ForgeLandingNav({ brainStatus, onNavigate, onPipeline }) {
    return (
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ marginBottom: 20 }}>
                <div style={{ color: "#4A9EE0", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>
                    FORGE — INTELLIGENCE TRAINING LAB
                </div>
                <div style={{ color: "#334155", fontSize: 11 }}>
                    Select a workspace to configure or monitor.
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginBottom: 16 }}>
                {FORGE_NAV.map(({ ws, label, color, desc }) => (
                    <button key={ws} onClick={() => onNavigate(ws)} style={{
                        background: "rgba(17,24,39,0.7)", border: `1px solid rgba(255,255,255,0.05)`,
                        borderLeft: `3px solid ${color}`, borderRadius: 6,
                        padding: "12px 14px", textAlign: "left", cursor: "pointer",
                        transition: "background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${color}12`}
                    onMouseLeave={e => e.currentTarget.style.background = "rgba(17,24,39,0.7)"}
                    >
                        <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{label}</div>
                        <div style={{ color: "#475569", fontSize: 10, lineHeight: 1.4 }}>{desc}</div>
                    </button>
                ))}
            </div>
            <button onClick={onPipeline} style={{
                padding: "7px 14px", fontSize: 10, fontWeight: 600,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 5, color: "#334155", cursor: "pointer",
            }}>
                ⌁ View Pipeline Canvas
            </button>
            {brainStatus && (
                <div style={{ marginTop: 16, fontSize: 9, color: "#1e293b" }}>
                    Brain status: {brainStatus.status || "running"} ·
                    AIS {brainStatus.ais_vessel_count ?? "—"} vessels ·
                    News {brainStatus.news_article_count ?? "—"} articles
                </div>
            )}
        </div>
    )
}

function ReportSnapshotsWorkspace() {
    const [snapshots, setSnapshots] = useState([])
    const [loaded,    setLoaded]    = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [captureMsg, setCaptureMsg] = useState(null)
    const [label,     setLabel]     = useState("")
    const [expanded,  setExpanded]  = useState(null)   // snapshot_id of the one showing full content
    const [detail,    setDetail]    = useState(null)   // fetched full content for `expanded`

    const reload = () =>
        fetch(`${API}/api/reports/snapshots?limit=50`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setSnapshots(Array.isArray(d) ? d : []); setLoaded(true) })
            .catch(() => setLoaded(true))

    useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const capture = async () => {
        setCapturing(true); setCaptureMsg(null)
        try {
            const res = await fetch(`${API}/api/reports/snapshots`, {
                method: "POST", headers: forgeHeaders(),
                body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
            })
            const d = await res.json()
            if (res.ok) {
                setCaptureMsg(`Captured ${d.snapshot_id}`)
                setLabel("")
                await reload()
            } else {
                setCaptureMsg(`Error: ${d.detail || "capture failed"}`)
            }
        } catch (e) {
            setCaptureMsg(`Error: ${e.message}`)
        } finally {
            setCapturing(false)
        }
    }

    const toggleDetail = async (snapId) => {
        if (expanded === snapId) { setExpanded(null); setDetail(null); return }
        setExpanded(snapId); setDetail(null)
        try {
            const res = await fetch(`${API}/api/reports/snapshots/${snapId}`, { headers: forgeHeaders() })
            if (res.ok) setDetail(await res.json())
        } catch (_e) {}
    }

    return (
        <WorkspaceBody>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 12, maxWidth: 720 }}>
                A snapshot freezes the current intelligence picture (active signals, fusion events, elevated regions, AIS/ADS-B anomalies, Sentinel detections) as a permanent, timestamped record with its own ID — unlike the live views elsewhere in this app, a captured snapshot never changes even as the underlying data moves on. This is the capture layer the Reports tab cites claims against.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Optional label (e.g. Red Sea AOI — daily)" style={{ ...inputStyle, flex: 1, maxWidth: 320 }} />
                <button onClick={capture} disabled={capturing} style={{ padding: "6px 14px", borderRadius: 5, border: "none", background: capturing ? "#1e293b" : "#60a5fa", color: capturing ? "#475569" : "#0f172a", fontWeight: 600, cursor: capturing ? "default" : "pointer", fontSize: 11 }}>
                    {capturing ? "Capturing…" : "Capture Snapshot Now"}
                </button>
                {captureMsg && <span style={{ color: captureMsg.startsWith("Error") ? "#f87171" : "#4ade80", fontSize: 11 }}>{captureMsg}</span>}
            </div>
            {!loaded && <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div>}
            {loaded && snapshots.length === 0 && (
                <div style={{ color: "#334155", fontSize: 11 }}>No snapshots captured yet — click "Capture Snapshot Now" to freeze the current intelligence picture.</div>
            )}
            {snapshots.map(s => (
                <div key={s.snapshot_id} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggleDetail(s.snapshot_id)}>
                        <div>
                            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{s.label || s.snapshot_id}</span>
                            <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{s.snapshot_id}</span>
                        </div>
                        <span style={{ color: "#475569", fontSize: 10 }}>{s.captured_at ? new Date(s.captured_at).toLocaleString() : "—"}</span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 10, marginTop: 6 }}>
                        {s.statistics?.total_active_signals ?? "—"} signals · {s.statistics?.critical_signals ?? "—"} critical · {s.statistics?.active_fusions ?? "—"} fusions · {s.statistics?.active_surges ?? "—"} surges
                        {s.statistics?.alerts_excluded_low_quality > 0 && <> · {s.statistics.alerts_excluded_low_quality} low-quality alerts excluded</>}
                        {s.created_by && <> · captured by {s.created_by}</>}
                    </div>
                    {expanded === s.snapshot_id && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                            {!detail ? (
                                <div style={{ color: "#334155", fontSize: 11 }}>Loading full content…</div>
                            ) : (
                                <pre style={{ color: "#94a3b8", fontSize: 10, maxHeight: 260, overflow: "auto", background: "#080c14", padding: 8, borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                    {JSON.stringify(detail.content, null, 2)}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </WorkspaceBody>
    )
}

// ── Reports (roadmap Phase 3: report entity, status machine, council, PDF) ──
//
// Draft-to-published intelligence reports. Every report is keyed to a
// ReportSnapshot (the tab alongside this one) so a claim can cite "signal X
// in snapshot Y" rather than nothing. Submitting for review runs the
// council (report_council.py): a deterministic pass — citation-existence,
// geo-sanity — that no model can get wrong by being persuasive, plus two
// independently-lensed model passes (citation fidelity, completeness).
// Nothing here auto-advances a report; every step past draft is an explicit
// human action, and a lens that has no Claude client configured reports
// itself as skipped rather than faking a verdict.

const REPORT_STATUSES = ["draft", "in_review", "approved", "published", "rejected"]
const REPORT_STATUS_COLORS = { draft: "#94a3b8", in_review: "#facc15", approved: "#60a5fa", published: "#4ade80", rejected: "#f87171" }
const REPORT_CITATION_SECTIONS = ["ais_anomalies", "adsb_anomalies", "fusion_events", "surge_events", "sentinel_detections", "news_assessments", "strategic_zones", "top_articles"]
const RELIABILITY_CODES = ["A", "B", "C", "D", "E", "F"]
const CREDIBILITY_CODES = ["1", "2", "3", "4", "5", "6"]

function emptyReportClaim() {
    return {
        text: "", citation: { type: "snapshot_ref", section: REPORT_CITATION_SECTIONS[0], item_id: "" },
        source_evaluation: null, asserted_zone: "", lat: "", lon: "",
    }
}

function ClaimEditorRow({ claim, onChange, onRemove }) {
    const set = (k, v) => onChange({ ...claim, [k]: v })
    const setCitation = (k, v) => onChange({ ...claim, citation: { ...claim.citation, [k]: v } })
    const [showGeo,  setShowGeo]  = useState(!!(claim.asserted_zone || claim.lat || claim.lon))
    const [showEval, setShowEval] = useState(!!claim.source_evaluation)

    return (
        <div style={{ background: "#0d1422", borderRadius: 6, padding: 12, marginBottom: 8 }}>
            <textarea value={claim.text} onChange={e => set("text", e.target.value)} placeholder="Claim text *" rows={2}
                style={{ ...inputStyle, width: "100%", marginBottom: 6, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <select value={claim.citation.type} onChange={e => setCitation("type", e.target.value)} style={inputStyle}>
                    <option value="snapshot_ref">citation: snapshot data</option>
                    <option value="external">citation: external source</option>
                </select>
                {claim.citation.type === "snapshot_ref" ? (
                    <>
                        <select value={claim.citation.section || REPORT_CITATION_SECTIONS[0]} onChange={e => setCitation("section", e.target.value)} style={inputStyle}>
                            {REPORT_CITATION_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input value={claim.citation.item_id || ""} onChange={e => setCitation("item_id", e.target.value)} placeholder="item id (e.g. signal_id) *" style={inputStyle} />
                    </>
                ) : (
                    <input value={claim.citation.url || ""} onChange={e => setCitation("url", e.target.value)} placeholder="Source URL *" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                )}
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
                <label style={{ color: "#475569", fontSize: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={showGeo} onChange={e => { setShowGeo(e.target.checked); if (!e.target.checked) onChange({ ...claim, asserted_zone: "", lat: "", lon: "" }) }} style={{ marginRight: 4 }} />
                    Geo-sanity check
                </label>
                <label style={{ color: "#475569", fontSize: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={showEval} onChange={e => { setShowEval(e.target.checked); if (!e.target.checked) set("source_evaluation", null) }} style={{ marginRight: 4 }} />
                    Source evaluation (NATO Admiralty)
                </label>
            </div>
            {showGeo && (
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input value={claim.asserted_zone || ""} onChange={e => set("asserted_zone", e.target.value)} placeholder="Asserted zone name" style={{ ...inputStyle, flex: 1 }} />
                    <input value={claim.lat || ""} onChange={e => set("lat", e.target.value)} placeholder="Lat" style={{ ...inputStyle, width: 90 }} />
                    <input value={claim.lon || ""} onChange={e => set("lon", e.target.value)} placeholder="Lon" style={{ ...inputStyle, width: 90 }} />
                </div>
            )}
            {showEval && (
                <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                    <select value={claim.source_evaluation?.reliability || ""} onChange={e => set("source_evaluation", { ...(claim.source_evaluation || {}), reliability: e.target.value })} style={inputStyle}>
                        <option value="">reliability</option>
                        {RELIABILITY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={claim.source_evaluation?.credibility || ""} onChange={e => set("source_evaluation", { ...(claim.source_evaluation || {}), credibility: e.target.value })} style={inputStyle}>
                        <option value="">credibility</option>
                        {CREDIBILITY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input value={claim.source_evaluation?.confidence_label || ""} onChange={e => set("source_evaluation", { ...(claim.source_evaluation || {}), confidence_label: e.target.value })} placeholder="confidence label (optional)" style={{ ...inputStyle, flex: 1 }} />
                </div>
            )}
            <button onClick={onRemove} style={{ background: "none", border: "none", color: "#f87171", fontSize: 10, cursor: "pointer", padding: 0 }}>✕ Remove claim</button>
        </div>
    )
}

function ReportForm({ snapshots, existing, onSaved, onCancel }) {
    const isEdit = !!existing
    const [title,          setTitle]          = useState(existing?.title || "")
    const [snapshotId,     setSnapshotId]     = useState(existing?.snapshot_id || (snapshots[0]?.snapshot_id || ""))
    const [classification, setClassification] = useState(existing?.classification || "UNCLASSIFIED // FOR ANALYTICAL USE ONLY")
    const [keyJudgments,   setKeyJudgments]   = useState(existing?.key_judgments || "")
    const [claims, setClaims] = useState(
        existing?.claims?.length
            ? existing.claims.map(c => ({ ...c, lat: c.lat ?? "", lon: c.lon ?? "", asserted_zone: c.asserted_zone || "" }))
            : [emptyReportClaim()]
    )
    const [saving, setSaving] = useState(false)
    const [err, setErr]       = useState(null)

    const updateClaim = (i, next) => setClaims(cs => cs.map((c, idx) => idx === i ? next : c))
    const removeClaim = (i) => setClaims(cs => cs.filter((_, idx) => idx !== i))
    const addClaim = () => setClaims(cs => [...cs, emptyReportClaim()])

    const save = async () => {
        setSaving(true); setErr(null)
        try {
            const payload = {
                title: title.trim(), snapshot_id: snapshotId, classification, key_judgments: keyJudgments,
                claims: claims.filter(c => c.text.trim()).map(c => ({
                    ...(c.claim_id ? { claim_id: c.claim_id } : {}),
                    text: c.text.trim(), citation: c.citation, source_evaluation: c.source_evaluation || null,
                    asserted_zone: c.asserted_zone || null,
                    lat: c.lat !== "" && c.lat != null ? parseFloat(c.lat) : null,
                    lon: c.lon !== "" && c.lon != null ? parseFloat(c.lon) : null,
                })),
            }
            const url = isEdit ? `${API}/api/reports/${existing.report_id}` : `${API}/api/reports`
            const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers: forgeHeaders(), body: JSON.stringify(payload) })
            const d = await res.json()
            if (res.ok) { onSaved(d) } else { setErr(d.detail || "Save failed") }
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <div style={{ background: "#0d1422", borderRadius: 6, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Report title *" style={inputStyle} />
                <select value={snapshotId} onChange={e => setSnapshotId(e.target.value)} disabled={isEdit} style={inputStyle}>
                    <option value="">select a snapshot to cite *</option>
                    {snapshots.map(s => <option key={s.snapshot_id} value={s.snapshot_id}>{s.label || s.snapshot_id}</option>)}
                </select>
            </div>
            <input value={classification} onChange={e => setClassification(e.target.value)} placeholder="Classification" style={{ ...inputStyle, width: "100%", marginBottom: 8 }} />
            <textarea value={keyJudgments} onChange={e => setKeyJudgments(e.target.value)} placeholder="Key judgments (analyst-written summary)" rows={3} style={{ ...inputStyle, width: "100%", marginBottom: 10, resize: "vertical" }} />
            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Sourced Claims ({claims.length})
            </div>
            {claims.map((c, i) => (
                <ClaimEditorRow key={i} claim={c} onChange={next => updateClaim(i, next)} onRemove={() => removeClaim(i)} />
            ))}
            <button onClick={addClaim} style={{ ...ghostBtn, marginBottom: 10 }}>+ Add Claim</button>
            {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={save} disabled={saving || !title.trim() || !snapshotId} style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>
                    {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Draft Report"}
                </button>
                <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            </div>
        </div>
    )
}

function LensResult({ title, result }) {
    if (!result) return null
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{title}</div>
            {result.status === "skipped" && <div style={{ color: "#475569", fontSize: 10, fontStyle: "italic" }}>Skipped — {result.reason}</div>}
            {result.status === "error" && <div style={{ color: "#f87171", fontSize: 10 }}>Error — {result.reason}</div>}
            {result.status === "ok" && Array.isArray(result.findings) && (
                result.findings.length === 0
                    ? <div style={{ color: "#334155", fontSize: 10 }}>No issues flagged.</div>
                    : result.findings.map((f, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(148,163,184,0.15)" }}>
                            <span style={{ color: f.verdict === "supported" ? "#4ade80" : f.verdict === "overstated" ? "#facc15" : "#f87171", fontWeight: 600 }}>
                                {f.claim_id}{f.verdict ? ` — ${f.verdict}` : ""}
                            </span>{f.comment ? `: ${f.comment}` : ""}
                        </div>
                    ))
            )}
            {result.status === "ok" && result.overall_comment !== undefined && (
                <>
                    <div style={{ color: "#94a3b8", fontSize: 10, marginBottom: 4 }}>{result.overall_comment || "(no overall comment)"}</div>
                    {(result.per_claim || []).map((f, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid rgba(148,163,184,0.15)" }}>
                            <span style={{ color: "#60a5fa", fontWeight: 600 }}>{f.claim_id}</span>: {f.comment}
                        </div>
                    ))}
                </>
            )}
        </div>
    )
}

function CouncilFindings({ findings }) {
    if (!findings) return <div style={{ color: "#334155", fontSize: 11 }}>Council has not run yet.</div>
    const det = findings.deterministic || []
    return (
        <div>
            <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Deterministic Checks</div>
            {det.length === 0
                ? <div style={{ color: "#334155", fontSize: 10, marginBottom: 10 }}>No deterministic checks applied.</div>
                : det.map((f, i) => (
                    <div key={i} style={{ fontSize: 10, marginBottom: 3, color: f.passed ? "#4ade80" : "#f87171" }}>
                        {f.passed ? "✓" : "✗"} {f.claim_id} — {f.check}: {f.detail}
                    </div>
                ))
            }
            <div style={{ marginTop: 10 }}>
                <LensResult title="Citation Fidelity Lens" result={findings.citation_fidelity} />
                <LensResult title="Completeness Lens" result={findings.completeness} />
            </div>
        </div>
    )
}

function ReportCard({ report, snapshots, onChanged }) {
    const [expanded, setExpanded] = useState(false)
    const [full,     setFull]     = useState(null)
    const [busy,     setBusy]     = useState(false)
    const [editing,  setEditing]  = useState(false)
    const [note,     setNote]     = useState("")
    const [snapContent, setSnapContent] = useState(null)
    const [locatingId,  setLocatingId]  = useState(null)
    const [locateMsg,   setLocateMsg]   = useState(null)

    const locate = async (claim) => {
        setLocatingId(claim.claim_id); setLocateMsg(null)
        try {
            let content = snapContent
            if (!content && claim.citation?.type === "snapshot_ref") {
                const res = await fetch(`${API}/api/reports/snapshots/${full.snapshot_id}`, { headers: forgeHeaders() })
                if (res.ok) { content = (await res.json()).content; setSnapContent(content) }
            }
            const result = await locateReportClaim(claim, content)
            if (result.kind === "error") setLocateMsg(`${claim.claim_id}: ${result.reason}`)
            else if (result.kind === "map" && result.entityFound === false) setLocateMsg(`${claim.claim_id}: flew to the location — its live marker is no longer active`)
            else setLocateMsg(null)
        } catch (e) { setLocateMsg(`${claim.claim_id}: ${e.message}`) }
        finally { setLocatingId(null) }
    }

    const loadFull = async () => {
        try {
            const res = await fetch(`${API}/api/reports/${report.report_id}`, { headers: forgeHeaders() })
            if (res.ok) setFull(await res.json())
        } catch (_e) {}
    }

    const toggle = () => {
        if (expanded) { setExpanded(false); return }
        setExpanded(true)
        loadFull()
    }

    const doAction = async (action, body) => {
        setBusy(true)
        try {
            const res = await fetch(`${API}/api/reports/${report.report_id}/${action}`, {
                method: "POST", headers: forgeHeaders(), body: JSON.stringify(body || {}),
            })
            const d = await res.json()
            if (res.ok) { setFull(d); setNote(""); onChanged() } else { alert(d.detail || `${action} failed`) }
        } catch (e) { alert(e.message) }
        finally { setBusy(false) }
    }

    const downloadPdf = () => {
        fetch(`${API}/api/reports/${report.report_id}/pdf`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.blob() : Promise.reject(new Error("PDF export failed")))
            .then(blob => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = `${report.report_id}.pdf`; a.click(); URL.revokeObjectURL(u) })
            .catch(e => alert(e.message))
    }

    const row = full || report
    const statusColor = REPORT_STATUS_COLORS[row.status] || "#475569"

    return (
        <div style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={toggle}>
                <div>
                    <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{row.title}</span>
                    <span style={{ padding: "1px 6px", borderRadius: 8, marginLeft: 8, background: statusColor + "22", color: statusColor, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{row.status}</span>
                    <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{row.report_id}</span>
                </div>
                <span style={{ color: "#475569", fontSize: 10 }}>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</span>
            </div>
            <div style={{ color: "#64748b", fontSize: 10, marginTop: 4 }}>
                snapshot: {row.snapshot_id} · {(row.claims || []).length} claim(s)
                {row.reviewer && <> · reviewed by {row.reviewer}</>}
            </div>
            {expanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                    {!full ? <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div> : editing ? (
                        <ReportForm
                            snapshots={snapshots}
                            existing={full}
                            onSaved={d => { setFull(d); setEditing(false); onChanged() }}
                            onCancel={() => setEditing(false)}
                        />
                    ) : (
                        <>
                            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", marginBottom: 4 }}>{full.classification}</div>
                            {full.key_judgments && <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 10, whiteSpace: "pre-wrap" }}>{full.key_judgments}</div>}
                            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", marginBottom: 6 }}>Claims ({(full.claims || []).length})</div>
                            {(full.claims || []).map(c => (
                                <div key={c.claim_id} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid rgba(148,163,184,0.15)" }}>
                                    <div style={{ color: "#cbd5e1", fontSize: 11 }}>{c.text}</div>
                                    <div style={{ color: "#475569", fontSize: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <span>
                                            {c.citation?.type === "snapshot_ref" ? `snapshot: ${c.citation.section} / ${c.citation.item_id}` : c.citation?.url}
                                            {c.source_evaluation && (c.source_evaluation.reliability || c.source_evaluation.credibility) &&
                                                <> · Source Eval: {c.source_evaluation.reliability || "?"}{c.source_evaluation.credibility || "?"}</>}
                                        </span>
                                        <button onClick={() => locate(c)} disabled={locatingId === c.claim_id} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 10, padding: 0 }}>
                                            {locatingId === c.claim_id ? "Locating…" : c.citation?.type === "external" || c.citation?.section === "top_articles" ? "Open Source ↗" : "Locate on Map ↗"}
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {locateMsg && <div style={{ color: "#facc15", fontSize: 10, marginBottom: 8, fontStyle: "italic" }}>{locateMsg}</div>}
                            {full.status !== "draft" && (
                                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.06)" }}>
                                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", marginBottom: 6 }}>Council Findings</div>
                                    <CouncilFindings findings={full.council_findings} />
                                </div>
                            )}
                            {full.review_note && <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 8, fontStyle: "italic" }}>Reviewer note: {full.review_note}</div>}
                            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                                {full.status === "draft" && (
                                    <>
                                        <button onClick={() => setEditing(true)} style={ghostBtn}>Edit</button>
                                        <button onClick={() => doAction("submit-for-review")} disabled={busy} style={{ ...ghostBtn, color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)" }}>
                                            {busy ? "Running council…" : "Submit for Review"}
                                        </button>
                                    </>
                                )}
                                {full.status === "in_review" && (
                                    <>
                                        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reviewer note (optional)" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                                        <button onClick={() => doAction("approve", { note })} disabled={busy} style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>Approve</button>
                                        <button onClick={() => doAction("reject", { note })} disabled={busy} style={{ ...ghostBtn, color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>Reject</button>
                                    </>
                                )}
                                {full.status === "approved" && (
                                    <button onClick={() => doAction("publish")} disabled={busy} style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>Publish</button>
                                )}
                                <button onClick={downloadPdf} style={ghostBtn}>⬇ Download PDF</button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

function ReportsPanel() {
    const [reports,   setReports]   = useState([])
    const [snapshots, setSnapshots] = useState([])
    const [loaded,    setLoaded]    = useState(false)
    const [statusFilter, setStatusFilter] = useState("all")
    const [showForm, setShowForm]   = useState(false)

    const reload = () => {
        const q = statusFilter !== "all" ? `?status=${statusFilter}` : ""
        fetch(`${API}/api/reports${q}`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setReports(Array.isArray(d) ? d : []); setLoaded(true) })
            .catch(() => setLoaded(true))
    }

    const loadSnapshots = () =>
        fetch(`${API}/api/reports/snapshots?limit=50`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => setSnapshots(Array.isArray(d) ? d : []))
            .catch(() => {})

    useEffect(() => { reload() }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { loadSnapshots() }, [])

    return (
        <WorkspaceBody>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 12, maxWidth: 720 }}>
                Draft, review, and publish sourced intelligence reports. Every report cites a captured snapshot; submitting for review runs the council — a deterministic pass (citation-existence, geo-sanity) plus two independently-lensed model passes (citation fidelity, completeness) — and every step past draft requires an explicit human action.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 4 }}>
                    {["all", ...REPORT_STATUSES].map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)} style={{ ...ghostBtn, color: statusFilter === s ? (REPORT_STATUS_COLORS[s] || "#60a5fa") : "#94a3b8", borderColor: statusFilter === s ? (REPORT_STATUS_COLORS[s] || "#60a5fa") + "55" : "rgba(148,163,184,0.15)" }}>{s}</button>
                    ))}
                </div>
                <button onClick={() => setShowForm(v => !v)} disabled={snapshots.length === 0} style={{ padding: "5px 12px", borderRadius: 5, border: "none", background: showForm ? "#60a5fa" : "#1e293b", color: showForm ? "#0f172a" : "#94a3b8", fontWeight: 600, cursor: snapshots.length === 0 ? "default" : "pointer", fontSize: 10 }}
                    title={snapshots.length === 0 ? "Capture a snapshot first (Snapshots tab)" : ""}>
                    {showForm ? "Close" : "+ New Report"}
                </button>
            </div>
            {snapshots.length === 0 && <div style={{ color: "#475569", fontSize: 10, marginBottom: 10 }}>No snapshots captured yet — a report must cite one. Capture one from the Snapshots tab first.</div>}
            {showForm && <ReportForm snapshots={snapshots} onSaved={() => { setShowForm(false); reload() }} onCancel={() => setShowForm(false)} />}
            {!loaded && <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div>}
            {loaded && reports.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No {statusFilter === "all" ? "" : statusFilter + " "}reports yet.</div>}
            {reports.map(r => <ReportCard key={r.report_id} report={r} snapshots={snapshots} onChanged={reload} />)}
        </WorkspaceBody>
    )
}

function ReportsWorkspace() {
    const [tab, setTab] = useState("reports")
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Toolbar>
                <div style={{ display: "flex", gap: 2, background: "#0a0e1a", borderRadius: 4, padding: 2 }}>
                    {["reports", "snapshots"].map(t => (
                        <button key={t} onClick={() => setTab(t)} style={{ padding: "3px 10px", borderRadius: 3, border: "none", cursor: "pointer", background: tab === t ? "rgba(96,165,250,0.12)" : "transparent", color: tab === t ? "#60a5fa" : "#475569", fontSize: 10, fontWeight: tab === t ? 600 : 400 }}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </Toolbar>
            {tab === "reports" ? <ReportsPanel /> : <ReportSnapshotsWorkspace />}
        </div>
    )
}

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
        case "strategic-zones":    return <StrategicZonesWorkspace />
        case "correlation-engine": return <CorrelationEngineWorkspace />
        case "brain":           return <BrainWorkspace brainStatus={brainStatus} />
        case "rule-logic":      return <RuleLogicWorkspace isMobile={false} />
        case "ontology":        return <OntologyWorkspace />
        case "alerts":          return <AlertsWorkspace />
        case "geocoder":        return <SimpleInfo title="Geocoder" body="Provides lat/lng resolution for news events and uploaded entity data. Feeds the threat scoring engine." />
        case "briefings":       return <SimpleInfo title="Director Briefings" body="AI-generated intelligence briefings from threat scores and correlation assessments. Delivered via the Director system." />
        case "reports":         return <ReportsWorkspace />
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
// STRATEGIC ZONES WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════════

const ZONE_TYPE_LABELS = {
    CONFLICT_ACTIVE:    "Active Conflict",
    CONFLICT_FROZEN:    "Frozen Conflict",
    MILITARY_SENSITIVE: "Military Sensitive",
    ECONOMIC_CRITICAL:  "Economic Critical",
    CHOKEPOINT_EXTENDED:"Chokepoint Extended",
    NUCLEAR_SENSITIVE:  "Nuclear Sensitive",
    INSTABILITY:        "Instability",
    CUSTOM:             "Custom",
}
const SEVERITY_COLOURS = {
    critical: "#FF3B30",
    high:     "#FF9500",
    medium:   "#FFCC00",
    low:      "#34C759",
}

function StrategicZonesWorkspace() {
    const [zones, setZones]       = useState([])
    const [loading, setLoading]   = useState(true)
    const [filter, setFilter]     = useState("all")
    const [creating, setCreating] = useState(false)
    const [newZone, setNewZone]   = useState({ name: "", zone_type: "CUSTOM", severity_baseline: "medium", colour: "#FF9500", description: "" })
    const [coordStr, setCoordStr] = useState("")
    const [saveErr, setSaveErr]   = useState("")

    const load = () => {
        setLoading(true)
        fetch(`${apiBase}/api/strategic-zones?enabled_only=false`)
            .then(r => r.ok ? r.json() : [])
            .then(d => { setZones(d); setLoading(false) })
            .catch(() => setLoading(false))
    }
    useEffect(() => { load() }, [])

    const filtered = filter === "all" ? zones : zones.filter(z => z.zone_type === filter)
    const grouped  = {}
    for (const z of filtered) {
        const k = z.zone_type || "CUSTOM"
        if (!grouped[k]) grouped[k] = []
        grouped[k].push(z)
    }

    const toggleEnabled = (zone) => {
        fetch(`${apiBase}/api/strategic-zones/${zone.zone_id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !zone.enabled }),
        }).then(() => load())
    }

    const handleCreate = () => {
        setSaveErr("")
        let coords
        try {
            coords = JSON.parse(coordStr)
            if (!Array.isArray(coords) || coords.length < 4) throw new Error("Need ≥ 4 points")
        } catch (e) {
            setSaveErr("Invalid coordinates JSON: " + e.message)
            return
        }
        fetch(`${apiBase}/api/strategic-zones`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...newZone, coordinates: coords }),
        })
            .then(async r => {
                if (!r.ok) { const j = await r.json(); throw new Error(j.detail || r.status) }
                return r.json()
            })
            .then(() => { setCreating(false); load() })
            .catch(e => setSaveErr(e.message))
    }

    return (
        <WorkspaceBody>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>Strategic Zones</div>
                <button onClick={() => setCreating(c => !c)} style={{
                    background: creating ? "rgba(255,59,48,0.15)" : "rgba(255,59,48,0.1)",
                    border: "1px solid rgba(255,59,48,0.35)", borderRadius: 5,
                    color: "#FF3B30", fontSize: 11, padding: "4px 12px", cursor: "pointer",
                }}>
                    {creating ? "Cancel" : "+ New Zone"}
                </button>
            </div>

            {creating && (
                <div style={{ background: "rgba(17,24,39,0.8)", border: "1px solid rgba(255,59,48,0.2)", borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 12 }}>New Strategic Zone</div>
                    {[
                        { key: "name",              label: "Name",        type: "text"  },
                        { key: "description",       label: "Description", type: "text"  },
                        { key: "colour",            label: "Colour",      type: "color" },
                    ].map(({ key, label, type }) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>{label}</div>
                            <input type={type} value={newZone[key]} onChange={e => setNewZone(z => ({ ...z, [key]: e.target.value }))}
                                style={{ width: "100%", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 12 }} />
                        </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>Type</div>
                            <select value={newZone.zone_type} onChange={e => setNewZone(z => ({ ...z, zone_type: e.target.value }))}
                                style={{ width: "100%", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 12 }}>
                                {Object.entries(ZONE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>Severity</div>
                            <select value={newZone.severity_baseline} onChange={e => setNewZone(z => ({ ...z, severity_baseline: e.target.value }))}
                                style={{ width: "100%", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 12 }}>
                                {["critical","high","medium","low"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>Coordinates (JSON array of [lon,lat] pairs)</div>
                        <textarea value={coordStr} onChange={e => setCoordStr(e.target.value)} rows={3}
                            placeholder='[[lon1,lat1],[lon2,lat2],...]'
                            style={{ width: "100%", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 11, resize: "vertical", fontFamily: "monospace" }} />
                    </div>
                    {saveErr && <div style={{ color: "#FF3B30", fontSize: 11, marginBottom: 8 }}>{saveErr}</div>}
                    <button onClick={handleCreate} style={{
                        background: "rgba(255,59,48,0.15)", border: "1px solid rgba(255,59,48,0.4)", borderRadius: 5,
                        color: "#FF3B30", fontSize: 11, padding: "5px 14px", cursor: "pointer",
                    }}>Save Zone</button>
                </div>
            )}

            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {["all", ...Object.keys(ZONE_TYPE_LABELS)].map(k => (
                    <button key={k} onClick={() => setFilter(k)} style={{
                        background: filter === k ? "rgba(255,59,48,0.15)" : "rgba(30,41,59,0.5)",
                        border: `1px solid ${filter === k ? "rgba(255,59,48,0.4)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 4, color: filter === k ? "#FF6B6B" : "#64748b",
                        fontSize: 10, padding: "3px 8px", cursor: "pointer",
                    }}>
                        {k === "all" ? "All" : ZONE_TYPE_LABELS[k]}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div>
            ) : (
                Object.entries(grouped).map(([type, zlist]) => (
                    <div key={type} style={{ marginBottom: 18 }}>
                        <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6, textTransform: "uppercase" }}>
                            {ZONE_TYPE_LABELS[type] || type}
                        </div>
                        {zlist.map(z => (
                            <div key={z.zone_id} style={{
                                background: "rgba(17,24,39,0.7)", border: `1px solid rgba(255,255,255,0.06)`,
                                borderLeft: `3px solid ${z.colour || "#FF9500"}`, borderRadius: 5,
                                padding: "9px 12px", marginBottom: 6,
                                opacity: z.enabled ? 1 : 0.45,
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{z.name}</span>
                                            {z.is_baseline && (
                                                <span style={{ color: "#64748b", fontSize: 9, border: "1px solid rgba(100,116,139,0.3)", borderRadius: 3, padding: "0 4px" }}>BASELINE</span>
                                            )}
                                            <span style={{
                                                color: SEVERITY_COLOURS[z.severity_baseline] || "#94a3b8",
                                                fontSize: 9, fontWeight: 700,
                                            }}>{z.severity_baseline?.toUpperCase()}</span>
                                        </div>
                                        {z.description && (
                                            <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.4 }}>
                                                {z.description.length > 120 ? z.description.slice(0, 120) + "…" : z.description}
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => toggleEnabled(z)} style={{
                                        marginLeft: 10, background: z.enabled ? "rgba(52,199,89,0.1)" : "rgba(255,255,255,0.05)",
                                        border: `1px solid ${z.enabled ? "rgba(52,199,89,0.3)" : "rgba(255,255,255,0.1)"}`,
                                        borderRadius: 4, color: z.enabled ? "#34C759" : "#475569",
                                        fontSize: 10, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap",
                                    }}>
                                        {z.enabled ? "Enabled" : "Disabled"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ))
            )}
            {!loading && zones.length === 0 && (
                <div style={{ color: "#475569", fontSize: 12 }}>No zones found. Click "+ New Zone" to create one.</div>
            )}
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
                            {safeArray(config.filters).length === 0 ? <div style={{ color: "#334155", fontSize: 11 }}>No filters — all vessels in scope.</div> :
                                safeArray(config.filters).map(f => <div key={f} style={{ color: "#94a3b8", fontSize: 11, padding: "3px 0" }}>{f}</div>)}
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

const SURGE_TYPES = ["conflict", "maritime", "aviation", "infrastructure", "energy", "cyber", "disaster"]
const SEV_COLOR = { critical: "#f87171", high: "#fb923c", medium: "#fbbf24", low: "#4ade80" }

function NewsSourceWorkspace() {
    const [config, setConfig] = useState(null)
    const [newKw, setNewKw] = useState("")
    const [surgeConfig, setSurgeConfig] = useState(null)
    const [surgeEvents, setSurgeEvents] = useState([])
    const [surgeSaving, setSurgeSaving] = useState(false)
    const [surgeMsg, setSurgeMsg] = useState("")

    useEffect(() => {
        fetch(`${API}/api/forge/source/src_news/config`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : {}).then(setConfig).catch(() => setConfig({}))
        loadSurgeConfig()
        loadSurgeEvents()
        const t = setInterval(loadSurgeEvents, 60000)
        return () => clearInterval(t)
    }, [])

    const loadSurgeConfig = () =>
        fetch(`${API}/api/surge/config`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null).then(d => d && setSurgeConfig(d)).catch(() => {})

    const loadSurgeEvents = () =>
        fetch(`${API}/api/surge/events?status=active&limit=20`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : []).then(d => setSurgeEvents(safeArray(d))).catch(() => {})

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

    const saveSurge = async (patch) => {
        setSurgeSaving(true); setSurgeMsg("")
        try {
            const res = await fetch(`${API}/api/surge/config`, { method: "PUT", headers: forgeHeaders(), body: JSON.stringify(patch) })
            if (res.ok) { const d = await res.json(); setSurgeConfig(d); setSurgeMsg("Saved"); setTimeout(() => setSurgeMsg(""), 2000) }
            else setSurgeMsg("Failed")
        } catch (_e) { setSurgeMsg("Failed") }
        finally { setSurgeSaving(false) }
    }

    const toggleSurgeType = (t) => {
        const cur = safeArray(surgeConfig?.eligible_types)
        const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]
        setSurgeConfig(c => ({ ...c, eligible_types: next }))
        saveSurge({ eligible_types: next })
    }

    if (!config) return <WorkspaceBody><div style={{ color: "#475569", fontSize: 12 }}>Loading…</div></WorkspaceBody>

    const health = config.feed_health || {}
    const failCount = Object.values(health).filter(v => v > 0).length
    const sc = surgeConfig || {}

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
                            {safeArray(config.keywords).map(kw => (
                                <span key={kw} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, fontSize: 11, background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)", color: "#60a5fa" }}>
                                    {kw}
                                    <button onClick={() => removeKw(kw)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
                                </span>
                            ))}
                            {!safeArray(config.keywords).length && <span style={{ color: "#334155", fontSize: 11 }}>No keywords — scoring all events.</span>}
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

            {/* SURGE settings */}
            <div style={{ maxWidth: 680, marginTop: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#FF9500", letterSpacing: "0.05em" }}>SURGE</span>
                        <span style={{ fontSize: 11, color: "#475569" }}>Activity Surge Detection</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {surgeMsg && <span style={{ color: surgeMsg === "Saved" ? "#4ade80" : "#f87171", fontSize: 11 }}>{surgeMsg}</span>}
                        <button
                            onClick={() => saveSurge({ enabled: !sc.enabled })}
                            style={{ padding: "3px 12px", borderRadius: 6, border: "1px solid", fontSize: 11, cursor: "pointer", background: sc.enabled ? "rgba(255,149,0,0.12)" : "transparent", color: sc.enabled ? "#FF9500" : "#475569", borderColor: sc.enabled ? "rgba(255,149,0,0.3)" : "rgba(148,163,184,0.2)" }}
                        >{sc.enabled ? "Enabled" : "Disabled"}</button>
                    </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                    <div>
                        <Section title="Volume Detection">
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Window (hours)</span>
                                    <input type="number" min="1" max="24" value={sc.volume_window_hours ?? 3}
                                        onChange={e => setSurgeConfig(c => ({ ...c, volume_window_hours: +e.target.value }))}
                                        onBlur={e => saveSurge({ volume_window_hours: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Surge multiplier</span>
                                    <input type="number" min="1.2" max="10" step="0.1" value={sc.volume_multiplier ?? 2.0}
                                        onChange={e => setSurgeConfig(c => ({ ...c, volume_multiplier: +e.target.value }))}
                                        onBlur={e => saveSurge({ volume_multiplier: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Baseline days</span>
                                    <input type="number" min="1" max="30" value={sc.baseline_days ?? 7}
                                        onChange={e => setSurgeConfig(c => ({ ...c, baseline_days: +e.target.value }))}
                                        onBlur={e => saveSurge({ baseline_days: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                            </div>
                        </Section>
                        <Section title="Velocity Detection">
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Window (minutes)</span>
                                    <input type="number" min="5" max="120" value={sc.velocity_window_minutes ?? 30}
                                        onChange={e => setSurgeConfig(c => ({ ...c, velocity_window_minutes: +e.target.value }))}
                                        onBlur={e => saveSurge({ velocity_window_minutes: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Article threshold</span>
                                    <input type="number" min="2" max="50" value={sc.velocity_threshold ?? 5}
                                        onChange={e => setSurgeConfig(c => ({ ...c, velocity_threshold: +e.target.value }))}
                                        onBlur={e => saveSurge({ velocity_threshold: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ color: "#94a3b8", fontSize: 11 }}>Cooldown (minutes)</span>
                                    <input type="number" min="5" max="480" value={sc.cooldown_minutes ?? 60}
                                        onChange={e => setSurgeConfig(c => ({ ...c, cooldown_minutes: +e.target.value }))}
                                        onBlur={e => saveSurge({ cooldown_minutes: +e.target.value })}
                                        style={{ ...inputStyle, width: 60, textAlign: "right" }} />
                                </div>
                            </div>
                        </Section>
                    </div>
                    <div>
                        <Section title="Eligible Article Types">
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {SURGE_TYPES.map(t => {
                                    const on = safeArray(sc.eligible_types).includes(t)
                                    return (
                                        <button key={t} onClick={() => toggleSurgeType(t)} style={{ padding: "3px 10px", borderRadius: 12, border: "1px solid", fontSize: 11, cursor: "pointer", background: on ? "rgba(255,149,0,0.1)" : "transparent", color: on ? "#FF9500" : "#475569", borderColor: on ? "rgba(255,149,0,0.3)" : "rgba(148,163,184,0.15)" }}>{t}</button>
                                    )
                                })}
                            </div>
                        </Section>
                        <Section title={`Active Surges (${surgeEvents.length})`}>
                            {surgeEvents.length === 0
                                ? <div style={{ color: "#334155", fontSize: 11 }}>No active surges.</div>
                                : surgeEvents.map(ev => (
                                    <div key={ev.surge_id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(148,163,184,0.05)" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: `${SEV_COLOR[ev.severity] ?? "#94a3b8"}22`, color: SEV_COLOR[ev.severity] ?? "#94a3b8", fontWeight: 600, letterSpacing: "0.04em" }}>{ev.severity.toUpperCase()}</span>
                                            <span style={{ color: "#e2e8f0", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.headline}</span>
                                        </div>
                                        <div style={{ color: "#475569", fontSize: 10 }}>{ev.time_window_description}</div>
                                    </div>
                                ))
                            }
                        </Section>
                    </div>
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

    // Optional citation metadata — carried through to any entity-relationship
    // claim this upload's document extraction produces, so a reviewer sees a
    // real source instead of just "uploaded document".
    const [srcTitle, setSrcTitle]         = useState("")
    const [srcPublisher, setSrcPublisher] = useState("")
    const [srcDate, setSrcDate]           = useState("")
    const [srcUrl, setSrcUrl]             = useState("")

    const reload = () =>
        fetch(`${API}/api/forge/uploads`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : []).then(d => setUploads(Array.isArray(d) ? d : [])).catch(() => {})

    useEffect(() => { reload() }, [])

    const upload = async (e) => {
        const file = e.target.files?.[0]; if (!file) return
        setUploading(true); setMsg("")
        const fd = new FormData()
        fd.append("file", file)
        if (srcTitle) fd.append("source_title", srcTitle)
        if (srcPublisher) fd.append("source_publisher", srcPublisher)
        if (srcDate) fd.append("source_date", srcDate)
        if (srcUrl) fd.append("source_url", srcUrl)
        try {
            const res = await fetch(`${API}/api/forge/upload`, { method: "POST", headers: forgeFormHeaders(), body: fd })
            const d = await res.json()
            if (res.ok) {
                const pending = d.relationships_pending || 0
                setMsg(`Uploaded: ${d.filename || file.name} — ${d.entities_extracted || 0} entities` +
                    (pending ? `, ${pending} relationship claim(s) awaiting review below` : ""))
                reload()
            } else {
                setMsg(d.detail || "Failed")
            }
        } catch (_e) { setMsg("Upload failed") }
        finally { setUploading(false); if (fileRef.current) fileRef.current.value = "" }
    }

    return (
        <WorkspaceBody>
            <div style={{ maxWidth: 640 }}>
                <Section title="Upload Intelligence File">
                    <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>CSV, KML, and GeoJSON files are parsed for entities and added to the ontology graph directly. PDF/text documents are also checked for entity relationships — those land in the pending review queue below, not the live graph, until approved.</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                        <input value={srcTitle} onChange={e => setSrcTitle(e.target.value)} placeholder="Source title (optional)" style={inputStyle} />
                        <input value={srcPublisher} onChange={e => setSrcPublisher(e.target.value)} placeholder="Publisher (optional)" style={inputStyle} />
                        <input value={srcDate} onChange={e => setSrcDate(e.target.value)} placeholder="Source date (optional)" style={inputStyle} />
                        <input value={srcUrl} onChange={e => setSrcUrl(e.target.value)} placeholder="Source URL (optional)" style={inputStyle} />
                    </div>
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
                                <div style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 500 }}>{u.filename}</div>
                                <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
                                    {u.type || "auto"} · {u.entities_extracted || 0} entities
                                    {u.relationships_pending ? ` · ${u.relationships_pending} claim(s) pending review` : ""}
                                    {" · "}{u.uploaded_at?.slice(0, 10) || "—"}
                                </div>
                            </div>
                        </div>
                    ))}
                </Section>
            </div>
            <OntologyClaimsReview />
        </WorkspaceBody>
    )
}

// ── Entity-relationship claims review queue ─────────────────────────────────
//
// Every relationship a document upload extracts lands here as "pending" — it
// is never merged into the live ontology graph on its own. A person reads the
// cited excerpt and either approves it (creating the two entity nodes plus a
// cited edge) or rejects it. This mirrors the report pipeline's human-review
// gate, applied to ingested entity relationships.
function OntologyClaimsReview() {
    const [claims, setClaims] = useState([])
    const [statusFilter, setStatusFilter] = useState("pending")
    const [busyId, setBusyId] = useState(null)
    const [loaded, setLoaded] = useState(false)

    const reload = () =>
        fetch(`${API}/api/forge/ontology/claims?status=${statusFilter}`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setClaims(Array.isArray(d) ? d : []); setLoaded(true) })
            .catch(() => setLoaded(true))

    useEffect(() => { reload() }, [statusFilter])

    const act = async (claimId, action) => {
        setBusyId(claimId)
        try {
            const res = await fetch(`${API}/api/forge/ontology/claims/${claimId}/${action}`, {
                method: "POST", headers: forgeHeaders(), body: JSON.stringify({}),
            })
            if (res.ok) reload()
        } catch (_e) { /* leave as pending, reviewer can retry */ }
        finally { setBusyId(null) }
    }

    return (
        <Section title={`Entity-Relationship Claims — Pending Review`}>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 10 }}>
                Relationships extracted from uploaded documents (or loaded from an offline sourcing pass) wait here, each with its own citation, until approved. Nothing below is live in the ontology graph yet.
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {["pending", "approved", "rejected", "all"].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                        style={{ ...ghostBtn, background: statusFilter === s ? "rgba(96,165,250,0.15)" : "transparent", color: statusFilter === s ? "#60a5fa" : "#94a3b8" }}>
                        {s}
                    </button>
                ))}
            </div>
            {!loaded && <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div>}
            {loaded && claims.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No {statusFilter === "all" ? "" : statusFilter} claims.</div>}
            {claims.map(c => (
                <div key={c.claim_id} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                        {c.entity_a.label} <span style={{ color: "#60a5fa" }}>— {c.relationship_type} →</span> {c.entity_b.label}
                        {c.as_of && <span style={{ color: "#475569", fontWeight: 400 }}> ({c.as_of})</span>}
                    </div>
                    {c.source.excerpt && (
                        <div style={{ color: "#94a3b8", fontSize: 11, fontStyle: "italic", marginBottom: 4, borderLeft: "2px solid rgba(148,163,184,0.2)", paddingLeft: 8 }}>
                            "{c.source.excerpt}"
                        </div>
                    )}
                    <div style={{ color: "#475569", fontSize: 10, marginBottom: 8 }}>
                        {c.source.title || "Untitled source"}{c.source.publisher ? ` · ${c.source.publisher}` : ""}{c.source.date ? ` · ${c.source.date}` : ""}
                        {c.source.url && <>{" · "}<a href={c.source.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>source ↗</a></>}
                        {" · confidence: "}{c.confidence || "unset"}
                        {c.status !== "pending" && <> · <span style={{ color: c.status === "approved" ? "#4ade80" : "#f87171" }}>{c.status}</span>{c.reviewer ? ` by ${c.reviewer}` : ""}</>}
                    </div>
                    {c.status === "pending" && (
                        <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => act(c.claim_id, "approve")} disabled={busyId === c.claim_id}
                                style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>
                                {busyId === c.claim_id ? "…" : "Approve"}
                            </button>
                            <button onClick={() => act(c.claim_id, "reject")} disabled={busyId === c.claim_id}
                                style={{ ...ghostBtn, color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>
                                {busyId === c.claim_id ? "…" : "Reject"}
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </Section>
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

const NEWS_PATTERN_DEFS = {
    RISING_TENSIONS:       { label: "Rising Tensions",        article_count_threshold: 4, timeframe_hours: 24, min_relevance_score: 6.5, cooldown_hours: 6  },
    PORT_DISRUPTION:       { label: "Port Disruption",        article_count_threshold: 3, timeframe_hours: 12, min_relevance_score: 6.0, cooldown_hours: 8  },
    INFRASTRUCTURE_THREAT: { label: "Infrastructure Threat",  article_count_threshold: 3, timeframe_hours: 24, min_relevance_score: 7.0, cooldown_hours: 12 },
    ESCALATION_SPIKE:      { label: "Escalation Spike",       article_count_threshold: 6, timeframe_hours: 6,  min_relevance_score: 6.0, cooldown_hours: 4  },
    SANCTIONS_PRESSURE:    { label: "Sanctions Pressure",     article_count_threshold: 4, timeframe_hours: 48, min_relevance_score: 6.5, cooldown_hours: 24 },
    MILITARY_MOBILISATION: { label: "Military Mobilisation",  article_count_threshold: 3, timeframe_hours: 24, min_relevance_score: 7.0, cooldown_hours: 12 },
    HUMANITARIAN_CRISIS:   { label: "Humanitarian Crisis",    article_count_threshold: 4, timeframe_hours: 24, min_relevance_score: 6.0, cooldown_hours: 8  },
    CEASEFIRE_BREAKDOWN:   { label: "Ceasefire Breakdown",    article_count_threshold: 3, timeframe_hours: 24, min_relevance_score: 7.0, cooldown_hours: 12 },
    ENERGY_SUPPLY_RISK:    { label: "Energy Supply Risk",     article_count_threshold: 3, timeframe_hours: 24, min_relevance_score: 6.5, cooldown_hours: 8  },
}

const NEWS_ARTICLE_TYPES = ["conflict", "sanctions", "military", "humanitarian", "energy", "infrastructure", "political", "diplomatic"]

const TRIGGER_TYPES = {
    AIS: [
        { value: "stationary_near_infrastructure", label: "Loitering near infrastructure (cable / port)", params: { infra_type: "cable", max_speed_knots: 0.5, proximity_km: 10, min_duration_minutes: 120 } },
        { value: "AIS_DARK_SHIP",                  label: "AIS Dark Ship (gap detection)", params: { min_gap_minutes: 60, min_speed_before_gap: 2.0 } },
        { value: "AIS_CHOKEPOINT_ACTIVITY",        label: "AIS Chokepoint Activity (transit / loitering)", params: { target: "ALL", monitor_transit: true, monitor_loitering: false, min_loiter_duration_minutes: 45, max_loiter_speed_knots: 1.0 } },
    ],
    ADSB: [
        { value: "ADSB_LOITERING_NEAR_AIRPORT", label: "ADSB Loitering near airport", params: { airport_types: ["large_airport", "medium_airport"], proximity_km: 5, min_duration_minutes: 20, max_speed_knots: 200 } },
    ],
    NEWS: [
        { value: "NEWS_PATTERN", label: "News Pattern Detection", params: { article_count_threshold: 4, timeframe_hours: 24, min_relevance_score: 6.0, cooldown_hours: 6 } },
    ],
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

    // Dark ship state
    const [darkRegion, setDarkRegion]   = useState("")   // last_known_region for dark ship
    const [iconType, setIconType]       = useState("")   // optional ALERT_ICONS key override

    // News pattern state
    const [newsPatternType, setNewsPatternType] = useState("RISING_TENSIONS")
    const [newsArticleTypes, setNewsArticleTypes] = useState([])
    const [newsKeywordsReq, setNewsKeywordsReq]   = useState("")
    const [newsKeywordsExcl, setNewsKeywordsExcl] = useState("")
    const [newsLocScope, setNewsLocScope]         = useState("ALL")
    const [newsLocValue, setNewsLocValue]         = useState("")

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
    const isDarkRule    = source === "AIS"  && triggerType === "AIS_DARK_SHIP"
    const isLoiterRule  = source === "ADSB" && triggerType === "ADSB_LOITERING_NEAR_AIRPORT"
    const isChokeRule   = source === "AIS"  && triggerType === "AIS_CHOKEPOINT_ACTIVITY"
    const isNewsRule    = source === "NEWS" && triggerType === "NEWS_PATTERN"
    const isDbRule      = isInfraRule || isDarkRule || isLoiterRule || isChokeRule || isNewsRule

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
        setNewsPatternType("RISING_TENSIONS"); setNewsArticleTypes([]); setNewsKeywordsReq(""); setNewsKeywordsExcl(""); setNewsLocScope("ALL"); setNewsLocValue("")
    }

    const selectNewsPattern = (pt) => {
        setNewsPatternType(pt)
        const def = NEWS_PATTERN_DEFS[pt] || {}
        setParams(p => ({
            ...p,
            article_count_threshold: def.article_count_threshold ?? p.article_count_threshold,
            timeframe_hours:         def.timeframe_hours         ?? p.timeframe_hours,
            min_relevance_score:     def.min_relevance_score     ?? p.min_relevance_score,
            cooldown_hours:          def.cooldown_hours          ?? p.cooldown_hours,
        }))
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
                } else if (isNewsRule) {
                    ruleBody = {
                        rule_name: name,
                        trigger_type: "NEWS_PATTERN",
                        severity,
                        icon_type: newsPatternType,
                        params: {
                            pattern_type:            newsPatternType,
                            article_count_threshold: parseInt(params.article_count_threshold ?? 4),
                            timeframe_hours:         parseInt(params.timeframe_hours ?? 24),
                            min_relevance_score:     parseFloat(params.min_relevance_score ?? 6.0),
                            cooldown_hours:          parseInt(params.cooldown_hours ?? 6),
                            ...(newsArticleTypes.length > 0 ? { article_types: newsArticleTypes } : {}),
                            ...(newsKeywordsReq.trim() ? { keywords_required: newsKeywordsReq.split(",").map(s => s.trim()).filter(Boolean) } : {}),
                            ...(newsKeywordsExcl.trim() ? { keywords_excluded: newsKeywordsExcl.split(",").map(s => s.trim()).filter(Boolean) } : {}),
                            ...(newsLocScope === "COUNTRY" && newsLocValue.trim() ? { location_scope: newsLocValue.trim().toUpperCase() } : {}),
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
                ) : isNewsRule ? (
                    <>
                        {fld("Pattern Type", (
                            <select value={newsPatternType} onChange={e => selectNewsPattern(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                {Object.entries(NEWS_PATTERN_DEFS).map(([key, def]) => (
                                    <option key={key} value={key}>{def.label}</option>
                                ))}
                            </select>
                        ))}
                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {[
                                ["article_count_threshold", "Article threshold",    params.article_count_threshold ?? 4],
                                ["timeframe_hours",         "Timeframe (hours)",    params.timeframe_hours ?? 24],
                                ["min_relevance_score",     "Min relevance (0–10)", params.min_relevance_score ?? 6.0],
                                ["cooldown_hours",          "Cooldown (hours)",     params.cooldown_hours ?? 6],
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
                        {fld("Location Scope", (
                            <select value={newsLocScope} onChange={e => { setNewsLocScope(e.target.value); setNewsLocValue("") }} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                                <option value="ALL">All locations globally</option>
                                <option value="COUNTRY">Specific country (ISO-2)</option>
                            </select>
                        ))}
                        {newsLocScope === "COUNTRY" && fld("Country code (e.g. UA, RU, CN)", (
                            <input value={newsLocValue} onChange={e => setNewsLocValue(e.target.value.toUpperCase())}
                                placeholder="e.g. UA" maxLength={2}
                                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        ))}
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ color: "#475569", fontSize: 10, display: "block", marginBottom: 6 }}>Article Types to Include (leave unchecked for all)</label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4px 10px" }}>
                                {NEWS_ARTICLE_TYPES.map(at => (
                                    <label key={at} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: "#94a3b8", fontSize: 10 }}>
                                        <input type="checkbox"
                                            checked={newsArticleTypes.includes(at)}
                                            onChange={e => setNewsArticleTypes(prev => e.target.checked ? [...prev, at] : prev.filter(t => t !== at))}
                                            style={{ accentColor: "#60a5fa" }} />
                                        {at}
                                    </label>
                                ))}
                            </div>
                        </div>
                        {fld("Keywords required (comma-sep, leave blank for none)", (
                            <input value={newsKeywordsReq} onChange={e => setNewsKeywordsReq(e.target.value)}
                                placeholder="e.g. ceasefire, evacuation"
                                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                        ))}
                        {fld("Keywords excluded (comma-sep, leave blank for none)", (
                            <input value={newsKeywordsExcl} onChange={e => setNewsKeywordsExcl(e.target.value)}
                                placeholder="e.g. historical, anniversary"
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

                {isDbRule && !isNewsRule && fld("Alert Icon (optional)", (
                    <select value={iconType} onChange={e => setIconType(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                        <option value="">Default for rule type</option>
                        {Object.entries(ALERT_ICONS).filter(([key]) => !NEWS_PATTERN_ICON_KEYS.has(key)).map(([key, def]) => (
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
    const verticesRef    = useRef([])
    const markerEntRef   = useRef([])
    const polyEntRef     = useRef(null)
    const lineEntRef     = useRef(null)
    const isClosedRef    = useRef(false)
    const [uiState, setUiState] = useState({ count: 0, area: null, closed: false, err: null })
    const [searchQuery,  setSearchQuery]  = useState("")
    const [suggestions,  setSuggestions]  = useState([])
    const [searching,    setSearching]    = useState(false)
    const searchDebounce = useRef(null)

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

            // Country borders always-on
            fetch(`${API}/geo/countries`)
                .then(r => r.ok ? r.json() : null)
                .then(geo => {
                    if (!geo || !viewer || viewer.isDestroyed()) return
                    const { GeoJsonDataSource: GDS, Color: CC } = C
                    const features = []
                    for (const f of (geo.features || [])) {
                        const geom = f.geometry
                        if (!geom) continue
                        const rings = []
                        if (geom.type === "Polygon") rings.push(...geom.coordinates)
                        else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) rings.push(...p)
                        else { features.push(f); continue }
                        for (const ring of rings) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: f.properties })
                    }
                    return GDS.load({ type: "FeatureCollection", features }, { stroke: CC.fromCssColorString("rgba(0,255,136,0.40)"), strokeWidth: 1, clampToGround: true })
                })
                .then(ds => { if (ds && viewer && !viewer.isDestroyed()) viewer.dataSources.add(ds) })
                .catch(() => {})

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

    function handleSearchChange(val) {
        setSearchQuery(val)
        clearTimeout(searchDebounce.current)
        if (!val.trim() || val.length < 2) { setSuggestions([]); return }
        setSearching(true)
        searchDebounce.current = setTimeout(() => {
            fetch(`${API}/api/search?q=${encodeURIComponent(val)}&types=airport,port,chokepoint,location&limit=8`)
                .then(r => r.ok ? r.json() : [])
                .then(d => { setSuggestions(Array.isArray(d) ? d : []); setSearching(false) })
                .catch(() => setSearching(false))
        }, 300)
    }

    function _altForSearchResult(r) {
        if (r.type === "airport" || r.type === "port") return 80_000
        if (r.type === "chokepoint") return 200_000
        if (r.category === "country" || r.category === "boundary") return 1_000_000
        if (r.osm_type === "relation") return 800_000
        return 300_000
    }

    function handleFlyTo(result) {
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return
        const lon = result.lon ?? result.lng ?? result.longitude
        const lat = result.lat ?? result.latitude
        if (lon == null || lat == null) return
        import("cesium").then(({ Cartesian3 }) => {
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, _altForSearchResult(result)),
                duration: 1.5,
            })
        }).catch(() => {})
        setSuggestions([])
        setSearchQuery(result.name || result.display_name || "")
    }

    const { count, area, closed, err } = uiState

    return (
        <div>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 8 }}>
                Fly to your area of interest and draw a polygon. Click to place points, double-click to close.
            </div>
            {/* Location search */}
            <div style={{ position: "relative", marginBottom: 8 }}>
                <input
                    type="text"
                    placeholder="Search location…"
                    value={searchQuery}
                    onChange={e => handleSearchChange(e.target.value)}
                    style={{
                        width: "100%", boxSizing: "border-box",
                        background: "#0F1721", border: "1px solid #1e293b",
                        borderRadius: 5, color: "#94a3b8", fontSize: 11,
                        padding: "5px 8px", outline: "none",
                    }}
                />
                {searching && <span style={{ position: "absolute", right: 8, top: 5, color: "#475569", fontSize: 10 }}>…</span>}
                {suggestions.length > 0 && (
                    <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                        background: "#0F1721", border: "1px solid #1e293b", borderRadius: 5,
                        maxHeight: 160, overflowY: "auto",
                    }}>
                        {suggestions.map((r, i) => (
                            <div
                                key={i}
                                onClick={() => handleFlyTo(r)}
                                style={{
                                    padding: "6px 10px", fontSize: 11, color: "#94a3b8",
                                    cursor: "pointer", borderBottom: "1px solid #0f1721",
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            >
                                {r.name || r.display_name || "Unknown"}
                            </div>
                        ))}
                    </div>
                )}
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
    const [interval, setInterval] = useState(120)
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
                                    <option value={24}>Every 24h</option>
                                    <option value={72}>Every 3 days</option>
                                    <option value={120}>Every 5 days (default)</option>
                                    <option value={168}>Every 7 days</option>
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
    const [bboxFeatures, setBboxFeatures] = useState([])
    const [imgUrl, setImgUrl] = useState(null)
    const [selectedDet, setSelectedDet] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!scan?.scan_id) return
        setLoading(true)
        fetch(`${API}/api/watch-zones/${zone.system_id}/scans/${scan.scan_id}/detections`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { features: [] })
            .then(d => {
                const centroids = (d.features || []).filter(f => f.properties?.feature_role === "centroid")
                const bboxes    = (d.features || []).filter(f => f.properties?.feature_role === "bbox")
                setDets(centroids)
                setBboxFeatures(bboxes)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [scan?.scan_id])

    useEffect(() => {
        const b = zone?.bbox
        if (!b) return
        setImgUrl(null)
        fetch(`${API}/api/sentinel/imagery`, {
            method: "POST",
            headers: { ...forgeHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
                bounds: { west: b.min_lon, south: b.min_lat, east: b.max_lon, north: b.max_lat },
                image_type: "true-colour", max_cloud: 30, days_back: 90,
            }),
        })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.image) setImgUrl(`data:image/png;base64,${d.image}`) })
            .catch(() => {})
    }, [zone?.system_id])

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
                    ["Image captured", scan.image_timestamp_utc ? scan.image_timestamp_utc.slice(0, 16).replace("T", " ") + " UTC" : "—"],
                    ["Scanned", scan.created_at ? new Date(scan.created_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"],
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

            {/* Detection map — satellite image background + SVG bbox overlays */}
            {dets.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ color: "#475569", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Detection map</div>
                    <div style={{ position: "relative", background: "#060a14", border: "1px solid rgba(148,163,184,0.06)", borderRadius: 3, height: 180, overflow: "hidden" }}>
                        {/* Satellite image background */}
                        {imgUrl && (
                            <img src={imgUrl} alt="zone imagery"
                                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "fill", opacity: 0.85 }} />
                        )}

                        {/* SVG overlay — bounding box rectangles */}
                        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                            {bboxFeatures.map((f, i) => {
                                const ring = f.geometry?.coordinates?.[0]
                                if (!ring || ring.length < 4) return null
                                const b = zone.bbox
                                if (!b) return null
                                const lons = ring.map(c => c[0])
                                const lats = ring.map(c => c[1])
                                const x1 = (Math.min(...lons) - b.min_lon) / (b.max_lon - b.min_lon) * 100
                                const x2 = (Math.max(...lons) - b.min_lon) / (b.max_lon - b.min_lon) * 100
                                const y1 = (1 - (Math.max(...lats) - b.min_lat) / (b.max_lat - b.min_lat)) * 100
                                const y2 = (1 - (Math.min(...lats) - b.min_lat) / (b.max_lat - b.min_lat)) * 100
                                const col = DET_COLORS[f.properties?.object_type] || "#ffffff"
                                const pid = f.properties?.parent_detection_id
                                const selIdx = dets.findIndex(d => d.properties?.detection_id === pid)
                                return (
                                    <rect key={i}
                                        x={`${Math.max(0, x1)}%`} y={`${Math.max(0, y1)}%`}
                                        width={`${Math.max(0.3, x2 - x1)}%`} height={`${Math.max(0.3, y2 - y1)}%`}
                                        fill="none" stroke={col}
                                        strokeWidth={selIdx === selectedDet ? 2 : 1}
                                        opacity={selIdx === selectedDet ? 1 : 0.75}
                                        style={{ pointerEvents: "all", cursor: "pointer" }}
                                        onClick={() => setSelectedDet(selIdx === selectedDet ? null : selIdx)}
                                    />
                                )
                            })}
                        </svg>

                        {/* Centroid dots — fallback if no bbox polygon */}
                        {dets.map((f, i) => {
                            const p = f.properties
                            const hasBbox = bboxFeatures.some(b => b.properties?.parent_detection_id === p?.detection_id)
                            if (hasBbox) return null
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
                                        width: 6, height: 6,
                                        background: col, opacity: isSelected ? 1 : 0.8,
                                        border: isSelected ? `2px solid #fff` : `1px solid ${col}`,
                                        borderRadius: 1, cursor: "pointer", transform: "translate(-50%,-50%)",
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
                                    background: "rgba(0,0,0,0.85)", borderRadius: 3, padding: "5px 8px",
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

const OW_CAT_COLORS = { Aircraft: "#5856D6", Vessel: "#34AADC", Ship: "#34AADC", Vehicle: "#FF9500", Building: "#FF9500", Military: "#FF3B30", Other: "#FFCC00" }
const OW_CATS = ["Aircraft", "Vessel", "Vehicle", "Military", "Building", "Other"]

function OwScanChart({ scans }) {
    if (!scans?.length) return null
    const chartData = [...scans].reverse().slice(-20).map(s => {
        const cats = s.by_category || {}
        const row = { date: s.created_at ? new Date(s.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—" }
        let other = s.total || 0
        for (const cat of OW_CATS.filter(c => c !== "Other")) {
            const v = cats[cat] || 0
            row[cat] = v
            other -= v
        }
        row["Other"] = Math.max(0, other)
        return row
    })
    const latest = scans[0]
    const prev   = scans[1]
    const delta  = prev ? (latest?.total || 0) - (prev?.total || 0) : null
    const topCat = Object.entries(latest?.by_category || {}).sort((a, b) => b[1] - a[1])[0]
    return (
        <div style={{ background: "#0f1827", borderRadius: 6, padding: "12px 10px", marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 20, marginBottom: 8, flexWrap: "wrap" }}>
                <div>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>Latest scan</div>
                    <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>{latest?.total ?? "—"}</div>
                </div>
                {delta !== null && (
                    <div>
                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>vs previous</div>
                        <div style={{ color: delta > 0 ? "#f87171" : delta < 0 ? "#4ade80" : "#475569", fontSize: 16, fontWeight: 700 }}>
                            {delta > 0 ? `+${delta}` : delta}
                        </div>
                    </div>
                )}
                {topCat && (
                    <div>
                        <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>top category</div>
                        <div style={{ color: OW_CAT_COLORS[topCat[0]] || "#94a3b8", fontSize: 13, fontWeight: 700 }}>{topCat[0]} ({topCat[1]})</div>
                    </div>
                )}
                <div>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>source</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{latest?.imagery_source || "—"}</div>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <XAxis dataKey="date" tick={{ fill: "#334155", fontSize: 9 }} />
                    <YAxis tick={{ fill: "#334155", fontSize: 9 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 4, fontSize: 11 }} />
                    {OW_CATS.map(cat => (
                        <Bar key={cat} dataKey={cat} stackId="a" fill={OW_CAT_COLORS[cat]} maxBarSize={32} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

function SurveillanceZonesWorkspace() {
    const [zones, setZones] = useState([])
    const [owScans, setOwScans] = useState([])
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

    const reloadOwScans = () =>
        fetch(`${API}/api/overwatch/scans?limit=30`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { scans: [] })
            .then(d => setOwScans(d.scans || []))
            .catch(() => {})

    useEffect(() => { reload(); reloadOwScans() }, [])

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
        if (!confirm(`Delete zone "${zone.name}" and all scan history? This cannot be undone.`)) return
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
                    {owScans.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                Manual Overwatch scans ({owScans.length})
                            </div>
                            <OwScanChart scans={owScans} />
                        </div>
                    )}

                    {zones.length === 0 && owScans.length === 0 && (
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
                                                                <span style={{ color: "#334155", fontSize: 9, flex: 1 }}>
                                                                    {scan.created_at ? new Date(scan.created_at).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" }) : "—"}
                                                                </span>
                                                                {scan.image_timestamp_utc && (
                                                                    <span style={{ color: "#1e3a5f", fontSize: 9 }} title="Image capture date">
                                                                        img {scan.image_timestamp_utc.slice(0, 10)}
                                                                    </span>
                                                                )}
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

// ── Assets — civilian/military/dual-use infrastructure registry ────────────
//
// A purpose-built registry for "is this port civilian, military, or
// dual-use, and who owns it" — a question the rest of the ontology graph has
// no fields for. Every row requires a real citation; the backend rejects
// creation and edits that would leave a row without one.
const ASSET_CATEGORIES = ["civilian", "military", "dual_use", "unknown"]
const ASSET_CATEGORY_COLORS = { civilian: "#4ade80", military: "#f87171", dual_use: "#facc15", unknown: "#475569" }

function AssetForm({ onSaved, onCancel }) {
    const [form, setForm] = useState({
        name: "", asset_type: "", category: "dual_use", owner: "", operator: "", country: "",
        lat: "", lng: "", description: "", region_tag: "", confidence: "direct",
        source_title: "", source_publisher: "", source_date: "", source_url: "", source_excerpt: "",
    })
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState(null)
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

    const save = async () => {
        setSaving(true); setErr(null)
        try {
            const payload = { ...form, lat: form.lat ? parseFloat(form.lat) : null, lng: form.lng ? parseFloat(form.lng) : null }
            const res = await fetch(`${API}/api/forge/assets`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify(payload) })
            const d = await res.json()
            if (res.ok) { onSaved(d) } else { setErr(d.detail || "Save failed") }
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <div style={{ background: "#0d1422", borderRadius: 6, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Name *" style={inputStyle} />
                <input value={form.asset_type} onChange={e => set("asset_type", e.target.value)} placeholder="Type * (port, airbase, naval_base…)" style={inputStyle} />
                <select value={form.category} onChange={e => set("category", e.target.value)} style={inputStyle}>
                    {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={form.confidence} onChange={e => set("confidence", e.target.value)} style={inputStyle}>
                    <option value="direct">confidence: direct</option>
                    <option value="inferred">confidence: inferred</option>
                </select>
                <input value={form.owner} onChange={e => set("owner", e.target.value)} placeholder="Owner" style={inputStyle} />
                <input value={form.operator} onChange={e => set("operator", e.target.value)} placeholder="Operator (if different)" style={inputStyle} />
                <input value={form.country} onChange={e => set("country", e.target.value)} placeholder="Country" style={inputStyle} />
                <input value={form.region_tag} onChange={e => set("region_tag", e.target.value)} placeholder="Region tag (e.g. red_sea_bab_el_mandeb)" style={inputStyle} />
                <input value={form.lat} onChange={e => set("lat", e.target.value)} placeholder="Lat" style={inputStyle} />
                <input value={form.lng} onChange={e => set("lng", e.target.value)} placeholder="Lng" style={inputStyle} />
            </div>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="Description" rows={2} style={{ ...inputStyle, width: "100%", marginBottom: 8, resize: "vertical" }} />
            <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Citation (required)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input value={form.source_title} onChange={e => set("source_title", e.target.value)} placeholder="Source title" style={inputStyle} />
                <input value={form.source_publisher} onChange={e => set("source_publisher", e.target.value)} placeholder="Publisher" style={inputStyle} />
                <input value={form.source_date} onChange={e => set("source_date", e.target.value)} placeholder="Source date" style={inputStyle} />
                <input value={form.source_url} onChange={e => set("source_url", e.target.value)} placeholder="Source URL" style={inputStyle} />
            </div>
            <textarea value={form.source_excerpt} onChange={e => set("source_excerpt", e.target.value)} placeholder="Quoted excerpt grounding the category/ownership claim *" rows={2} style={{ ...inputStyle, width: "100%", marginBottom: 8, resize: "vertical" }} />
            {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={save} disabled={saving} style={{ ...ghostBtn, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)" }}>{saving ? "Saving…" : "Save Asset"}</button>
                <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            </div>
        </div>
    )
}

function AssetsPanel() {
    const [assets, setAssets]   = useState([])
    const [loaded, setLoaded]   = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [categoryFilter, setCategoryFilter] = useState("all")
    const [regionFilter, setRegionFilter]     = useState("")

    const reload = () => {
        const params = new URLSearchParams()
        if (categoryFilter !== "all") params.set("category", categoryFilter)
        if (regionFilter.trim()) params.set("region_tag", regionFilter.trim())
        fetch(`${API}/api/forge/assets?${params.toString()}`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setAssets(Array.isArray(d) ? d : []); setLoaded(true) })
            .catch(() => setLoaded(true))
    }

    useEffect(() => { reload() }, [categoryFilter, regionFilter]) // eslint-disable-line react-hooks/exhaustive-deps

    const del = async (assetId) => {
        if (!confirm("Delete this asset?")) return
        try {
            await fetch(`${API}/api/forge/assets/${assetId}`, { method: "DELETE", headers: forgeHeaders() })
            reload()
        } catch (_e) {}
    }

    return (
        <WorkspaceBody>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 12, maxWidth: 720 }}>
                Civilian, military, and dual-use infrastructure — the categorization and ownership fields the rest of the ontology graph doesn't have. Every asset requires a real citation; nothing here is guessed.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 4 }}>
                    {["all", ...ASSET_CATEGORIES].map(c => (
                        <button key={c} onClick={() => setCategoryFilter(c)} style={{ ...ghostBtn, color: categoryFilter === c ? (ASSET_CATEGORY_COLORS[c] || "#60a5fa") : "#94a3b8", borderColor: categoryFilter === c ? (ASSET_CATEGORY_COLORS[c] || "#60a5fa") + "55" : "rgba(148,163,184,0.15)" }}>{c}</button>
                    ))}
                </div>
                <input value={regionFilter} onChange={e => setRegionFilter(e.target.value)} placeholder="Filter by region tag…" style={{ ...inputStyle, maxWidth: 220 }} />
                <button onClick={() => setShowForm(v => !v)} style={{ padding: "5px 12px", borderRadius: 5, border: "none", background: showForm ? "#60a5fa" : "#1e293b", color: showForm ? "#0f172a" : "#94a3b8", fontWeight: 600, cursor: "pointer", fontSize: 10 }}>
                    {showForm ? "Close" : "+ Asset"}
                </button>
            </div>
            {showForm && <AssetForm onSaved={() => { setShowForm(false); reload() }} onCancel={() => setShowForm(false)} />}
            {!loaded && <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div>}
            {loaded && assets.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No assets yet — click "+ Asset" to add one (a real citation is required).</div>}
            {assets.map(a => (
                <div key={a.asset_id} style={{ background: "#111827", borderRadius: 4, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                            <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                            <span style={{ padding: "1px 6px", borderRadius: 8, marginLeft: 8, background: (ASSET_CATEGORY_COLORS[a.category] || "#475569") + "22", color: ASSET_CATEGORY_COLORS[a.category] || "#475569", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{a.category}</span>
                            <span style={{ color: "#475569", fontSize: 10, marginLeft: 8 }}>{a.asset_type}</span>
                        </div>
                        <button onClick={() => del(a.asset_id)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 11 }} title="Delete">✕</button>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 10, marginTop: 4 }}>
                        {a.owner && <>Owner: {a.owner} · </>}
                        {a.operator && <>Operator: {a.operator} · </>}
                        {a.country && <>{a.country} · </>}
                        {a.region_tag && <>region: {a.region_tag} · </>}
                        confidence: {a.confidence || "unset"}
                    </div>
                    {a.description && <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 6 }}>{a.description}</div>}
                    <div style={{ color: "#475569", fontSize: 10, marginTop: 6, fontStyle: "italic", borderLeft: "2px solid rgba(148,163,184,0.2)", paddingLeft: 8 }}>
                        "{a.source?.excerpt}" — {a.source?.title || "untitled source"}
                        {a.source?.url && <>{" "}<a href={a.source.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>↗</a></>}
                    </div>
                </div>
            ))}
        </WorkspaceBody>
    )
}

// ── Discovered patterns — the convergence-engine reasoning layer ────────────
//
// Everything here is COMPUTED from edges the review queue already approved
// (each hop still carries its own citation) — it never introduces a new
// unsourced fact. What it adds is the connection itself: "A relates to B"
// and "B relates to C" were each independently approved, but nobody had
// pointed out that A and C might therefore be worth looking at together.
// Star/dismiss just tracks an analyst's read on whether a given chain is
// actually meaningful or a coincidental long path — it doesn't change the
// underlying graph.
function OntologyPatternsPanel() {
    const [patterns, setPatterns] = useState([])
    const [loaded, setLoaded] = useState(false)
    const [showDismissed, setShowDismissed] = useState(false)
    const [busyId, setBusyId] = useState(null)

    const reload = () =>
        fetch(`${API}/api/forge/ontology/patterns?include_dismissed=${showDismissed}`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { patterns: [] })
            .then(d => { setPatterns(d.patterns || []); setLoaded(true) })
            .catch(() => setLoaded(true))

    useEffect(() => { reload() }, [showDismissed]) // eslint-disable-line react-hooks/exhaustive-deps

    const review = async (patternId, patch) => {
        setBusyId(patternId)
        try {
            const res = await fetch(`${API}/api/forge/ontology/patterns/${patternId}/review`, {
                method: "POST", headers: forgeHeaders(), body: JSON.stringify(patch),
            })
            if (res.ok) reload()
        } catch (_e) {}
        finally { setBusyId(null) }
    }

    return (
        <WorkspaceBody>
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 12, maxWidth: 720 }}>
                Non-obvious connections found by chaining approved, cited relationships: A relates to B, B relates to C, but nothing directly linked A and C. Every hop below shows its own source — this panel only surfaces the path, it doesn't add anything new to what was already approved. Requires at least two approved entity-relationship claims sharing an entity to find anything.
            </div>
            <div style={{ marginBottom: 12 }}>
                <button onClick={() => setShowDismissed(v => !v)} style={{ ...ghostBtn, color: showDismissed ? "#60a5fa" : "#94a3b8" }}>
                    {showDismissed ? "Hide dismissed" : "Show dismissed"}
                </button>
            </div>
            {!loaded && <div style={{ color: "#334155", fontSize: 11 }}>Loading…</div>}
            {loaded && patterns.length === 0 && (
                <div style={{ color: "#334155", fontSize: 11 }}>
                    No patterns found yet. This needs at least two approved entity-relationship claims that share an entity — approve some pending claims in the Uploads workspace, then check back here.
                </div>
            )}
            {patterns.map(p => (
                <div key={p.pattern_id} style={{ background: "#111827", borderRadius: 4, padding: "12px 14px", marginBottom: 10, opacity: p.dismissed ? 0.5 : 1 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 }}>
                        {p.nodes.map((n, i) => (
                            <span key={n.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{n.label}</span>
                                {i < p.hops.length && <span style={{ color: "#facc15", fontSize: 11 }}>— {p.hops[i].relationship_type} →</span>}
                            </span>
                        ))}
                        {p.starred && <span style={{ color: "#facc15", fontSize: 11 }}>★ starred</span>}
                    </div>
                    {p.hops.map((h, i) => (
                        <div key={i} style={{ color: "#64748b", fontSize: 10, marginBottom: 4, paddingLeft: 8, borderLeft: "2px solid rgba(148,163,184,0.15)" }}>
                            <b>{h.source_label} → {h.target_label}</b> ({h.relationship_type}{h.as_of ? `, ${h.as_of}` : ""}, confidence: {h.confidence || "unset"}) — {h.citation?.title || "untitled source"}
                            {h.citation?.url && <>{" "}<a href={h.citation.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>↗</a></>}
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button onClick={() => review(p.pattern_id, { starred: !p.starred })} disabled={busyId === p.pattern_id}
                            style={{ ...ghostBtn, color: "#facc15", borderColor: "rgba(250,204,21,0.3)" }}>
                            {p.starred ? "Unstar" : "★ Star as significant"}
                        </button>
                        <button onClick={() => review(p.pattern_id, { dismissed: !p.dismissed })} disabled={busyId === p.pattern_id}
                            style={{ ...ghostBtn, color: "#94a3b8" }}>
                            {p.dismissed ? "Restore" : "Dismiss"}
                        </button>
                    </div>
                </div>
            ))}
        </WorkspaceBody>
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
                    {["table", "graph", "patterns", "assets", "live"].map(v => (
                        <button key={v} onClick={() => setView(v)} style={{ padding: "3px 10px", borderRadius: 3, border: "none", cursor: "pointer", background: view === v ? (v === "live" ? "rgba(236,72,153,0.14)" : v === "patterns" ? "rgba(250,204,21,0.14)" : v === "assets" ? "rgba(74,222,128,0.14)" : "rgba(96,165,250,0.12)") : "transparent", color: view === v ? (v === "live" ? "#ec4899" : v === "patterns" ? "#facc15" : v === "assets" ? "#4ade80" : "#60a5fa") : "#475569", fontSize: 10, fontWeight: view === v ? 600 : 400 }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
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
            <WorkspaceBody style={(view === "graph" || view === "live") ? { padding: 0, overflow: "hidden" } : {}}>
                {view === "live" ? <ForceGraph /> :
                !loaded ? <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div> :
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
                view === "patterns" ? <OntologyPatternsPanel /> :
                view === "assets" ? <AssetsPanel /> :
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

function ForgeMobileView({ onClose }) {
    const [tab,     setTab]     = useState("alerts")
    const [rules,   setRules]   = useState([])
    const [alerts,  setAlerts]  = useState([])
    const [zones,   setZones]   = useState([])

    useEffect(() => {
        fetch(`${API}/api/rules`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => setRules(d?.rules ?? []))
            .catch(() => {})
        fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => setAlerts(Array.isArray(d) ? d : (d?.alerts ?? [])))
            .catch(() => {})
        fetch(`${API}/api/watch-zones`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setZones(Array.isArray(d) ? d : (d?.zones ?? [])))
            .catch(() => {})
    }, [])

    const TAB_STYLE = (active) => ({
        flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600,
        background: "transparent", border: "none",
        borderBottom: active ? "2px solid #4A9EE0" : "2px solid transparent",
        color: active ? "#4A9EE0" : "#475569", cursor: "pointer",
        textAlign: "center",
    })

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", zIndex: 50, display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #1e293b" }}>
                <span style={{ color: "#4A9EE0", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em" }}>FORGE</span>
                <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", padding: "0 4px" }}>✕</button>
            </div>
            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
                {["alerts", "rules", "zones"].map(t => (
                    <button key={t} style={TAB_STYLE(tab === t)} onClick={() => setTab(t)}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
                {tab === "alerts" && (
                    alerts.length === 0
                        ? <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>No recent alerts</div>
                        : alerts.slice(0, 50).map((a, i) => {
                            const sev = (a.severity || "info").toLowerCase()
                            const sevColor = sev === "critical" ? "#ef4444" : sev === "high" ? "#f59e0b" : sev === "medium" ? "#60a5fa" : "#22c55e"
                            return (
                                <div key={a._idx ?? i} style={{ background: "rgba(17,24,39,0.7)", borderRadius: 6, padding: "8px 10px", marginBottom: 6, borderLeft: `3px solid ${sevColor}` }}>
                                    <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{a.type || a.rule_name || "Alert"}</div>
                                    <div style={{ color: "#64748b", fontSize: 10 }}>{a.summary || a.message || "—"}</div>
                                    <div style={{ color: "#334155", fontSize: 9, marginTop: 3 }}>{a.timestamp ? new Date(a.timestamp).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" }) : ""}</div>
                                </div>
                            )
                        })
                )}
                {tab === "rules" && (
                    rules.length === 0
                        ? <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>No rules configured</div>
                        : rules.map(r => (
                            <div key={r.id} style={{ background: "rgba(17,24,39,0.7)", borderRadius: 6, padding: "8px 10px", marginBottom: 6, borderLeft: `3px solid ${r.enabled ? "#4A9EE0" : "#1e293b"}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{r.name}</span>
                                    <span style={{ color: r.enabled ? "#22c55e" : "#475569", fontSize: 9 }}>{r.enabled ? "ON" : "OFF"}</span>
                                </div>
                                <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{r.condition_type} · {r.source_type}</div>
                            </div>
                        ))
                )}
                {tab === "zones" && (
                    zones.length === 0
                        ? <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>No surveillance zones</div>
                        : zones.map(z => (
                            <div key={z.system_id} style={{ background: "rgba(17,24,39,0.7)", borderRadius: 6, padding: "8px 10px", marginBottom: 6, borderLeft: `3px solid ${z.is_active ? "#4A9EE0" : "#1e293b"}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{z.name}</span>
                                    <span style={{ color: z.is_active ? "#22c55e" : "#475569", fontSize: 9 }}>{z.is_active ? "ACTIVE" : "PAUSED"}</span>
                                </div>
                                <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
                                    {z.last_scanned_at ? `Last scan: ${new Date(z.last_scanned_at).toLocaleString("en-GB", { hour12: false, dateStyle: "short", timeStyle: "short" })}` : "Not yet scanned"}
                                </div>
                            </div>
                        ))
                )}
            </div>
        </div>
    )
}

export default function ForgePanel({ user, isMobile = false, onClose }) {
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

    // Allow external components to navigate directly to a workspace via custom event
    useEffect(() => {
        const h = (e) => { if (e.detail?.workspace) setActiveWorkspace(e.detail.workspace) }
        window.addEventListener("akili:forge-nav", h)
        return () => window.removeEventListener("akili:forge-nav", h)
    }, [])

    const [showPipeline, setShowPipeline] = useState(false)

    const goBack = () => {
        setActiveWorkspace(null)
        setActiveNode(null)
        setShowPipeline(false)
    }

    if (isMobile) return <ForgeMobileView onClose={onClose} />

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", zIndex: 50, display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <ForgeHeader brainStatus={brainStatus} activeNode={activeNode} onBack={goBack} />
            {activeWorkspace ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <WorkspaceRouter workspace={activeWorkspace} node={activeNode} brainStatus={brainStatus} />
                </div>
            ) : showPipeline ? (
                <div style={{ flex: 1, position: "relative" }}>
                    <PipelineCanvas
                        initialNodes={pipelineNodes}
                        initialEdges={pipelineEdges}
                        brainStatus={brainStatus}
                        onNodeClick={openWorkspace}
                    />
                </div>
            ) : (
                <ForgeLandingNav
                    brainStatus={brainStatus}
                    onNavigate={(ws) => { setActiveWorkspace(ws); setActiveNode(null) }}
                    onPipeline={() => setShowPipeline(true)}
                />
            )}
        </div>
    )
}
