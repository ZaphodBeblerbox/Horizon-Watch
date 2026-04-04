// BottomNav — fixed mobile bottom tab bar (< 768px)

const BOTTOM_NAV_STYLES = `
@keyframes director-nav-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.7; transform: scale(1.15); }
}
.director-nav-icon-active {
  animation: director-nav-pulse 1.6s ease-in-out infinite;
  color: #f59e0b !important;
}
`

export default function BottomNav({
    activeTabType,
    onSwitchToMap,
    onSwitchToNews,
    notifUnread,
    onToggleNotif,
    onOpenMenu,
    overwatchActive,
    onToggleOverwatch,
    onOpenPoi,
    directorActive = false,
    onDirectorTap = null,
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
            id:    "poi",
            label: "POI",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10" cy="7.5" r="3"/>
                    <path d="M10 10.5C7 10.5 4.5 12.5 4.5 15H15.5C15.5 12.5 13 10.5 10 10.5Z"/>
                    <circle cx="10" cy="7.5" r="6.5" strokeDasharray="2.5 2" opacity="0.3"/>
                </svg>
            ),
            onClick: onOpenPoi,
            active: activeTabType === "poi",
        },
        {
            id:          "director",
            label:       "Director",
            icon:        (
                <span
                    className={directorActive ? "director-nav-icon-active" : ""}
                    style={{ fontSize: 18, lineHeight: 1, display: "inline-block" }}
                >◈</span>
            ),
            onClick:     onDirectorTap,
            active:      directorActive,
            activeColor: "#f59e0b",
        },
        {
            id:    "overwatch",
            label: "Overwatch",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor"
                    strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
                    <circle cx="9" cy="9" r="2.5"/>
                    <line x1="9"  y1="1"  x2="9"  y2="3"/>
                    <line x1="9"  y1="15" x2="9"  y2="17"/>
                    <line x1="1"  y1="9"  x2="3"  y2="9"/>
                    <line x1="15" y1="9"  x2="17" y2="9"/>
                </svg>
            ),
            onClick: onToggleOverwatch,
            active: !!overwatchActive,
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
        <>
        <style>{BOTTOM_NAV_STYLES}</style>
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
                        color:          item.active ? (item.activeColor || "var(--accent-bright, #2d8fe8)") : "rgba(255,255,255,0.35)",
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
        </>
    )
}
