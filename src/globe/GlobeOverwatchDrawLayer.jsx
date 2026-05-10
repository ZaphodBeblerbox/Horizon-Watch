/**
 * GlobeOverwatchDrawLayer — two-click rectangle selection on the Cesium globe.
 *
 * When `active` is true, captures two LEFT_CLICK positions on the ellipsoid,
 * draws a live preview rectangle while the user picks the second corner, then
 * fires `onBounds({ north, south, east, west })` with the final selection.
 *
 * The rectangle entity is scene-local and removed when `active` becomes false
 * or when a new selection is started.
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
    PolylineDashMaterialProperty,
    Cartesian3,
} from "cesium"

export default function GlobeOverwatchDrawLayer({ active, onBounds }) {
    const { viewer } = useCesium()
    const handlerRef      = useRef(null)
    const firstPointRef   = useRef(null)
    const previewRef      = useRef(null)   // { outline, fill } entity refs
    const finalEntityRef  = useRef(null)   // confirmed rectangle entity

    // Clear all drawn entities
    function _clearEntities() {
        if (viewer && !viewer.isDestroyed()) {
            if (previewRef.current) {
                try { viewer.entities.remove(previewRef.current) } catch (_) {}
                previewRef.current = null
            }
            if (finalEntityRef.current) {
                try { viewer.entities.remove(finalEntityRef.current) } catch (_) {}
                finalEntityRef.current = null
            }
        }
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

        // Tear down on deactivation
        if (!active) {
            if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null }
            _clearEntities()
            firstPointRef.current = null
            // Restore cursor
            viewer.canvas.style.cursor = ""
            return
        }

        viewer.canvas.style.cursor = "crosshair"

        // Shared mutable corner refs used by CallbackProperty for live preview
        const corners = { a: null, b: null }

        // Live preview rectangle — redrawn via CallbackProperty each frame
        const previewColor = Color.fromCssColorString("#22d3ee")

        const previewEntity = viewer.entities.add({
            rectangle: {
                coordinates: new CallbackProperty(() => {
                    if (!corners.a || !corners.b) return null
                    return Rectangle.fromDegrees(
                        Math.min(corners.a.lng, corners.b.lng),
                        Math.min(corners.a.lat, corners.b.lat),
                        Math.max(corners.a.lng, corners.b.lng),
                        Math.max(corners.a.lat, corners.b.lat),
                    )
                }, false),
                material:      previewColor.withAlpha(0.08),
                outline:       true,
                outlineColor:  previewColor.withAlpha(0.75),
                outlineWidth:  2,
                height:        0,
            },
        })
        previewRef.current = previewEntity

        const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
        handlerRef.current = handler

        // Track mouse for live preview after first click
        handler.setInputAction((move) => {
            if (!firstPointRef.current) return
            const pt = _pickLatLng(move.endPosition)
            if (pt) corners.b = pt
        }, ScreenSpaceEventType.MOUSE_MOVE)

        handler.setInputAction((click) => {
            const pt = _pickLatLng(click.position)
            if (!pt) return

            if (!firstPointRef.current) {
                // First click — set anchor corner
                firstPointRef.current = pt
                corners.a = pt
                corners.b = pt
            } else {
                // Second click — finalise selection
                const a = firstPointRef.current
                const bounds = {
                    north: Math.max(a.lat, pt.lat),
                    south: Math.min(a.lat, pt.lat),
                    east:  Math.max(a.lng, pt.lng),
                    west:  Math.min(a.lng, pt.lng),
                }

                // Replace live preview with a solid confirmed rectangle
                viewer.entities.remove(previewEntity)
                previewRef.current = null

                const cyan = Color.fromCssColorString("#22d3ee")
                finalEntityRef.current = viewer.entities.add({
                    rectangle: {
                        coordinates: Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
                        material:    cyan.withAlpha(0.12),
                        outline:     true,
                        outlineColor: cyan.withAlpha(0.9),
                        outlineWidth: 2,
                        height:      0,
                    },
                })

                // Tear down handler — one selection per activation
                handler.destroy()
                handlerRef.current = null
                firstPointRef.current = null
                viewer.canvas.style.cursor = ""

                if (onBounds) onBounds(bounds)
            }
        }, ScreenSpaceEventType.LEFT_CLICK)

        // RIGHT_CLICK cancels
        handler.setInputAction(() => {
            handler.destroy()
            handlerRef.current = null
            firstPointRef.current = null
            corners.a = null
            corners.b = null
            viewer.canvas.style.cursor = ""
        }, ScreenSpaceEventType.RIGHT_CLICK)

        return () => {
            if (handlerRef.current) { handlerRef.current.destroy(); handlerRef.current = null }
            viewer.canvas.style.cursor = ""
        }
    }, [viewer, active]) // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup final entity when component unmounts
    useEffect(() => {
        return () => _clearEntities()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
