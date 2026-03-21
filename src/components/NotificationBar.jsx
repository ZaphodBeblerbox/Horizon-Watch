import { useEffect, useState, useRef } from "react"
import API_BASE from "../apiBase.js"

const TYPE_ICONS = {
    airstrike: "✦", missile: "↑", armed_clash: "✕",
    explosion: "◉", maritime: "▲", protest: "◆",
    earthquake: "⊕", fire: "◈", assassination: "◎",
    coerce: "!", fight: "✕", general: "●",
}

const TIER_COLOR = {
    critical: "#ef4444", significant: "#f97316", elevated: "#eab308", low: "#94a3b8",
}

const NotificationBar = ({ onEventClick }) => {
    const [notifications, setNotifications] = useState([])
    const [activeIndex, setActiveIndex]     = useState(0)
    const [visible, setVisible]             = useState(false)
    const intervalRef = useRef(null)
    const mountedAt   = useRef(Date.now())
    const hideTimer   = useRef(null)

    useEffect(() => {
        const fetchNotifs = async () => {
            try {
                const res  = await fetch(`${API_BASE}/api/v2/notifications?limit=10&max_age_hours=12`)
                const data = await res.json()
                setNotifications(data.notifications || [])
            } catch { /* ignore */ }
        }
        fetchNotifs()
        const iv = setInterval(fetchNotifs, 60000)
        return () => clearInterval(iv)
    }, [])

    // Listen for new events — only show bar if 30s have passed since mount
    useEffect(() => {
        const handler = (e) => {
            const { items } = e.detail || {}
            if (!items) return
            setNotifications(prev => {
                const newNotifs = items.map(item => ({
                    id:            item.thread_id || item.id,
                    icon:          TYPE_ICONS[(item.event_type || "").toLowerCase()] || "●",
                    clean_title:   item.clean_title || item.headline || "",
                    location:      item.location || "",
                    event_type:    item.event_type || "general",
                    severity_tier: item.severity_tier || "elevated",
                    published:     item.latest_event || item.published || "",
                    lat:           item.lat,
                    lon:           item.lon,
                }))
                return [...newNotifs, ...prev].slice(0, 15)
            })
            if (Date.now() - mountedAt.current >= 30000) {
                setVisible(true)
                clearTimeout(hideTimer.current)
                hideTimer.current = setTimeout(() => setVisible(false), 8000)
            }
        }
        window.addEventListener("akili:new-events", handler)
        return () => {
            window.removeEventListener("akili:new-events", handler)
            clearTimeout(hideTimer.current)
        }
    }, [])

    // Auto-rotate through notifications
    useEffect(() => {
        if (notifications.length === 0) return
        intervalRef.current = setInterval(() => {
            setActiveIndex(i => (i + 1) % Math.min(notifications.length, 5))
        }, 4000)
        return () => clearInterval(intervalRef.current)
    }, [notifications.length])

    if (notifications.length === 0) return null

    return (
        <div style={{
            position:     "fixed",
            top:          44,
            left:         48,
            right:        0,
            height:       32,
            background:   "rgba(6,13,26,0.85)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display:      "flex",
            alignItems:   "center",
            overflow:     "hidden",
            zIndex:       500,
            transform:    visible ? "translateY(0)" : "translateY(-100%)",
            opacity:      visible ? 1 : 0,
            transition:   "transform 0.3s ease, opacity 0.3s ease",
            pointerEvents: visible ? "auto" : "none",
        }}>
            {/* LIVE badge */}
            <div style={{
                padding:     "0 10px",
                borderRight: "1px solid rgba(255,255,255,0.08)",
                height:      "100%",
                display:     "flex",
                alignItems:  "center",
                gap:         4,
                flexShrink:  0,
            }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "hw-pulse 2s infinite" }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#ef4444" }}>LIVE</span>
            </div>

            {/* Scrolling notifications */}
            <div style={{ flex: 1, overflow: "hidden", height: "100%", display: "flex", alignItems: "center", position: "relative" }}>
                {notifications.slice(0, 5).map((n, i) => {
                    const isActive = i === activeIndex
                    const ageH = n.published ? (Date.now() - new Date(n.published).getTime()) / 3600000 : null
                    const age  = ageH === null ? "" : ageH < 1 ? "Just now" : `${Math.floor(ageH)}h ago`
                    const color = TIER_COLOR[n.severity_tier] || "#94a3b8"
                    return (
                        <div
                            key={n.id || i}
                            onClick={() => onEventClick && onEventClick(n)}
                            style={{
                                position:      "absolute",
                                left:          0,
                                right:         0,
                                padding:       "0 16px",
                                display:       "flex",
                                alignItems:    "center",
                                gap:           8,
                                cursor:        "pointer",
                                opacity:       isActive ? 1 : 0,
                                transition:    "opacity 0.4s ease",
                                pointerEvents: isActive ? "auto" : "none",
                            }}
                        >
                            <span style={{ fontSize: 13 }}>{n.icon || TYPE_ICONS[(n.event_type || "").toLowerCase()] || "●"}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.02em", textTransform: "uppercase", flexShrink: 0 }}>
                                {n.severity_tier?.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 12, color: "#e8edf2", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {n.clean_title}
                            </span>
                            {n.location && (
                                <span style={{ fontSize: 11, color: "#4a6080", flexShrink: 0 }}>· {n.location}</span>
                            )}
                            {age && (
                                <span style={{ fontSize: 10, color: "#3d5068", flexShrink: 0, marginLeft: "auto" }}>{age}</span>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Dot indicators */}
            <div style={{ padding: "0 12px", display: "flex", gap: 4, flexShrink: 0 }}>
                {notifications.slice(0, 5).map((_, i) => (
                    <div
                        key={i}
                        onClick={() => setActiveIndex(i)}
                        style={{
                            width:      i === activeIndex ? 12 : 4,
                            height:     4,
                            borderRadius: 2,
                            background: i === activeIndex ? "#1a6eb5" : "rgba(255,255,255,0.2)",
                            transition: "all 0.3s",
                            cursor:     "pointer",
                        }}
                    />
                ))}
            </div>
        </div>
    )
}

export default NotificationBar
