import { useState } from "react"

// ── Icon primitives ─────────────────────────────────────────────────────────

function IconBell() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2C9 2 5.5 3.5 5.5 9V13L3 14.5H15L12.5 13V9C12.5 3.5 9 2 9 2Z" fill="none"/>
            <line x1="7.5" y1="14.5" x2="10.5" y2="14.5"/>
            <line x1="9" y1="1" x2="9" y2="2.5"/>
        </svg>
    )
}

function IconMore() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <circle cx="9" cy="4"  r="1.4"/>
            <circle cx="9" cy="9"  r="1.4"/>
            <circle cx="9" cy="14" r="1.4"/>
        </svg>
    )
}

/**
 * Trimmed utility rail — the primary Globe/News/Reports/Forge mode switch
 * lives in TopNav now (see TopBar.jsx). What's left here is real
 * cross-mode functionality that isn't a "mode": the alert log and the
 * secondary/overflow menu (Overwatch, Director Mode, Analytics, Threats,
 * Health, TV, Sound, Settings, Profile — moved out of the primary nav,
 * not deleted; see SecondaryMenu.jsx).
 */
export default function Sidebar({
    alertLogOpen     = false,
    alertLogUnread   = 0,
    onToggleAlertLog,
    secondaryMenuOpen = false,
    onToggleSecondaryMenu,
    budgetPct        = null,
}) {
    const [hovered, setHovered] = useState(null)

    const color = (id, active) => {
        if (active) return "var(--akili-accent)"
        if (hovered === id) return "var(--akili-text-secondary)"
        return "var(--akili-text-muted)"
    }

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
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                <button
                    onMouseEnter={() => setHovered("alerts")}
                    onMouseLeave={() => setHovered(null)}
                    onClick={onToggleAlertLog}
                    title="Alert Log"
                    style={{
                        position: "relative", width: 48, height: 40,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "none", border: "none", cursor: "pointer",
                        color: color("alerts", alertLogOpen), transition: "color 0.12s", flexShrink: 0,
                    }}
                >
                    <IconBell />
                    {alertLogUnread > 0 && (
                        <span style={{
                            position: "absolute", top: 6, right: 6, minWidth: 14, height: 14,
                            borderRadius: 7, background: "var(--akili-accent)", color: "#fff",
                            fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center",
                            justifyContent: "center", lineHeight: 1, padding: "0 3px",
                        }}>
                            {alertLogUnread > 99 ? "99+" : alertLogUnread}
                        </span>
                    )}
                </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 8 }}>
                {budgetPct !== null && (
                    <div style={{
                        width: 48, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                        color: budgetPct > 50 ? "var(--akili-accent)" : budgetPct > 20 ? "#d97706" : "#dc2626",
                        letterSpacing: "0.02em",
                    }}>
                        {Math.round(budgetPct)}%
                    </div>
                )}
                <button
                    onMouseEnter={() => setHovered("more")}
                    onMouseLeave={() => setHovered(null)}
                    onClick={onToggleSecondaryMenu}
                    title="More"
                    style={{
                        width: 48, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "none", border: "none", cursor: "pointer",
                        color: color("more", secondaryMenuOpen), transition: "color 0.12s", flexShrink: 0,
                    }}
                >
                    <IconMore />
                </button>
            </div>
        </div>
    )
}
