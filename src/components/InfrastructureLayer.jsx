import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet.vectorgrid"

// Layer styles per OIM feature class
const STYLES = {
    power_line:        { weight: 1.2, color: "#E8B23A", opacity: 0.85 },
    power_minor_line:  { weight: 0.8, color: "#E8B23A", opacity: 0.6 },
    power_cable:       { weight: 1.2, color: "#E8B23A", opacity: 0.85 },
    power_plant:       { weight: 1,   color: "#E8B23A", opacity: 0.7, fill: true, fillColor: "#E8B23A", fillOpacity: 0.15 },
    power_substation:  { weight: 1,   color: "#E8B23A", opacity: 0.7, fill: true, fillColor: "#E8B23A", fillOpacity: 0.2 },
    power_tower:       { radius: 2,   color: "#E8B23A", weight: 0 },
    power_pole:        { radius: 1.5, color: "#E8B23A", weight: 0 },
    pipeline:          { weight: 1.5, color: "#4A9EE0", opacity: 0.8 },
    telecom_line:      { weight: 1,   color: "#9AA4B5", opacity: 0.6 },
    telecom_cable:     { weight: 1,   color: "#9AA4B5", opacity: 0.6 },
}

const DEFAULT_STYLE = { weight: 1, color: "#9AA4B5", opacity: 0.5 }

function styleFor(layerName) {
    return STYLES[layerName] || DEFAULT_STYLE
}

export default function InfrastructureLayer({ enabled }) {
    const map    = useMap()
    const layRef = useRef(null)

    useEffect(() => {
        if (!enabled) {
            if (layRef.current) { layRef.current.remove(); layRef.current = null }
            return
        }

        const layer = L.vectorGrid.protobuf("/api/tiles/openinfra/{z}/{x}/{y}.pbf", {
            maxNativeZoom: 14,
            maxZoom:       20,
            minZoom:       2,
            attribution:   '&copy; <a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
            vectorTileLayerStyles: new Proxy({}, {
                get(_, name) { return styleFor(name) },
            }),
            rendererFactory: L.svg.tile,
            interactive: false,
        })

        layer.addTo(map)
        layRef.current = layer

        return () => { layer.remove(); layRef.current = null }
    }, [enabled, map])

    return null
}
