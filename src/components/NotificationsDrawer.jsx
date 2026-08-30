import { useMemo, useState, useEffect } from "react"
import BottomSheet from "./BottomSheet.jsx"

const TIER_COLOR = {
    critical:    "#dc2626",
    significant: "#d97706",
    elevated:    "var(--akili-accent)",
    low:         "#4a5568",
}

const TYPE_LABEL = {
    conflict_zone:    "Conflict Zone",
    news_event:       "News Event",
    chokepoint_alert: "Chokepoint Alert",
}

// Round 1 severity color tokens (index.html :root) — used for kind:"fusion"
// rows. Keeps the existing TIER_COLOR map (different key names, hardcoded
// hex) untouched for the pre-existing alert/surface-pool path above.
const SEV_TOKEN = {
    critical: "var(--sev-critical)",
    high:     "var(--sev-high)",
    medium:   "var(--sev-medium)",
    low:      "var(--sev-low)",
}

/**
 * Map a FusionEvent `severity` string to its Round 1 color token, falling
 * back to the medium tier for unrecognised values. Exported (pure, no
 * component instance needed) so it's directly testable.
 */
export function sevToken(severity) {
    return SEV_TOKEN[severity] || SEV_TOKEN.medium
}

/**
 * "MARITIME + NEWS"-style joined label for a fusion item's domains array.
 * Exported for direct testing without rendering the component.
 */
export function formatDomainsLabel(domains) {
    if (!Array.isArray(domains) || domains.length === 0) return ""
    return domains.join(" + ")
}

/**
 * 0-1 confidence float -> whole-number percentage for display.
 * Exported for direct testing without rendering the component.
 */
export function fusionConfidencePct(confidence) {
    const n = typeof confidence === "number" ? confidence : Number(confidence)
    if (!Number.isFinite(n)) return 0
    return Math.round(Math.min(1, Math.max(0, n)) * 100)
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

// Distinct row for kind:"fusion" items \u2014 a real correlation-engine hit
// (real domains corroborated at a real confidence), not a generic alert.
// Shares the read/unread mechanics (readIds/onMarkRead via onSelectItem \u2192
// caller marks read) and the outer button/severity-bar scaffold of the
// alert row, but surfaces domains + confidence + severity instead of the
// alert's type tag / AI-brief indicator.
function FusionRow({ item, isRead, onSelectItem }) {
    const color         = sevToken(item.severity)
    const title         = stripNonLatin(item.title || "Intelligence Fusion Event")
    const subtitle      = stripNonLatin(item.subtitle || "")
    const location      = stripNonLatin(item.location_name || "")
    const domains       = Array.isArray(item.domains) ? item.domains : []
    const domainsLabel  = formatDomainsLabel(domains)
    const confidencePct = fusionConfidencePct(item.confidence)

    return (
        <button
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
            {/* Severity bar \u2014 Round 1 --sev-* token color */}
            <div style={{
                width:      3,
                flexShrink: 0,
                background: color,
                opacity:    isRead ? 0.4 : 1,
            }} />

            <div style={{ flex: 1, padding: "8px 10px", minWidth: 0 }}>
                {/* Fusion label + severity + confidence */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{
                        fontSize:      9,
                        fontWeight:    700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color,
                        opacity:       isRead ? 0.6 : 1,
                    }}>
                        Fusion \u00B7 {item.severity || "medium"}
                    </span>
                    <span style={{
                        fontSize:   10,
                        fontWeight: 700,
                        color:      isRead ? "var(--akili-text-muted)" : color,
                        opacity:    isRead ? 0.6 : 0.9,
                    }}>
                        {confidencePct}% confidence
                    </span>
                </div>

                {/* Title */}
                <div style={{
                    fontSize:     13,
                    fontWeight:   isRead ? 400 : 500,
                    color:        isRead ? "var(--akili-text-muted)" : "var(--akili-text-primary)",
                    lineHeight:   1.35,
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                    marginBottom: 3,
                }}>
                    {title}
                </div>

                {/* Subtitle / narrative summary */}
                {subtitle && (
                    <div style={{
                        fontSize:     11.5,
                        color:        "var(--akili-text-secondary)",
                        lineHeight:   1.3,
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                        marginBottom: 4,
                    }}>
                        {subtitle}
                    </div>
                )}

                {/* Domain badges \u2014 real corroborating domains, e.g. MARITIME + NEWS */}
                {domains.length > 0 && (
                    <div
                        title={domainsLabel}
                        style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}
                    >
                        {domains.map((d, i) => (
                            <span key={`${d}-${i}`} style={{
                                display:       "inline-flex",
                                alignItems:    "center",
                                fontSize:      9,
                                fontWeight:    700,
                                letterSpacing: "0.04em",
                                padding:       "1px 5px",
                                borderRadius:  3,
                                border:        `1px solid ${color}`,
                                color,
                                opacity:       isRead ? 0.6 : 1,
                            }}>
                                {d}
                            </span>
                        ))}
                    </div>
                )}

                {/* Location + time */}
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
                    <span style={{ flexShrink: 0 }}>{timeAgo(item.published_at || item.timestamp)}</span>
                </div>
            </div>
        </button>
    )
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
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    const sorted = useMemo(() => {
        return [...items].sort((a, b) =>
            sortMode === "time"
                ? new Date(b.published_at) - new Date(a.published_at)
                : b.relevance_score - a.relevance_score
        )
    }, [items, sortMode])

    // Desktop-only header (title + sort + close)
    const desktopHeader = (
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
                                color:         sortMode === mode ? "var(--akili-accent)" : "var(--akili-text-muted)",
                                padding:       "0 4px",
                                transition:    "color 0.1s",
                                minHeight:     "unset",
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
                        minHeight:  "unset",
                    }}
                >
                    ×
                </button>
            </div>
        </div>
    )

    // Shared items list (used by both mobile and desktop)
    const itemList = (
        <div style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
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
                    const isRead = readIds?.has(item.id)

                    // Correlation-engine hits render via a distinct row —
                    // domains/confidence/severity/location instead of the
                    // generic alert type tag. Everything below this branch
                    // is the pre-existing alert/surface-pool path, unchanged.
                    if (item.kind === "fusion") {
                        return (
                            <FusionRow
                                key={item.id}
                                item={item}
                                isRead={isRead}
                                onSelectItem={onSelectItem}
                            />
                        )
                    }

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
                                                color:        "var(--akili-accent)",
                                                opacity:      isRead ? 0.5 : 0.9,
                                            }}
                                        >
                                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--akili-accent)", display: "inline-block", flexShrink: 0 }} />
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
    )   // end itemList

    if (!open) return null

    if (isMobile) {
        return (
            <BottomSheet isOpen onClose={onClose} title="Notifications" height="half">
                {/* Sort controls — only row needed; BottomSheet already has title + close */}
                <div style={{ display: "flex", gap: 4, padding: "6px 12px", justifyContent: "flex-end", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
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
                                color:         sortMode === mode ? "var(--akili-accent)" : "var(--akili-text-muted)",
                                padding:       "4px 6px",
                                minHeight:     "unset",
                            }}
                        >
                            {mode === "relevance" ? "SCORE" : "TIME"}
                        </button>
                    ))}
                </div>
                {itemList}
            </BottomSheet>
        )
    }

    return (
        <>
        <style>{`@keyframes notifSlideIn{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
        <div style={{
            position:             "absolute",
            top:                  0,
            left:                 0,
            bottom:               0,
            width:                320,
            display:              "flex",
            flexDirection:        "column",
            background:           "var(--akili-panel)",
            backdropFilter:       "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRight:          "1px solid var(--akili-border)",
            fontFamily:           "system-ui, -apple-system, sans-serif",
            zIndex:               50,
            animation:            "notifSlideIn 0.15s ease",
        }}>
            {desktopHeader}
            {itemList}
        </div>
        </>
    )
}
