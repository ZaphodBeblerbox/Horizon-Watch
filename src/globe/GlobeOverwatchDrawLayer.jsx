/**
 * GlobeOverwatchDrawLayer — rectangle or polygon selection on the Cesium globe.
 *
 * Rectangle mode: two clicks define opposite corners, fires onBounds({north,south,east,west}).
 * After a rectangle is confirmed the handler resets and waits for the next draw.
 *
 * Polygon mode: click to add vertices, double-click to close. Fires
 * onPolygon({vertices:[[lat,lon],...], bounds:{north,south,east,west}}).
 */

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
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
    // Shared mutable corners for the CallbackProperty preview rectangle
    const cornersRef      = useRef({ a: null, b: null })

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
            viewer.canvas.style.cursor = ""
            return
        }

        viewer.canvas.style.cursor = "crosshair"

        // Reset rectangle draw state
        const corners = cornersRef.current
        corners.a = null
        corners.b = null
        firstPointRef.current = null
        polyVerticesRef.current = []

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
                } else {
                    const a = firstPointRef.current
                    const bounds = {
                        north: Math.max(a.lat, pt.lat),
                        south: Math.min(a.lat, pt.lat),
                        east:  Math.max(a.lng, pt.lng),
                        west:  Math.min(a.lng, pt.lng),
                    }
                    // Swap live preview for confirmed rectangle
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
                    // Reset for next draw without destroying the handler
                    firstPointRef.current = null
                    corners.a = null
                    corners.b = null
                    if (onBounds) onBounds(bounds)
                }
            } else if (drawMode === "polygon") {
                const newVerts = [...polyVerticesRef.current, [pt.lat, pt.lng]]
                polyVerticesRef.current = newVerts

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
            // The preceding LEFT_CLICK already added a duplicate vertex — strip it
            const verts = polyVerticesRef.current.slice(0, -1)
            if (verts.length < 3) return

            const lats = verts.map(v => v[0])
            const lons = verts.map(v => v[1])
            const bounds = {
                north: Math.max(...lats),
                south: Math.min(...lats),
                east:  Math.max(...lons),
                west:  Math.min(...lons),
            }

            // Clear intermediate dot/line entities
            polyEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_) {} })
            polyEntitiesRef.current = []
            polyVerticesRef.current = []

            // Draw final closed polygon
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
        }, ScreenSpaceEventType.RIGHT_CLICK)

        return () => {
            if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null }
            viewer.canvas.style.cursor = ""
        }
    }, [viewer, active, drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        return () => _clearAllEntities()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
