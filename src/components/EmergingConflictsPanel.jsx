import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"

const DRIVER_COLORS = {
    fusion_events:       "#A78BFA",
    rule_triggers:       "#F87171",
    satellite_detections:"#60A5FA",
    news_events:         "#34D399",
    surge_events:        "#FBBF24",
    ontology_links:      "#94A3B8",
    forge_alerts:        "#FB923C",
}

const DRIVER_LABELS = {
    fusion_events:       "FUSION",
    rule_triggers:       "AIS",
    satellite_detections:"SENTINEL",
    news_events:         "NEWS",
    surge_events:        "SURGE",
    ontology_links:      "ONTOLOGY",
    forge_alerts:        "FORGE",
}

function DriverPill({ name, value }) {
    const color = DRIVER_COLORS[name] || "#94A3B8"
    const label = DRIVER_LABELS[name] || name.toUpperCase()
    return (
        <span style={{
            display:       "inline-flex",
            alignItems:    "center",
            gap:           3,
            padding:       "2px 7px",
            borderRadius:  10,
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: "0.04em",
            backgroundColor: color + "22",
            color,
            border:        `1px solid ${color}44`,
            marginRight:   3,
            marginBottom:  3,
        }}>
            {label}{value > 1 ? ` ×${value}` : ""}
        </span>
    )
}

function ScoreBar({ score, level }) {
    const barColor = level === "CRITICAL" ? "#EF4444"
                   : level === "HIGH"     ? "#F59E0B"
                   : level === "MEDIUM"   ? "#3B82F6"
                   : "#22C55E"
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <div style={{ flex: 1, height: 4, background: "#1E293B", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${score}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.6s ease" }} />
            </div>
            <span style={{ fontSize: 10, color: barColor, fontWeight: 700, minWidth: 28, textAlign: "right" }}>
                {score}
            </span>
        </div>
    )
}

function RegionCard({ region, showBadge }) {
    const drivers = region.contributing_signals || []
    const driverCounts = {}
    drivers.forEach(d => { driverCounts[d] = (driverCounts[d] || 0) + 1 })

    const badgeText  = region.is_escalating ? "ESCALATING" : region.is_emerging ? "EMERGING" : null
    const badgeColor = region.is_escalating ? "#EF4444"    : "#F59E0B"
    const delta      = region.trend_delta
    const trendIcon  = region.trend === "escalating"    ? "↑"
                     : region.trend === "de-escalating" ? "↓"
                     : "→"
    const trendColor = region.trend === "escalating"    ? "#EF4444"
                     : region.trend === "de-escalating" ? "#22C55E"
                     : "#94A3B8"

    return (
        <div style={{
            background:   "#0F1721",
            borderRadius: 8,
            padding:      "10px 12px",
            marginBottom: 6,
            border:       `1px solid ${region.is_escalating ? "#EF444433" : region.is_emerging ? "#F59E0B33" : "#1E293B"}`,
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {badgeText && showBadge && (
                            <span style={{
                                fontSize: 8, fontWeight: 800, letterSpacing: "0.08em",
                                color: badgeColor, background: badgeColor + "22",
                                border: `1px solid ${badgeColor}44`,
                                padding: "1px 5px", borderRadius: 4,
                            }}>
                                {badgeText}
                            </span>
                        )}
                        <span style={{ color: "#E2E8F0", fontWeight: 600, fontSize: 12 }}>
                            {region.region_name}
                        </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                        <span style={{ color: "#64748B", fontSize: 10 }}>
                            {region.threat_level}
                        </span>
                        <span style={{ color: trendColor, fontSize: 11, fontWeight: 700 }}>
                            {trendIcon}
                            {delta != null && Math.abs(delta) >= 1 && (
                                <span style={{ fontSize: 9, marginLeft: 2 }}>
                                    {delta > 0 ? "+" : ""}{delta}
                                </span>
                            )}
                        </span>
                        {region.signal_count_24h > 0 && (
                            <span style={{ color: "#64748B", fontSize: 9 }}>
                                {region.signal_count_24h} signals/24h
                            </span>
                        )}
                    </div>
                </div>
            </div>
            <ScoreBar score={region.threat_score ?? region.score ?? 0} level={region.threat_level} />
            {drivers.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap" }}>
                    {Object.entries(driverCounts).map(([name, cnt]) => (
                        <DriverPill key={name} name={name} value={cnt} />
                    ))}
                </div>
            )}
            {region.narrative && (
                <p style={{ color: "#64748B", fontSize: 10, margin: "6px 0 0", lineHeight: 1.45 }}>
                    {region.narrative}
                </p>
            )}
        </div>
    )
}

export default function EmergingConflictsPanel({ onClose }) {
    const [data,    setData]    = useState([])
    const [loading, setLoading] = useState(true)
    const [error,   setError]   = useState(null)

    const load = useCallback(() => {
        setLoading(true)
        fetch(`${API_BASE}/api/analytics/threat-matrix`)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(d => {
                const arr = Array.isArray(d) ? d : []
                arr.sort((a, b) => (b.threat_score ?? b.score ?? 0) - (a.threat_score ?? a.score ?? 0))
                setData(arr)
                setError(null)
            })
            .catch(e => setError(`Failed to load: ${e}`))
            .finally(() => setLoading(false))
    }, [])

    useEffect(() => {
        load()
        const iv = setInterval(load, 300_000)  // refresh every 5 min
        return () => clearInterval(iv)
    }, [load])

    const escalating = data.filter(r => r.is_escalating)
    const emerging   = data.filter(r => r.is_emerging && !r.is_escalating)
    const elevated   = data.filter(r => !r.is_escalating && !r.is_emerging && (r.threat_score ?? r.score ?? 0) >= 25)
    const sections   = [
        { label: "ESCALATING",       color: "#EF4444", items: escalating },
        { label: "EMERGING",         color: "#F59E0B", items: emerging   },
        { label: "ELEVATED",         color: "#3B82F6", items: elevated   },
    ]

    return (
        <div style={{
            display:       "flex",
            flexDirection: "column",
            width:         320,
            height:        "100%",
            background:    "#060D18",
            borderLeft:    "1px solid #1E293B",
            fontFamily:    "system-ui, sans-serif",
        }}>
            {/* Header */}
            <div style={{
                padding:        "12px 14px 10px",
                borderBottom:   "1px solid #1E293B",
                display:        "flex",
                justifyContent: "space-between",
                alignItems:     "center",
                flexShrink:     0,
            }}>
                <div>
                    <div style={{ color: "#E2E8F0", fontWeight: 700, fontSize: 13, letterSpacing: "0.03em" }}>
                        EMERGING CONFLICTS
                    </div>
                    <div style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
                        Threat matrix · {data.length} regions
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button
                        onClick={load}
                        style={{ background: "none", border: "1px solid #1E293B", color: "#94A3B8", cursor: "pointer", borderRadius: 5, padding: "3px 8px", fontSize: 10 }}
                    >
                        ↺
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
                {loading && (
                    <p style={{ color: "#64748B", fontSize: 11, textAlign: "center", marginTop: 40 }}>
                        Loading threat matrix…
                    </p>
                )}
                {error && (
                    <p style={{ color: "#EF4444", fontSize: 11, textAlign: "center", marginTop: 20 }}>
                        {error}
                    </p>
                )}
                {!loading && !error && sections.map(sec => {
                    if (!sec.items.length) return null
                    return (
                        <div key={sec.label} style={{ marginBottom: 16 }}>
                            <div style={{
                                display:       "flex",
                                alignItems:    "center",
                                gap:           6,
                                marginBottom:  8,
                            }}>
                                <div style={{ width: 3, height: 12, background: sec.color, borderRadius: 2 }} />
                                <span style={{ color: sec.color, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em" }}>
                                    {sec.label}
                                </span>
                                <span style={{ color: "#334155", fontSize: 9 }}>
                                    {sec.items.length} region{sec.items.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            {sec.items.map(r => (
                                <RegionCard
                                    key={r.region_name}
                                    region={r}
                                    showBadge={sec.label !== "ELEVATED"}
                                />
                            ))}
                        </div>
                    )
                })}
                {!loading && !error && !escalating.length && !emerging.length && !elevated.length && (
                    <p style={{ color: "#64748B", fontSize: 11, textAlign: "center", marginTop: 40 }}>
                        No elevated threat regions detected.
                    </p>
                )}
            </div>
        </div>
    )
}
