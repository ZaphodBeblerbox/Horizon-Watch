export default function GlobeCablePopup({ data: d, onClose }) {
    return (
        <div>
            {/* Header */}
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid #2C3645", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: d.color || "#9B59B6", flexShrink: 0 }} />
                        <span style={{ color: d.color || "#9B59B6", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{d.name}</span>
                    </div>
                    <div style={{ color: "#9AA4B5", fontSize: 11, marginTop: 3, paddingLeft: 18 }}>Submarine cable</div>
                </div>
                <button
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", flexShrink: 0 }}
                >×</button>
            </div>

            {/* Body */}
            <div style={{ padding: "8px 12px 10px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: 6 }}>
                    Fiber-optic submarine cable
                </div>
                <div style={{ fontSize: 11, color: "#9AA4B5", lineHeight: 1.5 }}>
                    Click a segment to identify. Data: TeleGeography.
                </div>
            </div>
        </div>
    )
}
