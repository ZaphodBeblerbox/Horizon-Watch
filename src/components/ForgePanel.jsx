import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import ReviewQueue from "./forge/ReviewQueue.jsx"

const API = API_BASE

const FORGE_TABS = [
    { id: "rules",         label: "Pattern Rules",    icon: "⚡" },
    { id: "watch",         label: "Watch Areas",       icon: "🛰" },
    { id: "recognition",   label: "Object Training",   icon: "🎯" },
    { id: "ais-training",  label: "AIS Training",      icon: "🚢" },
    { id: "news-training", label: "News Training",     icon: "📰" },
    { id: "entities",      label: "Entity Networks",   icon: "🕸" },
    { id: "feeds",         label: "Data Feeds",        icon: "📡" },
    { id: "models",        label: "Model Management",  icon: "🧠" },
    { id: "overlays",      label: "Map Overlays",      icon: "🗺" },
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
        borderRadius: 6, color: "#e2e8f0", fontSize: 13, boxSizing: "border-box",
        outline: "none",
    }
    const labelStyle = { color: "#94a3b8", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em" }

    return (
        <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 3000,
            display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div style={{
                background: "rgba(10,18,40,0.98)", border: "1px solid rgba(56,189,248,0.2)",
                borderRadius: 12, padding: 24, width: 500, maxHeight: "85vh", overflowY: "auto",
            }}>
                <h3 style={{ color: "#e2e8f0", margin: "0 0 18px", fontSize: 15 }}>Create Pattern Rule</h3>

                <label style={labelStyle}>Rule Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g., Dark Ship — Hormuz" style={inputStyle} />

                <label style={labelStyle}>Data Source</label>
                <select value={source} onChange={e => handleSourceChange(e.target.value)} style={inputStyle}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <label style={labelStyle}>Trigger Type</label>
                <select value={trigger} onChange={e => setTrigger(e.target.value)} style={inputStyle}>
                    {(TRIGGERS_BY_SOURCE[source] || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label style={labelStyle}>Description (optional)</label>
                <input value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder="What does this rule detect?" style={inputStyle} />

                <div style={{
                    color: "#64748b", fontSize: 12, padding: "10px 12px",
                    background: "rgba(30,41,59,0.5)", borderRadius: 6, marginBottom: 16,
                }}>
                    Detection logic will be wired in Phase 2. Rules are saved as templates.
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{
                        padding: "8px 16px", borderRadius: 6,
                        border: "1px solid rgba(100,116,139,0.3)",
                        background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13,
                    }}>Cancel</button>
                    <button onClick={handleCreate} style={{
                        padding: "8px 18px", borderRadius: 6, border: "none",
                        background: "#38bdf8", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 13,
                    }}>Create Rule</button>
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

    const toggleStatus = (id) => {
        setRules(prev => prev.map(r => r.id === id
            ? { ...r, status: r.status === "active" ? "paused" : "active" }
            : r
        ))
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Active Pattern Rules</h2>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>
                        Automated triggers that fire when anomalous patterns are detected.
                    </p>
                </div>
                <button onClick={() => setShowCreate(true)} style={{
                    background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8",
                    color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer",
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                }}>+ Create Rule</button>
            </div>

            {rules.map(rule => (
                <div key={rule.id} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{rule.name}</span>
                            <span style={{
                                marginLeft: 8, fontSize: 10, padding: "2px 7px", borderRadius: 10,
                                background: rule.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)",
                                color: rule.status === "active" ? "#22c55e" : "#64748b",
                                fontWeight: 700, letterSpacing: "0.06em",
                            }}>{rule.status.toUpperCase()}</span>
                        </div>
                        <div style={{ display: "flex", gap: 12, flexShrink: 0, marginLeft: 12 }}>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Source: <span style={{ color: "#94a3b8" }}>{rule.source}</span></span>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Triggers: <span style={{ color: "#94a3b8" }}>{rule.triggers}</span></span>
                            <span style={{ color: "#64748b", fontSize: 11 }}>Last: <span style={{ color: "#94a3b8" }}>{rule.lastTrigger}</span></span>
                        </div>
                    </div>
                    {rule.description && (
                        <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{rule.description}</div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button style={btnGhost}>Edit</button>
                        <button style={btnGhost}>View Triggers</button>
                        <button onClick={() => toggleStatus(rule.id)} style={btnDanger}>
                            {rule.status === "active" ? "Pause" : "Activate"}
                        </button>
                    </div>
                </div>
            ))}

            {showCreate && (
                <CreateRuleModal
                    onClose={() => setShowCreate(false)}
                    onCreate={(r) => setRules(prev => [r, ...prev])}
                />
            )}
        </div>
    )
}

// ── Watch Areas ────────────────────────────────────────────────────────────────

const EXAMPLE_WATCH_AREAS = [
    { id: "w1", name: "Isfahan Air Base",      coords: "32.65°N, 51.68°E", frequency: "Weekly",    lastScan: "3 days ago",  detections: 23, change: "+4 aircraft",  status: "alert"  },
    { id: "w2", name: "Bandar Abbas Naval",    coords: "27.18°N, 56.28°E", frequency: "Weekly",    lastScan: "5 days ago",  detections: 12, change: "No change",    status: "normal" },
    { id: "w3", name: "Tartus Naval Base",     coords: "34.89°N, 35.87°E", frequency: "Bi-weekly", lastScan: "12 days ago", detections: 8,  change: "−2 vessels",   status: "normal" },
    { id: "w4", name: "Hmeimim Air Base",      coords: "35.41°N, 35.95°E", frequency: "Weekly",    lastScan: "4 days ago",  detections: 31, change: "+6 aircraft",  status: "alert"  },
    { id: "w5", name: "Latakia Port",          coords: "35.52°N, 35.77°E", frequency: "Monthly",   lastScan: "22 days ago", detections: 5,  change: "No change",    status: "normal" },
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
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>
                        Scheduled Overwatch scans on fixed locations. Alerts fire when detections exceed baseline.
                    </p>
                </div>
                <button style={{
                    background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8",
                    color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer",
                    fontSize: 12, fontWeight: 600,
                }}>+ Add Watch Area</button>
            </div>

            {areas.map(area => (
                <div key={area.id} style={{
                    ...card,
                    border: `1px solid ${area.status === "alert" ? "rgba(239,68,68,0.3)" : "rgba(56,189,248,0.1)"}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{area.name}</span>
                            {area.status === "alert" && (
                                <span style={{
                                    fontSize: 10, padding: "2px 7px", borderRadius: 10,
                                    background: "rgba(239,68,68,0.15)", color: "#ef4444",
                                    fontWeight: 700, letterSpacing: "0.06em",
                                }}>ALERT</span>
                            )}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>
                            {area.coords} • Scan: {area.frequency}
                        </div>
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

// ── Object Training ────────────────────────────────────────────────────────────

const CORRECT_AS_OPTIONS = [
    "Aircraft — Fixed Wing",
    "Aircraft — Rotary Wing",
    "Vehicle — Large",
    "Vehicle — Small",
    "Vessel — Military",
    "Vessel — Cargo",
    "Infrastructure — Launcher",
    "Infrastructure — Radar",
    "Storage Tank",
    "Building",
    "Other / Unknown",
]

function OverwatchReviewCard({ item, onLabel }) {
    const [showCorrect, setShowCorrect] = useState(false)
    const [correction,  setCorrection]  = useState(CORRECT_AS_OPTIONS[0])

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.2)" }}>
            <div style={{ display: "flex", gap: 16 }}>
                <div style={{
                    width: 128, height: 128, flexShrink: 0,
                    background: "#0f172a", borderRadius: 6, overflow: "hidden",
                    border: "1px solid rgba(56,189,248,0.15)",
                }}>
                    {item.crop_b64
                        ? <img src={`data:image/jpeg;base64,${item.crop_b64}`}
                               style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="detection crop" />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 10 }}>No Image</div>
                    }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, textTransform: "capitalize" }}>
                            {item.class || "Unknown"}
                        </span>
                        <span style={{
                            fontSize: 10, padding: "2px 7px", borderRadius: 10,
                            background: "rgba(56,189,248,0.12)", color: "#38bdf8", fontWeight: 700,
                        }}>
                            {Math.round((item.confidence || item.score || 0) * 100)}% conf
                        </span>
                        {item.mock && (
                            <span style={{ fontSize: 10, color: "#475569", padding: "2px 7px", borderRadius: 10, background: "rgba(71,85,105,0.2)" }}>SIM</span>
                        )}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>
                        Site: <span style={{ color: "#94a3b8" }}>{item.site || "Unknown"}</span>
                    </div>
                    {item.center && Array.isArray(item.center) && (
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>
                            Coords: <span style={{ color: "#94a3b8" }}>
                                {item.center[0].toFixed(4)}°N, {item.center[1].toFixed(4)}°E
                            </span>
                        </div>
                    )}
                    <div style={{ color: "#64748b", fontSize: 11 }}>
                        Category: <span style={{ color: "#94a3b8" }}>{item.category || "—"}</span>
                        {item.subcategory && <span style={{ color: "#475569" }}> / {item.subcategory}</span>}
                    </div>
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
                    <button onClick={() => { onLabel("correct", { correction }); setShowCorrect(false) }}
                        style={{ ...btnGhost, whiteSpace: "nowrap", fontWeight: 700 }}>
                        Submit
                    </button>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={() => onLabel("confirm")} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)",
                    color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>✓ Confirm</button>
                <button onClick={() => setShowCorrect(v => !v)} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)",
                    color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>✎ Correct As</button>
                <button onClick={() => onLabel("skip")} style={{
                    padding: "9px 16px", borderRadius: 6,
                    border: "1px solid rgba(100,116,139,0.3)", background: "transparent",
                    color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>Skip</button>
            </div>
        </div>
    )
}

function ObjectTrainingTab() {
    const [items,   setItems]   = useState([])
    const [loading, setLoading] = useState(false)
    const [stats,   setStats]   = useState({ total: 0, confirmed: 0, corrected: 0, skipped: 0 })

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
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
                        Review and correct Overwatch satellite detection labels to improve model accuracy.
                    </p>
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

const AIS_SUSPICIOUS_REASONS = [
    "Transponder gap (dark ship)",
    "Stationary near infrastructure",
    "Speed anomaly",
    "Route deviation",
    "Formation / Convoy",
    "Ship-to-ship transfer zone",
    "Other",
]

function AISTrainingCard({ item, onLabel }) {
    const [showReason, setShowReason] = useState(false)
    const [reason,     setReason]     = useState(AIS_SUSPICIOUS_REASONS[0])

    const fields = [
        ["Type",        item.ship_type || "Unknown"],
        ["Flag",        item.flag || "—"],
        ["Speed",       item.speed != null ? `${item.speed} kn` : "—"],
        ["Heading",     item.heading != null ? `${item.heading}°` : "—"],
        ["Destination", item.destination || "Unknown"],
        ["Callsign",    item.callsign || "—"],
        ["Position",    item.lat != null ? `${item.lat.toFixed(3)}°N, ${item.lon.toFixed(3)}°E` : "—"],
    ]

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15 }}>
                        {item.name || `MMSI ${item.mmsi}`}
                    </span>
                    {item.mock && (
                        <span style={{ fontSize: 10, color: "#475569", padding: "2px 7px", borderRadius: 10, background: "rgba(71,85,105,0.2)" }}>SIM</span>
                    )}
                </div>
                <span style={{ color: "#64748b", fontSize: 11, fontFamily: "monospace", flexShrink: 0 }}>
                    {item.mmsi}
                </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginBottom: 12 }}>
                {fields.map(([label, value]) => (
                    <div key={label} style={{ fontSize: 11 }}>
                        <span style={{ color: "#64748b" }}>{label}: </span>
                        <span style={{ color: "#94a3b8" }}>{value}</span>
                    </div>
                ))}
            </div>

            {showReason && (
                <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                    <select value={reason} onChange={e => setReason(e.target.value)} style={{
                        flex: 1, padding: "7px 10px",
                        background: "rgba(30,41,59,0.8)", border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: 6, color: "#e2e8f0", fontSize: 12, outline: "none",
                    }}>
                        {AIS_SUSPICIOUS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button onClick={() => { onLabel("suspicious", { reason }); setShowReason(false) }}
                        style={{ ...btnDanger, whiteSpace: "nowrap", fontWeight: 700, padding: "7px 12px" }}>
                        Flag
                    </button>
                </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onLabel("normal")} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)",
                    color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>✓ Normal</button>
                <button onClick={() => setShowReason(v => !v)} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)",
                    color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>⚠ Suspicious</button>
                <button onClick={() => onLabel("skip")} style={{
                    padding: "9px 16px", borderRadius: 6,
                    border: "1px solid rgba(100,116,139,0.3)", background: "transparent",
                    color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>Skip</button>
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
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
                        Label vessel behaviour patterns to train anomaly detection models.
                    </p>
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
const EVENT_TYPES     = [
    "Conflict", "Explosion / Remote Violence", "Protests", "Riots",
    "Strategic Developments", "Violence Against Civilians", "Other",
]

const SEVERITY_COLORS = {
    critical:    { bg: "rgba(239,68,68,0.15)",   text: "#ef4444" },
    significant: { bg: "rgba(245,158,11,0.15)",  text: "#f59e0b" },
    elevated:    { bg: "rgba(56,189,248,0.12)",  text: "#38bdf8" },
    low:         { bg: "rgba(100,116,139,0.2)",  text: "#64748b" },
}

function NewsTrainingCard({ item, onLabel }) {
    const [showAdjust,   setShowAdjust]   = useState(false)
    const [adjSeverity,  setAdjSeverity]  = useState(item.severity_tier || "elevated")
    const [adjType,      setAdjType]      = useState(item.event_type    || "Conflict")

    const sc = SEVERITY_COLORS[item.severity_tier] || SEVERITY_COLORS.low

    return (
        <div style={{ ...card, border: "1px solid rgba(56,189,248,0.15)" }}>
            <div style={{ marginBottom: 10 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13, lineHeight: 1.45, marginBottom: 7 }}>
                    {item.title || "Untitled"}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{item.source || "Unknown Source"}</span>
                    {item.published && (
                        <span style={{ fontSize: 11, color: "#475569" }}>
                            {new Date(item.published).toLocaleDateString()}
                        </span>
                    )}
                    <span style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                        background: sc.bg, color: sc.text,
                    }}>
                        {(item.severity_tier || "LOW").toUpperCase()}
                    </span>
                    {item.event_type && (
                        <span style={{ fontSize: 10, color: "#94a3b8", padding: "2px 8px", borderRadius: 10, background: "rgba(30,41,59,0.8)" }}>
                            {item.event_type}
                        </span>
                    )}
                    {item.mock && (
                        <span style={{ fontSize: 10, color: "#475569", padding: "2px 7px", borderRadius: 10, background: "rgba(71,85,105,0.2)" }}>SIM</span>
                    )}
                </div>
            </div>

            {showAdjust && (
                <div style={{ marginBottom: 12, padding: 12, background: "rgba(30,41,59,0.6)", borderRadius: 6, border: "1px solid rgba(56,189,248,0.15)" }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>SEVERITY</label>
                            <select value={adjSeverity} onChange={e => setAdjSeverity(e.target.value)} style={{
                                width: "100%", padding: "6px 8px", outline: "none",
                                background: "rgba(15,23,42,0.9)", border: "1px solid rgba(56,189,248,0.2)",
                                borderRadius: 4, color: "#e2e8f0", fontSize: 12,
                            }}>
                                {SEVERITY_TIERS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 4 }}>EVENT TYPE</label>
                            <select value={adjType} onChange={e => setAdjType(e.target.value)} style={{
                                width: "100%", padding: "6px 8px", outline: "none",
                                background: "rgba(15,23,42,0.9)", border: "1px solid rgba(56,189,248,0.2)",
                                borderRadius: 4, color: "#e2e8f0", fontSize: 12,
                            }}>
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
                <button onClick={() => onLabel("correct")} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.1)",
                    color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>✓ Correct</button>
                <button onClick={() => setShowAdjust(v => !v)} style={{
                    flex: 1, padding: "9px 0", borderRadius: 6,
                    border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)",
                    color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>✎ Adjust</button>
                <button onClick={() => onLabel("skip")} style={{
                    padding: "9px 16px", borderRadius: 6,
                    border: "1px solid rgba(100,116,139,0.3)", background: "transparent",
                    color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 700,
                }}>Skip</button>
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
        setStats(prev => ({
            ...prev,
            total:    prev.total + 1,
            correct:  label === "correct"  ? prev.correct  + 1 : prev.correct,
            adjusted: label === "adjusted" ? prev.adjusted + 1 : prev.adjusted,
            skipped:  label === "skip"     ? prev.skipped  + 1 : prev.skipped,
        }))
        const tok = localStorage.getItem("hw-auth-token")
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ id, label, source_type: "news", ...extra }),
        }).catch(() => {})
    }

    const statCards = [
        { label: "Reviewed",  value: stats.total,    color: "#38bdf8" },
        { label: "Correct",   value: stats.correct,  color: "#22c55e" },
        { label: "Adjusted",  value: stats.adjusted, color: "#f59e0b" },
        { label: "Skipped",   value: stats.skipped,  color: "#64748b" },
    ]

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 16 }}>News Classification Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
                        Review AI-scored news articles and correct severity and event-type labels.
                    </p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{
                    background: loading ? "rgba(56,189,248,0.1)" : "rgba(56,189,248,0.15)",
                    border: "1px solid #38bdf8", color: loading ? "#64748b" : "#38bdf8",
                    padding: "8px 16px", borderRadius: 6, cursor: loading ? "default" : "pointer",
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16,
                }}>
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

            <ReviewQueue
                items={items}
                onLabel={handleLabel}
                loading={loading}
                onGenerate={generateBatch}
                generateLabel="Load Batch"
                renderCard={(item, labelFn) => <NewsTrainingCard item={item} onLabel={labelFn} />}
            />
        </div>
    )
}

// ── Skeleton tabs ──────────────────────────────────────────────────────────────

function SkeletonTab({ title, description, icon }) {
    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 6px", fontSize: 16 }}>{icon} {title}</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 24 }}>{description}</p>
            <div style={{
                color: "#64748b", fontSize: 13, padding: 32, textAlign: "center",
                background: "rgba(15,23,42,0.5)", borderRadius: 8,
                border: "1px dashed rgba(56,189,248,0.18)",
            }}>
                This module will be built out in a future session.
            </div>
        </div>
    )
}

// ── Map Overlays ───────────────────────────────────────────────────────────────

const OVERLAYS = [
    {
        name: "Light Pollution (VIIRS Nighttime Lights)",
        description: "VIIRS nighttime lights — shows human activity, energy infrastructure, urbanisation. Updated nightly by NASA.",
        source: "NASA GIBS / Earth Observation Group",
        available: true,
        id: "light-pollution",
    },
    {
        name: "GPS Jamming Zones",
        description: "Known GPS interference areas from OPSGROUP reports — updated weekly from pilot reports.",
        source: "OPSGROUP",
        available: false,
        id: "gps-jam",
    },
    {
        name: "Nuclear Facilities",
        description: "IAEA global nuclear installation database — power plants, research reactors, enrichment facilities.",
        source: "IAEA",
        available: false,
        id: "nuclear",
    },
    {
        name: "UNHCR Refugee Camps",
        description: "UNHCR-registered camp locations with population estimates. Updated quarterly.",
        source: "UNHCR",
        available: false,
        id: "refugees",
    },
]

function MapOverlaysTab({ onAddOverlay }) {
    const [active, setActive] = useState(new Set())

    const toggle = (id) => {
        const next = new Set(active)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        setActive(next)
        onAddOverlay?.(id, !active.has(id))
    }

    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 6px", fontSize: 16 }}>Custom Map Overlays</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 20 }}>
                Add supplemental data layers to the 3D globe.
            </p>
            {OVERLAYS.map(o => (
                <div key={o.id} style={{
                    ...card,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    border: active.has(o.id) ? "1px solid rgba(56,189,248,0.3)" : "1px solid rgba(56,189,248,0.1)",
                }}>
                    <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
                        <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{o.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>{o.description}</div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Source: {o.source}</div>
                    </div>
                    <button
                        disabled={!o.available}
                        onClick={() => o.available && toggle(o.id)}
                        style={{
                            padding: "7px 14px", borderRadius: 6, border: "none",
                            cursor: o.available ? "pointer" : "not-allowed",
                            background: !o.available ? "rgba(100,116,139,0.2)"
                                : active.has(o.id) ? "rgba(56,189,248,0.25)"
                                : "#38bdf8",
                            color: !o.available ? "#64748b"
                                : active.has(o.id) ? "#38bdf8"
                                : "#0f172a",
                            fontWeight: 600, fontSize: 12, whiteSpace: "nowrap",
                            flexShrink: 0,
                        }}
                    >
                        {!o.available ? "Coming Soon"
                            : active.has(o.id) ? "Remove Layer"
                            : "Add to Globe"}
                    </button>
                </div>
            ))}
        </div>
    )
}

// ── ForgePanel ─────────────────────────────────────────────────────────────────

export default function ForgePanel({ user, onClose, onAddOverlay }) {
    const [activeTab, setActiveTab] = useState("rules")

    return (
        <div style={{
            position: "absolute", inset: 0,
            background: "rgba(5, 9, 20, 0.98)",
            display: "flex", flexDirection: "column",
            fontFamily: "system-ui, -apple-system, sans-serif",
            zIndex: 50,
        }}>
            {/* Header */}
            <div style={{
                padding: "0 24px",
                height: 52,
                flexShrink: 0,
                borderBottom: "1px solid rgba(56, 189, 248, 0.12)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0", letterSpacing: "0.04em" }}>
                        ⚒ FORGE
                    </span>
                    <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                        color: "#38bdf8", background: "rgba(56,189,248,0.12)",
                        border: "1px solid rgba(56,189,248,0.25)",
                        padding: "2px 8px", borderRadius: 4,
                    }}>INTELLIGENCE TRAINING LAB</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>
                        {user?.email || "admin"}
                    </span>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        title="Close Forge"
                        style={{
                            background: "none", border: "none", color: "#475569",
                            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 8px",
                        }}
                    >×</button>
                )}
            </div>

            {/* Inner tab bar */}
            <div style={{
                display: "flex", gap: 2, padding: "8px 24px 0",
                borderBottom: "1px solid rgba(56, 189, 248, 0.08)",
                flexShrink: 0, overflowX: "auto",
            }}>
                {FORGE_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: "7px 14px 9px",
                            borderRadius: "6px 6px 0 0",
                            border: "none",
                            borderBottom: activeTab === tab.id ? "2px solid #38bdf8" : "2px solid transparent",
                            cursor: "pointer",
                            background: activeTab === tab.id ? "rgba(56,189,248,0.08)" : "transparent",
                            color: activeTab === tab.id ? "#38bdf8" : "#64748b",
                            fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                            transition: "color 0.12s, background 0.12s",
                        }}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
                {activeTab === "rules"         && <PatternRulesTab />}
                {activeTab === "watch"         && <WatchAreasTab />}
                {activeTab === "recognition"   && <ObjectTrainingTab />}
                {activeTab === "ais-training"  && <AISTrainingTab />}
                {activeTab === "news-training" && <NewsTrainingTab />}
                {activeTab === "entities"      && (
                    <SkeletonTab
                        icon="🕸"
                        title="Entity Networks"
                        description="Track relationships between actors, organisations, vessels, and locations. Build graph-based intelligence networks from event co-occurrence data."
                    />
                )}
                {activeTab === "feeds"         && (
                    <SkeletonTab
                        icon="📡"
                        title="Data Feeds"
                        description="Manage custom RSS/XML/JSON data ingestion pipelines. Add proprietary intelligence feeds, wire sensor outputs, or configure partner data streams."
                    />
                )}
                {activeTab === "models"        && (
                    <SkeletonTab
                        icon="🧠"
                        title="Model Management"
                        description="Configure and evaluate the AI models powering Director Mode briefings, event classification, entity extraction, and Overwatch object detection."
                    />
                )}
                {activeTab === "overlays"      && <MapOverlaysTab onAddOverlay={onAddOverlay} />}
            </div>
        </div>
    )
}
