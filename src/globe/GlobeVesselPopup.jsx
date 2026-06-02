import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import { VESSEL_COLORS, vesselShipType } from "./iconUtils.js"

function FlagImg({ url, emoji }) {
    const [err, setErr] = useState(false)
    if (!url || err) return <span style={{ fontSize: 14 }}>{emoji || "🏳"}</span>
    return <img src={url} alt="" style={{ width: 22, height: 15, objectFit: "cover", borderRadius: 2 }} onError={() => setErr(true)} />
}

export default function GlobeVesselPopup({ data: v, onClose, onFollow }) {
    const [photo,    setPhoto]    = useState(null)
    const [identity, setIdentity] = useState(null)

    const mmsi     = v.mmsi ?? ""
    const name     = v.name || "Unknown Vessel"
    const shipType = vesselShipType(v)
    const accent   = VESSEL_COLORS[shipType] || VESSEL_COLORS.other
    const sog      = v.sog ?? v.speed
    const hdg      = isFinite(Number(v.heading)) && Number(v.heading) !== 511
        ? Number(v.heading)
        : (v.cog ?? null)

    useEffect(() => {
        if (!mmsi) return
        let cancelled = false
        fetch(`${API_BASE}/api/vessels/${mmsi}/track?hours=1`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d?.identity) setIdentity(d.identity) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [mmsi])

    useEffect(() => {
        if (!mmsi) { setPhoto(false); return }
        let cancelled = false
        fetch(`${API_BASE}/api/vessel/photo/${mmsi}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setPhoto(d?.available && d.thumbnail_url ? d : false) })
            .catch(() => { if (!cancelled) setPhoto(false) })
        return () => { cancelled = true }
    }, [mmsi])

    const rows = [
        ["MMSI",        mmsi],
        ["Callsign",    v.callsign],
        ["Type",        v.ship_type || shipType],
        ["SOG",         sog != null ? `${Number(sog).toFixed(1)} kn` : null],
        ["Heading",     hdg != null ? `${hdg}°` : null],
        ["Destination", v.destination],
        ["Status",      v.nav_status],
        ["Dimensions",  v.length ? `${v.length}m × ${v.beam || "?"}m` : null],
    ].filter(([, val]) => val)

    return (
        <div style={{ fontFamily: "Inter,-apple-system,sans-serif", overflow: "hidden" }}>
            {/* Photo */}
            {photo?.thumbnail_url && (
                <div style={{ position: "relative" }}>
                    <img
                        src={photo.thumbnail_url}
                        alt={name}
                        style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }}
                        onError={e => { e.currentTarget.style.display = "none" }}
                    />
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {identity?.flag_url && <FlagImg url={identity.flag_url} emoji={identity.flag_emoji} />}
                            <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>{name}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#9AA4B5", marginTop: 2 }}>
                            {[identity?.flag_country, v.ship_type || shipType, sog != null ? `${Number(sog).toFixed(1)} kn` : null]
                                .filter(Boolean).join(" · ")}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "#9AA4B5", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1, marginTop: 2 }}
                    >×</button>
                </div>
            </div>

            {/* Data rows */}
            <div style={{ padding: "6px 14px 4px" }}>
                {rows.map(([k, val]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(44,54,69,0.35)" }}>
                        <span style={{ color: "#9AA4B5" }}>{k}</span>
                        <span style={{ color: "#E8ECF1" }}>{val}</span>
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
