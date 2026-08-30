import { useState, useEffect } from "react"
import Logo from "./Logo.jsx"
import Icon from "../ui/Icon.jsx"
import HeaderSearch from "./HeaderSearch.jsx"
import { DESTINATIONS } from "../data/destinations.js"
import { STATUS_COLOR_TOKEN, STATUS_WORD } from "../utils/systemHealth.js"

/**
 * The persistent application header — full UI rebuild spec section 3.1.
 * Exactly 52px tall, --bg-header, never scrolls away, never translucent/
 * blurred. Three zones: left (mark/wordmark/divider/mode label — the
 * universal "go home" action), center (the 5 fixed destinations, always in
 * this order, active item gets a 2px --accent-blue underline), right
 * (status pill, Zulu+local clock, search, alert bell, settings, avatar).
 */
export default function AppHeader({
    activeDestination = null,
    onNavigate,
    onGoHome,
    modeLabel = "MARITIME OPERATIONAL VIEW",
    systemHealth = { status: "operational", detail: "ALL FEEDS LIVE" },
    alertUnreadCount = 0,
    onOpenWatchlists,
    onSearchResult,
    onOpenSettings,
    profile = null,
}) {
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    const zulu = now.toUTCString().slice(17, 22) + "Z"
    const local = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })

    const initials = (profile?.displayName || "OP").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()

    return (
        <div style={{
            height: "var(--header-height)", flexShrink: 0, background: "var(--bg-header)",
            display: "flex", alignItems: "stretch", fontFamily: "var(--font-sans)",
        }}>
            {/* Left zone */}
            <div
                onClick={onGoHome}
                title="Go to Globe / Maritime Operational View"
                style={{
                    display: "flex", alignItems: "center", gap: "var(--space-2)",
                    padding: "0 var(--space-4)", cursor: "pointer", flexShrink: 0,
                }}
            >
                <Logo size={20} />
                <span style={{
                    fontSize: "var(--text-wordmark)", fontWeight: "var(--weight-semibold)",
                    letterSpacing: "0.4px", color: "var(--text-primary)", whiteSpace: "nowrap",
                }}>
                    HORIZON WATCH
                </span>
                <div style={{ width: 1, alignSelf: "stretch", margin: "12px 0", background: "var(--border)" }} />
                <span style={{
                    fontSize: "var(--text-mode-subtitle)", fontWeight: "var(--weight-medium)",
                    color: "var(--text-secondary)", whiteSpace: "nowrap",
                }}>
                    {modeLabel}
                </span>
            </div>

            {/* Center zone — the 5 fixed destinations */}
            <div style={{ flex: 1, display: "flex", alignItems: "stretch", justifyContent: "center", gap: "var(--space-5)" }}>
                {DESTINATIONS.map((d) => {
                    const isActive = activeDestination === d.key
                    return (
                        <button
                            key={d.key}
                            onClick={() => onNavigate(d.key)}
                            style={{
                                position: "relative", background: "none", border: "none", cursor: "pointer",
                                padding: "0 2px", fontFamily: "var(--font-sans)", fontSize: "var(--text-body)",
                                fontWeight: "var(--weight-medium)",
                                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                            }}
                        >
                            {d.label}
                            {isActive && (
                                <span style={{
                                    position: "absolute", left: 0, right: 0, bottom: 0,
                                    height: 2, background: "var(--accent-blue)",
                                }} />
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Right zone */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "0 var(--space-4)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: STATUS_COLOR_TOKEN[systemHealth.status] || STATUS_COLOR_TOKEN.operational,
                        flexShrink: 0,
                    }} />
                    <span style={{
                        fontSize: "var(--text-mode-subtitle)", fontWeight: "var(--weight-medium)",
                        color: "var(--text-secondary)", textTransform: "uppercase",
                    }}>
                        {STATUS_WORD[systemHealth.status] || STATUS_WORD.operational}
                    </span>
                </div>

                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-primary)" }}>
                    {zulu}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)" }}>
                    ({local})
                </span>

                <HeaderSearch onResult={onSearchResult} />

                <button
                    onClick={onOpenWatchlists}
                    title="Watchlists"
                    aria-label="Watchlists"
                    style={{
                        position: "relative", width: 36, height: 36, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)",
                    }}
                >
                    <Icon name="bell" size={18} />
                    {alertUnreadCount > 0 && (
                        <span style={{
                            position: "absolute", top: 4, right: 4, minWidth: 14, height: 14,
                            borderRadius: "var(--radius-pill)", background: "var(--danger)", color: "#fff",
                            fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center",
                            justifyContent: "center", lineHeight: 1, padding: "0 3px",
                        }}>
                            {alertUnreadCount > 99 ? "99+" : alertUnreadCount}
                        </span>
                    )}
                </button>

                <button
                    onClick={onOpenSettings}
                    title="Settings"
                    aria-label="Settings"
                    style={{
                        width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)",
                    }}
                >
                    <Icon name="settings" size={18} />
                </button>

                <div style={{
                    width: 28, height: 28, borderRadius: "50%", background: "var(--bg-card-2)",
                    border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "var(--text-chip)", fontWeight: "var(--weight-semibold)", color: "var(--text-secondary)",
                    flexShrink: 0,
                }}>
                    {initials}
                </div>
            </div>
        </div>
    )
}
