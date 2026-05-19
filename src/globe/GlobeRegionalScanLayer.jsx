import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Entity } from "resium"
import { useCesium } from "resium"
import {
    Cartesian3, Color,
    NearFarScalar, DistanceDisplayCondition,
    SceneTransforms,
} from "cesium"
import API_BASE from "../apiBase.js"

// ── Detection type config ─────────────────────────────────────────────────────

const DET_CONFIG = {
    FIRE:                   { color: "#FF3B30", label: "Fire",                 icon: "🔥" },
    SMOKE:                  { color: "#8E8E93", label: "Smoke Plume",          icon: "💨" },
    BURN_SCAR:              { color: "#FF6B35", label: "Burn Scar",            icon: "🔶" },
    RUNWAY_CHANGE:          { color: "#5856D6", label: "Runway Change",        icon: "✈" },
    PORT_CHANGE:            { color: "#34AADC", label: "Port Change",          icon: "⚓" },
    ENERGY_CHANGE:          { color: "#FFCC00", label: "Energy Infra Change",  icon: "⚡" },
    UNKNOWN_COMPOUND:       { color: "#FF3B30", label: "Unknown Compound",     icon: "🔴" },
    VEHICLE_CLUSTER:        { color: "#FF9500", label: "Vehicle Cluster",      icon: "🚗" },
    EXCAVATION:             { color: "#8B6914", label: "Excavation",           icon: "🟫" },
    INFRASTRUCTURE_CHANGE:  { color: "#FF9500", label: "Infrastructure Change",icon: "🏗" },
    MILITARY_ACTIVITY:      { color: "#FF3B30", label: "Military Activity",    icon: "🎯" },
}

const SEV_COLOR = { critical: "#FF3B30", high: "#FF9500", medium: "#FFCC00", info: "#34C759" }

function detColor(type) {
    return DET_CONFIG[type]?.color || "#8E8E93"
}

function confScale(confidence) {
    if (confidence > 0.8) return 1.4
    if (confidence > 0.6) return 1.1
    return 0.85
}

// ── Tooltip component ─────────────────────────────────────────────────────────

function DetectionTooltip({ det, x, y, visible, onClose, onSuppress }) {
    if (!det) return null
    const p   = det.properties || {}
    const cfg = DET_CONFIG[p.detection_type] || { color: "#8E8E93", label: p.detection_type, icon: "📍" }
    const sevColor = SEV_COLOR[p.claude_severity] || "#8E8E93"

    return createPortal(
        <div
            style={{
                position: "fixed", left: x, top: y,
                width: 300,
                background: "rgba(8,16,32,0.93)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 10,
                overflow: "hidden",
                zIndex: 9100,
                boxShadow: "0 8px 28px rgba(0,0,0,0.65)",
                fontFamily: "Inter, system-ui, sans-serif",
                color: "#fff",
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? "auto" : "none",
                transition: "left 0.05s, top 0.05s, opacity 0.18s",
            }}
            onClick={e => e.stopPropagation()}
        >
            {/* Header bar */}
            <div style={{
                background: `rgba(${hexToRgb(cfg.color)},0.15)`,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding: "10px 12px 8px",
                display: "flex", alignItems: "center", gap: 8,
            }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
                        {cfg.label}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                        {p.detection_id} · {p.change_type}
                    </div>
                </div>
                {p.claude_severity && (
                    <span style={{
                        padding: "2px 7px", borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                        background: `rgba(${hexToRgb(sevColor)},0.18)`,
                        border: `1px solid rgba(${hexToRgb(sevColor)},0.4)`,
                        color: sevColor,
                    }}>
                        {p.claude_severity}
                    </span>
                )}
                <button onClick={onClose} style={{
                    background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                    cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 0 0 4px",
                }}>×</button>
            </div>

            <div style={{ padding: "10px 12px" }}>
                {/* Vision analysis */}
                {p.claude_vision_analysis && (
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>
                        {p.claude_vision_analysis}
                    </div>
                )}

                {/* Threat assessment */}
                {p.claude_threat_assessment && (
                    <div style={{
                        fontSize: 10, fontStyle: "italic",
                        color: "rgba(255,255,255,0.5)", marginBottom: 10,
                        borderLeft: `2px solid ${cfg.color}`, paddingLeft: 8,
                    }}>
                        {p.claude_threat_assessment}
                    </div>
                )}

                {/* Meta rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {p.nearest_asset_name && (
                        <MetaRow label="Nearest asset">
                            {p.nearest_asset_name}
                            {p.nearest_asset_distance_km != null &&
                                ` (${p.nearest_asset_distance_km.toFixed(1)} km)`}
                        </MetaRow>
                    )}
                    {p.in_strategic_zone && (
                        <MetaRow label="Strategic zone">{p.in_strategic_zone}</MetaRow>
                    )}
                    <MetaRow label="Coordinates">
                        {p.centroid_lat?.toFixed(4)}N {p.centroid_lon?.toFixed(4)}E
                    </MetaRow>
                    <MetaRow label="Confidence">
                        {(p.confidence * 100).toFixed(0)}%
                        {p.yolo_confirmed && " · YOLO confirmed"}
                    </MetaRow>
                    {p.image_date && (
                        <MetaRow label="Image date">
                            {p.image_date.slice(0, 10)}
                            {p.baseline_date && ` vs ${p.baseline_date.slice(0, 10)}`}
                        </MetaRow>
                    )}
                </div>

                {/* Suppress button */}
                <button
                    onClick={() => onSuppress(p.detection_id)}
                    style={{
                        marginTop: 10, width: "100%", padding: "6px 0",
                        borderRadius: 6, background: "rgba(255,59,48,0.1)",
                        border: "1px solid rgba(255,59,48,0.25)",
                        color: "#FF3B30", fontSize: 11, cursor: "pointer",
                        fontFamily: "inherit",
                    }}
                >
                    Suppress Detection
                </button>
            </div>
        </div>,
        document.body,
    )
}

function MetaRow({ label, children }) {
    return (
        <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
            <span style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0, minWidth: 80 }}>{label}</span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>{children}</span>
        </div>
    )
}

// ── Main layer ────────────────────────────────────────────────────────────────

export default function GlobeRegionalScanLayer({ enabled }) {
    const { viewer }             = useCesium()
    const [detections, setDets]  = useState([])
    const [jobId, setJobId]      = useState(null)
    const [selDet, setSelDet]    = useState(null)
    const [tooltipPos, setTPos]  = useState({ x: 0, y: 0 })
    const [tooltipVis, setTVis]  = useState(false)
    const centroidRef            = useRef(null)

    // Fetch latest scan + detections on mount / enable
    useEffect(() => {
        if (!enabled) return
        fetch(`${API_BASE}/api/regional-scans/latest?region_name=UAE`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                const jid = d?.job?.job_id
                if (!jid) return
                setJobId(jid)
                return fetch(`${API_BASE}/api/regional-scans/${jid}/detections`)
                    .then(r => r.ok ? r.json() : null)
                    .then(g => setDets(g?.features || []))
            })
            .catch(() => {})
    }, [enabled])

    // Track selected detection centroid for tooltip repositioning
    useEffect(() => {
        if (!viewer || !selDet) return
        const scene   = viewer.scene
        const handler = () => {
            const c = centroidRef.current
            if (!c) return
            const sp = SceneTransforms.worldToWindowCoordinates(scene, c)
            const vw = window.innerWidth, vh = window.innerHeight
            if (sp && sp.x > 0 && sp.x < vw && sp.y > 0 && sp.y < vh) {
                setTPos(clamp(sp.x + 18, sp.y - 140))
                setTVis(true)
            } else {
                setTVis(false)
            }
        }
        const remove = scene.postRender.addEventListener(handler)
        return () => { remove() }
    }, [viewer, selDet])

    const handleClick = useCallback((feat, clickX, clickY) => {
        const p = feat.properties || {}
        if (selDet?.properties?.detection_id === p.detection_id) {
            setSelDet(null); centroidRef.current = null; setTVis(false)
            return
        }
        centroidRef.current = Cartesian3.fromDegrees(p.centroid_lon, p.centroid_lat)
        setSelDet(feat)
        setTPos(clamp(clickX + 18, clickY - 140))
        setTVis(true)
    }, [selDet])

    const handleClose = useCallback(() => {
        setSelDet(null); centroidRef.current = null; setTVis(false)
    }, [])

    const handleSuppress = useCallback(async (detectionId) => {
        try {
            await fetch(`${API_BASE}/api/regional-scans/detections/${detectionId}/suppress`, {
                method: "DELETE",
            })
            setDets(prev => prev.filter(f => f.properties?.detection_id !== detectionId))
            handleClose()
        } catch (e) {
            console.error("[GlobeRegionalScanLayer] suppress error:", e)
        }
    }, [handleClose])

    if (!enabled || !detections.length) return null

    return (
        <>
            {detections.map(feat => {
                const p      = feat.properties || {}
                const color  = detColor(p.detection_type)
                const scale  = confScale(p.confidence || 0)
                const isSel  = selDet?.properties?.detection_id === p.detection_id
                const cesCol = Color.fromCssColorString(color)
                const size   = 9 * scale * (isSel ? 1.3 : 1)

                return (
                    <Entity
                        key={p.detection_id}
                        id={`rsdet-${p.detection_id}`}
                        position={Cartesian3.fromDegrees(p.centroid_lon, p.centroid_lat, 0)}
                        point={{
                            pixelSize:               size,
                            color:                   cesCol.withAlpha(isSel ? 1.0 : 0.82),
                            outlineColor:            Color.WHITE.withAlpha(isSel ? 0.9 : 0.5),
                            outlineWidth:            isSel ? 2.5 : 1.5,
                            scaleByDistance:         new NearFarScalar(50_000, 1.2, 3_000_000, 0.5),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 4_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        }}
                        label={{
                            text:               DET_CONFIG[p.detection_type]?.icon || "●",
                            font:               "12px sans-serif",
                            fillColor:          cesCol,
                            outlineColor:       Color.BLACK.withAlpha(0.5),
                            outlineWidth:       2,
                            style:              2,
                            pixelOffset:        { x: 0, y: -16 },
                            scaleByDistance:    new NearFarScalar(100_000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            showBackground:     false,
                        }}
                        onClick={mv => handleClick(feat, mv?.position?.x ?? window.innerWidth / 2, mv?.position?.y ?? window.innerHeight / 2)}
                    />
                )
            })}

            <DetectionTooltip
                det={selDet}
                x={tooltipPos.x}
                y={tooltipPos.y}
                visible={tooltipVis}
                onClose={handleClose}
                onSuppress={handleSuppress}
            />
        </>
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    const h = (hex || "#888888").replace("#", "")
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

function clamp(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight
    return {
        x: Math.min(Math.max(x, 10), vw - 310),
        y: Math.min(Math.max(y, 10), vh - 380),
    }
}
