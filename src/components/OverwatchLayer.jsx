import { useState, useRef, useEffect, useCallback, Fragment, memo } from "react"
import { createPortal } from "react-dom"
import { useMap, Polygon, Rectangle, Tooltip } from "react-leaflet"
import API_BASE from "../apiBase.js"
import OverwatchSidebar, {
    catForClass, colorForClass, colorForCat,
    loadSavedScans, persistSavedScans,
} from "./OverwatchSidebar.jsx"

// ── Detection label helper ───────────────────────────────────────────────────
function detectionLabel(det) {
    const cat  = det.category || catForClass(det.class)
    const type = det.specific_type
        ? det.specific_type.charAt(0).toUpperCase() + det.specific_type.slice(1)
        : det.class
    const conf = Math.round(det.confidence * 100)
    return `${cat}: ${type} (${conf}%)`
}

// ── Overwatch icon ────────────────────────────────────────────────────────────
export function IconOverwatch({ size = 18, color = "currentColor" }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color}
            strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 9C1 9 4 3 9 3C14 3 17 9 17 9C17 9 14 15 9 15C4 15 1 9 1 9Z"/>
            <circle cx="9" cy="9" r="2.5"/>
            <line x1="9"  y1="1"  x2="9"  y2="3"/>
            <line x1="9"  y1="15" x2="9"  y2="17"/>
            <line x1="1"  y1="9"  x2="3"  y2="9"/>
            <line x1="15" y1="9"  x2="17" y2="9"/>
        </svg>
    )
}

// ── Shared glass style ────────────────────────────────────────────────────────
const GLASS = {
    background:          "rgba(6,13,26,0.96)",
    backdropFilter:      "blur(18px)",
    WebkitBackdropFilter:"blur(18px)",
    fontFamily:          "Inter,-apple-system,sans-serif",
    color:               "#e2e8f0",
}

// ── OverwatchLayer (must live inside MapContainer) ────────────────────────────
const OverwatchLayer = memo(function OverwatchLayer({
    active,
    onExit,
    sentinelImageData   = null,
    sentinel2Active     = false,
    onToggleSentinel2   = null,
}) {
    const map = useMap()

    // ── State ─────────────────────────────────────────────────────────────────
    const [mode,          setMode]          = useState("drawing")
    const [drawRect,      setDrawRect]      = useState(null)
    const [drawnBounds,   setDrawnBounds]   = useState(null)
    const [detections,    setDetections]    = useState([])
    const [stats,         setStats]         = useState(null)
    const [error,         setError]         = useState(null)
    const [minConf,       setMinConf]       = useState(0.15)
    const [enhance,       setEnhance]       = useState(false)
    const [enhanced,      setEnhanced]      = useState(false)
    const [analysis,      setAnalysis]      = useState(null)
    const [analyzing,     setAnalyzing]     = useState(false)
    const [isMobile,      setIsMobile]      = useState(() => window.innerWidth < 768)
    const [longWait,      setLongWait]      = useState(false)

    // Sidebar visibility (closing sidebar does NOT clear detections)
    const [sidebarOpen,   setSidebarOpen]   = useState(false)

    // Category filter — empty Set means "all selected"
    const [selectedCats,  setSelectedCats]  = useState(new Set())

    // Saved scans (localStorage)
    const [savedScans,    setSavedScans]    = useState(() => loadSavedScans())

    const longWaitTimerRef = useRef(null)
    const drawStartRef     = useRef(null)
    const isDrawingRef     = useRef(false)

    // ── Derived: visible detections after conf + category filter ──────────────
    const visible = detections.filter(d => {
        if (d.confidence < minConf) return false
        if (selectedCats.size > 0) {
            const cat = d.category || catForClass(d.class)
            if (!selectedCats.has(cat)) return false
        }
        return true
    })

    // ── Responsive ───────────────────────────────────────────────────────────
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    // ── Reset when active toggles ─────────────────────────────────────────────
    useEffect(() => {
        if (!active) {
            setMode("drawing")
            setDrawRect(null)
            setDrawnBounds(null)
            setDetections([])
            setStats(null)
            setError(null)
            setEnhanced(false)
            setAnalysis(null)
            setAnalyzing(false)
            setSidebarOpen(false)
            setSelectedCats(new Set())
            drawStartRef.current  = null
            isDrawingRef.current  = false
            map.dragging.enable()
        } else if (sentinelImageData) {
            setMode("analyzing")
            setDrawnBounds(sentinelImageData.bounds)
            runSentinelAnalysis(sentinelImageData)
        }
    }, [active, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // Open sidebar when results arrive
    useEffect(() => {
        if (mode === "results") setSidebarOpen(true)
    }, [mode])

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
        const nw    = map.containerPointToLatLng([
            Math.min(s.containerPt.x, endPt.x),
            Math.min(s.containerPt.y, endPt.y),
        ])
        const se    = map.containerPointToLatLng([
            Math.max(s.containerPt.x, endPt.x),
            Math.max(s.containerPt.y, endPt.y),
        ])

        drawStartRef.current = null
        const bounds = { north: nw.lat, south: se.lat, east: se.lng, west: nw.lng }
        setDrawnBounds(bounds)
        setMode("analyzing")
        runAnalysis(bounds)
    }, [clientToContainerPt, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Inference ─────────────────────────────────────────────────────────────
    const runAnalysis = useCallback(async (bounds) => {
        setError(null); setDetections([]); setStats(null)
        setEnhanced(false); setAnalysis(null); setLongWait(false)
        setSelectedCats(new Set())
        clearTimeout(longWaitTimerRef.current)
        longWaitTimerRef.current = setTimeout(() => setLongWait(true), 5000)
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/detect`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ bounds, zoom: 18, confidence: minConf, enhance }),
            })
            const data = await res.json()
            clearTimeout(longWaitTimerRef.current)
            setLongWait(false)
            if (data.error) { setError(data.error); setMode("drawing"); setDrawRect(null); return }
            const dets = data.detections || []
            setDetections(dets)
            setEnhanced(!!data.enhanced)
            const counts = {}
            for (const d of dets) counts[d.class] = (counts[d.class] || 0) + 1
            setStats({ total: data.count, displayed: dets.length, counts, zoom: data.zoom_used, model: data.model })
            setMode("results")
        } catch (err) {
            clearTimeout(longWaitTimerRef.current)
            setLongWait(false)
            setError(`Request failed: ${err.message}`)
            setMode("drawing"); setDrawRect(null)
        }
    }, [minConf, enhance])

    const runSentinelAnalysis = useCallback(async (imgData) => {
        setError(null); setDetections([]); setStats(null)
        setEnhanced(false); setAnalysis(null); setLongWait(false)
        setSelectedCats(new Set())
        clearTimeout(longWaitTimerRef.current)
        longWaitTimerRef.current = setTimeout(() => setLongWait(true), 5000)
        const b64 = imgData.src.includes(",") ? imgData.src.split(",")[1] : imgData.src
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/detect-image`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ image: b64, bounds: imgData.bounds, confidence: minConf, enhance }),
            })
            const data = await res.json()
            clearTimeout(longWaitTimerRef.current)
            setLongWait(false)
            if (data.error) { setError(data.error); setMode("drawing"); return }
            const dets = data.detections || []
            setDetections(dets)
            setEnhanced(!!data.enhanced)
            const counts = {}
            for (const d of dets) counts[d.class] = (counts[d.class] || 0) + 1
            setStats({ total: data.count, displayed: dets.length, counts, zoom: "Sentinel-2", model: data.model })
            setMode("results")
        } catch (err) {
            clearTimeout(longWaitTimerRef.current)
            setLongWait(false)
            setError(`Request failed: ${err.message}`)
            setMode("drawing")
        }
    }, [minConf, enhance])

    const clearAnalysis = useCallback(() => {
        setDetections([]); setStats(null); setError(null)
        setAnalysis(null); setAnalyzing(false)
        setDrawRect(null); setDrawnBounds(null)
        setSidebarOpen(false); setSelectedCats(new Set())
        setMode("drawing")
    }, [])

    const runIntelligenceAnalysis = useCallback(async () => {
        if (!detections.length || !drawnBounds) return
        setAnalyzing(true)
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/analyze`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ detections, bounds: drawnBounds }),
            })
            const data = await res.json()
            if (data.error) setError(data.error)
            else setAnalysis(data)
        } catch (err) {
            setError(`Analysis failed: ${err.message}`)
        } finally {
            setAnalyzing(false)
        }
    }, [detections, drawnBounds])

    const reanalyze = useCallback(() => {
        if (!drawnBounds) return
        setMode("analyzing")
        if (sentinelImageData) runSentinelAnalysis(sentinelImageData)
        else                   runAnalysis(drawnBounds)
    }, [drawnBounds, sentinelImageData, runAnalysis, runSentinelAnalysis])

    // ── Category filter handlers ───────────────────────────────────────────────
    const toggleCat = useCallback((cat) => {
        setSelectedCats(prev => {
            const next = new Set(prev)
            if (next.has(cat)) next.delete(cat)
            else               next.add(cat)
            return next
        })
    }, [])

    const clearCatFilter = useCallback(() => setSelectedCats(new Set()), [])

    // ── Save / restore / delete ───────────────────────────────────────────────
    const handleSave = useCallback(() => {
        if (!detections.length) return
        const scan = {
            id:          crypto.randomUUID(),
            timestamp:   new Date().toISOString(),
            detections,
            stats,
            drawnBounds,
            enhanced,
        }
        setSavedScans(prev => {
            const updated = [scan, ...prev].slice(0, 20)
            persistSavedScans(updated)
            return updated
        })
    }, [detections, stats, drawnBounds, enhanced])

    const handleDeleteSaved = useCallback((id) => {
        setSavedScans(prev => {
            const updated = prev.filter(s => s.id !== id)
            persistSavedScans(updated)
            return updated
        })
    }, [])

    const handleRestoreSaved = useCallback((scan) => {
        setDetections(scan.detections || [])
        setStats(scan.stats || null)
        setDrawnBounds(scan.drawnBounds || null)
        setEnhanced(!!scan.enhanced)
        setAnalysis(null)
        setSelectedCats(new Set())
        setMode("results")
        setSidebarOpen(true)
    }, [])

    // ── Portals ───────────────────────────────────────────────────────────────

    // Drawing capture overlay
    const overlayEl = (mode === "drawing" || mode === "analyzing") && createPortal(
        <div
            style={{
                position: "absolute", inset: 0, zIndex: 1200,
                cursor: mode === "analyzing" ? "wait" : "crosshair",
                touchAction: "none", userSelect: "none",
            }}
            onMouseDown={mode  === "drawing" ? handlePointerDown : undefined}
            onMouseMove={mode  === "drawing" ? handlePointerMove : undefined}
            onMouseUp={mode    === "drawing" ? handlePointerUp   : undefined}
            onTouchStart={mode === "drawing" ? handlePointerDown : undefined}
            onTouchMove={mode  === "drawing" ? handlePointerMove : undefined}
            onTouchEnd={mode   === "drawing" ? handlePointerUp   : undefined}
        >
            {drawRect && drawRect.w > 4 && drawRect.h > 4 && (
                <div style={{
                    position: "fixed",
                    left: drawRect.x, top: drawRect.y,
                    width: drawRect.w, height: drawRect.h,
                    border: "2px dashed #38bdf8",
                    background: "rgba(56,189,248,0.07)",
                    pointerEvents: "none", boxSizing: "border-box",
                }} />
            )}
        </div>,
        map.getContainer()
    )

    // "Draw a rectangle" instruction hint
    const instructionsEl = mode === "drawing" && createPortal(
        <div style={{
            position: "fixed",
            bottom:   isMobile ? 72 : 24,
            left:     "50%",
            transform:"translateX(-50%)",
            zIndex:   1900,
            pointerEvents: "none",
            ...GLASS,
            border:       "1px solid rgba(56,189,248,0.3)",
            borderRadius: 24,
            padding:      "9px 18px",
            fontSize:     12,
            display:      "flex", alignItems: "center", gap: 8,
            whiteSpace:   "nowrap",
            boxShadow:    "0 4px 20px rgba(0,0,0,0.5)",
        }}>
            <IconOverwatch size={13} color="#38bdf8" />
            <span>Draw a rectangle to analyze</span>
            <button
                onClick={() => setEnhance(v => !v)}
                style={{
                    pointerEvents: "auto", marginLeft: 4,
                    background: enhance ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${enhance ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.1)"}`,
                    color: enhance ? "#a78bfa" : "rgba(232,237,242,0.4)",
                    cursor: "pointer", borderRadius: 10, fontSize: 9,
                    fontWeight: 600, padding: "2px 7px", lineHeight: 1.4,
                    letterSpacing: "0.04em",
                }}
            >AI {enhance ? "ON" : "OFF"}</button>
            <button
                onClick={onExit}
                style={{
                    pointerEvents: "auto", marginLeft: 2,
                    background: "none", border: "none",
                    color: "rgba(232,237,242,0.4)", cursor: "pointer",
                    fontSize: 15, lineHeight: 1, padding: 0,
                }}
            >✕</button>
        </div>,
        document.body
    )

    // Analyzing spinner
    const spinnerEl = mode === "analyzing" && createPortal(
        <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 2200,
            ...GLASS,
            border: "1px solid rgba(56,189,248,0.25)",
            borderRadius: 12,
            padding: "20px 28px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
            <div style={{
                width: 34, height: 34,
                border: "3px solid rgba(56,189,248,0.15)",
                borderTop: "3px solid #38bdf8",
                borderRadius: "50%",
                animation: "ow-spin 0.8s linear infinite",
            }} />
            <div style={{ fontSize: 12, fontWeight: 600 }}>
                {longWait ? "Analyzing large area…" : "Overwatch analyzing…"}
            </div>
            <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textAlign: "center" }}>
                {longWait
                    ? "Tiled inference running · large areas may take several minutes"
                    : enhance ? "Fetching tiles · AI Classification" : "Fetching tiles · Object Detection"
                }
            </div>
        </div>,
        document.body
    )

    // "Reopen sidebar" floating pill when results exist but sidebar is closed
    const reopenEl = mode === "results" && !sidebarOpen && stats && createPortal(
        <button
            onClick={() => setSidebarOpen(true)}
            style={{
                position: "fixed",
                bottom: isMobile ? 72 : 24,
                right:  24,
                zIndex: 1900,
                ...GLASS,
                border:       "1px solid rgba(56,189,248,0.35)",
                borderRadius: 24,
                padding:      "9px 16px",
                cursor:       "pointer",
                display:      "flex", alignItems: "center", gap: 8,
                fontSize:     11, fontWeight: 600, color: "#38bdf8",
                boxShadow:    "0 4px 20px rgba(0,0,0,0.5)",
            }}
        >
            <IconOverwatch size={13} color="#38bdf8" />
            {stats.total} detected
        </button>,
        document.body
    )

    // Error toast
    const errorEl = error && createPortal(
        <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
            zIndex: 2100,
            maxWidth: "min(400px, calc(100vw - 32px))",
            ...GLASS,
            border:     "1px solid rgba(239,68,68,0.35)",
            borderLeft: "3px solid #ef4444",
            borderRadius: 7,
            padding:    "10px 14px",
            display:    "flex", alignItems: "flex-start", gap: 10,
            boxShadow:  "0 4px 20px rgba(0,0,0,0.5)",
        }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0, marginTop: 3, boxShadow: "0 0 6px #ef444488" }} />
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>
                    Overwatch Error
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4 }}>{error}</div>
            </div>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(232,237,242,0.35)", fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0, marginLeft: 4 }}>✕</button>
        </div>,
        document.body
    )

    // OverwatchSidebar portal
    const sidebarEl = mode === "results" && createPortal(
        <OverwatchSidebar
            isMobile={isMobile}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            stats={stats}
            detections={detections}
            visible={visible}
            minConf={minConf}
            onMinConfChange={setMinConf}
            enhance={enhance}
            onEnhanceToggle={() => setEnhance(v => !v)}
            enhanced={enhanced}
            analysis={analysis}
            analyzing={analyzing}
            onAnalyze={runIntelligenceAnalysis}
            onDismissAnalysis={() => setAnalysis(null)}
            onClear={clearAnalysis}
            onRescan={reanalyze}
            sentinel2Active={sentinel2Active}
            onToggleSentinel2={onToggleSentinel2}
            sentinelCapturedAt={sentinelImageData?.capturedAt ?? null}
            selectedCats={selectedCats}
            onToggleCat={toggleCat}
            onClearCatFilter={clearCatFilter}
            savedScans={savedScans}
            onSave={handleSave}
            onDeleteSaved={handleDeleteSaved}
            onRestoreSaved={handleRestoreSaved}
        />,
        document.body
    )

    // ── React-Leaflet render ──────────────────────────────────────────────────
    if (!active) return null

    return (
        <Fragment>
            {drawnBounds && (
                <Rectangle
                    bounds={[[drawnBounds.south, drawnBounds.west], [drawnBounds.north, drawnBounds.east]]}
                    pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "6 4", fill: true, fillColor: "#38bdf8", fillOpacity: 0.04, opacity: 0.6 }}
                />
            )}

            {visible.map((det, i) => {
                const color = colorForClass(det.class)
                return (
                    <Polygon key={i} positions={det.corners}
                        pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.13, opacity: 0.9 }}
                    >
                        <Tooltip sticky direction="top" className="ow-det-label" offset={[0, -4]}>
                            {detectionLabel(det)}
                        </Tooltip>
                    </Polygon>
                )
            })}

            {overlayEl}
            {instructionsEl}
            {spinnerEl}
            {reopenEl}
            {sidebarEl}
            {errorEl}
        </Fragment>
    )
})

export default OverwatchLayer
