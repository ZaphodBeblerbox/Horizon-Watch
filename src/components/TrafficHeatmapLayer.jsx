// 2D traffic-density heatmap. Backed by /api/analytics/heatmap.
// Refetches on map pan / zoom and renders via leaflet.heat.

import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet.heat"
import API_BASE from "../apiBase.js"

const GRADIENT = {
    0.0:  "#0033FF",
    0.2:  "#0099FF",
    0.3:  "#00FFCC",
    0.4:  "#66FF00",
    0.5:  "#CCFF00",
    0.6:  "#FFCC00",
    0.7:  "#FF9900",
    0.8:  "#FF6600",
    0.9:  "#FF3300",
    1.0:  "#FF0000",
}

export default function TrafficHeatmapLayer({ enabled, domain = "ais", hours = 24 }) {
    const map = useMap()
    const layerRef = useRef(null)
    const aborterRef = useRef(null)

    useEffect(() => {
        if (!map) return

        const remove = () => {
            if (layerRef.current) {
                map.removeLayer(layerRef.current)
                layerRef.current = null
            }
        }

        if (!enabled) { remove(); return }

        const refresh = () => {
            aborterRef.current?.abort()
            const ctrl = new AbortController()
            aborterRef.current = ctrl

            const b = map.getBounds()
            const url = `${API_BASE}/api/analytics/heatmap`
                + `?domain=${domain}&hours=${hours}`
                + `&south=${b.getSouth().toFixed(3)}&west=${b.getWest().toFixed(3)}`
                + `&north=${b.getNorth().toFixed(3)}&east=${b.getEast().toFixed(3)}`

            fetch(url, { signal: ctrl.signal })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.cells) return
                    const max = d.cells.reduce((m, c) => Math.max(m, c.count), 1)
                    const points = d.cells.map(c => [c.lat, c.lon, c.count / max])

                    if (layerRef.current) {
                        layerRef.current.setLatLngs(points)
                    } else {
                        layerRef.current = L.heatLayer(points, {
                            radius: 22,
                            blur:   18,
                            maxZoom: 12,
                            minOpacity: 0.35,
                            gradient: GRADIENT,
                        }).addTo(map)
                    }
                })
                .catch(err => { if (err.name !== "AbortError") console.warn("[heatmap]", err) })
        }

        refresh()
        let t = null
        const debounced = () => { clearTimeout(t); t = setTimeout(refresh, 300) }
        map.on("moveend", debounced)
        map.on("zoomend", debounced)

        return () => {
            clearTimeout(t)
            aborterRef.current?.abort()
            map.off("moveend", debounced)
            map.off("zoomend", debounced)
            remove()
        }
    }, [map, enabled, domain, hours])

    return null
}
