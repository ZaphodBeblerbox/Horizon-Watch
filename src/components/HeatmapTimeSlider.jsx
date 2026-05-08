// Floating time-range control for traffic heatmap layers (2D + 3D).
// Mounts as a fixed overlay above the map — only shown when a heatmap is active.

const PRESETS = [
    { label: "1h",  hours: 1 },
    { label: "6h",  hours: 6 },
    { label: "24h", hours: 24 },
    { label: "3d",  hours: 72 },
    { label: "7d",  hours: 168 },
]

export default function HeatmapTimeSlider({ hours, onHoursChange, isMobile = false }) {
    return (
        <div
            style={{
                position:      "fixed",
                bottom:        isMobile ? 70 : 20,
                left:          "50%",
                transform:     "translateX(-50%)",
                zIndex:        800,
                background:    "rgba(8,14,28,0.90)",
                backdropFilter:"blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border:        "1px solid rgba(56,189,248,0.2)",
                borderRadius:  10,
                padding:       "8px 14px",
                display:       "flex",
                alignItems:    "center",
                gap:           10,
                pointerEvents: "auto",
                boxShadow:     "0 4px 20px rgba(0,0,0,0.5)",
                userSelect:    "none",
            }}
        >
            {/* Label */}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(56,189,248,0.7)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                Heatmap Window
            </div>

            {/* Preset buttons */}
            <div style={{ display: "flex", gap: 3 }}>
                {PRESETS.map(p => {
                    const active = p.hours === hours
                    return (
                        <button
                            key={p.hours}
                            onClick={() => onHoursChange(p.hours)}
                            style={{
                                padding:    "4px 10px",
                                borderRadius: 5,
                                fontSize:   10,
                                fontWeight: 600,
                                cursor:     "pointer",
                                background: active ? "rgba(56,189,248,0.2)" : "transparent",
                                border:     "1px solid " + (active ? "rgba(56,189,248,0.5)" : "rgba(255,255,255,0.1)"),
                                color:      active ? "#38bdf8" : "rgba(255,255,255,0.45)",
                                transition: "all 120ms",
                                fontFamily: "inherit",
                            }}
                        >
                            {p.label}
                        </button>
                    )
                })}
            </div>

            {/* Range slider */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                    type="range"
                    min={1}
                    max={168}
                    step={1}
                    value={hours}
                    onChange={e => onHoursChange(Number(e.target.value))}
                    style={{
                        width:  80,
                        accentColor: "#38bdf8",
                        cursor: "pointer",
                    }}
                />
                <span style={{ fontSize: 10, color: "#38bdf8", fontWeight: 700, minWidth: 28, fontVariantNumeric: "tabular-nums" }}>
                    {hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}
                </span>
            </div>
        </div>
    )
}
