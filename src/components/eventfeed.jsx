const SEVERITY_COLOR = {
    critical: "#c0392b",
    high: "#d35400",
    medium: "#f39c12",
    low: "#27ae60",
}

const TYPE_DOT = {
    "Protests": "#3498db",
    "Violence against civilians": "#c0392b",
    "Battles": "#8e44ad",
    "Explosions/Remote violence": "#e74c3c",
    "Strategic developments": "#27ae60",
    "Riots": "#e67e22",
}

export default function EventFeed({ events, selected, onSelect }) {
    return (
        <div style={{
            width: 280,
            flexShrink: 0,
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(12px)",
            borderRight: "1px solid rgba(0,0,0,0.10)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
        }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "#999" }}>
                    Events — {events.length}
                </span>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
                {events.map(ev => (
                    <div
                        key={ev.id}
                        onClick={() => onSelect(ev)}
                        style={{
                            padding: "12px 16px",
                            borderBottom: "1px solid rgba(0,0,0,0.06)",
                            cursor: "pointer",
                            background: selected?.id === ev.id ? "rgba(0,0,0,0.04)" : "transparent",
                            borderLeft: selected?.id === ev.id ? "2px solid #0a0a0a" : "2px solid transparent",
                            transition: "all 0.1s"
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <div style={{
                                width: 6, height: 6, flexShrink: 0,
                                background: TYPE_DOT[ev.type] || "#999"
                            }} />
                            <span style={{ fontSize: 10, color: "#999", fontWeight: 500 }}>{ev.date}</span>
                            {ev.fatalities > 0 && (
                                <span style={{ fontSize: 10, color: "#c0392b", marginLeft: "auto", fontWeight: 600 }}>
                                    ✕ {ev.fatalities}
                                </span>
                            )}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2, lineHeight: 1.4 }}>
                            {ev.type}
                        </div>
                        <div style={{ fontSize: 11, color: "#666" }}>
                            {ev.location}{ev.admin1 && ev.admin1 !== ev.location ? `, ${ev.admin1}` : ""}
                        </div>
                        {ev.actor && (
                            <div style={{ fontSize: 10, color: "#aaa", marginTop: 2, fontStyle: "italic" }}>
                                {ev.actor.length > 40 ? ev.actor.slice(0, 40) + "…" : ev.actor}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}