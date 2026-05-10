// 3D overwatch detection layer — renders ground-clamped rectangle bounding boxes
// using the same detection data produced by the 2D OverwatchLayer pipeline.

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Cartesian3, Rectangle, Color, HeightReference,
    DistanceDisplayCondition, VerticalOrigin,
} from "cesium"

const CLASS_COLORS = {
    vessel:               "#5BC97F",
    ship:                 "#5BC97F",
    harbor:               "#5BC97F",
    aircraft:             "#4A9EE0",
    plane:                "#4A9EE0",
    helicopter:           "#4A9EE0",
    "helicopter-pad":     "#4A9EE0",
    vehicle:              "#E8B23A",
    "large-vehicle":      "#E8B23A",
    "small-vehicle":      "#E8B23A",
    car:                  "#E8B23A",
    truck:                "#E8B23A",
    "storage-tank":       "#E8B23A",
    building:             "#9AA4B5",
    bridge:               "#9AA4B5",
    roundabout:           "#9AA4B5",
    "swimming-pool":      "#22d3ee",
    unknown:              "#666666",
}

function colorForClass(cls) {
    const key = (cls || "").toLowerCase()
    return CLASS_COLORS[key] || CLASS_COLORS.unknown
}

export default function GlobeOverwatchLayer({ enabled, detections = [] }) {
    const { viewer } = useCesium()
    const entitiesRef = useRef([])

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

        detections.forEach((det, idx) => {
            let west, south, east, north
            if (det.bbox_geo) {
                ;[west, south, east, north] = det.bbox_geo
            } else if (det.polygon?.length >= 3) {
                const lats = det.polygon.map(v => v[0])
                const lons = det.polygon.map(v => v[1])
                south = Math.min(...lats); north = Math.max(...lats)
                west  = Math.min(...lons); east  = Math.max(...lons)
            } else if (det.corners?.length >= 3) {
                const lats = det.corners.map(v => v[0])
                const lons = det.corners.map(v => v[1])
                south = Math.min(...lats); north = Math.max(...lats)
                west  = Math.min(...lons); east  = Math.max(...lons)
            } else if (det.center?.length === 2 && det.north != null) {
                // Explicit NSEW bounds on the detection itself
                north = det.north; south = det.south; east = det.east; west = det.west
            } else {
                return
            }

            const hex   = colorForClass(det.class)
            const fill  = Color.fromCssColorString(hex).withAlpha(0.25)
            const line  = Color.fromCssColorString(hex).withAlpha(0.90)
            const label = `${det.specific_type || det.class || "?"} ${Math.round((det.confidence ?? 0) * 100)}%`
            const centerPos = Cartesian3.fromDegrees((west + east) / 2, south)

            const entity = viewer.entities.add({
                id:       `overwatch-det-${idx}-${det.run_id || ""}`,
                position: centerPos,
                rectangle: {
                    coordinates:     Rectangle.fromDegrees(west, south, east, north),
                    material:        fill,
                    outline:         true,
                    outlineColor:    line,
                    outlineWidth:    2,
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                },
                label: {
                    text:          label,
                    font:          "bold 12px system-ui, sans-serif",
                    fillColor:     Color.WHITE,
                    outlineColor:  Color.BLACK,
                    outlineWidth:  2,
                    style:         2,
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    pixelOffset:   { x: 0, y: -8 },
                    showBackground: true,
                    backgroundColor: Color.fromCssColorString(hex).withAlpha(0.82),
                    backgroundPadding: { x: 5, y: 3 },
                    distanceDisplayCondition: new DistanceDisplayCondition(0, 80_000),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })

            added.push(entity)
        })

        entitiesRef.current = added
        return cleanup
    }, [viewer, enabled, detections])

    return null
}
