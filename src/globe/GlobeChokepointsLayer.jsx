import { useState, useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    HeightReference, NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { makeChokepointCanvas } from "./iconUtils.js"

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
                const lat  = c.lat  ?? c.center?.[0] ?? c.properties?.lat
                const lon  = c.lon  ?? c.center?.[1] ?? c.properties?.lon
                const name = c.name ?? c.properties?.name ?? "Chokepoint"
                if (lat == null || lon == null) return null
                const desc = c.description ?? c.properties?.description ?? ""
                return (
                    <Entity
                        id={`choke-${c.id ?? name}`}
                        key={c.id ?? name}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:      makeChokepointCanvas(),
                            width:      24,
                            height:     24,
                            heightReference:          HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance:          new NearFarScalar(1000, 1.5, 10_000_000, 0.5),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                            eyeOffset:  new Cartesian3(0, 0, -100),
                        }}
                        label={{
                            text:       name,
                            font:       "bold 11px Arial",
                            fillColor:  Color.fromCssColorString("#FF6D00"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -20),
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
