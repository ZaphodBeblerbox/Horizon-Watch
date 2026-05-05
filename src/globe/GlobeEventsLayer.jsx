import { useState, useEffect } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    HeightReference, NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"

const TYPE_HEX = {
    missile:      "#ef4444",
    airstrike:    "#ef4444",
    explosion:    "#f97316",
    armed_clash:  "#f97316",
    fight:        "#f97316",
    maritime:     "#3b82f6",
    protest:      "#eab308",
    earthquake:   "#a855f7",
    fire:         "#f97316",
    assassination:"#ef4444",
}
const DEFAULT_HEX = "#64748b"

function hexForEvent(ev) {
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_HEX[t] || DEFAULT_HEX
}

export default function GlobeEventsLayer({ enabled }) {
    const [events, setEvents] = useState([])

    useEffect(() => {
        if (!enabled) { setEvents([]); return }
        let cancelled = false
        fetch(`${API_BASE}/api/v2/events?mode=threads&max_age_hours=72&limit=500`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setEvents(d?.events || []) })
            .catch(() => {})
        const iv = setInterval(() => {
            fetch(`${API_BASE}/api/v2/events?mode=threads&max_age_hours=72&limit=500`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled) setEvents(d?.events || []) })
                .catch(() => {})
        }, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled])

    if (!enabled || !events.length) return null

    return (
        <>
            {events.map(ev => {
                if (!ev.lat || !ev.lon) return null
                const hex   = hexForEvent(ev)
                const color = Color.fromCssColorString(hex)
                const title = ev.headline || ev.title || "Event"
                const label = title.length > 38 ? title.slice(0, 38) + "…" : title
                let timeStr = ""
                try {
                    const d = ev.published_at || ev.published
                    if (d) timeStr = new Date(d).toUTCString().slice(0, 22)
                } catch {}
                return (
                    <Entity
                        key={ev.thread_id || ev.id}
                        position={Cartesian3.fromDegrees(ev.lon, ev.lat, 0)}
                        point={{
                            pixelSize: 7,
                            color,
                            outlineColor: Color.BLACK,
                            outlineWidth: 1,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.5, 8_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                        }}
                        label={{
                            text: label,
                            font: "10px Arial",
                            fillColor: Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style: 2,
                            pixelOffset: new Cartesian2(0, -12),
                            scaleByDistance: new NearFarScalar(1000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 600_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        description={`<div style="font-family:Arial;color:#E8ECF1;background:#1A2433;padding:12px;border:1px solid #2C3645;border-radius:6px;min-width:200px;max-width:280px">
                            <div style="color:${hex};font-weight:bold;font-size:13px;margin-bottom:4px">${title}</div>
                            <div style="font-size:10px;color:#9AA4B5;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">${(ev.event_type || ev.type || "").replace(/_/g, " ")}${ev.location ? " · " + ev.location : ""}</div>
                            ${ev.summary ? `<div style="font-size:11px;line-height:1.4;margin-bottom:8px">${ev.summary.slice(0, 200)}</div>` : ""}
                            ${timeStr ? `<div style="font-size:10px;color:#9AA4B5">${timeStr}</div>` : ""}
                        </div>`}
                    />
                )
            })}
        </>
    )
}
