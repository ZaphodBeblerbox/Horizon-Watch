import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Entity } from "resium"
import { useCesium } from "resium"
import {
    Cartesian3, Color, Rectangle,
    NearFarScalar, DistanceDisplayCondition,
    SceneTransforms, SingleTileImageryProvider,
    Rectangle as CesiumRectangle,
} from "cesium"
import API_BASE from "../apiBase.js"

// ── Detection type config ─────────────────────────────────────────────────────

const DET_CONFIG = {
    FIRE:                   { color: "#FF3B30", label: "Fire",                  icon: "🔥", category: "environmental" },
    SMOKE:                  { color: "#8E8E93", label: "Smoke Plume",           icon: "💨", category: "environmental" },
    BURN_SCAR:              { color: "#FF6B35", label: "Burn Scar",             icon: "🔶", category: "environmental" },
    VEGETATION_LOSS:        { color: "#34C759", label: "Vegetation Loss",       icon: "🌿", category: "environmental" },
    WATER_BODY_CHANGE:      { color: "#34AADC", label: "Water Body Change",     icon: "💧", category: "environmental" },
    RUNWAY_CHANGE:          { color: "#5856D6", label: "Runway Change",         icon: "✈",  category: "aviation" },
    PORT_CHANGE:            { color: "#34AADC", label: "Port / Vessel",         icon: "⚓",  category: "maritime" },
    ENERGY_CHANGE:          { color: "#FFCC00", label: "Energy Infra Change",   icon: "⚡",  category: "energy" },
    UNKNOWN_COMPOUND:       { color: "#FF3B30", label: "Unknown Compound",      icon: "🔴",  category: "military" },
    VEHICLE_CLUSTER:        { color: "#FF9500", label: "Vehicle Cluster",       icon: "🚗",  category: "military" },
    EXCAVATION:             { color: "#8B6914", label: "Excavation",            icon: "🟫",  category: "infrastructure" },
    INFRASTRUCTURE_CHANGE:  { color: "#FF9500", label: "Infrastructure Change", icon: "🏗",  category: "infrastructure" },
    MILITARY_ACTIVITY:      { color: "#FF3B30", label: "Military Activity",     icon: "🎯",  category: "military" },
}

const FILTER_CATEGORIES = [
    { key: "environmental", label: "Environmental", icon: "🌿", color: "#34C759" },
    { key: "military",      label: "Military",      icon: "🎯", color: "#FF3B30" },
    { key: "maritime",      label: "Maritime",      icon: "⚓",  color: "#34AADC" },
    { key: "aviation",      label: "Aviation",      icon: "✈",  color: "#5856D6" },
    { key: "energy",        label: "Energy",        icon: "⚡",  color: "#FFCC00" },
    { key: "infrastructure",label: "Infrastructure",icon: "🏗",  color: "#FF9500" },
]

const ALL_CATEGORIES = new Set(FILTER_CATEGORIES.map(c => c.key))

const SEV_COLOR = { critical: "#FF3B30", high: "#FF9500", medium: "#FFCC00", info: "#34C759" }

const DETECTION_EXPLANATIONS = {
    FIRE:                   "Active fire detected in satellite imagery. High spectral signature consistent with combustion. Requires immediate assessment.",
    SMOKE:                  "Smoke plume detected. May indicate fire, industrial incident, or controlled burn. Monitor for escalation.",
    BURN_SCAR:              "Area of recent burning detected — darker spectral signature compared to baseline imagery from 30+ days ago.",
    VEGETATION_LOSS:        "Significant reduction in NDVI detected vs baseline. May indicate deforestation, crop failure, or land clearance.",
    WATER_BODY_CHANGE:      "Change in surface water extent detected. May indicate dam construction, flood, drought, or coastal modification.",
    RUNWAY_CHANGE:          "Change detected at or near an airfield. May indicate new construction, expansion, or damage.",
    PORT_CHANGE:            "Change detected at or near a maritime port. May indicate new berths, vessel activity, or construction.",
    ENERGY_CHANGE:          "Change detected near energy infrastructure (refinery, pipeline, storage). May indicate expansion, damage, or new construction.",
    UNKNOWN_COMPOUND:       "New enclosed structure detected with no matching infrastructure record. Construction pattern and location require assessment.",
    VEHICLE_CLUSTER:        "Unusual concentration of vehicles detected. May indicate military staging, logistics, or large-scale operations.",
    EXCAVATION:             "Large-scale ground disturbance detected. Consistent with excavation, earthworks, or site preparation preceding construction.",
    INFRASTRUCTURE_CHANGE:  "Change in built-up area or infrastructure detected near a known strategic asset.",
    MILITARY_ACTIVITY:      "Change pattern near known or suspected military facility. May indicate new construction, equipment, or operational activity.",
    default:                "Spectral or YOLO change detected in satellite imagery.",
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function DetectionTooltip({ det, x, y, visible, onClose, onSuppress }) {
    if (!det) return null
    const p   = det.properties || {}
    const cfg = DET_CONFIG[p.detection_type] || { color: "#8E8E93", label: p.detection_type || "Detection", icon: "📍" }
    const sevColor = SEV_COLOR[p.claude_severity] || "#8E8E93"
    const srcLabel = p.detection_source
        ? p.detection_source.replace("yolo_", "YOLO ").replace("spectral", "Spectral")
        : "Spectral"

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
            {/* Header */}
            <div style={{
                background: `rgba(${hexToRgb(cfg.color)},0.15)`,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                padding: "10px 12px 8px",
                display: "flex", alignItems: "center", gap: 8,
            }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                        {p.detection_id} · {srcLabel}
                        {p.class_name && ` · ${p.class_name}`}
                    </div>
                </div>
                {p.claude_severity && (
                    <span style={{
                        padding: "2px 7px", borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                        background: `rgba(${hexToRgb(sevColor)},0.18)`,
                        border: `1px solid rgba(${hexToRgb(sevColor)},0.4)`,
                        color: sevColor,
                    }}>{p.claude_severity}</span>
                )}
                <button onClick={onClose} style={{
                    background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                    cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 0 0 4px",
                }}>×</button>
            </div>

            <div style={{ padding: "10px 12px" }}>
                {/* What this means */}
                <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>
                        What this means
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>
                        {DETECTION_EXPLANATIONS[p.detection_type] || DETECTION_EXPLANATIONS.default}
                    </div>
                </div>

                {/* Vision analysis */}
                {p.claude_vision_analysis && (
                    <div style={{ fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.65)", marginBottom: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                        {p.claude_vision_analysis}
                    </div>
                )}

                {/* Confidence + importance */}
                {p.confidence != null && (() => {
                    const pct = Math.round(p.confidence * 100)
                    const col = pct >= 80 ? "#34C759" : pct >= 60 ? "#FF9500" : "#FF3B30"
                    return (
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 3 }}>
                                <span>Confidence</span>
                                <span style={{ fontWeight: 600, color: col }}>{pct}%</span>
                            </div>
                            <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: col, borderRadius: 2, transition: "width 0.4s ease" }} />
                            </div>
                        </div>
                    )
                })()}

                {/* Meta rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                    {p.nearest_asset_name && (
                        <MetaRow label="Nearest asset">
                            {p.nearest_asset_name}
                            {p.nearest_asset_distance_km != null && ` (${p.nearest_asset_distance_km.toFixed(1)} km)`}
                        </MetaRow>
                    )}
                    {p.in_strategic_zone && (
                        <MetaRow label="Strategic zone">{p.in_strategic_zone}</MetaRow>
                    )}
                    {p.importance != null && (
                        <MetaRow label="Importance">{"★".repeat(p.importance)}{"☆".repeat(5 - p.importance)}</MetaRow>
                    )}
                    <MetaRow label="Coordinates">
                        {p.centroid_lat?.toFixed(4)}N {p.centroid_lon?.toFixed(4)}E
                    </MetaRow>
                    {p.is_change != null && (
                        <MetaRow label="Type">{p.is_change ? "Change vs baseline" : "New detection"}{p.baseline_available ? "" : " (no baseline)"}</MetaRow>
                    )}
                </div>

                {/* Source footer */}
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 8, letterSpacing: "0.05em" }}>
                    Source: Sentinel-2 (10m resolution) · {srcLabel}
                </div>

                <button
                    onClick={() => onSuppress(p.detection_id)}
                    style={{
                        width: "100%", padding: "6px 0",
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
            <span style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0, minWidth: 90 }}>{label}</span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>{children}</span>
        </div>
    )
}

// ── Filter panel ──────────────────────────────────────────────────────────────

function FilterPanel({ activeFilters, onToggle, detections }) {
    const counts = {}
    detections.forEach(f => {
        const cat = f.properties?.category || DET_CONFIG[f.properties?.detection_type]?.category || "infrastructure"
        counts[cat] = (counts[cat] || 0) + 1
    })
    return (
        <div style={{
            position: "fixed", bottom: 130, right: 12,
            background: "rgba(8,16,32,0.88)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, padding: "8px 10px",
            zIndex: 8100, fontFamily: "Inter, system-ui, sans-serif",
            minWidth: 148,
        }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Sentinel Filters
            </div>
            {FILTER_CATEGORIES.map(cat => {
                const active = activeFilters.has(cat.key)
                const n = counts[cat.key] || 0
                return (
                    <button
                        key={cat.key}
                        onClick={() => onToggle(cat.key)}
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            width: "100%", padding: "4px 8px", marginBottom: 3,
                            background: active ? cat.color + "22" : "transparent",
                            border: `1px solid ${active ? cat.color + "55" : "rgba(255,255,255,0.07)"}`,
                            borderRadius: 5,
                            color: active ? cat.color : "rgba(255,255,255,0.35)",
                            cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400,
                            textAlign: "left", gap: 6,
                        }}
                    >
                        <span>{cat.icon} {cat.label}</span>
                        {n > 0 && (
                            <span style={{
                                background: active ? cat.color + "33" : "rgba(255,255,255,0.07)",
                                color: active ? cat.color : "rgba(255,255,255,0.4)",
                                borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700,
                            }}>{n}</span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

// ── Main layer ────────────────────────────────────────────────────────────────

export default function GlobeRegionalScanLayer({ enabled }) {
    const { viewer }              = useCesium()
    const [detections, setDets]   = useState([])
    const [tiles, setTiles]       = useState([])
    const [selDet, setSelDet]     = useState(null)
    const [tooltipPos, setTPos]   = useState({ x: 0, y: 0 })
    const [tooltipVis, setTVis]   = useState(false)
    const [activeFilters, setFilters] = useState(new Set(ALL_CATEGORIES))
    const centroidRef             = useRef(null)
    const knownIdsRef             = useRef(new Set())
    const imageryLayersRef        = useRef([])

    // Fetch latest detections + tiles
    useEffect(() => {
        if (!enabled) return
        fetch(`${API_BASE}/api/regional-scans/latest/detections`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                const feats = d.features || []
                feats.forEach(f => knownIdsRef.current.add(f.properties?.detection_id))
                setDets(feats)
            })
            .catch(() => {})

        fetch(`${API_BASE}/api/regional-scans/latest/tiles`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.tiles) setTiles(d.tiles) })
            .catch(() => {})
    }, [enabled])

    // Add Sentinel tile imagery layers via viewer.imageryLayers
    useEffect(() => {
        if (!viewer || !enabled) return
        // Remove old layers
        imageryLayersRef.current.forEach(l => {
            try { viewer.imageryLayers.remove(l) } catch { /* ok */ }
        })
        imageryLayersRef.current = []

        const tilesWithImage = tiles.filter(t => t.has_image && t.image_url)
        tilesWithImage.forEach(t => {
            try {
                const rect = CesiumRectangle.fromDegrees(t.min_lon, t.min_lat, t.max_lon, t.max_lat)
                const provider = new SingleTileImageryProvider({
                    url:       `${API_BASE}${t.image_url}`,
                    rectangle: rect,
                })
                const layer = viewer.imageryLayers.addImageryProvider(provider)
                layer.alpha = 0.7
                imageryLayersRef.current.push(layer)
            } catch (e) {
                // SingleTileImageryProvider may be async in newer Cesium
                try {
                    SingleTileImageryProvider.fromUrl(`${API_BASE}${t.image_url}`, {
                        rectangle: CesiumRectangle.fromDegrees(t.min_lon, t.min_lat, t.max_lon, t.max_lat),
                    }).then(provider => {
                        const layer = viewer.imageryLayers.addImageryProvider(provider)
                        layer.alpha = 0.7
                        imageryLayersRef.current.push(layer)
                    }).catch(() => {})
                } catch { /* skip */ }
            }
        })

        return () => {
            imageryLayersRef.current.forEach(l => {
                try { viewer.imageryLayers.remove(l) } catch { /* ok */ }
            })
            imageryLayersRef.current = []
        }
    }, [viewer, tiles, enabled])

    // Clear on disable
    useEffect(() => {
        if (!enabled) {
            setDets([]); setTiles([]); setSelDet(null); setTVis(false)
            knownIdsRef.current = new Set()
        }
    }, [enabled])

    // Track selected detection for tooltip repositioning on camera move
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
            await fetch(`${API_BASE}/api/regional-scans/detections/${detectionId}/suppress`, { method: "DELETE" })
            setDets(prev => prev.filter(f => f.properties?.detection_id !== detectionId))
            knownIdsRef.current.delete(detectionId)
            handleClose()
        } catch (e) {
            console.error("[GlobeRegionalScanLayer] suppress error:", e)
        }
    }, [handleClose])

    const toggleFilter = useCallback((key) => {
        setFilters(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }, [])

    if (!enabled) return null

    // Apply category filter
    const visibleDets = detections.filter(f => {
        const p   = f.properties || {}
        const cat = p.category || DET_CONFIG[p.detection_type]?.category || "infrastructure"
        return activeFilters.has(cat)
    })

    return (
        <>
            {/* Tile outlines — show scan coverage */}
            {tiles.map((t, i) => {
                const scanned = t.status === "fetched"
                const hasAlerts = (t.detections_count || 0) > 0
                const outlineColor = hasAlerts ? "#FF9500" : scanned ? "#34C759" : "#475569"
                const fillAlpha = hasAlerts ? 0.06 : scanned ? 0.02 : 0.0
                return (
                    <Entity
                        key={`tile-${t.tile_id || i}`}
                        rectangle={{
                            coordinates: Rectangle.fromDegrees(t.min_lon, t.min_lat, t.max_lon, t.max_lat),
                            material: Color.fromCssColorString(outlineColor).withAlpha(fillAlpha),
                            outline: true,
                            outlineColor: Color.fromCssColorString(outlineColor).withAlpha(scanned ? 0.25 : 0.10),
                            outlineWidth: 1,
                            height: 0,
                        }}
                    />
                )
            })}

            {/* Detection bounding boxes */}
            {visibleDets.map(feat => {
                const p   = feat.properties || {}
                const cfg = DET_CONFIG[p.detection_type] || { color: "#8E8E93" }
                const hasBbox = p.bbox_min_lon != null && p.bbox_max_lon != null
                    && Math.abs(p.bbox_max_lon - p.bbox_min_lon) < 0.45  // skip tile-wide bboxes
                if (!hasBbox) return null
                const isSel = selDet?.properties?.detection_id === p.detection_id
                return (
                    <Entity
                        key={`bbox-${p.detection_id}`}
                        rectangle={{
                            coordinates: Rectangle.fromDegrees(p.bbox_min_lon, p.bbox_min_lat, p.bbox_max_lon, p.bbox_max_lat),
                            material: Color.fromCssColorString(cfg.color).withAlpha(isSel ? 0.18 : 0.08),
                            outline: true,
                            outlineColor: Color.fromCssColorString(cfg.color).withAlpha(isSel ? 0.9 : 0.5),
                            outlineWidth: isSel ? 2 : 1,
                            height: 10,
                        }}
                    />
                )
            })}

            {/* Detection points */}
            {visibleDets.map(feat => {
                const p      = feat.properties || {}
                const cfg    = DET_CONFIG[p.detection_type] || { color: "#8E8E93", icon: "●" }
                const isSel  = selDet?.properties?.detection_id === p.detection_id
                const cesCol = Color.fromCssColorString(cfg.color)
                const scale  = p.confidence > 0.8 ? 1.4 : p.confidence > 0.6 ? 1.1 : 0.85
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
                            text:               cfg.icon || "●",
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

            <FilterPanel
                activeFilters={activeFilters}
                onToggle={toggleFilter}
                detections={detections}
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
        y: Math.min(Math.max(y, 10), vh - 400),
    }
}
