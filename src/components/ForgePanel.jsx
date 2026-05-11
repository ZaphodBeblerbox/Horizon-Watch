import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import ReviewQueue from "./forge/ReviewQueue.jsx"
import PipelineCanvas, { TYPE_COLORS, STATUS_DOT } from "./forge/PipelineCanvas.jsx"

const API = API_BASE

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

// ── Passcode gate ──────────────────────────────────────────────────────────────
export function ForgeGate({ children }) {
    const [authenticated, setAuthenticated] = useState(
        () => localStorage.getItem("forge_access") === "true"
    )
    const [passcode, setPasscode] = useState("")
    const [error,    setError]    = useState("")
    const [loading,  setLoading]  = useState(false)

    const submit = async () => {
        setLoading(true); setError("")
        try {
            const res = await fetch(`${API}/api/forge/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ passcode }),
            })
            const data = await res.json()
            if (data.access) {
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
                background: "#111827", border: "1px solid rgba(148,163,184,0.12)",
                borderRadius: 10, padding: 32, width: 320,
            }}>
                <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, marginBottom: 6, letterSpacing: "0.06em" }}>FORGE</div>
                <div style={{ color: "#475569", fontSize: 12, marginBottom: 20 }}>Intelligence Training Lab — restricted access</div>
                <input
                    type="password"
                    value={passcode}
                    onChange={e => setPasscode(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submit()}
                    placeholder="Enter passcode"
                    style={{
                        width: "100%", padding: "10px 12px", marginBottom: 10,
                        background: "rgba(30,41,59,0.8)", border: "1px solid rgba(148,163,184,0.15)",
                        borderRadius: 6, color: "#e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box",
                    }}
                />
                {error && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{error}</div>}
                <button
                    onClick={submit}
                    disabled={loading}
                    style={{
                        width: "100%", padding: "10px 0", borderRadius: 6, border: "none",
                        background: loading ? "#1e293b" : "#60a5fa", color: loading ? "#475569" : "#0f172a",
                        fontWeight: 700, cursor: loading ? "default" : "pointer", fontSize: 13,
                    }}
                >{loading ? "Authenticating…" : "Access Forge"}</button>
            </div>
        </div>
    )
}

// ── SVG icon system ────────────────────────────────────────────────────────────
function FI({ children, w = 13, h = 13, style, ...rest }) {
    return (
        <svg width={w} height={h} viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }} {...rest}>
            {children}
        </svg>
    )
}
const FIcoWarning  = (p) => <FI strokeWidth="1.5" {...p}><path d="M8 2L15 14H1L8 2Z"/><line x1="8" y1="7" x2="8" y2="10.5"/><circle cx="8" cy="12.5" r="0.8" fill="currentColor" stroke="none"/></FI>
const FIcoShip     = (p) => <FI {...p}><path d="M3 9h10l-2 5H5Z"/><rect x="5" y="5" width="6" height="4"/><line x1="8" y1="1" x2="8" y2="5"/><line x1="5.5" y1="3" x2="10.5" y2="3"/></FI>
const FIcoHammer   = (p) => <FI {...p}><path d="M2 14L7.5 8.5"/><rect x="6.5" y="1.5" width="5" height="5" rx="1" transform="rotate(-45 8 4)"/></FI>

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

// ── Pipeline data model ────────────────────────────────────────────────────────
export const PIPELINE_NODES = [
    { id: 'src_ais',         label: 'AIS Vessel Feed',      column: 0, type: 'source',       status: 'active',     config: { vessels_tracked: 0, bboxes: 5 } },
    { id: 'src_adsb',        label: 'ADS-B Aircraft',        column: 0, type: 'source',       status: 'active',     config: { refresh_ms: 10000 } },
    { id: 'src_news',        label: 'RSS News Feeds',        column: 0, type: 'source',       status: 'active',     config: { feeds: 277 } },
    { id: 'src_satellite',   label: 'Sentinel-2 Imagery',    column: 0, type: 'source',       status: 'configured', config: {} },
    { id: 'src_osint',       label: 'GDELT Events',          column: 0, type: 'source',       status: 'active',     config: {} },
    { id: 'src_uploads',     label: 'Custom Uploads',        column: 0, type: 'source',       status: 'active',     config: { count: 0 } },
    { id: 'det_ais',         label: 'AIS Anomaly Detector',  column: 1, type: 'detector',     status: 'active',     config: { rules: 0 } },
    { id: 'det_adsb',        label: 'ADSB Pattern Detector', column: 1, type: 'detector',     status: 'active',     config: { rules: 0 } },
    { id: 'det_news',        label: 'News Scorer',           column: 1, type: 'detector',     status: 'active',     config: {} },
    { id: 'det_overwatch',   label: 'Overwatch ML',          column: 1, type: 'detector',     status: 'active',     config: { model: 'yolov8n-obb.onnx' } },
    { id: 'enr_correlation', label: 'Correlation Engine',    column: 2, type: 'enrichment',   status: 'active',     config: {} },
    { id: 'enr_ontology',    label: 'Entity Ontology',       column: 2, type: 'enrichment',   status: 'active',     config: { nodes: 0, edges: 0 } },
    { id: 'enr_geocode',     label: 'Geocoder',              column: 2, type: 'enrichment',   status: 'active',     config: {} },
    { id: 'int_threat',      label: 'Threat Scoring',        column: 3, type: 'intelligence', status: 'active',     config: { regions: 10 } },
    { id: 'int_patterns',    label: 'Pattern Recognition',   column: 3, type: 'intelligence', status: 'active',     config: {} },
    { id: 'int_escalation',  label: 'Escalation Detector',   column: 3, type: 'intelligence', status: 'active',     config: {} },
    { id: 'out_alerts',      label: 'Alert System',          column: 4, type: 'output',       status: 'active',     config: { alerts_24h: 0 } },
    { id: 'out_briefings',   label: 'Director Briefings',    column: 4, type: 'output',       status: 'active',     config: {} },
    { id: 'out_reports',     label: 'Reports',               column: 4, type: 'output',       status: 'active',     config: {} },
]

export const PIPELINE_EDGES = [
    { from: 'src_ais',       to: 'det_ais' },
    { from: 'src_adsb',      to: 'det_adsb' },
    { from: 'src_news',      to: 'det_news' },
    { from: 'src_satellite', to: 'det_overwatch' },
    { from: 'src_uploads',   to: 'enr_ontology' },
    { from: 'src_osint',     to: 'det_news' },
    { from: 'det_ais',       to: 'enr_correlation' },
    { from: 'det_adsb',      to: 'enr_correlation' },
    { from: 'det_news',      to: 'enr_correlation' },
    { from: 'det_overwatch', to: 'enr_correlation' },
    { from: 'det_ais',       to: 'enr_ontology' },
    { from: 'det_news',      to: 'enr_ontology' },
    { from: 'enr_correlation', to: 'int_threat' },
    { from: 'enr_correlation', to: 'int_patterns' },
    { from: 'enr_ontology',    to: 'int_threat' },
    { from: 'enr_ontology',    to: 'int_escalation' },
    { from: 'enr_geocode',     to: 'int_threat' },
    { from: 'int_threat',      to: 'out_alerts' },
    { from: 'int_patterns',    to: 'out_alerts' },
    { from: 'int_escalation',  to: 'out_alerts' },
    { from: 'int_threat',      to: 'out_briefings' },
    { from: 'int_patterns',    to: 'out_reports' },
]

// ── Esri tile helper ───────────────────────────────────────────────────────────
function esriTileUrl(lat, lon, zoom = 10) {
    const n = Math.pow(2, zoom)
    const x = Math.floor((lon + 180) / 360 * n)
    const latRad = lat * Math.PI / 180
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
}

// ── Fullscreen preview ─────────────────────────────────────────────────────────
function FullscreenPreview({ image, detections, onClose }) {
    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)",
            zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
                <img
                    src={`data:image/jpeg;base64,${image}`}
                    alt="full"
                    style={{ maxWidth: "90vw", maxHeight: "90vh", display: "block", borderRadius: 6 }}
                />
                {(detections || []).map((d, i) => (
                    <div key={i} style={{
                        position: "absolute",
                        left: `${(d.bbox[0]) * 100}%`, top: `${(d.bbox[1]) * 100}%`,
                        width: `${(d.bbox[2] - d.bbox[0]) * 100}%`,
                        height: `${(d.bbox[3] - d.bbox[1]) * 100}%`,
                        border: `2px solid ${d.color || "#38bdf8"}`, boxSizing: "border-box",
                    }}>
                        <span style={{ position: "absolute", top: -18, left: 0, background: d.color || "#38bdf8", color: "#000", fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 700, whiteSpace: "nowrap" }}>
                            {d.class} {Math.round((d.confidence || 0) * 100)}%
                        </span>
                    </div>
                ))}
                <button onClick={onClose} style={{ position: "absolute", top: -36, right: 0, background: "none", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
        </div>
    )
}

// ── Accuracy tracker ───────────────────────────────────────────────────────────
function AccuracyTracker({ labels }) {
    const owLabels  = labels.filter(l => l.source_type === "overwatch" && l.label !== "skip")
    const total     = owLabels.length
    const confirmed = owLabels.filter(l => l.label === "confirm").length
    const corrected = owLabels.filter(l => l.label === "correct").length
    const accuracy  = (confirmed + corrected) > 0 ? Math.round((confirmed / (confirmed + corrected)) * 100) : 0
    if (total === 0) return null
    return (
        <div style={{ ...card, marginBottom: 16, display: "flex", gap: 20, alignItems: "center" }}>
            <div>
                <div style={{ color: "#475569", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Model Accuracy</div>
                <div style={{ color: accuracy >= 80 ? "#22c55e" : accuracy >= 60 ? "#f59e0b" : "#ef4444", fontSize: 24, fontWeight: 700 }}>{accuracy}%</div>
            </div>
            <div style={{ color: "#64748b", fontSize: 11 }}>{total} detections reviewed · {confirmed} confirmed · {corrected} corrected</div>
        </div>
    )
}

// ── Training: Object recognition ───────────────────────────────────────────────
const CORRECT_AS_OPTIONS = [
    "Aircraft — Fixed Wing", "Aircraft — Rotary Wing",
    "Vehicle — Large", "Vehicle — Small",
    "Vessel — Military", "Vessel — Cargo",
    "Infrastructure — Launcher", "Infrastructure — Radar",
    "Storage Tank", "Building", "Other / Unknown",
]

function OverwatchReviewCard({ item, onLabel }) {
    const [showCorrect, setShowCorrect] = useState(false)
    const [correction,  setCorrection]  = useState(CORRECT_AS_OPTIONS[0])
    const [fsOpen,      setFsOpen]      = useState(false)
    const imgSrc = item.crop_image || item.crop_b64
    const color  = item.color || "#38bdf8"
    return (
        <div style={{ ...card, border: "1px solid rgba(148,163,184,0.15)" }}>
            <div style={{ display: "flex", gap: 16 }}>
                <div style={{ position: "relative", width: 140, height: 140, flexShrink: 0 }}>
                    <div style={{ width: "100%", height: "100%", background: "#0f172a", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(148,163,184,0.1)", cursor: imgSrc ? "zoom-in" : "default" }}>
                        {imgSrc
                            ? <img src={`data:image/jpeg;base64,${imgSrc}`} alt="detection" onClick={() => setFsOpen(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 10 }}>No Image</div>
                        }
                    </div>
                    {item.box_in_crop && imgSrc && (
                        <div style={{ position: "absolute", left: `${item.box_in_crop.x}%`, top: `${item.box_in_crop.y}%`, width: `${item.box_in_crop.w}%`, height: `${item.box_in_crop.h}%`, border: `2px solid ${color}`, borderRadius: 2, pointerEvents: "none", boxSizing: "border-box" }}>
                            <span style={{ position: "absolute", top: -16, left: 0, background: color, color: "#000", fontSize: 9, padding: "1px 4px", borderRadius: 2, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {item.class} {Math.round((item.confidence || 0) * 100)}%
                            </span>
                        </div>
                    )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, textTransform: "capitalize" }}>{item.class || "Unknown"}</span>
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(96,165,250,0.1)", color: "#60a5fa", fontWeight: 700 }}>{Math.round((item.confidence || 0) * 100)}%</span>
                        {item.mock && <span style={{ fontSize: 10, color: "#475569", padding: "2px 6px", borderRadius: 10, background: "rgba(71,85,105,0.15)" }}>SIM</span>}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>Site: <span style={{ color: "#94a3b8" }}>{item.site || "Unknown"}</span></div>
                    {item.center && Array.isArray(item.center) && (
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 3 }}>Coords: <span style={{ color: "#94a3b8" }}>{item.center[0].toFixed(4)}°N, {item.center[1].toFixed(4)}°E</span></div>
                    )}
                    {imgSrc && <button onClick={() => setFsOpen(true)} style={{ ...btnGhost, marginTop: 8, fontSize: 10 }}>⤢ Fullscreen</button>}
                </div>
            </div>
            {showCorrect && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={correction} onChange={e => setCorrection(e.target.value)} style={{ flex: 1, padding: "7px 10px", background: "rgba(30,41,59,0.8)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 6, color: "#e2e8f0", fontSize: 12, outline: "none" }}>
                        {CORRECT_AS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button onClick={() => { onLabel("correct", { correction, original_label: item.class }); setShowCorrect(false) }} style={{ ...btnGhost, whiteSpace: "nowrap", fontWeight: 700 }}>Submit</button>
                </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={() => onLabel("confirm", { original_label: item.class })} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.08)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Confirm</button>
                <button onClick={() => setShowCorrect(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✎ Correct As</button>
                <button onClick={() => onLabel("skip", { original_label: item.class })} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.15)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 }}>Skip</button>
            </div>
            {fsOpen && <FullscreenPreview image={item.full_image || imgSrc} detections={item.all_detections} onClose={() => setFsOpen(false)} />}
        </div>
    )
}

function ObjectTrainingView() {
    const [items,  setItems]  = useState([])
    const [loading,setLoading]= useState(false)
    const [stats,  setStats]  = useState({ total: 0, confirmed: 0, corrected: 0, skipped: 0 })
    const [labels, setLabels] = useState([])

    useEffect(() => {
        fetch(`${API}/api/forge/labels`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.labels) setLabels(d.labels) })
            .catch(() => {})
    }, [])

    const generateBatch = async () => {
        setLoading(true); setItems([])
        try {
            const res  = await fetch(`${API}/api/forge/overwatch/generate-batch`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ n: 10 }) })
            const data = await res.json()
            setItems((data.detections || []).map(d => ({ ...d, id: d.id || crypto.randomUUID() })))
        } catch (e) { console.error("[ObjectTraining]", e) }
        finally { setLoading(false) }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({ ...prev, total: prev.total + 1, confirmed: label === "confirm" ? prev.confirmed + 1 : prev.confirmed, corrected: label === "correct" ? prev.corrected + 1 : prev.corrected, skipped: label === "skip" ? prev.skipped + 1 : prev.skipped }))
        const entry = { id, label, source_type: "overwatch", labeled_at: new Date().toISOString(), ...extra }
        setLabels(prev => [entry, ...prev])
        fetch(`${API}/api/forge/detection/label`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ id, label, source_type: "overwatch", ...extra }) }).catch(() => {})
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 15 }}>Object Recognition Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Review and correct Overwatch satellite detection labels to improve model accuracy.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: loading ? "#64748b" : "#60a5fa", padding: "8px 14px", borderRadius: 6, cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16 }}>
                    {loading ? "Scanning…" : "Generate 10 Scans"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                {[["Labeled", stats.total, "#60a5fa"], ["Confirmed", stats.confirmed, "#22c55e"], ["Corrected", stats.corrected, "#f59e0b"], ["Skipped", stats.skipped, "#64748b"]].map(([l, v, c]) => (
                    <div key={l} style={{ ...card, flex: 1, textAlign: "center", padding: "10px 8px", marginBottom: 0 }}>
                        <div style={{ color: c, fontSize: 20, fontWeight: 700 }}>{v}</div>
                        <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{l}</div>
                    </div>
                ))}
            </div>
            <AccuracyTracker labels={labels} />
            <ReviewQueue items={items} onLabel={handleLabel} loading={loading} onGenerate={generateBatch} generateLabel="Generate 10 Scans" renderCard={(item, fn) => <OverwatchReviewCard item={item} onLabel={fn} />} />
        </div>
    )
}

// ── Training: AIS behaviour ────────────────────────────────────────────────────
const AIS_SUBCATEGORIES = [
    "Loitering near infrastructure", "Dark transit (AIS gap)", "Route deviation",
    "Ship-to-ship transfer", "Military formation", "Sanctions evasion route", "Other",
]

function AISTrainingCard({ item, onLabel }) {
    const [showSubs, setShowSubs] = useState(false)
    const lat = item.lat ?? 0
    const lon = item.lon ?? 0
    const isStationary = (item.speed ?? 0) < 0.5
    const isHighSpeed   = (item.speed ?? 0) > 22
    const assessment = isStationary
        ? { text: "Vessel stationary — possible loitering", color: "#f59e0b" }
        : isHighSpeed
        ? { text: "High speed — possible military/pursuit", color: "#ef4444" }
        : { text: "Normal transit behaviour", color: "#22c55e" }
    return (
        <div style={{ ...card, border: "1px solid rgba(148,163,184,0.12)" }}>
            <div style={{ position: "relative", height: 160, marginBottom: 12, borderRadius: 6, overflow: "hidden", background: "#0f172a" }}>
                <img src={esriTileUrl(lat, lon, 10)} alt="vessel location" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} onError={e => { e.target.style.display = "none" }} />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 12, height: 12, borderRadius: "50%", background: isStationary ? "#ef4444" : "#22c55e", border: "2px solid white" }} />
                <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.75)", padding: "3px 8px", borderRadius: 4, color: "#e2e8f0", fontSize: 11 }}>
                    {isStationary ? "STATIONARY" : `${(item.speed ?? 0).toFixed(1)} kn`}
                </div>
                {item.mock && <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(71,85,105,0.8)", padding: "2px 6px", borderRadius: 4, color: "#94a3b8", fontSize: 10 }}>SIM</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", marginBottom: 10 }}>
                {[["VESSEL", item.name || `MMSI ${item.mmsi}`], ["TYPE", item.ship_type || "Unknown"], ["MMSI", item.mmsi], ["FLAG", item.flag || "—"], ["DESTINATION", item.destination || "Not declared"], ["HEADING", item.heading != null ? `${item.heading}°` : "—"]].map(([label, value]) => (
                    <div key={label}><div style={{ color: "#475569", fontSize: 9, fontWeight: 600 }}>{label}</div><div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 1 }}>{value}</div></div>
                ))}
            </div>
            <div style={{ marginBottom: 10, padding: "7px 10px", background: "rgba(30,41,59,0.5)", borderRadius: 5 }}>
                <div style={{ color: "#475569", fontSize: 9, marginBottom: 2 }}>SYSTEM ASSESSMENT</div>
                <div style={{ color: assessment.color, fontSize: 12 }}>{assessment.text}</div>
            </div>
            {showSubs && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                    {AIS_SUBCATEGORIES.map(cat => (
                        <button key={cat} onClick={() => { onLabel("suspicious", { reason: cat }); setShowSubs(false) }} style={{ padding: "5px 9px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontSize: 11 }}>{cat}</button>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onLabel("normal")} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.08)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Normal</button>
                <button onClick={() => setShowSubs(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.06)", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>⚠ Suspicious</button>
                <button onClick={() => onLabel("skip")} style={{ padding: "9px 14px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.15)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 }}>Skip</button>
            </div>
        </div>
    )
}

function AISTrainingView() {
    const [items,  setItems]  = useState([])
    const [loading,setLoading]= useState(false)
    const [stats,  setStats]  = useState({ total: 0, normal: 0, suspicious: 0, skipped: 0 })

    const generateBatch = async () => {
        setLoading(true); setItems([])
        try {
            const res  = await fetch(`${API}/api/forge/ais/generate-batch`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ n: 20 }) })
            const data = await res.json()
            setItems((data.vessels || []).map(v => ({ ...v, id: v.review_id || v.mmsi || crypto.randomUUID() })))
        } catch (e) { console.error("[AISTraining]", e) }
        finally { setLoading(false) }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({ ...prev, total: prev.total + 1, normal: label === "normal" ? prev.normal + 1 : prev.normal, suspicious: label === "suspicious" ? prev.suspicious + 1 : prev.suspicious, skipped: label === "skip" ? prev.skipped + 1 : prev.skipped }))
        fetch(`${API}/api/forge/detection/label`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ id, label, source_type: "ais", ...extra }) }).catch(() => {})
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 15 }}>AIS Behaviour Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Label vessel behaviour patterns to train anomaly detection models.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: loading ? "#64748b" : "#60a5fa", padding: "8px 14px", borderRadius: 6, cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16 }}>
                    {loading ? "Loading…" : "Generate 20 Vessels"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                {[["Reviewed", stats.total, "#60a5fa"], ["Normal", stats.normal, "#22c55e"], ["Suspicious", stats.suspicious, "#ef4444"], ["Skipped", stats.skipped, "#64748b"]].map(([l, v, c]) => (
                    <div key={l} style={{ ...card, flex: 1, textAlign: "center", padding: "10px 8px", marginBottom: 0 }}>
                        <div style={{ color: c, fontSize: 20, fontWeight: 700 }}>{v}</div>
                        <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{l}</div>
                    </div>
                ))}
            </div>
            <ReviewQueue items={items} onLabel={handleLabel} loading={loading} onGenerate={generateBatch} generateLabel="Generate 20 Vessels" renderCard={(item, fn) => <AISTrainingCard item={item} onLabel={fn} />} />
        </div>
    )
}

// ── Training: News classification ──────────────────────────────────────────────
const SEVERITY_TIERS  = ["critical", "significant", "elevated", "low"]
const EVENT_TYPES     = ["Conflict", "Explosion / Remote Violence", "Protests", "Riots", "Strategic Developments", "Violence Against Civilians", "Other"]
const SEVERITY_COLORS = {
    critical:    { bg: "rgba(239,68,68,0.15)",  text: "#ef4444" },
    significant: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b" },
    elevated:    { bg: "rgba(96,165,250,0.1)",  text: "#60a5fa" },
    low:         { bg: "rgba(100,116,139,0.15)", text: "#64748b" },
}

function NewsTrainingCard({ item, onLabel }) {
    const [showAdj, setShowAdj] = useState(false)
    const [adjSev,  setAdjSev]  = useState(item.severity_tier || "elevated")
    const [adjType, setAdjType] = useState(item.event_type    || "Conflict")
    const sc = SEVERITY_COLORS[item.severity_tier] || SEVERITY_COLORS.low
    return (
        <div style={{ ...card, border: "1px solid rgba(148,163,184,0.12)" }}>
            <div style={{ marginBottom: 10 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 13, lineHeight: 1.45, marginBottom: 7 }}>{item.title || "Untitled"}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{item.source || "Unknown"}</span>
                    {item.published && <span style={{ fontSize: 11, color: "#475569" }}>{new Date(item.published).toLocaleDateString()}</span>}
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: sc.bg, color: sc.text }}>{(item.severity_tier || "LOW").toUpperCase()}</span>
                    {item.event_type && <span style={{ fontSize: 10, color: "#94a3b8", padding: "2px 7px", borderRadius: 10, background: "rgba(30,41,59,0.7)" }}>{item.event_type}</span>}
                    {item.mock && <span style={{ fontSize: 10, color: "#475569", padding: "2px 6px", borderRadius: 10, background: "rgba(71,85,105,0.15)" }}>SIM</span>}
                </div>
            </div>
            {showAdj && (
                <div style={{ marginBottom: 12, padding: 12, background: "rgba(30,41,59,0.5)", borderRadius: 6, border: "1px solid rgba(148,163,184,0.1)" }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                        {[["SEVERITY", SEVERITY_TIERS, adjSev, setAdjSev], ["EVENT TYPE", EVENT_TYPES, adjType, setAdjType]].map(([lbl, opts, val, setter]) => (
                            <div key={lbl} style={{ flex: 1 }}>
                                <label style={{ fontSize: 9, color: "#64748b", display: "block", marginBottom: 4 }}>{lbl}</label>
                                <select value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", padding: "6px 8px", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 4, color: "#e2e8f0", fontSize: 12, outline: "none" }}>
                                    {opts.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => { onLabel("adjusted", { severity: adjSev, event_type: adjType }); setShowAdj(false) }} style={{ ...btnGhost, width: "100%", textAlign: "center", fontWeight: 700 }}>Apply Adjustment</button>
                </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onLabel("correct")} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(34,197,94,0.4)", background: "rgba(34,197,94,0.08)", color: "#22c55e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Correct</button>
                <button onClick={() => setShowAdj(v => !v)} style={{ flex: 1, padding: "9px 0", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", color: "#f59e0b", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✎ Adjust</button>
                <button onClick={() => onLabel("skip")} style={{ padding: "9px 14px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.15)", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 }}>Skip</button>
            </div>
        </div>
    )
}

function NewsTrainingView() {
    const [items,  setItems]  = useState([])
    const [loading,setLoading]= useState(false)
    const [stats,  setStats]  = useState({ total: 0, correct: 0, adjusted: 0, skipped: 0 })

    const generateBatch = async () => {
        setLoading(true); setItems([])
        try {
            const res  = await fetch(`${API}/api/forge/news/generate-batch`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ n: 15 }) })
            const data = await res.json()
            setItems((data.articles || []).map(a => ({ ...a, id: a.id || a.url || crypto.randomUUID() })))
        } catch (e) { console.error("[NewsTraining]", e) }
        finally { setLoading(false) }
    }

    const handleLabel = (id, label, extra = {}) => {
        setStats(prev => ({ ...prev, total: prev.total + 1, correct: label === "correct" ? prev.correct + 1 : prev.correct, adjusted: label === "adjusted" ? prev.adjusted + 1 : prev.adjusted, skipped: label === "skip" ? prev.skipped + 1 : prev.skipped }))
        fetch(`${API}/api/forge/detection/label`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify({ id, label, source_type: "news", ...extra }) }).catch(() => {})
    }

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                    <h2 style={{ color: "#e2e8f0", margin: "0 0 4px", fontSize: 15 }}>News Classification Training</h2>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>Review AI-scored news articles and correct severity and event-type labels.</p>
                </div>
                <button onClick={generateBatch} disabled={loading} style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: loading ? "#64748b" : "#60a5fa", padding: "8px 14px", borderRadius: 6, cursor: loading ? "default" : "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16 }}>
                    {loading ? "Loading…" : "Load Batch"}
                </button>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                {[["Reviewed", stats.total, "#60a5fa"], ["Correct", stats.correct, "#22c55e"], ["Adjusted", stats.adjusted, "#f59e0b"], ["Skipped", stats.skipped, "#64748b"]].map(([l, v, c]) => (
                    <div key={l} style={{ ...card, flex: 1, textAlign: "center", padding: "10px 8px", marginBottom: 0 }}>
                        <div style={{ color: c, fontSize: 20, fontWeight: 700 }}>{v}</div>
                        <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{l}</div>
                    </div>
                ))}
            </div>
            <ReviewQueue items={items} onLabel={handleLabel} loading={loading} onGenerate={generateBatch} generateLabel="Load Batch" renderCard={(item, fn) => <NewsTrainingCard item={item} onLabel={fn} />} />
        </div>
    )
}

// ── Training overlay ───────────────────────────────────────────────────────────
function TrainingOverlay({ node, onClose }) {
    const trainingMap = {
        det_overwatch: 'object',
        det_ais:       'ais',
        det_adsb:      'ais',
        det_news:      'news',
    }
    const trainingType = trainingMap[node.id]

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", zIndex: 20, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(148,163,184,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>Training: {node.label}</div>
                <button onClick={onClose} style={{ ...btnGhost, fontSize: 12 }}>← Back to Pipeline</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
                {trainingType === 'object' && <ObjectTrainingView />}
                {trainingType === 'ais'    && <AISTrainingView />}
                {trainingType === 'news'   && <NewsTrainingView />}
                {!trainingType && (
                    <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: 48 }}>No training interface available for this detector.</div>
                )}
            </div>
        </div>
    )
}

// ── Node inspector: Source ─────────────────────────────────────────────────────
function SourceInspector({ node, brainStatus }) {
    const [uploads, setUploads] = useState([])

    useEffect(() => {
        if (node.id === 'src_uploads') {
            fetch(`${API}/api/forge/uploads`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(data => setUploads(Array.isArray(data) ? data.slice(0, 6) : []))
                .catch(() => {})
        }
    }, [node.id])

    const detail = {
        src_ais:       { label: "Vessels tracked", value: brainStatus?.vessels_tracked ?? "—", note: "Live AIS stream across 5 maritime bounding boxes" },
        src_adsb:      { label: "Refresh", value: "10s", note: "Live ADS-B polling via OpenSky Network" },
        src_news:      { label: "Feeds", value: node.config?.feeds || 277, note: "RSS / atom feed aggregator, scoring every 5 min" },
        src_satellite: { label: "Resolution", value: "10m", note: "Sentinel-2 imagery via Overwatch ML pipeline" },
        src_osint:     { label: "Source", value: "GDELT", note: "Global event stream mapped to lat/lng" },
        src_uploads:   { label: "Files", value: uploads.length, note: "CSV, KML, GeoJSON, PDF — auto entity-extraction" },
    }[node.id] || {}

    return (
        <div>
            <StatusRow status={node.status} />
            {detail.label && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "#475569", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>{detail.label}</div>
                    <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700 }}>{detail.value}</div>
                    <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{detail.note}</div>
                </div>
            )}
            {node.id === 'src_uploads' && uploads.length > 0 && (
                <div>
                    <div style={{ color: "#475569", fontSize: 10, textTransform: "uppercase", marginBottom: 6 }}>Recent Uploads</div>
                    {uploads.map((u, i) => (
                        <div key={i} style={{ ...card, padding: "8px 10px", marginBottom: 6 }}>
                            <div style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 600 }}>{u.original_name || u.filename}</div>
                            <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{u.data_type || "auto"} · {u.entities_added || 0} entities extracted</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Node inspector: Detector ───────────────────────────────────────────────────
function DetectorInspector({ node }) {
    const [rules,  setRules]  = useState([])
    const [alerts, setAlerts] = useState([])

    const sourceMap = { det_ais: 'AIS', det_adsb: 'ADSB', det_news: 'NEWS', det_overwatch: 'SATELLITE' }
    const source = sourceMap[node.id]

    useEffect(() => {
        fetch(`${API}/api/forge/rules`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : (data.rules || [])
                setRules(list.filter(r => r.source === source || r.source === source?.toLowerCase()))
            })
            .catch(() => {})

        fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                const list = Array.isArray(data) ? data : []
                setAlerts(list.filter(a => {
                    if (source === 'AIS')  return !a.source || a.source === 'AIS'
                    return a.source === source
                }).slice(0, 8))
            })
            .catch(() => {})
    }, [node.id, source])

    return (
        <div>
            <StatusRow status={node.status} />
            <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ color: "#475569", fontSize: 10, textTransform: "uppercase" }}>Rules ({rules.length})</span>
                </div>
                {rules.map(rule => (
                    <div key={rule.id} style={{ background: "#0f1219", borderRadius: 4, padding: "9px 10px", marginBottom: 4, borderLeft: `2px solid ${rule.status === 'active' ? '#22c55e' : '#475569'}` }}>
                        <div style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 600 }}>{rule.name}</div>
                        <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{rule.trigger_type} · {rule.severity}</div>
                        {rule.params && (
                            <div style={{ color: "#334155", fontSize: 9, marginTop: 3 }}>
                                {Object.entries(rule.params).slice(0, 3).map(([k, v]) => (
                                    <span key={k} style={{ marginRight: 8 }}>{k}: {typeof v === "object" ? JSON.stringify(v) : v}</span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {rules.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No rules for this detector.</div>}
            </div>
            <div>
                <span style={{ color: "#475569", fontSize: 10, textTransform: "uppercase" }}>Recent Alerts ({alerts.length})</span>
                {alerts.map((a, i) => (
                    <div key={i} style={{ padding: "6px 8px", borderRadius: 3, marginTop: 4, background: "#0f1219", borderLeft: `2px solid ${a.severity === 'critical' ? '#f87171' : a.severity === 'high' ? '#fbbf24' : '#475569'}` }}>
                        <div style={{ color: "#94a3b8", fontSize: 10 }}>{(a.message || "").slice(0, 90)}</div>
                        <div style={{ color: "#334155", fontSize: 9, marginTop: 2 }}>{(a.timestamp || "").slice(11, 16)} · {a.rule_name || "—"}</div>
                    </div>
                ))}
                {alerts.length === 0 && <div style={{ color: "#334155", fontSize: 10, marginTop: 4 }}>No recent alerts</div>}
            </div>
        </div>
    )
}

// ── Node inspector: Enrichment ─────────────────────────────────────────────────
function EnrichmentInspector({ node }) {
    const [stats, setStats] = useState(null)

    useEffect(() => {
        if (node.id === 'enr_correlation') {
            fetch(`${API}/api/forge/correlations`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(data => {
                    const list = Array.isArray(data) ? data : []
                    setStats({ total: list.length, critical: list.filter(c => c.severity === "CRITICAL").length, high: list.filter(c => c.severity === "HIGH").length })
                })
                .catch(() => {})
        } else if (node.id === 'enr_ontology') {
            fetch(`${API}/api/forge/ontology`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : {})
                .then(data => setStats({ nodes: (data.nodes || []).length, edges: (data.edges || []).length }))
                .catch(() => {})
        }
    }, [node.id])

    return (
        <div>
            <StatusRow status={node.status} />
            {node.id === 'enr_correlation' && stats && (
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    {[["Total", stats.total, "#60a5fa"], ["Critical", stats.critical, "#ef4444"], ["High", stats.high, "#f59e0b"]].map(([l, v, c]) => (
                        <div key={l} style={{ ...card, flex: 1, textAlign: "center", padding: "10px 8px", marginBottom: 0 }}>
                            <div style={{ color: c, fontSize: 18, fontWeight: 700 }}>{v}</div>
                            <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{l}</div>
                        </div>
                    ))}
                </div>
            )}
            {node.id === 'enr_ontology' && stats && (
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    {[["Entities", stats.nodes, "#8b5cf6"], ["Connections", stats.edges, "#60a5fa"]].map(([l, v, c]) => (
                        <div key={l} style={{ ...card, flex: 1, textAlign: "center", padding: "10px 8px", marginBottom: 0 }}>
                            <div style={{ color: c, fontSize: 22, fontWeight: 700 }}>{v}</div>
                            <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{l}</div>
                        </div>
                    ))}
                </div>
            )}
            {node.id === 'enr_geocode' && (
                <div style={{ color: "#475569", fontSize: 12 }}>Provides lat/lng resolution for news events and uploaded entity data.</div>
            )}
        </div>
    )
}

// ── Node inspector: Intelligence ───────────────────────────────────────────────
function IntelligenceInspector({ node }) {
    const [scores, setScores] = useState([])

    useEffect(() => {
        if (node.id === 'int_threat') {
            fetch(`${API}/api/forge/threat-scores`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(data => setScores(Array.isArray(data) ? data.slice(0, 5) : []))
                .catch(() => {})
        }
    }, [node.id])

    const LEVEL_COLORS = { CRITICAL: "#ef4444", HIGH: "#f59e0b", ELEVATED: "#60a5fa", LOW: "#22c55e" }

    return (
        <div>
            <StatusRow status={node.status} />
            {node.id === 'int_threat' && (
                <div>
                    <div style={{ color: "#475569", fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>Top Threat Regions</div>
                    {scores.map(s => (
                        <div key={s.region} style={{ ...card, padding: "10px 12px", marginBottom: 6, borderLeft: `3px solid ${LEVEL_COLORS[s.level] || "#64748b"}20` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 600 }}>{s.region}</span>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span style={{ color: LEVEL_COLORS[s.level], fontSize: 10, fontWeight: 700 }}>{s.level}</span>
                                    <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>{Math.round((s.score || 0) * 100)}%</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {scores.length === 0 && <div style={{ color: "#334155", fontSize: 11 }}>No threat scores — detection cycle runs every 5 min.</div>}
                </div>
            )}
            {(node.id === 'int_patterns' || node.id === 'int_escalation') && (
                <div style={{ color: "#475569", fontSize: 12 }}>Powered by the Correlation Engine — results surface in the Alert System and Director Briefings.</div>
            )}
        </div>
    )
}

// ── Node inspector: Output ─────────────────────────────────────────────────────
function OutputInspector({ node, brainStatus }) {
    const [alerts, setAlerts] = useState([])

    useEffect(() => {
        if (node.id === 'out_alerts') {
            fetch(`${API}/api/forge/alerts`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(data => setAlerts(Array.isArray(data) ? data.slice(0, 6) : []))
                .catch(() => {})
        }
    }, [node.id])

    return (
        <div>
            <StatusRow status={node.status} />
            {node.id === 'out_alerts' && (
                <div>
                    <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{brainStatus?.alerts_24h ?? alerts.length}</div>
                    <div style={{ color: "#475569", fontSize: 11, marginBottom: 14 }}>alerts in last 24h</div>
                    {alerts.map((a, i) => (
                        <div key={i} style={{ ...card, padding: "8px 10px", marginBottom: 5, borderLeft: `2px solid ${a.severity === 'critical' ? '#ef4444' : a.severity === 'high' ? '#f59e0b' : '#475569'}` }}>
                            <div style={{ color: "#94a3b8", fontSize: 11 }}>{(a.message || "").slice(0, 80)}</div>
                            <div style={{ color: "#334155", fontSize: 9, marginTop: 2 }}>{(a.timestamp || "").slice(11, 16)} · {a.rule_name || a.source}</div>
                        </div>
                    ))}
                </div>
            )}
            {node.id === 'out_briefings' && <div style={{ color: "#475569", fontSize: 12 }}>Director system — AI-generated intelligence briefings from threat scores and correlation assessments.</div>}
            {node.id === 'out_reports'   && <div style={{ color: "#475569", fontSize: 12 }}>Export ready — generates PDF/JSON reports from pattern recognition and threat assessments.</div>}
        </div>
    )
}

// ── Shared inspector helper ────────────────────────────────────────────────────
function StatusRow({ status }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_DOT[status] || "#475569" }} />
            <span style={{ color: "#94a3b8", fontSize: 12, textTransform: "capitalize" }}>{status || "unknown"}</span>
        </div>
    )
}

// ── Node inspector panel ───────────────────────────────────────────────────────
function NodeInspector({ node, brainStatus, onClose, onOpenTraining }) {
    const color = TYPE_COLORS[node.type] || '#64748b'
    return (
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 360, background: "#0f1219", borderLeft: "1px solid rgba(148,163,184,0.08)", display: "flex", flexDirection: "column", zIndex: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(148,163,184,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <div>
                    <div style={{ color, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{node.type}</div>
                    <div style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 600 }}>{node.label}</div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", fontSize: 18, cursor: "pointer", padding: "2px 6px" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
                {node.type === 'source'       && <SourceInspector      node={node} brainStatus={brainStatus} />}
                {node.type === 'detector'     && <DetectorInspector     node={node} />}
                {node.type === 'enrichment'   && <EnrichmentInspector   node={node} />}
                {node.type === 'intelligence' && <IntelligenceInspector node={node} />}
                {node.type === 'output'       && <OutputInspector       node={node} brainStatus={brainStatus} />}
            </div>
            <div style={{ padding: 12, borderTop: "1px solid rgba(148,163,184,0.06)", display: "flex", gap: 6, flexShrink: 0 }}>
                {node.type === 'detector' && (
                    <button onClick={() => onOpenTraining(node)} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid rgba(96,165,250,0.3)", background: "transparent", color: "#60a5fa", cursor: "pointer", fontSize: 11 }}>Open Training</button>
                )}
                <button style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid rgba(148,163,184,0.12)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>View Logs</button>
            </div>
        </div>
    )
}

// ── ForgePanel (main export) ───────────────────────────────────────────────────
export default function ForgePanel({ user, onClose }) {
    const [brainStatus,   setBrainStatus]   = useState(null)
    const [selectedNode,  setSelectedNode]  = useState(null)
    const [trainingNode,  setTrainingNode]  = useState(null)
    const [pipelineNodes, setPipelineNodes] = useState(PIPELINE_NODES)

    useEffect(() => {
        const load = () =>
            fetch(`${API}/api/forge/brain-status`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    setBrainStatus(d)
                    if (d) {
                        setPipelineNodes(prev => prev.map(node => {
                            if (node.id === 'src_ais')   return { ...node, config: { ...node.config, vessels_tracked: d.vessels_tracked } }
                            if (node.id === 'det_ais')   return { ...node, config: { ...node.config, rules: d.rules_active } }
                            if (node.id === 'out_alerts') return { ...node, config: { ...node.config, alerts_24h: d.alerts_24h } }
                            return node
                        }))
                    }
                })
                .catch(() => {})
        load()
        const id = setInterval(load, 30_000)
        return () => clearInterval(id)
    }, [])

    const handleNodeClick = (id, node) => {
        if (selectedNode?.id === id) { setSelectedNode(null); return }
        setSelectedNode(node)
        setTrainingNode(null)
    }

    const handleOpenTraining = (node) => {
        setTrainingNode(node)
        setSelectedNode(null)
    }

    return (
        <div style={{ position: "absolute", inset: 0, background: "#0a0e1a", zIndex: 50, display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            {/* Header */}
            <div style={{ padding: "0 20px", height: 48, flexShrink: 0, borderBottom: "1px solid rgba(148,163,184,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 7 }}>
                        <FIcoHammer w={13} h={13} /> FORGE
                    </span>
                    <span style={{ color: "#334155", fontSize: 11 }}>Intelligence Pipeline</span>
                    {user?.email && <span style={{ color: "#334155", fontSize: 11 }}> · {user.email}</span>}
                </div>
                <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                    {brainStatus && (
                        <span style={{ color: "#334155", fontSize: 10 }}>
                            {brainStatus.last_cycle ? `Cycle: ${new Date(brainStatus.last_cycle).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No cycle yet"}
                            {" · "}{brainStatus.vessels_tracked ?? "—"} vessels
                            {" · "}{brainStatus.alerts_24h ?? "—"} alerts
                        </span>
                    )}
                    {onClose && (
                        <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>×</button>
                    )}
                </div>
            </div>

            {/* Pipeline canvas + overlays */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
                <PipelineCanvas
                    nodes={pipelineNodes}
                    edges={PIPELINE_EDGES}
                    brainStatus={brainStatus}
                    onNodeClick={handleNodeClick}
                />

                {selectedNode && !trainingNode && (
                    <NodeInspector
                        node={selectedNode}
                        brainStatus={brainStatus}
                        onClose={() => setSelectedNode(null)}
                        onOpenTraining={handleOpenTraining}
                    />
                )}

                {trainingNode && (
                    <TrainingOverlay
                        node={trainingNode}
                        onClose={() => setTrainingNode(null)}
                    />
                )}
            </div>
        </div>
    )
}
