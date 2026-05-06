import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, Ellipsoid,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { acClassify, aircraftSvgUri, altColorHex } from "./iconUtils.js"

const ICON_CACHE = {}
function getIcon(type) {
    if (!ICON_CACHE[type]) ICON_CACHE[type] = aircraftSvgUri(type)
    return ICON_CACHE[type]
}

export default function GlobeADSBLayer({ aircraft }) {
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

                const type     = acClassify(ac)
                const hexCol   = altColorHex(altNum)
                const color    = Color.fromCssColorString(hexCol)
                const rotRad   = -(track * Math.PI / 180)
                // Surface normal → billboard lies flat on globe
                const surfacePos = Cartesian3.fromDegrees(lon, lat, 0)
                const alignedAxis = Ellipsoid.WGS84.geodeticSurfaceNormal(surfacePos, new Cartesian3())

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
                            scaleByDistance:            new NearFarScalar(1000, 1.6, 8_000_000, 0.35),
                            distanceDisplayCondition:   new DistanceDisplayCondition(0, 20_000_000),
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
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border-radius:6px;min-width:200px">
                            <div style="color:${hexCol};font-weight:bold;font-size:14px;margin-bottom:8px">${cs || icao}</div>
                            <table style="width:100%;font-size:12px;border-collapse:collapse">
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">ICAO</td><td>${icao}</td></tr>
                                ${cs ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Callsign</td><td>${cs}</td></tr>` : ""}
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Altitude</td><td>${altNum ? altNum.toLocaleString() + " ft" : "?"}</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Speed</td><td>${gs != null ? Math.round(gs) + " kts" : "?"}</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Track</td><td>${track}°</td></tr>
                                ${ac.squawk ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Squawk</td><td>${ac.squawk}</td></tr>` : ""}
                                ${ac.origin_country ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Origin</td><td>${ac.origin_country}</td></tr>` : ""}
                            </table>
                        </div>`}
                    />
                )
            })}
        </>
    )
}
