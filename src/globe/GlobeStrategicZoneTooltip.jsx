import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import API_BASE from "../apiBase.js"
import ForesightPanel from "../components/ForesightPanel.jsx"

const ZONE_TYPE_LABELS = {
    CONFLICT_ACTIVE:    "Active Conflict",
    CONFLICT_FROZEN:    "Frozen Conflict",
    MILITARY_SENSITIVE: "Military Zone",
    NUCLEAR_SENSITIVE:  "Nuclear Sensitive",
    CHOKEPOINT_EXTENDED:"Chokepoint",
    ECONOMIC_CRITICAL:  "Economic Critical",
    INSTABILITY:        "Instability Zone",
    CUSTOM:             "Custom Zone",
}

const SEVERITY_COLOURS = {
    critical: "#FF3B30",
    high:     "#FF9500",
    medium:   "#FFCC00",
    low:      "#34C759",
}

const TYPE_COLOURS = {
    CONFLICT_ACTIVE:    "#FF3B30",
    CONFLICT_FROZEN:    "#FF9500",
    MILITARY_SENSITIVE: "#007AFF",
    NUCLEAR_SENSITIVE:  "#5856D6",
    CHOKEPOINT_EXTENDED:"#FF6B35",
    ECONOMIC_CRITICAL:  "#30B0C7",
    INSTABILITY:        "#FFCC00",
    CUSTOM:             "#8E8E93",
}

function Tooltip({ zone, x, y, visible, onClose }) {
    const [activeTab,     setActiveTab]     = useState("overview")
    const [imgIdx,        setImgIdx]        = useState(0)
    const [imgFade,       setImgFade]       = useState(true)
    const [imgErrors,     setImgErrors]     = useState([])
    const [images,        setImages]        = useState([])
    const [imgsLoading,   setImgsLoading]   = useState(true)
    const [signals,       setSignals]       = useState([])
    const [watching,      setWatching]      = useState(false)
    const [foresightSnap, setForesightSnap] = useState(null)

    // Fetch images from API on mount
    useEffect(() => {
        setImgsLoading(true)
        setImages([])
        setImgErrors([])
        setImgIdx(0)
        fetch(`${API_BASE}/api/strategic-zones/${zone.zone_id}/images`)
            .then(r => r.ok ? r.json() : { images: [] })
            .then(d => {
                const imgs = Array.isArray(d) ? d : (d.images || [])
                setImages(imgs)
                setImgErrors(new Array(imgs.length).fill(false))
            })
            .catch(() => {})
            .finally(() => setImgsLoading(false))
    }, [zone.zone_id])

    // Cycle images every 7 s
    useEffect(() => {
        if (images.length <= 1) return
        const id = setInterval(() => {
            setImgFade(false)
            setTimeout(() => {
                setImgIdx(i => (i + 1) % images.length)
                setImgFade(true)
            }, 300)
        }, 7000)
        return () => clearInterval(id)
    }, [images.length])

    // Fetch active signals
    useEffect(() => {
        if (!zone.zone_id) return
        fetch(`${API_BASE}/api/strategic-zones/${zone.zone_id}/signals`)
            .then(r => r.ok ? r.json() : { signals: [] })
            .then(d => setSignals((d.signals || d || []).slice(0, 5)))
            .catch(() => {})
    }, [zone.zone_id])

    // Fetch foresight snapshot for overview tab
    useEffect(() => {
        if (!zone.zone_id) return
        fetch(`${API_BASE}/api/foresight/${zone.zone_id}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.situation_summary) setForesightSnap(d) })
            .catch(() => {})
    }, [zone.zone_id])

    const handleImgError = useCallback((i) => {
        setImgErrors(prev => {
            const next = [...prev]
            next[i] = true
            return next
        })
        // Skip to next image
        setImgIdx(cur => (cur + 1) % Math.max(images.length, 1))
    }, [images.length])

    const handleOpenForge = useCallback(() => {
        window.dispatchEvent(new CustomEvent("akili:open-forge"))
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:forge-nav", { detail: { workspace: "strategic-zones" } }))
        }, 120)
        onClose()
    }, [onClose])

    const typeColour     = TYPE_COLOURS[zone.zone_type]     || "#8E8E93"
    const severityColour = SEVERITY_COLOURS[zone.severity_baseline] || "#8E8E93"
    const typeLabel      = ZONE_TYPE_LABELS[zone.zone_type] || zone.zone_type?.replace(/_/g, " ") || "Zone"

    const currentImgBroken = imgErrors[imgIdx]
    const hasValidImage    = images.length > 0 && !imgsLoading && images.some((_, i) => !imgErrors[i])

    return (
        <div
            style={{
                position:        "fixed",
                left:            x,
                top:             y,
                width:           320,
                background:      "rgba(10, 18, 35, 0.92)",
                backdropFilter:  "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border:          "1px solid rgba(255,255,255,0.08)",
                borderRadius:    12,
                overflow:        "hidden",
                zIndex:          9000,
                boxShadow:       "0 8px 32px rgba(0,0,0,0.6)",
                fontFamily:      "Inter, system-ui, sans-serif",
                color:           "#fff",
                opacity:         visible ? 1 : 0,
                pointerEvents:   visible ? "auto" : "none",
                transition:      "left 0.05s ease, top 0.05s ease, opacity 0.2s ease",
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* Image area */}
            <div style={{ position: "relative", height: 160, background: "#0a1223", overflow: "hidden" }}>

                {/* Shimmer while loading */}
                {imgsLoading && (
                    <div style={{
                        position:   "absolute",
                        inset:      0,
                        background: "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)",
                        backgroundSize: "200% 100%",
                        animation:  "sz-shimmer 1.4s ease infinite",
                    }} />
                )}

                {/* Image */}
                {!imgsLoading && images.length > 0 && !currentImgBroken && (
                    <img
                        key={imgIdx}
                        src={images[imgIdx]}
                        alt={zone.name}
                        onError={() => handleImgError(imgIdx)}
                        style={{
                            width:      "100%",
                            height:     "100%",
                            objectFit:  "cover",
                            opacity:    imgFade ? 1 : 0,
                            transition: "opacity 0.3s ease",
                        }}
                    />
                )}

                {/* Placeholder */}
                {(!imgsLoading && (!hasValidImage || currentImgBroken)) && (
                    <div style={{
                        height:         "100%",
                        display:        "flex",
                        flexDirection:  "column",
                        alignItems:     "center",
                        justifyContent: "center",
                        gap:            8,
                        background:     `linear-gradient(135deg, rgba(${hexToRgb(typeColour)},0.2) 0%, rgba(10,18,35,0.9) 100%)`,
                    }}>
                        <span style={{ fontSize: 32, opacity: 0.45 }}>{zoneTypeIcon(zone.zone_type)}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{zone.name}</span>
                    </div>
                )}

                {/* Gradient overlay */}
                <div style={{
                    position:      "absolute",
                    inset:         0,
                    background:    "linear-gradient(to bottom, rgba(10,18,35,0) 40%, rgba(10,18,35,0.85) 100%)",
                    pointerEvents: "none",
                }} />

                {/* Close button */}
                <button
                    onClick={onClose}
                    style={{
                        position:       "absolute", top: 8, right: 8,
                        width:          24, height: 24,
                        borderRadius:   "50%",
                        background:     "rgba(0,0,0,0.55)",
                        border:         "1px solid rgba(255,255,255,0.15)",
                        color:          "#fff", cursor: "pointer",
                        display:        "flex", alignItems: "center", justifyContent: "center",
                        fontSize:       14, lineHeight: 1, padding: 0,
                    }}
                >×</button>

                {/* Dot indicators */}
                {images.length > 1 && (
                    <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
                        {images.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => { setImgFade(false); setTimeout(() => { setImgIdx(i); setImgFade(true) }, 300) }}
                                style={{
                                    width:        i === imgIdx ? 16 : 6, height: 6,
                                    borderRadius: 3,
                                    background:   i === imgIdx ? "#fff" : "rgba(255,255,255,0.35)",
                                    border:       "none", cursor: "pointer", padding: 0,
                                    transition:   "width 0.25s ease",
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(10,18,35,0.6)" }}>
                {["overview", "foresight"].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} style={{
                        flex: 1, padding: "8px 0",
                        background: "none", border: "none",
                        borderBottom: `2px solid ${activeTab === tab ? "#007AFF" : "transparent"}`,
                        color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.4)",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase", cursor: "pointer",
                        transition: "color 0.15s, border-color 0.15s",
                        fontFamily: "inherit",
                    }}>
                        {tab === "foresight" ? "Foresight" : "Overview"}
                    </button>
                ))}
            </div>

            {activeTab === "overview" ? (
                <>
                    {/* Content */}
                    <div style={{ padding: "12px 14px 0" }}>
                        {/* Badges */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                            <span style={badgeStyle(typeColour)}>{typeLabel}</span>
                            <span style={badgeStyle(severityColour)}>{zone.severity_baseline?.toUpperCase()}</span>
                        </div>

                        {/* Name */}
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>{zone.name}</div>

                        {/* Description */}
                        {zone.description && (
                            <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.62)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 10 }}>
                                {zone.description}
                            </div>
                        )}

                        {/* Foresight snapshot */}
                        {foresightSnap && (
                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8, marginBottom: 8 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", marginBottom: 6 }}>
                                    Escalation Forecast
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                    <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                                        <div style={{ width: `${(foresightSnap.escalation_probability_30d || 0) * 100}%`, height: "100%", background: foresightSnap.escalation_probability_30d >= 0.7 ? "#FF3B30" : foresightSnap.escalation_probability_30d >= 0.4 ? "#FF9500" : "#FFCC00" }} />
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: foresightSnap.escalation_probability_30d >= 0.7 ? "#FF3B30" : foresightSnap.escalation_probability_30d >= 0.4 ? "#FF9500" : "#FFCC00" }}>
                                        {Math.round((foresightSnap.escalation_probability_30d || 0) * 100)}%
                                    </span>
                                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>30d</span>
                                </div>
                                {foresightSnap.analyst_note && (
                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.45, cursor: "pointer" }}
                                        onClick={() => setActiveTab("foresight")}>
                                        {foresightSnap.analyst_note.slice(0, 90)}{foresightSnap.analyst_note.length > 90 ? "…" : ""}
                                        <span style={{ color: "#007AFF", marginLeft: 4 }}>View full &rsaquo;</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Active intelligence */}
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", marginBottom: 6 }}>
                                Active Intelligence
                            </div>
                            {signals.length === 0 ? (
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>No active signals</div>
                            ) : signals.map((s, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 5 }}>
                                    <span style={{ flexShrink: 0, marginTop: 2, width: 6, height: 6, borderRadius: "50%", background: signalDotColour(s) }} />
                                    <span style={{ fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.75)" }}>
                                        {s.summary || s.title || s.rule_name || "Signal"}
                                        {s.domain && <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>[{s.domain}]</span>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Buttons */}
                    <div style={{ display: "flex", gap: 6, padding: "0 14px 12px" }}>
                        <button onClick={handleOpenForge} style={btnStyle("#007AFF")}>Open in Forge</button>
                        <button onClick={() => setWatching(w => !w)} style={btnStyle(watching ? "#FF9500" : "#1C2539", watching)}>
                            {watching ? "Watching" : "Watch"}
                        </button>
                    </div>
                </>
            ) : (
                /* Foresight tab */
                <div style={{ height: 380, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <ForesightPanel zoneId={zone.zone_id} zoneName={zone.name} />
                </div>
            )}

            <style>{`
                @keyframes sz-shimmer {
                    0%   { background-position: -200% 0 }
                    100% { background-position:  200% 0 }
                }
            `}</style>
        </div>
    )
}

export default function GlobeStrategicZoneTooltip({ zone, x, y, visible, onClose }) {
    if (!zone) return null
    return createPortal(
        <Tooltip zone={zone} x={x} y={y} visible={visible} onClose={onClose} />,
        document.body,
    )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function badgeStyle(colour) {
    const rgb = hexToRgb(colour)
    return {
        padding: "2px 8px", borderRadius: 4,
        fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
        background: `rgba(${rgb},0.18)`,
        border:     `1px solid rgba(${rgb},0.35)`,
        color:      colour,
    }
}

function btnStyle(bg, active = false) {
    return {
        flex: 1, padding: "7px 0", borderRadius: 6, background: bg,
        border:     active ? "1px solid rgba(255,153,0,0.5)" : "1px solid rgba(255,255,255,0.09)",
        color:      "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
    }
}

function signalDotColour(s) {
    const sev = (s.severity || "").toLowerCase()
    if (sev === "critical") return "#FF3B30"
    if (sev === "high")     return "#FF9500"
    if (sev === "medium")   return "#FFCC00"
    return "#34C759"
}

function zoneTypeIcon(type) {
    switch (type) {
        case "CONFLICT_ACTIVE":     return "⚔"
        case "CONFLICT_FROZEN":     return "🧊"
        case "MILITARY_SENSITIVE":  return "🎯"
        case "NUCLEAR_SENSITIVE":   return "☢"
        case "CHOKEPOINT_EXTENDED": return "⚓"
        case "ECONOMIC_CRITICAL":   return "📦"
        case "INSTABILITY":         return "⚡"
        default:                    return "📍"
    }
}

function hexToRgb(hex) {
    const h = (hex || "#888888").replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}
