import { useState, useEffect, useRef, useCallback } from "react"

// ── Severity colours ──────────────────────────────────────────────────────────
const SEVERITY_COLOR = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "var(--akili-accent)",
}

function severityColor(item) {
    return SEVERITY_COLOR[item.severity_tier] || SEVERITY_COLOR.elevated
}

// ── Event type icons (inline SVG strings) ─────────────────────────────────────
function TypeIcon({ type, color }) {
    const s = { width: 20, height: 20, flexShrink: 0 }
    if (type === "missile_warning") return (
        <svg {...s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="10" y1="2" x2="10" y2="14"/>
            <polyline points="6,6 10,2 14,6"/>
            <line x1="8"  y1="14" x2="12" y2="14"/>
            <line x1="9"  y1="16" x2="11" y2="16"/>
        </svg>
    )
    if (type === "earthquake") return (
        <svg {...s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
            <circle cx="10" cy="10" r="2"/>
            <circle cx="10" cy="10" r="5" opacity="0.5"/>
            <circle cx="10" cy="10" r="8" opacity="0.25"/>
        </svg>
    )
    if (type === "cyclone" || type === "flood" || type === "volcano") return (
        <svg {...s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
            <path d="M10 3 L10 17 M3 10 L17 10" opacity="0.4"/>
            <polygon points="10,2 13,8 19,9 14,14 15,19 10,16 5,19 6,14 1,9 7,8"/>
        </svg>
    )
    // Generic
    return (
        <svg {...s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
            <polygon points="10,2 18,18 2,18"/>
            <line x1="10" y1="9" x2="10" y2="13"/>
            <circle cx="10" cy="15.5" r="0.6" fill={color} stroke="none"/>
        </svg>
    )
}

// ── Single Toast ──────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss, onClick, durationMs = 6000 }) {
    const [progress,    setProgress]    = useState(100)
    const [touchDelta,  setTouchDelta]  = useState(0)
    const [swiping,     setSwiping]     = useState(false)
    const startRef  = useRef(Date.now())
    const frameRef  = useRef(null)
    const touchXRef = useRef(0)

    useEffect(() => {
        const tick = () => {
            const elapsed = Date.now() - startRef.current
            const pct     = Math.max(0, 100 - (elapsed / durationMs) * 100)
            setProgress(pct)
            if (pct > 0) {
                frameRef.current = requestAnimationFrame(tick)
            } else {
                onDismiss(toast.id)
            }
        }
        frameRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frameRef.current)
    }, [])  // eslint-disable-line react-hooks/exhaustive-deps

    const handleTouchStart = useCallback((e) => {
        touchXRef.current = e.touches[0].clientX
        setSwiping(true)
    }, [])

    const handleTouchMove = useCallback((e) => {
        const delta = e.touches[0].clientX - touchXRef.current
        setTouchDelta(delta)
    }, [])

    const handleTouchEnd = useCallback(() => {
        setSwiping(false)
        if (Math.abs(touchDelta) > 80) {
            onDismiss(toast.id)
        } else {
            setTouchDelta(0)
        }
    }, [touchDelta, toast.id, onDismiss])

    const color = severityColor(toast)
    const swipeOpacity  = swiping ? Math.max(0, 1 - Math.abs(touchDelta) / 160) : 1
    const swipeTransform = touchDelta !== 0
        ? `translateX(${touchDelta}px)`
        : "none"

    return (
        <div
            onClick={() => { onDismiss(toast.id); onClick(toast) }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
                width:              "100%",
                background:         "var(--akili-panel)",
                backdropFilter:     "blur(20px) saturate(1.4)",
                WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                border:             `1px solid ${color}`,
                borderRadius:       6,
                boxShadow:          `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${color}22`,
                overflow:           "hidden",
                cursor:             "pointer",
                animation:          "akiliToastIn 0.22s ease",
                fontFamily:         "system-ui, -apple-system, sans-serif",
                transform:          swipeTransform,
                opacity:            swipeOpacity,
                transition:         swiping ? "none" : "transform 0.2s ease, opacity 0.2s ease",
                touchAction:        "pan-y",
                userSelect:         "none",
            }}
        >
            {/* Body */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 10px" }}>
                <TypeIcon type={toast.type} color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize:     12,
                        fontWeight:   600,
                        color:        "var(--akili-text-primary)",
                        lineHeight:   1.35,
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                    }}>
                        {toast.headline}
                    </div>
                    <div style={{
                        fontSize:     11,
                        color:        "var(--akili-text-secondary)",
                        marginTop:    3,
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                    }}>
                        {toast.location}
                        {toast.source ? ` · ${toast.source}` : ""}
                    </div>
                </div>
                <button
                    onClick={e => { e.stopPropagation(); onDismiss(toast.id) }}
                    style={{
                        background: "none", border: "none", color: "var(--akili-text-muted)",
                        cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
                        flexShrink: 0, alignSelf: "flex-start",
                    }}
                >×</button>
            </div>

            {/* Progress bar */}
            <div style={{ height: 2, background: "var(--akili-hover)" }}>
                <div style={{
                    height:     "100%",
                    width:      `${progress}%`,
                    background: color,
                    transition: "width 0.1s linear",
                }} />
            </div>
        </div>
    )
}

// ── Toast system container ────────────────────────────────────────────────────

export default function ToastSystem({ toasts, onDismiss, onOpen, toastDuration = 6 }) {
    const [isMobile,   setIsMobile]   = useState(() => window.innerWidth < 768)
    const [tabVisible, setTabVisible] = useState(() => document.visibilityState === "visible")

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    useEffect(() => {
        const h = () => setTabVisible(document.visibilityState === "visible")
        document.addEventListener("visibilitychange", h)
        return () => document.removeEventListener("visibilitychange", h)
    }, [])

    // Note: we used to return null here when tab was hidden, but that caused
    // unmount/remount flashes when switching tabs — toasts now render transparently.

    return (
        <>
            <style>{`
                @keyframes akiliToastIn {
                    from { opacity: 0; transform: translateY(-12px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
            <div style={isMobile ? {
                position:      "fixed",
                top:           52,
                left:          12,
                right:         12,
                zIndex:        3000,
                display:       "flex",
                flexDirection: "column",
                alignItems:    "stretch",
                gap:           8,
                pointerEvents: "none",
            } : {
                position:      "fixed",
                top:           52,
                left:          "50%",
                transform:     "translateX(-50%)",
                width:         400,
                zIndex:        3000,
                display:       "flex",
                flexDirection: "column",
                alignItems:    "center",
                gap:           8,
                pointerEvents: "none",
            }}>
                {toasts.map(t => (
                    <div key={t.id} style={{ pointerEvents: "auto", width: "100%" }}>
                        <Toast
                            toast={t}
                            onDismiss={onDismiss}
                            onClick={onOpen}
                            durationMs={toastDuration * 1000}
                        />
                    </div>
                ))}
            </div>
        </>
    )
}
