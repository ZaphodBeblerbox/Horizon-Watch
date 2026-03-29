import { useState } from "react"
import API_BASE from "../apiBase.js"

function StatCard({ label, value }) {
    return (
        <div style={{
            background: "rgba(30, 41, 59, 0.6)",
            border: "1px solid rgba(56, 189, 248, 0.15)",
            borderRadius: 8,
            padding: 12,
        }}>
            <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                {label}
            </div>
            <div style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 500 }}>
                {value || "—"}
            </div>
        </div>
    )
}

export default function EEZPanel({ eez, onClose, isMobile }) {
    const [detail, setDetail]   = useState(null)
    const [loading, setLoading] = useState(false)
    const [fetched, setFetched] = useState(null)

    if (eez && eez.mrgid !== fetched && !loading) {
        setLoading(true)
        setDetail(null)
        setFetched(eez.mrgid)
        fetch(`${API_BASE}/geo/eez/${eez.mrgid}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setDetail(d); setLoading(false) })
            .catch(() => setLoading(false))
    }

    if (!eez) return null

    const name      = detail?.name      || eez.name      || "EEZ Zone"
    const country   = detail?.country   || eez.country   || ""
    const sovereign = detail?.sovereign || eez.sovereign || ""
    const areaSqKm  = detail?.area_km2  || eez.area_km2
    const areaFmt   = areaSqKm ? `${(areaSqKm / 1_000_000).toFixed(2)}M km²` : null
    const wiki      = detail?.wikipedia || ""
    const polType   = detail?.pol_type  || "EEZ"
    const wikiUrl   = `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/ /g, "_"))}`

    const panelStyle = isMobile ? {
        position:             "fixed",
        left: 0, right: 0, bottom: 0,
        maxHeight:            "65vh",
        borderRadius:         "18px 18px 0 0",
        zIndex:               1150,
        background:           "rgba(10, 14, 22, 0.98)",
        backdropFilter:       "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop:               "1px solid rgba(56, 189, 248, 0.2)",
        overflowY:               "auto",
        WebkitOverflowScrolling: "touch",
        fontFamily:              "system-ui, -apple-system, sans-serif",
    } : {
        position:             "fixed",
        top:                  48,
        right:                0,
        bottom:               0,
        width:                380,
        zIndex:               1150,
        background:           "rgba(15, 23, 42, 0.92)",
        backdropFilter:       "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderLeft:           "1px solid rgba(56, 189, 248, 0.2)",
        display:              "flex",
        flexDirection:        "column",
        fontFamily:           "system-ui, -apple-system, sans-serif",
    }

    return (
        <div style={panelStyle}>
            {/* Header */}
            <div style={{
                padding:        "16px",
                borderBottom:   "1px solid rgba(56, 189, 248, 0.15)",
                display:        "flex",
                justifyContent: "space-between",
                alignItems:     "flex-start",
                flexShrink:     0,
            }}>
                <div>
                    <div style={{
                        color:          "#0ea5e9",
                        fontSize:       11,
                        fontWeight:     600,
                        textTransform:  "uppercase",
                        letterSpacing:  "1px",
                        marginBottom:   4,
                    }}>
                        Exclusive Economic Zone
                    </div>
                    <h2 style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 500, margin: 0 }}>
                        {country || name}
                    </h2>
                    {sovereign && sovereign !== country && (
                        <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>
                            Sovereign: {sovereign}
                        </div>
                    )}
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background:   "rgba(30, 41, 59, 0.8)",
                        border:       "1px solid rgba(148, 163, 184, 0.3)",
                        borderRadius: 6,
                        color:        "#e2e8f0",
                        padding:      "6px 12px",
                        cursor:       "pointer",
                        fontSize:     16,
                        lineHeight:   1,
                        flexShrink:   0,
                    }}
                >
                    ×
                </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "16px" }}>
                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <StatCard label="Area"    value={areaFmt} />
                    <StatCard label="Type"    value={polType} />
                </div>

                {/* Zone name (if different from country) */}
                {name !== country && (
                    <div style={{
                        background:   "rgba(30, 41, 59, 0.5)",
                        border:       "1px solid rgba(56, 189, 248, 0.1)",
                        borderRadius: 8,
                        padding:      "10px 12px",
                        marginBottom: 14,
                    }}>
                        <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", marginBottom: 4 }}>
                            Zone Name
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: 13 }}>
                            {name}
                        </div>
                    </div>
                )}

                {loading && (
                    <div style={{ color: "#64748b", fontSize: 13, padding: "6px 0", marginBottom: 12 }}>
                        Loading details...
                    </div>
                )}

                {/* Wikipedia extract */}
                {wiki && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{
                            color:         "#38bdf8",
                            fontSize:      11,
                            fontWeight:    600,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            marginBottom:  8,
                        }}>
                            About
                        </div>
                        <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.65, margin: 0 }}>
                            {wiki.length > 600 ? wiki.slice(0, 600) + "…" : wiki}
                        </p>
                    </div>
                )}

                {/* EEZ explainer */}
                <div style={{
                    background:   "rgba(30, 41, 59, 0.5)",
                    border:       "1px solid rgba(56, 189, 248, 0.1)",
                    borderRadius: 8,
                    padding:      14,
                    marginBottom: 14,
                }}>
                    <h4 style={{
                        color:         "#38bdf8",
                        fontSize:      11,
                        fontWeight:    600,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        margin:        0,
                    }}>
                        What is an EEZ?
                    </h4>
                    <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, margin: "8px 0 0 0" }}>
                        An Exclusive Economic Zone extends 200 nautical miles from a country's coastline.
                        The sovereign state has exclusive rights to explore, exploit, and manage natural
                        resources — including fishing, oil, and gas — in these waters.
                    </p>
                </div>

                {/* Wikipedia link */}
                <button
                    onClick={() => window.open(wikiUrl, "_blank", "noopener")}
                    style={{
                        width:        "100%",
                        background:   "rgba(56, 189, 248, 0.1)",
                        border:       "1px solid rgba(56, 189, 248, 0.3)",
                        borderRadius: 8,
                        padding:      12,
                        color:        "#38bdf8",
                        fontSize:     14,
                        cursor:       "pointer",
                        textAlign:    "left",
                    }}
                >
                    Read more on Wikipedia →
                </button>
            </div>
        </div>
    )
}
