// 3D traffic-density heatmap. Backed by /api/analytics/heatmap.
// Renders one Rectangle entity per grid cell, colored by intensity.

import { useEffect, useRef, useState } from "react"
import { useCesium } from "resium"
import { Rectangle, Color, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"

const HALF_CELL = 0.05  // 0.1° grid → ±0.05° from center

const colorFor = (intensity) => {
    if (intensity > 0.75) return Color.fromCssColorString("#E55757").withAlpha(0.45)
    if (intensity > 0.45) return Color.fromCssColorString("#E8B23A").withAlpha(0.35)
    if (intensity > 0.20) return Color.fromCssColorString("#5BC97F").withAlpha(0.28)
    return                 Color.fromCssColorString("#4A9EE0").withAlpha(0.22)
}

export default function GlobeHeatmapLayer({ enabled, domain = "ais", hours = 24, bounds = null }) {
    const { viewer } = useCesium()
    const entitiesRef = useRef([])
    const [cells, setCells] = useState(null)

    // Fetch heatmap data when enabled / bounds / params change
    useEffect(() => {
        if (!enabled) { setCells(null); return }
        let cancelled = false
        const ctrl = new AbortController()

        let url = `${API_BASE}/api/analytics/heatmap?domain=${domain}&hours=${hours}`
        if (bounds && bounds.south != null) {
            url += `&south=${bounds.south.toFixed(3)}&north=${bounds.north.toFixed(3)}`
                + `&west=${bounds.west.toFixed(3)}&east=${bounds.east.toFixed(3)}`
        }

        fetch(url, { signal: ctrl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setCells(d?.cells || []) })
            .catch(err => { if (err.name !== "AbortError") console.warn("[globe-heatmap]", err) })

        return () => { cancelled = true; ctrl.abort() }
    }, [enabled, domain, hours, bounds?.south, bounds?.north, bounds?.west, bounds?.east])

    // Render rectangles
    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            entitiesRef.current.forEach(e => {
                if (viewer.entities.contains(e)) viewer.entities.remove(e)
            })
            entitiesRef.current = []
        }

        cleanup()
        if (!enabled || !cells?.length) return

        const max = Math.max(...cells.map(c => c.count), 1)
        const added = []

        cells.forEach(cell => {
            const intensity = cell.count / max
            const entity = viewer.entities.add({
                rectangle: {
                    coordinates: Rectangle.fromDegrees(
                        cell.lon - HALF_CELL, cell.lat - HALF_CELL,
                        cell.lon + HALF_CELL, cell.lat + HALF_CELL
                    ),
                    material:        colorFor(intensity),
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                },
            })
            added.push(entity)
        })
        entitiesRef.current = added

        return cleanup
    }, [viewer, enabled, cells])

    return null
}
