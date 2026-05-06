import { useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    Transforms, HeadingPitchRoll, Math as CesiumMath,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { altColorHex } from "./iconUtils.js"
import { AIRCRAFT_ARROW_URI } from "./gltfUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

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
                if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null

                const alt    = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0
                const altNum = isFinite(Number(alt)) ? Number(alt) : 0
                const altM   = altNum * 0.3048
                const track  = isFinite(Number(ac.track ?? ac.heading)) ? Number(ac.track ?? ac.heading ?? 0) : 0
                const icao   = ac.icao ?? ac.icao24 ?? ""
                const cs     = (ac.flight || ac.callsign || "").trim()

                // Military aircraft always render red; others use altitude band colour
                const hexCol     = (ac.military || ac.interesting) ? "#FF5028" : altColorHex(altNum)
                const color      = Color.fromCssColorString(hexCol)
                const position   = Cartesian3.fromDegrees(lon, lat, altM)
                const hpr        = new HeadingPitchRoll(CesiumMath.toRadians(track), 0, 0)
                const orientation = Transforms.headingPitchRollQuaternion(position, hpr)

                return (
                    <Entity
                        id={`adsb-${icao}`}
                        key={icao || `${lat}-${lon}`}
                        position={position}
                        orientation={orientation}
                        model={{
                            uri:              AIRCRAFT_ARROW_URI,
                            color,
                            minimumPixelSize: 24,
                            maximumScale:     400,
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
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
                            positions: [position, Cartesian3.fromDegrees(lon, lat, 0)],
                            width:    1,
                            material: color.withAlpha(0.3),
                        }}
                    />
                )
            })}
        </>
    )
}
