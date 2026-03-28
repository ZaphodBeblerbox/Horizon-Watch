// MobileDrawer — slide-in overlay replacing Sidebar on mobile
// Sits between TopBar (40px) and BottomNav (56px) — does NOT cover either.

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
    onOpenTab,
    profile,
    currentUser,
    alertCount,
    notifUnread,
    onToggleNotif,
    briefingUnread,
    soundMuted,
    onToggleSound,
    tvOpen,
    onToggleTV,
    onToggleAdmin,
    chatOpen,
    onToggleChat,
}) {
    const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin"

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
                bottom:         56,   // Above BottomNav
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
                        Menu
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
                    {/* Panels */}
                    <div style={SECTION_HEADER}>Panels</div>
                    {panelRow("layers", "Layers")}
                    {panelRow("alerts", "Alerts", alertCount > 0 ? alertCount : 0)}
                    <Row
                        label={`Notifications${notifUnread > 0 ? ` (${notifUnread})` : ""}`}
                        active={false}
                        onClick={() => { onToggleNotif(); onClose() }}
                    />
                    {panelRow("workspaces", "Workspaces")}
                    {isAdmin && panelRow("situations", "Situations")}

                    {/* Navigation */}
                    <div style={SECTION_HEADER}>Navigation</div>
                    <Row
                        label={`Briefings${briefingUnread > 0 ? ` (${briefingUnread})` : ""}`}
                        active={activeTabType === "briefing"}
                        onClick={() => { onOpenTab("briefing"); onClose() }}
                    />
                    <Row
                        label="POI"
                        active={activeTabType === "poi"}
                        onClick={() => { onOpenTab("poi"); onClose() }}
                    />

                    {/* Settings */}
                    <div style={SECTION_HEADER}>Settings</div>
                    {panelRow("profile", "Profile")}
                    {panelRow("settings", "Preferences")}
                    {panelRow("health", "System Health")}
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
                    <Row
                        label="Direct Messages"
                        active={chatOpen}
                        onClick={() => { onToggleChat?.(); onClose() }}
                    />
                    {isAdmin && (
                        <Row
                            label="Admin Console"
                            active={false}
                            onClick={() => { onToggleAdmin?.(); onClose() }}
                        />
                    )}
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
