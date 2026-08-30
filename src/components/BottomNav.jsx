// BottomNav — mobile bottom tab bar (< 768px).
// Trimmed to the same fixed 4 top-level modes as desktop's TopNav, plus the
// alert log and the secondary/overflow menu (Overwatch, Director Mode,
// Analytics, Threats, Health, TV, Sound, Settings, Profile, Reels all live
// in MobileDrawer now — moved out of the primary bar, not deleted).

const BOTTOM_NAV_STYLES = `
.bottom-nav-scroll::-webkit-scrollbar { display: none; }
.bottom-nav-scroll { -ms-overflow-style: none; scrollbar-width: none; }
`

export default function BottomNav({
    activeTabType,
    onSwitchToMap,
    onSwitchToNews,
    onOpenBriefings,
    reportsUnread = false,
    onOpenForge,
    alertLogUnread = 0,
    onToggleAlertLog,
    onOpenMenu,
}) {
    const items = [
        {
            id: "map", label: "Globe",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="1,2 7,4 7,17 1,15" fill="none"/>
                    <polygon points="7,4 13,2 13,15 7,17" fill="none"/>
                    <polygon points="13,2 19,4 19,17 13,15" fill="none"/>
                </svg>
            ),
            onClick: onSwitchToMap, active: activeTabType === "map",
        },
        {
            id: "news", label: "News",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="16" height="14" rx="1.5" fill="none"/>
                    <line x1="6" y1="7"  x2="14" y2="7"/>
                    <line x1="6" y1="10" x2="14" y2="10"/>
                    <line x1="6" y1="13" x2="10" y2="13"/>
                </svg>
            ),
            onClick: onSwitchToNews, active: activeTabType === "news",
        },
        {
            id: "reports", label: "Reports",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="16" height="16" rx="2" fill="none"/>
                    <line x1="6" y1="7"  x2="14" y2="7"/>
                    <line x1="6" y1="10" x2="11" y2="10"/>
                    <path d="M13 13 L16 10 L14 8 L11 11 L11 13 Z" strokeWidth="1.2"/>
                </svg>
            ),
            onClick: onOpenBriefings, active: activeTabType === "briefing", dot: reportsUnread,
        },
        {
            id: "forge", label: "Forge",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="10,2 13,7 18,7 14.5,11 16,16 10,13 4,16 5.5,11 2,7 7,7"/>
                </svg>
            ),
            onClick: onOpenForge, active: activeTabType === "forge", activeColor: "#4A9EE0",
        },
        {
            id: "alerts", label: "Alerts",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 3C10 3 6 4.5 6 10V14L3.5 16H16.5L14 14V10C14 4.5 10 3 10 3Z" fill="none"/>
                    <line x1="8" y1="16" x2="12" y2="16"/>
                </svg>
            ),
            onClick: onToggleAlertLog, active: false, badge: alertLogUnread,
        },
        {
            id: "menu", label: "Menu",
            icon: (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="3" y1="5" x2="17" y2="5"/>
                    <line x1="3" y1="10" x2="17" y2="10"/>
                    <line x1="3" y1="15" x2="17" y2="15"/>
                </svg>
            ),
            onClick: onOpenMenu, active: false,
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
            zIndex:         1200,
            fontFamily:     "Inter, -apple-system, sans-serif",
        }}>
            <div style={{ display: "flex", alignItems: "stretch", height: 56 }}>
                {items.map(item => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        style={{
                            position:       "relative",
                            flex:           1,
                            display:        "flex",
                            flexDirection:  "column",
                            alignItems:     "center",
                            justifyContent: "center",
                            gap:            3,
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          item.active ? (item.activeColor || "#2d8fe8") : "rgba(255,255,255,0.35)",
                            fontSize:       11,
                            fontWeight:     item.active ? 700 : 400,
                            letterSpacing:  "0.04em",
                            textTransform:  "uppercase",
                            padding:        "6px 0 2px",
                            transition:     "color 0.15s, border-color 0.15s",
                            minHeight:      56,
                            WebkitTapHighlightColor: "transparent",
                            borderTop: item.active ? `2px solid ${item.activeColor || "#2d8fe8"}` : "2px solid transparent",
                        }}
                    >
                        {item.icon}
                        {item.label}
                        {item.dot && (
                            <span style={{
                                position: "absolute", top: 6, right: "30%", width: 6, height: 6,
                                borderRadius: "50%", background: "var(--akili-accent)",
                            }} />
                        )}
                        {item.badge > 0 && (
                            <span style={{
                                position: "absolute", top: 4, right: "28%", minWidth: 14, height: 14,
                                borderRadius: 7, background: "var(--akili-accent)", color: "#fff",
                                fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center",
                                justifyContent: "center", lineHeight: 1, padding: "0 3px",
                            }}>
                                {item.badge > 99 ? "99+" : item.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </nav>
        </>
    )
}
