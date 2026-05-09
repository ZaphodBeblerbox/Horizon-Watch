import { useState, useEffect, useRef } from "react"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType,
    defined, SceneTransforms,
    Cartographic, Math as CesiumMath,
} from "cesium"
import { getEntity } from "./entityStore.js"
import GlobeAircraftPopup from "./GlobeAircraftPopup.jsx"
import GlobeVesselPopup   from "./GlobeVesselPopup.jsx"
import GlobeEventPopup    from "./GlobeEventPopup.jsx"
import GlobeEEZPopup      from "./GlobeEEZPopup.jsx"
import GlobeCablePopup    from "./GlobeCablePopup.jsx"
import GlobeInfraPopup    from "./GlobeInfraPopup.jsx"
import GlobeHeatmapPopup  from "./GlobeHeatmapPopup.jsx"
import API_BASE           from "../apiBase.js"

const HOVER_TYPES = new Set(["eez", "cable"])

function buildOverpassQuery(lat, lon, radius) {
    return `[out:json][timeout:8];(way["power"](around:${radius},${lat},${lon});way["man_made"="pipeline"](around:${radius},${lat},${lon});node["power"~"substation|transformer"](around:${radius},${lat},${lon});way["telecom"](around:${radius},${lat},${lon}););out body 5;`
}

export default function GlobePopup({ viewerRef, infraEnabled = false }) {
    const [popup,   setPopup]   = useState(null)
    const [tooltip, setTooltip] = useState(null)  // { name, x, y }
    const handlerRef = useRef(null)

    useEffect(() => {
        let attempts = 0
        function tryMount() {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryMount, 200)
                return
            }

            const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

            // ── Hover tooltip ────────────────────────────────────────────────
            handler.setInputAction((move) => {
                const picked = viewer.scene.pick(move.endPosition)
                if (defined(picked) && picked.id) {
                    const stored = getEntity(picked.id.id)
                    if (stored && HOVER_TYPES.has(stored.type)) {
                        setTooltip({
                            name: stored.data.name || stored.data.eez1 || "",
                            x:    move.endPosition.x,
                            y:    move.endPosition.y,
                        })
                        return
                    }
                }
                setTooltip(null)
            }, ScreenSpaceEventType.MOUSE_MOVE)

            // ── Click popup ──────────────────────────────────────────────────
            handler.setInputAction(async (click) => {
                setTooltip(null)

                // Primary pick; if it misses, search a ring of nearby pixels
                // to handle fat-finger taps on mobile 3D models.
                let picked = viewer.scene.pick(click.position)
                if (!defined(picked) || !picked.id) {
                    const ring = [
                        [-14, 0], [14, 0], [0, -14], [0, 14],
                        [-10, -10], [10, -10], [-10, 10], [10, 10],
                        [-14, -7], [14, -7], [-14, 7], [14, 7],
                    ]
                    for (const [dx, dy] of ring) {
                        const p = new Cartesian2(click.position.x + dx, click.position.y + dy)
                        const c = viewer.scene.pick(p)
                        if (defined(c) && c.id) { picked = c; break }
                    }
                }

                if (defined(picked) && picked.id) {
                    const entity   = picked.id
                    const entityId = entity.id
                    const pos = entity.position?.getValue(viewer.clock.currentTime)
                    const sp  = pos ? SceneTransforms.worldToWindowCoordinates(viewer.scene, pos) : null
                    const x   = sp ? sp.x : click.position.x
                    const y   = sp ? sp.y : click.position.y

                    const stored = getEntity(entityId)
                    if (stored) {
                        setPopup({ type: stored.type, data: stored.data, x, y, entityId })
                        return
                    }

                    const rawDesc = entity.description
                    if (rawDesc) {
                        const html = typeof rawDesc.getValue === "function"
                            ? rawDesc.getValue(viewer.clock.currentTime)
                            : rawDesc
                        if (html) {
                            setPopup({ type: "html", html, x, y, entityId })
                            return
                        }
                    }
                    setPopup(null)
                    return
                }

                // No entity picked — infra click query if layer is active
                if (!infraEnabled) { setPopup(null); return }

                const cartesian = viewer.camera.pickEllipsoid(click.position)
                if (!cartesian) { setPopup(null); return }

                const carto = Cartographic.fromCartesian(cartesian)
                const lat   = CesiumMath.toDegrees(carto.latitude)
                const lon   = CesiumMath.toDegrees(carto.longitude)
                const x     = click.position.x
                const y     = click.position.y

                setPopup({ type: "infra", data: { loading: true }, x, y, entityId: null })

                try {
                    let q = buildOverpassQuery(lat, lon, 150)
                    let r = await fetch(`${API_BASE}/api/overpass?data=${encodeURIComponent(q)}`)
                    let d = r.ok ? await r.json() : null

                    if (!d?.elements?.length) {
                        q = buildOverpassQuery(lat, lon, 500)
                        r = await fetch(`${API_BASE}/api/overpass?data=${encodeURIComponent(q)}`)
                        d = r.ok ? await r.json() : null
                    }

                    if (d?.elements?.length) {
                        setPopup(p => p ? { ...p, data: { elements: d.elements } } : null)
                    } else {
                        setPopup(p => p ? { ...p, data: { elements: [] } } : null)
                    }
                } catch {
                    setPopup(null)
                }
            }, ScreenSpaceEventType.LEFT_CLICK)

            handlerRef.current = handler
        }
        tryMount()
        return () => { handlerRef.current?.destroy(); handlerRef.current = null }
    }, [viewerRef, infraEnabled])

    // Keep click popup anchored on entity position as camera moves
    useEffect(() => {
        if (!popup?.entityId) return
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (!entity) return

        const update = () => {
            const pos = entity.position?.getValue(viewer.clock.currentTime)
            if (pos) {
                const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
                if (sp) setPopup(p => p ? { ...p, x: sp.x, y: sp.y } : null)
            }
        }
        viewer.scene.postRender.addEventListener(update)
        return () => viewer.scene.postRender.removeEventListener(update)
    }, [popup?.entityId, viewerRef])

    const W = 300
    const handleClose = () => setPopup(null)
    const handleFollow = () => {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const entity = viewer.entities.getById(popup.entityId)
        if (entity) viewer.trackedEntity = entity
        setPopup(null)
    }

    return (
        <>
            {/* Hover tooltip */}
            {tooltip && (
                <div
                    style={{
                        position:      "absolute",
                        left:          Math.min(tooltip.x + 14, (window.innerWidth || 1200) - 220),
                        top:           Math.max(tooltip.y - 36, 56),
                        zIndex:        10001,
                        background:    "rgba(10,14,20,0.92)",
                        border:        "1px solid rgba(255,255,255,0.12)",
                        borderRadius:  5,
                        padding:       "5px 10px",
                        fontSize:      11,
                        color:         "#E2E8F0",
                        pointerEvents: "none",
                        whiteSpace:    "nowrap",
                        maxWidth:      200,
                        overflow:      "hidden",
                        textOverflow:  "ellipsis",
                        boxShadow:     "0 2px 8px rgba(0,0,0,0.5)",
                    }}
                >
                    {tooltip.name}
                </div>
            )}

            {/* Click popup */}
            {popup && (
                <div
                    style={{
                        position:      "absolute",
                        left:          Math.min(popup.x + 14, (window.innerWidth || 1200) - W - 10),
                        top:           Math.max(popup.y - 80, 56),
                        zIndex:        10000,
                        width:         W,
                        maxHeight:     520,
                        overflowY:     "auto",
                        background:    "#0F1721",
                        border:        "1px solid #2C3645",
                        borderRadius:  8,
                        boxShadow:     "0 8px 32px rgba(0,0,0,0.7)",
                        pointerEvents: "auto",
                    }}
                >
                    {popup.type === "aircraft" ? (
                        <GlobeAircraftPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
                    ) : popup.type === "vessel" ? (
                        <GlobeVesselPopup data={popup.data} onClose={handleClose} onFollow={handleFollow} />
                    ) : popup.type === "event" ? (
                        <GlobeEventPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "eez" ? (
                        <GlobeEEZPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "cable" ? (
                        <GlobeCablePopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "infra" ? (
                        <GlobeInfraPopup data={popup.data} onClose={handleClose} />
                    ) : popup.type === "heatmap_cell" ? (
                        <GlobeHeatmapPopup data={popup.data} onClose={handleClose} />
                    ) : (
                        <>
                            <button
                                onClick={handleClose}
                                style={{
                                    position:   "absolute",
                                    top:        6,
                                    right:      8,
                                    background: "transparent",
                                    border:     "none",
                                    color:      "#9AA4B5",
                                    cursor:     "pointer",
                                    fontSize:   18,
                                    lineHeight: 1,
                                    zIndex:     1,
                                    padding:    0,
                                }}
                            >×</button>
                            {/* eslint-disable-next-line react/no-danger */}
                            <div dangerouslySetInnerHTML={{ __html: popup.html }} />
                        </>
                    )}
                </div>
            )}
        </>
    )
}
