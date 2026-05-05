import { Entity } from "resium"
import { Cartesian3, Cartesian2, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"

const SEV_COLORS = {
    critical:    "#E55757",
    significant: "#E8B23A",
    elevated:    "#4A9EE0",
    low:         "#6C9CE0",
}

function sevColor(item) {
    return Color.fromCssColorString(SEV_COLORS[item.severity_tier] || SEV_COLORS.elevated)
}

export default function GlobeAlertLayer({ alerts }) {
    if (!alerts?.length) return null
    const geo = alerts.filter(a =>
        a.lat != null && a.lon != null &&
        isFinite(a.lat) && isFinite(a.lon)
    )
    if (!geo.length) return null
    return (
        <>
            {geo.map(a => {
                const color = sevColor(a)
                const hex   = color.toCssColorString()
                const r     = a.radius || 6000
                let timeStr = ""
                try {
                    const d = a.published_at || a.published
                    if (d) timeStr = new Date(d).toUTCString().slice(0, 22)
                } catch {}
                return (
                    <Entity
                        key={a.id}
                        position={Cartesian3.fromDegrees(a.lon, a.lat, 0)}
                        ellipse={{
                            semiMinorAxis: r,
                            semiMajorAxis: r,
                            material: color.withAlpha(0.12),
                            outline: true,
                            outlineColor: color.withAlpha(0.7),
                            outlineWidth: 2,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                        }}
                        point={{
                            pixelSize: 10,
                            color,
                            outlineColor: Color.WHITE,
                            outlineWidth: 2,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.5, 10_000_000, 0.5),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                        }}
                        label={{
                            text: a.headline || a.title || a.type || "Alert",
                            font: "bold 12px Arial",
                            fillColor: color,
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -20),
                            scaleByDistance: new NearFarScalar(1000, 1.0, 5_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 3_000_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.9),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border:1px solid #2C3645;border-radius:6px;min-width:200px">
                            <div style="color:${hex};font-weight:bold;font-size:13px;margin-bottom:6px">${a.headline || a.title || "Alert"}</div>
                            <div style="font-size:11px;color:#9AA4B5;margin-bottom:8px">${a.type || ""}${a.type && a.location ? " · " : ""}${a.location || ""}</div>
                            ${a.summary ? `<div style="font-size:12px;margin-bottom:8px;line-height:1.4">${a.summary}</div>` : ""}
                            <table style="width:100%;font-size:11px;border-collapse:collapse">
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Severity</td><td style="color:${hex}">${a.severity_tier || "?"}</td></tr>
                                <tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Position</td><td>${a.lat?.toFixed(3)}, ${a.lon?.toFixed(3)}</td></tr>
                                ${timeStr ? `<tr><td style="color:#9AA4B5;padding:2px 8px 2px 0">Time</td><td>${timeStr}</td></tr>` : ""}
                            </table>
                        </div>`}
                    />
                )
            })}
        </>
    )
}
