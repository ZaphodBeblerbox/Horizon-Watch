import { useState, useRef } from "react"

// Reusable mobile bottom sheet — slides up from above BottomNav (56px).
// Swipe down to dismiss. Tap backdrop to close.

export default function BottomSheet({
    isOpen,
    onClose,
    children,
    title,
    height = "auto",   // 'auto' | 'half' | 'compact' | 'full' | number (px)
    showHandle = true,
}) {
    const [dragY, setDragY] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const startYRef = useRef(0)

    function maxHeight() {
        if (height === "full")    return "calc(100vh - 96px)"   // TopBar(40) + BottomNav(56)
        if (height === "half")    return "50vh"
        if (height === "compact") return "42vh"
        if (typeof height === "number") return `${height}px`
        return "70vh"   // auto
    }

    function handleTouchStart(e) {
        startYRef.current = e.touches[0].clientY
        setIsDragging(true)
    }

    function handleTouchMove(e) {
        const diff = e.touches[0].clientY - startYRef.current
        if (diff > 0) setDragY(diff)
    }

    function handleTouchEnd() {
        setIsDragging(false)
        if (dragY > 100) onClose()
        else setDragY(0)
    }

    if (!isOpen) return null

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position:   "fixed",
                    inset:      0,
                    background: "rgba(0,0,0,0.5)",
                    zIndex:     1450,
                    opacity:    Math.max(0, 1 - dragY / 300),
                    transition: isDragging ? "none" : "opacity 0.3s",
                }}
            />

            {/* Sheet */}
            <div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                    position:         "fixed",
                    left:             0,
                    right:            0,
                    bottom:           56,   // above BottomNav
                    maxHeight:        maxHeight(),
                    background:       "rgb(6, 13, 26)",
                    borderRadius:     "18px 18px 0 0",
                    borderTop:        "1px solid rgba(255,255,255,0.12)",
                    borderLeft:       "1px solid rgba(255,255,255,0.06)",
                    borderRight:      "1px solid rgba(255,255,255,0.06)",
                    zIndex:           1451,
                    display:          "flex",
                    flexDirection:    "column",
                    transform:        `translateY(${dragY}px)`,
                    transition:       isDragging ? "none" : "transform 0.3s ease-out",
                    fontFamily:       "var(--font-sans)",
                }}
            >
                {/* Drag handle */}
                {showHandle && (
                    <div style={{ padding: "10px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
                        <div style={{
                            width:        36,
                            height:       4,
                            borderRadius: 2,
                            background:   "rgba(148,163,184,0.35)",
                        }} />
                    </div>
                )}

                {/* Header */}
                {title && (
                    <div style={{
                        display:        "flex",
                        justifyContent: "space-between",
                        alignItems:     "center",
                        padding:        showHandle ? "0 16px 10px" : "14px 16px 10px",
                        borderBottom:   "1px solid rgba(255,255,255,0.07)",
                        flexShrink:     0,
                    }}>
                        <span style={{
                            fontSize:      11,
                            fontWeight:    700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color:         "rgba(232,237,242,0.7)",
                        }}>
                            {title}
                        </span>
                        <button
                            onClick={onClose}
                            style={{
                                background: "none",
                                border:     "none",
                                color:      "rgba(232,237,242,0.4)",
                                fontSize:   20,
                                cursor:     "pointer",
                                lineHeight: 1,
                                padding:    "0 4px",
                                minHeight:  44,
                                minWidth:   44,
                                display:    "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >×</button>
                    </div>
                )}

                {/* Scrollable content */}
                <div style={{
                    flex:                    1,
                    overflowY:               "auto",
                    overflowX:               "hidden",
                    WebkitOverflowScrolling: "touch",
                    paddingBottom:           "env(safe-area-inset-bottom, 8px)",
                }}>
                    {children}
                </div>
            </div>
        </>
    )
}
