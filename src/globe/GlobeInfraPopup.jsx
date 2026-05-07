const TYPE_LABELS = {
    line:        "Power Line",
    cable:       "Power Cable",
    substation:  "Substation",
    plant:       "Power Plant",
    tower:       "Transmission Tower",
    transformer: "Transformer",
    pipeline:    "Pipeline",
    telecoms:    "Telecoms Line",
}

function fmtVoltage(v) {
    if (!v) return null
    const n = parseInt(v, 10)
    if (isNaN(n)) return v
    return n >= 1000 ? `${(n / 1000).toFixed(0)} kV` : `${n} V`
}

function Row({ label, value }) {
    if (!value) return null
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ color: "#9AA4B5", fontSize: 11, flexShrink: 0, paddingRight: 8 }}>{label}</span>
            <span style={{ fontSize: 11, color: "#E8ECF1", textAlign: "right", maxWidth: "65%" }}>{value}</span>
        </div>
    )
}

export default function GlobeInfraPopup({ data: d, onClose }) {
    if (d?.loading) {
        return (
            <div style={{ padding: "16px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#2d8fe8", borderRadius: "50%", animation: "ow-spin 0.8s linear infinite" }} />
                <span style={{ color: "#9AA4B5", fontSize: 12 }}>Querying infrastructure…</span>
                <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>
            </div>
        )
    }

    if (!d?.elements?.length) {
        return (
            <div style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#9AA4B5", fontSize: 12 }}>No infrastructure found at this location.</span>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, padding: "0 0 0 8px" }}>×</button>
            </div>
        )
    }

    const el   = d.elements[0]
    const tags = el.tags || {}
    const pwr  = tags.power
    const man  = tags.man_made
    const kind = (pwr && TYPE_LABELS[pwr]) || (man === "pipeline" ? "Pipeline" : null) || tags.telecom ? "Telecoms" : "Infrastructure"
    const ref  = tags.name || tags.ref || null
    const volt = fmtVoltage(tags.voltage)

    return (
        <div>
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid #2C3645", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ color: "#e8b23a", fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{ref || kind}</div>
                    <div style={{ color: "#9AA4B5", fontSize: 11, marginTop: 2 }}>{kind}</div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", flexShrink: 0 }}>×</button>
            </div>
            <div style={{ padding: "8px 12px" }}>
                <Row label="Voltage"  value={volt} />
                <Row label="Operator" value={tags.operator} />
                <Row label="Cables"   value={tags.cables} />
                <Row label="Circuits" value={tags.circuits} />
                <Row label="Ref"      value={tags.ref} />
                <Row label="OSM type" value={el.type} />
                {d.elements.length > 1 && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 6 }}>
                        +{d.elements.length - 1} other element{d.elements.length > 2 ? "s" : ""} nearby
                    </div>
                )}
            </div>
        </div>
    )
}
