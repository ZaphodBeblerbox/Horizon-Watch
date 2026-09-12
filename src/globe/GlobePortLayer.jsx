import { useState, useEffect, useRef } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Ports are real, non-flagged maritime infrastructure — same shared
// "facility" glyph as GlobeAirportLayer.jsx (see that file's comment; both
// mirror src/inspector/adapters.js's adaptInfrastructure() collapse of every
// real infrastructure sub-type to entityType "facility"). Importance tier
// (Very Large/Large/Medium/Small) is still conveyed via size (ICON_SIZE
// below), unchanged from before.
function getIcon(portSize) {
    return getEntityMarkerDataUri({ entityType: "facility", size: 32 })
}

const ICON_SIZE = {
    "Very Large": 30,
    "Large":      26,
    "Medium":     22,
    "Small":      18,
}

export default function GlobePortLayer({ enabled, viewBounds }) {
    const [ports, setPorts] = useState([])
    const timerRef = useRef(null)

    useEffect(() => {
        if (!enabled) { setPorts([]); return }

        const fetch_ = () => {
            if (!viewBounds || viewBounds.south == null) {
                setPorts([])
                return
            }
            const { south, north, west, east } = viewBounds
            const url = `${API_BASE}/api/ports/in-viewport?min_lat=${south.toFixed(4)}&max_lat=${north.toFixed(4)}&min_lon=${west.toFixed(4)}&max_lon=${east.toFixed(4)}`
            fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setPorts(d.features || []) })
                .catch(() => {})
        }

        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(fetch_, 300)

        return () => clearTimeout(timerRef.current)
    }, [enabled, viewBounds?.south, viewBounds?.north, viewBounds?.west, viewBounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    // Register in entityStore so GlobePopup can dispatch on click
    useEffect(() => {
        if (!ports.length) return
        const ids = []
        ports.forEach(f => {
            const id = `port-${f.properties?.system_id}`
            setEntity(id, "port", f)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [ports])

    if (!enabled || !ports.length) return null

    return (
        <>
            {ports.map(f => {
                const p = f.properties || {}
                const [lon, lat] = f.geometry?.coordinates || []
                // Number.isFinite (isFinite(null) === true would let a
                // real [null, null] coordinate pair through) — same real
                // crash class fixed in GlobeConnectorLinesLayer.jsx.
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
                const icon = getIcon(p.port_size || "Small")
                if (!icon) return null
                const sz = ICON_SIZE[p.port_size] || 18

                return (
                    <Entity
                        id={`port-${p.system_id}`}
                        key={p.system_id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           sz,
                            height:          sz,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.2, 8_000_000, 0.2),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 10_000_000),
                            eyeOffset: new (Cartesian3)(0, 0, -80),
                        }}
                    />
                )
            })}
        </>
    )
}
