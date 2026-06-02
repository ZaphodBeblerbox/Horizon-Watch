import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

export default function GlobeChokepointPopup({ data, onClose }) {
    const [status,  setStatus]  = useState(null)
    const [loading, setLoading] = useState(true)

    const id   = data?.system_id || data?.id || data?.name?.toLowerCase().replace(/\s+/g, "-") || ""
    const name = data?.name || "Chokepoint"

    useEffect(() => {
        if (!id) { setLoading(false); return }
        setLoading(true)
        fetch(`${API_BASE}/api/chokepoints/${encodeURIComponent(id)}/status`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setStatus(d); setLoading(false) })
            .catch(() => setLoading(false))
    }, [id])

    const s = status

    return (
        <div style={{ fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)", overflow: "hidden", minWidth: 260, maxWidth: 320 }}>

            {/* Satellite image */}
            {s?.image_url && (
                <div style={{ height: 160, overflow: "hidden", position: "relative", flexShrink: 0, background: "#060A10" }}>
                    <img
                        src={s.image_url}
                        alt={name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        onError={e => { e.target.parentElement.style.display = "none" }}
                    />
                    {s.image_caption && (
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.6)", padding: "3px 8px", fontSize: 8, color: "rgba(255,255,255,0.5)" }}>
                            {s.image_caption}
                        </div>
                    )}
                </div>
            )}

            {/* Loading placeholder image area */}
            {loading && (
                <div style={{ height: 100, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>LOADING IMAGERY</span>
                </div>
            )}

            {/* Status header */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e8ecf1" }}>{s?.name || name}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 3, letterSpacing: 1 }}>
                        {s?.vessel_count_24h || 0} VESSELS · {s?.alert_count_24h || 0} ALERTS · 24H
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {s?.current_status && (
                        <div style={{
                            padding: "2px 8px",
                            border: `1px solid ${_statusColor(s.current_status)}44`,
                            color: _statusColor(s.current_status),
                            background: `${_statusColor(s.current_status)}11`,
                            fontSize: 8, fontWeight: 700, letterSpacing: 2,
                        }}>
                            {s.current_status.toUpperCase()}
                        </div>
                    )}
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
                    >×</button>
                </div>
            </div>

            {/* Threat score bar */}
            {s?.threat_score > 0 && (
                <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 2, background: "rgba(255,255,255,0.06)" }}>
                        <div style={{ width: `${Math.min(100, s.threat_score)}%`, height: "100%", background: _statusColor(s.current_status) }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: _statusColor(s.current_status), minWidth: 28, textAlign: "right" }}>
                        {Math.round(s.threat_score)}
                    </span>
                </div>
            )}

            {/* Auto-brief / paragraph */}
            {(s?.auto_brief || s?.paragraph) && (
                <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: 2, marginBottom: 6 }}>CURRENT SITUATION</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.65 }}>
                        {s.auto_brief || s.paragraph}
                    </div>
                </div>
            )}

            {/* Strategic description fallback */}
            {!s?.auto_brief && !s?.paragraph && data?.strategic_description && (
                <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: 2, marginBottom: 6 }}>STRATEGIC SIGNIFICANCE</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.65 }}>{data.strategic_description}</div>
                </div>
            )}

            {/* Active alerts */}
            {s?.recent_headlines?.length > 0 && (
                <div style={{ padding: "8px 14px" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: 2, marginBottom: 6 }}>RECENT INTELLIGENCE</div>
                    {s.recent_headlines.slice(0, 3).map((h, i) => (
                        <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 4, lineHeight: 1.4 }}>
                            {h.length > 80 ? h.slice(0, 77) + "…" : h}
                        </div>
                    ))}
                </div>
            )}

            {/* Footer coords */}
            {(data?.lat != null) && (
                <div style={{ padding: "6px 14px 8px", fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 1 }}>
                    {Number(data.lat).toFixed(3)}°, {Number(data.lon).toFixed(3)}°
                </div>
            )}
        </div>
    )
}

function _statusColor(status) {
    if (!status) return "#FF6D00"
    switch (status.toLowerCase()) {
        case "critical":   return "#CC2200"
        case "disrupted":  return "#CC6600"
        case "elevated":   return "#AA8800"
        default:           return "#226644"
    }
}
