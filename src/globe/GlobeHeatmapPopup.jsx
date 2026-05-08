const DOMAIN_LABEL = { ais: "Vessel Traffic", adsb: "Aircraft Traffic" }
const DOMAIN_COLOR = { ais: "#4A9EE0", adsb: "#5BC97F" }

export default function GlobeHeatmapPopup({ data, onClose }) {
    const color = DOMAIN_COLOR[data.domain] || "#9AA4B5"

    const pct = Math.round((data.intensity ?? 0) * 100)
    const intensityBar = (
        <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 200ms" }} />
        </div>
    )

    return (
        <div style={{ padding: "12px 14px", color: "#E8ECF1", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 12, position: "relative" }}>
            <button
                onClick={onClose}
                style={{ position: "absolute", top: 6, right: 8, background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
            >×</button>

            {/* Header */}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color, textTransform: "uppercase", marginBottom: 6 }}>
                {DOMAIN_LABEL[data.domain] || "Traffic"} · Density Cell
            </div>

            {/* Coords */}
            <div style={{ display: "flex", gap: 16, marginBottom: 10, color: "#9AA4B5", fontSize: 11 }}>
                <span>{data.lat?.toFixed(2)}° N</span>
                <span>{data.lon?.toFixed(2)}° E</span>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", gap: 12 }}>
                <StatBlock label="Observations" value={data.count?.toLocaleString() ?? "—"} color={color} />
                {data.avg_speed != null && (
                    <StatBlock label="Avg Speed" value={`${data.avg_speed.toFixed(1)} kn`} color="#9AA4B5" />
                )}
                <StatBlock label="Intensity" value={`${pct}%`} color="#9AA4B5" />
            </div>

            {intensityBar}
        </div>
    )
}

function StatBlock({ label, value, color }) {
    return (
        <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
        </div>
    )
}
