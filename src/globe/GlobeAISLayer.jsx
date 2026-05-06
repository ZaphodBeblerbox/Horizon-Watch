import { useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType, makeVesselCanvas, VESSEL_COLORS } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const ICON_CACHE = {}
function getIcon(type) {
    if (!ICON_CACHE[type]) ICON_CACHE[type] = makeVesselCanvas(type)
    return ICON_CACHE[type]
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
                const hex      = VESSEL_COLORS[shipType] || VESSEL_COLORS.other
                const color    = Color.fromCssColorString(hex)

                const hdg = isFinite(Number(v.heading)) && Number(v.heading) !== 511
                    ? Number(v.heading)
                    : isFinite(Number(v.cog)) ? Number(v.cog) : 0

                const rotRad  = -(hdg * Math.PI / 180)
                const position = Cartesian3.fromDegrees(v.lon, v.lat, 0)

                const icon = getIcon(shipType)
                if (!icon || icon.width === 0 || icon.height === 0) return null

                return (
                    <Entity
                        id={`ais-${v.mmsi}`}
                        key={v.mmsi}
                        position={position}
                        billboard={{
                            image:    icon,
                            width:    24,
                            height:   24,
                            rotation: rotRad,
                            color,
                            scaleByDistance:          new NearFarScalar(1000, 1.6, 8_000_000, 0.35),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            eyeOffset: new Cartesian3(0, 0, -100),
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
