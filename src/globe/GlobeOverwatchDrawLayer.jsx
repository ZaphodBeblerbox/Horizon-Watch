/**
 * GlobeOverwatchDrawLayer — rectangle or polygon selection on the Cesium globe.
 *
 * Rectangle mode: two clicks define opposite corners, fires onBounds({north,south,east,west}).
 * Polygon mode: click to add vertices, double-click to close. Fires
 * onPolygon({vertices:[[lat,lon],...], bounds:{north,south,east,west}}).
 *
 * Cursor is crosshair only while a draw is in progress (first click → completion/cancel).
 */

import { useEffect, useRef, useState } from "react"
import { useCesium } from "resium"
import { maxOf, minOf } from "../utils/extent.js"
import {
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    Cartographic,
    Math as CesiumMath,
    Color,
    CallbackProperty,
    Rectangle,
    Cartesian3,
    ColorMaterialProperty,
    ClassificationType,
} from "cesium"

export default function GlobeOverwatchDrawLayer({
    active,
    drawMode = "rectangle",
    onBounds,
    onPolygon,
}) {
    const { viewer } = useCesium()
    const handlerRef      = useRef(null)
    const firstPointRef   = useRef(null)
    const previewRef      = useRef(null)
    const finalEntityRef  = useRef(null)
    const polyVerticesRef = useRef([])
    const polyEntitiesRef = useRef([])
    const cornersRef      = useRef({ a: null, b: null })

    const [isDrawing, setIsDrawing] = useState(false)

    // ── Cursor: crosshair from the moment drawing is ARMED ───────────────────
    // It used to appear only after the first click, so between choosing
    // "draw an area" and clicking there was nothing to say the map was
    // listening — the pointer looked exactly as it does when a click pans
    // the globe. The confirmation has to start when the mode does.
    useEffect(() => {
        const canvas = viewer?.scene?.canvas
        if (!canvas) return
        canvas.style.cursor = (active || isDrawing) ? "crosshair" : "default"
        return () => { if (canvas) canvas.style.cursor = "default" }
    }, [active, isDrawing, viewer])

    function _clearAllEntities() {
        if (!viewer || viewer.isDestroyed()) return
        ;[previewRef, finalEntityRef].forEach(r => {
            if (r.current) {
                try { viewer.entities.remove(r.current) } catch (_) {}
                r.current = null
            }
        })
        polyEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_) {} })
        polyEntitiesRef.current = []
        polyVerticesRef.current = []
    }

    function _pickLatLng(windowPos) {
        if (!viewer) return null
        const cart = viewer.camera.pickEllipsoid(windowPos)
        if (!cart) return null
        const carto = Cartographic.fromCartesian(cart)
        return {
            lat: CesiumMath.toDegrees(carto.latitude),
            lng: CesiumMath.toDegrees(carto.longitude),
        }
    }

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return

        if (!active) {
            if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null }
            _clearAllEntities()
            firstPointRef.current = null
            setIsDrawing(false)
            return
        }

        // Reset draw state when mode changes or panel opens
        const corners = cornersRef.current
        corners.a = null
        corners.b = null
        firstPointRef.current = null
        polyVerticesRef.current = []
        setIsDrawing(false)

        // Live preview rectangle (only visible in rectangle mode)
        const previewColor = Color.fromCssColorString("#22d3ee")
        const previewEntity = viewer.entities.add({
            rectangle: {
                coordinates: new CallbackProperty(() => {
                    if (!corners.a || !corners.b || drawMode !== "rectangle") return null
                    return Rectangle.fromDegrees(
                        Math.min(corners.a.lng, corners.b.lng),
                        Math.min(corners.a.lat, corners.b.lat),
                        Math.max(corners.a.lng, corners.b.lng),
                        Math.max(corners.a.lat, corners.b.lat),
                    )
                }, false),
                material:     previewColor.withAlpha(0.08),
                outline:      true,
                outlineColor: previewColor.withAlpha(0.75),
                outlineWidth: 2,
                height:       0,
            },
        })
        previewRef.current = previewEntity

        const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
        handlerRef.current = handler

        // ── Mouse move: update rectangle preview ──────────────────────────────
        handler.setInputAction((move) => {
            if (drawMode === "rectangle" && firstPointRef.current) {
                const pt = _pickLatLng(move.endPosition)
                if (pt) corners.b = pt
            }
        }, ScreenSpaceEventType.MOUSE_MOVE)

        // ── Left click: add point ─────────────────────────────────────────────
        handler.setInputAction((click) => {
            const pt = _pickLatLng(click.position)
            if (!pt) return

            if (drawMode === "rectangle") {
                if (!firstPointRef.current) {
                    firstPointRef.current = pt
                    corners.a = pt
                    corners.b = pt
                    setIsDrawing(true)
                } else {
                    const a = firstPointRef.current
                    const bounds = {
                        north: Math.max(a.lat, pt.lat),
                        south: Math.min(a.lat, pt.lat),
                        east:  Math.max(a.lng, pt.lng),
                        west:  Math.min(a.lng, pt.lng),
                    }
                    try { viewer.entities.remove(previewEntity) } catch (_) {}
                    previewRef.current = null
                    if (finalEntityRef.current) {
                        try { viewer.entities.remove(finalEntityRef.current) } catch (_) {}
                    }
                    const cyan = Color.fromCssColorString("#22d3ee")
                    finalEntityRef.current = viewer.entities.add({
                        rectangle: {
                            coordinates: Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
                            material:     cyan.withAlpha(0.12),
                            outline:      true,
                            outlineColor: cyan.withAlpha(0.9),
                            outlineWidth: 2,
                            height:       0,
                        },
                    })
                    firstPointRef.current = null
                    corners.a = null
                    corners.b = null
                    setIsDrawing(false)
                    if (onBounds) onBounds(bounds)
                }
            } else if (drawMode === "polygon") {
                const newVerts = [...polyVerticesRef.current, [pt.lat, pt.lng]]
                polyVerticesRef.current = newVerts
                if (newVerts.length === 1) setIsDrawing(true)

                const dot = viewer.entities.add({
                    position: Cartesian3.fromDegrees(pt.lng, pt.lat),
                    point: {
                        pixelSize: 8,
                        color: Color.CYAN,
                        outlineColor: Color.WHITE,
                        outlineWidth: 1,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                })
                polyEntitiesRef.current.push(dot)

                if (newVerts.length >= 2) {
                    const prev = newVerts[newVerts.length - 2]
                    const line = viewer.entities.add({
                        polyline: {
                            positions: [
                                Cartesian3.fromDegrees(prev[1], prev[0]),
                                Cartesian3.fromDegrees(pt.lng, pt.lat),
                            ],
                            width: 2,
                            material: new ColorMaterialProperty(Color.CYAN.withAlpha(0.8)),
                            clampToGround: true,
                            classificationType: ClassificationType.TERRAIN,
                        },
                    })
                    polyEntitiesRef.current.push(line)
                }
            }
        }, ScreenSpaceEventType.LEFT_CLICK)

        // ── Double click: close polygon ───────────────────────────────────────
        handler.setInputAction(() => {
            if (drawMode !== "polygon") return
            const verts = polyVerticesRef.current.slice(0, -1)
            if (verts.length < 3) return

            const lats = verts.map(v => v[0])
            const lons = verts.map(v => v[1])
            const bounds = {
                // Spread-free: see utils/extent.js. A drawn shape is
                // usually small, but a pasted or imported geometry is
                // not, and this is the cheap way to never find out.
                north: maxOf(lats), south: minOf(lats),
                east:  maxOf(lons), west:  minOf(lons),
            }

            polyEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_) {} })
            polyEntitiesRef.current = []
            polyVerticesRef.current = []

            if (finalEntityRef.current) {
                try { viewer.entities.remove(finalEntityRef.current) } catch (_) {}
            }
            const positions = verts.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat))
            positions.push(positions[0])
            finalEntityRef.current = viewer.entities.add({
                polyline: {
                    positions,
                    width: 2,
                    material: new ColorMaterialProperty(Color.CYAN.withAlpha(0.9)),
                    clampToGround: true,
                    classificationType: ClassificationType.TERRAIN,
                },
            })

            setIsDrawing(false)
            if (onPolygon) onPolygon({ vertices: verts, bounds })
        }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

        // ── Right click: cancel ───────────────────────────────────────────────
        handler.setInputAction(() => {
            firstPointRef.current = null
            corners.a = null
            corners.b = null
            polyEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_) {} })
            polyEntitiesRef.current = []
            polyVerticesRef.current = []
            setIsDrawing(false)
        }, ScreenSpaceEventType.RIGHT_CLICK)

        return () => {
            if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null }
        }
    }, [viewer, active, drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        return () => _clearAllEntities()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
