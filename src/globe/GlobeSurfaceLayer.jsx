import { Entity } from "resium"
import { Cartesian3, Color } from "cesium"

const SEVERITY_COLORS = {
    critical:    "#ff4444",
    significant: "#ff8c00",
    elevated:    "#ffaa00",
    low:         "#4A9EE0",
}

export default function GlobeSurfaceLayer({ items }) {
    if (!items?.length) return null
    return (
        <>
            {items.map(item => {
                if (item.lat == null || item.lon == null) return null
                const hex = SEVERITY_COLORS[item.severity_tier] || "#9AA4B5"
                return (
                    <Entity
                        key={item.id}
                        position={Cartesian3.fromDegrees(item.lon, item.lat)}
                        point={{ pixelSize: 7, color: Color.fromCssColorString(hex), outlineColor: Color.BLACK, outlineWidth: 1 }}
                        name={item.headline || item.title || "Event"}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:10px;border-radius:6px;min-width:200px">
                            <strong style="color:${hex}">${item.headline || item.title || "Event"}</strong><br/>
                            <span style="font-size:11px;color:#9AA4B5">${item.type || ""} · ${item.location || ""}</span><br/>
                            ${item.summary ? `<p style="font-size:12px;margin:6px 0 0">${item.summary}</p>` : ""}
                        </div>`}
                    />
                )
            })}
        </>
    )
}
