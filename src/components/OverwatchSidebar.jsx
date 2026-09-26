import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

// ── Named exports preserved for app.jsx imports ───────────────────────────────
export function IconOverwatch({ size = 18, color = "currentColor" }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color}
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
            <circle cx="9" cy="9" r="2.5"/>
            <line x1="9" y1="1" x2="9" y2="3"/>
            <line x1="9" y1="15" x2="9" y2="17"/>
            <line x1="1" y1="9" x2="3" y2="9"/>
            <line x1="15" y1="9" x2="17" y2="9"/>
        </svg>
    )
}

export const TAXONOMY = {
    Aircraft:       { color: "#5856D6", classes: ["plane","airplane","helicopter"] },
    Aviation:       { color: "#5856D6", classes: ["airport","helipad"] },
    Vessel:         { color: "#34AADC", classes: ["ship","boat"] },
    Vehicle:        { color: "#FF9500", classes: ["large-vehicle","small-vehicle","large vehicle","small vehicle","car","truck","bus","motorcycle","bicycle"] },
    Infrastructure: { color: "#9b72cc", classes: ["bridge","harbor","train","container-crane","roundabout"] },
    Energy:         { color: "#FFCC00", classes: ["storage-tank","storage tank"] },
    Facility:       { color: "#b88440", classes: ["baseball-diamond","tennis-court","basketball-court","ground-track-field","soccer-ball-field","swimming-pool"] },
    Person:         { color: "#cc6080", classes: ["person"] },
}
export function catForClass(cls) {
    const c = (cls || "").toLowerCase().trim()
    for (const [cat, info] of Object.entries(TAXONOMY)) {
        if (info.classes.includes(c)) return cat
    }
    return "Object"
}
export function colorForCat(cat) { return TAXONOMY[cat]?.color || "rgba(200,210,220,0.6)" }
export function colorForClass(cls) { return colorForCat(catForClass(cls)) }

const SCANS_KEY  = "ow-saved-scans-v1"
const IMAGES_KEY = "ow-saved-images-v1"
export function loadSavedScans()  { try { const p = JSON.parse(localStorage.getItem(SCANS_KEY));  return Array.isArray(p) ? p : [] } catch { return [] } }
export function loadSavedImages() { try { const p = JSON.parse(localStorage.getItem(IMAGES_KEY)); return Array.isArray(p) ? p : [] } catch { return [] } }
export function persistSavedScans(arr)  { try { localStorage.setItem(SCANS_KEY,  JSON.stringify(arr)) } catch {} }
export function persistSavedImages(arr) {
    try { localStorage.setItem(IMAGES_KEY, JSON.stringify(arr)) } catch {
        try { localStorage.setItem(IMAGES_KEY, JSON.stringify(arr.map(i => ({ ...i, src: null })))) } catch {}
    }
}

export const SENTINEL_TYPES = [
    { key: "true_color",  label: "True Colour (RGB)" },
    { key: "false_color", label: "False Colour (NIR)" },
    { key: "swir",        label: "SWIR — Fire/Burn" },
    { key: "ndvi",        label: "NDVI — Vegetation" },
    { key: "ndwi",        label: "NDWI — Water" },
    { key: "ndsi",        label: "NDSI — Snow" },
]

// ── Colours / icons / readable labels by category and class ──────────────────
const CATEGORY_COLORS = {
    Aircraft:       "#5856D6",
    Aviation:       "#5856D6",
    Vessel:         "#34AADC",
    Ship:           "#34AADC",
    Vehicle:        "#FF9500",
    Infrastructure: "#9b72cc",
    Energy:         "#FFCC00",
    Facility:       "#b88440",
    Building:       "#FF9500",
    Military:       "#FF3B30",
    default:        "#FFCC00",
}
const CATEGORY_ICONS = {
    Aircraft:       "✈",
    Aviation:       "🛩",
    Vessel:         "⚓",
    Ship:           "⚓",
    Vehicle:        "🚛",
    Infrastructure: "🏗",
    Energy:         "⚡",
    Facility:       "🏟",
    Building:       "🏗",
    Military:       "🎯",
    default:        "◉",
}
const READABLE_LABELS = {
    "plane":               "Fixed-wing aircraft",
    "helicopter":          "Rotary aircraft",
    "ship":                "Maritime vessel",
    "large-vehicle":       "Large vehicle / truck",
    "large vehicle":       "Large vehicle / truck",
    "small-vehicle":       "Small vehicle / car",
    "small vehicle":       "Small vehicle / car",
    "storage-tank":        "Storage tank (oil/chemical)",
    "storage tank":        "Storage tank (oil/chemical)",
    "harbor":              "Harbor / port facility",
    "bridge":              "Bridge / overpass",
    "airport":             "Airport / airfield",
    "helipad":             "Helipad",
    "container-crane":     "Container crane",
    "roundabout":          "Traffic roundabout",
    "baseball-diamond":    "Baseball diamond",
    "baseball diamond":    "Baseball diamond",
    "tennis-court":        "Tennis court",
    "tennis court":        "Tennis court",
    "basketball-court":    "Basketball court",
    "basketball court":    "Basketball court",
    "ground-track-field":  "Athletic track",
    "ground track field":  "Athletic track",
    "soccer-ball-field":   "Sports field",
    "soccer ball field":   "Sports field",
    "swimming-pool":       "Swimming pool",
    "swimming pool":       "Swimming pool",
}

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `${r},${g},${b}`
}

function safeArray(data) {
    if (Array.isArray(data)) return data
    if (data?.zones) return Array.isArray(data.zones) ? data.zones : []
    if (data?.items) return Array.isArray(data.items) ? data.items : []
    return []
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OverwatchSidebar({
    bounds,
    polygon,
    detections = [],
    scanning   = false,
    onScan,
    onScanSentinel,
    onSentinelLoaded,
    onAssessArea,
    onClear,
    drawMode = "rectangle",
    onDrawModeChange,
    isMobile = false,
}) {
    const [sentinelType,    setSentinelType]    = useState("true_color")
    const [sentinelCloud,   setSentinelCloud]   = useState(30)
    const [sentinelDays,    setSentinelDays]    = useState(10)
    const [sentinelLoading, setSentinelLoading] = useState(false)
    const [sentinelLoaded,  setSentinelLoaded]  = useState(false)
    const [sentinelError,   setSentinelError]   = useState(null)
    const [minConf,         setMinConf]         = useState(0.20)
    const [enhance,         setEnhance]         = useState(false)
    const [model,           setModel]           = useState("dota")
    const [filterCat,       setFilterCat]       = useState("All")
    const [savedZones,      setSavedZones]      = useState([])
    const [savingZone,      setSavingZone]      = useState(false)
    const [zoneName,        setZoneName]        = useState("")
    const [zoneInterval,    setZoneInterval]    = useState(5)

    // Reset loaded flag when type changes
    useEffect(() => { setSentinelLoaded(false); setSentinelError(null) }, [sentinelType])
    // Reset loaded flag when bounds change
    useEffect(() => { setSentinelLoaded(false); setSentinelError(null) }, [bounds])

    // Load saved watch zones
    useEffect(() => {
        fetch(`${API_BASE}/api/watch-zones`)
            .then(r => r.ok ? r.json() : [])
            .then(data => setSavedZones(safeArray(data)))
            .catch(() => {})
    }, [])

    // Group filtered detections by category
    const filtered = detections.filter(d => {
        if (filterCat !== "All" && (d.category || "default") !== filterCat) return false
        return (d.confidence ?? 0) >= minConf
    })
    const byCategory = {}
    for (const d of filtered) {
        const cat = d.category || "default"
        if (!byCategory[cat]) byCategory[cat] = []
        byCategory[cat].push(d)
    }

    const loadSentinel = async () => {
        if (!bounds) return
        setSentinelLoading(true)
        setSentinelLoaded(false)
        setSentinelError(null)
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API_BASE}/api/sentinel/imagery`, {
                method: "POST", headers,
                body: JSON.stringify({
                    bounds,
                    type: sentinelType,
                    max_cloud: sentinelCloud,
                    days_back: sentinelDays,
                }),
            })
            const data = await res.json()
            if (data.error) { setSentinelError(data.error); return }
            if (data.image) {
                setSentinelLoaded(true)
                onSentinelLoaded?.({ image_b64: data.image, bounds })
            } else {
                setSentinelError("No imagery found for this region/date range")
            }
        } catch (e) {
            setSentinelError("Failed to load imagery")
        } finally {
            setSentinelLoading(false)
        }
    }

    const saveZone = async () => {
        if (!bounds || !zoneName.trim()) return
        setSavingZone(true)
        try {
            // Build GeoJSON polygon — API requires this format (lon,lat order, closed ring)
            let polygon_geojson
            if (polygon?.vertices?.length >= 3) {
                const coords = polygon.vertices.map(([lat, lon]) => [lon, lat])
                coords.push(coords[0])
                polygon_geojson = { type: "Polygon", coordinates: [coords] }
            } else {
                const { north, south, east, west } = bounds
                polygon_geojson = {
                    type: "Polygon",
                    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
                }
            }
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API_BASE}/api/watch-zones`, {
                method: "POST", headers,
                body: JSON.stringify({
                    name: zoneName,
                    polygon_geojson,
                    scan_interval_hours: zoneInterval * 24,
                    priority: "medium",
                    description: `Overwatch zone — ${sentinelType}`,
                }),
            })
            const data = await res.json()
            if (data.zone_id || data.id || data.system_id) {
                setSavedZones(z => [...z, data])
                setZoneName("")
            }
        } finally {
            setSavingZone(false)
        }
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    const S = {
        container: {
            position:       "fixed",
            // --top, not 40: the token is 34px at compact density.
            top:            "var(--top, 40px)",
            right:          0,
            // The status bar is the floor, the mobile tab bar on phones.
            bottom:         isMobile ? 56 : "var(--status, 0px)",
            width:          280,
            background:     "rgb(8, 14, 28)",
            borderLeft:     "1px solid rgba(255,255,255,0.06)",
            display:        "flex",
            flexDirection:  "column",
            fontFamily:     "-apple-system, BlinkMacSystemFont, sans-serif",
            color:          "white",
            overflow:       "hidden",
            zIndex:         1150,
        },
        header: {
            padding:        "14px 16px 10px",
            borderBottom:   "1px solid rgba(255,255,255,0.06)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            flexShrink:     0,
        },
        section: {
            padding:        "10px 14px",
            borderBottom:   "1px solid rgba(255,255,255,0.05)",
        },
        label: {
            fontSize:      9,
            color:         "rgba(255,255,255,0.3)",
            textTransform: "uppercase",
            letterSpacing: 1.2,
            marginBottom:  8,
            fontWeight:    600,
        },
        select: {
            width:        "100%",
            background:   "rgba(255,255,255,0.06)",
            border:       "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color:        "white",
            fontSize:     11,
            padding:      "5px 8px",
            cursor:       "pointer",
            outline:      "none",
        },
        input: {
            width:        "100%",
            background:   "rgba(255,255,255,0.06)",
            border:       "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color:        "white",
            fontSize:     11,
            padding:      "5px 8px",
            outline:      "none",
            boxSizing:    "border-box",
        },
    }

    const modeBtn = (color, active) => ({
        flex:         1,
        padding:      "7px 0",
        background:   active ? `rgba(${hexToRgb(color)},0.12)` : "rgba(255,255,255,0.04)",
        border:       `1px solid rgba(${hexToRgb(color)},${active ? 0.35 : 0.1})`,
        borderRadius: 6,
        color:        active ? color : "rgba(255,255,255,0.3)",
        fontSize:     11,
        fontWeight:   600,
        cursor:       "pointer",
        letterSpacing: 0.3,
    })

    return (
        <div style={S.container}>

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div style={S.header}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: scanning ? "#FF9500" : "#30D158",
                            boxShadow: `0 0 6px ${scanning ? "#FF9500" : "#30D158"}`,
                        }}/>
                        OVERWATCH
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1, letterSpacing: 0.5 }}>
                        ML Object Detection System
                    </div>
                </div>
                <button onClick={onClear} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 16, cursor: "pointer" }}>×</button>
            </div>

            {/* ── Scrollable body ───────────────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

                {/* Draw Mode */}
                <div style={S.section}>
                    <div style={S.label}>Draw Mode</div>
                    <div style={{ display: "flex", gap: 6 }}>
                        {[
                            { key: "rectangle", label: "▭ Rectangle" },
                            { key: "polygon",   label: "⬡ Polygon" },
                        ].map(({ key, label }) => (
                            <button key={key} onClick={() => onDrawModeChange?.(key)} style={modeBtn("#34AADC", drawMode === key)}>
                                {label}
                            </button>
                        ))}
                    </div>
                    {!bounds && (
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
                            {drawMode === "rectangle" ? "Click two points on globe" : "Click vertices · double-click to close"}
                        </div>
                    )}
                </div>

                {/* Sentinel-2 Imagery */}
                <div style={S.section}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={S.label}>Sentinel-2 Imagery</div>
                        {sentinelLoaded && (
                            <div style={{ fontSize: 9, color: "#30D158", fontWeight: 600 }}>✓ LOADED</div>
                        )}
                    </div>

                    <select value={sentinelType} onChange={e => setSentinelType(e.target.value)} style={{ ...S.select, marginBottom: 6 }}>
                        {SENTINEL_TYPES.map(t => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                    </select>

                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>Cloud %</div>
                            <select value={sentinelCloud} onChange={e => setSentinelCloud(Number(e.target.value))} style={S.select}>
                                <option value={10}>≤10%</option>
                                <option value={20}>≤20%</option>
                                <option value={30}>≤30%</option>
                                <option value={50}>≤50%</option>
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>Days back</div>
                            <select value={sentinelDays} onChange={e => setSentinelDays(Number(e.target.value))} style={S.select}>
                                <option value={5}>5 days</option>
                                <option value={10}>10 days</option>
                                <option value={20}>20 days</option>
                                <option value={30}>30 days</option>
                                <option value={60}>60 days</option>
                            </select>
                        </div>
                    </div>

                    {sentinelError && (
                        <div style={{ fontSize: 10, color: "#FF3B30", marginBottom: 6, padding: "4px 8px", background: "rgba(255,59,48,0.1)", borderRadius: 4 }}>
                            ⚠ {sentinelError}
                        </div>
                    )}

                    <button
                        onClick={loadSentinel}
                        disabled={!bounds || sentinelLoading}
                        style={{
                            width: "100%", padding: "7px 0",
                            background:   sentinelLoaded ? "rgba(48,209,88,0.1)" : "rgba(52,170,220,0.1)",
                            border:       `1px solid ${sentinelLoaded ? "rgba(48,209,88,0.3)" : "rgba(52,170,220,0.3)"}`,
                            borderRadius: 6,
                            color:        sentinelLoaded ? "#30D158" : "#34AADC",
                            fontSize: 11, fontWeight: 600,
                            cursor: (!bounds || sentinelLoading) ? "not-allowed" : "pointer",
                            opacity: !bounds ? 0.4 : 1,
                        }}
                    >
                        {sentinelLoading ? "⟳ Fetching imagery…" : sentinelLoaded ? "🛰 Sentinel Loaded — Reload" : "🛰 Load Sentinel Imagery"}
                    </button>
                </div>

                {/* ML Detection */}
                <div style={S.section}>
                    <div style={S.label}>ML Detection</div>

                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>Model</div>
                            <select value={model} onChange={e => setModel(e.target.value)} style={S.select}>
                                <option value="dota">DOTA OBB (nano)</option>
                                <option value="dota-v2">DOTA OBB (medium — higher accuracy)</option>
                                <option value="coco">COCO General</option>
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>Min Confidence</div>
                            <select value={minConf} onChange={e => setMinConf(Number(e.target.value))} style={S.select}>
                                <option value={0.15}>15%</option>
                                <option value={0.20}>20%</option>
                                <option value={0.25}>25%</option>
                                <option value={0.35}>35%</option>
                                <option value={0.50}>50%</option>
                            </select>
                        </div>
                    </div>

                    {/* AI Classification toggle */}
                    <div onClick={() => setEnhance(v => !v)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "5px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 8,
                        background: enhance ? "rgba(88,86,214,0.1)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${enhance ? "rgba(88,86,214,0.3)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                        <span style={{ fontSize: 11, color: enhance ? "#5856D6" : "rgba(255,255,255,0.5)" }}>AI Classification</span>
                        <div style={{ width: 28, height: 16, borderRadius: 8, background: enhance ? "#5856D6" : "rgba(255,255,255,0.1)", position: "relative", transition: "background 0.2s" }}>
                            <div style={{ position: "absolute", top: 2, left: enhance ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "white", transition: "left 0.2s" }}/>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            onClick={() => onScan?.({ bounds, confidence: minConf, enhance, model })}
                            disabled={!bounds || scanning}
                            style={{ ...modeBtn("#34AADC", !!bounds && !scanning), opacity: !bounds ? 0.4 : 1 }}
                        >
                            {scanning ? "⟳ Scanning…" : "▶ Scan ESRI"}
                        </button>
                        <button
                            onClick={() => onScanSentinel?.({ confidence: minConf, enhance, model, sentinelType })}
                            disabled={!sentinelLoaded || scanning}
                            style={{ ...modeBtn("#30D158", sentinelLoaded && !scanning), opacity: !sentinelLoaded ? 0.4 : 1 }}
                        >
                            🛰 Scan Sentinel
                        </button>
                    </div>
                </div>

                {/* Results */}
                {detections.length > 0 && (
                    <div style={S.section}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={S.label}>Results — {filtered.length} objects</div>
                            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...S.select, width: "auto" }}>
                                <option value="All">All</option>
                                {Object.keys(byCategory).map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>

                        {/* Category summary bars */}
                        {Object.entries(byCategory).map(([cat, dets]) => {
                            const avgConf = dets.reduce((a, d) => a + d.confidence, 0) / dets.length
                            const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.default
                            const icon  = CATEGORY_ICONS[cat]  || CATEGORY_ICONS.default
                            return (
                                <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                                    <span style={{ fontSize: 12, width: 16, textAlign: "center" }}>{icon}</span>
                                    <span style={{ fontSize: 11, flex: 1, color: "rgba(255,255,255,0.8)" }}>{cat}</span>
                                    <span style={{ fontSize: 11, color, fontWeight: 600, minWidth: 20, textAlign: "right" }}>{dets.length}</span>
                                    <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                                        <div style={{ width: `${avgConf * 100}%`, height: "100%", background: color, borderRadius: 2 }}/>
                                    </div>
                                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", minWidth: 28 }}>{Math.round(avgConf * 100)}%</span>
                                </div>
                            )
                        })}

                        {/* Detection list */}
                        <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
                            {filtered
                                .sort((a, b) => b.confidence - a.confidence)
                                .map((det, i) => {
                                    const color = CATEGORY_COLORS[det.category] || CATEGORY_COLORS.default
                                    const icon  = CATEGORY_ICONS[det.category]  || CATEGORY_ICONS.default
                                    return (
                                        <div key={i}
                                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 4, cursor: "pointer", marginBottom: 1 }}
                                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                        >
                                            <span style={{ fontSize: 10 }}>{icon}</span>
                                            <span style={{ fontSize: 10, flex: 1, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {READABLE_LABELS[det.class] || det.specific_type || det.class}
                                            </span>
                                            <span style={{ fontSize: 10, color, fontWeight: 600, flexShrink: 0 }}>
                                                {Math.round(det.confidence * 100)}%
                                            </span>
                                        </div>
                                    )
                                })}
                        </div>

                        <button
                            onClick={() => onAssessArea?.(filtered, bounds)}
                            style={{
                                width: "100%", marginTop: 8, padding: "6px 0",
                                background: "rgba(191,90,242,0.1)",
                                border: "1px solid rgba(191,90,242,0.3)",
                                borderRadius: 6, color: "#BF5AF2",
                                fontSize: 11, fontWeight: 600, cursor: "pointer",
                            }}
                        >
                            ◈ Assess Area with AI
                        </button>
                    </div>
                )}

                {/* Save Zone */}
                {bounds && (
                    <div style={S.section}>
                        <div style={S.label}>Save Zone</div>
                        <input
                            value={zoneName}
                            onChange={e => setZoneName(e.target.value)}
                            placeholder="Zone name…"
                            style={{ ...S.input, marginBottom: 6 }}
                        />
                        <div style={{ marginBottom: 8 }}>
                            <select value={zoneInterval} onChange={e => setZoneInterval(Number(e.target.value))} style={S.select}>
                                <option value={1}>Every 1 day</option>
                                <option value={3}>Every 3 days</option>
                                <option value={5}>Every 5 days</option>
                                <option value={7}>Every 7 days</option>
                                <option value={14}>Every 14 days</option>
                            </select>
                        </div>
                        <button
                            onClick={saveZone}
                            disabled={!zoneName.trim() || savingZone}
                            style={{
                                width: "100%", padding: "6px 0",
                                background:   zoneName.trim() ? "rgba(255,204,0,0.1)"     : "rgba(255,255,255,0.04)",
                                border:       `1px solid ${zoneName.trim() ? "rgba(255,204,0,0.3)" : "rgba(255,255,255,0.06)"}`,
                                borderRadius: 6,
                                color:        zoneName.trim() ? "#FFCC00" : "rgba(255,255,255,0.2)",
                                fontSize: 11, fontWeight: 600,
                                cursor:       zoneName.trim() ? "pointer" : "not-allowed",
                            }}
                        >
                            {savingZone ? "⟳ Saving…" : "📍 Save Zone + Schedule Scan"}
                        </button>
                    </div>
                )}

                {/* Saved Zones */}
                {savedZones.length > 0 && (
                    <div style={S.section}>
                        <div style={S.label}>Saved Zones ({savedZones.length})</div>
                        {savedZones.map((zone, i) => (
                            <div key={zone.system_id || zone.id || i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 6, marginBottom: 4 }}>
                                <span style={{ fontSize: 10 }}>📍</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {zone.name}
                                    </div>
                                    {zone.next_scan_at && (
                                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                                            Next: {new Date(zone.next_scan_at).toLocaleDateString()}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

            </div>
        </div>
    )
}
