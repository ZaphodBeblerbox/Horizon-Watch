import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import { formatInfraPopup } from "../services/infraPopupFormatter.js"

// leaflet.vectorgrid is a legacy IIFE that patches window.L (no require() call).
// Dynamic import ensures window.L = L is set before the IIFE runs, avoiding TDZ.
let _vgReady = false
const _vgCbs = []
function ensureVectorGrid() {
    if (_vgReady) return Promise.resolve()
    return new Promise(resolve => {
        _vgCbs.push(resolve)
        if (_vgCbs.length > 1) return
        window.L = L
        import("leaflet.vectorgrid")
            .then(() => { _vgReady = true; _vgCbs.splice(0).forEach(cb => cb()) })
            .catch(()  => {                 _vgCbs.splice(0).forEach(cb => cb()) })
    })
}

// OpenInfraMap serves ALL infrastructure types in one unified tile stream.
// Separate per-type endpoints (/tiles/power/…) do NOT exist.
const OIM_URL  = "https://openinframap.org/tiles/{z}/{x}/{y}.pbf"
const OIM_PANE = "oim-layer"

// Layer names verified by inspecting live PBF tiles.
// Voltage values in tiles are in kV (e.g. 275 = 275 kV).
// Geometry types: 1=point, 2=line, 3=polygon
function makeStyles(activeRef) {
    const pw = () => activeRef.current?.oimPower
    const tc = () => activeRef.current?.oimTelecoms
    const pe = () => activeRef.current?.oimPetroleum
    const wa = () => activeRef.current?.oimWater

    return {
        // ── Power ──────────────────────────────────────────────────────────
        power_line: (p) => {
            if (!pw()) return { weight: 0, opacity: 0, fill: false }
            const v = parseInt(p.voltage, 10) || 0
            return { color: "#E8B23A", weight: v >= 220 ? 2.5 : 1.5, opacity: v >= 220 ? 0.85 : 0.6, fill: false }
        },
        power_substation: () =>
            pw() ? { fillColor: "#E8B23A", fillOpacity: 0.55, color: "#E8B23A", weight: 1 }
                 : { weight: 0, fillOpacity: 0, opacity: 0 },
        power_substation_point: () =>
            pw() ? { fillColor: "#E8B23A", fillOpacity: 0.75, color: "#E8B23A", weight: 1, radius: 4 }
                 : { radius: 0, fillOpacity: 0, opacity: 0 },
        power_generator: () =>
            pw() ? { fillColor: "#5BC97F", fillOpacity: 0.75, color: "#5BC97F", weight: 1, radius: 4 }
                 : { radius: 0, fillOpacity: 0, opacity: 0 },
        power_generator_area: () =>
            pw() ? { fillColor: "#5BC97F", fillOpacity: 0.4, color: "#5BC97F", weight: 1 }
                 : { weight: 0, fillOpacity: 0, opacity: 0 },
        power_plant: () =>
            pw() ? { fillColor: "#5BC97F", fillOpacity: 0.35, color: "#5BC97F", weight: 1.5 }
                 : { weight: 0, fillOpacity: 0, opacity: 0 },
        power_plant_point: () =>
            pw() ? { fillColor: "#5BC97F", fillOpacity: 0.75, color: "#5BC97F", weight: 1, radius: 5 }
                 : { radius: 0, fillOpacity: 0, opacity: 0 },

        // ── Telecoms ───────────────────────────────────────────────────────
        telecoms_mast: () =>
            tc() ? { fillColor: "#6C9CE0", fillOpacity: 0.75, color: "#6C9CE0", weight: 1, radius: 5 }
                 : { radius: 0, fillOpacity: 0, opacity: 0 },
        telecoms_data_center: () =>
            tc() ? { fillColor: "#6C9CE0", fillOpacity: 0.5, color: "#6C9CE0", weight: 1.5 }
                 : { weight: 0, fillOpacity: 0, opacity: 0 },

        // ── Petroleum ──────────────────────────────────────────────────────
        petroleum_pipeline: () =>
            pe() ? { color: "#E55757", weight: 2.0, opacity: 0.75, fill: false }
                 : { weight: 0, opacity: 0, fill: false },
        petroleum_site: () =>
            pe() ? { fillColor: "#E55757", fillOpacity: 0.4, color: "#E55757", weight: 1.5 }
                 : { weight: 0, fillOpacity: 0, opacity: 0 },
        petroleum_well: () =>
            pe() ? { fillColor: "#E55757", fillOpacity: 0.75, color: "#E55757", weight: 1, radius: 4 }
                 : { radius: 0, fillOpacity: 0, opacity: 0 },

        // ── Water ──────────────────────────────────────────────────────────
        water_pipeline: () =>
            wa() ? { color: "#4A9EE0", weight: 1.5, opacity: 0.65, fill: false }
                 : { weight: 0, opacity: 0, fill: false },
    }
}

// Feature group from layer name — used for popup formatter routing
function layerGroup(name) {
    if (name.startsWith("power"))      return "power"
    if (name.startsWith("telecoms"))   return "telecoms"
    if (name.startsWith("petroleum"))  return "petroleum"
    if (name.startsWith("water"))      return "water"
    return "power"
}

export default function InfrastructureLayer({ active, onUnavailable }) {
    const map          = useMap()
    const layerRef     = useRef(null)
    const activeRef    = useRef(active)
    const unmountedRef = useRef(false)

    // Keep ref in sync with latest props so style functions see current state
    useEffect(() => { activeRef.current = active })

    // Create custom pane at z-index 150 (above base tiles, below event/track layers)
    useEffect(() => {
        if (!map.getPane(OIM_PANE)) {
            const pane = map.createPane(OIM_PANE)
            pane.style.zIndex = "150"
        }
    }, [map])

    // Master toggle: create or remove the single unified VectorGrid layer
    useEffect(() => {
        if (!active.oim) {
            if (layerRef.current) {
                try { map.removeLayer(layerRef.current) } catch (_) {}
                layerRef.current = null
            }
            return
        }
        if (layerRef.current) return  // already created

        ensureVectorGrid().then(() => {
            if (unmountedRef.current || layerRef.current) return
            if (!L.vectorGrid?.protobuf) {
                console.warn("[InfrastructureLayer] L.vectorGrid not available after load")
                return
            }

            const layer = L.vectorGrid.protobuf(OIM_URL, {
                rendererFactory: L.canvas.tile,
                vectorTileLayerStyles: makeStyles(activeRef),
                interactive: true,
                pane: OIM_PANE,
                tileSize: 512,
                zoomOffset: -1,
                minZoom: 5,
                maxNativeZoom: 17,
                maxZoom: 20,
                updateWhenIdle: false,
                updateWhenZooming: false,
                keepBuffer: 4,
                attribution: '© <a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
                fetchOptions: { headers: { Referer: window.location.origin } },
            })

            layer.on("click", (e) => {
                const props = e.layer.properties || {}
                const name  = e.sourceTarget?.options?.layerName || ""
                const group = layerGroup(name)
                const html  = formatInfraPopup(group, props)
                if (!html) return
                L.DomEvent.stopPropagation(e)
                L.popup({ className: "infra-popup", maxWidth: 280 })
                    .setLatLng(e.latlng)
                    .setContent(html)
                    .openOn(map)
            })

            layer.on("tileerror", () => { onUnavailable?.() })

            try { layer.addTo(map) } catch (_) {}
            layerRef.current = layer
        })
    }, [map, active.oim]) // eslint-disable-line

    // Sub-layer toggles: redraw cached tiles with updated styles
    useEffect(() => {
        if (layerRef.current) {
            try { layerRef.current.redraw() } catch (_) {}
        }
    }, [active.oimPower, active.oimTelecoms, active.oimPetroleum, active.oimWater])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            unmountedRef.current = true
            if (layerRef.current) {
                try { map.removeLayer(layerRef.current) } catch (_) {}
                layerRef.current = null
            }
        }
    }, [map])

    return null
}
