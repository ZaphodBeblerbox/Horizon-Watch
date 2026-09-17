import { showTip, hideTip } from "./mapTip.js"
import { useState, useEffect, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { useCesium, Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, VerticalOrigin, LabelStyle,
    ScreenSpaceEventHandler, ScreenSpaceEventType, defined,
    SceneTransforms, NearFarScalar, HeightReference,
} from "cesium"

const CAMERAS = [
    {
        id:        "cam-kensington",
        name:      "Kensington Live Webcam",
        location:  "London, UK",
        lat:       51.5030,
        lon:       -0.1927,
        heading:   180,
        pitch:     -15,
        youtubeId: "cWd_niy8Rz8",
        type:      "URBAN",
    },
    {
        id:        "cam-elbo-bar",
        name:      "Elbo Bar Live",
        location:  "Fort Lauderdale, FL, USA",
        lat:       26.1224,
        lon:       -80.1373,
        heading:   90,
        pitch:     -10,
        youtubeId: "YWs0HMRVCBY",
        type:      "COASTAL",
    },
]

const WS_URL = "ws://localhost:8765"

const CLASS_EMOJI = {
    person:     "👤",
    bicycle:    "🚲",
    car:        "🚗",
    motorcycle: "🏍️",
    bus:        "🚌",
    train:      "🚆",
    truck:      "🚚",
    dog:        "🐕",
    backpack:   "🎒",
}

function summarizeDetections(boxes) {
    if (!boxes || !boxes.length) return "No detections"
    const counts = {}
    boxes.forEach(b => { counts[b.class] = (counts[b.class] || 0) + 1 })
    return Object.entries(counts)
        .map(([cls, n]) => `${CLASS_EMOJI[cls] || "•"} ${n} ${cls}${n !== 1 ? "s" : ""}`)
        .join("   ")
}

const FONT       = '"IBM Plex Mono", monospace'
const ACCENT     = "#4A90D9"
const PANEL_BG   = "rgba(10,10,20,0.92)"
const TEXT_COLOR = "#E0E0E0"
const BORDER     = `1px solid ${ACCENT}`

const LABEL_ALTITUDE_THRESHOLD = 5_000_000

const COMPASS_POINTS = [
    { dir: "N",  arrow: "↑" },
    { dir: "NE", arrow: "↗" },
    { dir: "E",  arrow: "→" },
    { dir: "SE", arrow: "↘" },
    { dir: "S",  arrow: "↓" },
    { dir: "SW", arrow: "↙" },
    { dir: "W",  arrow: "←" },
    { dir: "NW", arrow: "↖" },
]

function headingToCompass(deg) {
    const norm = ((deg % 360) + 360) % 360
    const idx  = Math.round(norm / 45) % 8
    const { dir, arrow } = COMPASS_POINTS[idx]
    return `${arrow} ${dir}`
}

function buildCameraIcon(hover) {
    const border = hover ? "#FFFFFF" : ACCENT
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="16" viewBox="0 0 20 16">`
        + `<rect x="1" y="1" width="18" height="14" rx="2" ry="2" fill="#1A1A2E" stroke="${border}" stroke-width="2"/>`
        + `<circle cx="9" cy="8" r="3" fill="#FFFFFF"/>`
        + `<circle cx="16" cy="3.5" r="1.5" fill="#FF3333"/>`
        + `</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const ICON_DEFAULT = buildCameraIcon(false)
const ICON_HOVER   = buildCameraIcon(true)

function RecDot({ size = 6 }) {
    return (
        <span style={{
            display:      "inline-block",
            width:        size,
            height:       size,
            borderRadius: "50%",
            background:   "#FF3333",
            animation:    "gcl-rec-pulse 1.5s ease-in-out infinite",
        }} />
    )
}

function TypeBadge({ type }) {
    return (
        <span style={{
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: "0.08em",
            color:         ACCENT,
            border:        `1px solid ${ACCENT}`,
            padding:       "1px 6px",
            textTransform: "uppercase",
        }}>
            {type}
        </span>
    )
}

function DetectionOverlay({ boxes, isFullscreen }) {
    const canvasRef = useRef(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        boxes.forEach(box => {
            const x = box.x1 * canvas.width
            const y = box.y1 * canvas.height
            const w = (box.x2 - box.x1) * canvas.width
            const h = (box.y2 - box.y1) * canvas.height

            ctx.strokeStyle = box.color
            ctx.lineWidth = 2
            ctx.strokeRect(x, y, w, h)

            const label = `${box.class} ${Math.round(box.conf * 100)}%`
            ctx.font = '11px "IBM Plex Mono", monospace'
            const textW = ctx.measureText(label).width
            ctx.fillStyle = box.color
            ctx.fillRect(x, y - 18, textW + 8, 18)

            ctx.fillStyle = "#000000"
            ctx.fillText(label, x + 4, y - 4)
        })
    }, [boxes])

    return (
        <canvas
            ref={canvasRef}
            width={isFullscreen ? window.innerWidth * 0.7 : 360}
            height={isFullscreen ? window.innerHeight * 0.7 : 240}
            style={{
                position:      "absolute",
                top:           0,
                left:          0,
                width:         "100%",
                height:        "100%",
                pointerEvents: "none",
                zIndex:        10,
            }}
        />
    )
}

export default function GlobeCameraLayer() {
    const { viewer } = useCesium()

    const [hoveredId,    setHoveredId]    = useState(null)
    const [popup,        setPopup]        = useState(null) // { camera }
    const [popupPos,     setPopupPos]     = useState({ x: 0, y: 0 })
    const [fullscreen,   setFullscreen]   = useState(false)
    const [labelsVisible, setLabelsVisible] = useState(false)

    const wsRef = useRef(null)
    const [detections,  setDetections]  = useState({}) // cam_id -> boxes[]
    const [wsConnected, setWsConnected] = useState(false)

    const camerasById = useMemo(() => new Map(CAMERAS.map(c => [c.id, c])), [])

    // ── Connect to local CCTV detection server ──────────────────────────────
    useEffect(() => {
        const ws = new WebSocket(WS_URL)
        ws.onopen  = () => setWsConnected(true)
        ws.onclose = () => setWsConnected(false)
        ws.onerror = () => {
            console.log("[CCTV] Detection server not running")
            setWsConnected(false)
        }
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data)
            setDetections(prev => ({ ...prev, [data.cam_id]: data.boxes }))
        }
        wsRef.current = ws
        return () => ws.close()
    }, [])

    // ── Toggle name labels based on viewer camera altitude ─────────────────
    useEffect(() => {
        if (!viewer) return
        const update = () => {
            const h = viewer.camera.positionCartographic?.height ?? Infinity
            const visible = h <= LABEL_ALTITUDE_THRESHOLD
            setLabelsVisible(v => (v === visible ? v : visible))
        }
        update()
        viewer.scene.postRender.addEventListener(update)
        return () => viewer.scene.postRender.removeEventListener(update)
    }, [viewer])

    // ── Hover tooltip + click popup via scene picking ───────────────────────
    useEffect(() => {
        if (!viewer) return
        const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

        handler.setInputAction((move) => {
            const picked = viewer.scene.pick(move.endPosition)
            const id = defined(picked) && picked.id ? picked.id.id : null
            if (typeof id === "string" && id.startsWith("camera-")) {
                const cam = camerasById.get(id.slice("camera-".length))
                if (cam) {
                    setHoveredId(cam.id)
                    // §6 — the one shared #maptip, not a card of our own.
                    // Cesium gives canvas-relative coords; the shared tip
                    // places against the viewport.
                    const rc = viewer.scene.canvas.getBoundingClientRect()
                    showTip(
                        <>
                            <b>{cam.name}</b>
                            <span className="lbl">{cam.location}</span>
                            <span className="lbl">Click to view</span>
                        </>,
                        rc.left + move.endPosition.x,
                        rc.top + move.endPosition.y,
                    )
                    return
                }
            }
            setHoveredId(null)
            hideTip()
        }, ScreenSpaceEventType.MOUSE_MOVE)

        handler.setInputAction((click) => {
            const picked = viewer.scene.pick(click.position)
            const id = defined(picked) && picked.id ? picked.id.id : null
            if (typeof id === "string" && id.startsWith("camera-")) {
                const cam = camerasById.get(id.slice("camera-".length))
                if (cam) {
                    hideTip()
                    setPopup({ camera: cam })
                }
            }
        }, ScreenSpaceEventType.LEFT_CLICK)

        return () => handler.destroy()
    }, [viewer, camerasById])

    // ── Track popup anchor position on screen as camera moves ──────────────
    useEffect(() => {
        if (!popup || !viewer) return
        const update = () => {
            const pos = Cartesian3.fromDegrees(popup.camera.lon, popup.camera.lat, 0)
            const sp  = SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
            if (sp) setPopupPos({ x: sp.x, y: sp.y })
        }
        update()
        viewer.scene.postRender.addEventListener(update)
        return () => viewer.scene.postRender.removeEventListener(update)
    }, [popup, viewer])

    // ── ESC exits fullscreen (not close) ────────────────────────────────────
    useEffect(() => {
        if (!fullscreen) return
        const onKey = (e) => { if (e.key === "Escape") setFullscreen(false) }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [fullscreen])

    const closePopup = () => { setPopup(null); setFullscreen(false) }

    const canvas = viewer?.scene?.canvas
    const rect   = canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 }


    let popupStyle = null
    if (popup) {
        if (fullscreen) {
            popupStyle = {
                width:  "70vw",
                height: "70vh",
                left:   "15vw",
                top:    "15vh",
            }
        } else {
            const W = 360, H = 240
            const left = Math.min(Math.max(rect.left + popupPos.x + 16, 8), (window.innerWidth || 1200) - W - 8)
            const top  = Math.min(Math.max(rect.top + popupPos.y - H / 2, 8), (window.innerHeight || 800) - H - 8)
            popupStyle = { width: W, height: H, left, top }
        }
    }

    return (
        <>
            {CAMERAS.map(cam => (
                <Entity
                    key={cam.id}
                    id={`camera-${cam.id}`}
                    position={Cartesian3.fromDegrees(cam.lon, cam.lat, 0)}
                    billboard={{
                        image:           hoveredId === cam.id ? ICON_HOVER : ICON_DEFAULT,
                        width:           20,
                        height:          16,
                        verticalOrigin:  VerticalOrigin.BOTTOM,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        scaleByDistance: new NearFarScalar(1.0e3, 1.0, 1.0e7, 0.5),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    }}
                    label={labelsVisible ? {
                        text:            cam.name,
                        font:            `11px ${FONT}`,
                        fillColor:       Color.fromCssColorString(TEXT_COLOR),
                        outlineColor:    Color.fromCssColorString("#0A0A14"),
                        outlineWidth:    2,
                        style:           LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin:  VerticalOrigin.TOP,
                        pixelOffset:     new Cartesian2(0, 4),
                        showBackground:  true,
                        backgroundColor: Color.fromCssColorString("#0A0A14").withAlpha(0.7),
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    } : undefined}
                />
            ))}

            {createPortal(
                <>
                    <style>{`
                        @keyframes gcl-rec-pulse {
                            0%, 100% { opacity: 1; }
                            50%      { opacity: 0.25; }
                        }
                    `}</style>


                    {popup && (
                        <>
                            {fullscreen && (
                                <div
                                    onClick={() => setFullscreen(false)}
                                    style={{
                                        position:   "fixed",
                                        inset:      0,
                                        background: "rgba(0,0,0,0.7)",
                                        zIndex:     10019,
                                    }}
                                />
                            )}
                            <div style={{
                                position:      "fixed",
                                left:          popupStyle.left,
                                top:           popupStyle.top,
                                width:         popupStyle.width,
                                height:        popupStyle.height,
                                zIndex:        10020,
                                background:    PANEL_BG,
                                border:        BORDER,
                                borderRadius:  0,
                                fontFamily:    FONT,
                                color:         TEXT_COLOR,
                                display:       "flex",
                                flexDirection: "column",
                                overflow:      "hidden",
                            }}>
                                {/* Header */}
                                <div style={{
                                    flexShrink:     0,
                                    display:        "flex",
                                    alignItems:     "center",
                                    justifyContent: "space-between",
                                    padding:        "6px 10px",
                                    borderBottom:   BORDER,
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                                        <RecDot />
                                        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {popup.camera.name}
                                        </span>
                                        <TypeBadge type={popup.camera.type} />
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                        <button
                                            onClick={() => setFullscreen(v => !v)}
                                            title={fullscreen ? "Exit fullscreen" : "Expand"}
                                            style={{
                                                background: "transparent",
                                                border:     "none",
                                                color:      ACCENT,
                                                cursor:     "pointer",
                                                fontSize:   14,
                                                padding:    0,
                                                lineHeight: 1,
                                            }}
                                        >⛶</button>
                                        <button
                                            onClick={closePopup}
                                            title="Close"
                                            style={{
                                                background: "transparent",
                                                border:     "none",
                                                color:      ACCENT,
                                                cursor:     "pointer",
                                                fontSize:   14,
                                                padding:    0,
                                                lineHeight: 1,
                                            }}
                                        >✕</button>
                                    </div>
                                </div>

                                {/* Video */}
                                <div style={{ flex: 1, background: "#000", position: "relative" }}>
                                    <iframe
                                        key={popup.camera.id}
                                        src={`https://www.youtube-nocookie.com/embed/${popup.camera.youtubeId}?autoplay=1&mute=0&controls=1`}
                                        title={popup.camera.name}
                                        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                                        allow="autoplay; encrypted-media; fullscreen"
                                        allowFullScreen
                                    />
                                    <DetectionOverlay
                                        boxes={detections[popup.camera.id] || []}
                                        isFullscreen={fullscreen}
                                    />
                                </div>

                                {/* Detection status bar */}
                                <div style={{
                                    flexShrink:     0,
                                    display:        "flex",
                                    alignItems:     "center",
                                    justifyContent: "space-between",
                                    padding:        "4px 10px",
                                    borderTop:      BORDER,
                                    fontSize:       10,
                                }}>
                                    <span style={{ color: TEXT_COLOR }}>
                                        {summarizeDetections(detections[popup.camera.id])}
                                    </span>
                                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: wsConnected ? "#4CFF6E" : "#666" }}>
                                        <span style={{
                                            display:      "inline-block",
                                            width:        6,
                                            height:       6,
                                            borderRadius: "50%",
                                            background:   wsConnected ? "#4CFF6E" : "#666",
                                            animation:    wsConnected ? "gcl-rec-pulse 1.5s ease-in-out infinite" : "none",
                                        }} />
                                        {wsConnected ? "LIVE DETECTION" : "DETECTION OFFLINE"}
                                    </span>
                                </div>

                                {/* Footer */}
                                <div style={{
                                    flexShrink:     0,
                                    display:        "flex",
                                    alignItems:     "center",
                                    justifyContent: "space-between",
                                    padding:        "5px 10px",
                                    borderTop:      BORDER,
                                    fontSize:       10,
                                }}>
                                    <span style={{ color: ACCENT }}>
                                        {headingToCompass(popup.camera.heading)} · {popup.camera.heading}°
                                    </span>
                                    <span style={{ color: "#9AA4B5" }}>
                                        Pitch {popup.camera.pitch}°
                                    </span>
                                </div>
                            </div>
                        </>
                    )}
                </>,
                document.body
            )}
        </>
    )
}

export { headingToCompass }
