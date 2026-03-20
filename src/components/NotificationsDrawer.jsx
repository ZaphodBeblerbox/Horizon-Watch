import { useMemo } from "react"

const TIER_COLOR = {
    critical:    "#dc2626",
    significant: "#d97706",
    elevated:    "#0d9488",
    low:         "#4a5568",
}

const TYPE_LABEL = {
    conflict_zone:    "Conflict Zone",
    news_event:       "News Event",
    chokepoint_alert: "Chokepoint Alert",
}

function timeAgo(iso) {
    if (!iso) return ""
    const diffMs  = Date.now() - new Date(iso).getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1)   return "just now"
    if (diffMin < 60)  return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)    return `${diffH}h ago`
    return `${Math.floor(diffH / 24)}d ago`
}

function stripNonLatin(str) {
    if (!str) return ""
    return str.replace(/[^\x00-\x7F\u00C0-\u024F\u1E00-\u1EFF\s\-,.()'"]/g, "").trim()
}

export default function NotificationsDrawer({
    items = [],
    readIds,
    onMarkRead,
    onSelectItem,
    open,
    onClose,
    sortMode,
    onSortModeChange,
}) {
    const sorted = useMemo(() => {
        return [...items].sort((a, b) =>
            sortMode === "time"
                ? new Date(b.published_at) - new Date(a.published_at)
                : b.relevance_score - a.relevance_score
        )
    }, [items, sortMode])

    if (!open) return null

    return (
        <>
        <style>{`@keyframes notifSlideIn{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
        <div style={{
            position:            "absolute",
            top:                 0,
            left:                0,
            bottom:              0,
            width:               320,
            display:             "flex",
            flexDirection:       "column",
            background:          "var(--akili-panel)",
            backdropFilter:      "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRight:         "1px solid var(--akili-border)",
            fontFamily:          "system-ui, -apple-system, sans-serif",
            zIndex:              50,
            animation:           "notifSlideIn 0.15s ease",
        }}>
            {/* Header */}
            <div style={{
                height:         36,
                flexShrink:     0,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "0 12px",
                borderBottom:   "1px solid var(--akili-border)",
            }}>
                <span style={{
                    fontSize:      12,
                    fontWeight:    700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color:         "var(--akili-text-secondary)",
                }}>
                    Notifications
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Sort toggle */}
                    <div style={{ display: "flex", gap: 4 }}>
                        {["relevance", "time"].map(mode => (
                            <button
                                key={mode}
                                onClick={() => onSortModeChange(mode)}
                                style={{
                                    background:    "none",
                                    border:        "none",
                                    cursor:        "pointer",
                                    fontSize:      10,
                                    fontWeight:    600,
                                    letterSpacing: "0.04em",
                                    color:         sortMode === mode ? "#0d9488" : "var(--akili-text-muted)",
                                    padding:       "0 4px",
                                    transition:    "color 0.1s",
                                }}
                            >
                                {mode === "relevance" ? "SCORE" : "TIME"}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border:     "none",
                            color:      "var(--akili-text-muted)",
                            cursor:     "pointer",
                            fontSize:   18,
                            lineHeight: 1,
                            padding:    0,
                        }}
                    >
                        ×
                    </button>
                </div>
            </div>

            {/* Items — scrollable */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                {sorted.length === 0 ? (
                    <div style={{
                        padding:   "24px 12px",
                        fontSize:  12,
                        color:     "var(--akili-text-muted)",
                        textAlign: "center",
                    }}>
                        No notifications yet.
                    </div>
                ) : sorted.map(item => {
                    const isRead   = readIds?.has(item.id)
                    const color    = TIER_COLOR[item.severity_tier] || "#4a5568"
                    const headline = stripNonLatin(item.headline || "")
                    const location = stripNonLatin(item.location || "")
                    return (
                        <button
                            key={item.id}
                            onClick={() => onSelectItem(item)}
                            style={{
                                display:      "flex",
                                alignItems:   "stretch",
                                width:        "100%",
                                padding:      0,
                                background:   isRead ? "transparent" : "var(--akili-hover)",
                                border:       "none",
                                borderBottom: "1px solid rgba(255,255,255,0.04)",
                                cursor:       "pointer",
                                textAlign:    "left",
                                boxSizing:    "border-box",
                                transition:   "background 0.1s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "var(--akili-hover-strong)" }}
                            onMouseLeave={e => { e.currentTarget.style.background = isRead ? "transparent" : "var(--akili-hover)" }}
                        >
                            {/* Severity bar */}
                            <div style={{
                                width:      3,
                                flexShrink: 0,
                                background: color,
                                opacity:    isRead ? 0.4 : 1,
                            }} />

                            {/* Content */}
                            <div style={{ flex: 1, padding: "8px 10px 8px 10px", minWidth: 0 }}>
                                <div style={{
                                    fontSize:     13,
                                    fontWeight:   isRead ? 400 : 500,
                                    color:        isRead ? "var(--akili-text-muted)" : "var(--akili-text-primary)",
                                    lineHeight:   1.35,
                                    overflow:     "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace:   "nowrap",
                                    marginBottom: 4,
                                }}>
                                    {headline}
                                </div>

                                <div style={{
                                    display:  "flex",
                                    gap:      8,
                                    fontSize: 11,
                                    color:    "var(--akili-text-muted)",
                                    flexWrap: "wrap",
                                }}>
                                    {location && (
                                        <span style={{
                                            overflow:     "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace:   "nowrap",
                                            flex:         1,
                                            minWidth:     0,
                                        }}>
                                            {location}
                                        </span>
                                    )}
                                    <span style={{ flexShrink: 0 }}>{timeAgo(item.published_at)}</span>
                                </div>

                                {/* Type tag + AI brief indicator */}
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                    {item.type && (
                                        <span style={{
                                            fontSize:      10,
                                            fontWeight:    600,
                                            letterSpacing: "0.06em",
                                            textTransform: "uppercase",
                                            color:         isRead ? "#4a5568" : color,
                                            opacity:       isRead ? 0.6 : 1,
                                        }}>
                                            {TYPE_LABEL[item.type] || item.type}
                                        </span>
                                    )}
                                    {item.auto_brief && (
                                        <span
                                            title="Auto-generated AI brief available"
                                            style={{
                                                display:      "inline-flex",
                                                alignItems:   "center",
                                                gap:          3,
                                                fontSize:     9,
                                                fontWeight:   700,
                                                letterSpacing:"0.06em",
                                                color:        "#0d9488",
                                                opacity:      isRead ? 0.5 : 0.9,
                                            }}
                                        >
                                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#0d9488", display: "inline-block", flexShrink: 0 }} />
                                            AI
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    )
                })}
            </div>

            {/* Footer — unread count */}
            <div style={{
                flexShrink:   0,
                padding:      "6px 12px",
                borderTop:    "1px solid var(--akili-border-subtle)",
                fontSize:     10,
                color:        "var(--akili-text-muted)",
                textAlign:    "center",
            }}>
                {items.filter(i => !readIds?.has(i.id)).length} unread · {items.length} total
            </div>
        </div>
        </>
    )
}
