import { useState, useEffect, useRef } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { getMarkerCanvas, AFFILIATION, ENTITY_FUNCTION } from "./markerRenderer.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Airports are real, non-flagged aviation infrastructure — Neutral (square)
// affiliation frame with the airfield glyph (see markerRenderer.js).
// Importance tier is conveyed via size (ICON_SIZE below), same as before.
function getIcon() {
    return getMarkerCanvas({
        affiliation:    AFFILIATION.NEUTRAL,
        entityFunction: ENTITY_FUNCTION.INFRA_AIRPORT,
        size: 32,
    })
}

// Icon size varies by airport importance
const ICON_SIZE = {
    large_airport:  34,
    medium_airport: 28,
    small_airport:  22,
    seaplane_base:  26,
}

export default function GlobeAirportLayer({ enabled, viewBounds }) {
    const [airports, setAirports] = useState([])
    const timerRef = useRef(null)

    useEffect(() => {
        if (!enabled) { setAirports([]); return }

        const fetch_ = () => {
            let url
            if (viewBounds && viewBounds.south != null) {
                const { south, north, west, east } = viewBounds
                url = `${API_BASE}/api/airports/in-viewport?min_lat=${south.toFixed(4)}&max_lat=${north.toFixed(4)}&min_lon=${west.toFixed(4)}&max_lon=${east.toFixed(4)}`
            } else {
                // No bounds yet (zoomed out to whole globe) — skip fetch; too many results
                setAirports([])
                return
            }
            fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setAirports(d.features || []) })
                .catch(() => {})
        }

        // Debounce: viewBounds changes fire rapidly during panning
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(fetch_, 300)

        return () => clearTimeout(timerRef.current)
    }, [enabled, viewBounds?.south, viewBounds?.north, viewBounds?.west, viewBounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    // Register in entityStore so GlobePopup can dispatch on click
    useEffect(() => {
        if (!airports.length) return
        const ids = []
        airports.forEach(f => {
            const id = `airport-${f.properties?.system_id}`
            setEntity(id, "airport", f)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [airports])

    if (!enabled || !airports.length) return null

    return (
        <>
            {airports.map(f => {
                const p = f.properties || {}
                const [lon, lat] = f.geometry?.coordinates || []
                if (!isFinite(lat) || !isFinite(lon)) return null
                const icon = getIcon(p.airport_type || "small_airport")
                if (!icon) return null
                const sz = ICON_SIZE[p.airport_type] || 22

                return (
                    <Entity
                        id={`airport-${p.system_id}`}
                        key={p.system_id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           sz,
                            height:          sz,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.2, 10_000_000, 0.2),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000),
                            eyeOffset: new (Cartesian3)(0, 0, -80),
                        }}
                    />
                )
            })}
        </>
    )
}
