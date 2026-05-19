import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import API_BASE from "../apiBase.js"

const W = 320

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

function Tooltip({ zone, x, y, onClose, onOpenForge, onWatch }) {
    const [imgIdx,   setImgIdx]   = useState(0)
    const [imgFade,  setImgFade]  = useState(true)
    const [signals,  setSignals]  = useState([])
    const [watching, setWatching] = useState(false)

    const images = zone.images || []

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

    // Fetch active signals for this zone
    useEffect(() => {
        if (!zone.zone_id) return
        fetch(`${API_BASE}/api/strategic-zones/${zone.zone_id}/signals`)
            .then(r => r.ok ? r.json() : [])
            .then(d => setSignals(Array.isArray(d) ? d.slice(0, 5) : []))
            .catch(() => {})
    }, [zone.zone_id])

    const left = Math.min(x + 14, (window.innerWidth || 1200) - W - 10)
    const top  = Math.max(y - 80, 56)

    const typeColour     = TYPE_COLOURS[zone.zone_type]     || "#8E8E93"
    const severityColour = SEVERITY_COLOURS[zone.severity_baseline] || "#8E8E93"
    const typeLabel      = ZONE_TYPE_LABELS[zone.zone_type] || zone.zone_type?.replace(/_/g, " ") || "Zone"

    const handleOpenForge = useCallback(() => {
        window.dispatchEvent(new CustomEvent("akili:open-forge"))
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:forge-nav", {
                detail: { workspace: "strategic-zones" },
            }))
        }, 120)
        onClose()
    }, [onClose])

    const handleWatch = useCallback(() => {
        setWatching(w => !w)
        if (onWatch) onWatch(zone)
    }, [zone, onWatch])

    return (
        <div
            style={{
                position:        "absolute",
                left,
                top,
                width:           W,
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
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* Image area */}
            <div style={{ position: "relative", height: 160, background: "#0a1223", overflow: "hidden" }}>
                {images.length > 0 ? (
                    <img
                        src={images[imgIdx]}
                        alt={zone.name}
                        style={{
                            width:      "100%",
                            height:     "100%",
                            objectFit:  "cover",
                            opacity:    imgFade ? 1 : 0,
                            transition: "opacity 0.3s ease",
                        }}
                        onError={e => { e.target.style.display = "none" }}
                    />
                ) : (
                    <div style={{
                        height:     "100%",
                        display:    "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `linear-gradient(135deg, rgba(${hexToRgb(typeColour)},0.25) 0%, rgba(10,18,35,0.8) 100%)`,
                    }}>
                        <span style={{ fontSize: 36, opacity: 0.4 }}>
                            {zoneTypeIcon(zone.zone_type)}
                        </span>
                    </div>
                )}

                {/* Gradient overlay */}
                <div style={{
                    position:   "absolute",
                    inset:      0,
                    background: "linear-gradient(to bottom, rgba(10,18,35,0) 40%, rgba(10,18,35,0.85) 100%)",
                    pointerEvents: "none",
                }} />

                {/* Close button */}
                <button
                    onClick={onClose}
                    style={{
                        position:     "absolute",
                        top:          8,
                        right:        8,
                        width:        24,
                        height:       24,
                        borderRadius: "50%",
                        background:   "rgba(0,0,0,0.55)",
                        border:       "1px solid rgba(255,255,255,0.15)",
                        color:        "#fff",
                        cursor:       "pointer",
                        display:      "flex",
                        alignItems:   "center",
                        justifyContent: "center",
                        fontSize:     14,
                        lineHeight:   1,
                        padding:      0,
                    }}
                >×</button>

                {/* Dot indicators */}
                {images.length > 1 && (
                    <div style={{
                        position:       "absolute",
                        bottom:         8,
                        left:           0,
                        right:          0,
                        display:        "flex",
                        justifyContent: "center",
                        gap:            5,
                    }}>
                        {images.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => { setImgFade(false); setTimeout(() => { setImgIdx(i); setImgFade(true) }, 300) }}
                                style={{
                                    width:        i === imgIdx ? 16 : 6,
                                    height:       6,
                                    borderRadius: 3,
                                    background:   i === imgIdx ? "#fff" : "rgba(255,255,255,0.35)",
                                    border:       "none",
                                    cursor:       "pointer",
                                    padding:      0,
                                    transition:   "width 0.25s ease",
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Content */}
            <div style={{ padding: "12px 14px 0" }}>
                {/* Badges */}
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{
                        padding:      "2px 8px",
                        borderRadius: 4,
                        fontSize:     10,
                        fontWeight:   600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        background:   `rgba(${hexToRgb(typeColour)},0.18)`,
                        border:       `1px solid rgba(${hexToRgb(typeColour)},0.35)`,
                        color:        typeColour,
                    }}>
                        {typeLabel}
                    </span>
                    <span style={{
                        padding:      "2px 8px",
                        borderRadius: 4,
                        fontSize:     10,
                        fontWeight:   600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        background:   `rgba(${hexToRgb(severityColour)},0.15)`,
                        border:       `1px solid rgba(${hexToRgb(severityColour)},0.3)`,
                        color:        severityColour,
                    }}>
                        {zone.severity_baseline?.toUpperCase()}
                    </span>
                </div>

                {/* Name */}
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>
                    {zone.name}
                </div>

                {/* Description */}
                {zone.description && (
                    <div style={{
                        fontSize:    12,
                        lineHeight:  1.5,
                        color:       "rgba(255,255,255,0.62)",
                        display:     "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow:    "hidden",
                        marginBottom: 10,
                    }}>
                        {zone.description}
                    </div>
                )}

                {/* Active intelligence */}
                <div style={{
                    borderTop:   "1px solid rgba(255,255,255,0.07)",
                    paddingTop:  10,
                    marginBottom: 10,
                }}>
                    <div style={{
                        fontSize:     10,
                        fontWeight:   600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color:         "rgba(255,255,255,0.38)",
                        marginBottom:  6,
                    }}>
                        Active Intelligence
                    </div>
                    {signals.length === 0 ? (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                            No active signals
                        </div>
                    ) : (
                        signals.map((s, i) => (
                            <div key={i} style={{
                                display:       "flex",
                                alignItems:    "flex-start",
                                gap:           7,
                                marginBottom:  5,
                            }}>
                                <span style={{
                                    flexShrink:  0,
                                    marginTop:   2,
                                    width:       6,
                                    height:      6,
                                    borderRadius: "50%",
                                    background:  signalDotColour(s),
                                }} />
                                <span style={{ fontSize: 11, lineHeight: 1.4, color: "rgba(255,255,255,0.75)" }}>
                                    {s.summary || s.title || s.rule_name || "Signal"}
                                    {s.domain && (
                                        <span style={{ color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>
                                            [{s.domain}]
                                        </span>
                                    )}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Action buttons */}
            <div style={{
                display:       "flex",
                gap:           6,
                padding:       "0 14px 12px",
            }}>
                <button
                    onClick={handleOpenForge}
                    style={btnStyle("#007AFF")}
                >
                    Open in Forge
                </button>
                <button
                    onClick={handleWatch}
                    style={btnStyle(watching ? "#FF9500" : "#1C2539", watching)}
                >
                    {watching ? "Watching" : "Watch"}
                </button>
            </div>
        </div>
    )
}

export default function GlobeStrategicZoneTooltip({ zone, x, y, onClose, onOpenForge, onWatch }) {
    if (!zone) return null
    return createPortal(
        <Tooltip zone={zone} x={x} y={y} onClose={onClose} onOpenForge={onOpenForge} onWatch={onWatch} />,
        document.body,
    )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function btnStyle(bg, active = false) {
    return {
        flex:         1,
        padding:      "7px 0",
        borderRadius: 6,
        background:   bg,
        border:       active
            ? "1px solid rgba(255,153,0,0.5)"
            : "1px solid rgba(255,255,255,0.09)",
        color:        "#fff",
        fontSize:     12,
        fontWeight:   500,
        cursor:       "pointer",
        fontFamily:   "inherit",
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
    const n = parseInt(h.length === 3
        ? h.split("").map(c => c + c).join("")
        : h, 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}
