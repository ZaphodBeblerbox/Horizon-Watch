import { useMemo } from "react"

function stripNonLatin(str) {
    if (!str) return ""
    return str.replace(/[^\x00-\x7F\u00C0-\u024F\u1E00-\u1EFF\s\-,.()'"]/g, "").trim()
}

const TIER_COLOR = {
    critical:    "#dc2626",
    significant: "#d97706",
    elevated:    "#0d9488",
    low:         "#4a5568",
}

function timeAgo(iso) {
    if (!iso) return ""
    const diffMs  = Date.now() - new Date(iso).getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1)   return "just now"
    if (diffMin < 60)  return `${diffMin}m`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)    return `${diffH}h`
    return `${Math.floor(diffH / 24)}d`
}

export default function SurfaceFeed({ items = [], selectedId, onSelect, updatedAt, open = true }) {
    const sorted = useMemo(() => {
        return [...items]
            .filter(item => {
                const clean = stripNonLatin(item.headline || "")
                return clean.length >= 15
            })
            .sort((a, b) => b.relevance_score - a.relevance_score)
    }, [items])

    if (!open) return null

    return (
        <>
        <style>{`@keyframes feedSlideIn{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
        <div style={{
            position:        "absolute",
            top:             0,
            left:            48,
            bottom:          0,
            width:           280,
            display:         "flex",
            flexDirection:   "column",
            background:      "rgba(14,20,32,0.92)",
            backdropFilter:  "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            borderRight:     "1px solid rgba(255,255,255,0.07)",
            fontFamily:      "system-ui, -apple-system, sans-serif",
            overflow:        "hidden",
            zIndex:          50,
            animation:       "feedSlideIn 0.15s ease",
        }}>
            {/* Header */}
            <div style={{
                height:         36,
                flexShrink:     0,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "0 12px",
                borderBottom:   "1px solid rgba(255,255,255,0.06)",
            }}>
                <span style={{
                    fontSize:      12,
                    fontWeight:    700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color:         "#8899aa",
                }}>
                    Surface Feed
                </span>
                <span style={{ fontSize: 11, color: "#4a5568", fontVariantNumeric: "tabular-nums" }}>
                    {items.length}
                </span>
            </div>

            {/* Items — scrollable */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                {sorted.length === 0 ? (
                    <div style={{
                        padding:   "20px 12px",
                        fontSize:  12,
                        color:     "#4a5568",
                        textAlign: "center",
                    }}>
                        Waiting for data...
                    </div>
                ) : (
                    sorted.map(item => {
                        const color    = TIER_COLOR[item.severity_tier] || "#4a5568"
                        const isActive = item.id === selectedId
                        return (
                            <button
                                key={item.id}
                                onClick={() => onSelect(item)}
                                style={{
                                    display:     "flex",
                                    alignItems:  "flex-start",
                                    width:       "100%",
                                    height:      "auto",
                                    minHeight:   36,
                                    padding:     "8px 12px 8px 10px",
                                    background:  isActive ? "rgba(13,148,136,0.08)" : "none",
                                    border:      "none",
                                    borderLeft:  isActive ? `2px solid #0d9488` : "2px solid transparent",
                                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                                    cursor:      "pointer",
                                    textAlign:   "left",
                                    boxSizing:   "border-box",
                                    transition:  "background 0.1s",
                                    gap:         8,
                                }}
                                onMouseEnter={e => {
                                    if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                                }}
                                onMouseLeave={e => {
                                    if (!isActive) e.currentTarget.style.background = "none"
                                }}
                            >
                                {/* Severity dot */}
                                <div style={{
                                    width:        6,
                                    height:       6,
                                    borderRadius: "50%",
                                    background:   color,
                                    flexShrink:   0,
                                    marginTop:    4,
                                }} />

                                {/* Text */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize:     12,
                                        fontWeight:   isActive ? 600 : 400,
                                        color:        isActive ? "#e8edf2" : "#8899aa",
                                        lineHeight:   1.35,
                                        overflow:     "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace:   "nowrap",
                                    }}>
                                        {stripNonLatin(item.headline)}
                                    </div>
                                    <div style={{
                                        display:   "flex",
                                        gap:       8,
                                        marginTop: 2,
                                        fontSize:  11,
                                        color:     "#4a5568",
                                    }}>
                                        <span style={{
                                            overflow:     "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace:   "nowrap",
                                            flex:         1,
                                        }}>
                                            {stripNonLatin(item.location)}
                                        </span>
                                        <span style={{ flexShrink: 0 }}>{timeAgo(item.published_at)}</span>
                                    </div>
                                </div>
                            </button>
                        )
                    })
                )}
            </div>

            {/* Footer */}
            {updatedAt && (
                <div style={{
                    flexShrink:  0,
                    padding:     "5px 12px",
                    fontSize:    10,
                    color:       "#4a5568",
                    borderTop:   "1px solid rgba(255,255,255,0.04)",
                }}>
                    {timeAgo(updatedAt)} ago
                </div>
            )}
        </div>
        </>
    )
}
