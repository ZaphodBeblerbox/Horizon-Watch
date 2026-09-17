// AlertStrip — appears at the bottom only when flagged events exist.
// Flagged threshold driven by Mission Profile:
//   0 = Minimal  : fatalities >5 or Battles only
//   1 = Standard : fatalities >0 or Battles/Explosions/Violence (default)
//   2 = High     : standard + Riots/Protests/Strategic developments
// Never shown automatically — user opens it via the Alerts button.

const SEVERITY_TYPES = new Set([
    "Battles",
    "Explosions/Remote violence",
    "Violence against civilians",
])

const HIGH_SENSITIVITY_TYPES = new Set([
    "Battles",
    "Explosions/Remote violence",
    "Violence against civilians",
    "Riots",
    "Protests",
    "Strategic developments",
])

export function isFlagged(ev, profile = null) {
    const threshold = profile?.threshold ?? 1
    const type = ev.type || ev.event_type || ""
    const fatalities = Number(ev.fatalities) || 0
    const relevance = Number(ev.relevance_score || ev.significance_score || 0)
    const confidence = String(ev.confidence || "").toLowerCase()
    const severeNews = relevance >= 55 || ["armed_clash", "missile", "explosion"].includes(type)

    if (threshold === 0) {
        return fatalities > 5 || type === "Battles" || (severeNews && confidence === "high")
    }
    if (threshold === 2) {
        return fatalities > 0 || HIGH_SENSITIVITY_TYPES.has(type) || relevance >= 45 || severeNews
    }
    return fatalities > 0 || SEVERITY_TYPES.has(type) || severeNews
}

export default function AlertStrip({ events, onClose }) {
    if (!events || events.length === 0) return null

    const high = events.filter(e => e.fatalities > 0)
    const other = events.filter(e => e.fatalities <= 0)

    return (
        <div style={{
            position: "fixed",
            bottom: 0, left: 0, right: 0,
            background: "var(--akili-panel)",
            borderTop: "1px solid rgba(239,68,68,0.28)",
            padding: "8px 14px",
            zIndex: 999,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            maxHeight: 220,
            overflowY: "auto",
        }}>
            {/* Status indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingTop: 2 }}>
                <div style={{
                    width: 7, height: 7,
                    background: "#ef4444",
                    borderRadius: "50%",
                    boxShadow: "0 0 8px #ef4444",
                    animation: "alertPulse 1.8s ease infinite",
                }} />
                <span style={{
                    fontSize: 9,
                    fontWeight: 800,
                    color: "#ef4444",
                    letterSpacing: "0.12em",
                    whiteSpace: "nowrap",
                }}>
                    {events.length} FLAGGED
                </span>
            </div>

            {/* Event pills */}
            <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                {events.slice(0, 8).map((ev, i) => {
                    const hasFat = ev.fatalities > 0
                    const loc = ev.location || ev.country || "Unknown"
                    const type = (ev.type || ev.event_type || "").split("/")[0].trim()
                    return (
                        <div key={ev.id || ev.event_id_cnty || i} style={{
                            background: hasFat ? "rgba(239,68,68,0.10)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${hasFat ? "rgba(239,68,68,0.28)" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: 4,
                            padding: "3px 8px",
                            fontSize: 9,
                            color: hasFat ? "rgba(255,180,180,0.85)" : "rgba(255,255,255,0.45)",
                            whiteSpace: "nowrap",
                        }}>
                            {loc}
                            {type ? ` · ${type}` : ""}
                            {hasFat ? ` · ${ev.fatalities}†` : ""}
                        </div>
                    )
                })}
                {events.length > 8 && (
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", padding: "3px 0" }}>
                        +{events.length - 8} more
                    </span>
                )}
            </div>

            {/* Close */}
            <button
                onClick={onClose}
                style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,255,255,0.25)",
                    cursor: "pointer",
                    fontSize: 15,
                    padding: "0 2px",
                    flexShrink: 0,
                    lineHeight: 1,
                    marginTop: 1,
                }}
            >
                ✕
            </button>

            <style>{`
                @keyframes alertPulse {
                    0%, 100% { opacity: 1; box-shadow: 0 0 8px #ef4444; }
                    50% { opacity: 0.5; box-shadow: 0 0 3px #ef4444; }
                }
            `}</style>
        </div>
    )
}
