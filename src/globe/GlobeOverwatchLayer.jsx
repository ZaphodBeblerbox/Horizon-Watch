// Overwatch detection layer — polygon outlines from YOLO OBB corners + Sentinel imagery overlay

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Cartesian3, Rectangle, Color, HeightReference,
    SingleTileImageryProvider, ColorMaterialProperty,
    ClassificationType,
} from "cesium"

const CATEGORY_COLORS = {
    Aircraft:  "#5856D6",
    Vessel:    "#34AADC",
    Ship:      "#34AADC",
    Vehicle:   "#FF9500",
    Building:  "#FF9500",
    Military:  "#FF3B30",
    default:   "#FFCC00",
}

function colorForDet(det) {
    return CATEGORY_COLORS[det.category] || CATEGORY_COLORS.default
}

export default function GlobeOverwatchLayer({ enabled, detections = [], sentinelOverlay = null }) {
    const { viewer } = useCesium()
    const entitiesRef     = useRef([])
    const sentinelLayerRef = useRef(null)
    const sentinelUrlRef   = useRef(null)

    // ── Sentinel imagery overlay ──────────────────────────────────────────────
    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return

        if (sentinelUrlRef.current) {
            URL.revokeObjectURL(sentinelUrlRef.current)
            sentinelUrlRef.current = null
        }
        if (sentinelLayerRef.current) {
            try { viewer.imageryLayers.remove(sentinelLayerRef.current, true) } catch (_) {}
            sentinelLayerRef.current = null
        }

        if (!sentinelOverlay?.image_b64 || !sentinelOverlay?.bounds) return

        let cancelled = false

        try {
            const { image_b64, bounds } = sentinelOverlay
            const byteChars = atob(image_b64)
            const byteNums  = new Uint8Array(byteChars.length)
            for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i)
            const blob = new Blob([byteNums], { type: "image/png" })
            const url  = URL.createObjectURL(blob)
            sentinelUrlRef.current = url

            // Cesium 1.109+ removed the sync constructor — must use static fromUrl()
            SingleTileImageryProvider.fromUrl(url, {
                rectangle: Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
            }).then(provider => {
                if (cancelled || viewer.isDestroyed()) return
                const layer = viewer.imageryLayers.addImageryProvider(provider)
                layer.alpha = 1.0
                sentinelLayerRef.current = layer
                console.log("[overwatch] Sentinel overlay rendered")
            }).catch(e => {
                console.error("[overwatch] Sentinel overlay failed:", e)
            })
        } catch (e) {
            console.error("[overwatch] Sentinel decode failed:", e)
        }

        return () => {
            cancelled = true
            if (sentinelLayerRef.current) {
                try { viewer.imageryLayers.remove(sentinelLayerRef.current, true) } catch (_) {}
                sentinelLayerRef.current = null
            }
            if (sentinelUrlRef.current) {
                URL.revokeObjectURL(sentinelUrlRef.current)
                sentinelUrlRef.current = null
            }
        }
    }, [viewer, sentinelOverlay])

    // ── Detection entities ────────────────────────────────────────────────────
    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            entitiesRef.current.forEach(e => {
                if (viewer.entities.contains(e)) viewer.entities.remove(e)
            })
            entitiesRef.current = []
        }

        cleanup()
        if (!enabled || !detections?.length) return

        const added = []

        for (const det of detections) {
            const hex   = colorForDet(det)
            const color = Color.fromCssColorString(hex)

            if (det.corners && det.corners.length >= 3) {
                // Rotated polygon outline from YOLO OBB corners [[lat,lon],...]
                const positions = det.corners.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat))
                positions.push(positions[0])  // close

                added.push(viewer.entities.add({
                    id: `ow-poly-${Math.random()}`,
                    polyline: {
                        positions,
                        width: 2,
                        material: new ColorMaterialProperty(color.withAlpha(0.9)),
                        clampToGround: true,
                        classificationType: ClassificationType.TERRAIN,
                    },
                }))
            } else if (det.bbox_geo) {
                // Axis-aligned rectangle fallback from [W,S,E,N]
                const [W, S, E, N] = det.bbox_geo
                const corners = [
                    Cartesian3.fromDegrees(W, S),
                    Cartesian3.fromDegrees(E, S),
                    Cartesian3.fromDegrees(E, N),
                    Cartesian3.fromDegrees(W, N),
                    Cartesian3.fromDegrees(W, S),
                ]
                added.push(viewer.entities.add({
                    id: `ow-rect-${Math.random()}`,
                    polyline: {
                        positions: corners,
                        width: 2,
                        material: new ColorMaterialProperty(color.withAlpha(0.9)),
                        clampToGround: true,
                        classificationType: ClassificationType.TERRAIN,
                    },
                }))
            } else {
                // Try polygon / NSEW bounds as last resort
                let west, south, east, north
                if (det.polygon?.length >= 3) {
                    const lats = det.polygon.map(v => v[0])
                    const lons = det.polygon.map(v => v[1])
                    south = Math.min(...lats); north = Math.max(...lats)
                    west  = Math.min(...lons); east  = Math.max(...lons)
                } else if (det.north != null) {
                    north = det.north; south = det.south; east = det.east; west = det.west
                } else {
                    continue
                }
                const pts = [
                    Cartesian3.fromDegrees(west, south),
                    Cartesian3.fromDegrees(east, south),
                    Cartesian3.fromDegrees(east, north),
                    Cartesian3.fromDegrees(west, north),
                    Cartesian3.fromDegrees(west, south),
                ]
                added.push(viewer.entities.add({
                    id: `ow-bounds-${Math.random()}`,
                    polyline: {
                        positions: pts,
                        width: 2,
                        material: new ColorMaterialProperty(color.withAlpha(0.9)),
                        clampToGround: true,
                        classificationType: ClassificationType.TERRAIN,
                    },
                }))
            }

            // Center dot for click targeting
            if (det.center?.length === 2) {
                const [clat, clon] = det.center
                added.push(viewer.entities.add({
                    id: `ow-dot-${Math.random()}`,
                    position: Cartesian3.fromDegrees(clon, clat),
                    point: {
                        pixelSize: 6,
                        color,
                        outlineColor: Color.WHITE,
                        outlineWidth: 1,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    },
                }))
            }
        }

        entitiesRef.current = added
        return cleanup
    }, [viewer, enabled, detections])

    return null
}
