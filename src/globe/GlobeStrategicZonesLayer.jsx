import { useState, useEffect, useCallback } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Color,
    PolygonHierarchy, NearFarScalar,
    DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import GlobeStrategicZoneTooltip from "./GlobeStrategicZoneTooltip.jsx"

const ALPHA_FILL      = 0.12
const ALPHA_FILL_SEL  = 0.25
const ALPHA_OUTLINE   = 0.85
const ALPHA_LABEL     = 0.9

function parseColour(hex, alpha) {
    try {
        return Color.fromCssColorString(hex || "#FF9500").withAlpha(alpha)
    } catch {
        return Color.fromCssColorString("#FF9500").withAlpha(alpha)
    }
}

export default function GlobeStrategicZonesLayer({ enabled }) {
    const [zones,   setZones]   = useState([])
    const [tooltip, setTooltip] = useState(null) // { zone, x, y }

    const load = useCallback(() => {
        fetch(`${API_BASE}/api/strategic-zones?enabled_only=true`)
            .then(r => r.ok ? r.json() : [])
            .then(setZones)
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (!enabled) return
        load()
        const id = setInterval(load, 120_000)
        return () => clearInterval(id)
    }, [enabled, load])

    if (!enabled || !zones.length) return null

    const selectedId = tooltip?.zone?.zone_id ?? null

    return (
        <>
            {zones.map(z => {
                const coords = z.coordinates || []
                if (coords.length < 3) return null

                const positions = coords
                    .filter(c => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]))
                    .map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0))

                if (positions.length < 3) return null

                const isSel   = selectedId === z.zone_id
                const fill    = parseColour(z.colour, isSel ? ALPHA_FILL_SEL : ALPHA_FILL)
                const outline = parseColour(z.colour, ALPHA_OUTLINE)

                return (
                    <Entity
                        key={z.zone_id}
                        id={`szone-${z.zone_id}`}
                        name={z.name}
                        polygon={{
                            hierarchy:    new PolygonHierarchy(positions),
                            material:     fill,
                            outline:      true,
                            outlineColor: outline,
                            outlineWidth: isSel ? 3.0 : 1.5,
                            height:       0,
                            classificationType: 0,
                        }}
                        label={{
                            text:               z.name,
                            font:               "500 11px Inter, sans-serif",
                            fillColor:          Color.WHITE.withAlpha(ALPHA_LABEL),
                            outlineColor:       Color.BLACK.withAlpha(0.6),
                            outlineWidth:       2,
                            style:              2,
                            pixelOffset:        { x: 0, y: 0 },
                            scaleByDistance:    new NearFarScalar(500_000, 1.0, 4_000_000, 0.55),
                            translucencyByDistance: new NearFarScalar(500_000, 1.0, 5_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 5_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            showBackground:     true,
                            backgroundColor:    parseColour(z.colour, 0.22),
                            backgroundPadding:  { x: 6, y: 3 },
                        }}
                        position={Cartesian3.fromDegrees(z.lon, z.lat, 0)}
                        onClick={(movement) => {
                            const pos = movement?.position
                            const sx  = pos?.x ?? window.innerWidth  / 2
                            const sy  = pos?.y ?? window.innerHeight / 2
                            setTooltip(prev =>
                                prev?.zone?.zone_id === z.zone_id
                                    ? null
                                    : { zone: z, x: sx, y: sy }
                            )
                        }}
                    />
                )
            })}

            {tooltip && (
                <GlobeStrategicZoneTooltip
                    zone={tooltip.zone}
                    x={tooltip.x}
                    y={tooltip.y}
                    onClose={() => setTooltip(null)}
                />
            )}
        </>
    )
}
