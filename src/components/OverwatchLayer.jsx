import { useState, useRef, useEffect, useCallback, Fragment, memo } from "react"
import { createPortal } from "react-dom"
import { useMap, Polygon, Rectangle, Tooltip } from "react-leaflet"
import API_BASE from "../apiBase.js"

// ── Detection class helpers ───────────────────────────────────────────────────
function categoryOf(cls) {
    const c = (cls || "").toLowerCase().trim()
    if (["plane", "airplane", "helicopter"].includes(c)) return "Aircraft"
    if (["ship", "boat"].includes(c)) return "Vessel"
    if (["large-vehicle", "small-vehicle", "large vehicle", "small vehicle",
         "car", "truck", "bus", "motorcycle"].includes(c)) return "Vehicle"
    if (["storage-tank", "storage tank"].includes(c)) return "Structure"
    if (["bridge", "harbor", "train"].includes(c)) return "Infrastructure"
    return "Object"
}

function detectionLabel(det) {
    const cat  = categoryOf(det.class)
    const type = det.specific_type
        ? det.specific_type.charAt(0).toUpperCase() + det.specific_type.slice(1)
        : det.class
    const conf = Math.round(det.confidence * 100)
    return `${cat}: ${type} (${conf}%)`
}

const CLASS_COLORS = {
    "plane":         "#38bdf8",
    "helicopter":    "#38bdf8",
    "airplane":      "#38bdf8",
    "ship":          "#f59e0b",
    "boat":          "#f59e0b",
    "large-vehicle": "#22c55e",
    "small-vehicle": "#22c55e",
    "large vehicle": "#22c55e",
    "small vehicle": "#22c55e",
    "car":           "#22c55e",
    "truck":         "#22c55e",
    "bus":           "#22c55e",
    "motorcycle":    "#22c55e",
    "storage-tank":  "#ef4444",
    "storage tank":  "#ef4444",
    "bridge":        "#a855f7",
    "harbor":        "#a855f7",
    "train":         "#a855f7",
}

function detectionColor(cls) {
    const key = (cls || "").toLowerCase().trim()
    return CLASS_COLORS[key] || CLASS_COLORS[key.replace(/ /g, "-")] || "#e2e8f0"
}

// ── Overwatch eye+crosshair icon ──────────────────────────────────────────────
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

// ── Shared glass panel style ──────────────────────────────────────────────────
const GLASS = {
    background:          "rgba(6,13,26,0.96)",
    backdropFilter:      "blur(18px)",
    WebkitBackdropFilter:"blur(18px)",
    fontFamily:          "Inter,-apple-system,sans-serif",
    color:               "#e2e8f0",
}

// ── OverwatchLayer (inside MapContainer) ──────────────────────────────────────
const OverwatchLayer = memo(function OverwatchLayer({ active, onExit }) {
    const map = useMap()

    // State machine: drawing | analyzing | results
    const [mode,        setMode]        = useState("drawing")
    const [drawRect,    setDrawRect]    = useState(null)   // viewport px {x,y,w,h}
    const [drawnBounds, setDrawnBounds] = useState(null)   // geo {north,south,east,west}
    const [detections,  setDetections]  = useState([])
    const [stats,       setStats]       = useState(null)
    const [error,       setError]       = useState(null)
    const [minConf,     setMinConf]     = useState(0.25)
    const [enhance,     setEnhance]     = useState(false)
    const [enhanced,    setEnhanced]    = useState(false)   // did the last run use AI enhance?
    const [isMobile,    setIsMobile]    = useState(() => window.innerWidth < 768)
    // Slide-in animation state for mobile sheet
    const [sheetVisible, setSheetVisible] = useState(false)

    const drawStartRef   = useRef(null)
    const isDrawingRef   = useRef(false)

    const visible = detections.filter(d => d.confidence >= minConf)

    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])

    // Reset / restore when active toggles
    useEffect(() => {
        if (!active) {
            setMode("drawing")
            setDrawRect(null)
            setDrawnBounds(null)
            setDetections([])
            setStats(null)
            setError(null)
            setEnhanced(false)
            setSheetVisible(false)
            drawStartRef.current = null
            isDrawingRef.current = false
            map.dragging.enable()
        }
    }, [active, map])

    // Trigger slide-in when results arrive on mobile
    useEffect(() => {
        if (mode === "results" && isMobile) {
            // small RAF so transition fires after element mounts
            requestAnimationFrame(() => setSheetVisible(true))
        } else {
            setSheetVisible(false)
        }
    }, [mode, isMobile])

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
        const bounds = { north: nw.lat, south: se.lat, east: se.lng, west: nw.lng }
        setDrawnBounds(bounds)
        setMode("analyzing")
        runAnalysis(bounds)
    }, [clientToContainerPt, map]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Inference ─────────────────────────────────────────────────────────────
    const runAnalysis = useCallback(async (bounds) => {
        setError(null)
        setDetections([])
        setStats(null)
        setEnhanced(false)
        const zoom = Math.min(18, Math.max(10, Math.round(map.getZoom())))
        try {
            const res = await fetch(`${API_BASE}/api/overwatch/detect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bounds, zoom, confidence: minConf, enhance }),
            })
            const data = await res.json()
            if (data.error) {
                setError(data.error)
                setMode("drawing")
                setDrawRect(null)
                return
            }
            const dets = data.detections || []
            setDetections(dets)
            setEnhanced(!!data.enhanced)
            const counts = {}
            for (const d of dets) counts[d.class] = (counts[d.class] || 0) + 1
            setStats({ total: data.count, counts, zoom: data.zoom_used, model: data.model })
            setMode("results")
        } catch (err) {
            setError(`Request failed: ${err.message}`)
            setMode("drawing")
            setDrawRect(null)
        }
    }, [map, minConf, enhance])

    const clearAnalysis = useCallback(() => {
        setDetections([])
        setStats(null)
        setError(null)
        setDrawRect(null)
        setDrawnBounds(null)
        setMode("drawing")
    }, [])

    const reanalyze = useCallback(() => {
        if (!drawnBounds) return
        setMode("analyzing")
        runAnalysis(drawnBounds)
    }, [drawnBounds, runAnalysis])

    // ── Capture overlay (crosshair + drag rect) ───────────────────────────────
    const overlayEl = (mode === "drawing" || mode === "analyzing") && createPortal(
        <div
            style={{
                position: "absolute", inset: 0, zIndex: 1200,
                cursor: mode === "analyzing" ? "wait" : "crosshair",
                touchAction: "none", userSelect: "none",
            }}
            onMouseDown={mode === "drawing" ? handlePointerDown : undefined}
            onMouseMove={mode === "drawing" ? handlePointerMove : undefined}
            onMouseUp={mode === "drawing" ? handlePointerUp : undefined}
            onTouchStart={mode === "drawing" ? handlePointerDown : undefined}
            onTouchMove={mode === "drawing" ? handlePointerMove : undefined}
            onTouchEnd={mode === "drawing" ? handlePointerUp : undefined}
        >
            {drawRect && drawRect.w > 4 && drawRect.h > 4 && (
                <div style={{
                    position: "fixed",
                    left: drawRect.x, top: drawRect.y,
                    width: drawRect.w, height: drawRect.h,
                    border: "2px dashed #38bdf8",
                    background: "rgba(56,189,248,0.07)",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                }} />
            )}
        </div>,
        map.getContainer()
    )

    // ── Instructions hint (bottom-center, above bottom nav on mobile) ─────────
    const instructionsEl = mode === "drawing" && createPortal(
        <div style={{
            position:  "fixed",
            bottom:    isMobile ? 72 : 24,
            left:      "50%",
            transform: "translateX(-50%)",
            zIndex:    1900,
            pointerEvents: "none",
            ...GLASS,
            border:       "1px solid rgba(56,189,248,0.3)",
            borderRadius: 24,
            padding:      "9px 18px",
            fontSize:     12,
            display:      "flex",
            alignItems:   "center",
            gap:          8,
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

    // ── Analyzing spinner ─────────────────────────────────────────────────────
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
            <div style={{ fontSize: 12, fontWeight: 600 }}>Overwatch analyzing…</div>
            <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)" }}>
                {enhance ? "Fetching tiles · YOLOv8 · AI Classification" : "Fetching tiles · Running YOLOv8"}
            </div>
        </div>,
        document.body
    )

    // ── Results panel — desktop pill / mobile bottom-sheet ────────────────────
    const resultsPanelContent = stats && (
        <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <IconOverwatch size={14} color="#38bdf8" />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#38bdf8" }}>
                        Overwatch
                    </span>
                    {stats.model && (
                        <span style={{ fontSize: 8, color: "rgba(232,237,242,0.3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            {stats.model === "dota-obb" ? "DOTA" : "COCO"} · z{stats.zoom}
                            {enhanced && <span style={{ color: "#a78bfa", marginLeft: 4 }}>· AI</span>}
                        </span>
                    )}
                </div>
                <button onClick={onExit} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(232,237,242,0.35)", fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
            </div>

            {/* Mobile drag handle */}
            {isMobile && (
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "-6px auto 12px" }} />
            )}

            {/* Count */}
            <div style={{ fontSize: 24, fontWeight: 700, color: stats.total > 0 ? "#e2e8f0" : "rgba(232,237,242,0.3)", marginBottom: 6, lineHeight: 1 }}>
                {stats.total}
                <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(232,237,242,0.45)", marginLeft: 7 }}>
                    {stats.total === 1 ? "object detected" : "objects detected"}
                </span>
            </div>

            {/* Class chips */}
            {stats.total > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px", marginBottom: 10 }}>
                    {Object.entries(stats.counts).sort(([,a],[,b]) => b - a).map(([cls, n]) => {
                        const c = detectionColor(cls)
                        return (
                            <span key={cls} style={{
                                fontSize: 10, padding: "3px 8px", borderRadius: 12,
                                background: `${c}18`, border: `1px solid ${c}44`,
                                color: c, fontWeight: 600,
                            }}>
                                {n} {cls}
                            </span>
                        )
                    })}
                </div>
            )}

            {stats.total === 0 && (
                <div style={{ fontSize: 11, color: "rgba(232,237,242,0.4)", marginBottom: 10, lineHeight: 1.5 }}>
                    No objects detected. Try zooming in further (zoom 14+).
                </div>
            )}

            {/* Confidence slider */}
            <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 9, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Min confidence</span>
                    <span style={{ fontSize: 9, color: "#38bdf8", fontWeight: 600 }}>{Math.round(minConf * 100)}%</span>
                </div>
                <input type="range" min={0} max={0.9} step={0.05} value={minConf}
                    onChange={e => setMinConf(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
                />
                <div style={{ fontSize: 9, color: "rgba(232,237,242,0.25)", marginTop: 3 }}>
                    Showing {visible.length} of {detections.length}
                </div>
            </div>

            {/* AI classification toggle */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 10, padding: "7px 10px",
                background: enhance ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${enhance ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: 6, cursor: "pointer",
            }} onClick={() => setEnhance(v => !v)}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: enhance ? "#a78bfa" : "rgba(232,237,242,0.5)" }}>
                        AI Classification
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(232,237,242,0.3)", marginTop: 1 }}>
                        {enhance ? "Claude vision · enabled (slower)" : "Uses Claude vision · slower"}
                    </div>
                </div>
                <div style={{
                    width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                    background: enhance ? "rgba(139,92,246,0.7)" : "rgba(255,255,255,0.1)",
                    transition: "background 0.2s",
                    display: "flex", alignItems: "center",
                    padding: "0 2px",
                    justifyContent: enhance ? "flex-end" : "flex-start",
                }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
                </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 7 }}>
                <button onClick={clearAnalysis} style={{
                    flex: 1, padding: isMobile ? "10px 0" : "6px 0",
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 6, color: "#ef4444",
                }}>Clear</button>
                <button onClick={reanalyze} style={{
                    flex: 1, padding: isMobile ? "10px 0" : "6px 0",
                    fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)",
                    borderRadius: 6, color: "#38bdf8",
                }}>Re-analyze</button>
                <button disabled title="Coming soon" style={{
                    flex: 1, padding: isMobile ? "10px 0" : "6px 0",
                    fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6, color: "rgba(232,237,242,0.2)", cursor: "not-allowed",
                }}>Save</button>
            </div>
        </>
    )

    const resultsEl = mode === "results" && stats && createPortal(
        isMobile ? (
            // ── Mobile: slide up from bottom ──────────────────────────────────
            <div style={{
                position:  "fixed",
                left:      0,
                right:     0,
                bottom:    0,
                zIndex:    1900,
                ...GLASS,
                borderTop:         "1px solid rgba(56,189,248,0.2)",
                borderTopLeftRadius:  16,
                borderTopRightRadius: 16,
                padding:   "12px 16px 16px",
                paddingBottom: "max(16px, env(safe-area-inset-bottom))",
                transform: sheetVisible ? "translateY(0)" : "translateY(100%)",
                transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
                boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
                // ensure it sits above bottom nav (56px) but sheet itself has its own padding
                marginBottom: 56,
            }}>
                {resultsPanelContent}
            </div>
        ) : (
            // ── Desktop: compact card, bottom-right ───────────────────────────
            <div style={{
                position:  "fixed",
                bottom:    24,
                right:     24,
                zIndex:    1900,
                width:     300,
                ...GLASS,
                border:       "1px solid rgba(56,189,248,0.2)",
                borderRadius: 10,
                padding:      "14px 16px",
                boxShadow:    "0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(56,189,248,0.05)",
            }}>
                {resultsPanelContent}
            </div>
        ),
        document.body
    )

    // ── Error toast ───────────────────────────────────────────────────────────
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
                <div style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Overwatch Error</div>
                <div style={{ fontSize: 11, lineHeight: 1.4 }}>{error}</div>
            </div>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(232,237,242,0.35)", fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0, marginLeft: 4 }}>✕</button>
        </div>,
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
                const color = detectionColor(det.class)
                return (
                    <Polygon key={i} positions={det.corners}
                        pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.13, opacity: 0.9 }}
                    >
                        <Tooltip permanent direction="center" className="ow-det-label">
                            {detectionLabel(det)}
                        </Tooltip>
                    </Polygon>
                )
            })}

            {overlayEl}
            {instructionsEl}
            {spinnerEl}
            {resultsEl}
            {errorEl}
        </Fragment>
    )
})

export default OverwatchLayer
