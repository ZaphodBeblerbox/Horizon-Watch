import { useState, useEffect } from "react"
import { GeoJsonDataSource } from "resium"
import { Color } from "cesium"
import API_BASE from "../apiBase.js"

export default function GlobeEEZLayer({ enabled }) {
    const [geo, setGeo] = useState(null)

    useEffect(() => {
        if (!enabled || geo) return
        fetch(`${API_BASE}/geo/eez`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.features?.length) setGeo(d) })
            .catch(() => {})
    }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!enabled || !geo) return null

    return (
        <GeoJsonDataSource
            data={geo}
            stroke={Color.fromCssColorString("rgba(0,207,255,0.65)")}
            strokeWidth={1.5}
            fill={Color.TRANSPARENT}
            clampToGround={true}
        />
    )
}
