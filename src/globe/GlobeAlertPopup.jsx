export default function GlobeAlertPopup({ data, onClose }) {
    const a = data || {}
    const sevColor = a.severity === "critical" ? "#f87171" : a.severity === "high" ? "#fb923c" : a.severity === "medium" ? "#fbbf24" : "#60a5fa"
    const sevBg    = a.severity === "critical" ? "rgba(248,113,113,0.12)" : a.severity === "high" ? "rgba(251,146,60,0.12)" : a.severity === "medium" ? "rgba(251,191,36,0.12)" : "rgba(96,165,250,0.12)"
    const srcColor = a.source === "AIS" ? "#0ea5e9" : a.source === "ADSB" ? "#a78bfa" : "#34d399"

    return (
        <div style={{ padding: "12px 14px", fontFamily: "system-ui, sans-serif", minWidth: 240 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: sevBg, color: sevColor, fontWeight: 700 }}>
                        {(a.severity || "MEDIUM").toUpperCase()}
                    </span>
                    {a.source && (
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(148,163,184,0.08)", color: srcColor, fontWeight: 600 }}>
                            {a.source}
                        </span>
                    )}
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>

            <div style={{ color: "#e2e8f0", fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>{a.message || "—"}</div>

            {a.rule_name && (
                <div style={{ color: "#334155", fontSize: 10, marginBottom: 6 }}>
                    Rule: <span style={{ color: "#64748b" }}>{a.rule_name}</span>
                </div>
            )}

            {a.timestamp && (
                <div style={{ color: "#334155", fontSize: 10, marginBottom: 8 }}>
                    {new Date(a.timestamp).toLocaleString()}
                </div>
            )}

            {a.source === "AIS" && (a.vessel || a.mmsi || a.speed != null || a.flag) && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.06)", paddingTop: 8, marginBottom: 4 }}>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Vessel</div>
                    {[["Name", a.vessel], ["MMSI", a.mmsi], ["Speed", a.speed != null ? `${a.speed} kn` : null], ["Flag", a.flag], ["Dest", a.destination]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                            <span style={{ color: "#475569", fontSize: 11 }}>{k}</span>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>{v}</span>
                        </div>
                    ))}
                </div>
            )}

            {a.source === "ADSB" && (a.aircraft || a.hex) && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.06)", paddingTop: 8, marginBottom: 4 }}>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Aircraft</div>
                    {[["Callsign", a.aircraft], ["ICAO24", a.hex]].filter(([, v]) => v).map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.04)" }}>
                            <span style={{ color: "#475569", fontSize: 11 }}>{k}</span>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>{v}</span>
                        </div>
                    ))}
                </div>
            )}

            {(a.provenance?.source_entity || a.provenance?.trigger_reason) && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.06)", paddingTop: 8, marginBottom: 4 }}>
                    <div style={{ color: "#334155", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>Provenance</div>
                    {a.provenance.source_entity && (
                        <div style={{ color: "#64748b", fontSize: 10, marginBottom: 3, wordBreak: "break-word" }}>{a.provenance.source_entity}</div>
                    )}
                    {a.provenance.trigger_reason && (
                        <div style={{ color: "#334155", fontSize: 10 }}>{a.provenance.trigger_reason}</div>
                    )}
                    {a.provenance.detection_rule && (
                        <div style={{ color: "#334155", fontSize: 10 }}>Trigger: {a.provenance.detection_rule}</div>
                    )}
                </div>
            )}

            {a.lat != null && (
                <div style={{ color: "#1e293b", fontSize: 10, marginTop: 6, textAlign: "right" }}>
                    {Number(a.lat).toFixed(4)}, {Number(a.lng ?? a.lon ?? 0).toFixed(4)}
                </div>
            )}
        </div>
    )
}
