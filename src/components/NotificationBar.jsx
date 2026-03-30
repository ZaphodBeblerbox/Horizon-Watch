import { useEffect, useState, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"

const TIER_COLOR = {
    critical: "#ef4444", significant: "#f97316", elevated: "#eab308", low: "#94a3b8",
}

// Single toast card — slides in from top-right, auto-dismisses after 6 s
function Toast({ toast, onDismiss, onClick, isMobile }) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const t1 = requestAnimationFrame(() => setVisible(true))
        const t2 = setTimeout(() => {
            setVisible(false)
            setTimeout(onDismiss, 320)
        }, 6000)
        return () => { cancelAnimationFrame(t1); clearTimeout(t2) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const color   = TIER_COLOR[toast.severity_tier] || "#94a3b8"
    const ageH    = toast.published ? (Date.now() - new Date(toast.published).getTime()) / 3600000 : null
    const age     = ageH === null ? "" : ageH < 1 ? "Just now" : `${Math.floor(ageH)}h ago`
    const typeStr = (toast.event_type || "").replace(/_/g, " ")

    return (
        <div
            onClick={onClick}
            style={{
                width:        isMobile ? "100%" : 320,
                background:   "rgba(6,13,26,0.95)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border:       `1px solid ${color}44`,
                borderLeft:   `3px solid ${color}`,
                borderRadius: 6,
                padding:      "10px 12px",
                cursor:       "pointer",
                pointerEvents: "auto",
                transform:    visible ? "translateY(0)" : "translateY(-20px)",
                opacity:      visible ? 1 : 0,
                transition:   "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease",
                boxShadow:    `0 4px 20px rgba(0,0,0,0.5), 0 0 12px ${color}18`,
                fontFamily:   "Inter, -apple-system, sans-serif",
                userSelect:   "none",
            }}
        >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{
                    width: 8, height: 8, borderRadius: "50%", background: color,
                    marginTop: 4, flexShrink: 0, boxShadow: `0 0 6px ${color}88`,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color, textTransform: "uppercase" }}>
                            {toast.severity_tier}
                        </span>
                        {typeStr && (
                            <span style={{ fontSize: 9, color: "#4a6080", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                {typeStr}
                            </span>
                        )}
                        {age && (
                            <span style={{ fontSize: 9, color: "#3d5068", marginLeft: "auto" }}>{age}</span>
                        )}
                    </div>
                    <div style={{
                        fontSize: 12, color: "#e8edf2", fontWeight: 600, lineHeight: 1.35,
                        marginBottom: toast.location ? 3 : 0,
                        overflow: "hidden", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                        {toast.clean_title}
                    </div>
                    {toast.location && (
                        <div style={{ fontSize: 10, color: "#4a6080" }}>{toast.location}</div>
                    )}
                </div>
                <button
                    onClick={e => { e.stopPropagation(); setVisible(false); setTimeout(onDismiss, 320) }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#3d5068", fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0, marginTop: -2 }}
                >×</button>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────────
// NotificationBar — ONE toast visible at a time, remainder queued
// ──────────────────────────────────────────────────────────────────────────────

const notifEnabled = () => localStorage.getItem("hw-notifications-enabled") !== "false"

export default function NotificationBar({ onEventClick }) {
    const [current, setCurrent] = useState(null)   // active toast
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    const queue     = useRef([])                    // pending toasts
    const seenIds   = useRef(new Set())
    const mountedAt = useRef(Date.now())

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    // Advance queue: show next if nothing visible
    const advance = useCallback(() => {
        setCurrent(prev => {
            if (prev) return prev   // still showing, don't replace
            const next = queue.current.shift()
            return next || null
        })
    }, [])

    const enqueue = useCallback((notif) => {
        if (seenIds.current.has(notif.id)) return
        seenIds.current.add(notif.id)
        queue.current.push({ ...notif, toastKey: Date.now() + Math.random() })
        advance()
    }, [advance])

    const dismiss = useCallback(() => {
        setCurrent(null)
        setTimeout(advance, 50)   // slight delay so state settles
    }, [advance])

    // Poll /api/v2/notifications every 45 s
    useEffect(() => {
        const fetchAndCheck = async () => {
            try {
                const res  = await fetch(`${API_BASE}/api/v2/notifications?limit=10&max_age_hours=6`)
                const data = await res.json()
                const notifs = data.notifications || []
                // Seed on first fetch (within 30 s of mount) — no toasts on page load
                if (Date.now() - mountedAt.current < 30000) {
                    notifs.forEach(n => seenIds.current.add(n.id))
                    return
                }
                if (!notifEnabled()) return
                for (const n of notifs) enqueue(n)
            } catch { /* ignore */ }
        }
        fetchAndCheck()
        const iv = setInterval(fetchAndCheck, 45000)
        return () => clearInterval(iv)
    }, [enqueue])

    // Listen for real-time akili:new-events push
    useEffect(() => {
        const handler = (e) => {
            const { items } = e.detail || {}
            if (!items || Date.now() - mountedAt.current < 30000) return
            if (!notifEnabled()) return
            for (const item of items) {
                const id = item.thread_id || item.id
                if (!id) continue
                enqueue({
                    id,
                    clean_title:   item.clean_title || item.headline || "",
                    location:      item.location || "",
                    event_type:    item.event_type || "general",
                    severity_tier: item.severity_tier || "elevated",
                    published:     item.latest_event || item.published || "",
                    lat:           item.lat,
                    lon:           item.lon,
                    source_name:   item.source_name || "",
                    body:          item.body || item.summary || "",
                })
            }
        }
        window.addEventListener("akili:new-events", handler)
        return () => window.removeEventListener("akili:new-events", handler)
    }, [enqueue])

    if (!current) return null

    return (
        <div style={isMobile ? {
            position:      "fixed",
            top:           50,
            left:          8,
            right:         8,
            zIndex:        2000,
            pointerEvents: "none",
        } : {
            position:      "fixed",
            top:           60,
            left:          "50%",
            transform:     "translateX(-50%)",
            zIndex:        2000,
            pointerEvents: "none",
        }}>
            <Toast
                key={current.toastKey}
                toast={current}
                onDismiss={dismiss}
                isMobile={isMobile}
                onClick={() => {
                    onEventClick?.(current)
                    dismiss()
                }}
            />
        </div>
    )
}
