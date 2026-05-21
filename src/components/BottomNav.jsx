// BottomNav — swipable mobile bottom tab bar (< 768px)
// Horizontally scrollable so all items fit; scroll-snap keeps taps precise.

import { useState } from "react"
import NewsReels from "./NewsReels.jsx"

const BOTTOM_NAV_STYLES = `
@keyframes director-nav-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.7; transform: scale(1.15); }
}
.director-nav-icon-active {
  animation: director-nav-pulse 1.6s ease-in-out infinite;
  color: #f59e0b !important;
}
.bottom-nav-scroll::-webkit-scrollbar { display: none; }
.bottom-nav-scroll { -ms-overflow-style: none; scrollbar-width: none; }
`

const ITEM_W = 64  // px per nav item

export default function BottomNav({
    activeTabType,
    rightPanel,
    onSwitchToMap,
    onSwitchToNews,
    onOpenBriefings,
    onOpenAnalytics,
    notifUnread,
    onToggleNotif,
    onOpenMenu,
    overwatchActive,
    onToggleOverwatch,
    onOpenPoi,
    onOpenForge,
    onOpenLayers,
    directorActive = false,
    onDirectorTap = null,
}) {
    const [showReels, setShowReels] = useState(false)

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
            id:    "reels",
            label: "Reels",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="2"  y="3" width="6" height="18" rx="2" fill="currentColor" opacity="0.9"/>
                    <rect x="9"  y="3" width="6" height="18" rx="2" fill="currentColor" opacity="0.6"/>
                    <rect x="16" y="3" width="6" height="18" rx="2" fill="currentColor" opacity="0.3"/>
                    <circle cx="5"  cy="8"  r="1.5" fill="white" opacity="0.6"/>
                    <circle cx="5"  cy="12" r="1.5" fill="white" opacity="0.6"/>
                    <circle cx="5"  cy="16" r="1.5" fill="white" opacity="0.6"/>
                </svg>
            ),
            onClick:     () => setShowReels(true),
            active:      showReels,
            activeColor: "#FF3B30",
        },
        {
            id:    "briefings",
            label: "Briefs",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="16" height="16" rx="2" fill="none"/>
                    <line x1="6" y1="7"  x2="14" y2="7"/>
                    <line x1="6" y1="10" x2="11" y2="10"/>
                    <path d="M13 13 L16 10 L14 8 L11 11 L11 13 Z" strokeWidth="1.2"/>
                </svg>
            ),
            onClick: onOpenBriefings,
            active: activeTabType === "briefing",
        },
        {
            id:    "analytics",
            label: "Analytics",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2,15 6,9 10,12 14,5 18,8"/>
                    <line x1="2" y1="18" x2="18" y2="18"/>
                </svg>
            ),
            onClick: onOpenAnalytics,
            active: activeTabType === "analytics",
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
            id:    "forge",
            label: "Forge",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="10,2 13,7 18,7 14.5,11 16,16 10,13 4,16 5.5,11 2,7 7,7"/>
                </svg>
            ),
            onClick: onOpenForge,
            active: activeTabType === "forge",
            activeColor: "#4A9EE0",
        },
        {
            id:    "layers",
            label: "Layers",
            icon:  (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="10,2 18,6 10,10 2,6"/>
                    <polyline points="2,10 10,14 18,10"/>
                    <polyline points="2,14 10,18 18,14"/>
                </svg>
            ),
            onClick: onOpenLayers,
            active: rightPanel === "layers",
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
        {showReels && <NewsReels onClose={() => setShowReels(false)} />}
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
            {/* Scrollable row — hidden scrollbar, scroll-snap */}
            <div
                className="bottom-nav-scroll"
                style={{
                    display:            "flex",
                    alignItems:         "stretch",
                    height:             56,
                    overflowX:          "auto",
                    overflowY:          "hidden",
                    scrollSnapType:     "x mandatory",
                    WebkitOverflowScrolling: "touch",
                    /* fade-out hint on the right edge so user knows it scrolls */
                    maskImage:          "linear-gradient(to right, black 80%, transparent 100%)",
                    WebkitMaskImage:    "linear-gradient(to right, black 80%, transparent 100%)",
                }}
            >
                {items.map(item => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        style={{
                            flexShrink:     0,
                            width:          ITEM_W,
                            display:        "flex",
                            flexDirection:  "column",
                            alignItems:     "center",
                            justifyContent: "center",
                            gap:            3,
                            background:     "none",
                            border:         "none",
                            cursor:         "pointer",
                            color:          item.active ? (item.activeColor || "#2d8fe8") : "rgba(255,255,255,0.35)",
                            fontSize:       8.5,
                            fontWeight:     item.active ? 700 : 400,
                            letterSpacing:  "0.06em",
                            textTransform:  "uppercase",
                            padding:        "6px 0 2px",
                            transition:     "color 0.15s",
                            minHeight:      56,
                            scrollSnapAlign: "start",
                            WebkitTapHighlightColor: "transparent",
                            /* active indicator dot above icon */
                            borderTop: item.active ? `2px solid ${item.activeColor || "#2d8fe8"}` : "2px solid transparent",
                        }}
                    >
                        {item.icon}
                        {item.label}
                    </button>
                ))}
                {/* Spacer so last item doesn't sit behind the fade mask */}
                <div style={{ flexShrink: 0, width: 20 }} />
            </div>
        </nav>
        </>
    )
}
