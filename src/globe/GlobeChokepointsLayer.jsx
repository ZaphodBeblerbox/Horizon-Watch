import { useState, useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, HeightReference,
    PolygonHierarchy, ClassificationType,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { getMarkerCanvas, AFFILIATION, ENTITY_FUNCTION } from "./markerRenderer.js"
import { setEntity, deleteEntity } from "./entityStore.js"

// Chokepoints previously had no point marker at all — just the polygon +
// text label below, which disappears at typical zoomed-out camera heights.
// A small Zone/AOI billboard (see markerRenderer.js — a documented extension
// since the real boundary is drawn as the polygon, not this point icon)
// keeps the chokepoint visible/clickable at any zoom level. Lazily built
// (not at module load) so importing this file never touches the DOM.
let _chokeIcon = null
function getChokeIcon() {
    if (!_chokeIcon) {
        _chokeIcon = getMarkerCanvas({ affiliation: AFFILIATION.NEUTRAL, entityFunction: ENTITY_FUNCTION.ZONE, size: 26 })
    }
    return _chokeIcon
}

export default function GlobeChokepointsLayer({ enabled }) {
    const [data, setData] = useState([])

    useEffect(() => {
        if (!enabled) return
        fetch(`${API_BASE}/api/infrastructure/chokepoints`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setData(d?.chokepoints || []))
            .catch(() => {})
    }, [enabled])

    // Register entities for click handling via GlobePopup
    useEffect(() => {
        if (!data.length) return
        const ids = []
        data.forEach(c => {
            const id = `choke-${c.id ?? c.system_id ?? c.name}`
            setEntity(id, "chokepoint", {
                ...c,
                system_id: c.system_id || c.id || c.name?.toLowerCase().replace(/\s+/g, "-"),
            })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [data])

    if (!enabled || !data.length) return null

    return (
        <>
            {data.map(c => {
                const lat  = c.lat  ?? c.center?.[0]
                const lon  = c.lon  ?? c.center?.[1]
                const name = c.name ?? "Chokepoint"
                if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null

                const id   = c.id ?? c.system_id ?? name
                const entityId = `choke-${id}`

                const polyPositions = Array.isArray(c.polygon)
                    ? c.polygon
                        .filter(p => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
                        .map(([plat, plon]) => Cartesian3.fromDegrees(plon, plat, 0))
                    : []

                return (
                    <Entity
                        id={entityId}
                        key={entityId}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           getChokeIcon(),
                            width:           26,
                            height:          26,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.2, 8_000_000, 0.25),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 10_000_000),
                        }}
                        polygon={polyPositions.length >= 3 ? {
                            hierarchy:          new PolygonHierarchy(polyPositions),
                            material:           Color.fromCssColorString("#FF6D00").withAlpha(0.12),
                            outline:            true,
                            outlineColor:       Color.fromCssColorString("#FF6D00").withAlpha(0.8),
                            outlineWidth:       2,
                            height:             0,
                            classificationType: ClassificationType.TERRAIN,
                        } : undefined}
                        label={{
                            text:             name,
                            font:             "bold 11px Arial",
                            fillColor:        Color.fromCssColorString("#FF6D00"),
                            outlineColor:     Color.fromCssColorString("#0F1721"),
                            outlineWidth:     2,
                            style:            2,
                            pixelOffset:      new Cartesian2(0, -14),
                            scaleByDistance:           new NearFarScalar(1000, 1.0, 5_000_000, 0.3),
                            distanceDisplayCondition:  new DistanceDisplayCondition(0, 4_000_000),
                            showBackground:   true,
                            backgroundColor:  Color.fromCssColorString("#0F1721").withAlpha(0.85),
                        }}
                    />
                )
            })}
        </>
    )
}
