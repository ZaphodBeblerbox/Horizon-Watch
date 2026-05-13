const TYPE_LABELS = {
    large_airport:  "Large Airport",
    medium_airport: "Medium Airport",
    small_airport:  "Small Airport",
    seaplane_base:  "Seaplane Base",
}

const TYPE_COLOR = {
    large_airport:  "#38bdf8",
    medium_airport: "#60a5fa",
    small_airport:  "#475569",
    seaplane_base:  "#06b6d4",
}

export default function GlobeAirportPopup({ data: apt, onClose }) {
    const p      = apt.properties ?? apt
    const color  = TYPE_COLOR[p.airport_type] || "#60a5fa"
    const label  = TYPE_LABELS[p.airport_type] || p.airport_type || "Airport"

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
                    {label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9",
                              lineHeight: 1.3, paddingRight: 20, marginBottom: 10 }}>
                    {p.airport_name}
                </div>
            </div>

            <div style={{ padding: "0 14px 14px", display: "grid",
                          gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                {[
                    ["ICAO",       p.icao_code || p.ident || "—"],
                    ["IATA",       p.iata_code || "—"],
                    ["Country",    p.country_name || p.country_code || "—"],
                    ["Municipality", p.municipality || "—"],
                    ["Elevation",  p.elevation_ft != null ? `${p.elevation_ft} ft` : "—"],
                    ["System ID",  p.system_id || "—"],
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
