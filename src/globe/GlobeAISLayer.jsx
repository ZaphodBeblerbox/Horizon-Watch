import { useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, Ellipsoid,
    HeightReference, NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType, makeVesselCanvas, VESSEL_COLORS } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const ICON_CACHE = {}
function getIcon(shipType) {
    if (!ICON_CACHE[shipType]) ICON_CACHE[shipType] = makeVesselCanvas(shipType)
    return ICON_CACHE[shipType]
}

export default function GlobeAISLayer({ vessels }) {
    useEffect(() => {
        if (!vessels?.length) return
        const ids = []
        vessels.forEach(v => {
            if (v.mmsi) {
                setEntity(`ais-${v.mmsi}`, "vessel", v)
                ids.push(`ais-${v.mmsi}`)
            }
        })
        return () => ids.forEach(deleteEntity)
    }, [vessels])

    if (!vessels?.length) return null
    return (
        <>
            {vessels.map(v => {
                if (v.lat == null || v.lon == null || !isFinite(v.lat) || !isFinite(v.lon)) return null

                const shipType = vesselShipType(v)
                const icon     = getIcon(shipType)
                if (!icon || icon.width === 0 || icon.height === 0) return null

                const hex      = VESSEL_COLORS[shipType] || VESSEL_COLORS.other
                const hdg      = isFinite(Number(v.heading)) && Number(v.heading) !== 511
                    ? Number(v.heading)
                    : (v.cog ?? 0)
                const rotRad      = -(hdg * Math.PI / 180)
                const surfacePos  = Cartesian3.fromDegrees(v.lon, v.lat, 0)
                const alignedAxis = Ellipsoid.WGS84.geodeticSurfaceNormal(surfacePos, new Cartesian3())

                return (
                    <Entity
                        id={`ais-${v.mmsi}`}
                        key={v.mmsi}
                        position={surfacePos}
                        billboard={{
                            image:      icon,
                            width:      14,
                            height:     25,
                            rotation:   rotRad,
                            alignedAxis,
                            heightReference:          HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance:          new NearFarScalar(1000, 1.8, 5_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            eyeOffset:  new Cartesian3(0, 0, -100),
                        }}
                        label={{
                            text:       v.name || "",
                            font:       "11px Arial",
                            fillColor:  Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -22),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                    />
                )
            })}
        </>
    )
}
