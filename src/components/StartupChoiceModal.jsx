export default function StartupChoiceModal({ onChoice }) {
    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(15,23,42,0.97)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            zIndex:         99999,
            fontFamily:     "Inter, system-ui, -apple-system, sans-serif",
        }}>
            <div style={{
                background:      "rgba(30,41,59,0.9)",
                backdropFilter:  "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border:          "1px solid rgba(56,189,248,0.2)",
                borderRadius:    12,
                padding:         "40px 36px",
                maxWidth:        400,
                width:           "calc(100% - 32px)",
                textAlign:       "center",
            }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", marginBottom: 14, textTransform: "uppercase" }}>
                    Horizon Watch
                </div>
                <h1 style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 400, marginBottom: 8, letterSpacing: "0.02em" }}>
                    Good to see you
                </h1>
                <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 32, lineHeight: 1.5 }}>
                    Intelligence is loading. Where do you want to start?
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <button
                        onClick={() => onChoice("news")}
                        style={{
                            padding:      "15px 20px",
                            fontSize:     14,
                            fontWeight:   500,
                            border:       "1px solid rgba(56,189,248,0.3)",
                            borderRadius: 8,
                            background:   "rgba(56,189,248,0.12)",
                            color:        "#e2e8f0",
                            cursor:       "pointer",
                            display:      "flex",
                            alignItems:   "center",
                            justifyContent: "center",
                            gap:          10,
                            transition:   "background 0.12s",
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = "rgba(56,189,248,0.2)" }}
                        onMouseOut={e => { e.currentTarget.style.background = "rgba(56,189,248,0.12)" }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="2" width="14" height="10" rx="1.2"/>
                            <line x1="5" y1="14" x2="11" y2="14"/>
                            <line x1="8" y1="12" x2="8" y2="14"/>
                        </svg>
                        Watch Live News
                    </button>

                    <button
                        onClick={() => onChoice("briefing")}
                        style={{
                            padding:      "15px 20px",
                            fontSize:     14,
                            fontWeight:   500,
                            border:       "1px solid rgba(56,189,248,0.15)",
                            borderRadius: 8,
                            background:   "rgba(56,189,248,0.06)",
                            color:        "#e2e8f0",
                            cursor:       "pointer",
                            display:      "flex",
                            alignItems:   "center",
                            justifyContent: "center",
                            gap:          10,
                            transition:   "background 0.12s",
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = "rgba(56,189,248,0.14)" }}
                        onMouseOut={e => { e.currentTarget.style.background = "rgba(56,189,248,0.06)" }}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="1" width="10" height="14" rx="1.5"/>
                            <line x1="5" y1="5"  x2="10" y2="5"/>
                            <line x1="5" y1="8"  x2="10" y2="8"/>
                            <line x1="5" y1="11" x2="8"  y2="11"/>
                        </svg>
                        Read Today&apos;s Briefing
                    </button>

                    <button
                        onClick={() => onChoice("map")}
                        style={{
                            padding:    "11px 20px",
                            fontSize:   13,
                            border:     "none",
                            background: "transparent",
                            color:      "rgba(255,255,255,0.3)",
                            cursor:     "pointer",
                            transition: "color 0.12s",
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = "rgba(255,255,255,0.6)" }}
                        onMouseOut={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)" }}
                    >
                        Go to map
                    </button>
                </div>
            </div>
        </div>
    )
}
