import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet.vectorgrid"

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

function formatPopup(layerName, props) {
    const type  = LAYER_TYPES[layerName] || "unknown"
    const color = TYPE_COLORS[type]      || "#E8ECF1"
    const label = TYPE_LABELS[type]      || layerName

    const FIELD_LABELS = {
        voltage:     "Voltage",
        circuits:    "Circuits",
        cables:      "Cables",
        operator:    "Operator",
        name:        "Name",
        ref:         "Ref",
        location:    "Location",
        substance:   "Substance",
        diameter:    "Diameter",
        pressure:    "Pressure",
        frequency:   "Frequency",
        power:       "Power",
        plant:       "Plant type",
        "plant:source": "Energy source",
        output:      "Output",
        capacity:    "Capacity",
        "capacity:power": "Capacity",
        communication: "Communication",
        technology:  "Technology",
        provider:    "Provider",
        intermittent:"Intermittent",
    }

    const rows = Object.entries(FIELD_LABELS)
        .map(([k, label]) => {
            let v = props[k]
            if (!v) return null
            if (k === "voltage") v = v.split(";").map(n => `${(+n / 1000).toFixed(0)} kV`).join(" / ")
            return `<tr>
                <td style="color:#9AA4B5;padding:2px 10px 2px 0;white-space:nowrap">${label}</td>
                <td style="color:#E8ECF1">${v}</td>
            </tr>`
        })
        .filter(Boolean)
        .join("")

    return `<div style="
        font-family:Arial,sans-serif;font-size:12px;
        background:#131e2e;color:#E8ECF1;
        padding:10px 12px;border-radius:6px;
        border:1px solid #2C3645;min-width:180px;max-width:260px;
    ">
        <div style="color:${color};font-weight:bold;font-size:13px;
                    margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #2C3645">
            ${label}
        </div>
        ${rows
            ? `<table style="width:100%;border-collapse:collapse">${rows}</table>`
            : `<span style="color:#9AA4B5;font-size:11px">No additional data</span>`
        }
    </div>`
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

        const layer = L.vectorGrid.protobuf("/api/tiles/openinfra/{z}/{x}/{y}.pbf", {
            maxNativeZoom:       14,
            maxZoom:             20,
            minZoom:             2,
            attribution:         '&copy; <a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a>',
            vectorTileLayerStyles: styles,
            rendererFactory:     L.svg.tile,
            interactive:         true,
            getFeatureId:        f => f.properties.osm_id || f.properties.id,
        })

        layer.on("click", e => {
            const lyr  = e.layer
            const name = lyr.options?.layerName || ""
            const type = LAYER_TYPES[name]
            if (!type || !enabledTypes[type]) return
            L.popup({ maxWidth: 280, className: "infra-popup" })
                .setLatLng(e.latlng)
                .setContent(formatPopup(name, lyr.properties || {}))
                .openOn(map)
        })

        layer.addTo(map)
        layRef.current = layer

        return () => { layer.remove(); layRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, powerEnabled, telecomsEnabled, petroleumEnabled, waterEnabled, map])

    return null
}
