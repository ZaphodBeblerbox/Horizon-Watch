// Overwatch detection layer — polygon outlines from YOLO OBB corners + Sentinel imagery overlay

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Cartesian2, Cartesian3, Rectangle, Color, PolygonHierarchy,
    SingleTileImageryProvider, ColorMaterialProperty,
    ClassificationType, LabelStyle, DistanceDisplayCondition,
} from "cesium"
import { detectionCorners } from "./detectionShape.js"

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

        for (const det of detections) {
            const hex   = colorForDet(det)
            const color = Color.fromCssColorString(hex)

            // THE DETECTOR'S OWN OUTLINE, WHERE THERE IS ONE. This used
            // to look for corners/bbox_geo/polygon/center — none of
            // which the payload actually contains — so every real traced
            // polygon in `geo_geometry` was discarded and a fixed ~30m
            // square was drawn around the centroid instead. That is why
            // detections rendered as small identical boxes rather than
            // as outlines of the thing detected. See detectionShape.js;
            // the lon/lat swap lives there, with tests, because getting
            // it wrong moves a detection to another continent silently.
            const shape = detectionCorners(det)
            if (!shape) continue
            const latLonCorners = shape.corners

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
            // THE TAG. A box with no label says something is there but not
            // what, which is the half of a detection that makes it usable —
            // and with all fifteen DOTA classes now running, "a box" could
            // be a vessel, an aircraft, a storage tank or a truck.
            const _tag = (det.label || det.object_type || det.category || "object")
                .toString().replace(/_/g, " ")
            const _conf = typeof det.confidence === "number"
                ? ` ${Math.round(det.confidence * 100)}%` : ""
            added.push(viewer.entities.add({
                id: `ow-box-label-${Math.random()}`,
                position: positions[0],
                label: {
                    text: `${_tag}${_conf}`,
                    font: "11px monospace",
                    fillColor: color,
                    outlineColor: Color.BLACK.withAlpha(0.85),
                    outlineWidth: 2.5,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cartesian2(0, -12),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    // Hide when the camera is far out, or a busy scene turns
                    // into a wall of overlapping text.
                    distanceDisplayCondition: new DistanceDisplayCondition(0, 2.0e6),
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
