import { useState, useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    PolygonHierarchy, ClassificationType,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"

export default function GlobeChokepointsLayer({ enabled }) {
    const [data, setData] = useState([])

    useEffect(() => {
        if (!enabled) return
        fetch(`${API_BASE}/api/infrastructure/chokepoints`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setData(d?.chokepoints || []))
            .catch(() => {})
    }, [enabled])

    if (!enabled || !data.length) return null

    return (
        <>
            {data.map(c => {
                const lat  = c.lat  ?? c.center?.[0]
                const lon  = c.lon  ?? c.center?.[1]
                const name = c.name ?? "Chokepoint"
                if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null

                const id   = c.id ?? name
                const desc = c.strategic_description ?? c.description ?? ""

                // c.polygon is [[lat,lon], ...] — note lat/lon order
                const polyPositions = Array.isArray(c.polygon)
                    ? c.polygon
                        .filter(p => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
                        .map(([plat, plon]) => Cartesian3.fromDegrees(plon, plat, 0))
                    : []

                return (
                    <Entity
                        id={`choke-${id}`}
                        key={id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        polygon={polyPositions.length >= 3 ? {
                            hierarchy:      new PolygonHierarchy(polyPositions),
                            material:       Color.fromCssColorString("#FF6D00").withAlpha(0.12),
                            outline:        true,
                            outlineColor:   Color.fromCssColorString("#FF6D00").withAlpha(0.8),
                            outlineWidth:   2,
                            height:         0,
                            classificationType: ClassificationType.TERRAIN,
                        } : undefined}
                        label={{
                            text:       name,
                            font:       "bold 11px Arial",
                            fillColor:  Color.fromCssColorString("#FF6D00"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -14),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 5_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 4_000_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.85),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border-radius:6px;min-width:180px">
                            <div style="color:#FF6D00;font-weight:bold;font-size:14px;margin-bottom:6px">◆ ${name}</div>
                            ${desc ? `<div style="font-size:12px;line-height:1.4;margin-bottom:6px">${desc}</div>` : ""}
                            <div style="font-size:10px;color:#9AA4B5">${lat.toFixed(3)}°, ${lon.toFixed(3)}°</div>
                        </div>`}
                    />
                )
            })}
        </>
    )
}
