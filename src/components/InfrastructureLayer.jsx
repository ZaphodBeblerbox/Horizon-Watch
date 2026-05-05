import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet.vectorgrid"
import API_BASE from "../apiBase.js"

// OIM PBF layer → display type mapping (confirmed from tile inspection)
const LAYER_TYPES = {
    power_line:                 "power",
    power_plant:                "power",
    power_plant_point:          "power",
    power_substation_point:     "power",
    petroleum_pipeline:         "petroleum",
    telecoms_communication_line:"telecoms",
    water_pipeline:             "water",
}

const TYPE_COLORS = {
    power:     "#E8B23A",
    petroleum: "#E55757",
    telecoms:  "#9AA4B5",
    water:     "#4A9EE0",
}

const TYPE_LABELS = {
    power:     "Power Infrastructure",
    petroleum: "Oil & Gas Pipeline",
    telecoms:  "Telecommunications",
    water:     "Water Pipeline",
}

function buildStyles(enabled) {
    const out = {}
    for (const [layer, type] of Object.entries(LAYER_TYPES)) {
        if (!enabled[type]) {
            out[layer] = { opacity: 0, fillOpacity: 0, weight: 0, radius: 0 }
            continue
        }
        const c = TYPE_COLORS[type]
        const isPoint = layer.endsWith("_point")
        if (isPoint) {
            out[layer] = { radius: 4, color: c, weight: 1, opacity: 0.9, fillColor: c, fillOpacity: 0.4 }
        } else {
            out[layer] = { weight: 1.5, color: c, opacity: 0.85 }
        }
    }
    return out
}


export default function InfrastructureLayer({
    enabled,
    powerEnabled    = true,
    telecomsEnabled = true,
    petroleumEnabled = true,
    waterEnabled    = true,
}) {
    const map    = useMap()
    const layRef = useRef(null)

    const enabledTypes = {
        power:     enabled && powerEnabled,
        telecoms:  enabled && telecomsEnabled,
        petroleum: enabled && petroleumEnabled,
        water:     enabled && waterEnabled,
    }

    useEffect(() => {
        if (!enabled) {
            if (layRef.current) { layRef.current.remove(); layRef.current = null }
            return
        }

        const styles = buildStyles(enabledTypes)

        const layer = L.vectorGrid.protobuf(
            `${API_BASE}/api/tiles/openinfra/{z}/{x}/{y}.pbf`,
            {
                maxNativeZoom:         14,
                maxZoom:               20,
                minZoom:               2,
                attribution:           '&copy; <a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
                vectorTileLayerStyles: styles,
                rendererFactory:       L.svg.tile,
                interactive:           false,
            }
        )

        layer.addTo(map)
        layRef.current = layer

        return () => { layer.remove(); layRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, powerEnabled, telecomsEnabled, petroleumEnabled, waterEnabled, map])

    return null
}
