import { Entity } from "resium"
import { Cartesian3, Cartesian2, Color, NearFarScalar, DistanceDisplayCondition } from "cesium"

function getAltColor(altFt) {
    if (!altFt || altFt <= 0)  return Color.GRAY
    if (altFt < 5000)          return Color.fromCssColorString("#E8B23A")
    if (altFt < 15000)         return Color.fromCssColorString("#5BC97F")
    if (altFt < 30000)         return Color.fromCssColorString("#4A9EE0")
    return                            Color.fromCssColorString("#6C9CE0")
}

export default function GlobeADSBLayer({ aircraft }) {
    if (!aircraft?.length) return null
    return (
        <>
            {aircraft.map(ac => {
                const lon = ac.lon ?? ac.longitude
                const lat = ac.lat ?? ac.latitude
                if (lat == null || lon == null) return null
                const alt  = ac.altitude ?? ac.baro_altitude ?? 0
                const altM = alt * 0.3048
                const color = getAltColor(alt)
                const hex   = color.toCssColorString()
                return (
                    <Entity
                        key={ac.icao24}
                        position={Cartesian3.fromDegrees(lon, lat, altM)}
                        point={{
                            pixelSize: 8,
                            color,
                            outlineColor: Color.BLACK,
                            outlineWidth: 1,
                            scaleByDistance: new NearFarScalar(1000, 1.5, 5_000_000, 0.4),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                        }}
                        label={{
                            text: ac.callsign || ac.icao24 || "",
                            font: "11px Arial",
                            fillColor: Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -16),
                            scaleByDistance: new NearFarScalar(1000, 1.0, 3_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 1_500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        polyline={{
                            positions: [
                                Cartesian3.fromDegrees(lon, lat, altM),
                                Cartesian3.fromDegrees(lon, lat, 0),
                            ],
                            width: 1,
                            material: color.withAlpha(0.25),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border:1px solid #2C3645;border-radius:6px;min-width:200px">
                            <div style="color:${hex};font-weight:bold;font-size:14px;margin-bottom:8px">${ac.callsign || ac.icao24}</div>
                            <table style="width:100%;font-size:12px;border-collapse:collapse">
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">ICAO</td><td>${ac.icao24}</td></tr>
                                ${ac.callsign ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Callsign</td><td>${ac.callsign}</td></tr>` : ""}
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Altitude</td><td>${alt?.toLocaleString() || "?"} ft</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Speed</td><td>${ac.velocity ?? ac.ground_speed ?? "?"} kn</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Heading</td><td>${ac.track ?? "?"}°</td></tr>
                                ${ac.vertical_rate != null ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Vertical</td><td>${ac.vertical_rate} ft/min</td></tr>` : ""}
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
