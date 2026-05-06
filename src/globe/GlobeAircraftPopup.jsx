import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

export default function GlobeAircraftPopup({ data: ac, onClose, onFollow }) {
    const [photo, setPhoto] = useState(null)  // null=loading, false=none, {thumbnail_url,...}=loaded

    const icao = ac.icao ?? ac.icao24 ?? ""
    const cs   = (ac.flight || ac.callsign || "").trim() || icao
    const alt  = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude
    const gs   = ac.gs ?? ac.velocity ?? ac.ground_speed
    const isMil = !!(ac.military || ac.interesting)
    const isEmergency = ["7500","7600","7700"].includes(ac.squawk)

    useEffect(() => {
        if (!icao) { setPhoto(false); return }
        let cancelled = false
        fetch(`${API_BASE}/api/aviation/photo/${icao}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setPhoto(d?.thumbnail_url ? d : false) })
            .catch(() => { if (!cancelled) setPhoto(false) })
        return () => { cancelled = true }
    }, [icao])

    const altText = alt != null && !isNaN(Number(alt)) ? `${Number(alt).toLocaleString()} ft` : null
    const spdText = gs  != null ? `${Math.round(gs)} kts` : null
    const accent  = isMil ? "#FF5028" : isEmergency ? "#ef4444" : "#38bdf8"

    const rows = [
        ["ICAO",     icao],
        ["Callsign", cs !== icao ? cs : null],
        ["Altitude", altText],
        ["Speed",    spdText],
        ["Track",    ac.track != null ? `${ac.track}°` : null],
        ["Squawk",   ac.squawk],
        ["Origin",   ac.origin_country],
    ].filter(([, v]) => v)

    return (
        <div style={{ fontFamily: "Inter,-apple-system,sans-serif", overflow: "hidden" }}>
            {/* Photo */}
            {photo?.thumbnail_url && (
                <div style={{ position: "relative" }}>
                    <img
                        src={photo.thumbnail_url}
                        alt={cs}
                        style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }}
                        onError={e => { e.currentTarget.style.display = "none" }}
                    />
                    {photo.photographer && (
                        <span style={{
                            position: "absolute", bottom: 4, right: 6,
                            fontSize: 9, color: "rgba(255,255,255,0.5)",
                            background: "rgba(0,0,0,0.6)", padding: "1px 5px", borderRadius: 3,
                        }}>© {photo.photographer}</span>
                    )}
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: "10px 14px 8px",
                borderBottom: `1px solid ${accent}35`,
                background: "rgba(10,15,26,0.5)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>{cs}</div>
                        <div style={{ fontSize: 11, color: "#9AA4B5", marginTop: 2 }}>
                            {[altText, spdText].filter(Boolean).join(" · ")}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1, marginTop: 2 }}
                    >×</button>
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                    {isMil && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: "#FF5028", color: "#fff", padding: "2px 6px", borderRadius: 3 }}>
                            MILITARY
                        </span>
                    )}
                    {isEmergency && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: "#ef4444", color: "#fff", padding: "2px 6px", borderRadius: 3, animation: "pulse 1s infinite" }}>
                            EMERGENCY {ac.squawk}
                        </span>
                    )}
                </div>
            </div>

            {/* Data rows */}
            <div style={{ padding: "6px 14px 4px" }}>
                {rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(44,54,69,0.35)" }}>
                        <span style={{ color: "#9AA4B5" }}>{k}</span>
                        <span style={{ color: "#E8ECF1" }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, padding: "8px 14px 12px" }}>
                <button
                    onClick={onClose}
                    style={{ flex: 1, padding: "7px", background: "#1E2B3D", color: "#E8ECF1", border: "1px solid #2C3645", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
                >
                    Close
                </button>
                <button
                    onClick={onFollow}
                    style={{ flex: 1, padding: "7px", background: accent, color: "#0F1721", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                >
                    Follow ▶
                </button>
            </div>
        </div>
    )
}
