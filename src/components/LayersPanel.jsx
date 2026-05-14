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
                minHeight:    "unset",
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

function LayerRow({ label, hint, toggled, onToggle }) {
    return (
        <div
            style={{ display: "flex", alignItems: "center", padding: "8px 0", cursor: "pointer" }}
            onClick={() => onToggle()}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#e8edf2", fontWeight: 400 }}>{label}</div>
                {hint && (
                    <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", marginTop: 1 }}>{hint}</div>
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

function LayerRows3D({ active, onToggle }) {
    return (
        <>
            <SectionHeader label="Imagery" />
            <LayerRow
                label="Sentinel-2 Satellite"
                hint="Copernicus true-colour imagery"
                toggled={active.satellite}
                onToggle={() => onToggle("satellite")}
            />
            <LayerRow
                label="Nautical Chart"
                hint="OpenSeaMap vector overlay"
                toggled={active.shippingLanes}
                onToggle={() => onToggle("shippingLanes")}
            />
            <LayerRow
                label="Infrastructure"
                hint="OpenInfraMap — power, telecoms, pipelines"
                toggled={active.oim}
                onToggle={() => onToggle("oim")}
            />

            <SectionHeader label="Live Traffic" />
            <LayerRow
                label="ADS-B Aircraft"
                hint="Real-time transponder positions"
                toggled={active.adsb}
                onToggle={() => onToggle("adsb")}
            />
            <LayerRow
                label="AIS Vessels"
                hint="Maritime transponder positions"
                toggled={active.aisVessels}
                onToggle={() => onToggle("aisVessels")}
            />

            <SectionHeader label="Boundaries" />
            <LayerRow
                label="Country Borders"
                toggled={active.borders}
                onToggle={() => onToggle("borders")}
            />
            <LayerRow
                label="Exclusive Economic Zones"
                hint="200 nm maritime boundaries"
                toggled={active.eez}
                onToggle={() => onToggle("eez")}
            />
            <LayerRow
                label="City Labels"
                toggled={active.cityLabels}
                onToggle={() => onToggle("cityLabels")}
            />

            <SectionHeader label="Intelligence" />
            <LayerRow
                label="Forge Alerts"
                hint="Rule-triggered AIS · ADSB · News alerts"
                toggled={active.forgeAlerts ?? false}
                onToggle={() => onToggle("forgeAlerts")}
            />
            <LayerRow
                label="Intelligence Events"
                hint="Unified news & conflict events"
                toggled={active.unifiedEvents ?? true}
                onToggle={() => onToggle("unifiedEvents")}
            />
            <LayerRow
                label="Points of Interest"
                hint="User-created markers"
                toggled={active.poi}
                onToggle={() => onToggle("poi")}
            />
            <LayerRow
                label="Chokepoints"
                hint="Strategic maritime passages"
                toggled={active.chokepoints}
                onToggle={() => onToggle("chokepoints")}
            />
            <LayerRow
                label="Submarine Cables"
                hint="Global undersea fibre routes"
                toggled={active.cables}
                onToggle={() => onToggle("cables")}
            />
            <LayerRow
                label="Threat Heatmap"
                hint="Regional threat levels — refreshed hourly"
                toggled={active.threatHeatmap ?? false}
                onToggle={() => onToggle("threatHeatmap")}
            />

            <SectionHeader label="Infrastructure" />
            <LayerRow
                label="Airports"
                hint="49 k airports — viewport-culled, large first"
                toggled={active.airports ?? false}
                onToggle={() => onToggle("airports")}
            />
            <LayerRow
                label="Ports"
                hint="11 k maritime ports — viewport-culled"
                toggled={active.ports ?? false}
                onToggle={() => onToggle("ports")}
            />

            <SectionHeader label="Heatmaps" />
            <LayerRow
                label="AIS Density"
                hint="Vessel track density over time"
                toggled={active.aisHeatmap}
                onToggle={() => onToggle("aisHeatmap")}
            />
            <LayerRow
                label="ADS-B Density"
                hint="Aircraft track density over time"
                toggled={active.adsbHeatmap}
                onToggle={() => onToggle("adsbHeatmap")}
            />
        </>
    )
}

export default function LayersPanel({
    active,
    onToggle,
    onClose,
}) {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const rows = <LayerRows3D active={active} onToggle={onToggle} />

    const header = (
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
    )

    if (isMobile) {
        return (
            <BottomSheet isOpen title="Layers" onClose={onClose} height="full">
                <div style={{ padding: "16px 12px 24px" }}>
                    {rows}
                </div>
            </BottomSheet>
        )
    }

    return (
        <div style={{
            position:        "fixed",
            top:             54,
            right:           0,
            width:           280,
            height:          "calc(100vh - 54px)",
            background:      "rgba(6,14,45,0.96)",
            backdropFilter:  "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderLeft:      "1px solid rgba(255,255,255,0.08)",
            display:         "flex",
            flexDirection:   "column",
            zIndex:          900,
            fontFamily:      "inherit",
        }}>
            {header}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
                {rows}
            </div>
        </div>
    )
}
