// LayersPanel.jsx — Grouped layer toggle panel for Akili
// Purely controlled: all state owned by parent (MapPage)
import { useState, useEffect } from "react"
import BottomSheet from "./BottomSheet.jsx"

function Toggle({ value, onChange }) {
    return (
        <button
            onClick={(e) => {
                e.stopPropagation()
                onChange(!value)
            }}
            style={{
                width:        44,
                height:       24,
                borderRadius: 12,
                border:       "none",
                background:   value ? "var(--akili-accent)" : "#2d3748",
                cursor:       "pointer",
                position:     "relative",
                transition:   "background 0.2s",
                flexShrink:   0,
                minHeight:    "unset",   // override mobile CSS min-height: 44px
                padding:      0,
            }}
        >
            <span style={{
                position:     "absolute",
                top:          2,
                left:         value ? 22 : 2,
                width:        20,
                height:       20,
                borderRadius: "50%",
                background:   "#fff",
                transition:   "left 0.2s",
                display:      "block",
                boxShadow:    "0 1px 3px rgba(0,0,0,0.3)",
            }} />
        </button>
    )
}

const STATUS_COLOR = {
    ok:       "#22c55e",
    degraded: "#f97316",
    pending:  "#6b7280",
    error:    "#ef4444",
}

function StatusDot({ status }) {
    if (!status) return null
    return (
        <span style={{
            width:        8,
            height:       8,
            borderRadius: "50%",
            background:   STATUS_COLOR[status] || STATUS_COLOR.pending,
            display:      "inline-block",
            flexShrink:   0,
            marginRight:  8,
        }} />
    )
}

function LayerRow({ label, hint, statusKey, sourceStatus, toggled, onToggle, badge, loading, isManual }) {
    const status = sourceStatus && statusKey ? sourceStatus[statusKey] : null
    return (
        <div
            style={{
                display:    "flex",
                alignItems: "center",
                padding:    "8px 0",
                cursor:     "pointer",
            }}
            onClick={() => onToggle()}
        >
            <StatusDot status={status} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize:   13,
                    color:      "#e8edf2",
                    fontWeight: 400,
                    display:    "flex",
                    alignItems: "center",
                    gap:        6,
                }}>
                    {label}
                    {loading && (
                        <span style={{ fontSize: 10, color: "rgba(232,237,242,0.4)" }}>...</span>
                    )}
                    {!loading && badge > 0 && (
                        <span style={{
                            fontSize:     9,
                            background:   "rgba(255,255,255,0.1)",
                            borderRadius: 8,
                            padding:      "1px 5px",
                            color:        "rgba(232,237,242,0.6)",
                        }}>
                            {badge}
                        </span>
                    )}
                </div>
                {hint && !isManual && (
                    <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", marginTop: 1 }}>
                        {hint}
                    </div>
                )}
                {isManual && toggled && (
                    <div style={{ fontSize: 9, color: "#FFB300", marginTop: 1, letterSpacing: "0.04em" }}>
                        Manual override
                    </div>
                )}
            </div>
            <Toggle value={!!toggled} onChange={onToggle} />
        </div>
    )
}

function SectionHeader({ label }) {
    return (
        <div style={{
            fontSize:      11,
            fontWeight:    700,
            color:         "var(--akili-accent)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding:       "12px 0 4px",
            borderBottom:  "1px solid rgba(26,110,181,0.3)",
            marginBottom:  2,
        }}>
            {label}
        </div>
    )
}

export default function LayersPanel({
    active,
    onToggle,
    infraActive,
    onInfraToggle,
    zoom,
    onClose,
    sourceStatus,
    // ADS-B
    adsbLive,
    adsbCount,
    adsbRefreshRate,
    adsbSliderVal,
    onAdsbSliderChange,
    onAdsbActivate,
    onAdsbStop,
    adsbLabels,
    onAdsbLabelsToggle,
    // Route
    routeInfo,
    // Conflict zones
    conflictZoneCount,
    conflictZonesLoading,
    // News conflicts
    newsConflictCount,
    newsConflictTotal,
    // Infra
    infraLoading,
    infraData,
    // POI
    poiCount,
    // Deployments
    deploymentsCount,
    onEditDeployments,
    // Manual overrides
    manualOverrides,
    // AIS
    aisStatus,
    aisVesselCount,
    // Auth
    currentUser,
}) {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const aisStatusKey = aisStatus?.error ? "error" : aisStatus?.connected ? "ok" : "pending"
    const ss = { ...(sourceStatus || {}), aisVessels: aisStatusKey }
    const il = infraLoading || {}
    const id = infraData || {}
    const mo = manualOverrides || {}

    function infraBadge(cat) {
        return id[cat]?.features?.length || 0
    }

    function isManual(key) {
        return Object.prototype.hasOwnProperty.call(mo, key)
    }

    const body = (
        <div style={{
            position:        "fixed",
            top:             54,
            right:           0,
            width:           280,
            height:          "calc(100vh - 54px)",
            background:      "rgba(14,20,32,0.88)",
            backdropFilter:  "blur(20px)",
            borderLeft:      "1px solid rgba(255,255,255,0.1)",
            display:         "flex",
            flexDirection:   "column",
            zIndex:          900,
            fontFamily:      "inherit",
        }}>
            {/* Header */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                height:         44,
                padding:        "0 12px",
                borderBottom:   "1px solid rgba(255,255,255,0.08)",
                flexShrink:     0,
            }}>
                <span style={{
                    fontSize:      11,
                    fontWeight:    700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color:         "#e8edf2",
                }}>
                    Layers
                </span>
                <button
                    onClick={onClose}
                    style={{
                        background: "none",
                        border:     "none",
                        color:      "rgba(232,237,242,0.5)",
                        cursor:     "pointer",
                        fontSize:   16,
                        lineHeight: 1,
                        padding:    "2px 4px",
                    }}
                >
                    ×
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>

                {/* Route status banner */}
                {active.route && routeInfo && !routeInfo.calculating && routeInfo.distance && (
                    <div style={{
                        margin:       "8px 0 0",
                        padding:      "6px 8px",
                        background:   "rgba(41,121,255,0.12)",
                        borderRadius: 4,
                        border:       "1px solid rgba(41,121,255,0.3)",
                        fontSize:     10,
                        color:        "rgba(232,237,242,0.6)",
                    }}>
                        Route: {routeInfo.distance} — {routeInfo.duration}
                    </div>
                )}

                {/* ADS-B expanded controls */}
                {active.adsb && (
                    <div style={{
                        margin:       "8px 0 0",
                        padding:      "8px",
                        background:   "rgba(255,255,255,0.04)",
                        borderRadius: 4,
                        border:       "1px solid rgba(255,255,255,0.08)",
                    }}>
                        <div style={{
                            display:        "flex",
                            justifyContent: "space-between",
                            alignItems:     "center",
                            marginBottom:   6,
                        }}>
                            <span style={{ fontSize: 11, color: "rgba(232,237,242,0.6)" }}>
                                {adsbLive ? `${adsbCount || 0} aircraft` : "—"}
                            </span>
                            <button
                                onClick={adsbLive ? onAdsbStop : onAdsbActivate}
                                style={{
                                    fontSize:     10,
                                    padding:      "3px 8px",
                                    borderRadius: 3,
                                    border:       "none",
                                    background:   adsbLive ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.2)",
                                    color:        adsbLive ? "#ef4444" : "#22c55e",
                                    cursor:       "pointer",
                                }}
                            >
                                {adsbLive ? "Stop" : "Activate"}
                            </button>
                        </div>
                        <div style={{
                            display:      "flex",
                            alignItems:   "center",
                            gap:          8,
                            marginBottom: 4,
                        }}>
                            <input
                                type="checkbox"
                                id="adsb-labels"
                                checked={!!adsbLabels}
                                onChange={onAdsbLabelsToggle}
                                style={{ cursor: "pointer" }}
                            />
                            <label htmlFor="adsb-labels" style={{ fontSize: 10, color: "rgba(232,237,242,0.6)", cursor: "pointer" }}>
                                Callsign labels
                            </label>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10, color: "rgba(232,237,242,0.35)", flexShrink: 0 }}>
                                {adsbSliderVal || adsbRefreshRate || 15}s
                            </span>
                            <input
                                type="range"
                                min={5}
                                max={60}
                                step={5}
                                value={adsbSliderVal || adsbRefreshRate || 15}
                                onChange={e => onAdsbSliderChange(Number(e.target.value))}
                                style={{ flex: 1, cursor: "pointer" }}
                            />
                        </div>
                    </div>
                )}

                {/* EVENTS */}
                <SectionHeader label="Events" />

                <LayerRow
                    label="Surface Feed"
                    statusKey="rss"
                    sourceStatus={ss}
                    toggled={active.news}
                    onToggle={() => onToggle("news")}
                    isManual={isManual("news")}
                />
                <LayerRow
                    label="Conflict Zones"
                    statusKey="gdelt"
                    sourceStatus={ss}
                    toggled={active.conflictZones}
                    onToggle={() => onToggle("conflictZones")}
                    badge={conflictZoneCount}
                    loading={conflictZonesLoading}
                    isManual={isManual("conflictZones")}
                />
                <LayerRow
                    label="Heatmap"
                    hint={zoom >= 6 ? "auto z<6" : undefined}
                    toggled={active.heatmap}
                    onToggle={() => onToggle("heatmap")}
                    isManual={isManual("heatmap")}
                />
                <LayerRow
                    label="Missile Alerts"
                    statusKey="oref"
                    sourceStatus={ss}
                    toggled={active.missileAlerts}
                    onToggle={() => onToggle("missileAlerts")}
                    isManual={isManual("missileAlerts")}
                />
                <LayerRow
                    label="Earthquake Events"
                    statusKey="usgs"
                    sourceStatus={ss}
                    toggled={active.earthquakeEvents}
                    onToggle={() => onToggle("earthquakeEvents")}
                    isManual={isManual("earthquakeEvents")}
                />

                {/* INFRASTRUCTURE */}
                <SectionHeader label="Infrastructure" />

                <LayerRow
                    label="Airports"
                    toggled={active.airports}
                    onToggle={() => onToggle("airports")}
                    isManual={isManual("airports")}
                />
                <LayerRow
                    label="Ports"
                    toggled={active.ports}
                    onToggle={() => onToggle("ports")}
                    isManual={isManual("ports")}
                />
                <LayerRow
                    label="Power Plants"
                    toggled={active.powerPlants}
                    onToggle={() => onToggle("powerPlants")}
                    isManual={isManual("powerPlants")}
                />
                <LayerRow
                    label="Hospitals"
                    toggled={active.hospitals}
                    onToggle={() => onToggle("hospitals")}
                    isManual={isManual("hospitals")}
                />
                <LayerRow
                    label="Police & Security"
                    toggled={active.police}
                    onToggle={() => onToggle("police")}
                    isManual={isManual("police")}
                />
                <LayerRow
                    label="Military"
                    toggled={active.military}
                    onToggle={() => onToggle("military")}
                    isManual={isManual("military")}
                />
                <LayerRow
                    label="Pipelines"
                    toggled={active.pipelines}
                    onToggle={() => onToggle("pipelines")}
                    isManual={isManual("pipelines")}
                />
                <LayerRow
                    label="Submarine Cables"
                    toggled={active.cables}
                    onToggle={() => onToggle("cables")}
                    isManual={isManual("cables")}
                />

                {/* MARITIME */}
                <SectionHeader label="Maritime" />

                <LayerRow
                    label="Nautical Chart"
                    toggled={active.shippingLanes}
                    onToggle={() => onToggle("shippingLanes")}
                    isManual={isManual("shippingLanes")}
                />
                <LayerRow
                    label="IMB Piracy"
                    toggled={active.imbPiracy}
                    onToggle={() => onToggle("imbPiracy")}
                    isManual={isManual("imbPiracy")}
                />
                <LayerRow
                    label="EEZ Boundaries"
                    toggled={active.eez}
                    onToggle={() => onToggle("eez")}
                    isManual={isManual("eez")}
                />
                <LayerRow
                    label="Chokepoints"
                    toggled={active.chokepoints}
                    onToggle={() => onToggle("chokepoints")}
                    isManual={isManual("chokepoints")}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1 }}>
                        <LayerRow
                            label="Deployments"
                            hint="naval CSG / ARG positions"
                            toggled={active.deployments}
                            onToggle={() => onToggle("deployments")}
                            badge={deploymentsCount}
                            isManual={isManual("deployments")}
                        />
                    </div>
                    {active.deployments && onEditDeployments && (
                        <button
                            onClick={onEditDeployments}
                            title="Edit deployment data"
                            style={{
                                background: "rgba(255,255,255,0.07)",
                                border: "1px solid rgba(255,255,255,0.15)",
                                borderRadius: 4,
                                color: "#94a3b8",
                                cursor: "pointer",
                                fontSize: 11,
                                padding: "2px 6px",
                                flexShrink: 0,
                            }}
                        >edit</button>
                    )}
                </div>

                <LayerRow
                    label="Live Vessels (AIS)"
                    hint={
                        aisStatus?.connected
                            ? `${aisVesselCount || 0} vessels live`
                            : "aisstream.io WebSocket"
                    }
                    statusKey="aisVessels"
                    sourceStatus={ss}
                    toggled={active.aisVessels}
                    onToggle={() => onToggle("aisVessels")}
                    badge={active.aisVessels && aisVesselCount > 0 ? aisVesselCount : undefined}
                    isManual={isManual("aisVessels")}
                />
                {active.aisVessels && aisStatus?.error?.includes("not set") && (
                    <div style={{ fontSize: 11, color: "#FFB300", paddingLeft: 16, marginTop: -4, marginBottom: 6, lineHeight: 1.4 }}>
                        Add AISSTREAM_API_KEY to .env to enable
                    </div>
                )}

                {/* OVERLAYS */}
                <SectionHeader label="Overlays" />

                <LayerRow
                    label="Country Borders"
                    hint={active.borders ? "click country for detail" : undefined}
                    toggled={active.borders}
                    onToggle={() => onToggle("borders")}
                    isManual={isManual("borders")}
                />
                <LayerRow
                    label="City Labels"
                    toggled={active.cityLabels}
                    onToggle={() => onToggle("cityLabels")}
                    isManual={isManual("cityLabels")}
                />
                <LayerRow
                    label="Airspace"
                    toggled={active.airspace}
                    onToggle={() => onToggle("airspace")}
                    isManual={isManual("airspace")}
                />
                <LayerRow
                    label="News Conflicts"
                    statusKey="rss"
                    sourceStatus={ss}
                    toggled={active.newsConflicts}
                    onToggle={() => onToggle("newsConflicts")}
                    badge={newsConflictCount}
                    isManual={isManual("newsConflicts")}
                />
                <LayerRow
                    label="Satellite Imagery"
                    toggled={active.satellite}
                    onToggle={() => onToggle("satellite")}
                    isManual={isManual("satellite")}
                />
                <LayerRow
                    label="ADS-B Traffic"
                    toggled={active.adsb}
                    onToggle={() => onToggle("adsb")}
                    isManual={isManual("adsb")}
                />
                <LayerRow
                    label="POI Profiles"
                    hint="persons of interest"
                    toggled={active.poi}
                    onToggle={() => onToggle("poi")}
                    badge={poiCount}
                    isManual={isManual("poi")}
                />
                <LayerRow
                    label="Live Ticker"
                    hint="scrolling events bar"
                    toggled={active.liveTicker}
                    onToggle={() => onToggle("liveTicker")}
                    isManual={isManual("liveTicker")}
                />

                {/* INTELLIGENCE — superadmin only */}
                {(currentUser?.is_super_admin || currentUser?.role === "superadmin") && (
                    <>
                        <SectionHeader label="Intelligence" />
                        <LayerRow
                            label="User Locations"
                            hint="live operator positions"
                            toggled={active.userLocations}
                            onToggle={() => onToggle("userLocations")}
                        />
                    </>
                )}

            </div>
        </div>
    )

    if (isMobile) {
        return (
            <BottomSheet isOpen title="Layers" onClose={onClose} height="full">
                <div style={{ padding: "16px 12px 24px" }}>
                    {/* Route status banner */}
                    {active.route && routeInfo && !routeInfo.calculating && routeInfo.distance && (
                        <div style={{
                            margin: "8px 0 0", padding: "6px 8px",
                            background: "rgba(41,121,255,0.12)", borderRadius: 4,
                            border: "1px solid rgba(41,121,255,0.3)",
                            fontSize: 10, color: "rgba(232,237,242,0.6)",
                        }}>
                            Route: {routeInfo.distance} — {routeInfo.duration}
                        </div>
                    )}
                    <SectionHeader label="Events" />
                    <LayerRow label="Surface Feed"       statusKey="rss"   sourceStatus={ss} toggled={active.news}            onToggle={() => onToggle("news")}            isManual={isManual("news")} />
                    <LayerRow label="Conflict Zones"     statusKey="gdelt" sourceStatus={ss} toggled={active.conflictZones}   onToggle={() => onToggle("conflictZones")}   badge={conflictZoneCount} loading={conflictZonesLoading} isManual={isManual("conflictZones")} />
                    <LayerRow label="Heatmap"                               toggled={active.heatmap}          onToggle={() => onToggle("heatmap")}          isManual={isManual("heatmap")} />
                    <LayerRow label="Missile Alerts"     statusKey="oref"  sourceStatus={ss} toggled={active.missileAlerts}   onToggle={() => onToggle("missileAlerts")}   isManual={isManual("missileAlerts")} />
                    <LayerRow label="Earthquake Events"  statusKey="usgs"  sourceStatus={ss} toggled={active.earthquakeEvents} onToggle={() => onToggle("earthquakeEvents")} isManual={isManual("earthquakeEvents")} />
                    <SectionHeader label="Infrastructure" />
                    <LayerRow label="Airports"       toggled={active.airports}    onToggle={() => onToggle("airports")}    isManual={isManual("airports")} />
                    <LayerRow label="Ports"          toggled={active.ports}       onToggle={() => onToggle("ports")}       isManual={isManual("ports")} />
                    <LayerRow label="Power Plants"   toggled={active.powerPlants} onToggle={() => onToggle("powerPlants")} isManual={isManual("powerPlants")} />
                    <LayerRow label="Hospitals"      toggled={active.hospitals}   onToggle={() => onToggle("hospitals")}   isManual={isManual("hospitals")} />
                    <LayerRow label="Police & Security" toggled={active.police}   onToggle={() => onToggle("police")}      isManual={isManual("police")} />
                    <LayerRow label="Military"       toggled={active.military}    onToggle={() => onToggle("military")}    isManual={isManual("military")} />
                    <LayerRow label="Submarine Cables" toggled={active.cables}   onToggle={() => onToggle("cables")}      isManual={isManual("cables")} />
                    <SectionHeader label="Maritime" />
                    <LayerRow label="Nautical Chart" toggled={active.shippingLanes} onToggle={() => onToggle("shippingLanes")} isManual={isManual("shippingLanes")} />
                    <LayerRow label="IMB Piracy"     toggled={active.imbPiracy}     onToggle={() => onToggle("imbPiracy")}     isManual={isManual("imbPiracy")} />
                    <LayerRow label="EEZ Boundaries" toggled={active.eez}           onToggle={() => onToggle("eez")}           isManual={isManual("eez")} />
                    <LayerRow label="Chokepoints"    toggled={active.chokepoints}   onToggle={() => onToggle("chokepoints")}   isManual={isManual("chokepoints")} />
                    <LayerRow label="Live Vessels (AIS)" statusKey="aisVessels" sourceStatus={ss} toggled={active.aisVessels} onToggle={() => onToggle("aisVessels")} badge={active.aisVessels && aisVesselCount > 0 ? aisVesselCount : undefined} isManual={isManual("aisVessels")} />
                    <SectionHeader label="Overlays" />
                    <LayerRow label="Country Borders"   toggled={active.borders}       onToggle={() => onToggle("borders")}       isManual={isManual("borders")} />
                    <LayerRow label="Airspace"          toggled={active.airspace}      onToggle={() => onToggle("airspace")}      isManual={isManual("airspace")} />
                    <LayerRow label="News Conflicts"    statusKey="rss" sourceStatus={ss} toggled={active.newsConflicts} onToggle={() => onToggle("newsConflicts")} badge={newsConflictCount} isManual={isManual("newsConflicts")} />
                    <LayerRow label="ADS-B Traffic"     toggled={active.adsb}          onToggle={() => onToggle("adsb")}          isManual={isManual("adsb")} />
                    <LayerRow label="POI Profiles"      toggled={active.poi}           onToggle={() => onToggle("poi")}           badge={poiCount} isManual={isManual("poi")} />
                </div>
            </BottomSheet>
        )
    }

    return body
}
