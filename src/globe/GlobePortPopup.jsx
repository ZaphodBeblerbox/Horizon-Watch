const SIZE_COLOR = {
    "Very Large": "#f59e0b",
    "Large":      "#fb923c",
    "Medium":     "#60a5fa",
    "Small":      "#475569",
}

const REGION_LABELS = {
    "REG-ARCTIC":  "Arctic",
    "REG-NORSEA":  "North Sea / Baltic",
    "REG-MED":     "Mediterranean",
    "REG-REDSEA":  "Red Sea / Gulf",
    "REG-SEASIA":  "Southeast Asia",
    "REG-CARIB":   "Caribbean",
    "REG-ATL-N":   "North Atlantic",
    "REG-ATL-S":   "South Atlantic",
    "REG-IND":     "Indian Ocean",
    "REG-PAC-N":   "North Pacific",
    "REG-PAC-S":   "South Pacific",
}

export default function GlobePortPopup({ data: port, onClose }) {
    const p     = port.properties ?? port
    const size  = p.port_size || "Medium"
    const color = SIZE_COLOR[size] || "#60a5fa"
    const regionLabel = REGION_LABELS[p.region_id] || p.region_id || "—"
    const radiusKm = p.boundary_radius_metres
        ? (p.boundary_radius_metres / 1000).toFixed(1)
        : "—"

    return (
        <div style={{ fontFamily: "system-ui, sans-serif", color: "#e2e8f0", minWidth: 240 }}>
            <button
                onClick={onClose}
                style={{ position: "absolute", top: 8, right: 10, background: "transparent",
                         border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18,
                         lineHeight: 1, padding: 0, zIndex: 1 }}
            >×</button>

            <div style={{ padding: "14px 14px 4px" }}>
                <div style={{ fontSize: 10, color, textTransform: "uppercase",
                              letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>
                    {size} Port
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9",
                              lineHeight: 1.3, paddingRight: 20, marginBottom: 10 }}>
                    {p.port_name}
                </div>
            </div>

            <div style={{ padding: "0 14px 14px", display: "grid",
                          gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                {[
                    ["Country",   p.country || "—"],
                    ["LOCODE",    p.locode   || "—"],
                    ["Region",    regionLabel],
                    ["Boundary",  `${radiusKm} km radius`],
                    ["System ID", p.system_id || "—"],
                ].map(([k, v]) => (
                    <div key={k}>
                        <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase",
                                      letterSpacing: "0.06em", marginBottom: 1 }}>{k}</div>
                        <div style={{ fontSize: 11, color: "#cbd5e1", wordBreak: "break-all" }}>{v}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}
