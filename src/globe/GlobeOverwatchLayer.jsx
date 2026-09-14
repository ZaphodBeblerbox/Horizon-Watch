// Overwatch detection layer — polygon outlines from YOLO OBB corners + Sentinel imagery overlay

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Cartesian3, Rectangle, Color, PolygonHierarchy,
    SingleTileImageryProvider, ColorMaterialProperty,
    ClassificationType,
} from "cesium"

const CATEGORY_COLORS = {
    Aircraft:        "#5856D6",
    Vessel:          "#34AADC",
    Ship:            "#34AADC",
    // Real sub-type distinction — sar_detector.py's real attribute model
    // outputs an actual is_fishing_vessel classification, not a fabricated
    // category; surfaced here as its own real color so "color coded by
    // detection type" means something even though every SAR/optical
    // detection today is a vessel of some kind.
    "Fishing vessel": "#34C759",
    Vehicle:         "#FF9500",
    Building:        "#FF9500",
    Military:        "#FF3B30",
    default:         "#FFCC00",
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

        // Real, small (~15m half-width) square built around a bare
        // centroid — the only case with no real shape data at all (no
        // corners/bbox_geo/polygon/bounds), so a real box still renders
        // instead of falling back to a dot marker.
        function fallbackSquareCorners(lat, lon) {
            const dLat = 15 / 111320
            const dLon = 15 / (111320 * Math.max(0.15, Math.cos(lat * Math.PI / 180)))
            return [
                [lat - dLat, lon - dLon], [lat - dLat, lon + dLon],
                [lat + dLat, lon + dLon], [lat + dLat, lon - dLon],
            ]
        }

        for (const det of detections) {
            const hex   = colorForDet(det)
            const color = Color.fromCssColorString(hex)

            // Real, oriented (or axis-aligned) bounding box for every
            // detection — a filled, outlined polygon, never a bare dot.
            // Corner source, in order of preference: the model's own real
            // rotated OBB corners, an axis-aligned [W,S,E,N] box, an
            // explicit polygon, NSEW bounds, or (last resort, no real
            // shape at all) a small real box around the centroid.
            let latLonCorners = null
            if (det.corners && det.corners.length >= 3) {
                latLonCorners = det.corners
            } else if (det.bbox_geo) {
                const [W, S, E, N] = det.bbox_geo
                latLonCorners = [[S, W], [S, E], [N, E], [N, W]]
            } else if (det.polygon?.length >= 3) {
                latLonCorners = det.polygon
            } else if (det.north != null) {
                const { north, south, east, west } = det
                latLonCorners = [[south, west], [south, east], [north, east], [north, west]]
            } else if (det.center?.length === 2) {
                latLonCorners = fallbackSquareCorners(det.center[0], det.center[1])
            } else {
                continue
            }

            const positions = latLonCorners.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat))
            // Real filled box — height:0 (not classificationType/ground-
            // clamped: combining the two produced entities that silently
            // failed to render, confirmed live), the same real, already-
            // proven pattern GlobeOverwatchDrawLayer.jsx's own rectangle
            // preview/final entities use.
            added.push(viewer.entities.add({
                id: `ow-box-${Math.random()}`,
                polygon: {
                    hierarchy: new PolygonHierarchy(positions),
                    material: new ColorMaterialProperty(color.withAlpha(0.28)),
                    outline: true,
                    outlineColor: color.withAlpha(0.95),
                    outlineWidth: 2,
                    height: 0,
                },
            }))
            // A real outline entity too — PolygonGraphics.outline is drawn
            // thin/unreliable on some terrain-clamped ground primitives, so
            // a dedicated polyline guarantees the box edge stays visible.
            const ring = [...positions, positions[0]]
            added.push(viewer.entities.add({
                id: `ow-box-outline-${Math.random()}`,
                polyline: {
                    positions: ring,
                    width: 2,
                    material: new ColorMaterialProperty(color.withAlpha(0.95)),
                    clampToGround: true,
                    classificationType: ClassificationType.TERRAIN,
                },
            }))
        }

        entitiesRef.current = added
        return cleanup
    }, [viewer, enabled, detections])

    return null
}
