import { useState } from "react"
import { ALERT_ICONS } from "../constants/alertIcons.js"
import { safeArray } from "../utils/safeArray.js"

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

export default function GlobeAssessmentPopup({ data, onClose }) {
    const a = data || {}
    const [showEvidence, setShowEvidence] = useState(false)

    const sev      = a.severity || "medium"
    const sevColor = SEV_COLOR[sev] || "#60a5fa"
    const sevBg    = SEV_BG[sev]    || "rgba(96,165,250,0.12)"
    const iconDef  = ALERT_ICONS[a.icon_type || ""] || {}
    const typeColor = iconDef.color || sevColor

    const keySignals  = safeArray(a.key_signals)
    const evidence    = safeArray(a.evidence_items)
    const confidence  = typeof a.confidence === "number" ? a.confidence : null

    return (
        <div style={{ padding: "12px 14px", fontFamily: "system-ui, sans-serif", minWidth: 260, maxWidth: 340 }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span style={{
                        fontSize: 9, padding: "2px 7px", borderRadius: 3,
                        background: sevBg, color: sevColor, fontWeight: 700, letterSpacing: "0.06em",
                    }}>
                        {sev.toUpperCase()}
                    </span>
                    <span style={{
                        fontSize: 9, padding: "2px 7px", borderRadius: 3,
                        background: typeColor + "22", color: typeColor, fontWeight: 600,
                    }}>
                        {(a.pattern_type || a.assessment_type || "NEWS").replace(/_/g, " ")}
                    </span>
                    {a.domain && (
                        <span style={{
                            fontSize: 9, padding: "2px 7px", borderRadius: 3,
                            background: "rgba(148,163,184,0.08)", color: "#64748b",
                        }}>
                            {a.domain}
                        </span>
                    )}
                </div>
                <button onClick={onClose} style={{
                    background: "none", border: "none", color: "#475569",
                    cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 0,
                }}>✕</button>
            </div>

            {/* Headline */}
            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, lineHeight: 1.4, marginBottom: 8 }}>
                {a.title || a.headline || "Intelligence Assessment"}
            </div>

            {/* Confidence + evidence bar */}
            <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                {confidence !== null && (
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        Confidence: <span style={{ color: typeColor, fontWeight: 600 }}>{Math.round(confidence * 100)}%</span>
                    </div>
                )}
                {(a.evidence_count || evidence.length) > 0 && (
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        Based on <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{a.evidence_count || evidence.length}</span> article{(a.evidence_count || evidence.length) !== 1 ? "s" : ""}
                        {a.timeframe_hours && <span> in last {a.timeframe_hours}h</span>}
                    </div>
                )}
            </div>

            {/* Summary */}
            {a.message && (
                <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.55, marginBottom: 8 }}>
                    {a.message}
                </div>
            )}

            {/* Key signals */}
            {keySignals.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{
                        fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                        color: "#334155", marginBottom: 4,
                    }}>Key Signals</div>
                    {keySignals.map((s, i) => (
                        <div key={i} style={{
                            fontSize: 10, color: "#64748b", padding: "2px 0",
                            display: "flex", alignItems: "flex-start", gap: 5,
                        }}>
                            <span style={{ color: typeColor, flexShrink: 0 }}>▸</span>
                            {s}
                        </div>
                    ))}
                </div>
            )}

            {/* View Evidence toggle */}
            {(evidence.length > 0 || a.evidence_count > 0) && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.07)", paddingTop: 8, marginTop: 4 }}>
                    <button
                        onClick={() => setShowEvidence(v => !v)}
                        style={{
                            width: "100%", padding: "5px 10px",
                            background: showEvidence ? typeColor + "22" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${showEvidence ? typeColor + "44" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: 4, color: showEvidence ? typeColor : "#475569",
                            cursor: "pointer", fontSize: 10, fontWeight: 600,
                            textAlign: "left",
                        }}
                    >
                        {showEvidence ? "▾" : "▸"} View Evidence ({evidence.length || a.evidence_count} articles)
                    </button>

                    {showEvidence && evidence.length > 0 && (
                        <div style={{ marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
                            {evidence.map((e, i) => (
                                <div key={i} style={{
                                    padding: "5px 0",
                                    borderBottom: "1px solid rgba(148,163,184,0.05)",
                                }}>
                                    <div style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.3 }}>
                                        {e.url ? (
                                            <a href={e.url} target="_blank" rel="noopener noreferrer"
                                               style={{ color: "#38bdf8", textDecoration: "none" }}>
                                                {e.title || "Article"}
                                            </a>
                                        ) : (e.title || "Article")}
                                    </div>
                                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                                        {e.source && <span style={{ fontSize: 9, color: "#475569" }}>{e.source}</span>}
                                        {e.article_type && (
                                            <span style={{ fontSize: 9, color: typeColor + "bb" }}>
                                                {e.article_type}
                                            </span>
                                        )}
                                        {e.relevance_score != null && (
                                            <span style={{ fontSize: 9, color: "#334155" }}>
                                                {Number(e.relevance_score).toFixed(1)}/10
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Location footer */}
            {a.location && (
                <div style={{ fontSize: 9, color: "#1e293b", marginTop: 8, textAlign: "right" }}>
                    {a.location}
                    {a.lat != null && ` · ${Number(a.lat).toFixed(3)}, ${Number(a.lng ?? a.lon ?? 0).toFixed(3)}`}
                </div>
            )}
        </div>
    )
}
