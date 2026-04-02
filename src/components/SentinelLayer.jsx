import { useState, useRef, useEffect, useCallback, memo } from "react"
import { createPortal } from "react-dom"
import { useMap, ImageOverlay, Rectangle, Pane } from "react-leaflet"
import API_BASE from "../apiBase.js"

const GLASS = {
    background:           "rgba(6,13,26,0.96)",
    backdropFilter:       "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    fontFamily:           "Inter,-apple-system,sans-serif",
    color:                "#e2e8f0",
}

// ── SentinelLayer (inside MapContainer) ──────────────────────────────────────
const SentinelLayer = memo(function SentinelLayer({ active, onToggleOff, hideOverlay = false, onImageLoaded, onImageCleared }) {
    const map = useMap()

    // mode: "idle" | "drawing" | "ready" | "loading" | "loaded"
    const [mode,         setMode]         = useState("idle")
    const [drawRect,     setDrawRect]     = useState(null)   // viewport px {x,y,w,h}
    const [drawnBounds,  setDrawnBounds]  = useState(null)   // geo {north,south,east,west}
    const [maxCloud,     setMaxCloud]     = useState(20)
    const [error,        setError]        = useState(null)
    const [imageData,    setImageData]    = useState(null)   // { src, bounds, cloudMax, daysBack }
    const [isMobile,     setIsMobile]     = useState(() => window.innerWidth < 768)

    const drawStartRef  = useRef(null)
    const isDrawingRef  = useRef(false)

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    // Reset everything when toggled off
    useEffect(() => {
        if (!active) {
            setMode("idle")
            setDrawRect(null)
            setDrawnBounds(null)
            setError(null)
            setImageData(null)
            onImageCleared?.()
            drawStartRef.current = null
            isDrawingRef.current = false
            map.dragging.enable()
        } else {
            setMode("drawing")
        }
    }, [active, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Pointer helpers ───────────────────────────────────────────────────────
    const clientToContainerPt = useCallback((clientX, clientY) => {
        const r = map.getContainer().getBoundingClientRect()
        return { x: clientX - r.left, y: clientY - r.top }
    }, [map])

    const handlePointerDown = useCallback((e) => {
        if (mode !== "drawing") return
        e.preventDefault()
        const clientX = e.touches ? e.touches[0].clientX : e.clientX
        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        drawStartRef.current = { clientX, clientY, containerPt: clientToContainerPt(clientX, clientY) }
        isDrawingRef.current = true
        setDrawRect({ x: clientX, y: clientY, w: 0, h: 0 })
        map.dragging.disable()
        map.touchZoom?.disable()
        map.scrollWheelZoom?.disable()
    }, [mode, clientToContainerPt, map])

    const handlePointerMove = useCallback((e) => {
        if (!isDrawingRef.current) return
        e.preventDefault()
        const clientX = e.touches ? e.touches[0].clientX : e.clientX
        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        const s = drawStartRef.current
        if (!s) return
        setDrawRect({
            x: Math.min(s.clientX, clientX),
            y: Math.min(s.clientY, clientY),
            w: Math.abs(clientX - s.clientX),
            h: Math.abs(clientY - s.clientY),
        })
    }, [])

    const handlePointerUp = useCallback((e) => {
        if (!isDrawingRef.current) return
        e.preventDefault()
        isDrawingRef.current = false
        map.dragging.enable()
        map.touchZoom?.enable()
        map.scrollWheelZoom?.enable()

        const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX
        const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY
        const s = drawStartRef.current
        if (!s) return

        if (Math.abs(clientX - s.clientX) < 30 || Math.abs(clientY - s.clientY) < 30) {
            drawStartRef.current = null
            setDrawRect(null)
            return
        }

        const endPt = clientToContainerPt(clientX, clientY)
        const nw = map.containerPointToLatLng([
            Math.min(s.containerPt.x, endPt.x),
            Math.min(s.containerPt.y, endPt.y),
        ])
        const se = map.containerPointToLatLng([
            Math.max(s.containerPt.x, endPt.x),
            Math.max(s.containerPt.y, endPt.y),
        ])

        drawStartRef.current = null
        setDrawnBounds({ north: nw.lat, south: se.lat, east: se.lng, west: nw.lng })
        setMode("ready")
    }, [clientToContainerPt, map])

    // ── Attach/detach pointer listeners ──────────────────────────────────────
    useEffect(() => {
        if (!active) return
        const container = map.getContainer()
        container.addEventListener("mousedown",  handlePointerDown,  { passive: false })
        container.addEventListener("mousemove",  handlePointerMove,  { passive: false })
        container.addEventListener("mouseup",    handlePointerUp,    { passive: false })
        container.addEventListener("touchstart", handlePointerDown,  { passive: false })
        container.addEventListener("touchmove",  handlePointerMove,  { passive: false })
        container.addEventListener("touchend",   handlePointerUp,    { passive: false })
        return () => {
            container.removeEventListener("mousedown",  handlePointerDown)
            container.removeEventListener("mousemove",  handlePointerMove)
            container.removeEventListener("mouseup",    handlePointerUp)
            container.removeEventListener("touchstart", handlePointerDown)
            container.removeEventListener("touchmove",  handlePointerMove)
            container.removeEventListener("touchend",   handlePointerUp)
        }
    }, [active, map, handlePointerDown, handlePointerMove, handlePointerUp])

    // ── Fetch imagery ─────────────────────────────────────────────────────────
    const loadImagery = useCallback(async () => {
        if (!drawnBounds) return
        setMode("loading")
        setError(null)
        try {
            const res = await fetch(`${API_BASE}/api/sentinel/imagery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bounds: drawnBounds, max_cloud: maxCloud, days_back: 90 }),
            })
            const data = await res.json()
            if (data.error) {
                setError(data.error + (data.detail ? ` — ${data.detail}` : ""))
                setMode("ready")
                return
            }
            const imgData = {
                src:         `data:image/png;base64,${data.image}`,
                bounds:      drawnBounds,
                cloudMax:    maxCloud,
                daysBack:    90,
                capturedAt:  new Date().toISOString(),
            }
            setImageData(imgData)
            onImageLoaded?.(imgData)
            setMode("loaded")
        } catch (err) {
            setError(`Request failed: ${err.message}`)
            setMode("ready")
        }
    }, [drawnBounds, maxCloud])

    const clearImagery = useCallback(() => {
        setImageData(null)
        setDrawnBounds(null)
        setDrawRect(null)
        setError(null)
        setMode("drawing")
        onImageCleared?.()
    }, [onImageCleared])

    const redraw = useCallback(() => {
        setImageData(null)
        setDrawnBounds(null)
        setDrawRect(null)
        setError(null)
        setMode("drawing")
        onImageCleared?.()
    }, [onImageCleared])

    // ── Apply crosshair cursor directly to map container during draw ─────────
    useEffect(() => {
        if (!active) return
        const container = map.getContainer()
        if (mode === "drawing") {
            container.style.cursor = "crosshair"
        } else {
            container.style.cursor = ""
        }
        return () => { container.style.cursor = "" }
    }, [active, mode, map])

    if (!active) return null

    // ── Draw overlay — pointer-events: none so events reach the map ──────────
    const drawOverlayEl = (mode === "drawing") && createPortal(
        <div
            style={{
                position: "fixed", inset: 0,
                zIndex: 2000,
                pointerEvents: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}
        >
            {drawRect && drawRect.w > 4 && drawRect.h > 4 && (
                <div style={{
                    position: "absolute",
                    left: drawRect.x, top: drawRect.y,
                    width: drawRect.w, height: drawRect.h,
                    border: "2px solid #22d3ee",
                    background: "rgba(34,211,238,0.06)",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                }} />
            )}
        </div>,
        document.body
    )

    // ── Control panel (ready / loading / loaded) ──────────────────────────────
    const panelEl = (mode === "ready" || mode === "loading" || mode === "loaded") && createPortal(
        <div style={{
            position: "fixed",
            ...(isMobile
                ? { bottom: 64, left: 8, right: 8 }
                : { top: 64, right: 8, width: 240 }),
            zIndex: 2100,
            ...GLASS,
            border: "1px solid rgba(34,211,238,0.25)",
            borderRadius: 10,
            padding: "14px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <svg width={13} height={13} viewBox="0 0 18 18" fill="none" stroke="#22d3ee" strokeWidth="1.4" strokeLinecap="round">
                        <circle cx="9" cy="9" r="7"/>
                        <path d="M5 9h8M9 5v8"/>
                        <path d="M3 6l3 3-3 3M15 6l-3 3 3 3" opacity="0.5"/>
                    </svg>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#22d3ee" }}>
                        Sentinel-2
                    </span>
                </div>
                <button onClick={onToggleOff} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(232,237,242,0.35)", fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
            </div>

            {/* Cloud cover slider */}
            {mode !== "loading" && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 10, color: "rgba(232,237,242,0.5)" }}>Max cloud cover</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#22d3ee" }}>{maxCloud}%</span>
                    </div>
                    <input
                        type="range" min={0} max={100} step={5} value={maxCloud}
                        onChange={e => setMaxCloud(Number(e.target.value))}
                        style={{ width: "100%", cursor: "pointer", accentColor: "#22d3ee" }}
                    />
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{ fontSize: 10, color: "#f87171", marginBottom: 8, lineHeight: 1.4, wordBreak: "break-word" }}>
                    {error}
                </div>
            )}

            {/* Metadata when loaded */}
            {mode === "loaded" && imageData && (
                <div style={{ fontSize: 9, color: "rgba(232,237,242,0.35)", marginBottom: 10, lineHeight: 1.5 }}>
                    Sentinel-2 L2A · ≤{imageData.cloudMax}% cloud · Last {imageData.daysBack} days
                </div>
            )}

            {/* Loading spinner */}
            {mode === "loading" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{
                        width: 20, height: 20, flexShrink: 0,
                        border: "2px solid rgba(34,211,238,0.15)",
                        borderTop: "2px solid #22d3ee",
                        borderRadius: "50%",
                        animation: "ow-spin 0.8s linear infinite",
                    }} />
                    <span style={{ fontSize: 11 }}>Fetching Sentinel-2 imagery…</span>
                </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 6 }}>
                {mode === "ready" && (
                    <>
                        <button onClick={loadImagery} style={{
                            flex: 1, padding: "7px 0", borderRadius: 5, border: "none",
                            background: "#22d3ee", color: "#0c1a24", fontSize: 11, fontWeight: 700,
                            cursor: "pointer",
                        }}>Load Imagery</button>
                        <button onClick={redraw} style={{
                            padding: "7px 10px", borderRadius: 5,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "transparent", color: "rgba(232,237,242,0.6)",
                            fontSize: 11, cursor: "pointer",
                        }}>Redraw</button>
                    </>
                )}
                {mode === "loaded" && (
                    <>
                        <button onClick={redraw} style={{
                            flex: 1, padding: "7px 0", borderRadius: 5,
                            border: "1px solid rgba(34,211,238,0.3)",
                            background: "transparent", color: "#22d3ee",
                            fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}>New Region</button>
                        <button onClick={clearImagery} style={{
                            flex: 1, padding: "7px 0", borderRadius: 5,
                            border: "1px solid rgba(255,255,255,0.1)",
                            background: "transparent", color: "rgba(232,237,242,0.5)",
                            fontSize: 11, cursor: "pointer",
                        }}>Clear</button>
                    </>
                )}
            </div>
        </div>,
        document.body
    )

    // ── Leaflet image overlay — in a pane below overlayPane (400) so detection
    //    polygons from Overwatch always render on top
    const imageOverlayEl = imageData && !hideOverlay && (
        <Pane name="sentinelImagePane" style={{ zIndex: 350 }}>
            <ImageOverlay
                url={imageData.src}
                bounds={[[imageData.bounds.south, imageData.bounds.west], [imageData.bounds.north, imageData.bounds.east]]}
                opacity={0.95}
            />
        </Pane>
    )

    // ── Drawn-region rectangle on map ─────────────────────────────────────────
    const rectEl = drawnBounds && mode !== "loaded" && (
        <Rectangle
            bounds={[[drawnBounds.south, drawnBounds.west], [drawnBounds.north, drawnBounds.east]]}
            pathOptions={{ color: "#22d3ee", weight: 2, fill: false, dashArray: "4 3" }}
        />
    )

    return (
        <>
            {drawOverlayEl}
            {panelEl}
            {imageOverlayEl}
            {rectEl}
        </>
    )
})

export default SentinelLayer
