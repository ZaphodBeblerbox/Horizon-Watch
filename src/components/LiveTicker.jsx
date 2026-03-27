import { useRef } from "react"

const TIER_COLOR = {
    critical: "#ef4444", significant: "#f97316", elevated: "#eab308", low: "#94a3b8",
}

const TICKER_CSS = `
@keyframes hw-ticker-scroll {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
}
@keyframes hw-ticker-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
}
`

export default function LiveTicker({ events, onItemClick }) {
    const trackRef = useRef(null)

    if (!events || events.length === 0) return null

    const cutoff = Date.now() - 24 * 3600 * 1000
    const items = events
        .filter(e => {
            const ts = e.latest_event || e.published
            return !ts || new Date(ts).getTime() > cutoff
        })
        .slice(0, 60)

    if (items.length === 0) return null

    // Double items for seamless infinite loop (translateX(-50%) lands at start)
    const displayItems = [...items, ...items]
    const duration = Math.max(40, items.length * 7) // seconds

    return (
        <div style={{
            position:       "fixed",
            bottom:         0,
            left:           48,
            right:          0,
            height:         34,
            background:     "rgba(4,10,20,0.92)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderTop:      "1px solid rgba(255,255,255,0.08)",
            zIndex:         900,
            overflow:       "hidden",
            display:        "flex",
            alignItems:     "center",
            fontFamily:     "Inter, -apple-system, monospace",
        }}>
            <style>{TICKER_CSS}</style>

            {/* LIVE badge */}
            <div style={{
                padding:     "0 10px",
                borderRight: "1px solid rgba(255,255,255,0.08)",
                height:      "100%",
                display:     "flex",
                alignItems:  "center",
                gap:         5,
                flexShrink:  0,
            }}>
                <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "#ef4444",
                    animation: "hw-ticker-blink 1.5s ease-in-out infinite",
                }} />
                <span style={{
                    fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.12em", color: "#ef4444",
                }}>LIVE</span>
            </div>

            {/* Scrolling track */}
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
                <div
                    ref={trackRef}
                    style={{
                        display:   "inline-flex",
                        alignItems: "center",
                        animation: `hw-ticker-scroll ${duration}s linear infinite`,
                        whiteSpace: "nowrap",
                    }}
                >
                    {displayItems.map((item, i) => {
                        const color   = TIER_COLOR[item.severity_tier] || "#94a3b8"
                        const ts      = item.latest_event || item.published
                        const timeStr = ts
                            ? new Date(ts).toLocaleTimeString("en-GB", {
                                hour: "2-digit", minute: "2-digit", timeZone: "UTC",
                              }) + "Z"
                            : ""
                        const loc     = item.location || ""
                        const title   = item.clean_title || item.headline || ""

                        return (
                            <span
                                key={i}
                                onClick={() => onItemClick?.(item)}
                                style={{
                                    display:    "inline-flex",
                                    alignItems: "center",
                                    gap:        5,
                                    padding:    "0 28px 0 0",
                                    cursor:     "pointer",
                                    fontSize:   11,
                                    color:      "#a0b4c8",
                                }}
                            >
                                <span style={{ color, fontSize: 7, flexShrink: 0 }}>●</span>
                                {timeStr && (
                                    <span style={{ color: "#4a6080", fontSize: 10 }}>[{timeStr}]</span>
                                )}
                                {loc && (
                                    <span style={{
                                        color: "#6a80a0", fontWeight: 600, fontSize: 11,
                                    }}>{loc}:</span>
                                )}
                                <span style={{ fontWeight: 400 }}>{title}</span>
                                <span style={{ color: "rgba(255,255,255,0.08)", marginLeft: 10 }}>◆</span>
                            </span>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
