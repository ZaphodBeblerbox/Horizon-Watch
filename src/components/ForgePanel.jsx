import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import ReviewQueue from "./forge/ReviewQueue.jsx"
import ForceGraph from "./forge/ForceGraph.jsx"

const API = API_BASE

const FORGE_TABS = [
    { id: "dashboard",     label: "Threat Matrix",     icon: "🎯" },
    { id: "rules",         label: "Pattern Rules",     icon: "⚡" },
    { id: "watch",         label: "Watch Areas",        icon: "🛰" },
    { id: "recognition",   label: "Object Training",    icon: "🔍" },
    { id: "ais-training",  label: "AIS Training",       icon: "🚢" },
    { id: "news-training", label: "News Training",      icon: "📰" },
    { id: "entities",      label: "Entity Networks",    icon: "🕸" },
    { id: "feeds",         label: "Data Feeds",         icon: "📡" },
    { id: "models",        label: "Model Management",   icon: "🧠" },
    { id: "overlays",      label: "Map Overlays",       icon: "🗺" },
]

// ── Shared styles ──────────────────────────────────────────────────────────────

const card = {
    background: "rgba(15, 23, 42, 0.8)",
    border: "1px solid rgba(56, 189, 248, 0.1)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
}

const btnGhost = {
    fontSize: 11, padding: "4px 10px", borderRadius: 4,
    border: "1px solid rgba(56,189,248,0.3)",
    background: "transparent", color: "#38bdf8", cursor: "pointer",
}

const btnDanger = {
    fontSize: 11, padding: "4px 10px", borderRadius: 4,
    border: "1px solid rgba(239,68,68,0.3)",
    background: "transparent", color: "#ef4444", cursor: "pointer",
}

// ── Esri tile helper (for AIS mini-map) ────────────────────────────────────────

function esriTileUrl(lat, lon, zoom = 10) {
    const n      = Math.pow(2, zoom)
    const x      = Math.floor((lon + 180) / 360 * n)
    const latRad = lat * Math.PI / 180
    const y      = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
}

// ── Fullscreen image preview ───────────────────────────────────────────────────

function FullscreenPreview({ image, detections, onClose }) {
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)",
                zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "zoom-out",
            }}
        >
            <div
                style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}
                onClick={e => e.stopPropagation()}
            >
                <img
                    src={`data:image/jpeg;base64,${image}`}
                    alt="Detection fullscreen"
                    style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", display: "block" }}
                />
                {(detections || []).map((det, i) => (
                    <div key={i} style={{
                        position: "absolute",
                        left:   `${det.x_pct}%`, top:    `${det.y_pct}%`,
                        width:  `${det.w_pct}%`, height: `${det.h_pct}%`,
                        border: `2px solid ${det.color || "#38bdf8"}`,
                        borderRadius: 2,
                        pointerEvents: "none",
                    }}>
                        <span style={{
                            position: "absolute", top: -18, left: 0,
                            background: det.color || "#38bdf8", color: "#000",
                            fontSize: 10, padding: "1px 4px", borderRadius: 2,
                            fontWeight: 700, whiteSpace: "nowrap",
                        }}>
                            {det.label} {Math.round((det.confidence || 0) * 100)}%
                        </span>
                    </div>
                ))}
                <button
                    onClick={onClose}
                    style={{
                        position: "absolute", top: 8, right: 8,
                        background: "rgba(0,0,0,0.7)", border: "none",
                        color: "white", fontSize: 18, cursor: "pointer",
                        width: 32, height: 32, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                >✕</button>
            </div>
        </div>
    )
}

// ── Threat Matrix Dashboard ────────────────────────────────────────────────────

const LEVEL_COLORS = { CRITICAL: "#ef4444", HIGH: "#f59e0b", ELEVATED: "#38bdf8", LOW: "#22c55e" }

function ThreatDashboard() {
    const [scores,  setScores]  = useState([])
    const [alerts,  setAlerts]  = useState([])
    const [loading, setLoading] = useState(true)
    const tok = localStorage.getItem("hw-auth-token")
    const headers = tok ? { Authorization: `Bearer ${tok}` } : {}

    const refresh = () => {
        setLoading(true)
        Promise.all([
            fetch(`${API}/api/forge/threat-scores`, { headers }).then(r => r.ok ? r.json() : []),
            fetch(`${API}/api/forge/alerts`,         { headers }).then(r => r.ok ? r.json() : []),
        ]).then(([s, a]) => { setScores(s); setAlerts(a) })
          .catch(() => {})
          .finally(() => setLoading(false))
    }

    useEffect(() => { refresh() }, [])

    const sendFeedback = (idx, action) => {
        fetch(`${API}/api/forge/alerts/${idx}/feedback`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        }).then(r => r.ok ? r.json() : null).then(d => {
            if (d) refresh()
        }).catch(() => {})
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Threat Assessment Matrix</h2>
                <button onClick={refresh} style={btnGhost}>{loading ? "Loading…" : "↻ Refresh"}</button>
            </div>

            {/* Region scores */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 10, marginBottom: 28 }}>
                {scores.length === 0 && !loading && (
                    <div style={{ color: "#475569", fontSize: 13, gridColumn: "1/-1" }}>
                        No threat data yet — detection cycle runs every 5 minutes.
                    </div>
                )}
                {scores.map(s => (
                    <div key={s.region} style={{
                        ...card,
                        borderLeft: `4px solid ${LEVEL_COLORS[s.level] || "#64748b"}`,
                        padding: "12px 14px",
                    }}>
                        <div style={{ color: "#94a3b8", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.region}</div>
                        <div style={{ color: LEVEL_COLORS[s.level], fontSize: 22, fontWeight: 800, margin: "2px 0" }}>{s.level}</div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>Score: {Math.round((s.score || 0) * 100)}%</div>
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                            {Object.entries(s.breakdown || {}).map(([k, v]) => v > 0 && (
                                <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                                        <div style={{ height: "100%", borderRadius: 2, background: LEVEL_COLORS[s.level], width: `${Math.min(v / 0.5 * 100, 100)}%` }} />
                                    </div>
                                    <span style={{ color: "#475569", fontSize: 9, width: 90, textAlign: "right" }}>{k.replace(/_/g, " ")}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Alert feed */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ color: "#94a3b8", fontSize: 12, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Active Alerts ({alerts.length})
                </h3>
            </div>
            {alerts.length === 0 && !loading && (
                <div style={{ color: "#475569", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
                    No alerts fired yet. Rules run against live AIS + ADS-B data every 5 min.
                </div>
            )}
            {alerts.slice(0, 30).map((a, i) => (
                <div key={i} style={{
                    ...card,
                    borderLeft: `3px solid ${a.severity === "critical" ? "#ef4444" : a.severity === "high" ? "#f59e0b" : "#38bdf8"}`,
                    padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.4 }}>{a.message}</div>
                        <div style={{ color: "#475569", fontSize: 11, marginTop: 3 }}>
                            {a.rule_name || a.type} • {a.severity?.toUpperCase()} • {(a.timestamp || "").slice(0, 19).replace("T", " ")}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0, marginLeft: 10 }}>
                        <button onClick={() => sendFeedback(i, "confirm")} title="Confirm — increase weight" style={{ ...btnGhost, fontSize: 10, padding: "3px 8px", color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}>✓</button>
                        <button onClick={() => sendFeedback(i, "false_alarm")} title="False alarm — decrease weight" style={{ ...btnDanger, fontSize: 10, padding: "3px 8px" }}>✗</button>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── Pattern Rules ──────────────────────────────────────────────────────────────

const EXAMPLE_RULES = [
    { id: "r1", name: "Dark Ship — Strait of Hormuz",    source: "AIS",       type: "Transponder gap",    status: "active", triggers: 3, lastTrigger: "2h ago",  description: "Vessel AIS transponder goes dark within 50nm of Hormuz for >30 minutes" },
    { id: "r2", name: "Cable Loiterer — Red Sea",        source: "AIS",       type: "Stationary vessel",  status: "active", triggers: 1, lastTrigger: "6h ago",  description: "Vessel stationary >2hrs within 5nm of submarine cable route" },
    { id: "r3", name: "Sahel Event Surge",               source: "News",      type: "Event frequency",    status: "active", triggers: 5, lastTrigger: "12h ago", description: "Region event count exceeds 3× 7-day average" },
    { id: "r4", name: "Military Aircraft Surge — Gulf",  source: "ADS-B",     type: "Traffic anomaly",    status: "paused", triggers: 0, lastTrigger: "never",   description: "Military transponder count in Gulf region exceeds 2× baseline" },
    { id: "r5", name: "Isfahan Airbase Activity",        source: "Satellite", type: "Change detection",   status: "active", triggers: 2, lastTrigger: "3d ago",  description: "Weekly Overwatch scan — alert on >20% change in aircraft count" },
]

const SOURCES = ["AIS", "ADS-B", "News/RSS", "Satellite", "Combined"]
const TRIGGERS_BY_SOURCE = {
    "AIS":       ["Stationary vessel near infrastructure", "Transponder gap (dark ship)", "Route deviation", "Ship-to-ship transfer", "Fleet formation", "Speed anomaly"],
    "ADS-B":     ["Military aircraft surge", "Reconnaissance orbit", "Tanker activity", "Emergency squawk", "VIP movement"],
    "News/RSS":  ["Event frequency surge", "Sentiment shift", "Escalation sequence", "Coordinated reporting"],
    "Satellite": ["Change detection (Overwatch)", "New construction", "Vehicle count change"],
    "Combined":  ["Multi-source escalation", "Pre-conflict indicator sequence"],
}

function CreateRuleModal({ onClose, onCreate }) {
    const [name,    setName]    = useState("")
    const [source,  setSource]  = useState("AIS")
    const [trigger, setTrigger] = useState(TRIGGERS_BY_SOURCE["AIS"][0])
    const [desc,    setDesc]    = useState("")

    const handleSourceChange = (s) => {
        setSource(s)
        setTrigger((TRIGGERS_BY_SOURCE[s] || [])[0] || "")
    }

    const handleCreate = () => {
        if (!name.trim()) return
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ name: name.trim(), source, trigger_type: trigger, description: desc, status: "active" }),
        }).then(r => r.ok ? r.json() : null).then(d => { if (d) onCreate?.(d) }).catch(() => {})
        onClose()
    }

    const inputStyle = {
        width: "100%", padding: "7px 10px", marginBottom: 12, marginTop: 4,
        background: "rgba(30,41,59,0.8)", border: "1px solid rgba(56,189,248,0.2)",
        borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", outline: "none",
    }
    const labelStyle = { color: "#94a3b8", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "rgba(10,18,40,0.98)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 12, padding: 24, width: 500, maxHeight: "85vh", overflowY: "auto" }}>
                <h3 style={{ color: "#e2e8f0", margin: "0 0 18px", fontSize: 15 }}>Create Pattern Rule</h3>
                <label style={labelStyle}>Rule Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Dark Ship — Hormuz" style={inputStyle} />
                <label style={labelStyle}>Data Source</label>
                <select value={source} onChange={e => handleSourceChange(e.target.value)} style={inputStyle}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <label style={labelStyle}>Trigger Type</label>
                <select value={trigger} onChange={e => setTrigger(e.target.value)} style={inputStyle}>
                    {(TRIGGERS_BY_SOURCE[source] || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <label style={labelStyle}>Description (optional)</label>
                <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does this rule detect?" style={inputStyle} />
                <div style={{ color: "#64748b", fontSize: 12, padding: "10px 12px", background: "rgba(30,41,59,0.5)", borderRadius: 6, marginBottom: 16 }}>
                    Detection logic will be wired in Phase 2. Rules are saved as templates.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button onClick={handleCreate} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#38bdf8", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Create Rule</button>
                </div>
            </div>
        </div>
    )
}

function PatternRulesTab() {
    const [rules,      setRules]      = useState(EXAMPLE_RULES)
    const [showCreate, setShowCreate] = useState(false)

    useEffect(() => {
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/rules`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.rules?.length) setRules(d.rules) })
            .catch(() => {})
    }, [])

    const toggleStatus = (id) => setRules(prev => prev.map(r => r.id === id ? { ...r, status: r.status === "active" ? "paused" : "active" } : r))

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Active Pattern Rules</h2>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>Automated triggers that fire when anomalous patterns are detected.</p>
                </div>
                <button onClick={() => setShowCreate(true)} style={{ background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8", color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>+ Create Rule</button>
            </div>
            {rules.map(rule => (
                <div key={rule.id} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{rule.name}</span>
                            <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 7px", borderRadius: 10, background: rule.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)", color: rule.status === "active" ? "#22c55e" : "#64748b", fontWeight: 700, letterSpacing: "0.06em" }}>{rule.status.toUpperCase()}</span>
                        </div>
                        <div style={{ display: "flex", gap: 12, flexShrink: 0, marginLeft: 12 }}>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Source: <span style={{ color: "#94a3b8" }}>{rule.source}</span></span>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Triggers: <span style={{ color: "#94a3b8" }}>{rule.triggers}</span></span>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Last: <span style={{ color: "#94a3b8" }}>{rule.lastTrigger}</span></span>
                        </div>
                    </div>
                    {rule.description && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{rule.description}</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button style={btnGhost}>Edit</button>
                        <button style={btnGhost}>View Triggers</button>
                        <button onClick={() => toggleStatus(rule.id)} style={btnDanger}>{rule.status === "active" ? "Pause" : "Activate"}</button>
                    </div>
                </div>
            ))}
            {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} onCreate={(r) => setRules(prev => [r, ...prev])} />}
        </div>
    )
}

// ── Watch Areas ────────────────────────────────────────────────────────────────

const EXAMPLE_WATCH_AREAS = [
    { id: "w1", name: "Isfahan Air Base",   coords: "32.65°N, 51.68°E", frequency: "Weekly",    lastScan: "3 days ago",  detections: 23, change: "+4 aircraft", status: "alert"  },
    { id: "w2", name: "Bandar Abbas Naval", coords: "27.18°N, 56.28°E", frequency: "Weekly",    lastScan: "5 days ago",  detections: 12, change: "No change",   status: "normal" },
    { id: "w3", name: "Tartus Naval Base",  coords: "34.89°N, 35.87°E", frequency: "Bi-weekly", lastScan: "12 days ago", detections: 8,  change: "−2 vessels",  status: "normal" },
    { id: "w4", name: "Hmeimim Air Base",   coords: "35.41°N, 35.95°E", frequency: "Weekly",    lastScan: "4 days ago",  detections: 31, change: "+6 aircraft", status: "alert"  },
    { id: "w5", name: "Latakia Port",       coords: "35.52°N, 35.77°E", frequency: "Monthly",   lastScan: "22 days ago", detections: 5,  change: "No change",   status: "normal" },
]

function WatchAreasTab() {
    const [areas, setAreas] = useState(EXAMPLE_WATCH_AREAS)

    useEffect(() => {
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/watch-areas`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.areas?.length) setAreas(d.areas) })
            .catch(() => {})
    }, [])

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Satellite Watch Areas</h2>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>Scheduled Overwatch scans on fixed locations. Alerts fire when detections exceed baseline.</p>
                </div>
                <button style={{ background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8", color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Add Watch Area</button>
            </div>
            {areas.map(area => (
                <div key={area.id} style={{ ...card, border: `1px solid ${area.status === "alert" ? "rgba(239,68,68,0.3)" : "rgba(56,189,248,0.1)"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{area.name}</span>
                            {area.status === "alert" && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(239,68,68,0.15)", color: "#ef4444", fontWeight: 700, letterSpacing: "0.06em" }}>ALERT</span>}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>{area.coords} • Scan: {area.frequency}</div>
                        <div style={{ color: area.status === "alert" ? "#ef4444" : "#94a3b8", fontSize: 12, marginTop: 4 }}>
                            Last: {area.lastScan} • {area.detections} objects detected • {area.change}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                        <button style={btnGhost}>Scan Now</button>
                        <button style={btnGhost}>History</button>
                        <button style={btnDanger}>Remove</button>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── Accuracy Tracker ───────────────────────────────────────────────────────────

function AccuracyTracker({ labels }) {
    const owLabels = labels.filter(l => l.source_type === "overwatch" && l.label !== "skip")
    const total     = owLabels.length
    const confirmed = owLabels.filter(l => l.label === "confirm").length
    const corrected = owLabels.filter(l => l.label === "correct").length
    const accuracy  = (confirmed + corrected) > 0 ? Math.round((confirmed / (confirmed + corrected)) * 100) : 0

    const weekAgo    = Date.now() - 7 * 86_400_000
    const thisWeek   = owLabels.filter(l => new Date(l.labeled_at).getTime() > weekAgo)
    const lastWeek   = owLabels.filter(l => { const t = new Date(l.labeled_at).getTime(); return t > weekAgo - 7 * 86_400_000 && t <= weekAgo })
    const twAcc      = thisWeek.length  > 0 ? Math.round((thisWeek.filter(l  => l.label === "confirm").length / thisWeek.length)  * 100) : 0
    const lwAcc      = lastWeek.length  > 0 ? Math.round((lastWeek.filter(l  => l.label === "confirm").length / lastWeek.length)  * 100) : 0
    const trend      = twAcc - lwAcc

    const byClass = {}
    owLabels.forEach(l => {
        const cls = l.original_label || "unknown"
        if (!byClass[cls]) byClass[cls] = { confirmed: 0, corrected: 0 }
        if (l.label === "confirm") byClass[cls].confirmed++
        if (l.label === "correct") byClass[cls].corrected++
    })

    const overallCards = [
        { label: "Model Accuracy",  value: `${accuracy}%`,  color: "#38bdf8" },
        { label: "Weekly Trend",    value: `${trend >= 0 ? "+" : ""}${trend}%`, color: trend >= 0 ? "#22c55e" : "#ef4444" },
        { label: "Total Reviewed",  value: total,            color: "#e2e8f0" },
        { label: "Classes Seen",    value: Object.keys(byClass).length, color: "#f59e0b" },
    ]

    if (total === 0) return null

    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                {overallCards.map(s => (
                    <div key={s.label} style={{ ...card, flex: 1, textAlign: "center", padding: "14px 8px", marginBottom: 0 }}>
                        <div style={{ color: s.color, fontSize: 26, fontWeight: 700 }}>{s.value}</div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{s.label}</div>
                    </div>
                ))}
            </div>
            {Object.keys(byClass).length > 0 && (
                <>
                    <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Accuracy by Class</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                        {Object.entries(byClass)
                            .sort((a, b) => (b[1].confirmed + b[1].corrected) - (a[1].confirmed + a[1].corrected))
                            .map(([cls, st]) => {
                                const tot = st.confirmed + st.corrected
                                const acc = tot > 0 ? Math.round((st.confirmed / tot) * 100) : 0
                                const col = acc >= 80 ? "#22c55e" : acc >= 50 ? "#f59e0b" : "#ef4444"
                                return (
                                    <div key={cls} style={{ background: "rgba(15,23,42,0.6)", padding: 10, borderRadius: 6, borderLeft: `3px solid ${col}` }}>
                                        <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>{cls}</div>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                            <span style={{ color: "#64748b", fontSize: 11 }}>{tot} reviewed</span>
                                            <span style={{ color: col, fontSize: 13, fontWeight: 700 }}>{acc}%</span>
                                        </div>
                                        <div style={{ height: 3, background: "rgba(30,41,59,0.8)", borderRadius: 2, marginTop: 4 }}>
                                            <div style={{ height: "100%", width: `${acc}%`, background: col, borderRadius: 2 }} />
                                        </div>
                                    </div>
                                )
                            })}
                    </div>
                </>
            )}
        </div>
    )
}

// ── Object Training ────────────────────────────────────────────────────────────

const CORRECT_AS_OPTIONS = [
    "Aircraft — Fixed Wing", "Aircraft — Rotary Wing",
    "Vehicle — Large", "Vehicle — Small",
    "Vessel — Military", "Vessel — Cargo",
    "Infrastructure — Launcher", "Infrastructure — Radar",
    "Storage Tank", "Building", "Other / Unknown",
]

function OverwatchReviewCard({ item, onLabel }) {
    const [showCorrect,   setShowCorrect]   = useState(false)
    const [correction,    setCorrection]    = useState(CORRECT_AS_OPTIONS[0])
    const [fullscreenOpen, setFullscreenOpen] = useState(false)

    const imgSrc = item.crop_image || item.crop_b64
    const color  = item.color || "#38bdf8"

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.2)" }}>
            <div style={{ display: "flex", gap: 16 }}>
                {/* Satellite crop with bbox overlay */}
                <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
                    <div style={{
                        width: "100%", height: "100%", background: "#0f172a", borderRadius: 6,
                        overflow: "hidden", border: "1px solid rgba(56,189,248,0.15)", cursor: imgSrc ? "zoom-in" : "default",
                    }}>
                        {imgSrc
                            ? <img
                                src={`data:image/jpeg;base64,${imgSrc}`}
                                alt="detection"
                                onClick={() => setFullscreenOpen(true)}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 10 }}>No Image</div>
                        }
                    </div>
                    {/* Bounding box overlay on the crop thumbnail */}
                    {item.box_in_crop && imgSrc && (
                        <div style={{
                            position: "absolute",
                            left:   `${item.box_in_crop.x}%`, top:    `${item.box_in_crop.y}%`,
                            width:  `${item.box_in_crop.w}%`, height: `${item.box_in_crop.h}%`,
                            border: `2px solid ${color}`,
                            borderRadius: 2, pointerEvents: "none", boxSizing: "border-box",
                        }}>
                            <span style={{
                                position: "absolute", top: -16, left: 0,
                                background: color, color: "#000",
                                fontSize: 9, padding: "1px 4px", borderRadius: 2,
                                fontWeight: 700, whiteSpace: "nowrap",
                            }}>
                                {item.class} {Math.round((item.confidence || 0) * 100)}%
                            </span>
                        </div>
                    )}
                </div>

                {/* Detection info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, textTransform: "capitalize" }}>
                            {item.class || "Unknown"}
                        </span>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(56,189,248,0.12)", color: "#38bdf8", fontWeight: 700 }}>
                            {Math.round((item.confidence || 0) * 100)}% conf
                        </span>
                        {item.mock && <span style={{ fontSize: 10, color: "#475569", padding: "2px 7px", borderRadius: 10, background: "rgba(71,85,105,0.2)" }}>SIM</span>}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>
                        Site: <span style={{ color: "#94a3b8" }}>{item.site || "Unknown"}</span>
                    </div>
                    {item.center && Array.isArray(item.center) && (
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>
                            Coords: <span style={{ color: "#94a3b8" }}>{item.center[0].toFixed(4)}°N, {item.center[1].toFixed(4)}°E</span>
                        </div>
                    )}
                    <div style={{ color: "#64748b", fontSize: 11 }}>
                        Category: <span style={{ color: "#94a3b8" }}>{item.category || "—"}</span>
                        {item.subcategory && <span style={{ color: "#475569" }}> / {item.subcategory}</span>}
                    </div>
                    {imgSrc && (
                        <button onClick={() => setFullscreenOpen(true)} style={{ ...btnGhost, marginTop: 10, fontSize: 10 }}>
                            ⤢ Fullscreen
                        </button>
                    )}
                </div>
            </div>

            {showCorrect && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={correction} onChange={e => setCorrection(e.target.value)} style={{
                        flex: 1, padding: "7px 10px",
                        background: "rgba(30,41,59,0.8)", border: "1px solid rgba(56,189,248,0.2)",
                        borderRadius: 6, color: "#e2e8f0", fontSize: 12, outline: "none",
                    }}>
                        {CORRECT_AS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button onClick={() => { onLabel("correct", { correction, original_label: item.class }); setShowCorrect(false) }}
                        style={{ ...btnGhost, whiteSpace: "nowrap", fontWeight: 700 }}>Submit</button>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={() => onLabel("confirm", { original_label: item.class })} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    ✓ Confirm
                </button>
                <button onClick={() => setShowCorrect(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    ✎ Correct As
                </button>
                <button onClick={() => onLabel("skip", { original_label: item.class })} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    Skip
                </button>
            </div>

            {fullscreenOpen && (
                <FullscreenPreview
                    image={item.full_image || imgSrc}
                    detections={item.all_detections}
                    onClose={() => setFullscreenOpen(false)}
                />
            )}
        </div>
    )
}

function ObjectTrainingTab() {
    const [items,   setItems]   = useState([])
    const [loading, setLoading] = useState(false)
    const [stats,   setStats]   = useState({ total: 0, confirmed: 0, corrected: 0, skipped: 0 })
    const [labels,  setLabels]  = useState([])

    useEffect(() => {
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/labels`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.labels) setLabels(d.labels) })
            .catch(() => {})
    }, [])

    const generateBatch = async () => {
        setLoading(true)
        setItems([])
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const res = await fetch(`${API}/api/forge/overwatch/generate-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ n: 10 }),
            })
            const data = await res.json()
            setItems((data.detections || []).map(d => ({ ...d, id: d.id || crypto.randomUUID() })))
        } catch (e) {
            console.error("[ObjectTraining] batch failed", e)
        } finally {
            setLoading(false)
        }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({
            ...prev,
            total:     prev.total + 1,
            confirmed: label === "confirm" ? prev.confirmed + 1 : prev.confirmed,
            corrected: label === "correct" ? prev.corrected + 1 : prev.corrected,
            skipped:   label === "skip"    ? prev.skipped   + 1 : prev.skipped,
        }))
        const newEntry = { id, label, source_type: "overwatch", labeled_at: new Date().toISOString(), ...extra }
        setLabels(prev => [newEntry, ...prev])
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ id, label, source_type: "overwatch", ...extra }),
        }).catch(() => {})
    }

    const statCards = [
        { label: "Total Labeled", value: stats.total,     color: "#38bdf8" },
        { label: "Confirmed",     value: stats.confirmed, color: "#22c55e" },
        { label: "Corrected",     value: stats.corrected, color: "#f59e0b" },
        { label: "Skipped",       value: stats.skipped,   color: "#64748b" },
    ]

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 16 }}>Object Recognition Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Review and correct Overwatch satellite detection labels to improve model accuracy.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{
                    background: loading ? "rgba(56,189,248,0.1)" : "rgba(56,189,248,0.15)",
                    border: "1px solid #38bdf8", color: loading ? "#64748b" : "#38bdf8",
                    padding: "8px 16px", borderRadius: 6, cursor: loading ? "default" : "pointer",
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16,
                }}>
                    {loading ? "Scanning…" : "Generate 10 Scans"}
                </button>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {statCards.map(s => (
                    <div key={s.label} style={{ ...card, flex: 1, textAlign: "center", padding: "12px 8px", marginBottom: 0 }}>
                        <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                        <div style={{ color: "#64748b", fontSize: 10, marginTop: 3 }}>{s.label}</div>
                    </div>
                ))}
            </div>

            <AccuracyTracker labels={labels} />

            <ReviewQueue
                items={items}
                onLabel={handleLabel}
                loading={loading}
                onGenerate={generateBatch}
                generateLabel="Generate 10 Scans"
                renderCard={(item, labelFn) => <OverwatchReviewCard item={item} onLabel={labelFn} />}
            />
        </div>
    )
}

// ── AIS Training ───────────────────────────────────────────────────────────────

const AIS_SUBCATEGORIES = [
    "Loitering near infrastructure",
    "Dark transit (AIS gap)",
    "Route deviation",
    "Ship-to-ship transfer",
    "Military formation",
    "Sanctions evasion route",
    "Other",
]

function AISTrainingCard({ item, onLabel }) {
    const [showSubs, setShowSubs] = useState(false)
    const lat = item.lat ?? 0
    const lon = item.lon ?? 0
    const tileUrl = esriTileUrl(lat, lon, 10)
    const isStationary = (item.speed ?? 0) < 0.5
    const isHighSpeed  = (item.speed ?? 0) > 22

    const assessment = isStationary
        ? { text: "⚠ Vessel stationary — possible loitering", color: "#f59e0b" }
        : isHighSpeed
        ? { text: "⚠ High speed — possible military/pursuit", color: "#ef4444" }
        : { text: "✓ Normal transit behaviour", color: "#22c55e" }

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.15)" }}>
            {/* Mini-map */}
            <div style={{ position: "relative", height: 180, marginBottom: 14, borderRadius: 8, overflow: "hidden", background: "#0f172a" }}>
                <img src={tileUrl} alt="vessel location" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.75 }} onError={e => { e.target.style.display = "none" }} />
                {/* Vessel dot */}
                <div style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    width: 14, height: 14, borderRadius: "50%",
                    background: isStationary ? "#ef4444" : "#22c55e",
                    border: "2px solid white",
                    boxShadow: `0 0 10px ${isStationary ? "#ef4444" : "#22c55e"}`,
                }} />
                {/* Speed badge */}
                <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.75)", padding: "3px 8px", borderRadius: 4, color: "#e2e8f0", fontSize: 11 }}>
                    {isStationary ? "STATIONARY" : `${(item.speed ?? 0).toFixed(1)} kn`}
                </div>
                {/* Coords badge */}
                <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.75)", padding: "3px 8px", borderRadius: 4, color: "#64748b", fontSize: 10 }}>
                    {lat.toFixed(3)}°N, {lon.toFixed(3)}°E
                </div>
                {item.mock && (
                    <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(71,85,105,0.8)", padding: "2px 6px", borderRadius: 4, color: "#94a3b8", fontSize: 10 }}>SIM</div>
                )}
            </div>

            {/* Vessel info grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", marginBottom: 12 }}>
                {[
                    ["VESSEL",      item.name || `MMSI ${item.mmsi}`],
                    ["TYPE",        item.ship_type || "Unknown"],
                    ["MMSI",        item.mmsi],
                    ["FLAG",        item.flag || "—"],
                    ["DESTINATION", item.destination || "Not declared"],
                    ["HEADING",     item.heading != null ? `${item.heading}°` : "—"],
                    ["CALLSIGN",    item.callsign || "—"],
                ].map(([label, value]) => (
                    <div key={label}>
                        <div style={{ color: "#475569", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em" }}>{label}</div>
                        <div style={{ color: "#e2e8f0", fontSize: 13, marginTop: 1 }}>{value}</div>
                    </div>
                ))}
            </div>

            {/* System assessment */}
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(30,41,59,0.5)", borderRadius: 6 }}>
                <div style={{ color: "#475569", fontSize: 10, marginBottom: 3 }}>SYSTEM ASSESSMENT</div>
                <div style={{ color: assessment.color, fontSize: 12 }}>{assessment.text}</div>
            </div>

            {/* Suspicious subcategory chips */}
            {showSubs && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {AIS_SUBCATEGORIES.map(cat => (
                        <button key={cat} onClick={() => { onLabel("suspicious", { reason: cat }); setShowSubs(false) }} style={{
                            padding: "6px 10px", borderRadius: 4,
                            border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)",
                            color: "#ef4444", cursor: "pointer", fontSize: 11,
                        }}>{cat}</button>
                    ))}
                </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onLabel("normal")} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    ✓ Normal
                </button>
                <button onClick={() => setShowSubs(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    ⚠ Suspicious
                </button>
                <button onClick={() => onLabel("skip")} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    Skip
                </button>
            </div>
        </div>
    )
}

function AISTrainingTab() {
    const [items,   setItems]   = useState([])
    const [loading, setLoading] = useState(false)
    const [stats,   setStats]   = useState({ total: 0, normal: 0, suspicious: 0, skipped: 0 })

    const generateBatch = async () => {
        setLoading(true)
        setItems([])
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const res = await fetch(`${API}/api/forge/ais/generate-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ n: 20 }),
            })
            const data = await res.json()
            setItems((data.vessels || []).map(v => ({ ...v, id: v.review_id || v.mmsi || crypto.randomUUID() })))
        } catch (e) {
            console.error("[AISTraining] batch failed", e)
        } finally {
            setLoading(false)
        }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({
            ...prev,
            total:      prev.total + 1,
            normal:     label === "normal"     ? prev.normal     + 1 : prev.normal,
            suspicious: label === "suspicious" ? prev.suspicious + 1 : prev.suspicious,
            skipped:    label === "skip"       ? prev.skipped    + 1 : prev.skipped,
        }))
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ id, label, source_type: "ais", ...extra }),
        }).catch(() => {})
    }

    const statCards = [
        { label: "Reviewed",   value: stats.total,      color: "#38bdf8" },
        { label: "Normal",     value: stats.normal,     color: "#22c55e" },
        { label: "Suspicious", value: stats.suspicious, color: "#ef4444" },
        { label: "Skipped",    value: stats.skipped,    color: "#64748b" },
    ]

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 16 }}>AIS Behaviour Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Label vessel behaviour patterns to train anomaly detection models.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{
                    background: loading ? "rgba(56,189,248,0.1)" : "rgba(56,189,248,0.15)",
                    border: "1px solid #38bdf8", color: loading ? "#64748b" : "#38bdf8",
                    padding: "8px 16px", borderRadius: 6, cursor: loading ? "default" : "pointer",
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16,
                }}>
                    {loading ? "Loading…" : "Generate 20 Vessels"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {statCards.map(s => (
                    <div key={s.label} style={{ ...card, flex: 1, textAlign: "center", padding: "12px 8px", marginBottom: 0 }}>
                        <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                        <div style={{ color: "#64748b", fontSize: 10, marginTop: 3 }}>{s.label}</div>
                    </div>
                ))}
            </div>
            <ReviewQueue
                items={items}
                onLabel={handleLabel}
                loading={loading}
                onGenerate={generateBatch}
                generateLabel="Generate 20 Vessels"
                renderCard={(item, labelFn) => <AISTrainingCard item={item} onLabel={labelFn} />}
            />
        </div>
    )
}

// ── News Training ──────────────────────────────────────────────────────────────

const SEVERITY_TIERS  = ["critical", "significant", "elevated", "low"]
const EVENT_TYPES     = ["Conflict", "Explosion / Remote Violence", "Protests", "Riots", "Strategic Developments", "Violence Against Civilians", "Other"]
const SEVERITY_COLORS = {
    critical:    { bg: "rgba(239,68,68,0.15)",  text: "#ef4444" },
    significant: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b" },
    elevated:    { bg: "rgba(56,189,248,0.12)", text: "#38bdf8" },
    low:         { bg: "rgba(100,116,139,0.2)", text: "#64748b" },
}

function NewsTrainingCard({ item, onLabel }) {
    const [showAdjust,  setShowAdjust]  = useState(false)
    const [adjSeverity, setAdjSeverity] = useState(item.severity_tier || "elevated")
    const [adjType,     setAdjType]     = useState(item.event_type    || "Conflict")
    const sc = SEVERITY_COLORS[item.severity_tier] || SEVERITY_COLORS.low

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.15)" }}>
            <div style={{ marginBottom: 10 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13, lineHeight: 1.45, marginBottom: 7 }}>{item.title || "Untitled"}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{item.source || "Unknown Source"}</span>
                    {item.published && <span style={{ fontSize: 11, color: "#475569" }}>{new Date(item.published).toLocaleDateString()}</span>}
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: sc.bg, color: sc.text }}>{(item.severity_tier || "LOW").toUpperCase()}</span>
                    {item.event_type && <span style={{ fontSize: 10, color: "#94a3b8", padding: "2px 8px", borderRadius: 10, background: "rgba(30,41,59,0.8)" }}>{item.event_type}</span>}
                    {item.mock && <span style={{ fontSize: 10, color: "#475569", padding: "2px 7px", borderRadius: 10, background: "rgba(71,85,105,0.2)" }}>SIM</span>}
                </div>
            </div>
            {showAdjust && (
                <div style={{ marginBottom: 12, padding: 12, background: "rgba(30,41,59,0.6)", borderRadius: 6, border: "1px solid rgba(56,189,248,0.15)" }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>SEVERITY</label>
                            <select value={adjSeverity} onChange={e => setAdjSeverity(e.target.value)} style={{ width: "100%", padding: "6px 8px", outline: "none", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 4, color: "#e2e8f0", fontSize: 12 }}>
                                {SEVERITY_TIERS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>EVENT TYPE</label>
                            <select value={adjType} onChange={e => setAdjType(e.target.value)} style={{ width: "100%", padding: "6px 8px", outline: "none", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 4, color: "#e2e8f0", fontSize: 12 }}>
                                {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                    <button onClick={() => { onLabel("adjusted", { severity: adjSeverity, event_type: adjType }); setShowAdjust(false) }}
                        style={{ ...btnGhost, width: "100%", textAlign: "center", fontWeight: 700 }}>
                        Apply Adjustment
                    </button>
                </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onLabel("correct")} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Correct</button>
                <button onClick={() => setShowAdjust(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✎ Adjust</button>
                <button onClick={() => onLabel("skip")} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Skip</button>
            </div>
        </div>
    )
}

function NewsTrainingTab() {
    const [items,   setItems]   = useState([])
    const [loading, setLoading] = useState(false)
    const [stats,   setStats]   = useState({ total: 0, correct: 0, adjusted: 0, skipped: 0 })

    const generateBatch = async () => {
        setLoading(true)
        setItems([])
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const res = await fetch(`${API}/api/forge/news/generate-batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
                body: JSON.stringify({ n: 15 }),
            })
            const data = await res.json()
            setItems((data.articles || []).map(a => ({ ...a, id: a.id || a.url || crypto.randomUUID() })))
        } catch (e) {
            console.error("[NewsTraining] batch failed", e)
        } finally {
            setLoading(false)
        }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({ ...prev, total: prev.total+1, correct: label==="correct"?prev.correct+1:prev.correct, adjusted: label==="adjusted"?prev.adjusted+1:prev.adjusted, skipped: label==="skip"?prev.skipped+1:prev.skipped }))
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ id, label, source_type: "news", ...extra }),
        }).catch(() => {})
    }

    const statCards = [
        { label: "Reviewed", value: stats.total,    color: "#38bdf8" },
        { label: "Correct",  value: stats.correct,  color: "#22c55e" },
        { label: "Adjusted", value: stats.adjusted, color: "#f59e0b" },
        { label: "Skipped",  value: stats.skipped,  color: "#64748b" },
    ]

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 16 }}>News Classification Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Review AI-scored news articles and correct severity and event-type labels.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{ background: loading ? "rgba(56,189,248,0.1)" : "rgba(56,189,248,0.15)", border: "1px solid #38bdf8", color: loading ? "#64748b" : "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16 }}>
                    {loading ? "Loading…" : "Load Batch"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                {statCards.map(s => (
                    <div key={s.label} style={{ ...card, flex: 1, textAlign: "center", padding: "12px 8px", marginBottom: 0 }}>
                        <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                        <div style={{ color: "#64748b", fontSize: 10, marginTop: 3 }}>{s.label}</div>
                    </div>
                ))}
            </div>
            <ReviewQueue items={items} onLabel={handleLabel} loading={loading} onGenerate={generateBatch} generateLabel="Load Batch" renderCard={(item, labelFn) => <NewsTrainingCard item={item} onLabel={labelFn} />} />
        </div>
    )
}

// ── Skeleton tabs ──────────────────────────────────────────────────────────────

// ── Entity Networks ────────────────────────────────────────────────────────────

const ENTITY_TYPES = {
    vessel:     { color: "#f59e0b", icon: "🚢", label: "Vessels" },
    aircraft:   { color: "#38bdf8", icon: "✈", label: "Aircraft" },
    port:       { color: "#06b6d4", icon: "⚓", label: "Ports" },
    airport:    { color: "#8b5cf6", icon: "✈", label: "Airports" },
    country:    { color: "#22c55e", icon: "🌍", label: "Countries" },
    chokepoint: { color: "#ef4444", icon: "🔒", label: "Chokepoints" },
    cable:      { color: "#a855f7", icon: "🔌", label: "Cables" },
    event:      { color: "#f97316", icon: "⚡", label: "Events" },
    person:     { color: "#ec4899", icon: "👤", label: "People" },
    group:      { color: "#ef4444", icon: "⚔", label: "Groups" },
    weapon:     { color: "#dc2626", icon: "🎯", label: "Weapons" },
    facility:   { color: "#14b8a6", icon: "🏭", label: "Facilities" },
    scan:       { color: "#38bdf8", icon: "🛰", label: "Scans" },
}

const EDGE_TYPES = {
    transits:      { color: "#f59e0b", label: "Transits through" },
    docks_at:      { color: "#06b6d4", label: "Docks at" },
    located_in:    { color: "#22c55e", label: "Located in" },
    threatens:     { color: "#ef4444", label: "Threatens" },
    monitors:      { color: "#38bdf8", label: "Monitors" },
    connects:      { color: "#a855f7", label: "Connects to" },
    operates:      { color: "#f97316", label: "Operates" },
    involves:      { color: "#ec4899", label: "Involves" },
    near:          { color: "#64748b", label: "Near" },
    detects:       { color: "#38bdf8", label: "Detects" },
    affects:       { color: "#ef4444", label: "Affects" },
    supplies:      { color: "#22c55e", label: "Supplies" },
    commanded_by:  { color: "#ec4899", label: "Commanded by" },
}

function AddEdgeModal({ nodes, onSave, onClose }) {
    const [source, setSource] = useState("")
    const [target, setTarget] = useState("")
    const [type,   setType]   = useState("connects")
    const sel = { width: "100%", padding: "7px 10px", marginBottom: 12, marginTop: 4, background: "rgba(30,41,59,0.8)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "rgba(10,18,40,0.98)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 12, padding: 24, width: 440 }}>
                <h3 style={{ color: "#e2e8f0", margin: "0 0 16px", fontSize: 15 }}>Add Connection</h3>
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Source Entity</div>
                <select value={source} onChange={e => setSource(e.target.value)} style={sel}>
                    <option value="">Select…</option>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.label} ({n.type})</option>)}
                </select>
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Relationship</div>
                <select value={type} onChange={e => setType(e.target.value)} style={sel}>
                    {Object.entries(EDGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Target Entity</div>
                <select value={target} onChange={e => setTarget(e.target.value)} style={sel}>
                    <option value="">Select…</option>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.label} ({n.type})</option>)}
                </select>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                    <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button
                        disabled={!source || !target}
                        onClick={() => { onSave({ source, target, type }); onClose() }}
                        style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: source && target ? "#38bdf8" : "rgba(100,116,139,0.3)", color: "#0f172a", fontWeight: 700, cursor: source && target ? "pointer" : "default", fontSize: 13 }}
                    >Create</button>
                </div>
            </div>
        </div>
    )
}

function EntityNetworksTab({ onViewOnMap }) {
    const [nodes,        setNodes]        = useState([])
    const [edges,        setEdges]        = useState([])
    const [selectedNode, setSelectedNode] = useState(null)
    const [filter,       setFilter]       = useState("all")
    const [loading,      setLoading]      = useState(false)
    const [showAdd,      setShowAdd]      = useState(false)
    const tok = localStorage.getItem("hw-auth-token")
    const headers = tok ? { Authorization: `Bearer ${tok}` } : {}

    const load = () => {
        fetch(`${API}/api/forge/ontology`, { headers })
            .then(r => r.ok ? r.json() : { nodes: [], edges: [] })
            .then(d => { setNodes(d.nodes || []); setEdges(d.edges || []) })
            .catch(() => {})
    }

    useEffect(() => { load() }, [])

    const buildFromLiveData = () => {
        setLoading(true)
        fetch(`${API}/api/forge/ontology/build`, { method: "POST", headers })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) { setNodes(d.nodes || []); setEdges(d.edges || []) } })
            .catch(() => {})
            .finally(() => setLoading(false))
    }

    const addEdge = ({ source, target, type }) => {
        fetch(`${API}/api/forge/ontology/edge`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ source, target, type }),
        }).then(r => r.ok ? r.json() : null).then(e => { if (e) setEdges(prev => [...prev, e]) }).catch(() => {})
    }

    const removeEdge = (edgeId) => {
        fetch(`${API}/api/forge/ontology/edge/${edgeId}`, { method: "DELETE", headers })
            .then(() => { setEdges(prev => prev.filter(e => e.id !== edgeId)) })
            .catch(() => {})
    }

    const visibleNodes = filter === "all" ? nodes : nodes.filter(n => n.type === filter)

    return (
        <div style={{ display: "flex", height: "calc(100vh - 160px)", gap: 14 }}>
            {/* Left panel */}
            <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
                {/* Filter chips */}
                <div>
                    <div style={{ color: "#64748b", fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>FILTER BY TYPE</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <button onClick={() => setFilter("all")} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, border: "none", cursor: "pointer", background: filter === "all" ? "#38bdf8" : "rgba(30,41,59,0.8)", color: filter === "all" ? "#0f172a" : "#94a3b8" }}>All</button>
                        {Object.entries(ENTITY_TYPES).map(([key, val]) => (
                            <button key={key} onClick={() => setFilter(key)} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, border: "none", cursor: "pointer", background: filter === key ? val.color : "rgba(30,41,59,0.8)", color: filter === key ? "#0f172a" : "#94a3b8" }}>
                                {val.label}
                            </button>
                        ))}
                    </div>
                </div>
                <button onClick={() => setShowAdd(true)} style={{ ...btnGhost, fontSize: 12, padding: "7px 12px", fontWeight: 700 }}>+ Add Connection</button>
                <button onClick={buildFromLiveData} disabled={loading} style={{ fontSize: 12, padding: "7px 12px", borderRadius: 6, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.08)", color: "#22c55e", cursor: "pointer", fontWeight: 700 }}>
                    {loading ? "Building…" : "↻ Build from Live Data"}
                </button>

                {/* Selected node detail */}
                {selectedNode && (
                    <div style={{ ...card, flex: 1, overflowY: "auto" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: ENTITY_TYPES[selectedNode.type]?.color || "#94a3b8", fontSize: 10, textTransform: "uppercase" }}>
                                {selectedNode.type}
                            </span>
                            <button onClick={() => setSelectedNode(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14 }}>✕</button>
                        </div>
                        <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 700, margin: "4px 0 2px" }}>{selectedNode.label}</div>
                        {selectedNode.description && <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.4 }}>{selectedNode.description}</div>}
                        {(selectedNode.connections || []).length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ color: "#475569", fontSize: 10, marginBottom: 5 }}>CONNECTIONS ({selectedNode.connections.length})</div>
                                {selectedNode.connections.map((conn, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 4, marginBottom: 4, background: "rgba(30,41,59,0.6)", fontSize: 11 }}>
                                        <div>
                                            <span style={{ color: EDGE_TYPES[conn.type]?.color || "#64748b" }}>{conn.type}</span>
                                            <span style={{ color: "#475569" }}> → </span>
                                            <span style={{ color: "#e2e8f0" }}>{conn.target_label}</span>
                                        </div>
                                        <button onClick={() => removeEdge(conn.edge_id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {(selectedNode.lat && selectedNode.lng) && (
                            <button onClick={() => onViewOnMap?.(selectedNode)} style={{ ...btnGhost, fontSize: 11, width: "100%", marginTop: 10, padding: "6px" }}>View on Map</button>
                        )}
                    </div>
                )}

                <div style={{ ...card, padding: "10px 12px" }}>
                    <div style={{ color: "#475569", fontSize: 10 }}>ONTOLOGY STATS</div>
                    <div style={{ color: "#e2e8f0", fontSize: 13, marginTop: 2 }}>{nodes.length} entities • {edges.length} connections</div>
                </div>
            </div>

            {/* Graph canvas */}
            <div style={{ flex: 1, background: "rgba(5,9,20,0.97)", borderRadius: 8, overflow: "hidden", position: "relative" }}>
                {nodes.length === 0 && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13, gap: 12 }}>
                        <div>No ontology data. Click "Build from Live Data" to auto-generate.</div>
                    </div>
                )}
                <ForceGraph
                    nodes={visibleNodes}
                    edges={edges}
                    entityTypes={ENTITY_TYPES}
                    edgeTypes={EDGE_TYPES}
                    onNodeClick={setSelectedNode}
                />
            </div>

            {showAdd && <AddEdgeModal nodes={nodes} onSave={addEdge} onClose={() => setShowAdd(false)} />}
        </div>
    )
}

// ── Model Management ───────────────────────────────────────────────────────────

function ModelManagementTab() {
    const [exportData, setExportData] = useState(null)
    const tok = localStorage.getItem("hw-auth-token")
    const headers = tok ? { Authorization: `Bearer ${tok}` } : {}

    useEffect(() => {
        fetch(`${API}/api/forge/export-training-data`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setExportData(d) })
            .catch(() => {})
    }, [])

    const models = [
        { name: "yolov8n-obb.onnx", type: "Object Detection (DOTA)", size: "12.7 MB", classes: 15, status: "active",  accuracy: "68%",  lastUpdated: "March 2026" },
        { name: "yolov8n.onnx",     type: "Object Detection (COCO)", size: "12.1 MB", classes: 80, status: "standby", accuracy: "N/A",   lastUpdated: "March 2026" },
    ]

    const total     = exportData?.total     ?? 0
    const confirmed = exportData?.confirmed ?? 0
    const corrected = exportData?.corrected ?? 0
    const ready     = exportData?.ready_for_training ?? false
    const pct       = Math.min(total / 500 * 100, 100)

    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 16px", fontSize: 16 }}>ML Model Management</h2>

            {models.map((model, i) => (
                <div key={i} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13 }}>{model.name}</span>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: model.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)", color: model.status === "active" ? "#22c55e" : "#64748b", fontWeight: 700 }}>
                                {model.status.toUpperCase()}
                            </span>
                        </div>
                        <span style={{ color: "#475569", fontSize: 11 }}>{model.size}</span>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 5 }}>
                        {model.type} • {model.classes} classes • Accuracy: {model.accuracy}
                    </div>
                    <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>Last updated: {model.lastUpdated}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button style={btnGhost}>Test</button>
                        <button style={btnGhost}>Export Training Data</button>
                    </div>
                </div>
            ))}

            <h3 style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, marginTop: 24 }}>Training Data Collected</h3>
            <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                        <span style={{ color: ready ? "#22c55e" : "#38bdf8", fontSize: 26, fontWeight: 800 }}>{total}</span>
                        <span style={{ color: "#475569", fontSize: 12, marginLeft: 6 }}>/ 500 needed to export</span>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "right" }}>
                        <div>{confirmed} confirmed</div>
                        <div>{corrected} corrected</div>
                    </div>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", marginBottom: 12 }}>
                    <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #38bdf8, #818cf8)", width: `${pct}%`, transition: "width 0.4s" }} />
                </div>
                <button
                    disabled={!ready}
                    style={{ fontSize: 12, padding: "7px 16px", borderRadius: 6, border: "none", background: ready ? "#38bdf8" : "rgba(100,116,139,0.25)", color: ready ? "#0f172a" : "#64748b", cursor: ready ? "pointer" : "default", fontWeight: 700 }}
                >
                    {ready ? "Export Dataset" : `Export Dataset (${500 - total} more needed)`}
                </button>
            </div>

            <h3 style={{ color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, marginTop: 24 }}>Upload Fine-tuned Model</h3>
            <div style={{ border: "2px dashed rgba(56,189,248,0.2)", borderRadius: 8, padding: 28, textAlign: "center", color: "#475569", fontSize: 13, lineHeight: 1.6 }}>
                Drag & drop a <span style={{ color: "#94a3b8" }}>.onnx</span> file here, or click to browse.<br />
                <span style={{ fontSize: 11 }}>The new model will replace the active one after validation.</span>
            </div>
        </div>
    )
}

// ── Skeleton (fallback) ────────────────────────────────────────────────────────

function SkeletonTab({ title, description, icon }) {
    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 6px", fontSize: 16 }}>{icon} {title}</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 24 }}>{description}</p>
            <div style={{ color: "#64748b", fontSize: 13, padding: 32, textAlign: "center", background: "rgba(15,23,42,0.5)", borderRadius: 8, border: "1px dashed rgba(56,189,248,0.18)" }}>
                This module will be built out in a future session.
            </div>
        </div>
    )
}

// ── Map Overlays ───────────────────────────────────────────────────────────────

const OVERLAYS = [
    { name: "Light Pollution (VIIRS Nighttime Lights)", description: "VIIRS nighttime lights — shows human activity, energy infrastructure, urbanisation. Updated nightly by NASA.", source: "NASA GIBS / Earth Observation Group", available: true, id: "light-pollution" },
    { name: "GPS Jamming Zones", description: "Known GPS interference areas from OPSGROUP reports — updated weekly from pilot reports.", source: "OPSGROUP", available: false, id: "gps-jam" },
    { name: "Nuclear Facilities", description: "IAEA global nuclear installation database — power plants, research reactors, enrichment facilities.", source: "IAEA", available: false, id: "nuclear" },
    { name: "UNHCR Refugee Camps", description: "UNHCR-registered camp locations with population estimates. Updated quarterly.", source: "UNHCR", available: false, id: "refugees" },
]

function MapOverlaysTab({ onAddOverlay }) {
    const [active, setActive] = useState(new Set())
    const toggle = (id) => {
        const next = new Set(active)
        if (next.has(id)) next.delete(id); else next.add(id)
        setActive(next)
        onAddOverlay?.(id, !active.has(id))
    }
    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 6px", fontSize: 16 }}>Custom Map Overlays</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 20 }}>Add supplemental data layers to the 3D globe.</p>
            {OVERLAYS.map(o => (
                <div key={o.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", border: active.has(o.id) ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(56,189,248,0.1)" }}>
                    <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
                        <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{o.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>{o.description}</div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Source: {o.source}</div>
                    </div>
                    <button disabled={!o.available} onClick={() => o.available && toggle(o.id)} style={{ padding: "7px 14px", borderRadius: 6, border: "none", cursor: o.available ? "pointer" : "not-allowed", background: !o.available ? "rgba(100,116,139,0.2)" : active.has(o.id) ? "rgba(56,189,248,0.25)" : "#38bdf8", color: !o.available ? "#64748b" : active.has(o.id) ? "#38bdf8" : "#0f172a", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {!o.available ? "Coming Soon" : active.has(o.id) ? "Remove Layer" : "Add to Globe"}
                    </button>
                </div>
            ))}
        </div>
    )
}

// ── ForgePanel ─────────────────────────────────────────────────────────────────

export default function ForgePanel({ user, onClose, onAddOverlay, onFlyTo }) {
    const [activeTab, setActiveTab] = useState("dashboard")

    return (
        <div style={{ position: "absolute", inset: 0, background: "rgba(5, 9, 20, 0.98)", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif", zIndex: 50 }}>
            {/* Header */}
            <div style={{ padding: "0 24px", height: 52, flexShrink: 0, borderBottom: "1px solid rgba(56, 189, 248, 0.12)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0", letterSpacing: "0.04em" }}>⚒ FORGE</span>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "#38bdf8", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", padding: "2px 8px", borderRadius: 4 }}>INTELLIGENCE TRAINING LAB</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>{user?.email || "admin"}</span>
                </div>
                {onClose && <button onClick={onClose} title="Close Forge" style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 8px" }}>×</button>}
            </div>

            {/* Inner tab bar */}
            <div style={{ display: "flex", gap: 2, padding: "8px 24px 0", borderBottom: "1px solid rgba(56, 189, 248, 0.08)", flexShrink: 0, overflowX: "auto" }}>
                {FORGE_TABS.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "7px 14px 9px", borderRadius: "6px 6px 0 0", border: "none", borderBottom: activeTab === tab.id ? "2px solid #38bdf8" : "2px solid transparent", cursor: "pointer", background: activeTab === tab.id ? "rgba(56,189,248,0.08)" : "transparent", color: activeTab === tab.id ? "#38bdf8" : "#64748b", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.12s, background 0.12s" }}>
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
                {activeTab === "dashboard"     && <ThreatDashboard />}
                {activeTab === "rules"         && <PatternRulesTab />}
                {activeTab === "watch"         && <WatchAreasTab />}
                {activeTab === "recognition"   && <ObjectTrainingTab />}
                {activeTab === "ais-training"  && <AISTrainingTab />}
                {activeTab === "news-training" && <NewsTrainingTab />}
                {activeTab === "entities"      && <EntityNetworksTab onViewOnMap={node => { onFlyTo?.(node); onClose?.() }} />}
                {activeTab === "feeds"         && <SkeletonTab icon="📡" title="Data Feeds" description="Manage custom RSS/XML/JSON data ingestion pipelines." />}
                {activeTab === "models"        && <ModelManagementTab />}
                {activeTab === "overlays"      && <MapOverlaysTab onAddOverlay={onAddOverlay} />}
            </div>
        </div>
    )
}
