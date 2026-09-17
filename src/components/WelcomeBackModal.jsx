import { useState, useEffect } from "react"
import { apiFetch } from "../auth.js"

export default function WelcomeBackModal({ user, onDismiss, onReadBriefing, onViewMessages }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        apiFetch("/api/user/missed-activity")
            .then(r => r.ok ? r.json() : null)
            .then(d => setData(d))
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    const hasActivity = data && (data.unread_messages > 0 || data.critical_events > 0 || data.total_events > 0)

    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            zIndex:         5000,
            background:     "rgba(0,0,0,0.6)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        16,
        }}>
            <div style={{
                background:      "rgb(10, 14, 20)",
                border:          "1px solid rgba(255,255,255,0.08)",
                borderRadius:    10,
                width:           "100%",
                maxWidth:        400,
                overflow:        "hidden",
            }}>
                {/* Header */}
                <div style={{
                    padding:      "20px 24px 16px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}>
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", color: "rgba(255,255,255,0.28)", marginBottom: 6 }}>
                        HORIZON WATCH
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>
                        Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
                    </div>
                    {data?.since && (
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                            Since {new Date(data.since).toLocaleString()}
                        </div>
                    )}
                </div>

                {/* Activity summary */}
                <div style={{ padding: "16px 24px" }}>
                    {loading ? (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", animation: "pulse 1.5s infinite" }}>
                            Loading activity...
                        </div>
                    ) : hasActivity ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {data.unread_messages > 0 && (
                                <div style={{
                                    display:      "flex",
                                    alignItems:   "center",
                                    gap:          10,
                                    padding:      "10px 12px",
                                    borderRadius: 6,
                                    background:   "rgba(56,189,248,0.08)",
                                    border:       "1px solid rgba(56,189,248,0.18)",
                                    cursor:       onViewMessages ? "pointer" : "default",
                                }}
                                    onClick={onViewMessages}
                                >
                                    <div style={{ fontSize: 18 }}>✉</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#38bdf8" }}>
                                            {data.unread_messages} unread message{data.unread_messages !== 1 ? "s" : ""}
                                        </div>
                                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                                            from {data.message_senders} contact{data.message_senders !== 1 ? "s" : ""}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {data.critical_events > 0 && (
                                <div style={{
                                    display:      "flex",
                                    alignItems:   "center",
                                    gap:          10,
                                    padding:      "10px 12px",
                                    borderRadius: 6,
                                    background:   "rgba(239,68,68,0.08)",
                                    border:       "1px solid rgba(239,68,68,0.2)",
                                }}>
                                    <div style={{ fontSize: 18 }}>!</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: "#ef4444" }}>
                                            {data.critical_events} critical event{data.critical_events !== 1 ? "s" : ""}
                                        </div>
                                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                                            while you were away
                                        </div>
                                    </div>
                                </div>
                            )}
                            {data.total_events > 0 && (
                                <div style={{
                                    display:      "flex",
                                    alignItems:   "center",
                                    gap:          10,
                                    padding:      "10px 12px",
                                    borderRadius: 6,
                                    background:   "rgba(255,255,255,0.03)",
                                    border:       "1px solid rgba(255,255,255,0.07)",
                                }}>
                                    <div style={{ fontSize: 18 }}>~</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
                                            {data.total_events} new intelligence event{data.total_events !== 1 ? "s" : ""}
                                        </div>
                                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                                            check briefings for a summary
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px 0" }}>
                            No new activity since your last session.
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div style={{
                    padding:      "12px 24px 20px",
                    borderTop:    "1px solid rgba(255,255,255,0.06)",
                    display:      "flex",
                    gap:          8,
                    flexWrap:     "wrap",
                }}>
                    {onReadBriefing && (
                        <button
                            onClick={() => { onReadBriefing(); onDismiss() }}
                            style={{
                                flex:          1,
                                minWidth:      100,
                                padding:       "8px 12px",
                                fontSize:      10,
                                fontWeight:    700,
                                letterSpacing: "0.06em",
                                border:        "1px solid rgba(255,255,255,0.15)",
                                borderRadius:  5,
                                background:    "rgba(255,255,255,0.06)",
                                color:         "#fff",
                                cursor:        "pointer",
                            }}
                        >
                            READ BRIEFINGS
                        </button>
                    )}
                    <button
                        onClick={onDismiss}
                        style={{
                            flex:          1,
                            minWidth:      100,
                            padding:       "8px 12px",
                            fontSize:      10,
                            fontWeight:    600,
                            letterSpacing: "0.06em",
                            border:        "1px solid rgba(255,255,255,0.07)",
                            borderRadius:  5,
                            background:    "none",
                            color:         "rgba(255,255,255,0.35)",
                            cursor:        "pointer",
                        }}
                    >
                        GO TO MAP
                    </button>
                </div>
            </div>
        </div>
    )
}
