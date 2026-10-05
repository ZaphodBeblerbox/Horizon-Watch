// 3D traffic-density heatmap. Backed by /api/analytics/heatmap.
// Renders one Rectangle entity per grid cell, colored by intensity.

import { useEffect, useRef, useState } from "react"
import { useCesium } from "resium"
import { Rectangle, Color, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const HALF_CELL = 0.05  // 0.1° grid → ±0.05° from center

const colorFor = (intensity) => {
    if (intensity > 0.90) return Color.fromCssColorString("#FF0000").withAlpha(0.85)
    if (intensity > 0.75) return Color.fromCssColorString("#FF6000").withAlpha(0.80)
    if (intensity > 0.60) return Color.fromCssColorString("#FFB300").withAlpha(0.75)
    if (intensity > 0.45) return Color.fromCssColorString("#FFFF00").withAlpha(0.70)
    if (intensity > 0.30) return Color.fromCssColorString("#00FF80").withAlpha(0.65)
    if (intensity > 0.20) return Color.fromCssColorString("#00CCFF").withAlpha(0.55)
    if (intensity > 0.10) return Color.fromCssColorString("#0066FF").withAlpha(0.45)
    return                 Color.fromCssColorString("#0033FF").withAlpha(0.35)
}

export default function GlobeHeatmapLayer({ enabled, domain = "ais", hours = 24,
                                            bounds = null,
                                            // "tracks" grids AIS/ADS-B positions;
                                            // "gfw" grids Global Fishing Watch
                                            // events, which are discrete
                                            // incidents and so are gridded much
                                            // coarser — see gfw.density().
                                            source = "tracks",
                                            gfwKind = "encounters", days = 30 }) {
    const { viewer } = useCesium()
    const entitiesRef = useRef([])
    const [cells, setCells] = useState(null)
    // The cell size comes from whatever answered, because the two
    // sources do not use the same grid and a fixed half-cell drew GFW
    // cells at a fifth of their real footprint — a heatmap with gaps
    // between the cells, which reads as sparse data rather than a
    // rendering choice.
    const [cellDeg, setCellDeg] = useState(null)

    // Fetch heatmap data when enabled / bounds / params change
    useEffect(() => {
        if (!enabled) { setCells(null); return }
        let cancelled = false
        const ctrl = new AbortController()

        let url
        if (source === "gfw") {
            // Worldwide: GFW publishes days behind real time and the
            // whole point of the layer is the global pattern, so it is
            // not viewport-bounded the way the track heatmap is.
            url = `${API_BASE}/api/gfw/heatmap?kind=${encodeURIComponent(gfwKind)}&days=${days}`
        } else {
            url = `${API_BASE}/api/analytics/heatmap?domain=${domain}&hours=${hours}`
            if (bounds && bounds.south != null) {
                url += `&south=${bounds.south.toFixed(3)}&north=${bounds.north.toFixed(3)}`
                    + `&west=${bounds.west.toFixed(3)}&east=${bounds.east.toFixed(3)}`
            }
        }

        fetch(url, { signal: ctrl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (cancelled) return
                setCells(d?.cells || [])
                setCellDeg(Number.isFinite(d?.cell_deg) ? d.cell_deg : null)
            })
            .catch(err => { if (err.name !== "AbortError") console.warn("[globe-heatmap]", err) })

        return () => { cancelled = true; ctrl.abort() }
    }, [enabled, domain, hours, source, gfwKind, days,
        bounds?.south, bounds?.north, bounds?.west, bounds?.east])

    // Render rectangles
    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            entitiesRef.current.forEach(e => {
                if (viewer.entities.contains(e)) viewer.entities.remove(e)
                if (e.id) deleteEntity(e.id)
            })
            entitiesRef.current = []
        }

        cleanup()
        if (!enabled || !cells?.length) return

        /* REDUCED, NOT SPREAD. `Math.max(...cells.map(…))` passes one
           argument per cell, and a spread of more than ~100k arguments
           throws "Maximum call stack size exceeded" — which is how a
           density response that grew took down the whole layer with a
           RangeError rather than drawing a slow heatmap. A reduce has no
           argument limit. */
        const max = cells.reduce((m, c) => (c.count > m ? c.count : m), 1)
        const half = cellDeg ? cellDeg / 2 : HALF_CELL
        const added = []

        cells.forEach(cell => {
            const intensity = cell.count / max
            const entityId = `heatmap-${source === "gfw" ? `gfw-${gfwKind}` : domain}`
                           + `-${cell.lat.toFixed(3)}-${cell.lon.toFixed(3)}`
            const entity = viewer.entities.add({
                id: entityId,
                rectangle: {
                    coordinates: Rectangle.fromDegrees(
                        cell.lon - half, cell.lat - half,
                        cell.lon + half, cell.lat + half
                    ),
                    material:        colorFor(intensity),
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                },
            })
            setEntity(entityId, "heatmap_cell", {
                lat: cell.lat, lon: cell.lon,
                count: cell.count, avg_speed: cell.avg_speed,
                domain: source === "gfw" ? `gfw:${gfwKind}` : domain,
                intensity,
                // GFW's own flag count, under GFW's name — never
                // restated as this system's assessment.
                gfw_potential_risk_count: cell.gfw_potential_risk_count,
                distinct_vessels: cell.distinct_vessels,
                cell_size_deg: cellDeg || undefined,
            })
            added.push(entity)
        })
        entitiesRef.current = added

        return cleanup
    }, [viewer, enabled, cells, cellDeg, source, gfwKind, domain])

    return null
}
