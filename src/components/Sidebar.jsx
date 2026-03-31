import { useState } from "react"

// ── Icon primitives ───────────────────────────────────────────────────────────

function IconMap() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1,2 7,4 7,16 1,14" fill="none"/>
            <polygon points="7,4 13,2 13,14 7,16" fill="none"/>
            <polygon points="13,2 17,4 17,16 13,14" fill="none"/>
        </svg>
    )
}

function IconBell() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2C9 2 5.5 3.5 5.5 9V13L3 14.5H15L12.5 13V9C12.5 3.5 9 2 9 2Z" fill="none"/>
            <line x1="7.5" y1="14.5" x2="10.5" y2="14.5"/>
            <line x1="9" y1="1" x2="9" y2="2.5"/>
        </svg>
    )
}

function IconLayers() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,6.5 9,11 17,6.5"/>
            <polyline points="1,10 9,14.5 17,10"/>
            <polygon points="1,2.5 9,7 17,2.5 9,-2" fill="none"/>
        </svg>
    )
}

function IconAlerts() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L16 15H2L9 2Z" fill="none"/>
            <line x1="9" y1="8" x2="9" y2="11"/>
            <circle cx="9" cy="13.5" r="0.6" fill="currentColor" stroke="none"/>
        </svg>
    )
}

function IconSituations() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="9" cy="9" r="7" fill="none"/>
            <circle cx="9" cy="9" r="2.2" fill="none"/>
            <line x1="9" y1="2" x2="9" y2="4.8"/>
            <line x1="9" y1="13.2" x2="9" y2="16"/>
            <line x1="2" y1="9" x2="4.8" y2="9"/>
            <line x1="13.2" y1="9" x2="16" y2="9"/>
        </svg>
    )
}

function IconBriefing() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="1.5" width="12" height="15" rx="2"/>
            <line x1="6" y1="6"  x2="12" y2="6"/>
            <line x1="6" y1="9"  x2="12" y2="9"/>
            <line x1="6" y1="12" x2="9.5" y2="12"/>
        </svg>
    )
}

function IconSettings() {
    // Proper gear/cog with 8 teeth
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="2.8"/>
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M14.4 3.6L13 5M5 13l-1.4 1.4"/>
        </svg>
    )
}

function IconHealth() {
    // Pulse / heartbeat line
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,9 5,9 6.5,4 8.5,14 10.5,7 12,9 17,9"/>
        </svg>
    )
}

function IconOverwatch() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
            <circle cx="9" cy="9" r="2.5"/>
            <line x1="9" y1="1"  x2="9" y2="3"/>
            <line x1="9" y1="15" x2="9" y2="17"/>
            <line x1="1"  y1="9" x2="3"  y2="9"/>
            <line x1="15" y1="9" x2="17" y2="9"/>
        </svg>
    )
}

function IconTV() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="2.5" width="16" height="11" rx="1.5"/>
            <line x1="6"  y1="15.5" x2="12" y2="15.5"/>
            <line x1="9"  y1="13.5" x2="9"  y2="15.5"/>
        </svg>
    )
}

function IconShield() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L16 5V9C16 13 9 16.5 9 16.5S2 13 2 9V5L9 2Z"/>
        </svg>
    )
}

function IconChat() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5.5L2 16V3.5a1 1 0 0 1 1-1z" fill="none"/>
        </svg>
    )
}

function IconProfile() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="9" cy="6.5" r="3" fill="none"/>
            <path d="M2.5 16C2.5 13 5.5 10.5 9 10.5C12.5 10.5 15.5 13 15.5 16" fill="none"/>
        </svg>
    )
}

function IconNews() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="2" width="15" height="14" rx="1.5"/>
            <line x1="5" y1="6"  x2="13" y2="6"/>
            <line x1="5" y1="9"  x2="13" y2="9"/>
            <line x1="5" y1="12" x2="9"  y2="12"/>
        </svg>
    )
}

function IconPOI() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="6" r="3.2" fill="none"/>
            <path d="M2.5 15.5C2.5 12.5 5.5 10 9 10C12.5 10 15.5 12.5 15.5 15.5" fill="none"/>
            <circle cx="14" cy="4" r="2.2" fill="none" strokeWidth="1.1"/>
            <line x1="14" y1="2.3" x2="14" y2="1.2"/>
            <line x1="15.6" y1="2.8" x2="16.4" y2="2.2"/>
            <line x1="15.6" y1="5.2" x2="16.4" y2="5.8"/>
            <line x1="12.4" y1="5.2" x2="11.6" y2="5.8"/>
            <line x1="12.4" y1="2.8" x2="11.6" y2="2.2"/>
        </svg>
    )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function IconSoundOn() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1,5 5,5 9,2 9,14 5,11 1,11"/>
            <path d="M11.5 5.5 C12.8 6.5 12.8 9.5 11.5 10.5"/>
            <path d="M13.5 3.5 C15.8 5.5 15.8 10.5 13.5 12.5"/>
        </svg>
    )
}

function IconSoundOff() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1,5 5,5 9,2 9,14 5,11 1,11"/>
            <line x1="12" y1="5" x2="16" y2="11"/>
            <line x1="16" y1="5" x2="12" y2="11"/>
        </svg>
    )
}

export default function Sidebar({
    rightPanel,
    onRightPanel,
    activeTabType    = "map",
    onOpenTab,
    profile,
    currentUser      = null,
    alertCount       = 0,
    budgetPct        = null,
    notifOpen        = false,
    notifUnread      = 0,
    onToggleNotif,
    briefingUnread   = false,
    soundMuted       = false,
    onToggleSound,
    tvOpen           = false,
    onToggleTV,
    onToggleAdmin,
    chatOpen         = false,
    onToggleChat,
    overwatchActive  = false,
    onToggleOverwatch,
}) {
    const isAdmin    = currentUser?.role === "admin" || currentUser?.role === "super_admin"
    const isAnalyst  = currentUser?.role === "analyst" || isAdmin
    const isObserver = !!currentUser
    const [hovered, setHovered] = useState(null)

    const iconColor = (id) => {
        const active = (id === "layers"     && rightPanel === "layers")        ||
                       (id === "alerts"     && rightPanel === "alerts")        ||
                       (id === "tv"         && tvOpen)                         ||
                       (id === "situations" && rightPanel === "situations")    ||
                       (id === "settings"   && rightPanel === "settings")      ||
                       (id === "profile"    && rightPanel === "profile")       ||
                       (id === "health"     && rightPanel === "health")        ||
                       (id === "poi"        && activeTabType === "poi")        ||
                       (id === "map"        && activeTabType === "map")        ||
                       (id === "news"       && activeTabType === "news")       ||
                       (id === "briefing"   && activeTabType === "briefing")   ||
                       (id === "notif"      && notifOpen)                      ||
                       (id === "chat"       && chatOpen)                       ||
                       (id === "overwatch"  && overwatchActive)
        if (active)         return "var(--akili-accent)"
        if (hovered === id) return "var(--akili-text-secondary)"
        return "var(--akili-text-muted)"
    }

    const btn = (id, icon, badge = null, badgeColor = "#dc2626") => (
        <button
            key={id}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
                if (id === "map")     { onOpenTab?.("map");     return }
                if (id === "poi")     { onOpenTab?.("poi");     return }
                if (id === "news")    { onOpenTab?.("news");    return }
                if (id === "briefing") { onOpenTab?.("briefing"); return }
                onRightPanel(rightPanel === id ? null : id)
            }}
            title={id.charAt(0).toUpperCase() + id.slice(1)}
            style={{
                position:       "relative",
                width:          48,
                height:         40,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                background:     "none",
                border:         "none",
                cursor:         "pointer",
                color:          iconColor(id),
                transition:     "color 0.12s",
                flexShrink:     0,
            }}
        >
            {icon}
            {badge != null && badge > 0 && (
                <span style={{
                    position:       "absolute",
                    top:            6,
                    right:          6,
                    minWidth:       14,
                    height:         14,
                    borderRadius:   7,
                    background:     badgeColor,
                    color:          "#fff",
                    fontSize:       8,
                    fontWeight:     700,
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "center",
                    lineHeight:     1,
                    padding:        "0 3px",
                }}>
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
        </button>
    )

    return (
        <div style={{
            width:         48,
            flexShrink:    0,
            height:        "100%",
            background:    "var(--akili-surface)",
            borderRight:   "1px solid var(--akili-border)",
            display:       "flex",
            flexDirection: "column",
            alignItems:    "center",
            zIndex:        100,
        }}>
            {/* Top nav icons */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                {btn("map", <IconMap />)}
                {btn("news", <IconNews />)}

                {/* Notification bell */}
                {profile && (
                    <button
                        onMouseEnter={() => setHovered("notif")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleNotif}
                        title="Notifications"
                        style={{
                            position:       "relative",
                            width:          48,
                            height:         40,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          iconColor("notif"),
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconBell />
                        {notifUnread > 0 && (
                            <span style={{
                                position:       "absolute",
                                top:            6,
                                right:          6,
                                minWidth:       14,
                                height:         14,
                                borderRadius:   7,
                                background:     "var(--akili-accent)",
                                color:          "#fff",
                                fontSize:       8,
                                fontWeight:     700,
                                display:        "flex",
                                alignItems:     "center",
                                justifyContent: "center",
                                lineHeight:     1,
                                padding:        "0 3px",
                            }}>
                                {notifUnread > 99 ? "99+" : notifUnread}
                            </span>
                        )}
                    </button>
                )}

                {/* Briefing button */}
                {profile && (
                    <button
                        onMouseEnter={() => setHovered("briefing")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => onOpenTab?.("briefing")}
                        title="Daily Briefing"
                        style={{
                            position:       "relative",
                            width:          48,
                            height:         40,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          iconColor("briefing"),
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconBriefing />
                        {briefingUnread && (
                            <span style={{
                                position:     "absolute",
                                top:          8,
                                right:        8,
                                width:        6,
                                height:       6,
                                borderRadius: "50%",
                                background:   "var(--akili-accent)",
                            }} />
                        )}
                    </button>
                )}

                {isAnalyst && btn("layers",     <IconLayers />)}
                {btn("alerts",     <IconAlerts />, alertCount)}
                {/* Overwatch — satellite ML detection */}
                {onToggleOverwatch && (
                    <button
                        onMouseEnter={() => setHovered("overwatch")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleOverwatch}
                        title="Overwatch — Satellite Object Detection"
                        style={{
                            position:       "relative",
                            width:          48,
                            height:         40,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     overwatchActive ? "rgba(56,189,248,0.08)" : "none",
                            border:         "none",
                            borderLeft:     overwatchActive ? "2px solid #38bdf8" : "2px solid transparent",
                            cursor:         "pointer",
                            color:          overwatchActive ? "#38bdf8" : iconColor("overwatch"),
                            transition:     "color 0.12s, background 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconOverwatch />
                    </button>
                )}
                {isAdmin   && btn("situations", <IconSituations />)}
                {isAnalyst && btn("poi", <IconPOI />, null, null)}
                {isAdmin   && btn("health", <IconHealth />, null, null)}

                {/* Chat — analyst + admin only */}
                {isAnalyst && onToggleChat && (
                    <button
                        onMouseEnter={() => setHovered("chat")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleChat}
                        title="Messages"
                        style={{
                            position:       "relative",
                            width:          48,
                            height:         40,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          iconColor("chat"),
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconChat />
                    </button>
                )}

                {/* TV button */}
                {onToggleTV && (
                    <button
                        onMouseEnter={() => setHovered("tv")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleTV}
                        title="Live TV"
                        style={{
                            width:          48,
                            height:         40,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          tvOpen ? "var(--accent-bright, var(--akili-accent))" : iconColor("tv"),
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconTV />
                    </button>
                )}
            </div>

            {/* Bottom icons */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 8 }}>
                {budgetPct !== null && (
                    <div style={{
                        width:              48,
                        height:             28,
                        display:            "flex",
                        alignItems:         "center",
                        justifyContent:     "center",
                        fontSize:           10,
                        fontWeight:         600,
                        fontVariantNumeric: "tabular-nums",
                        color:              budgetPct > 50 ? "var(--akili-accent)" : budgetPct > 20 ? "#d97706" : "#dc2626",
                        letterSpacing:      "0.02em",
                    }}>
                        {Math.round(budgetPct)}%
                    </div>
                )}
                {/* Sound mute toggle */}
                {onToggleSound && (
                    <button
                        onMouseEnter={() => setHovered("sound")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleSound}
                        title={soundMuted ? "Unmute alerts" : "Mute alerts"}
                        style={{
                            width:          48,
                            height:         36,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          hovered === "sound" ? "var(--akili-text-secondary)" : "var(--akili-text-muted)",
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        {soundMuted ? <IconSoundOff /> : <IconSoundOn />}
                    </button>
                )}
{btn("settings", <IconSettings />)}
                {profile && btn("profile", <IconProfile />)}
                {/* Admin shield — only for admins */}
                {isAdmin && onToggleAdmin && (
                    <button
                        onMouseEnter={() => setHovered("admin")}
                        onMouseLeave={() => setHovered(null)}
                        onClick={onToggleAdmin}
                        title="Admin Console"
                        style={{
                            width:          48,
                            height:         36,
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          hovered === "admin" ? "rgba(255,179,0,0.8)" : "rgba(255,179,0,0.4)",
                            transition:     "color 0.12s",
                            flexShrink:     0,
                        }}
                    >
                        <IconShield />
                    </button>
                )}

            </div>
        </div>
    )
}
