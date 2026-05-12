import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { makeAlertCanvas } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

const ICON_CACHE = {}
function alertIcon(source, severity) {
    const key = `${source}-${severity}`
    if (!ICON_CACHE[key]) ICON_CACHE[key] = makeAlertCanvas(source, severity)
    return ICON_CACHE[key]
}

export default function GlobeAlertsLayer({ enabled }) {
    const [alerts, setAlerts] = useState([])

    useEffect(() => {
        if (!enabled) { setAlerts([]); return }
        let cancelled = false
        const load = () =>
            fetch(`${API_BASE}/api/forge/alerts`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(d => { if (!cancelled) setAlerts(Array.isArray(d) ? d : []) })
                .catch(() => {})
        load()
        const iv = setInterval(load, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled])

    useEffect(() => {
        if (!alerts.length) return
        const ids = []
        alerts.forEach((a, i) => {
            const id = `alert-forge-${a.id || i}`
            setEntity(id, "alert", { ...a, _idx: i })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [alerts])

    if (!enabled) return null
    const visible = alerts.filter(a => a.lat != null && (a.lng ?? a.lon) != null && isFinite(Number(a.lat)))
    if (!visible.length) return null

    return (
        <>
            {visible.map((a, i) => {
                const lat = Number(a.lat)
                const lon = Number(a.lng ?? a.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const icon = alertIcon(a.source || "NEWS", a.severity || "medium")
                if (!icon) return null
                return (
                    <Entity
                        id={`alert-forge-${a.id || i}`}
                        key={a.id || i}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           38,
                            height:          38,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.3, 12_000_000, 0.28),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                        }}
                    />
                )
            })}
        </>
    )
}
