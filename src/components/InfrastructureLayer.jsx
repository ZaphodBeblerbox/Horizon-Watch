import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import { formatInfraPopup } from "../services/infraPopupFormatter.js"

// leaflet.vectorgrid is a legacy IIFE that patches window.L.
// Importing it at module level causes a TDZ crash in Vite's production bundle
// because Rollup doesn't know it depends on Leaflet (no require() call) and
// may evaluate the IIFE before Leaflet's const binding is assigned.
// Solution: lazy-load it once inside useEffect, after setting window.L = L.
let vectorGridReady = false
const vectorGridCallbacks = []
function ensureVectorGrid() {
    if (vectorGridReady) return Promise.resolve()
    return new Promise((resolve) => {
        vectorGridCallbacks.push(resolve)
        if (vectorGridCallbacks.length > 1) return  // already loading
        window.L = L  // expose L as global so the IIFE can patch it
        import("leaflet.vectorgrid").then(() => {
            vectorGridReady = true
            vectorGridCallbacks.splice(0).forEach(cb => cb())
        }).catch(() => {
            vectorGridCallbacks.splice(0).forEach(cb => cb())
        })
    })
}

const OIM_BASE  = "https://openinframap.org/tiles"
const OIM_PANE  = "oim-layer"
const MIN_ZOOM  = { power: 5, telecoms: 8, petroleum: 6, water: 8 }

const STYLES = {
    power: {
        power_line:        (p) => { const v = parseInt(p.voltage, 10) || 0; return { color: "#E8B23A", weight: v >= 220000 ? 2.5 : 1.5, opacity: v >= 220000 ? 0.8 : 0.6, fill: false } },
        power_cable:       ()  => ({ color: "#D4A032", weight: 1.5, opacity: 0.5, fill: false }),
        power_substation:  ()  => ({ fillColor: "#E8B23A", fillOpacity: 0.7, color: "#E8B23A", weight: 1, radius: 5 }),
        power_generator:   ()  => ({ fillColor: "#5BC97F", fillOpacity: 0.7, color: "#5BC97F", weight: 1, radius: 5 }),
        power_plant:       ()  => ({ fillColor: "#5BC97F", fillOpacity: 0.4, color: "#5BC97F", weight: 1.5, fill: true }),
        power_transformer: ()  => ({ fillColor: "#E8B23A", fillOpacity: 0.7, color: "#E8B23A", weight: 1, radius: 4 }),
        power_tower:       ()  => ({ fillColor: "#E8B23A", fillOpacity: 0.5, color: "#E8B23A", weight: 1, radius: 3 }),
        power_pole:        ()  => ({ fillColor: "#E8B23A", fillOpacity: 0.4, color: "#E8B23A", weight: 1, radius: 2 }),
    },
    telecoms: {
        telecoms_line:     ()  => ({ color: "#6C9CE0", weight: 1.5, opacity: 0.6, fill: false }),
        telecoms_mast:     ()  => ({ fillColor: "#6C9CE0", fillOpacity: 0.7, color: "#6C9CE0", weight: 1, radius: 5 }),
        telecoms_exchange: ()  => ({ fillColor: "#6C9CE0", fillOpacity: 0.7, color: "#6C9CE0", weight: 1, radius: 5 }),
    },
    petroleum: {
        petroleum_pipeline: () => ({ color: "#E55757", weight: 2.0, opacity: 0.7, fill: false }),
        petroleum_well:     () => ({ fillColor: "#E55757", fillOpacity: 0.7, color: "#E55757", weight: 1, radius: 4 }),
        petroleum_site:     () => ({ fillColor: "#E55757", fillOpacity: 0.4, color: "#E55757", weight: 1.5, fill: true }),
    },
    water: {
        water_pipeline:        () => ({ color: "#4A9EE0", weight: 1.5, opacity: 0.6, fill: false }),
        water_treatment:       () => ({ fillColor: "#4A9EE0", fillOpacity: 0.7, color: "#4A9EE0", weight: 1, radius: 5 }),
        water_tower:           () => ({ fillColor: "#4A9EE0", fillOpacity: 0.7, color: "#4A9EE0", weight: 1, radius: 4 }),
        water_pumping_station: () => ({ fillColor: "#4A9EE0", fillOpacity: 0.7, color: "#4A9EE0", weight: 1, radius: 4 }),
        water_reservoir:       () => ({ fillColor: "#4A9EE0", fillOpacity: 0.3, color: "#4A9EE0", weight: 1.5, fill: true }),
    },
}

const SUB_LAYERS = [
    { key: "power",     activeKey: "oimPower",     tileLayer: "power"     },
    { key: "telecoms",  activeKey: "oimTelecoms",  tileLayer: "telecoms"  },
    { key: "petroleum", activeKey: "oimPetroleum", tileLayer: "petroleum" },
    { key: "water",     activeKey: "oimWater",     tileLayer: "water"     },
]

export default function InfrastructureLayer({ active, onUnavailable }) {
    const map = useMap()
    const layersRef   = useRef({})
    const activeRef   = useRef(active)
    const unmountedRef = useRef(false)

    useEffect(() => { activeRef.current = active })

    // Create OIM pane at z-index 150 (above base map, below detections/tracks)
    useEffect(() => {
        if (!map.getPane(OIM_PANE)) {
            const pane = map.createPane(OIM_PANE)
            pane.style.zIndex = "150"
        }
    }, [map])

    function applyLayers() {
        if (unmountedRef.current) return
        const a = activeRef.current
        SUB_LAYERS.forEach(({ key, activeKey, tileLayer }) => {
            const shouldShow = !!(a.oim && a[activeKey])
            const existing   = layersRef.current[key]

            if (!shouldShow && existing) {
                try { map.removeLayer(existing) } catch (_) {}
                layersRef.current[key] = null
                return
            }
            if (shouldShow && !existing) {
                const url = `${OIM_BASE}/${tileLayer}/{z}/{x}/{y}.pbf`
                const layer = L.vectorGrid.protobuf(url, {
                    rendererFactory: L.canvas.tile,
                    vectorTileLayerStyles: STYLES[key],
                    interactive: true,
                    pane: OIM_PANE,
                    minZoom: MIN_ZOOM[key],
                    maxNativeZoom: 17,
                    maxZoom: 20,
                    attribution: '© <a href="https://openinframap.org" target="_blank">OpenInfraMap</a>',
                    fetchOptions: { headers: { Referer: window.location.origin } },
                })

                layer.on("click", (e) => {
                    const props = e.layer.properties || {}
                    const html  = formatInfraPopup(key, props)
                    if (!html) return
                    L.DomEvent.stopPropagation(e)
                    L.popup({ className: "infra-popup", maxWidth: 280 })
                        .setLatLng(e.latlng)
                        .setContent(html)
                        .openOn(map)
                })

                layer.on("tileerror", () => { onUnavailable?.(key) })

                try { layer.addTo(map) } catch (_) {}
                layersRef.current[key] = layer
            }
        })
    }

    // Manage sub-layer lifecycle — wait for vectorgrid to load on first activation
    useEffect(() => {
        if (!active.oim) {
            // Remove any active layers immediately without loading vectorgrid
            Object.keys(layersRef.current).forEach(key => {
                if (layersRef.current[key]) {
                    try { map.removeLayer(layersRef.current[key]) } catch (_) {}
                    layersRef.current[key] = null
                }
            })
            return
        }
        ensureVectorGrid().then(applyLayers)
    }, [map, active.oim, active.oimPower, active.oimTelecoms, active.oimPetroleum, active.oimWater]) // eslint-disable-line

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            unmountedRef.current = true
            Object.values(layersRef.current).forEach(layer => {
                if (layer) try { map.removeLayer(layer) } catch (_) {}
            })
            layersRef.current = {}
        }
    }, [map])

    return null
}
