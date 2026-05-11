import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import ReviewQueue from "./forge/ReviewQueue.jsx"
import ForceGraph from "./forge/ForceGraph.jsx"

const API = API_BASE

// ── Auth helpers ───────────────────────────────────────────────────────────────
function forgeHeaders(extra = {}) {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
        ...extra,
    }
}

function forgeFormHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

// ── Passcode gate ─────────────────────────────────────────────────────────────
export function ForgeGate({ children }) {
    const [authenticated, setAuthenticated] = useState(
        localStorage.getItem("forge_access") === "true"
    )
    const [passcode, setPasscode] = useState("")
    const [error,    setError]    = useState("")
    const [loading,  setLoading]  = useState(false)

    async function handleSubmit() {
        if (!passcode) return
        setLoading(true)
        setError("")
        try {
            const resp = await fetch(`${API}/api/forge/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passcode }),
            })
            if (resp.ok) {
                localStorage.setItem("forge_access",   "true")
                localStorage.setItem("forge_passcode", passcode)
                setAuthenticated(true)
            } else {
                setError("Invalid passcode")
            }
        } catch {
            setError("Connection failed")
        } finally {
            setLoading(false)
        }
    }

    if (authenticated) return children

    return (
        <div style={{
            position: "absolute", inset: 0, background: "rgba(8,12,24,0.98)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div style={{
                background: "rgba(15,23,42,0.95)", border: "1px solid rgba(56,189,248,0.2)",
                borderRadius: 12, padding: 36, width: 340, textAlign: "center",
            }}>
                <FIcoHammer w={28} h={28} style={{ color: "rgba(56,189,248,0.8)", marginBottom: 10 }} />
                <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>FORGE</div>
                <div style={{ color: "#64748b", fontSize: 12, marginBottom: 24 }}>Intelligence Training Lab</div>
                <input
                    type="password" value={passcode}
                    onChange={e => { setPasscode(e.target.value); setError("") }}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    placeholder="Enter passcode"
                    autoFocus
                    style={{
                        width: "100%", padding: "10px 14px",
                        background: "rgba(30,41,59,0.8)",
                        border: `1px solid ${error ? "#ef4444" : "rgba(56,189,248,0.2)"}`,
                        borderRadius: 6, color: "#e2e8f0", fontSize: 14, textAlign: "center",
                        letterSpacing: 6, outline: "none", boxSizing: "border-box",
                    }}
                />
                {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{error}</div>}
                <button
                    onClick={handleSubmit} disabled={loading}
                    style={{
                        width: "100%", marginTop: 14, padding: "10px",
                        borderRadius: 6, background: loading ? "rgba(56,189,248,0.4)" : "#38bdf8",
                        border: "none", color: "#0f172a", fontWeight: 600,
                        cursor: loading ? "default" : "pointer", fontSize: 14,
                    }}
                >
                    {loading ? "Checking…" : "Access Forge"}
                </button>
            </div>
        </div>
    )
}

// ── Icon primitives ────────────────────────────────────────────────────────────
function FI({ children, w = 13, h = 13, ...rest }) {
    return (
        <svg width={w} height={h} viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
            {...rest}>
            {children}
        </svg>
    )
}
const FIcoTarget    = (p) => <FI {...p}><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><line x1="8" y1="1" x2="8" y2="5"/><line x1="8" y1="11" x2="8" y2="15"/><line x1="1" y1="8" x2="5" y2="8"/><line x1="11" y1="8" x2="15" y2="8"/></FI>
const FIcoFlash     = (p) => <FI {...p}><polyline points="10,1 5,9 9,9 6,15"/></FI>
const FIcoSatellite = (p) => <FI {...p}><rect x="5" y="5" width="6" height="6" rx="1" transform="rotate(45 8 8)"/><line x1="11.2" y1="4.8" x2="13.5" y2="2.5"/><line x1="4.8" y1="11.2" x2="2.5" y2="13.5"/><circle cx="13.5" cy="2.5" r="1.2" fill="currentColor" stroke="none"/></FI>
const FIcoSearch    = (p) => <FI {...p}><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="14" y2="14"/></FI>
const FIcoShip      = (p) => <FI {...p}><path d="M3 9h10l-2 5H5Z"/><rect x="5" y="5" width="6" height="4"/><line x1="8" y1="1" x2="8" y2="5"/><line x1="5.5" y1="3" x2="10.5" y2="3"/></FI>
const FIcoPaper     = (p) => <FI {...p}><rect x="2" y="1.5" width="12" height="13" rx="1.5"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="9" x2="11" y2="9"/><line x1="5" y1="12" x2="8" y2="12"/></FI>
const FIcoNetwork   = (p) => <FI {...p}><circle cx="8" cy="8" r="2"/><circle cx="2.5" cy="3" r="1.4"/><circle cx="13.5" cy="3" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="13.5" cy="13" r="1.4"/><line x1="3.5" y1="3.8" x2="6.4" y2="6.5"/><line x1="12.5" y1="3.8" x2="9.6" y2="6.5"/><line x1="3.5" y1="12.2" x2="6.4" y2="9.5"/><line x1="12.5" y1="12.2" x2="9.6" y2="9.5"/></FI>
const FIcoAntenna   = (p) => <FI {...p}><line x1="8" y1="8" x2="8" y2="15"/><path d="M5 7C5 4.5 11 4.5 11 7"/><path d="M2.5 5.5C2.5 1.5 13.5 1.5 13.5 5.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/></FI>
const FIcoBrain     = (p) => <FI strokeWidth="1.3" {...p}><path d="M8 3.5C6 3.5 4.5 5 4.5 7C4.5 8.5 5.5 9 5.5 9C3.5 9.5 3 11 3 12C3 13 4 13.5 5 13.5"/><path d="M8 3.5C10 3.5 11.5 5 11.5 7C11.5 8.5 10.5 9 10.5 9C12.5 9.5 13 11 13 12C13 13 12 13.5 11 13.5"/><line x1="8" y1="3.5" x2="8" y2="13.5"/></FI>
const FIcoMapGrid   = (p) => <FI {...p}><polygon points="1,2 6,4 6,14 1,12"/><polygon points="6,4 11,2 11,12 6,14"/><polygon points="11,2 15,4 15,14 11,12"/></FI>
const FIcoGlobe     = (p) => <FI {...p}><circle cx="8" cy="8" r="6"/><path d="M8 2C6.5 5 6.5 11 8 14M8 2C9.5 5 9.5 11 8 14"/><line x1="2.5" y1="8" x2="13.5" y2="8"/></FI>
const FIcoPadlock   = (p) => <FI {...p}><rect x="3" y="8" width="10" height="7" rx="1.5"/><path d="M5 8V6C5 3.8 11 3.8 11 6V8"/></FI>
const FIcoPlug      = (p) => <FI {...p}><line x1="2" y1="14" x2="14" y2="2"/><path d="M7 9L9 7L12 10L10 12Z"/><line x1="5" y1="5.8" x2="3" y2="3.8"/><line x1="6.8" y1="4" x2="4.8" y2="2"/></FI>
const FIcoPerson    = (p) => <FI {...p}><circle cx="8" cy="5.5" r="3"/><path d="M2.5 15C2.5 12 5 9.5 8 9.5C11 9.5 13.5 12 13.5 15"/></FI>
const FIcoSwords    = (p) => <FI {...p}><line x1="2" y1="14" x2="9" y2="7"/><line x1="14" y1="2" x2="7" y2="9"/><line x1="5" y1="14" x2="8" y2="11"/><line x1="11" y1="2" x2="8" y2="5"/></FI>
const FIcoFactory   = (p) => <FI {...p}><path d="M1 14V8L5.5 11V8L10 11V6L15 6V14Z"/><line x1="1" y1="14" x2="15" y2="14"/></FI>
const FIcoPin       = (p) => <FI {...p}><circle cx="8" cy="6.5" r="3"/><path d="M8 9.5C8 9.5 3 12.5 3 9.5C3 6.5 5 2.5 8 2.5C11 2.5 13 6.5 13 9.5C13 12.5 8 9.5 8 9.5Z"/><line x1="8" y1="13" x2="8" y2="15.5"/></FI>
const FIcoHammer    = (p) => <FI {...p}><path d="M2 14L7.5 8.5"/><rect x="6.5" y="1.5" width="5" height="5" rx="1" transform="rotate(-45 8 4)"/></FI>
const FIcoWarning   = (p) => <FI strokeWidth="1.5" {...p}><path d="M8 2L15 14H1L8 2Z"/><line x1="8" y1="7" x2="8" y2="10.5"/><circle cx="8" cy="12.5" r="0.8" fill="currentColor" stroke="none"/></FI>
const FIcoCog       = (p) => <FI {...p}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2L11.4 4.6M4.6 11.4L3.2 12.8"/></FI>
const FIcoAircraft  = (p) => <FI strokeWidth="1.3" {...p}><path d="M8 1.5L11.5 8L8 7L4.5 8Z"/><path d="M6 7.5L4 10.5H12L10 7.5"/><line x1="8" y1="10.5" x2="8" y2="14"/><line x1="6" y1="13" x2="10" y2="13"/></FI>
const FIcoAnchor    = (p) => <FI {...p}><circle cx="8" cy="4.5" r="2"/><line x1="8" y1="6.5" x2="8" y2="15"/><path d="M4 10C4 10 4 15 8 15C12 15 12 10 12 10"/><line x1="5" y1="4.5" x2="11" y2="4.5"/></FI>

const FORGE_TABS = [
    { id: "dashboard",     label: "Threat Matrix",     icon: <FIcoTarget /> },
    { id: "rules",         label: "Pattern Rules",     icon: <FIcoFlash /> },
    { id: "watch",         label: "Watch Areas",        icon: <FIcoSatellite /> },
    { id: "recognition",   label: "Object Training",    icon: <FIcoSearch /> },
    { id: "ais-training",  label: "AIS Training",       icon: <FIcoShip /> },
    { id: "news-training", label: "News Training",      icon: <FIcoPaper /> },
    { id: "entities",      label: "Entity Networks",    icon: <FIcoNetwork /> },
    { id: "feeds",         label: "Data Feeds",         icon: <FIcoAntenna /> },
    { id: "models",        label: "Model Management",   icon: <FIcoBrain /> },
]

// ── Shared styles ──────────────────────────────────────────────────────────────

const card = {
    background: "#111827",
    border: "1px solid rgba(148,163,184,0.1)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
}

const btnGhost = {
    fontSize: 11, padding: "4px 10px", borderRadius: 4,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "transparent", color: "#94a3b8", cursor: "pointer",
}

const btnDanger = {
    fontSize: 11, padding: "4px 10px", borderRadius: 4,
    border: "1px solid rgba(239,68,68,0.25)",
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

const DOMAIN_STYLE = {
    AIS:  { bg: "rgba(245,158,11,0.2)",  color: "#f59e0b" },
    ADSB: { bg: "rgba(56,189,248,0.2)",  color: "#38bdf8" },
    NEWS: { bg: "rgba(249,115,22,0.2)",  color: "#f97316" },
    SAT:  { bg: "rgba(168,85,247,0.2)",  color: "#a855f7" },
}

function CorrelationCards({ correlations, onFlyTo, setActiveTab }) {
    if (!correlations.length) return null
    const sevColor = sev =>
        sev === "CRITICAL" ? "#ef4444" : sev === "HIGH" ? "#f59e0b" : sev === "ELEVATED" ? "#38bdf8" : "#64748b"
    const typeLabel = t =>
        t === "correlation"         ? "Multi-Source Correlation" :
        t === "escalation_sequence" ? "Escalation Sequence" :
        t === "repeat_offender"     ? "Repeat Offender" :
        t === "ontology_propagation"? "Network Effect" : t

    return (
        <div style={{ marginBottom: 24 }}>
            <h3 style={{ color: "#e2e8f0", fontSize: 15, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
                <FIcoBrain w={14} h={14} style={{ color: "#38bdf8" }} />
                Intelligence Correlations ({correlations.length})
            </h3>
            {correlations.map((c, i) => {
                const sc = sevColor(c.severity)
                return (
                    <div key={i} style={{ ...card, borderLeft: `3px solid ${sc}40`, marginBottom: 10 }}>
                        {/* Header row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${sc}22`, color: sc }}>
                                    {c.severity}
                                </span>
                                <span style={{ color: "#e2e8f0", fontSize: 11 }}>{typeLabel(c.type)}</span>
                            </div>
                            <span style={{ color: "#64748b", fontSize: 10 }}>
                                Confidence: {Math.round((c.confidence || 0) * 100)}%
                            </span>
                        </div>

                        {/* Narrative */}
                        <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.45, marginBottom: 8 }}>{c.narrative}</div>

                        {/* Domain badges */}
                        {c.domains && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                                {c.domains.map(d => {
                                    const ds = DOMAIN_STYLE[d] || { bg: "rgba(100,116,139,0.2)", color: "#64748b" }
                                    return (
                                        <span key={d} style={{ padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: ds.bg, color: ds.color }}>
                                            {d}
                                        </span>
                                    )
                                })}
                                <span style={{ color: "#475569", fontSize: 9, alignSelf: "center" }}>
                                    {c.signal_count} signals
                                </span>
                            </div>
                        )}

                        {/* Related ontology entities */}
                        {c.related_entities?.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                                <span style={{ color: "#475569", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Related: </span>
                                {c.related_entities.map((e, j) => (
                                    <span key={j} style={{ color: "#94a3b8", fontSize: 11 }}>
                                        {e.label} ({e.distance_km}km){j < c.related_entities.length - 1 ? " · " : ""}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Recommendation */}
                        {c.recommendation && (
                            <div style={{ padding: "8px 10px", background: "rgba(56,189,248,0.05)", borderRadius: 4, borderLeft: "3px solid rgba(56,189,248,0.3)", marginBottom: 8 }}>
                                <div style={{ color: "#475569", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Recommendation</div>
                                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.45 }}>{c.recommendation}</div>
                            </div>
                        )}

                        {/* Collapsible signal list */}
                        {c.signals?.length > 0 && (
                            <details style={{ marginBottom: 8 }}>
                                <summary style={{ color: "#64748b", fontSize: 11, cursor: "pointer", userSelect: "none" }}>
                                    {c.signals.length} contributing signals
                                </summary>
                                <div style={{ marginTop: 6, paddingLeft: 4 }}>
                                    {c.signals.map((s, j) => (
                                        <div key={j} style={{ color: "#94a3b8", fontSize: 11, padding: "2px 0" }}>
                                            <span style={{ color: "#475569" }}>[{s.source}]</span> {s.message}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {c.lat && c.lng && onFlyTo && (
                                <button onClick={() => onFlyTo({ lat: c.lat, lng: c.lng })} style={btnGhost}>View on Map</button>
                            )}
                            {setActiveTab && (
                                <button onClick={() => setActiveTab("entities")} style={btnGhost}>View in Ontology</button>
                            )}
                            <button style={{ ...btnGhost, color: "#22c55e", borderColor: "rgba(34,197,94,0.3)" }}>✓ Valid</button>
                            <button style={btnDanger}>✕ False</button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function ThreatDashboard({ setActiveTab, onFlyTo }) {
    const [scores,       setScores]       = useState([])
    const [alerts,       setAlerts]       = useState([])
    const [correlations, setCorrelations] = useState([])
    const [brainStatus,  setBrainStatus]  = useState(null)
    const [loading,      setLoading]      = useState(true)

    const loadScores       = () => fetch(`${API}/api/forge/threat-scores`, { headers: forgeHeaders() }).then(r => r.ok ? r.json() : []).catch(() => [])
    const loadAlerts       = () => fetch(`${API}/api/forge/alerts`,         { headers: forgeHeaders() }).then(r => r.ok ? r.json() : []).catch(() => [])
    const loadCorrelations = () => fetch(`${API}/api/forge/correlations`,   { headers: forgeHeaders() }).then(r => r.ok ? r.json() : []).catch(() => [])
    const loadBrainStatus  = () => fetch(`${API}/api/forge/brain-status`,   { headers: forgeHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null)

    const refresh = () => {
        setLoading(true)
        Promise.all([loadScores(), loadAlerts(), loadCorrelations(), loadBrainStatus()])
            .then(([s, a, c, b]) => { setScores(s); setAlerts(a); setCorrelations(c); setBrainStatus(b) })
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        refresh()
        const id = setInterval(refresh, 60_000)
        return () => clearInterval(id)
    }, [])

    const sendFeedback = (idx, action) => {
        fetch(`${API}/api/forge/alerts/${idx}/feedback`, {
            method: "POST",
            headers: forgeHeaders(),
            body: JSON.stringify({ action }),
        }).then(r => r.ok ? r.json() : null).then(d => { if (d) refresh() }).catch(() => {})
    }

    const sevColor = sev => sev === "critical" ? "#ef4444" : sev === "high" ? "#f59e0b" : sev === "medium" ? "#38bdf8" : "#64748b"

    const statBarStyle = {
        display: "flex", gap: 0, marginBottom: 20,
        background: "rgba(10,14,26,0.8)", border: "1px solid rgba(148,163,184,0.1)",
        borderRadius: 8, overflow: "hidden",
    }
    const statCellStyle = {
        flex: 1, padding: "10px 14px", borderRight: "1px solid rgba(148,163,184,0.08)",
        display: "flex", flexDirection: "column", gap: 2,
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 3px", fontSize: 16 }}>Threat Assessment Matrix</h2>
                    <div style={{ color: "#475569", fontSize: 11 }}>Refreshes every 60s · detection cycle every 5 min</div>
                </div>
                <button onClick={refresh} style={btnGhost}>{loading ? "Loading…" : "↻ Refresh"}</button>
            </div>

            {/* Brain status stat bar */}
            <div style={statBarStyle}>
                {[
                    { label: "Last Cycle", value: brainStatus?.last_cycle ? new Date(brainStatus.last_cycle).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—" },
                    { label: "Vessels", value: brainStatus?.vessels_tracked ?? "—" },
                    { label: "Active Rules", value: brainStatus?.rules_active ?? "—" },
                    { label: "Alerts (24h)", value: brainStatus?.alerts_24h ?? "—" },
                    { label: "Correlations", value: brainStatus?.correlations_24h ?? "—" },
                ].map((stat, i, arr) => (
                    <div key={stat.label} style={{ ...statCellStyle, borderRight: i === arr.length - 1 ? "none" : statCellStyle.borderRight }}>
                        <div style={{ color: "#94a3b8", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{stat.label}</div>
                        <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{stat.value}</div>
                    </div>
                ))}
            </div>

            {/* Region score cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px,1fr))", gap: 10, marginBottom: 28 }}>
                {scores.length === 0 && !loading && (
                    <div style={{ color: "#475569", fontSize: 13, gridColumn: "1/-1", padding: "20px 0" }}>
                        No threat data yet — detection cycle runs every 5 minutes.
                    </div>
                )}
                {scores.map(s => (
                    <div key={s.region} style={{ ...card, borderLeft: `4px solid ${LEVEL_COLORS[s.level] || "#64748b"}`, padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <div style={{ color: "#94a3b8", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.region}</div>
                                <div style={{ color: LEVEL_COLORS[s.level], fontSize: 20, fontWeight: 800, margin: "2px 0" }}>{s.level}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700 }}>{Math.round((s.score || 0) * 100)}%</div>
                                <div style={{ color: "#64748b", fontSize: 10 }}>{s.alert_count ?? 0} alerts</div>
                            </div>
                        </div>
                        {/* Signal breakdown bars */}
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                            {Object.entries(s.breakdown || {}).map(([sig, val]) => {
                                const raw = sig === "ais_anomaly"    ? s.signals_raw?.ais_alerts
                                          : sig === "adsb_anomaly"   ? s.signals_raw?.adsb_alerts
                                          : sig === "news_escalation" || sig === "event_density" ? s.signals_raw?.news_events
                                          : null
                                return (
                                    <div key={sig} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ color: "#475569", fontSize: 9, width: 94, textAlign: "right", flexShrink: 0 }}>{sig.replace(/_/g, " ")}</span>
                                        <div style={{ flex: 1, height: 5, background: "rgba(30,41,59,0.8)", borderRadius: 3 }}>
                                            <div style={{ height: "100%", borderRadius: 3, transition: "width 0.5s", width: `${Math.min((s.score > 0 ? val / s.score : 0) * 100, 100)}%`, background: val > 0 ? "#38bdf8" : "#1e293b" }} />
                                        </div>
                                        <span style={{ color: "#94a3b8", fontSize: 9, width: 18, textAlign: "right" }}>{raw ?? ""}</span>
                                    </div>
                                )
                            })}
                            {/* Correlation bonus row */}
                            {(s.correlation_bonus > 0 || s.contributing_correlations > 0) && (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ color: "#f97316", fontSize: 9, width: 94, textAlign: "right", flexShrink: 0 }}>correlations</span>
                                    <div style={{ flex: 1, height: 5, background: "rgba(30,41,59,0.8)", borderRadius: 3 }}>
                                        <div style={{ height: "100%", borderRadius: 3, transition: "width 0.5s", width: `${Math.min((s.correlation_bonus || 0) * 100, 100)}%`, background: "#f97316" }} />
                                    </div>
                                    <span style={{ color: "#f97316", fontSize: 9, width: 18, textAlign: "right" }}>{s.contributing_correlations ?? ""}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Cross-domain correlations */}
            <CorrelationCards correlations={correlations} onFlyTo={onFlyTo} setActiveTab={setActiveTab} />

            {/* Alert feed */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ color: "#94a3b8", fontSize: 12, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Active Alerts ({alerts.length})
                </h3>
            </div>
            {alerts.length === 0 && !loading && (
                <div style={{ color: "#475569", fontSize: 13, padding: "28px 0", textAlign: "center" }}>
                    No alerts fired yet. Rules run against live AIS + ADS-B data every 5 min.
                </div>
            )}
            {alerts.slice(0, 40).map((a, i) => (
                <div key={i} style={{ ...card, borderLeft: `3px solid ${sevColor(a.severity)}`, padding: "10px 14px", marginBottom: 8 }}>
                    <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.4 }}>{a.message}</div>
                    <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>
                        {a.rule_name || a.type} • <span style={{ color: sevColor(a.severity) }}>{(a.severity || "").toUpperCase()}</span> • {(a.timestamp || "").slice(0, 19).replace("T", " ")} UTC
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                        {a.lat && a.lng && onFlyTo && (
                            <button
                                onClick={() => { onFlyTo({ lat: a.lat, lng: a.lng }); }}
                                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(56,189,248,0.3)", background: "transparent", color: "#38bdf8", cursor: "pointer" }}
                            >View on Map</button>
                        )}
                        {setActiveTab && (
                            <button
                                onClick={() => setActiveTab("entities")}
                                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(56,189,248,0.3)", background: "transparent", color: "#38bdf8", cursor: "pointer" }}
                            >View in Ontology</button>
                        )}
                        <button
                            onClick={() => sendFeedback(i, "confirm")}
                            style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(34,197,94,0.3)", background: "transparent", color: "#22c55e", cursor: "pointer" }}
                        >✓ Confirm</button>
                        <button
                            onClick={() => sendFeedback(i, "false_alarm")}
                            style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#ef4444", cursor: "pointer" }}
                        >✕ False Alarm</button>
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
        fetch(`${API}/api/forge/rules`, {
            method: "POST",
            headers: forgeHeaders(),
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
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button onClick={handleCreate} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#38bdf8", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Create Rule</button>
                </div>
            </div>
        </div>
    )
}

const fieldStyle = {
    width: "100%", padding: "7px 10px", marginBottom: 10, marginTop: 3,
    background: "rgba(30,41,59,0.8)", border: "1px solid rgba(56,189,248,0.2)",
    borderRadius: 6, color: "#e2e8f0", fontSize: 12, boxSizing: "border-box", outline: "none",
}

function RuleEditor({ rule, alerts, onSave, onClose }) {
    const [r, setR] = useState({ ...rule, params: { ...(rule.params || {}) } })

    const updateParam = (key, raw) => {
        let v = raw
        try { v = JSON.parse(raw) } catch {}
        setR(prev => ({ ...prev, params: { ...prev.params, [key]: v } }))
    }

    const save = () => {
        fetch(`${API}/api/forge/rules/${r.id}`, {
            method: "PUT",
            headers: forgeHeaders(),
            body: JSON.stringify(r),
        }).then(res => res.ok ? res.json() : null).then(d => { if (d) onSave(d) }).catch(() => {})
        onClose()
    }

    const ruleTriggers = (alerts || []).filter(a => a.rule_id === r.id)

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "rgba(10,18,40,0.98)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 12, padding: 24, width: 520, maxHeight: "85vh", overflowY: "auto" }}>
                <h3 style={{ color: "#e2e8f0", margin: "0 0 16px", fontSize: 15 }}>Edit Rule</h3>

                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Rule Name</div>
                <input value={r.name} onChange={e => setR({ ...r, name: e.target.value })} style={fieldStyle} />

                <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Description</div>
                <input value={r.description || ""} onChange={e => setR({ ...r, description: e.target.value })} style={fieldStyle} />

                <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Severity</div>
                        <select value={r.severity || "medium"} onChange={e => setR({ ...r, severity: e.target.value })} style={fieldStyle}>
                            {["info", "medium", "high", "critical"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Status</div>
                        <select value={r.status || "active"} onChange={e => setR({ ...r, status: e.target.value })} style={fieldStyle}>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                        </select>
                    </div>
                </div>

                {Object.keys(r.params || {}).length > 0 && (
                    <>
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, marginTop: 4 }}>Parameters</div>
                        {Object.entries(r.params).map(([key, val]) => (
                            <div key={key} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                                <span style={{ color: "#64748b", fontSize: 11, width: 160, flexShrink: 0 }}>{key.replace(/_/g, " ")}</span>
                                <input
                                    defaultValue={typeof val === "object" ? JSON.stringify(val) : String(val)}
                                    onBlur={e => updateParam(key, e.target.value)}
                                    style={{ ...fieldStyle, flex: 1, marginBottom: 0 }}
                                />
                            </div>
                        ))}
                    </>
                )}

                <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(30,41,59,0.5)", borderRadius: 6 }}>
                    <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>RECENT TRIGGERS ({ruleTriggers.length})</div>
                    {ruleTriggers.length === 0
                        ? <div style={{ color: "#475569", fontSize: 12 }}>No triggers recorded yet.</div>
                        : ruleTriggers.slice(0, 5).map((a, i) => (
                            <div key={i} style={{ color: "#94a3b8", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                {(a.timestamp || "").slice(0, 19).replace("T", " ")} — {a.message}
                            </div>
                          ))
                    }
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Cancel</button>
                    <button onClick={save} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#38bdf8", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Save Rule</button>
                </div>
            </div>
        </div>
    )
}

function PatternRulesTab() {
    const [rules,       setRules]       = useState([])
    const [loading,     setLoading]     = useState(true)
    const [showCreate,  setShowCreate]  = useState(false)
    const [editingRule, setEditingRule] = useState(null)
    const [alerts,      setAlerts]      = useState([])
    const [generating,  setGenerating]  = useState(false)

    const loadRules = () => {
        fetch(`${API}/api/forge/rules`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { setRules(d?.rules || []); setLoading(false) })
            .catch(() => setLoading(false))
    }

    useEffect(() => {
        loadRules()
        fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(setAlerts)
            .catch(() => {})
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleAutoGenerate = async () => {
        setGenerating(true)
        try {
            const resp = await fetch(`${API}/api/forge/auto-generate-rules`, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ mission_id: "mission_default" }),
            })
            const result = await resp.json()
            if (result.rules_generated > 0) {
                loadRules()
                alert(`Generated ${result.rules_generated} new rules from ontology analysis`)
            } else {
                alert("No new rules to generate — all ontology patterns already have rules.")
            }
        } catch {
            alert("Auto-generate failed. Check that the backend is running.")
        } finally {
            setGenerating(false)
        }
    }

    const toggleStatus = (id) => {
        const rule = rules.find(r => r.id === id)
        if (!rule) return
        const updated = { ...rule, status: rule.status === "active" ? "paused" : "active" }
        fetch(`${API}/api/forge/rules/${id}`, {
            method: "PUT",
            headers: forgeHeaders(),
            body: JSON.stringify(updated),
        }).catch(() => {})
        setRules(prev => prev.map(r => r.id === id ? updated : r))
    }

    const sevBadge = sev => ({
        info: { bg: "rgba(56,189,248,0.12)", color: "#38bdf8" },
        medium: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
        high: { bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
        critical: { bg: "rgba(239,68,68,0.2)", color: "#ef4444" },
    }[sev] || { bg: "rgba(100,116,139,0.2)", color: "#64748b" })

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Pattern Rules</h2>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>Automated triggers that fire when anomalous patterns are detected in live data.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        onClick={handleAutoGenerate}
                        disabled={generating}
                        style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.5)", color: "#22c55e", padding: "8px 14px", borderRadius: 6, cursor: generating ? "default" : "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}
                    >
                        <FIcoBrain w={12} h={12} />
                        {generating ? "Analysing…" : "Auto-Generate from Ontology"}
                    </button>
                    <button onClick={() => setShowCreate(true)} style={{ background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8", color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>+ Create Rule</button>
                </div>
            </div>
            {loading && <div style={{ color: "#64748b", fontSize: 13, padding: 24, textAlign: "center" }}>Loading rules…</div>}
            {!loading && rules.length === 0 && (
                <div style={{ color: "#64748b", fontSize: 13, padding: 32, textAlign: "center",
                    background: "rgba(15,23,42,0.5)", borderRadius: 8, border: "1px dashed rgba(56,189,248,0.15)" }}>
                    No rules configured. Click <strong style={{ color: "#22c55e" }}>Auto-Generate from Ontology</strong> to create rules, or <strong style={{ color: "#38bdf8" }}>+ Create Rule</strong> manually.
                </div>
            )}
            {rules.map(rule => {
                const sev = sevBadge(rule.severity)
                const trigCount = alerts.filter(a => a.rule_id === rule.id).length
                return (
                    <div key={rule.id} style={card}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{rule.name}</span>
                                <span style={{ marginLeft: 6, fontSize: 10, padding: "2px 7px", borderRadius: 10, background: rule.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)", color: rule.status === "active" ? "#22c55e" : "#64748b", fontWeight: 700 }}>{rule.status?.toUpperCase()}</span>
                                {rule.severity && <span style={{ marginLeft: 4, fontSize: 10, padding: "2px 7px", borderRadius: 10, background: sev.bg, color: sev.color, fontWeight: 700 }}>{rule.severity.toUpperCase()}</span>}
                            </div>
                            <div style={{ display: "flex", gap: 10, flexShrink: 0, marginLeft: 12, alignItems: "center" }}>
                                <span style={{ color: "#64748b", fontSize: 11 }}>Source: <span style={{ color: "#94a3b8" }}>{rule.source}</span></span>
                                <span style={{ color: trigCount > 0 ? "#f59e0b" : "#64748b", fontSize: 11 }}>{trigCount} active alerts</span>
                            </div>
                        </div>
                        {rule.description && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{rule.description}</div>}
                        {rule.params && Object.keys(rule.params).length > 0 && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {Object.entries(rule.params).map(([k, v]) => (
                                    <span key={k} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "rgba(30,41,59,0.8)", color: "#64748b" }}>
                                        {k.replace(/_/g, " ")}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button onClick={() => setEditingRule(rule)} style={btnGhost}>Edit</button>
                            <button onClick={() => toggleStatus(rule.id)} style={btnDanger}>{rule.status === "active" ? "Pause" : "Activate"}</button>
                        </div>
                    </div>
                )
            })}
            {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} onCreate={r => setRules(prev => [r, ...prev])} />}
            {editingRule && (
                <RuleEditor
                    rule={editingRule}
                    alerts={alerts}
                    onSave={updated => setRules(prev => prev.map(r => r.id === updated.id ? updated : r))}
                    onClose={() => setEditingRule(null)}
                />
            )}
        </div>
    )
}

// ── Watch Areas ────────────────────────────────────────────────────────────────

function WatchAreasTab() {
    const [areas,    setAreas]    = useState([])
    const [loading,  setLoading]  = useState(true)
    const [scanning, setScanning] = useState({})

    const loadAreas = () => {
        fetch(`${API}/api/forge/watch-areas`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { setAreas(Array.isArray(d) ? d : (d?.areas || [])); setLoading(false) })
            .catch(() => setLoading(false))
    }

    useEffect(() => { loadAreas() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const deleteArea = (id) => {
        fetch(`${API}/api/forge/watch-areas/${id}`, { method: "DELETE", headers: forgeHeaders() }).catch(() => {})
        setAreas(prev => prev.filter(a => a.id !== id))
    }

    const scanArea = (id) => {
        setScanning(prev => ({ ...prev, [id]: true }))
        fetch(`${API}/api/forge/watch-areas/${id}/scan`, { method: "POST", headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(result => {
                if (result) {
                    setAreas(prev => prev.map(a => a.id === id
                        ? { ...a, last_scan: result.last_scan, detections: result.detections, status: result.status }
                        : a))
                }
            })
            .catch(() => {})
            .finally(() => setScanning(prev => { const n = { ...prev }; delete n[id]; return n }))
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>Satellite Watch Areas</h2>
                    <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>Scheduled Overwatch scans on fixed locations. Alerts fire when detections exceed baseline.</p>
                </div>
                <button style={{ background: "rgba(56,189,248,0.15)", border: "1px solid #38bdf8", color: "#38bdf8", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Add Watch Area</button>
            </div>
            {loading && <div style={{ color: "#64748b", fontSize: 13, padding: 24, textAlign: "center" }}>Loading watch areas…</div>}
            {!loading && areas.length === 0 && (
                <div style={{ color: "#64748b", fontSize: 13, padding: 32, textAlign: "center",
                    background: "rgba(15,23,42,0.5)", borderRadius: 8, border: "1px dashed rgba(56,189,248,0.15)" }}>
                    No watch areas configured. Add one to schedule periodic satellite scans.
                </div>
            )}
            {areas.map(area => {
                const hasAlert = area.status === "alert"
                const coords = area.lat != null ? `${Number(area.lat).toFixed(2)}°, ${Number(area.lng || area.lon || 0).toFixed(2)}°` : area.coords || "—"
                return (
                    <div key={area.id} style={{ ...card, border: `1px solid ${hasAlert ? "rgba(239,68,68,0.3)" : "rgba(56,189,248,0.1)"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13 }}>{area.name}</span>
                                {hasAlert && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(239,68,68,0.15)", color: "#ef4444", fontWeight: 700, letterSpacing: "0.06em" }}>ALERT</span>}
                            </div>
                            <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>{coords} • Scan: {area.frequency || "weekly"}</div>
                            <div style={{ color: hasAlert ? "#ef4444" : "#94a3b8", fontSize: 12, marginTop: 4 }}>
                                {area.detections != null ? `${area.detections} objects detected` : "No scans yet"} • Last: {area.last_scan ? new Date(area.last_scan).toLocaleDateString() : "never"}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                            <button onClick={() => scanArea(area.id)} disabled={!!scanning[area.id]} style={{ ...btnGhost, opacity: scanning[area.id] ? 0.5 : 1 }}>{scanning[area.id] ? "Scanning…" : "Scan Now"}</button>
                            <button onClick={() => deleteArea(area.id)} style={btnDanger}>Remove</button>
                        </div>
                    </div>
                )
            })}
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
        fetch(`${API}/api/forge/labels`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.labels) setLabels(d.labels) })
            .catch(() => {})
    }, [])

    const generateBatch = async () => {
        setLoading(true)
        setItems([])
        try {
            const res = await fetch(`${API}/api/forge/overwatch/generate-batch`, {
                method: "POST",
                headers: forgeHeaders(),
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
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: forgeHeaders(),
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
        ? { text: <><FIcoWarning w={11} h={11} style={{ marginRight: 4 }} />Vessel stationary — possible loitering</>, color: "#f59e0b" }
        : isHighSpeed
        ? { text: <><FIcoWarning w={11} h={11} style={{ marginRight: 4 }} />High speed — possible military/pursuit</>, color: "#ef4444" }
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
                <button onClick={() => setShowSubs(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                    <FIcoWarning w={11} h={11} /> Suspicious
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
            const res = await fetch(`${API}/api/forge/ais/generate-batch`, {
                method: "POST",
                headers: forgeHeaders(),
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
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: forgeHeaders(),
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
            const res = await fetch(`${API}/api/forge/news/generate-batch`, {
                method: "POST",
                headers: forgeHeaders(),
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
        fetch(`${API}/api/forge/detection/label`, {
            method: "POST",
            headers: forgeHeaders(),
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

// ── Ontology Tree ─────────────────────────────────────────────────────────────

const TREE_TYPE_COLORS = {
    mission: "#38bdf8", region: "#22c55e", chokepoint: "#ef4444", country: "#22c55e",
    vessel: "#f59e0b", aircraft: "#38bdf8", rule: "#f97316", group: "#ef4444",
    event: "#f97316", cable: "#a855f7", source: "#64748b", category: "#94a3b8",
    scan: "#38bdf8",
}
const TREE_TYPE_ICONS = {
    mission:    <FIcoTarget />,
    region:     <FIcoPin />,
    chokepoint: <FIcoPadlock />,
    country:    <FIcoGlobe />,
    vessel:     <FIcoShip />,
    aircraft:   <FIcoAircraft />,
    rule:       <FIcoCog />,
    group:      <FIcoSwords />,
    event:      <FIcoFlash />,
    cable:      <FIcoPlug />,
    source:     <FIcoAntenna />,
    category:   <span style={{ fontSize: 8, lineHeight: 1 }}>▪</span>,
    scan:        <FIcoSatellite />,
    correlation: <FIcoNetwork />,
}

function isInRegion(node, region) {
    if (!node?.lat || !node?.lng) return false
    const [minLat, minLng, maxLat, maxLng] = region.bounds || []
    if (minLat == null) return false
    return node.lat >= minLat && node.lat <= maxLat && node.lng >= minLng && node.lng <= maxLng
}

function buildTree(ontology, mission) {
    const nodes = ontology.nodes || []
    const edges = ontology.edges || []
    const regions = mission?.regions || []

    const chokepoints = nodes.filter(n => n.type === "chokepoint")
    const countries   = nodes.filter(n => n.type === "country")
    const groups      = nodes.filter(n => n.type === "group")
    const rules       = nodes.filter(n => n.type === "rule")

    return {
        label: mission?.name || "Global Monitoring",
        type: "mission",
        expanded: true,
        children: [
            {
                label: "Regions",
                type: "category",
                expanded: true,
                children: regions.map(r => ({
                    label: r.name,
                    type: "region",
                    children: [
                        ...chokepoints.filter(n => isInRegion(n, r)).map(n => ({
                            label: n.label, type: "chokepoint", nodeId: n.id,
                            children: [
                                ...edges.filter(e => e.target === n.id && e.type === "monitors")
                                    .map(e => { const rn = nodes.find(x => x.id === e.source); return rn ? { label: rn.label, type: "rule", nodeId: rn.id } : null })
                                    .filter(Boolean),
                                ...nodes.filter(v => v.type === "vessel" && edges.some(e => (e.source === v.id && e.target === n.id) || (e.target === v.id && e.source === n.id)))
                                    .map(v => ({ label: v.label, type: "vessel", nodeId: v.id })),
                            ],
                        })),
                        ...countries.filter(n => isInRegion(n, r)).map(n => ({
                            label: n.label, type: "country", nodeId: n.id,
                            children: edges.filter(e => e.target === n.id && e.type === "operates")
                                .map(e => { const gn = nodes.find(x => x.id === e.source); return gn ? { label: gn.label, type: "group", nodeId: gn.id } : null })
                                .filter(Boolean),
                        })),
                    ],
                })),
            },
            {
                label: "Data Sources",
                type: "category",
                children: [
                    { label: `AIS Vessels (${nodes.filter(n => n.type === "vessel").length} tracked)`,   type: "source" },
                    { label: `ADS-B Aircraft (${nodes.filter(n => n.type === "aircraft").length} tracked)`, type: "source" },
                    { label: `News Events (${nodes.filter(n => n.type === "event").length} active)`,      type: "source" },
                    { label: `Watch Areas (${nodes.filter(n => n.type === "scan").length} configured)`,   type: "source" },
                ],
            },
            {
                label: `Detection Rules (${rules.length})`,
                type: "category",
                children: rules.map(n => ({ label: n.label, type: "rule", nodeId: n.id, description: n.description })),
            },
            {
                label: `Threat Groups (${groups.length})`,
                type: "category",
                children: groups.map(n => ({ label: n.label, type: "group", nodeId: n.id })),
            },
        ],
    }
}

function TreeBranch({ node, depth, onEdit, onDelete }) {
    const [expanded, setExpanded] = useState(node.expanded !== false && depth < 2)
    const hasChildren = (node.children || []).length > 0
    const col = TREE_TYPE_COLORS[node.type] || "#e2e8f0"
    const icon = TREE_TYPE_ICONS[node.type] || "•"

    return (
        <div>
            <div
                onClick={() => hasChildren && setExpanded(e => !e)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 4, cursor: hasChildren ? "pointer" : "default", marginLeft: depth * 18 }}
            >
                <span style={{ color: "#475569", fontSize: 9, width: 10, flexShrink: 0 }}>{hasChildren ? (expanded ? "▼" : "▶") : ""}</span>
                <span style={{ fontSize: 12 }}>{icon}</span>
                <span style={{ color: col, fontSize: 12, fontWeight: depth < 2 ? 600 : 400 }}>{node.label}</span>
                {node.description && <span style={{ color: "#475569", fontSize: 10, marginLeft: 3 }}>— {node.description.slice(0, 60)}</span>}
                {node.nodeId && (
                    <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        {onEdit && <button onClick={e => { e.stopPropagation(); onEdit(node) }} style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: 9, padding: "1px 4px", opacity: 0.6 }}>edit</button>}
                        {onDelete && <button onClick={e => { e.stopPropagation(); onDelete(node.nodeId) }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 9, padding: "1px 4px", opacity: 0.6 }}>✕</button>}
                    </span>
                )}
            </div>
            {expanded && hasChildren && (
                <div style={{ borderLeft: "1px solid rgba(56,189,248,0.08)", marginLeft: depth * 18 + 16 }}>
                    {node.children.map((child, i) => (
                        <TreeBranch key={i} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
                    ))}
                </div>
            )}
        </div>
    )
}

function OntologyTreeView({ nodes, edges, mission, onDeleteNode }) {
    const tree = buildTree({ nodes, edges }, mission)
    return (
        <div style={{ overflowY: "auto", height: "100%", padding: "4px 0" }}>
            <TreeBranch node={tree} depth={0} onDelete={onDeleteNode} />
        </div>
    )
}

// ── Entity Networks ────────────────────────────────────────────────────────────

const ENTITY_TYPES = {
    vessel:     { color: "#f59e0b", icon: <FIcoShip />,      label: "Vessels" },
    aircraft:   { color: "#38bdf8", icon: <FIcoAircraft />,  label: "Aircraft" },
    port:       { color: "#06b6d4", icon: <FIcoAnchor />,    label: "Ports" },
    airport:    { color: "#8b5cf6", icon: <FIcoAircraft />,  label: "Airports" },
    country:    { color: "#22c55e", icon: <FIcoGlobe />,     label: "Countries" },
    chokepoint: { color: "#ef4444", icon: <FIcoPadlock />,   label: "Chokepoints" },
    cable:      { color: "#a855f7", icon: <FIcoPlug />,      label: "Cables" },
    event:      { color: "#f97316", icon: <FIcoFlash />,     label: "Events" },
    person:     { color: "#ec4899", icon: <FIcoPerson />,    label: "People" },
    group:      { color: "#ef4444", icon: <FIcoSwords />,    label: "Groups" },
    weapon:     { color: "#dc2626", icon: <FIcoTarget />,    label: "Weapons" },
    facility:   { color: "#14b8a6", icon: <FIcoFactory />,   label: "Facilities" },
    scan:        { color: "#38bdf8", icon: <FIcoSatellite />, label: "Scans" },
    rule:        { color: "#f97316", icon: <FIcoCog />,       label: "Detection Rules" },
    correlation: { color: "#f97316", icon: <FIcoNetwork />,   label: "Correlations" },
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
    commanded_by:   { color: "#ec4899", label: "Commanded by" },
    correlates_with:{ color: "#f97316", label: "Correlates with" },
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

function EntityNetworksTab({ onViewOnMap, mission }) {
    const [nodes,        setNodes]        = useState([])
    const [edges,        setEdges]        = useState([])
    const [selectedNode, setSelectedNode] = useState(null)
    const [filter,       setFilter]       = useState("all")
    const [loading,      setLoading]      = useState(false)
    const [showAdd,      setShowAdd]      = useState(false)
    const [view,         setView]         = useState("tree")

    const load = () => {
        fetch(`${API}/api/forge/ontology`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : { nodes: [], edges: [] })
            .then(d => { setNodes(d.nodes || []); setEdges(d.edges || []) })
            .catch(() => {})
    }

    useEffect(() => { load() }, [])

    const buildFromLiveData = () => {
        setLoading(true)
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 30000)
        fetch(`${API}/api/forge/ontology/build`, { method: "POST", headers: forgeHeaders(), signal: ctrl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) { setNodes(d.nodes || []); setEdges(d.edges || []) } })
            .catch(e => { if (e.name !== "AbortError") console.warn("[forge/ontology/build]", e) })
            .finally(() => { clearTimeout(timer); setLoading(false) })
    }

    const addEdge = ({ source, target, type }) => {
        fetch(`${API}/api/forge/ontology/edge`, {
            method: "POST",
            headers: forgeHeaders(),
            body: JSON.stringify({ source, target, type }),
        }).then(r => r.ok ? r.json() : null).then(e => { if (e) setEdges(prev => [...prev, e]) }).catch(() => {})
    }

    const removeEdge = (edgeId) => {
        fetch(`${API}/api/forge/ontology/edge/${edgeId}`, { method: "DELETE", headers: forgeHeaders() })
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

            {/* Graph / Tree canvas */}
            <div style={{ flex: 1, background: "rgba(5,9,20,0.97)", borderRadius: 8, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
                {/* View toggle */}
                <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: "1px solid rgba(56,189,248,0.08)", flexShrink: 0 }}>
                    {["tree", "graph"].map(v => (
                        <button key={v} onClick={() => setView(v)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: view === v ? "rgba(56,189,248,0.18)" : "transparent", color: view === v ? "#38bdf8" : "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                            {v === "tree" ? <><FIcoNetwork w={11} h={11} /> Tree</> : <><FIcoNetwork w={11} h={11} /> Graph</>}
                        </button>
                    ))}
                </div>
                <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
                    {nodes.length === 0 && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>
                            No ontology data — click "Build from Live Data"
                        </div>
                    )}
                    {view === "graph"
                        ? <ForceGraph nodes={visibleNodes} edges={edges} entityTypes={ENTITY_TYPES} edgeTypes={EDGE_TYPES} onNodeClick={setSelectedNode} />
                        : <OntologyTreeView nodes={visibleNodes} edges={edges} mission={mission} onDeleteNode={nodeId => { /* handled via panel */ }} />
                    }
                </div>
            </div>

            {showAdd && <AddEdgeModal nodes={nodes} onSave={addEdge} onClose={() => setShowAdd(false)} />}
        </div>
    )
}

// ── Model Management ───────────────────────────────────────────────────────────

function ModelManagementTab() {
    const [modelData, setModelData] = useState(null)

    useEffect(() => {
        fetch(`${API}/api/forge/models`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setModelData(d) })
            .catch(() => {})
    }, [])

    const models       = modelData?.models       || []
    const trainingData = modelData?.training_data || { total: 0, confirmed: 0, corrected: 0, ready_for_training: false }
    const total        = trainingData.total     ?? 0
    const confirmed    = trainingData.confirmed ?? 0
    const corrected    = trainingData.corrected ?? 0
    const ready        = trainingData.ready_for_training ?? false
    const pct          = Math.min(total / 500 * 100, 100)

    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 16px", fontSize: 16 }}>ML Model Management</h2>

            {models.length === 0 && !modelData && (
                <div style={{ color: "#64748b", fontSize: 13, padding: 24, textAlign: "center" }}>Loading models…</div>
            )}
            {models.map((model, i) => (
                <div key={i} style={card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13 }}>{model.name}</span>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: model.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.2)", color: model.status === "active" ? "#22c55e" : "#64748b", fontWeight: 700 }}>
                                {model.status?.toUpperCase()}
                            </span>
                        </div>
                        <span style={{ color: "#475569", fontSize: 11 }}>{model.size_mb ? `${model.size_mb} MB` : ""}</span>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 5 }}>
                        {model.type} • {model.classes} classes
                    </div>
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

// ── Data Feeds & Uploads ───────────────────────────────────────────────────────

const UPLOAD_TYPE_ICON = {
    csv:      <FIcoMapGrid w={11} h={11} />,
    kml:      <FIcoMapGrid w={11} h={11} />,
    geojson:  <FIcoPin     w={11} h={11} />,
    document: <FIcoPaper   w={11} h={11} />,
    imagery:  <FIcoSatellite w={11} h={11} />,
}

const LIVE_SOURCES = [
    { name: "AIS Vessel Tracking",   status: "active",      count: "786 vessels",      icon: <FIcoShip     w={12} h={12} /> },
    { name: "ADS-B Aircraft",        status: "active",      count: "Live polling",      icon: <FIcoAircraft w={12} h={12} /> },
    { name: "RSS News Feeds",        status: "active",      count: "277 feeds",         icon: <FIcoPaper    w={12} h={12} /> },
    { name: "Copernicus Sentinel-2", status: "configured",  count: "10m resolution",    icon: <FIcoSatellite w={12} h={12} /> },
    { name: "GDELT Events",          status: "active",      count: "Global",            icon: <FIcoGlobe    w={12} h={12} /> },
    { name: "OpenInfraMap",          status: "active",      count: "Infrastructure",    icon: <FIcoFactory  w={12} h={12} /> },
]

function DataFeedsTab({ missionId }) {
    const [uploads,    setUploads]    = useState([])
    const [uploading,  setUploading]  = useState(false)
    const [dragOver,   setDragOver]   = useState(false)
    const [uploadMsg,  setUploadMsg]  = useState(null)
    const fileInputRef = useRef(null)


    useEffect(() => {
        fetch(`${API}/api/forge/uploads`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(setUploads)
            .catch(() => {})
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    async function handleUpload(file) {
        if (!file) return
        setUploading(true)
        setUploadMsg(null)
        const fd = new FormData()
        fd.append("file",        file)
        fd.append("mission_id",  missionId || "mission_default")
        fd.append("data_type",   "auto")
        fd.append("description", "")
        try {
            const resp   = await fetch(`${API}/api/forge/upload`, { method: "POST", headers: forgeFormHeaders(), body: fd })
            const result = await resp.json()
            if (result.error) { setUploadMsg({ ok: false, text: result.error }); return }
            setUploads(prev => [result, ...prev])
            let msg = `Processed: ${result.entities_extracted} entities extracted`
            if (result.entities_extracted > 0) {
                const rr = await fetch(`${API}/api/forge/auto-generate-rules`, {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ mission_id: missionId }),
                })
                const rres = await rr.json()
                if (rres.rules_generated > 0) {
                    msg += `, ${rres.rules_generated} rules auto-generated`
                    setUploads(prev => prev.map(u => u.id === result.id
                        ? { ...u, rules_generated: rres.rules_generated } : u))
                }
            }
            setUploadMsg({ ok: true, text: msg })
        } catch (e) {
            setUploadMsg({ ok: false, text: e.message })
        } finally {
            setUploading(false)
        }
    }

    return (
        <div>
            <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 16 }}>Data Sources & Uploads</h2>
            <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 18 }}>
                Upload custom data to enrich the intelligence brain. Entities are auto-extracted and detection rules auto-generated.
            </p>

            {/* Drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]) }}
                onClick={() => !uploading && fileInputRef.current?.click()}
                style={{
                    border: `2px dashed ${dragOver ? "#38bdf8" : "rgba(56,189,248,0.25)"}`,
                    borderRadius: 8, padding: "28px 16px", textAlign: "center",
                    cursor: uploading ? "default" : "pointer",
                    background: dragOver ? "rgba(56,189,248,0.06)" : "transparent",
                    marginBottom: 20, transition: "all 0.18s",
                }}
            >
                <input ref={fileInputRef} type="file" style={{ display: "none" }}
                    accept=".csv,.kml,.kmz,.geojson,.json,.pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff"
                    onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = "" }} />
                {uploading ? (
                    <div style={{ color: "#38bdf8", fontSize: 13 }}>Processing upload…</div>
                ) : (
                    <>
                        <div style={{ marginBottom: 8 }}>
                            <FI w={28} h={28} style={{ color: "rgba(56,189,248,0.5)" }}>
                                <rect x="2" y="9" width="12" height="6" rx="1"/>
                                <path d="M14 9h4l-3-6H5L2 9"/>
                                <path d="M8 4v5M6 6l2-2 2 2"/>
                            </FI>
                        </div>
                        <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>Drop files here or click to upload</div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                            KML · CSV · GeoJSON · PDF · Images
                        </div>
                    </>
                )}
                {uploadMsg && (
                    <div style={{ marginTop: 10, fontSize: 12, color: uploadMsg.ok ? "#22c55e" : "#ef4444" }}>
                        {uploadMsg.text}
                    </div>
                )}
            </div>

            {/* Live sources */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--akili-accent)", marginBottom: 8 }}>
                Live Data Sources
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 24 }}>
                {LIVE_SOURCES.map((src, i) => (
                    <div key={i} style={{
                        background: "rgba(15,23,42,0.8)", padding: "10px 12px", borderRadius: 6,
                        borderLeft: `3px solid ${src.status === "active" ? "#22c55e" : "#f59e0b"}`,
                        border: "1px solid rgba(56,189,248,0.08)",
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "#e2e8f0", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                                {src.icon} {src.name}
                            </span>
                            <span style={{
                                fontSize: 9, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
                                background: src.status === "active" ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)",
                                color: src.status === "active" ? "#22c55e" : "#f59e0b",
                            }}>{src.status.toUpperCase()}</span>
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>{src.count}</div>
                    </div>
                ))}
            </div>

            {/* Upload history */}
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--akili-accent)", marginBottom: 8 }}>
                Upload History
            </div>
            {uploads.length === 0 && (
                <div style={{ color: "#64748b", fontSize: 13, padding: 24, textAlign: "center",
                    background: "rgba(15,23,42,0.5)", borderRadius: 8, border: "1px dashed rgba(56,189,248,0.15)" }}>
                    No uploads yet. Upload data to start enriching your intelligence picture.
                </div>
            )}
            {uploads.map((u, i) => (
                <div key={i} style={{
                    ...card, padding: "10px 14px", marginBottom: 6,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                    <div>
                        <div style={{ color: "#e2e8f0", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                            {UPLOAD_TYPE_ICON[u.type] || <FIcoPaper w={11} h={11} />}
                            {u.filename}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>
                            {u.entities_extracted} entities · {u.rules_generated || 0} rules · {u.uploaded_at?.split("T")[0]}
                        </div>
                    </div>
                    <span style={{
                        padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700,
                        background: u.status === "processed" ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)",
                        color:      u.status === "processed" ? "#22c55e"            : "#f59e0b",
                    }}>{u.status?.toUpperCase()}</span>
                </div>
            ))}
        </div>
    )
}


// ── Mission System ────────────────────────────────────────────────────────────

const MISSION_PRESETS = {
    "Persian Gulf Focus": {
        regions: [{ name: "Persian Gulf", bounds: [23, 48, 30, 60] }, { name: "Gulf of Oman", bounds: [22, 56, 27, 62] }],
        focus_entities: ["Iran", "IRGC", "Strait of Hormuz"],
    },
    "Sahel Focus": {
        regions: [{ name: "Sahel", bounds: [10, -15, 20, 15] }],
        focus_entities: ["Mali", "JNIM", "Niger", "Burkina Faso"],
    },
    "Indo-Pacific": {
        regions: [{ name: "South China Sea", bounds: [5, 105, 25, 125] }, { name: "Taiwan Strait", bounds: [22, 118, 26, 122] }],
        focus_entities: ["China", "Taiwan", "Strait of Malacca"],
    },
    "East Africa Energy": {
        regions: [{ name: "East Africa", bounds: [-12, 28, 5, 52] }],
        focus_entities: ["Kenya", "Tanzania", "Mozambique"],
    },
    "Global": {
        regions: [
            { name: "Persian Gulf", bounds: [23, 48, 30, 60] },
            { name: "Red Sea", bounds: [12, 32, 30, 45] },
            { name: "Sahel", bounds: [10, -15, 20, 15] },
            { name: "South China Sea", bounds: [5, 105, 25, 125] },
            { name: "Black Sea", bounds: [40, 27, 47, 42] },
        ],
        focus_entities: [],
    },
}

function MissionSelector({ missions, onActivate, onCreate }) {
    return (
        <div style={{ display: "flex", gap: 6, padding: "6px 24px", borderBottom: "1px solid rgba(56,189,248,0.08)", alignItems: "center", overflowX: "auto", flexShrink: 0 }}>
            <span style={{ color: "#475569", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>MISSION:</span>
            {missions.map(m => (
                <button key={m.id} onClick={() => onActivate(m.id)} style={{ padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer", background: m.active ? "rgba(56,189,248,0.18)" : "rgba(30,41,59,0.6)", color: m.active ? "#38bdf8" : "#64748b", fontSize: 11, fontWeight: m.active ? 700 : 400, whiteSpace: "nowrap" }}>
                    {m.active && "● "}{m.name}
                </button>
            ))}
            <button onClick={onCreate} style={{ padding: "4px 10px", borderRadius: 5, border: "1px dashed rgba(56,189,248,0.25)", background: "transparent", color: "#475569", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>+ New Mission</button>
        </div>
    )
}

function CreateMissionWizard({ onComplete, onClose }) {
    const [step,    setStep]    = useState(1)
    const [name,    setName]    = useState("")
    const [desc,    setDesc]    = useState("")
    const [preset,  setPreset]  = useState(null)
    const [regions, setRegions] = useState([])

    const applyPreset = (key) => {
        const p = MISSION_PRESETS[key]
        setPreset(key)
        setRegions(p.regions)
        if (!name) setName(key)
    }

    const create = () => {
        const p = preset ? MISSION_PRESETS[preset] : {}
        const mission = { name, description: desc, regions, focus_entities: p.focus_entities || [], rules: "all" }
        fetch(`${API}/api/forge/missions`, {
            method: "POST",
            headers: forgeHeaders(),
            body: JSON.stringify(mission),
        }).then(r => r.ok ? r.json() : null).then(d => { if (d) onComplete(d) }).catch(() => {})
        onClose()
    }

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "rgba(10,18,40,0.98)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 12, padding: 28, width: 500 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h3 style={{ color: "#e2e8f0", margin: 0, fontSize: 15 }}>New Mission — Step {step} of 3</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 }}>×</button>
                </div>

                {/* Progress bar */}
                <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 24 }}>
                    <div style={{ height: "100%", borderRadius: 2, background: "#38bdf8", width: `${(step / 3) * 100}%`, transition: "width 0.3s" }} />
                </div>

                {step === 1 && (
                    <div>
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Mission Name</div>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Hormuz Watch" style={{ ...fieldStyle, marginBottom: 14 }} />
                        <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600 }}>Description</div>
                        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this mission monitoring?" style={fieldStyle} />
                    </div>
                )}

                {step === 2 && (
                    <div>
                        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>Choose a regional preset or customise below:</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                            {Object.keys(MISSION_PRESETS).map(key => (
                                <button key={key} onClick={() => applyPreset(key)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: preset === key ? "#38bdf8" : "rgba(30,41,59,0.8)", color: preset === key ? "#0f172a" : "#94a3b8", fontSize: 12, fontWeight: preset === key ? 700 : 400 }}>
                                    {key}
                                </button>
                            ))}
                        </div>
                        {regions.length > 0 && (
                            <div style={{ ...card, padding: 12 }}>
                                <div style={{ color: "#64748b", fontSize: 10, marginBottom: 6 }}>SELECTED REGIONS</div>
                                {regions.map((r, i) => (
                                    <div key={i} style={{ color: "#94a3b8", fontSize: 12, padding: "2px 0", display: "flex", alignItems: "center", gap: 5 }}><FIcoPin w={11} h={11} /> {r.name}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {step === 3 && (
                    <div>
                        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>Mission summary — click Create to activate.</div>
                        <div style={{ ...card, padding: 14 }}>
                            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14 }}>{name || "Unnamed"}</div>
                            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>{desc || "No description"}</div>
                            <div style={{ color: "#64748b", fontSize: 11, marginTop: 8 }}>{regions.length} regions • All detection rules active</div>
                            {preset && MISSION_PRESETS[preset]?.focus_entities?.length > 0 && (
                                <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                                    Focus: {MISSION_PRESETS[preset].focus_entities.join(", ")}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22 }}>
                    {step > 1 && <button onClick={() => setStep(s => s - 1)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid rgba(100,116,139,0.3)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Back</button>}
                    <button onClick={() => step < 3 ? setStep(s => s + 1) : create()} disabled={step === 1 && !name.trim()} style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: (step === 1 && !name.trim()) ? "rgba(100,116,139,0.3)" : "#38bdf8", color: "#0f172a", fontWeight: 700, cursor: (step === 1 && !name.trim()) ? "default" : "pointer", fontSize: 13 }}>
                        {step < 3 ? "Next" : "Create Mission"}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── ForgePanel ─────────────────────────────────────────────────────────────────

export default function ForgePanel({ user, onClose, onAddOverlay, onFlyTo }) {
    const [activeTab,    setActiveTab]    = useState("dashboard")
    const [missions,     setMissions]     = useState([])
    const [showWizard,   setShowWizard]   = useState(false)

    useEffect(() => {
        fetch(`${API}/api/forge/missions`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(setMissions)
            .catch(() => {})
    }, [])

    const activeMission = missions.find(m => m.active) || null

    const activateMission = (id) => {
        fetch(`${API}/api/forge/missions/${id}/activate`, { method: "PUT", headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(() => setMissions(prev => prev.map(m => ({ ...m, active: m.id === id }))))
            .catch(() => {})
    }

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif", zIndex: 50 }}>
            {/* Header */}
            <div style={{ padding: "0 24px", height: 50, flexShrink: 0, borderBottom: "1px solid rgba(148,163,184,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 7 }}><FIcoHammer w={14} h={14} /> FORGE</span>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#60a5fa", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", padding: "2px 8px", borderRadius: 4 }}>INTELLIGENCE TRAINING LAB</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>{user?.email || "admin"}</span>
                </div>
                {onClose && <button onClick={onClose} title="Close Forge" style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px 8px" }}>×</button>}
            </div>

            {/* Mission selector */}
            {missions.length > 0 && (
                <MissionSelector
                    missions={missions}
                    onActivate={activateMission}
                    onCreate={() => setShowWizard(true)}
                />
            )}

            {/* Tab bar */}
            <div style={{ display: "flex", gap: 1, padding: "8px 24px 0", borderBottom: "1px solid rgba(148,163,184,0.08)", flexShrink: 0, overflowX: "auto" }}>
                {FORGE_TABS.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "6px 14px 8px", borderRadius: "6px 6px 0 0", border: "none", borderBottom: activeTab === tab.id ? "2px solid #60a5fa" : "2px solid transparent", cursor: "pointer", background: activeTab === tab.id ? "rgba(96,165,250,0.07)" : "transparent", color: activeTab === tab.id ? "#60a5fa" : "#64748b", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", transition: "color 0.12s, background 0.12s" }}>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
                {activeTab === "dashboard"     && <ThreatDashboard setActiveTab={setActiveTab} onFlyTo={onFlyTo} />}
                {activeTab === "rules"         && <PatternRulesTab />}
                {activeTab === "watch"         && <WatchAreasTab />}
                {activeTab === "recognition"   && <ObjectTrainingTab />}
                {activeTab === "ais-training"  && <AISTrainingTab />}
                {activeTab === "news-training" && <NewsTrainingTab />}
                {activeTab === "entities"      && <EntityNetworksTab mission={activeMission} onViewOnMap={node => { onFlyTo?.(node); onClose?.() }} />}
                {activeTab === "feeds"         && <DataFeedsTab missionId={activeMission?.id} />}
                {activeTab === "models"        && <ModelManagementTab />}
            </div>

            {showWizard && (
                <CreateMissionWizard
                    onComplete={m => setMissions(prev => [...prev, m])}
                    onClose={() => setShowWizard(false)}
                />
            )}
        </div>
    )
}
