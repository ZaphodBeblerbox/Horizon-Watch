import { useState, useEffect } from "react"
import Logo from "./Logo.jsx"
import Icon from "../ui/Icon.jsx"
import HeaderSearch from "./HeaderSearch.jsx"
import FlyoutMenu from "../ui/FlyoutMenu.jsx"
import { DESTINATIONS } from "../data/destinations.js"
import { STATUS_COLOR_TOKEN, STATUS_WORD } from "../utils/systemHealth.js"

function ToolRow({ label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                padding: "var(--space-2) var(--space-3)", background: "none", border: "none",
                borderBottom: "1px solid var(--border)", cursor: "pointer", fontFamily: "var(--font-sans)",
                fontSize: "var(--text-body)", color: active ? "var(--accent-blue)" : "var(--text-primary)",
                textAlign: "left",
            }}
        >
            <span>{label}</span>
            <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: active ? "var(--accent-blue)" : "var(--border-strong)",
            }} />
        </button>
    )
}

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
    profile = null,
    // "Tools" flyout (UI correction pass, Part 2) — the utility toggles that
    // lost their only entry point when the old SecondaryMenu was deleted.
    // Every value/handler pair is independently optional, same as
    // SecondaryMenu's old contract — a row only renders if its handler is
    // passed.
    overwatchActive, onToggleOverwatch,
    directorActive, onToggleDirector,
    analyticsActive, onToggleAnalytics,
    threatsActive, onToggleThreats,
    healthActive, onToggleHealth,
    tvActive, onToggleTV,
    soundMuted, onToggleSound,
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

                <FlyoutMenu icon="filter" label="Tools" title="Tools" buttonSize={36} panelWidth={220}>
                    {onToggleOverwatch && <ToolRow label="Overwatch" active={overwatchActive} onClick={onToggleOverwatch} />}
                    {onToggleDirector && <ToolRow label="Director Mode" active={directorActive} onClick={onToggleDirector} />}
                    {onToggleAnalytics && <ToolRow label="Analytics" active={analyticsActive} onClick={onToggleAnalytics} />}
                    {onToggleThreats && <ToolRow label="Threats" active={threatsActive} onClick={onToggleThreats} />}
                    {onToggleHealth && <ToolRow label="Health" active={healthActive} onClick={onToggleHealth} />}
                    {onToggleTV && <ToolRow label="TV" active={tvActive} onClick={onToggleTV} />}
                    {onToggleSound && <ToolRow label="Sound" active={!soundMuted} onClick={onToggleSound} />}
                </FlyoutMenu>

                {/* Settings/Preferences window removed for now (UI correction
                    pass, Part 13) — acknowledged as not worth keeping in its
                    current form. Gear icon stays present but inert, with a
                    real, clear "coming soon" state rather than silently doing
                    nothing. */}
                <FlyoutMenu icon="settings" title="Settings" buttonSize={36} panelWidth={200}>
                    <div style={{ padding: "var(--space-3)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                        Settings — coming soon.
                    </div>
                </FlyoutMenu>

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
