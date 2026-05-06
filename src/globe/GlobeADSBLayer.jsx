import { useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { acClassify, makeAircraftCanvas, altColorHex } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const ICON_CACHE = {}
function getIcon(type) {
    if (!ICON_CACHE[type]) ICON_CACHE[type] = makeAircraftCanvas(type)
    return ICON_CACHE[type]
}

export default function GlobeADSBLayer({ aircraft }) {
    useEffect(() => {
        if (!aircraft?.length) return
        const ids = []
        aircraft.forEach(ac => {
            const icao = ac.icao ?? ac.icao24 ?? ""
            if (icao) {
                setEntity(`adsb-${icao}`, "aircraft", ac)
                ids.push(`adsb-${icao}`)
            }
        })
        return () => ids.forEach(deleteEntity)
    }, [aircraft])

    if (!aircraft?.length) return null
    return (
        <>
            {aircraft.map(ac => {
                const lon = ac.lon ?? ac.longitude
                const lat = ac.lat ?? ac.latitude
                if (lat == null || lon == null) return null

                const alt    = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0
                const altNum = typeof alt === "number" && !isNaN(alt) ? alt : 0
                const altM   = altNum * 0.3048
                const track  = ac.track ?? ac.heading ?? 0
                const gs     = ac.gs ?? ac.velocity ?? ac.ground_speed
                const icao   = ac.icao ?? ac.icao24 ?? ""
                const cs     = (ac.flight || ac.callsign || "").trim()

                const type    = acClassify(ac)
                const hexCol  = altColorHex(altNum)
                const color   = Color.fromCssColorString(hexCol)
                const rotRad  = -(track * Math.PI / 180)
                const alignedAxis = Cartesian3.normalize(
                    Cartesian3.fromDegrees(lon, lat, altM),
                    new Cartesian3()
                )

                return (
                    <Entity
                        id={`adsb-${icao}`}
                        key={icao || `${lat}-${lon}`}
                        position={Cartesian3.fromDegrees(lon, lat, altM)}
                        billboard={{
                            image:      getIcon(type),
                            width:      28,
                            height:     28,
                            rotation:   rotRad,
                            alignedAxis,
                            scaleByDistance:          new NearFarScalar(1000, 1.6, 8_000_000, 0.35),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                            eyeOffset:  new Cartesian3(0, 0, -100),
                        }}
                        label={{
                            text:       cs || icao,
                            font:       "12px Arial",
                            fillColor:  Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -20),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 3_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 1_500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        polyline={{
                            positions: [
                                Cartesian3.fromDegrees(lon, lat, altM),
                                Cartesian3.fromDegrees(lon, lat, 0),
                            ],
                            width:    1,
                            material: color.withAlpha(0.25),
                        }}
                    />
                )
            })}
        </>
    )
}
