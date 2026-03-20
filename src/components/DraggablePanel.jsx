import { useEffect, useRef, useState } from "react"

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

export default function DraggablePanel({
    title,
    children,
    defaultPosition = { x: 20, y: 120 },
    width = 340,
    height,
    onClose,
}) {
    const panelRef = useRef(null)
    const dragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 })
    const [pos, setPos] = useState({ x: defaultPosition.x ?? 20, y: defaultPosition.y ?? 120 })

    const clampToViewport = (x, y) => {
        const panelW = panelRef.current?.offsetWidth || width || 340
        const panelH = panelRef.current?.offsetHeight || (typeof height === "number" ? height : 420)
        const maxX = Math.max(0, window.innerWidth - panelW)
        const maxY = Math.max(0, window.innerHeight - panelH)
        return {
            x: clamp(x, 0, maxX),
            y: clamp(y, 0, maxY),
        }
    }

    useEffect(() => {
        const onMove = (e) => {
            if (!dragRef.current.dragging) return
            const nextX = e.clientX - dragRef.current.offsetX
            const nextY = e.clientY - dragRef.current.offsetY
            setPos(clampToViewport(nextX, nextY))
        }
        const onUp = () => {
            dragRef.current.dragging = false
        }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
        return () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
        }
    }, [width, height])

    useEffect(() => {
        const onResize = () => setPos((p) => clampToViewport(p.x, p.y))
        window.addEventListener("resize", onResize)
        onResize()
        return () => window.removeEventListener("resize", onResize)
    }, [width, height])

    const onHeaderPointerDown = (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const rect = panelRef.current?.getBoundingClientRect()
        if (!rect) return
        dragRef.current.dragging = true
        dragRef.current.offsetX = e.clientX - rect.left
        dragRef.current.offsetY = e.clientY - rect.top
    }

    return (
        <div
            ref={panelRef}
            style={{
                position: "fixed",
                left: pos.x,
                top: pos.y,
                width,
                height,
                maxHeight: "calc(100vh - 120px)",
                background: "rgba(255,255,255,0.95)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                zIndex: 2100,
            }}
        >
            <div
                onPointerDown={onHeaderPointerDown}
                style={{
                    padding: "11px 16px",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexShrink: 0,
                    cursor: "grab",
                    userSelect: "none",
                }}
            >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#999" }}>
                    {title}
                </span>
                {onClose && (
                    <button
                        onClick={onClose}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#aaa", lineHeight: 1, padding: "0 2px" }}
                    >
                        ✕
                    </button>
                )}
            </div>
            <div style={{ flex: 1, overflow: "auto", maxHeight: "calc(100vh - 170px)" }}>
                {children}
            </div>
        </div>
    )
}
