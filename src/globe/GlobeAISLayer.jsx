import { Entity } from "resium"
import { Cartesian3, Cartesian2, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"

function getVesselColor(v) {
    const t = (v.class || v.ship_type || "").toLowerCase()
    if (/military|naval|warship/i.test(t))     return Color.fromCssColorString("#E55757")
    if (/tanker/i.test(t))                      return Color.fromCssColorString("#E8B23A")
    if (/cargo/i.test(t))                       return Color.fromCssColorString("#5BC97F")
    if (/passenger/i.test(t))                   return Color.fromCssColorString("#4A9EE0")
    if (/fishing/i.test(t))                     return Color.fromCssColorString("#6C9CE0")
    if (/pleasure|leisure|yacht/i.test(t))      return Color.fromCssColorString("#9AA4B5")
    return                                              Color.fromCssColorString("#666666")
}

export default function GlobeAISLayer({ vessels }) {
    if (!vessels?.length) return null
    return (
        <>
            {vessels.map(v => {
                if (v.lat == null || v.lon == null) return null
                const color = getVesselColor(v)
                const hex   = color.toCssColorString()
                return (
                    <Entity
                        key={v.mmsi}
                        position={Cartesian3.fromDegrees(v.lon, v.lat, 0)}
                        point={{
                            pixelSize: 7,
                            color,
                            outlineColor: Color.BLACK,
                            outlineWidth: 1,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.5, 5_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                        }}
                        label={{
                            text: v.name || "",
                            font: "11px Arial",
                            fillColor: Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -14),
                            scaleByDistance: new NearFarScalar(1000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border:1px solid #2C3645;border-radius:6px;min-width:200px">
                            <div style="color:${hex};font-weight:bold;font-size:14px;margin-bottom:8px">${v.name || "Unknown Vessel"}</div>
                            <table style="width:100%;font-size:12px;border-collapse:collapse">
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">MMSI</td><td>${v.mmsi}</td></tr>
                                ${v.callsign ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Callsign</td><td>${v.callsign}</td></tr>` : ""}
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">SOG</td><td>${v.sog ?? "?"} kn</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">COG</td><td>${v.cog ?? "?"}°</td></tr>
                                ${v.heading != null ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Heading</td><td>${v.heading}°</td></tr>` : ""}
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Type</td><td>${v.class || v.ship_type || "Unknown"}</td></tr>
                                ${v.nav_status ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Status</td><td>${v.nav_status}</td></tr>` : ""}
                                ${v.destination ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Destination</td><td>${v.destination}</td></tr>` : ""}
                                ${v.length ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Dimensions</td><td>${v.length}m × ${v.beam || "?"}m</td></tr>` : ""}
                            </table>
                        </div>`}
                    />
                )
            })}
        </>
    )
}
