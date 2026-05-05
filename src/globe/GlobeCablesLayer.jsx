import { useState, useEffect } from "react"
import { GeoJsonDataSource } from "resium"
import { Color } from "cesium"

// Cable landing points are in a separate file — we only need the cable routes
const CABLE_URL = "/data/cable-geo.json"

export default function GlobeCablesLayer({ enabled }) {
    const [geo, setGeo] = useState(null)

    useEffect(() => {
        if (!enabled || geo) return
        fetch(CABLE_URL)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setGeo(d) })
            .catch(() => {})
    }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled || !geo) return null

    return (
        <GeoJsonDataSource
            data={geo}
            stroke={Color.fromCssColorString("rgba(0,207,255,0.55)")}
            strokeWidth={1.5}
            fill={Color.TRANSPARENT}
            clampToGround={true}
        />
    )
}
