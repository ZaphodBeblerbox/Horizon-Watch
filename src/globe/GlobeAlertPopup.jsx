import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import { ALERT_ICONS, FORGE_EXPLANATIONS } from "../constants/alertIcons.js"

const SEV_COLOR = {
    critical: "#f87171",
    high:     "#fb923c",
    medium:   "#fbbf24",
    info:     "#60a5fa",
}
const SEV_BG = {
    critical: "rgba(248,113,113,0.12)",
    high:     "rgba(251,146,60,0.12)",
    medium:   "rgba(251,191,36,0.12)",
    info:     "rgba(96,165,250,0.12)",
}
const SRC_COLOR = { AIS: "#0ea5e9", ADSB: "#a78bfa", NEWS: "#34d399", FUSION: "#BF5AF2" }

const WHAT_TO_WATCH = {
    "Cable Loiterer":       "Monitor vessel destination and AIS pattern over next 6h. Note any sister vessels in the area. Cross-check against known cable maintenance schedules.",
    "Dark Ship":            "Check vessel last known position, destination, and cargo type. Cross-reference with port entry logs. Watch for re-emergence at a different location.",
    "Chokepoint Loitering": "Assess vessel type and ownership. Verify against scheduled transits. Monitor for any communication with shore facilities or other vessels.",
    "Ship-to-Ship Transfer":"Identify both vessels. Check ownership chains and recent port calls. Note the geographic context — proximity to sanctioned ports or EEZs.",
    "Military Squawk":      "Identify aircraft type and origin. Correlate with any active military exercises in the region. Monitor for secondary squawk changes.",
    "Transponder Anomaly":  "Treat as potential emergency until confirmed otherwise. Check last known route and destination. Notify relevant authorities if squawk 7700 persists.",
}

function timeAgo(ts) {
    if (!ts) return ""
    try {
        const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
        if (m < 1)    return "just now"
        if (m < 60)   return `${m}m ago`
        if (m < 1440) return `${Math.floor(m / 60)}h ago`
        return `${Math.floor(m / 1440)}d ago`
    } catch { return "" }
}

function FlagImg({ url, emoji, size = 20 }) {
    const [err, setErr] = useState(false)
    if (!url || err) return <span style={{ fontSize: size * 0.8 }}>{emoji || "🏳"}</span>
    return (
        <img
            src={url}
            alt=""
            style={{ width: size * 1.4, height: size, objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
            onError={() => setErr(true)}
        />
    )
}

function TrackSummary({ track }) {
    if (!track?.length) return null
    const first = track[0]
    const last  = track[track.length - 1]
    const startTime = first?.timestamp ? new Date(first.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " UTC" : null

    let distNm = null
    if (track.length >= 2) {
        let total = 0
        for (let i = 1; i < track.length; i++) {
            const a = track[i - 1], b = track[i]
            const dLat = (b.lat - a.lat) * Math.PI / 180
            const dLon = (b.lon - a.lon) * Math.PI / 180
            const sin1 = Math.sin(dLat / 2), sin2 = Math.sin(dLon / 2)
            const c    = sin1 * sin1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sin2 * sin2
            total += 6371 * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c))
        }
        distNm = (total * 0.539957).toFixed(1)
    }

    return (
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {startTime && <span>Started {startTime}</span>}
            {distNm && <span>Distance: {distNm} nm</span>}
            <span>{track.length} points</span>
        </div>
    )
}

function SanctionedVesselPanel({ payload }) {
    const lists = payload?.sanction_lists || []
    const flag  = payload?.flag
    const owner = payload?.owner
    return (
        <div style={{
            margin: "8px 0",
            padding: "10px",
            background: "rgba(255,45,45,0.08)",
            border: "1px solid rgba(255,45,45,0.3)",
            borderRadius: 6,
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#FF2D2D", letterSpacing: 1.5, marginBottom: 6 }}>
                ⚠ SANCTIONS MATCH
            </div>
            {lists.map((list, i) => (
                <div key={i} style={{ fontSize: 11, color: "rgba(255,80,80,0.85)", marginBottom: 2 }}>
                    • {list}
                </div>
            ))}
            {(flag || owner) && (
                <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                    {flag && `Flag: ${flag}`}
                    {flag && owner && " · "}
                    {owner && `Owner: ${owner}`}
                </div>
            )}
        </div>
    )
}

function StsPanel({ payload }) {
    const vessels = [
        { mmsi: payload?.mmsi_a, name: payload?.vessel_a_name, flag: payload?.vessel_a_flag, type: payload?.vessel_a_type },
        { mmsi: payload?.mmsi_b, name: payload?.vessel_b_name, flag: payload?.vessel_b_flag, type: payload?.vessel_b_type },
    ]
    return (
        <div style={{ margin: "8px 0" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {vessels.map((v, i) => (
                    <div key={i} style={{
                        flex: 1, padding: "6px 8px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 4, fontSize: 10,
                    }}>
                        <div style={{ fontWeight: 700, color: "rgba(255,255,255,0.85)", marginBottom: 2 }}>
                            {v.name || v.mmsi}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.35)" }}>MMSI {v.mmsi}</div>
                        {v.flag && <div style={{ color: "rgba(255,255,255,0.35)" }}>Flag: {v.flag}</div>}
                        {v.type && <div style={{ color: "rgba(255,255,255,0.3)" }}>{v.type}</div>}
                    </div>
                ))}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 8, flexWrap: "wrap" }}>
                {payload?.duration_min    != null && <span>⏱ {payload.duration_min}min</span>}
                {payload?.min_distance_m  != null && <span>📏 {payload.min_distance_m}m proximity</span>}
                {payload?.distance_to_port_km != null && <span>🌊 {payload.distance_to_port_km}km offshore</span>}
            </div>
            {payload?.is_sanctions_related && (
                <div style={{
                    padding: "6px 10px",
                    background: "rgba(255,45,45,0.1)",
                    border: "1px solid rgba(255,45,45,0.3)",
                    borderRadius: 4, fontSize: 11,
                    color: "#FF2D2D", fontWeight: 700,
                }}>
                    ⚠ SANCTIONED VESSEL INVOLVED
                </div>
            )}
        </div>
    )
}

export default function GlobeAlertPopup({ data: a, onClose, viewerRef }) {
    const [forgeLinks,  setForgeLinks]  = useState([])
    const [photoErr,    setPhotoErr]    = useState(false)

    const sev      = a.severity || "medium"
    const sevColor = SEV_COLOR[sev]  || "#fbbf24"
    const sevBg    = SEV_BG[sev]     || "rgba(251,191,36,0.12)"
    const srcColor = SRC_COLOR[a.source] || "#94a3b8"
    const src      = (a.source || "").toUpperCase()

    const mmsi = a.mmsi  || a.vessel_mmsi || ""
    const icao = a.icao  || a.hex         || a.icao_hex || ""
    const alertId = a.id || a.alert_id    || ""

    const explanation  = a.explanation || FORGE_EXPLANATIONS[a.icon_type || a.rule_type || ""] || null
    const watchNote    = Object.keys(WHAT_TO_WATCH).find(k => (a.rule_name || a.message || "").includes(k))
    const watchText    = watchNote ? WHAT_TO_WATCH[watchNote] : null

    // Parsed payload for specialised panels
    const payload = (() => {
        try {
            const raw = a.payload || a.raw_json || null
            if (!raw) return {}
            if (typeof raw === "object") return raw
            return JSON.parse(raw)
        } catch { return {} }
    })()
    const isSanctioned = a.rule_name === "Sanctioned Vessel"
    const isSts        = a.rule_name === "Ship-to-Ship Transfer"

    // Fetch forge connections (ontology links for this alert)
    useEffect(() => {
        if (!alertId) return
        let cancelled = false
        fetch(`${API_BASE}/api/ontology-links?source_type=alert&source_id=${encodeURIComponent(alertId)}&limit=8`)
            .then(r => r.ok ? r.json() : [])
            .then(d => { if (!cancelled) setForgeLinks(Array.isArray(d) ? d : []) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [alertId])

    const flagUrl  = a.vessel_flag_url  || a.aircraft_flag_url  || null
    const flagEmoji= a.vessel_flag      || a.aircraft_flag      || null
    const country  = a.vessel_country   || a.aircraft_country   || null
    const isMilitary = a.aircraft_military

    // Identity header line
    const entityName = a.vessel || a.aircraft || a.entity_name || null
    const entityId   = mmsi || icao || null

    return (
        <div style={{ fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>

            {/* Aircraft image (planespotters) */}
            {src === "ADSB" && icao && !photoErr && (
                <div style={{ position: "relative", background: "#070d17" }}>
                    <img
                        src={`${API_BASE}/api/aviation/photo/${icao}`}
                        alt=""
                        style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }}
                        onError={() => setPhotoErr(true)}
                    />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, background: "linear-gradient(transparent, rgba(7,13,23,0.9))" }} />
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: "10px 12px 8px",
                borderBottom: `1px solid ${sevColor}30`,
                background: "rgba(10,15,26,0.6)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Flag + country + entity name */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                            {flagUrl && <FlagImg url={flagUrl} emoji={flagEmoji} size={16} />}
                            {country && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>{country}</span>}
                            {isMilitary && (
                                <span style={{ fontSize: 9, fontWeight: 700, background: "#ef444422", color: "#f87171", padding: "1px 5px", borderRadius: 3, border: "1px solid #f8717140" }}>
                                    MILITARY
                                </span>
                            )}
                            {a.aircraft_service && (
                                <span style={{ fontSize: 9, color: "#64748b" }}>{a.aircraft_service}</span>
                            )}
                        </div>
                        {/* Entity name + id */}
                        {(entityName || entityId) && (
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {entityName || ""}
                                {entityId && <span style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginLeft: 6 }}>{entityId}</span>}
                            </div>
                        )}
                        {/* Severity + source badges */}
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: sevBg, color: sevColor, fontWeight: 700 }}>
                                {sev.toUpperCase()}
                            </span>
                            {src && (
                                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(148,163,184,0.08)", color: srcColor, fontWeight: 600 }}>
                                    {src}
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 0 }}>✕</button>
                </div>
            </div>

            {/* Alert message */}
            <div style={{ padding: "8px 12px 6px" }}>
                <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.55, marginBottom: 8 }}>
                    {a.message || a.title || "—"}
                </div>

                {/* What is this */}
                {explanation && (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 3 }}>
                            What is this
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                            {explanation}
                        </div>
                    </div>
                )}

                {/* What to watch */}
                {watchText && (
                    <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(251,191,36,0.06)", borderRadius: 4, borderLeft: "2px solid rgba(251,191,36,0.35)" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 3 }}>
                            What to watch
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                            {watchText}
                        </div>
                    </div>
                )}

                {/* Sanctioned vessel panel */}
                {isSanctioned && <SanctionedVesselPanel payload={payload} />}

                {/* Ship-to-ship transfer panel */}
                {isSts && <StsPanel payload={payload} />}

                {/* Track section */}
                {(mmsi || icao) && (
                    <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(14,165,233,0.06)", borderRadius: 4, border: "1px solid rgba(14,165,233,0.12)" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 2 }}>
                            {src === "ADSB" ? "Aircraft Track (last 12h)" : "Vessel Track (last 24h)"}
                        </div>
                        {trackData
                            ? (trackData.point_count > 0
                                ? <>
                                    <div style={{ fontSize: 10, color: "#0ea5e9" }}>Track rendered on globe · {trackData.point_count} points</div>
                                    <TrackSummary track={trackData.track} />
                                  </>
                                : <div style={{ fontSize: 10, color: "#475569" }}>No track data in window</div>
                              )
                            : <div style={{ fontSize: 10, color: "#475569" }}>Loading track…</div>
                        }
                    </div>
                )}

                {/* AIS vessel detail rows */}
                {src === "AIS" && (a.vessel || mmsi || a.speed != null || a.flag) && (
                    <div style={{ marginBottom: 8 }}>
                        {[["Name", a.vessel], ["MMSI", mmsi || null], ["Speed", a.speed != null ? `${a.speed} kn` : null], ["Flag", a.flag], ["Dest", a.destination]]
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.04)", fontSize: 11 }}>
                                <span style={{ color: "#475569" }}>{k}</span>
                                <span style={{ color: "#94a3b8" }}>{v}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* ADSB aircraft detail rows */}
                {src === "ADSB" && (a.aircraft || icao) && (
                    <div style={{ marginBottom: 8 }}>
                        {[["Callsign", a.aircraft], ["ICAO24", icao || null], ["Squawk", a.squawk], ["Alt", a.altitude != null ? `${a.altitude} ft` : null]]
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.04)", fontSize: 11 }}>
                                <span style={{ color: "#475569" }}>{k}</span>
                                <span style={{ color: "#94a3b8" }}>{v}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Forge connections */}
                {forgeLinks.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 5 }}>
                            Forge Connections
                        </div>
                        {forgeLinks.map((link, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 5, marginBottom: 3, fontSize: 11 }}>
                                <span style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0, marginTop: 1 }}>→</span>
                                <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 500, flex: 1 }}>
                                    {link.entity_name || link.entity_id}
                                </span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontStyle: "italic", flexShrink: 0 }}>
                                    {(link.link_type || link.relationship_type || "").toLowerCase().replace(/_/g, " ")}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 10, color: "#334155" }}>
                        {a.lat != null && `${Number(a.lat).toFixed(3)}°, ${Number(a.lng ?? a.lon ?? 0).toFixed(3)}°`}
                        {a.timestamp && <span style={{ marginLeft: 6 }}>{timeAgo(a.timestamp)}</span>}
                    </div>
                    {a.rule_name && (
                        <div style={{ fontSize: 9, color: "#1e293b", textAlign: "right", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {a.rule_name}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
