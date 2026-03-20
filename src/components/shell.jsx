import { useState, useEffect } from "react"

const NAV = [
    { id: "map",        icon: "◎",  label: "Map"          },
    { id: "news",       icon: "⊞",  label: "News"         },
    { id: "situations", icon: "📋", label: "Situations",  panel: true },
    { id: "chat",       icon: "💬", label: "Mission Chat", panel: true },
    { id: "poi",        icon: "◈",  label: "POI"          },
    { id: "reports",    icon: "≡",  label: "Reports"      },
    { id: "settings",   icon: "⊙",  label: "Settings"     },
    { id: "health",     icon: "◇",  label: "Health"       },
    { id: "profile",    icon: "○",  label: "Profile"      },
]

export default function Shell({ page, setPage, sidebarOpen, setSidebarOpen, openPanel, setOpenPanel, activeSituationName }) {
    const [time, setTime] = useState(new Date())

    useEffect(() => {
        const t = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    const fmt = (d) => d.toUTCString().slice(17, 25) + " UTC"

    return (
        <>
            {/* Top bar */}
            <div style={{
                height: 48,
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(12px)",
                borderBottom: "1px solid rgba(0,0,0,0.09)",
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                zIndex: 500,
                flexShrink: 0,
                position: "relative"
            }}>
                {/* Left: hamburger */}
                <button
                    onClick={() => setSidebarOpen(o => !o)}
                    style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "6px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        zIndex: 1
                    }}
                >
                    {[0, 1, 2].map(i => (
                        <div key={i} style={{
                            width: 18,
                            height: 1.5,
                            background: sidebarOpen && i === 1 ? "transparent" : "#0a0a0a",
                            transition: "all 0.2s",
                            transform: sidebarOpen
                                ? i === 0 ? "rotate(45deg) translate(4px, 4px)"
                                    : i === 2 ? "rotate(-45deg) translate(4px, -4px)"
                                        : "none"
                                : "none"
                        }} />
                    ))}
                </button>

                {/* Centre: name + status */}
                <div style={{
                    position: "absolute",
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                }}>
                    <div>
                        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" }}>AKILI</span>
                        {activeSituationName && (
                            <div style={{ fontSize: 9, color: "#999", letterSpacing: "0.04em", marginTop: 1, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {activeSituationName}
                            </div>
                        )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{
                            width: 6,
                            height: 6,
                            background: "#22c55e",
                            borderRadius: "50%",
                            boxShadow: "0 0 6px #22c55e",
                            animation: "pulse-dot 2s infinite"
                        }} />
                        <span style={{ fontSize: 10, color: "#888", letterSpacing: "0.06em" }}>ONLINE</span>
                    </div>
                </div>

                {/* Right: clock */}
                <div style={{ marginLeft: "auto", fontSize: 11, color: "#888", fontVariantNumeric: "tabular-nums" }}>
                    {fmt(time)}
                </div>
            </div>

            {/* Sidebar overlay */}
            {sidebarOpen && (
                <div
                    onClick={() => setSidebarOpen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.15)",
                        zIndex: 400,
                        top: 48
                    }}
                />
            )}

            {/* Sidebar */}
            <div style={{
                position: "fixed",
                top: 48,
                left: 0,
                bottom: 0,
                width: 200,
                background: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(16px)",
                borderRight: "1px solid rgba(0,0,0,0.09)",
                zIndex: 450,
                transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
                display: "flex",
                flexDirection: "column",
                padding: "8px 0"
            }}>
                {NAV.map(n => {
                    const isActive = n.panel ? openPanel === n.id : page === n.id
                    return (
                        <button
                            key={n.id}
                            onClick={() => {
                                if (n.panel) {
                                    setOpenPanel(p => p === n.id ? null : n.id)
                                } else {
                                    setPage(n.id)
                                }
                                setSidebarOpen(false)
                            }}
                            style={{
                                display: "flex", alignItems: "center", gap: 12,
                                padding: "11px 20px",
                                background: isActive ? "rgba(0,0,0,0.05)" : "none",
                                border: "none",
                                borderLeft: isActive ? "2px solid #0a0a0a" : "2px solid transparent",
                                cursor: "pointer", textAlign: "left", width: "100%",
                                color: isActive ? "#0a0a0a" : "#555",
                                fontWeight: isActive ? 600 : 400,
                                fontSize: 13, letterSpacing: "0.02em", transition: "all 0.1s",
                            }}
                        >
                            <span style={{ fontSize: 14, opacity: 0.7 }}>{n.icon}</span>
                            {n.label}
                        </button>
                    )
                })}

                {/* Version tag */}
                <div style={{ marginTop: "auto", padding: "12px 20px", fontSize: 10, color: "#bbb", letterSpacing: "0.06em" }}>
                    Akili · BETA
                </div>
            </div>

            <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
        </>
    )
}