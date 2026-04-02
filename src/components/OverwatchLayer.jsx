import { useState, useRef, useEffect, useCallback, Fragment, memo } from "react"
import { createPortal } from "react-dom"
import { useMap, useMapEvents, Polygon, Polyline, CircleMarker, Tooltip, ImageOverlay, Pane, Rectangle } from "react-leaflet"
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
    const lats = verts.map(v => v[0]), lons = verts.map(v => v[1])
    return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) }
}

const GLASS = {
    background:           "var(--akili-panel-solid, #0e1420)",
    backdropFilter:       "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    fontFamily:           "system-ui, -apple-system, sans-serif",
    color:                "var(--akili-text-primary, #e8edf2)",
}

// ── Polygon draw tool (must be inside MapContainer) ───────────────────────────
function PolygonDrawTool({ onComplete, onCancel, onVertCountChange }) {
    const [verts,     setVerts]     = useState([])
    const [cursor,    setCursor]    = useState(null)
    const [nearStart, setNearStart] = useState(false)
    const SNAP = 22

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
            setCursor([e.latlng.lat, e.latlng.lng])
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
                <Polyline positions={preview}
                    pathOptions={{ color: "rgba(180,210,230,0.65)", weight: 1.5, dashArray: "5 4", opacity: 0.85 }}
                />
            )}
            {nearStart && cursor && verts.length >= 3 && (
                <Polyline positions={[cursor, verts[0]]}
                    pathOptions={{ color: "rgba(220,235,250,0.9)", weight: 2, opacity: 0.9 }}
                />
            )}
            {verts.map((v, i) => (
                <CircleMarker key={i} center={v}
                    radius={i === 0 ? (nearStart ? 9 : 5) : 3}
                    pathOptions={{
                        color: "rgba(200,220,240,0.9)", fillColor: i === 0 && nearStart ? "#fff" : "rgba(160,195,220,0.7)",
                        fillOpacity: 1, weight: i === 0 ? 2 : 1,
                    }}
                />
            ))}
        </>
    )
}

// ── Main layer ────────────────────────────────────────────────────────────────
const OverwatchLayer = memo(function OverwatchLayer({
    active,
    onExit,
    sentinelImageData    = null,   // from external SentinelLayer — used for ML-on-sentinel
    sentinel2Active      = false,
    onToggleSentinel2    = null,
}) {
    const map = useMap()

    // ── ML state ──────────────────────────────────────────────────────────────
    const [mode,          setMode]          = useState("idle")   // idle|drawing|analyzing|results
    const [drawTarget,    setDrawTarget]    = useState("ml")     // "ml" | "sentinel"
    const [vertCount,     setVertCount]     = useState(0)
    const [drawnPoly,     setDrawnPoly]     = useState(null)
    const [drawnBounds,   setDrawnBounds]   = useState(null)
    const [detections,    setDetections]    = useState([])
    const [stats,         setStats]         = useState(null)
    const [error,         setError]         = useState(null)
    const [minConf,       setMinConf]       = useState(0.15)
    const [enhance,       setEnhance]       = useState(false)
    const [enhanced,      setEnhanced]      = useState(false)
    const [analysis,      setAnalysis]      = useState(null)
    const [analyzing,     setAnalyzing]     = useState(false)
    const [selectedCats,  setSelectedCats]  = useState(new Set())

    // ── Sentinel within Overwatch state ───────────────────────────────────────
    const [sentinelBounds,      setSentinelBounds]      = useState(null)
    const [sentinelImageType,   setSentinelImageType]   = useState("true-colour")
    const [sentinelMaxCloud,    setSentinelMaxCloud]     = useState(20)
    const [sentinelDaysBack,    setSentinelDaysBack]     = useState(90)
    const [sentinelLoading,     setSentinelLoading]      = useState(false)
    const [sentinelCurrentImg,  setSentinelCurrentImg]   = useState(null)   // {src,bounds,date,capturedAt}
    const [sentinelDates,       setSentinelDates]        = useState([])
    const [sentinelDatesLoading,setSentinelDatesLoading] = useState(false)

    // ── Shared ────────────────────────────────────────────────────────────────
    const [isMobile,      setIsMobile]      = useState(() => window.innerWidth < 768)
    const [longWait,      setLongWait]      = useState(false)
    const [sidebarOpen,   setSidebarOpen]   = useState(false)
    const [savedScans,    setSavedScans]    = useState(() => loadSavedScans())
    const [savedImages,   setSavedImages]   = useState(() => loadSavedImages())
    const longWaitTimerRef = useRef(null)

    // ── Derived ───────────────────────────────────────────────────────────────
    const visible = detections.filter(d => {
        if (d.confidence < minConf) return false
        if (selectedCats.size > 0) {
            const cat = d.category || catForClass(d.class)
            if (!selectedCats.has(cat)) return false
        }
        return true
    })

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    // ── Active toggle ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (active) {
            setMode("idle")
            setSidebarOpen(true)
        } else {
            setMode("idle")
            setVertCount(0); setDrawnPoly(null); setDrawnBounds(null)
            setDetections([]); setStats(null); setError(null)
            setEnhanced(false); setAnalysis(null); setAnalyzing(false)
            setSidebarOpen(false); setSelectedCats(new Set())
            setSentinelBounds(null); setSentinelCurrentImg(null)
            setSentinelDates([]); setDrawTarget("ml")
            clearTimeout(longWaitTimerRef.current); setLongWait(false)
            map.dragging.enable()
            map.getContainer().style.cursor = ""
        }
    }, [active, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // Open sidebar when results arrive
    useEffect(() => {
        if (mode === "results") setSidebarOpen(true)
    }, [mode])

    // ── Polygon draw callbacks ────────────────────────────────────────────────
    const handlePolygonComplete = useCallback((verts) => {
        const bounds = polyBounds(verts)
        if (drawTarget === "sentinel") {
            setSentinelBounds(bounds)
            setDrawnPoly(null)
            setMode("idle")
            setVertCount(0)
        } else {
            setDrawnPoly(verts)
            setDrawnBounds(bounds)
            setMode("analyzing")
            runMLAnalysis(bounds)
        }
    }, [drawTarget]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCancelDraw = useCallback(() => {
        setMode(detections.length > 0 ? "results" : "idle")
        setVertCount(0)
        map.getContainer().style.cursor = ""
    }, [detections.length, map])

    // ── ML inference ──────────────────────────────────────────────────────────
    const runMLAnalysis = useCallback(async (bounds) => {
        setError(null); setDetections([]); setStats(null)
        setEnhanced(false); setAnalysis(null); setLongWait(false)
        setSelectedCats(new Set())
        clearTimeout(longWaitTimerRef.current)
        longWaitTimerRef.current = setTimeout(() => setLongWait(true), 5000)
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/detect`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bounds, zoom: 18, confidence: minConf, enhance }),
            })
            const data = await res.json()
            clearTimeout(longWaitTimerRef.current); setLongWait(false)
            if (data.error) { setError(data.error); setMode("idle"); return }
            const dets = data.detections || []
            setDetections(dets); setEnhanced(!!data.enhanced)
            const counts = {}
            for (const d of dets) counts[d.class] = (counts[d.class] || 0) + 1
            setStats({ total: data.count, displayed: dets.length, counts, zoom: data.zoom_used, model: data.model })
            setMode("results")
        } catch (err) {
            clearTimeout(longWaitTimerRef.current); setLongWait(false)
            setError(`Request failed: ${err.message}`); setMode("idle")
        }
    }, [minConf, enhance])

    const runSentinelML = useCallback(async () => {
        const imgData = sentinelCurrentImg || sentinelImageData
        if (!imgData?.src) { setError("No Sentinel imagery loaded"); return }
        setError(null); setDetections([]); setStats(null)
        setEnhanced(false); setAnalysis(null); setLongWait(false); setSelectedCats(new Set())
        const bounds = imgData.bounds
        setDrawnBounds(bounds)
        setMode("analyzing")
        clearTimeout(longWaitTimerRef.current)
        longWaitTimerRef.current = setTimeout(() => setLongWait(true), 5000)
        const b64 = imgData.src.includes(",") ? imgData.src.split(",")[1] : imgData.src
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/detect-image`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: b64, bounds, confidence: minConf, enhance }),
            })
            const data = await res.json()
            clearTimeout(longWaitTimerRef.current); setLongWait(false)
            if (data.error) { setError(data.error); setMode("idle"); return }
            const dets = data.detections || []
            setDetections(dets); setEnhanced(!!data.enhanced)
            const counts = {}
            for (const d of dets) counts[d.class] = (counts[d.class] || 0) + 1
            setStats({ total: data.count, displayed: dets.length, counts, zoom: "Sentinel-2", model: data.model })
            setMode("results")
        } catch (err) {
            clearTimeout(longWaitTimerRef.current); setLongWait(false)
            setError(`Request failed: ${err.message}`); setMode("idle")
        }
    }, [sentinelCurrentImg, sentinelImageData, minConf, enhance])

    const clearAnalysis = useCallback(() => {
        setDetections([]); setStats(null); setError(null)
        setAnalysis(null); setAnalyzing(false)
        setDrawnPoly(null); setDrawnBounds(null)
        setSelectedCats(new Set()); setVertCount(0)
        setMode("idle")
    }, [])

    const reanalyze = useCallback(() => {
        if (!drawnBounds) return
        setMode("analyzing"); runMLAnalysis(drawnBounds)
    }, [drawnBounds, runMLAnalysis])

    const runIntelligenceAnalysis = useCallback(async () => {
        if (!detections.length || !drawnBounds) return
        setAnalyzing(true)
        try {
            const res  = await fetch(`${API_BASE}/api/overwatch/analyze`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detections, bounds: drawnBounds }),
            })
            const data = await res.json()
            if (data.error) setError(data.error)
            else setAnalysis(data)
        } catch (err) { setError(`Analysis failed: ${err.message}`) }
        finally { setAnalyzing(false) }
    }, [detections, drawnBounds])

    // ── Category filter ───────────────────────────────────────────────────────
    const toggleCat    = useCallback((cat) => setSelectedCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n }), [])
    const clearCatFilter = useCallback(() => setSelectedCats(new Set()), [])

    // ── Save / restore scans ──────────────────────────────────────────────────
    const handleSave = useCallback(() => {
        if (!detections.length) return
        const scan = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), detections, stats, drawnBounds, enhanced }
        setSavedScans(prev => { const u = [scan, ...prev].slice(0, 20); persistSavedScans(u); return u })
    }, [detections, stats, drawnBounds, enhanced])
    const handleDeleteSaved = useCallback((id) => setSavedScans(prev => { const u = prev.filter(s => s.id !== id); persistSavedScans(u); return u }), [])
    const handleRestoreSaved = useCallback((scan) => {
        setDetections(scan.detections || []); setStats(scan.stats || null)
        setDrawnBounds(scan.drawnBounds || null); setDrawnPoly(null)
        setEnhanced(!!scan.enhanced); setAnalysis(null); setSelectedCats(new Set())
        setMode("results"); setSidebarOpen(true)
    }, [])

    // ── Sentinel imagery fetching ─────────────────────────────────────────────
    const loadSentinelImagery = useCallback(async (date = null) => {
        const bounds = sentinelBounds
        if (!bounds) return
        setSentinelLoading(true); setError(null)
        try {
            const res  = await fetch(`${API_BASE}/api/sentinel/imagery`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bounds, max_cloud: sentinelMaxCloud, days_back: sentinelDaysBack,
                    image_type: sentinelImageType, ...(date ? { date } : {}),
                }),
            })
            const data = await res.json()
            if (data.error) { setError(data.error); setSentinelLoading(false); return }
            const img = {
                src:        `data:image/png;base64,${data.image}`,
                bounds,
                capturedAt: new Date().toISOString(),
                date:       date || null,
                imageType:  sentinelImageType,
            }
            setSentinelCurrentImg(img)
        } catch (err) { setError(`Sentinel fetch failed: ${err.message}`) }
        finally { setSentinelLoading(false) }
    }, [sentinelBounds, sentinelMaxCloud, sentinelDaysBack, sentinelImageType])

    const fetchSentinelDates = useCallback(async () => {
        if (!sentinelBounds) return
        setSentinelDatesLoading(true); setSentinelDates([])
        try {
            const res  = await fetch(`${API_BASE}/api/sentinel/dates`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bounds: sentinelBounds, max_cloud: 50, days_back: 180 }),
            })
            const data = await res.json()
            setSentinelDates(data.dates || [])
        } catch { setSentinelDates([]) }
        finally { setSentinelDatesLoading(false) }
    }, [sentinelBounds])

    const clearSentinelImagery = useCallback(() => {
        setSentinelCurrentImg(null); setSentinelBounds(null); setSentinelDates([])
    }, [])

    // ── Save / delete pinned imagery ──────────────────────────────────────────
    const handlePinImagery = useCallback(() => {
        const img = sentinelCurrentImg || sentinelImageData
        if (!img) return
        const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), src: img.src, bounds: img.bounds, capturedAt: img.capturedAt }
        setSavedImages(prev => { const u = [entry, ...prev].slice(0, 3); persistSavedImages(u); return u })
    }, [sentinelCurrentImg, sentinelImageData])
    const handleDeleteSavedImage = useCallback((id) => setSavedImages(prev => { const u = prev.filter(i => i.id !== id); persistSavedImages(u); return u }), [])

    // ── Portals ───────────────────────────────────────────────────────────────
    const spinnerEl = active && mode === "analyzing" && createPortal(
        <div style={{
            position: "fixed", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)", zIndex: 2200,
            ...GLASS,
            border: "1px solid var(--akili-border)",
            borderRadius: 10, padding: "18px 26px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
            <div style={{
                width: 30, height: 30,
                border: "2px solid rgba(255,255,255,0.08)",
                borderTop: "2px solid var(--akili-accent, #1a6eb5)",
                borderRadius: "50%", animation: "ow-spin 0.8s linear infinite",
            }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--akili-text-primary)" }}>
                {longWait ? "Analyzing large area…" : "Overwatch analyzing…"}
            </div>
            <div style={{ fontSize: 9, color: "var(--akili-text-muted)", textAlign: "center" }}>
                {longWait ? "Large area — may take several minutes" :
                    enhance ? "Fetching tiles · AI Classification" : "Fetching tiles · Object Detection"}
            </div>
        </div>,
        document.body
    )

    const reopenEl = active && mode === "results" && !sidebarOpen && stats && createPortal(
        <button onClick={() => setSidebarOpen(true)} style={{
            position: "fixed", bottom: isMobile ? 72 : 24, right: 24, zIndex: 1900,
            ...GLASS,
            border: "1px solid var(--akili-border)",
            borderRadius: 24, padding: "8px 14px",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
            fontSize: 11, fontWeight: 600, color: "var(--akili-text-secondary)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}>
            <IconOverwatch size={12} color="var(--akili-accent, #1a6eb5)" />
            {stats.total} detected
        </button>,
        document.body
    )

    const errorEl = error && createPortal(
        <div style={{
            position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
            zIndex: 2100, maxWidth: "min(400px, calc(100vw - 32px))",
            ...GLASS,
            border: "1px solid rgba(200,60,60,0.3)",
            borderLeft: "3px solid rgba(200,60,60,0.7)",
            borderRadius: 7, padding: "10px 14px",
            display: "flex", alignItems: "flex-start", gap: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(210,60,60,0.8)", flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(210,70,70,0.9)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                    Overwatch Error
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--akili-text-secondary)" }}>{error}</div>
            </div>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--akili-text-muted)", fontSize: 15, lineHeight: 1, padding: 0 }}>✕</button>
        </div>,
        document.body
    )

    const sidebarEl = active && createPortal(
        <OverwatchSidebar
            isMobile={isMobile}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            mode={mode}
            drawTarget={drawTarget}
            vertCount={vertCount}
            onStartMLDraw={() => { setDrawTarget("ml"); setMode("drawing"); setVertCount(0) }}
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
            onSave={handleSave}
            selectedCats={selectedCats}
            onToggleCat={toggleCat}
            onClearCatFilter={clearCatFilter}
            savedScans={savedScans}
            onDeleteSaved={handleDeleteSaved}
            onRestoreSaved={handleRestoreSaved}
            savedImages={savedImages}
            onDeleteSavedImage={handleDeleteSavedImage}
            // sentinel props
            sentinelMode={mode === "drawing" && drawTarget === "sentinel"}
            onStartSentinelDraw={() => { setDrawTarget("sentinel"); setMode("drawing"); setVertCount(0) }}
            onCancelSentinelDraw={handleCancelDraw}
            sentinelBounds={sentinelBounds}
            sentinelImageType={sentinelImageType}
            onImageTypeChange={setSentinelImageType}
            sentinelMaxCloud={sentinelMaxCloud}
            onMaxCloudChange={setSentinelMaxCloud}
            sentinelDaysBack={sentinelDaysBack}
            onDaysBackChange={setSentinelDaysBack}
            sentinelLoading={sentinelLoading}
            sentinelCurrentImg={sentinelCurrentImg}
            onLoadImagery={() => loadSentinelImagery()}
            onClearImagery={clearSentinelImagery}
            sentinelDates={sentinelDates}
            sentinelDatesLoading={sentinelDatesLoading}
            onFetchDates={fetchSentinelDates}
            onLoadDate={(date) => loadSentinelImagery(date)}
            onPinImagery={handlePinImagery}
            onRunMLOnSentinel={runSentinelML}
            sentinel2Active={sentinel2Active}
            onToggleSentinel2={onToggleSentinel2}
        />,
        document.body
    )

    // ── React-Leaflet render ──────────────────────────────────────────────────
    return (
        <Fragment>
            {/* ── Persistent pinned imagery overlays ──────────────────────── */}
            {savedImages.filter(img => img.src).map(img => (
                <Pane key={img.id} name={`owImgPane-${img.id}`} style={{ zIndex: 320 }}>
                    <ImageOverlay
                        url={img.src}
                        bounds={[[img.bounds.south, img.bounds.west], [img.bounds.north, img.bounds.east]]}
                        opacity={0.82}
                    />
                </Pane>
            ))}

            {/* ── Persistent saved scan polygons ───────────────────────────── */}
            {savedScans.map(scan =>
                (scan.detections || []).filter(d => d.confidence >= 0.15).map((det, i) => {
                    const color = colorForClass(det.class)
                    return (
                        <Polygon key={`${scan.id}-${i}`} positions={det.corners}
                            pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.07, opacity: 0.4, dashArray: "4 3" }}>
                            <Tooltip sticky direction="top" offset={[0,-4]}>{detectionLabel(det)}</Tooltip>
                        </Polygon>
                    )
                })
            )}

            {/* ── Active session ───────────────────────────────────────────── */}
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

                    {/* ML drawn polygon outline */}
                    {drawnPoly && drawnPoly.length >= 3 && (
                        <Polygon positions={drawnPoly}
                            pathOptions={{ color: "rgba(160,200,225,0.5)", weight: 1.5, dashArray: "5 4", fill: true, fillColor: "rgba(160,200,225,0.08)", fillOpacity: 1, opacity: 0.6 }}
                        />
                    )}

                    {/* Sentinel region rectangle */}
                    {sentinelBounds && (
                        <Rectangle
                            bounds={[[sentinelBounds.south, sentinelBounds.west], [sentinelBounds.north, sentinelBounds.east]]}
                            pathOptions={{ color: "rgba(34,211,238,0.5)", weight: 1.5, fill: false, dashArray: "4 3" }}
                        />
                    )}

                    {/* Sentinel ImageOverlay (within Overwatch) */}
                    {sentinelCurrentImg?.src && sentinelBounds && (
                        <Pane name="owSentinelPane" style={{ zIndex: 350 }}>
                            <ImageOverlay
                                url={sentinelCurrentImg.src}
                                bounds={[[sentinelBounds.south, sentinelBounds.west], [sentinelBounds.north, sentinelBounds.east]]}
                                opacity={0.92}
                            />
                        </Pane>
                    )}

                    {/* Active ML detection polygons */}
                    {visible.map((det, i) => {
                        const color = colorForClass(det.class)
                        return (
                            <Polygon key={i} positions={det.corners}
                                pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.14, opacity: 0.9 }}>
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
