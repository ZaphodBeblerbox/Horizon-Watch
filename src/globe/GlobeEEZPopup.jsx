const ACCENT = "#00cfff"

const ROW = ({ label, value }) => value ? (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <span style={{ color: "#9AA4B5", fontSize: 11, flexShrink: 0, paddingRight: 8 }}>{label}</span>
        <span style={{ fontSize: 11, color: "#E8ECF1", textAlign: "right" }}>{value}</span>
    </div>
) : null

export default function GlobeEEZPopup({ data: d, onClose }) {
    const title = d.eez1 || d.territory1 || "EEZ Boundary"
    const side2 = d.eez2 && d.eez2 !== d.eez1 ? d.eez2 : null
    const len   = d.length_km ? `${Number(d.length_km).toFixed(0)} km` : null

    return (
        <div>
            {/* Header */}
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid #2C3645", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ color: ACCENT, fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{title}</div>
                    {d.sovereign1 && d.sovereign1 !== title && (
                        <div style={{ color: "#9AA4B5", fontSize: 11, marginTop: 2 }}>{d.sovereign1}</div>
                    )}
                </div>
                <button
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", flexShrink: 0 }}
                >×</button>
            </div>

            {/* Details */}
            <div style={{ padding: "8px 12px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: 6 }}>
                    Exclusive Economic Zone
                </div>
                <ROW label="Zone"       value={d.eez1} />
                {side2 && <ROW label="Adjacent zone" value={side2} />}
                {d.territory2 && d.territory2 !== d.territory1 && (
                    <ROW label="Adjacent territory" value={d.territory2} />
                )}
                <ROW label="Boundary type" value={d.line_type} />
                <ROW label="Segment length" value={len} />
            </div>
        </div>
    )
}
