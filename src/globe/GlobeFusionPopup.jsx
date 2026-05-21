import { useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { FORGE_EXPLANATIONS } from "../constants/alertIcons.js"

const SEV_COLOR = {
    critical: "#f87171",
    high:     "#fb923c",
    medium:   "#fbbf24",
    info:     "#60a5fa",
}

const DOMAIN_COLOR = {
    AIS:      "#34AADC",
    NEWS:     "#FF9500",
    SENTINEL: "#30D158",
    ADSB:     "#5856D6",
    FUSION:   "#BF5AF2",
}

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
        "Content-Type": "application/json",
    }
}

function ConfidenceBar({ value, color }) {
    const pct = Math.round((value || 0) * 100)
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
                flex: 1, height: 4, borderRadius: 2,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
            }}>
                <div style={{
                    width: `${pct}%`, height: "100%",
                    background: color, borderRadius: 2,
                    transition: "width 0.3s ease",
                }} />
            </div>
            <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 28, textAlign: "right" }}>
                {pct}%
            </span>
        </div>
    )
}

export default function GlobeFusionPopup({ data, onClose }) {
    const f = data || {}
    const [showSignals,  setShowSignals]  = useState(false)
    const [noteOpen,     setNoteOpen]     = useState(false)
    const [noteText,     setNoteText]     = useState(f.analyst_notes || "")
    const [noteSaving,   setNoteSaving]   = useState(false)
    const [resolved,     setResolved]     = useState(f.status === "resolved")

    const sev       = f.severity || "medium"
    const sevColor  = SEV_COLOR[sev] || "#60a5fa"
    const fusColor  = "#BF5AF2"

    const domains           = safeArray(f.domains)
    const keySignals        = safeArray(f.key_signals)
    const threatIndicators  = safeArray(f.threat_indicators)
    const contribSignals    = safeArray(f.resolved_signals)
    const explanation       = FORGE_EXPLANATIONS[f.icon_type || f.pattern_type || "FUSION_EVENT"] || FORGE_EXPLANATIONS.FUSION_EVENT

    const handleSaveNote = async () => {
        setNoteSaving(true)
        try {
            await fetch(`${API_BASE}/api/fusions/${f.fusion_id}`, {
                method:  "PUT",
                headers: forgeHeaders(),
                body:    JSON.stringify({ analyst_notes: noteText }),
            })
        } catch { /* silent */ }
        setNoteSaving(false)
        setNoteOpen(false)
    }

    const handleResolve = async () => {
        try {
            await fetch(`${API_BASE}/api/fusions/${f.fusion_id}`, {
                method:  "DELETE",
                headers: forgeHeaders(),
            })
            setResolved(true)
        } catch { /* silent */ }
    }

    const handleBriefDirector = () => {
        window.dispatchEvent(new CustomEvent("brief-director-fusion", {
            detail: { fusion_id: f.fusion_id, title: f.title },
        }))
        onClose()
    }

    return (
        <div style={{ padding: "12px 14px", fontFamily: "system-ui, sans-serif", minWidth: 270, maxWidth: 360 }}>

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 8 }}>
                <div>
                    <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        color: fusColor, marginBottom: 4,
                    }}>
                        ⚡ INTELLIGENCE FUSION
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <span style={{
                            fontSize: 9, padding: "2px 7px", borderRadius: 3,
                            background: sevColor + "22", color: sevColor, fontWeight: 700,
                            letterSpacing: "0.05em",
                        }}>
                            {sev.toUpperCase()}
                        </span>
                        {domains.map(d => (
                            <span key={d} style={{
                                fontSize: 9, padding: "2px 7px", borderRadius: 3,
                                background: (DOMAIN_COLOR[d] || "#64748b") + "22",
                                color:      DOMAIN_COLOR[d] || "#64748b",
                                fontWeight: 600,
                            }}>{d}</span>
                        ))}
                        {resolved && (
                            <span style={{
                                fontSize: 9, padding: "2px 7px", borderRadius: 3,
                                background: "rgba(100,116,139,0.15)", color: "#64748b",
                            }}>RESOLVED</span>
                        )}
                    </div>
                </div>
                <button onClick={onClose} style={{
                    background: "none", border: "none", color: "#475569",
                    cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 0,
                }}>✕</button>
            </div>

            {/* Title / subtitle */}
            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, lineHeight: 1.4, marginBottom: 2 }}>
                {f.title || "Intelligence Fusion Event"}
            </div>
            {f.subtitle && (
                <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8 }}>{f.subtitle}</div>
            )}

            {/* Confidence bar */}
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: "#334155", marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Confidence · {f.signal_count || 0} signal{(f.signal_count || 0) !== 1 ? "s" : ""} · {domains.length} domain{domains.length !== 1 ? "s" : ""}
                </div>
                <ConfidenceBar value={f.confidence} color={fusColor} />
            </div>

            {/* What this means */}
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>
                    What this means
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                    {explanation}
                </div>
            </div>

            {/* Narrative */}
            {f.narrative && (
                <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.55, marginBottom: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                    {f.narrative}
                </div>
            )}

            {/* Key signals */}
            {keySignals.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "#334155", marginBottom: 4 }}>
                        Key Signals
                    </div>
                    {keySignals.map((s, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#64748b", padding: "2px 0", display: "flex", gap: 5, alignItems: "flex-start" }}>
                            <span style={{ color: fusColor, flexShrink: 0 }}>▸</span>
                            {s}
                        </div>
                    ))}
                </div>
            )}

            {/* Threat indicators */}
            {threatIndicators.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "#7f1d1d", marginBottom: 4 }}>
                        Threat Indicators
                    </div>
                    {threatIndicators.map((t, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#f87171", padding: "2px 0", display: "flex", gap: 5, alignItems: "flex-start" }}>
                            <span style={{ flexShrink: 0 }}>⚠</span>
                            {t}
                        </div>
                    ))}
                </div>
            )}

            {/* Contributing signals expandable */}
            {contribSignals.length > 0 && (
                <div style={{ borderTop: "1px solid rgba(148,163,184,0.07)", paddingTop: 8, marginTop: 4, marginBottom: 8 }}>
                    <button
                        onClick={() => setShowSignals(v => !v)}
                        style={{
                            width: "100%", padding: "5px 10px",
                            background: showSignals ? fusColor + "22" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${showSignals ? fusColor + "44" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: 4, color: showSignals ? fusColor : "#475569",
                            cursor: "pointer", fontSize: 10, fontWeight: 600, textAlign: "left",
                        }}
                    >
                        {showSignals ? "▾" : "▸"} Contributing Signals ({contribSignals.length})
                    </button>
                    {showSignals && (
                        <div style={{ marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                            {contribSignals.map((s, i) => (
                                <div key={i} style={{
                                    padding: "4px 0",
                                    borderBottom: "1px solid rgba(148,163,184,0.05)",
                                }}>
                                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                        <span style={{
                                            fontSize: 8, padding: "1px 5px", borderRadius: 2,
                                            background: (DOMAIN_COLOR[s.domain] || "#64748b") + "22",
                                            color:      DOMAIN_COLOR[s.domain] || "#64748b",
                                            fontWeight: 600,
                                        }}>{s.domain || "?"}</span>
                                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{s.rule_name || s.signal_id}</span>
                                    </div>
                                    {s.summary && (
                                        <div style={{ fontSize: 9, color: "#475569", marginTop: 2, paddingLeft: 2 }}>{s.summary}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Analyst notes */}
            {noteOpen && (
                <div style={{ marginBottom: 8 }}>
                    <textarea
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Add analyst notes..."
                        style={{
                            width: "100%", boxSizing: "border-box", minHeight: 64,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 4, color: "#e2e8f0", fontSize: 11, padding: "6px 8px",
                            resize: "vertical", fontFamily: "system-ui, sans-serif",
                        }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button
                            onClick={handleSaveNote}
                            disabled={noteSaving}
                            style={{
                                flex: 1, padding: "4px 8px", fontSize: 10, fontWeight: 600,
                                background: fusColor + "33", border: `1px solid ${fusColor}66`,
                                borderRadius: 4, color: fusColor, cursor: "pointer",
                            }}
                        >{noteSaving ? "Saving…" : "Save Note"}</button>
                        <button
                            onClick={() => setNoteOpen(false)}
                            style={{
                                padding: "4px 8px", fontSize: 10,
                                background: "none", border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: 4, color: "#475569", cursor: "pointer",
                            }}
                        >Cancel</button>
                    </div>
                </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                {!resolved && (
                    <button
                        onClick={handleResolve}
                        style={{
                            padding: "4px 9px", fontSize: 10, fontWeight: 600,
                            background: "rgba(248,113,113,0.12)",
                            border: "1px solid rgba(248,113,113,0.3)",
                            borderRadius: 4, color: "#f87171", cursor: "pointer",
                        }}
                    >Resolve</button>
                )}
                <button
                    onClick={() => setNoteOpen(v => !v)}
                    style={{
                        padding: "4px 9px", fontSize: 10, fontWeight: 600,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 4, color: "#64748b", cursor: "pointer",
                    }}
                >Add Note</button>
                <button
                    onClick={handleBriefDirector}
                    style={{
                        padding: "4px 9px", fontSize: 10, fontWeight: 600,
                        background: fusColor + "22",
                        border: `1px solid ${fusColor}44`,
                        borderRadius: 4, color: fusColor, cursor: "pointer",
                    }}
                >⚡ Brief Director</button>
            </div>

            {/* Location footer */}
            {(f.location_name || f.location_country) && (
                <div style={{ fontSize: 9, color: "#1e293b", marginTop: 10, textAlign: "right" }}>
                    {[f.location_name, f.location_country].filter(Boolean).join(" · ")}
                    {f.lat != null && ` · ${Number(f.lat).toFixed(3)}, ${Number(f.lon ?? 0).toFixed(3)}`}
                </div>
            )}
        </div>
    )
}
