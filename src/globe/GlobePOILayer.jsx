import { useState, useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    HeightReference, NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { poiSvgUri } from "./iconUtils.js"

const CAT_HEX = {
    military:       "#E55757",
    infrastructure: "#E8B23A",
    government:     "#CE93D8",
    transport:      "#00BCD4",
    medical:        "#FF4081",
}
const DEFAULT_HEX = "#4A9EE0"

function hexForPoi(poi) {
    const c = (poi.category || "").toLowerCase()
    for (const [k, v] of Object.entries(CAT_HEX)) {
        if (c.includes(k)) return v
    }
    return DEFAULT_HEX
}

const ICON_CACHE = {}
function getIcon(hex) {
    if (!ICON_CACHE[hex]) ICON_CACHE[hex] = poiSvgUri(hex)
    return ICON_CACHE[hex]
}

export default function GlobePOILayer({ enabled }) {
    const [pois, setPois] = useState([])

    useEffect(() => {
        if (!enabled) { setPois([]); return }
        fetch(`${API_BASE}/api/poi`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setPois(Array.isArray(d) ? d : []))
            .catch(() => {})
    }, [enabled])

    if (!enabled || !pois.length) return null

    return (
        <>
            {pois.map(p => {
                const lat = p.lat ?? p.location?.lat
                const lon = p.lon ?? p.location?.lon
                if (lat == null || lon == null) return null
                const hex = hexForPoi(p)
                return (
                    <Entity
                        id={`poi-${p.id}`}
                        key={p.id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image: getIcon(hex),
                            width: 20,
                            height: 24,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.5, 5_000_000, 0.4),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 10_000_000),
                            eyeOffset: new Cartesian3(0, 0, -100),
                        }}
                        label={{
                            text: p.name || "",
                            font: "11px Arial",
                            fillColor: Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -18),
                            scaleByDistance: new NearFarScalar(1000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 800_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border:1px solid #2C3645;border-radius:6px;min-width:180px">
                            <div style="color:${hex};font-weight:bold;font-size:14px;margin-bottom:6px">${p.name || "POI"}</div>
                            ${p.category ? `<div style="font-size:10px;color:#9AA4B5;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${p.category}</div>` : ""}
                            ${p.notes || p.description ? `<div style="font-size:12px;line-height:1.4;margin-bottom:6px">${p.notes || p.description}</div>` : ""}
                            <div style="font-size:10px;color:#9AA4B5">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</div>
                        </div>`}
                    />
                )
            })}
        </>
    )
}
