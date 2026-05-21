const SENTINEL_LABELS = {
    FIRE:                   { label: "Active Fire",             icon: "🔥", color: "#ef4444", category: "Environmental", explanation: "Thermal anomaly detected via Sentinel-2 true-colour and SWIR bands. High red-channel intensity with low green/blue indicates active combustion." },
    SMOKE:                  { label: "Smoke Plume",             icon: "🌫️", color: "#94a3b8", category: "Environmental", explanation: "Near-grey mid-brightness pixel cluster consistent with smoke. May indicate industrial activity, fire, or controlled burns." },
    BURN_SCAR:              { label: "Burn Scar",               icon: "🟫", color: "#b45309", category: "Environmental", explanation: "Significant darkening vs. baseline in vegetation channels indicates recent fire damage. Red-channel drop with low post-fire reflectance." },
    VEGETATION_LOSS:        { label: "Vegetation Loss",         icon: "🌿", color: "#16a34a", category: "Environmental", explanation: "NDVI decline exceeding 0.15 between current and 30-day baseline imagery. May indicate deforestation, drought, or land clearing." },
    INFRASTRUCTURE_CHANGE:  { label: "Infrastructure Change",   icon: "🏗️", color: "#64748b", category: "Infrastructure", explanation: "Significant spectral change vs. baseline that co-locates with known infrastructure assets. May indicate construction, demolition, or damage." },
    CONSTRUCTION:           { label: "Construction Activity",   icon: "🏗️", color: "#f59e0b", category: "Infrastructure", explanation: "Elevated NDBI (built-up index) change vs. baseline. Bright SWIR return in previously low-NDBI areas suggests new built surface." },
    EXCAVATION:             { label: "Excavation / Earthworks", icon: "🪨", color: "#d97706", category: "Infrastructure", explanation: "Large-scale bare-earth exposure vs. baseline, often rectangular or linear. May indicate tunnelling, quarrying, or foundation works." },
    RUNWAY_CHANGE:          { label: "Runway / Airfield Change",icon: "✈️", color: "#a78bfa", category: "Aviation",       explanation: "YOLO aircraft-detection model flagged a structured surface or object consistent with aircraft or airfield activity." },
    PORT_CHANGE:            { label: "Vessel / Port Activity",  icon: "🚢", color: "#0ea5e9", category: "Maritime",      explanation: "YOLO vessel-detection model identified hull shapes on water surface. Count or position may differ from baseline." },
    ENERGY_CHANGE:          { label: "Energy Infrastructure",   icon: "⚡", color: "#fbbf24", category: "Energy",        explanation: "YOLO model flagged structures consistent with oil storage tanks, refineries, or energy facilities." },
    MILITARY_ACTIVITY:      { label: "Military Activity",       icon: "🎖️", color: "#f87171", category: "Military",      explanation: "YOLO defence model detected vehicle or equipment signatures consistent with military hardware on a land surface." },
    VEHICLE_CLUSTER:        { label: "Vehicle Cluster",         icon: "🚗", color: "#f87171", category: "Military",      explanation: "Unusual density of vehicle-sized objects. May indicate staging, convoy, or logistical activity." },
    UNKNOWN_COMPOUND:       { label: "Unknown Compound",        icon: "🔲", color: "#f87171", category: "Military",      explanation: "Structured enclosure with no matching infrastructure label. Geometry and isolation are consistent with a controlled facility." },
    CHANGE:                 { label: "Spectral Change",         icon: "🔄", color: "#818cf8", category: "General",       explanation: "Mean pixel difference vs. 30-day baseline exceeds detection threshold. Change is co-located with a strategic asset or zone." },
    WATER_BODY_CHANGE:      { label: "Water Body Change",       icon: "💧", color: "#38bdf8", category: "Environmental", explanation: "NDWI indicates a change in water surface extent vs. baseline. May indicate flooding, drought, or reservoir management." },
    WATER_BODY:             { label: "Water Body",              icon: "💧", color: "#34AADC", category: "Environmental", explanation: "Water body or wetland detected via NDWI index (> 0.1). No baseline required." },
    VEGETATION:             { label: "Vegetation",              icon: "🌿", color: "#30D158", category: "Environmental", explanation: "Vegetated area detected via NDVI index (> 0.2). Includes parks, farms, and natural vegetation." },
    INFRASTRUCTURE:         { label: "Built-up Infrastructure", icon: "🏙️", color: "#FF9500", category: "Infrastructure", explanation: "Built-up area detected via NDBI index (> 0.15). Includes buildings, roads, and urban surfaces." },
}

const SEV_COLORS = {
    critical: "#ef4444",
    high:     "#f97316",
    medium:   "#fbbf24",
    low:      "#60a5fa",
    info:     "#94a3b8",
}

function Stars({ n }) {
    return (
        <span style={{ color: "#fbbf24", fontSize: 10, letterSpacing: 1 }}>
            {"★".repeat(n)}{"☆".repeat(5 - n)}
        </span>
    )
}

export default function SentinelDetectionPopup({ data, onClose }) {
    const d = data || {}
    const label   = SENTINEL_LABELS[d.detection_type] || { label: d.detection_type || "Detection", icon: "📡", color: "#818cf8", category: "Satellite", explanation: "Satellite-derived change detection." }
    const sevColor = SEV_COLORS[d.claude_severity] || SEV_COLORS.medium

    const lat = d.centroid_lat ?? d.lat
    const lon = d.centroid_lon ?? d.lon
    const confidence = d.confidence != null ? Math.round(d.confidence * 100) : null
    const importance = d.importance ?? null
    const ts  = d.created_at ? new Date(d.created_at).toLocaleString() : null

    return (
        <div style={{ fontFamily: "system-ui, sans-serif" }}>

            {/* Header */}
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 5 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: label.color + "22", color: label.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            {label.category}
                        </span>
                        {d.claude_severity && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: sevColor + "22", color: sevColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                {d.claude_severity}
                            </span>
                        )}
                        {d.is_change && (
                            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>
                                change
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
                        {label.icon} {label.label}
                    </div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, padding: 0, flexShrink: 0 }}>✕</button>
            </div>

            {/* Explanation */}
            <div style={{ padding: "8px 12px 6px" }}>
                <div style={{ fontSize: 11, color: "rgba(203,213,225,0.75)", lineHeight: 1.55 }}>
                    {label.explanation}
                </div>
            </div>

            {/* Metrics row */}
            {(confidence != null || importance != null) && (
                <div style={{ padding: "4px 12px 6px", display: "flex", gap: 16, alignItems: "center" }}>
                    {confidence != null && (
                        <div>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>Confidence</div>
                            <div style={{ position: "relative", width: 80, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${confidence}%`, background: label.color, borderRadius: 2 }} />
                            </div>
                            <div style={{ fontSize: 10, color: label.color, marginTop: 2 }}>{confidence}%</div>
                        </div>
                    )}
                    {importance != null && (
                        <div>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>Importance</div>
                            <Stars n={importance} />
                        </div>
                    )}
                    {d.detection_source && (
                        <div>
                            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>Source</div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>{d.detection_source}</div>
                        </div>
                    )}
                </div>
            )}

            {/* AI analysis */}
            {(d.claude_vision_analysis || d.claude_analysis) && (
                <div style={{ margin: "0 12px 8px", padding: "8px 10px", background: "rgba(99,102,241,0.07)", borderRadius: 5, borderLeft: "2px solid rgba(99,102,241,0.4)" }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>AI Analysis</div>
                    <div style={{ fontSize: 11, color: "rgba(203,213,225,0.85)", lineHeight: 1.5 }}>
                        {d.claude_vision_analysis || d.claude_analysis}
                    </div>
                </div>
            )}

            {/* Nearest asset */}
            {d.nearest_asset_name && (
                <div style={{ margin: "0 12px 8px", padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 4, border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize: 9, color: "#475569", marginBottom: 3 }}>Nearest Asset</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {d.nearest_asset_name}
                        {d.nearest_asset_distance_km != null && (
                            <span style={{ color: "#475569", marginLeft: 6 }}>{d.nearest_asset_distance_km} km</span>
                        )}
                    </div>
                    {d.in_strategic_zone && (
                        <div style={{ fontSize: 9, color: "#f59e0b", marginTop: 3 }}>In strategic zone: {d.in_strategic_zone}</div>
                    )}
                </div>
            )}

            {/* Coordinates + timestamp */}
            <div style={{ padding: "4px 12px 10px", borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: 2 }}>
                {lat != null && lon != null && (
                    <div style={{ fontSize: 10, color: "#334155", marginBottom: 2 }}>
                        {Number(lat).toFixed(4)}°, {Number(lon).toFixed(4)}°
                    </div>
                )}
                {ts && (
                    <div style={{ fontSize: 10, color: "#334155" }}>{ts}</div>
                )}
                {d.baseline_available === false && (
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>No baseline available — absolute detection only</div>
                )}
            </div>
        </div>
    )
}
