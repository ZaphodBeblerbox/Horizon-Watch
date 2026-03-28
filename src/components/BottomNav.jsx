// BottomNav — fixed mobile bottom tab bar (< 768px)

export default function BottomNav({
    activeTabType,
    onSwitchToMap,
    onSwitchToNews,
    onSwitchToBriefing,
    notifUnread,
    onToggleNotif,
    onOpenMenu,
}) {
    const items = [
        {
            id:    "map",
            label: "Map",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="1,2 7,4 7,17 1,15" fill="none"/>
                    <polygon points="7,4 13,2 13,15 7,17" fill="none"/>
                    <polygon points="13,2 19,4 19,17 13,15" fill="none"/>
                </svg>
            ),
            onClick: onSwitchToMap,
            active: activeTabType === "map",
        },
        {
            id:    "news",
            label: "News",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="16" height="14" rx="1.5" fill="none"/>
                    <line x1="6" y1="7"  x2="14" y2="7"/>
                    <line x1="6" y1="10" x2="14" y2="10"/>
                    <line x1="6" y1="13" x2="10" y2="13"/>
                </svg>
            ),
            onClick: onSwitchToNews,
            active: activeTabType === "news",
        },
        {
            id:    "briefing",
            label: "Briefs",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="2" width="14" height="16" rx="1.5" fill="none"/>
                    <line x1="7" y1="7" x2="13" y2="7"/>
                    <line x1="7" y1="10" x2="13" y2="10"/>
                    <line x1="7" y1="13" x2="11" y2="13"/>
                </svg>
            ),
            onClick: onSwitchToBriefing,
            active: activeTabType === "briefing",
        },
        {
            id:    "alerts",
            label: "Alerts",
            icon:  (
                <div style={{ position: "relative", display: "inline-flex" }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 2C10 2 6 3.5 6 10V14L3.5 15.5H16.5L14 14V10C14 3.5 10 2 10 2Z" fill="none"/>
                        <line x1="8" y1="15.5" x2="12" y2="15.5"/>
                        <line x1="10" y1="1" x2="10" y2="2.5"/>
                    </svg>
                    {notifUnread > 0 && (
                        <span style={{
                            position:   "absolute",
                            top:        -3,
                            right:      -5,
                            background: "#ef4444",
                            color:      "#fff",
                            fontSize:   9,
                            fontWeight: 700,
                            minWidth:   14,
                            height:     14,
                            borderRadius: 7,
                            display:    "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding:    "0 3px",
                        }}>
                            {notifUnread > 9 ? "9+" : notifUnread}
                        </span>
                    )}
                </div>
            ),
            onClick: onToggleNotif,
            active: false,
        },
        {
            id:    "menu",
            label: "Menu",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="3" y1="5" x2="17" y2="5"/>
                    <line x1="3" y1="10" x2="17" y2="10"/>
                    <line x1="3" y1="15" x2="17" y2="15"/>
                </svg>
            ),
            onClick: onOpenMenu,
            active: false,
        },
    ]

    return (
        <nav style={{
            position:       "fixed",
            bottom:         0,
            left:           0,
            right:          0,
            height:         56,
            paddingBottom:  "env(safe-area-inset-bottom, 0px)",
            background:     "rgba(6,13,26,0.97)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderTop:      "1px solid rgba(255,255,255,0.08)",
            display:        "flex",
            alignItems:     "stretch",
            zIndex:         1200,
            fontFamily:     "Inter, -apple-system, sans-serif",
        }}>
            {items.map(item => (
                <button
                    key={item.id}
                    onClick={item.onClick}
                    style={{
                        flex:           1,
                        display:        "flex",
                        flexDirection:  "column",
                        alignItems:     "center",
                        justifyContent: "center",
                        gap:            3,
                        background:     "none",
                        border:         "none",
                        cursor:         "pointer",
                        color:          item.active ? "var(--accent-bright, #2d8fe8)" : "rgba(255,255,255,0.35)",
                        fontSize:       9,
                        fontWeight:     item.active ? 700 : 400,
                        letterSpacing:  "0.06em",
                        textTransform:  "uppercase",
                        padding:        "6px 0 2px",
                        transition:     "color 0.15s",
                        minHeight:      56,
                        WebkitTapHighlightColor: "transparent",
                    }}
                >
                    {item.icon}
                    {item.label}
                </button>
            ))}
        </nav>
    )
}
