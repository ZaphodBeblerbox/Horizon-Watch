// MobileDrawer — mobile secondary/overflow menu.
// Sits between TopBar (40px) and BottomNav (56px) — does NOT cover either.
// The 4 fixed top-level modes + Alerts live in BottomNav now; this drawer is
// mobile's equivalent of desktop's SecondaryMenu — real features that
// aren't a top-level mode (Analytics, Reels, Overwatch, Director Mode,
// Threats, Health, TV, Sound, Settings, Profile), plus the mobile-only
// Layers entry (LayerRail renders as a BottomSheet on narrow screens).

const SECTION_HEADER = {
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: "0.12em",
    color:         "rgba(255,255,255,0.25)",
    textTransform: "uppercase",
    padding:       "16px 16px 6px",
}

function Row({ label, active, onClick, badge }) {
    return (
        <button
            onClick={onClick}
            style={{
                width:          "100%",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                background:     active ? "rgba(45,143,232,0.12)" : "none",
                border:         "none",
                borderLeft:     active ? "3px solid #2d8fe8" : "3px solid transparent",
                color:          active ? "#2d8fe8" : "rgba(255,255,255,0.7)",
                fontSize:       13,
                fontWeight:     active ? 600 : 400,
                cursor:         "pointer",
                padding:        "12px 16px 12px 13px",
                textAlign:      "left",
                transition:     "background 0.1s, color 0.1s",
                WebkitTapHighlightColor: "transparent",
                minHeight:      44,
            }}
        >
            {label}
            {badge > 0 && (
                <span style={{
                    background:   "#ef4444",
                    color:        "#fff",
                    fontSize:     9,
                    fontWeight:   700,
                    minWidth:     16,
                    height:       16,
                    borderRadius: 8,
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    padding:      "0 4px",
                }}>
                    {badge > 99 ? "99+" : badge}
                </span>
            )}
        </button>
    )
}

export default function MobileDrawer({
    open,
    onClose,
    rightPanel,
    onRightPanel,
    activeTabType,
    onOpenLayers,
    onOpenReels,
    profile,
    soundMuted,
    onToggleSound,
    tvOpen,
    onToggleTV,
    overwatchActive = false,
    onToggleOverwatch = null,
    directorActive = false,
    onDirectorTap = null,
}) {
    function panelRow(id, label, badge) {
        return (
            <Row
                label={label}
                active={rightPanel === id}
                badge={badge}
                onClick={() => {
                    onRightPanel(id)
                    onClose()
                }}
            />
        )
    }

    // Always rendered — slide in/out with CSS transform.
    // Backdrop shown only when open.
    return (
        <>
            {/* Backdrop — tap to close */}
            <div
                onClick={onClose}
                style={{
                    position:   "fixed",
                    inset:      0,
                    background: "rgba(0,0,0,0.5)",
                    zIndex:     1400,
                    backdropFilter: "blur(2px)",
                    WebkitBackdropFilter: "blur(2px)",
                    opacity:    open ? 1 : 0,
                    pointerEvents: open ? "auto" : "none",
                    transition: "opacity 0.3s ease",
                }}
            />

            {/* Drawer panel — slides from right, bounded by TopBar + BottomNav */}
            <div style={{
                position:       "fixed",
                top:            40,   // Below TopBar
                right:          0,
                bottom:         "calc(56px + env(safe-area-inset-bottom, 0px))",
                width:          240,
                maxWidth:       "65vw",
                background:     "rgba(6,13,26,0.92)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                borderLeft:     "1px solid rgba(255,255,255,0.08)",
                zIndex:         1401,
                display:        "flex",
                flexDirection:  "column",
                overflowY:      "auto",
                fontFamily:     "Inter, -apple-system, sans-serif",
                transform:      open ? "translateX(0)" : "translateX(100%)",
                transition:     "transform 0.3s ease",
            }}>
                {/* Header */}
                <div style={{
                    display:        "flex",
                    alignItems:     "center",
                    justifyContent: "space-between",
                    padding:        "14px 16px",
                    borderBottom:   "1px solid rgba(255,255,255,0.06)",
                    flexShrink:     0,
                }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
                        More
                    </span>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border:     "none",
                            color:      "rgba(255,255,255,0.4)",
                            fontSize:   20,
                            cursor:     "pointer",
                            padding:    "0 4px",
                            lineHeight: 1,
                            minHeight:  44,
                            minWidth:   44,
                            display:    "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >×</button>
                </div>

                <div style={{ flex: 1, overflowY: "auto" }}>
                    <div style={SECTION_HEADER}>Map</div>
                    <Row label="Layers" active={false} onClick={() => { onOpenLayers(); onClose() }} />

                    <div style={SECTION_HEADER}>Intelligence</div>
                    {panelRow("analytics", "Analytics")}
                    {panelRow("threats", "Threats")}
                    {panelRow("health", "System Health")}
                    <Row label="Reels" active={false} onClick={() => { onOpenReels(); onClose() }} />
                    <button
                        onClick={() => { onDirectorTap?.(); onClose() }}
                        style={{
                            width:          "100%",
                            display:        "flex",
                            alignItems:     "center",
                            gap:            8,
                            background:     directorActive ? "rgba(245,158,11,0.10)" : "none",
                            border:         "none",
                            borderLeft:     directorActive ? "3px solid #f59e0b" : "3px solid transparent",
                            color:          directorActive ? "#f59e0b" : "rgba(255,255,255,0.7)",
                            fontSize:       13,
                            fontWeight:     directorActive ? 600 : 400,
                            cursor:         "pointer",
                            padding:        "12px 16px 12px 13px",
                            textAlign:      "left",
                            transition:     "background 0.1s, color 0.1s",
                            WebkitTapHighlightColor: "transparent",
                            minHeight:      44,
                        }}
                    >
                        <span style={{ fontSize: 16, lineHeight: 1 }}>◈</span>
                        Director Mode
                    </button>
                    {onToggleOverwatch && (
                        <Row label="Overwatch" active={overwatchActive} onClick={() => { onToggleOverwatch(); onClose() }} />
                    )}
                    {panelRow("workspaces", "Workspaces")}
                    {panelRow("situations", "Situations")}

                    {/* Settings */}
                    <div style={SECTION_HEADER}>Settings</div>
                    {panelRow("profile", "Profile")}
                    {panelRow("settings", "Preferences")}
                    <Row
                        label={soundMuted ? "Sound: Muted" : "Sound: On"}
                        active={false}
                        onClick={onToggleSound}
                    />
                    <Row
                        label="Live TV"
                        active={tvOpen}
                        onClick={() => { onToggleTV?.(); onClose() }}
                    />
                </div>

                {/* Profile chip at bottom */}
                {profile && (
                    <div style={{
                        padding:      "12px 16px",
                        borderTop:    "1px solid rgba(255,255,255,0.06)",
                        display:      "flex",
                        alignItems:   "center",
                        gap:          8,
                        flexShrink:   0,
                    }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {profile.displayName || "Operator"}{profile.role ? ` · ${profile.role}` : ""}
                        </span>
                    </div>
                )}
            </div>
        </>
    )
}
