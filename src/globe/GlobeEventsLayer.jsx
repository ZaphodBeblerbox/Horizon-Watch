import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { makeTypedEventCanvas } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const TYPE_HEX = {
    missile:      "#ef4444",
    airstrike:    "#ef4444",
    assassination:"#ef4444",
    explosion:    "#f97316",
    armed_clash:  "#f97316",
    fight:        "#f97316",
    fire:         "#f97316",
    maritime:     "#3b82f6",
    protest:      "#eab308",
    earthquake:   "#a855f7",
    aviation:     "#38bdf8",
    energy:       "#facc15",
    medical:      "#22c55e",
}
const DEFAULT_HEX = "#64748b"

const TYPE_MAP = {
    missile:      "missile",
    airstrike:    "explosion",
    explosion:    "explosion",
    armed_clash:  "armed_clash",
    fight:        "armed_clash",
    maritime:     "maritime",
    protest:      "protest",
    earthquake:   "earthquake",
    fire:         "fire",
    aviation:     "aviation",
    energy:       "energy",
    medical:      "medical",
}

function hexForEvent(ev) {
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_HEX[t] || DEFAULT_HEX
}

function typeForEvent(ev) {
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_MAP[t] || "general"
}

const ICON_CACHE = {}
function getIcon(type, hex) {
    const key = `${type}-${hex}`
    if (!ICON_CACHE[key]) ICON_CACHE[key] = makeTypedEventCanvas(type, hex)
    return ICON_CACHE[key]
}

export default function GlobeEventsLayer({ enabled, bounds = null }) {
    const [events, setEvents] = useState([])

    useEffect(() => {
        if (!enabled) { setEvents([]); return }
        let cancelled = false
        const load = () => {
            let url = `${API_BASE}/api/v2/events?mode=threads&max_age_hours=72&limit=500`
            if (bounds && bounds.south != null) {
                url += `&south=${bounds.south.toFixed(3)}&north=${bounds.north.toFixed(3)}&west=${bounds.west.toFixed(3)}&east=${bounds.east.toFixed(3)}`
            }
            return fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled) setEvents(d?.events || []) })
                .catch(() => {})
        }
        load()
        const iv = setInterval(load, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled, bounds?.south, bounds?.north, bounds?.west, bounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    // Register in entityStore so GlobePopup can render GlobeEventPopup
    useEffect(() => {
        if (!events.length) return
        const ids = []
        events.forEach(ev => {
            const id = `event-${ev.thread_id || ev.id}`
            setEntity(id, "event", ev)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [events])

    if (!enabled || !events.length) return null

    return (
        <>
            {events.map(ev => {
                if (!ev.lat || !ev.lon || !isFinite(ev.lat) || !isFinite(ev.lon)) return null
                const hex   = hexForEvent(ev)
                const type  = typeForEvent(ev)
                const icon  = getIcon(type, hex)
                if (!icon || icon.width === 0 || icon.height === 0) return null
                // Approximate position (geocoded to city/region centroid) — smaller icon
                const approxConf = ev.location_confidence || ""
                const isApprox = approxConf === "fallback_region" || approxConf === "relaxed" || approxConf === "fallback_country"
                const iconSize = isApprox ? 32 : 44

                return (
                    <Entity
                        id={`event-${ev.thread_id || ev.id}`}
                        key={ev.thread_id || ev.id}
                        position={Cartesian3.fromDegrees(ev.lon, ev.lat, 0)}
                        billboard={{
                            image:      icon,
                            width:      iconSize,
                            height:     iconSize,
                            color:      isApprox ? Color.fromAlpha(Color.WHITE, 0.6) : undefined,
                            heightReference:          HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 8_000_000, 0.25),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            eyeOffset:  new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
