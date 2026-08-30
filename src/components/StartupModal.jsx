import { useState } from "react"

const BTN = {
    background:   "rgba(56,189,248,0.15)",
    border:       "1px solid rgba(56,189,248,0.35)",
    borderRadius: 8,
    padding:      "11px 20px",
    color:        "#e2e8f0",
    fontSize:     13,
    cursor:       "pointer",
    width:        "100%",
    textAlign:    "left",
    fontFamily:   "Inter, -apple-system, sans-serif",
}

export default function StartupModal({ onDismiss, onReadBriefing, onViewAlerts }) {
    const [dontShow, setDontShow] = useState(false)

    const handle = (action) => {
        if (dontShow) localStorage.setItem("hw-skip-startup-modal", "true")
        onDismiss()
        if (action === "briefing") onReadBriefing?.()
        if (action === "alerts")   onViewAlerts?.()
    }

    return (
        <div style={{
            position:   "fixed",
            inset:      0,
            background: "rgba(0,0,0,0.65)",
            display:    "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex:     10000,
            backdropFilter: "blur(4px)",
        }}>
            <div style={{
                background:    "rgba(15,23,42,0.96)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border:        "1px solid rgba(56,189,248,0.25)",
                borderRadius:  12,
                padding:       "32px 28px 24px",
                width:         380,
                fontFamily:    "var(--font-sans)",
            }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(56,189,248,0.7)", marginBottom: 10 }}>
                    AKILI
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
                    Welcome back
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 24, lineHeight: 1.5 }}>
                    Map is loading. What would you like to do?
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <button onClick={() => handle("briefing")} style={BTN}>
                        Read today's briefing
                    </button>
                    <button onClick={() => handle("alerts")} style={BTN}>
                        View latest alerts
                    </button>
                    <button
                        onClick={() => handle("map")}
                        style={{ ...BTN, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b" }}
                    >
                        Go to map
                    </button>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, color: "#475569", fontSize: 11, cursor: "pointer", userSelect: "none" }}>
                    <input
                        type="checkbox"
                        checked={dontShow}
                        onChange={e => setDontShow(e.target.checked)}
                        style={{ cursor: "pointer" }}
                    />
                    Don't show again
                </label>
            </div>
        </div>
    )
}
