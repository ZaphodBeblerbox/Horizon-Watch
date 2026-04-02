import { useState, useRef, useEffect, useCallback, Fragment, memo } from "react"
import { createPortal } from "react-dom"
import { useMap, useMapEvents, Polygon, Polyline, CircleMarker, Tooltip, ImageOverlay } from "react-leaflet"
import API_BASE from "../apiBase.js"
import OverwatchSidebar, {
    IconOverwatch,
    catForClass, colorForClass,
    loadSavedScans, persistSavedScans,
    loadSavedImages, persistSavedImages,
} from "./OverwatchSidebar.jsx"

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectionLabel(det) {
    const cat  = det.category || catForClass(det.class)
    const type = det.specific_type
        ? det.specific_type.charAt(0).toUpperCase() + det.specific_type.slice(1)
        : det.class
    return `${cat}: ${type} (${Math.round(det.confidence * 100)}%)`
}

function polyBounds(verts) {
    const lats = verts.map(v => v[0])
    const lons = verts.map(v => v[1])
    return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) }
}

const GLASS = {
    background:           "rgba(7,14,28,0.9)",
    backdropFilter:       "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    fontFamily:           "Inter,-apple-system,sans-serif",
    color:                "rgba(220,228,238,0.82)",
}

// ── Polygon draw tool (must be inside MapContainer) ───────────────────────────
function PolygonDrawTool({ onComplete, onCancel, onVertCountChange }) {
    const [verts,     setVerts]     = useState([])
    const [cursor,    setCursor]    = useState(null)
    const [nearStart, setNearStart] = useState(false)
    const SNAP = 20

    const map = useMapEvents({
        click(e) {
            const pt = [e.latlng.lat, e.latlng.lng]
            if (verts.length >= 3) {
                const fp   = map.latLngToContainerPoint(verts[0])
                const dist = Math.hypot(e.containerPoint.x - fp.x, e.containerPoint.y - fp.y)
                if (dist < SNAP) { onComplete(verts); return }
            }
            const next = [...verts, pt]
            setVerts(next)
            onVertCountChange?.(next.length)
        },
        mousemove(e) {
            const pt = [e.latlng.lat, e.latlng.lng]
            setCursor(pt)
            if (verts.length >= 3) {
                const fp   = map.latLngToContainerPoint(verts[0])
                const dist = Math.hypot(e.containerPoint.x - fp.x, e.containerPoint.y - fp.y)
                setNearStart(dist < SNAP)
            } else setNearStart(false)
        },
    })

    useEffect(() => {
        map.getContainer().style.cursor = "crosshair"
        return () => { map.getContainer().style.cursor = "" }
    }, [map])

    const preview = cursor ? [...verts, cursor] : verts

    return (
        <>
            {preview.length >= 2 && (
                <Polyline
                    positions={preview}
                    pathOptions={{ color: "rgba(200,220,240,0.75)", weight: 1.5, dashArray: "5 4", opacity: 0.85 }}
                />
            )}
            {/* Closing segment when near start */}
            {nearStart && cursor && verts.length >= 3 && (
                <Polyline
                    positions={[cursor, verts[0]]}
                    pathOptions={{ color: "rgba(220,235,250,0.95)", weight: 2, opacity: 0.95 }}
                />
            )}
            {verts.map((v, i) => (
                <CircleMarker key={i} center={v}
                    radius={i === 0 ? (nearStart ? 9 : 5) : 3}
                    pathOptions={{
                        color:       "rgba(210,225,240,0.9)",
                        fillColor:   i === 0 && nearStart ? "rgba(255,255,255,0.95)" : "rgba(180,205,225,0.7)",
                        fillOpacity: 1,
                        weight:      i === 0 ? 2 : 1,
                    }}
                />
            ))}
        </>
    )
}

// ── Main layer (must be inside MapContainer) ──────────────────────────────────
const OverwatchLayer = memo(function OverwatchLayer({
    active,
    onExit,
    sentinelImageData   = null,
    sentinel2Active     = false,
    onToggleSentinel2   = null,
}) {
    const map = useMap()

    // ── State ─────────────────────────────────────────────────────────────────
    // modes: idle | drawing | analyzing | results
    const [mode,        setMode]        = useState("idle")
    const [vertCount,   setVertCount]   = useState(0)
    const [drawnPoly,   setDrawnPoly]   = useState(null)   // [[lat,lng], ...]
    const [drawnBounds, setDrawnBounds] = useState(null)   // {north,south,east,west}
    const [detections,  setDetections]  = useState([])
    const [stats,       setStats]       = useState(null)
    const [error,       setError]       = useState(null)
    const [minConf,     setMinConf]     = useState(0.15)
    const [enhance,     setEnhance]     = useState(false)
    const [enhanced,    setEnhanced]    = useState(false)
    const [analysis,    setAnalysis]    = useState(null)
    const [analyzing,   setAnalyzing]   = useState(false)
    const [isMobile,    setIsMobile]    = useState(() => window.innerWidth < 768)
    const [longWait,    setLongWait]    = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [selectedCats,setSelectedCats]= useState(new Set())
    const [savedScans,  setSavedScans]  = useState(() => loadSavedScans())
    const [savedImages, setSavedImages] = useState(() => loadSavedImages())

    const longWaitTimerRef = useRef(null)

    // ── Visible detections (conf + category filter) ───────────────────────────
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

    // ── Active toggle — open sidebar immediately, reset on exit ───────────────
    useEffect(() => {
        if (active) {
            setMode("idle")
            setSidebarOpen(true)
            // If sentinel imagery already loaded, stay in idle — user picks what to do
        } else {
            // On deactivate: reset transient state but keep saved items
            setMode("idle")
            setVertCount(0)
            setDrawnPoly(null)
            setDrawnBounds(null)
            setDetections([])
            setStats(null)
            setError(null)
            setEnhanced(false)
            setAnalysis(null)
            setAnalyzing(false)
            setSidebarOpen(false)
            setSelectedCats(new Set())
            clearTimeout(longWaitTimerRef.current)
            setLongWait(false)
            map.dragging.enable()
            map.getContainer().style.cursor = ""
        }
    }, [active, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Polygon completed ─────────────────────────────────────────────────────
    const handlePolygonComplete = useCallback((verts) => {
        const bounds = polyBounds(verts)
        setDrawnPoly(verts)
        setDrawnBounds(bounds)
        setMode("analyzing")
        runAnalysis(bounds)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCancelDraw = useCallback(() => {
        setMode(detections.length > 0 ? "results" : "idle")
        setVertCount(0)
        map.getContainer().style.cursor = ""
    }, [detections.length, map])

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
            if (data.error) { setError(data.error); setMode("idle"); return }
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
            setMode("idle")
        }
    }, [minConf, enhance])

    const runSentinelAnalysis = useCallback(async (imgData) => {
        setError(null); setDetections([]); setStats(null)
        setEnhanced(false); setAnalysis(null); setLongWait(false)
        setSelectedCats(new Set())
        setDrawnBounds(imgData.bounds)
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
            if (data.error) { setError(data.error); setMode("idle"); return }
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
            setMode("idle")
        }
    }, [minConf, enhance])

    const clearAnalysis = useCallback(() => {
        setDetections([]); setStats(null); setError(null)
        setAnalysis(null); setAnalyzing(false)
        setDrawnPoly(null); setDrawnBounds(null)
        setSelectedCats(new Set()); setVertCount(0)
        setMode("idle")
    }, [])

    const reanalyze = useCallback(() => {
        if (!drawnBounds) return
        setMode("analyzing")
        if (sentinelImageData) runSentinelAnalysis(sentinelImageData)
        else                   runAnalysis(drawnBounds)
    }, [drawnBounds, sentinelImageData, runAnalysis, runSentinelAnalysis])

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
            else            setAnalysis(data)
        } catch (err) {
            setError(`Analysis failed: ${err.message}`)
        } finally {
            setAnalyzing(false)
        }
    }, [detections, drawnBounds])

    // ── Category filter ───────────────────────────────────────────────────────
    const toggleCat    = useCallback((cat) => {
        setSelectedCats(prev => {
            const n = new Set(prev)
            n.has(cat) ? n.delete(cat) : n.add(cat)
            return n
        })
    }, [])
    const clearCatFilter = useCallback(() => setSelectedCats(new Set()), [])

    // ── Save / restore / delete scans ─────────────────────────────────────────
    const handleSave = useCallback(() => {
        if (!detections.length) return
        const scan = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), detections, stats, drawnBounds, enhanced }
        setSavedScans(prev => {
            const u = [scan, ...prev].slice(0, 20)
            persistSavedScans(u)
            return u
        })
    }, [detections, stats, drawnBounds, enhanced])

    const handleDeleteSaved = useCallback((id) => {
        setSavedScans(prev => {
            const u = prev.filter(s => s.id !== id)
            persistSavedScans(u)
            return u
        })
    }, [])

    const handleRestoreSaved = useCallback((scan) => {
        setDetections(scan.detections || [])
        setStats(scan.stats || null)
        setDrawnBounds(scan.drawnBounds || null)
        setDrawnPoly(null)
        setEnhanced(!!scan.enhanced)
        setAnalysis(null); setSelectedCats(new Set())
        setMode("results"); setSidebarOpen(true)
    }, [])

    // ── Save / delete pinned imagery ──────────────────────────────────────────
    const handlePinImagery = useCallback(() => {
        if (!sentinelImageData) return
        const entry = {
            id:          crypto.randomUUID(),
            timestamp:   new Date().toISOString(),
            src:         sentinelImageData.src,
            bounds:      sentinelImageData.bounds,
            capturedAt:  sentinelImageData.capturedAt,
        }
        setSavedImages(prev => {
            const u = [entry, ...prev].slice(0, 3)
            persistSavedImages(u)
            return u
        })
    }, [sentinelImageData])

    const handleDeleteSavedImage = useCallback((id) => {
        setSavedImages(prev => {
            const u = prev.filter(i => i.id !== id)
            persistSavedImages(u)
            return u
        })
    }, [])

    // ── Portals ───────────────────────────────────────────────────────────────
    // Spinner (full-screen overlay for analyzing state)
    const spinnerEl = active && mode === "analyzing" && createPortal(
        <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 2200,
            ...GLASS,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12, padding: "20px 28px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
            <div style={{
                width: 34, height: 34,
                border: "3px solid rgba(255,255,255,0.08)",
                borderTop: "3px solid rgba(180,215,235,0.6)",
                borderRadius: "50%",
                animation: "ow-spin 0.8s linear infinite",
            }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(220,228,238,0.8)" }}>
                {longWait ? "Analyzing large area…" : "Overwatch analyzing…"}
            </div>
            <div style={{ fontSize: 10, color: "rgba(220,228,238,0.35)", textAlign: "center" }}>
                {longWait
                    ? "Large area — may take several minutes"
                    : enhance ? "Fetching tiles · AI Classification" : "Fetching tiles · Object Detection"
                }
            </div>
        </div>,
        document.body
    )

    // "Reopen" pill when results exist but sidebar closed
    const reopenEl = active && mode === "results" && !sidebarOpen && stats && createPortal(
        <button
            onClick={() => setSidebarOpen(true)}
            style={{
                position: "fixed",
                bottom: isMobile ? 72 : 24,
                right:  24,
                zIndex: 1900,
                ...GLASS,
                border:       "1px solid rgba(255,255,255,0.1)",
                borderRadius: 24, padding: "9px 16px",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 11, fontWeight: 600, color: "rgba(220,228,238,0.65)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
        >
            <IconOverwatch size={13} color="rgba(140,210,240,0.7)" />
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
            border:     "1px solid rgba(200,80,80,0.3)",
            borderLeft: "3px solid rgba(200,80,80,0.7)",
            borderRadius: 7, padding: "10px 14px",
            display: "flex", alignItems: "flex-start", gap: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(210,80,80,0.8)", flexShrink: 0, marginTop: 4 }} />
            <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(210,80,80,0.9)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>
                    Overwatch Error
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: "rgba(220,228,238,0.75)" }}>{error}</div>
            </div>
            <button onClick={() => setError(null)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(220,228,238,0.3)", fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0, marginLeft: 4,
            }}>✕</button>
        </div>,
        document.body
    )

    // Sidebar portal
    const sidebarEl = active && createPortal(
        <OverwatchSidebar
            isMobile={isMobile}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            mode={mode}
            vertCount={vertCount}
            onStartDraw={() => { setMode("drawing"); setVertCount(0) }}
            onCancelDraw={handleCancelDraw}
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
            onRunSentinelML={() => sentinelImageData && runSentinelAnalysis(sentinelImageData)}
            sentinel2Active={sentinel2Active}
            onToggleSentinel2={onToggleSentinel2}
            sentinelImageData={sentinelImageData}
            onPinImagery={handlePinImagery}
            selectedCats={selectedCats}
            onToggleCat={toggleCat}
            onClearCatFilter={clearCatFilter}
            savedScans={savedScans}
            onSave={handleSave}
            onDeleteSaved={handleDeleteSaved}
            onRestoreSaved={handleRestoreSaved}
            savedImages={savedImages}
            onDeleteSavedImage={handleDeleteSavedImage}
        />,
        document.body
    )

    // ── React-Leaflet render ──────────────────────────────────────────────────
    return (
        <Fragment>
            {/* ── Persistent saved imagery overlays (always visible) ─────── */}
            {savedImages.map(img => img.src ? (
                <ImageOverlay
                    key={img.id}
                    url={img.src}
                    bounds={[[img.bounds.south, img.bounds.west], [img.bounds.north, img.bounds.east]]}
                    opacity={0.82}
                    zIndex={300}
                />
            ) : null)}

            {/* ── Persistent saved scan polygons (always visible) ─────────── */}
            {savedScans.map(scan =>
                (scan.detections || []).filter(d => d.confidence >= 0.15).map((det, i) => {
                    const color = colorForClass(det.class)
                    return (
                        <Polygon key={`${scan.id}-${i}`} positions={det.corners}
                            pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.07, opacity: 0.45, dashArray: "4 3" }}
                        >
                            <Tooltip sticky direction="top" offset={[0,-4]}>
                                {detectionLabel(det)}
                            </Tooltip>
                        </Polygon>
                    )
                })
            )}

            {/* ── Active session — only when overwatch is on ──────────────── */}
            {active && (
                <>
                    {/* Polygon draw tool */}
                    {mode === "drawing" && (
                        <PolygonDrawTool
                            onComplete={handlePolygonComplete}
                            onCancel={handleCancelDraw}
                            onVertCountChange={setVertCount}
                        />
                    )}

                    {/* Drawn polygon outline */}
                    {drawnPoly && drawnPoly.length >= 3 && (
                        <Polygon
                            positions={drawnPoly}
                            pathOptions={{ color: "rgba(180,215,235,0.6)", weight: 1.5, dashArray: "5 4", fill: true, fillColor: "rgba(180,215,235,0.15)", fillOpacity: 1, opacity: 0.65 }}
                        />
                    )}

                    {/* Active detections */}
                    {visible.map((det, i) => {
                        const color = colorForClass(det.class)
                        return (
                            <Polygon key={i} positions={det.corners}
                                pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.14, opacity: 0.9 }}
                            >
                                <Tooltip sticky direction="top" className="ow-det-label" offset={[0,-4]}>
                                    {detectionLabel(det)}
                                </Tooltip>
                            </Polygon>
                        )
                    })}

                    {spinnerEl}
                    {reopenEl}
                    {sidebarEl}
                </>
            )}

            {errorEl}
        </Fragment>
    )
})

export default OverwatchLayer
