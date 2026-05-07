import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { Cartesian3, Color, ArcType, DistanceDisplayCondition } from "cesium"
import { setEntity, deleteEntity } from "./entityStore.js"

const CABLE_URL = "/data/cable-geo.json"
const FALLBACK_COLOR = "#9B59B6"

export default function GlobeCablesLayer({ enabled }) {
    const { viewer } = useCesium()
    const entityIdsRef = useRef([])

    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            entityIdsRef.current.forEach(id => {
                const e = viewer.entities.getById(id)
                if (e) viewer.entities.remove(e)
                deleteEntity(id)
            })
            entityIdsRef.current = []
        }

        if (!enabled) { cleanup(); return }

        let cancelled = false

        fetch(CABLE_URL)
            .then(r => r.json())
            .then(geo => {
                if (cancelled || !geo?.features) return

                const ids = []

                geo.features.forEach((feature, fi) => {
                    const p = feature.properties || {}
                    const geom = feature.geometry
                    if (!geom) return

                    const name  = p.name  || "Unknown Cable"
                    const color = p.color || FALLBACK_COLOR
                    const cid   = p.feature_id || p.id || String(fi)
                    const mat   = Color.fromCssColorString(color).withAlpha(0.75)

                    const lines = geom.type === "MultiLineString"
                        ? geom.coordinates
                        : geom.type === "LineString"
                            ? [geom.coordinates]
                            : []

                    lines.forEach((coords, li) => {
                        if (coords.length < 2) return
                        const flat = coords.reduce((acc, [lon, lat]) => { acc.push(lon, lat); return acc }, [])
                        const positions = Cartesian3.fromDegreesArray(flat)
                        if (positions.length < 2) return

                        const entityId = `cable-${cid}-${li}`

                        if (!viewer.isDestroyed()) {
                            viewer.entities.add({
                                id: entityId,
                                polyline: {
                                    positions,
                                    width:                    2,
                                    material:                 mat,
                                    arcType:                  ArcType.GEODESIC,
                                    distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                                },
                            })

                            setEntity(entityId, "cable", { name, color, id: p.id || cid })
                            ids.push(entityId)
                        }
                    })
                })

                if (!cancelled) entityIdsRef.current = ids
            })
            .catch(() => {})

        return () => { cancelled = true; cleanup() }
    }, [viewer, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
