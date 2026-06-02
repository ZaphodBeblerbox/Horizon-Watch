import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { markerProps, getCachedCanvas } from "./markerRenderer.js"

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

export default function GlobeAlertsLayer({ enabled }) {
    const [alerts,  setAlerts]  = useState([])
    const [fusions, setFusions] = useState([])

    useEffect(() => {
        if (!enabled) { setAlerts([]); setFusions([]); return }
        let cancelled = false

        const loadAlerts = () =>
            fetch(`${API_BASE}/api/forge/alerts`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(d => { if (!cancelled) setAlerts(safeArray(d)) })
                .catch(() => {})

        const loadFusions = () =>
            fetch(`${API_BASE}/api/fusions?status=active`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(d => { if (!cancelled) setFusions(safeArray(d)) })
                .catch(() => {})

        loadAlerts(); loadFusions()
        const iv = setInterval(() => { loadAlerts(); loadFusions() }, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled])

    useEffect(() => {
        if (!alerts.length) return
        const ids = []
        alerts.forEach((a, i) => {
            const id = `alert-forge-${a.id || i}`
            let entityType
            if (a.source === "SENTINEL") {
                entityType = "sentinel_detection"
            } else {
                entityType = "alert"
            } else {
                entityType = "alert"
            }
            setEntity(id, entityType, {
                ...a,
                _idx:           i,
                // Normalise sentinel fields so SentinelDetectionPopup finds them
                detection_type:            a.detection_type || a.rule_type,
                confidence:                a.confidence,
                claude_severity:           a.severity,
                claude_vision_analysis:    a.claude_analysis || a.description,
                centroid_lat:              a.lat,
                centroid_lon:              a.lng ?? a.lon,
                nearest_asset_name:        a.nearest_asset_name,
                nearest_asset_distance_km: a.nearest_asset_distance_km,
                in_strategic_zone:         a.in_strategic_zone,
                created_at:                a.timestamp,
            })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [alerts])

    useEffect(() => {
        if (!fusions.length) return
        const ids = []
        fusions.forEach(f => {
            const id = `fusion-${f.fusion_id}`
            setEntity(id, "fusion", f)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [fusions])

    if (!enabled) return null

    // ── AIS whitelist: only render alerts that matter ─────────────────────────
    const AIS_WHITELIST = [
        "Sanctioned Vessel", "Ship-to-Ship Transfer", "Cable Loiterer",
        "Chokepoint Loitering", "Identity Change", "Vessel Cluster",
        "Course Reversal", "Formation Sailing", "Dark Ship", "ISR Pattern",
    ]
    const shouldRender = (a) => {
        if (!a.lat || !(a.lng ?? a.lon) || !isFinite(Number(a.lat))) return false
        const domain = (a.domain || a.source || "").toUpperCase()
        if (domain === "ADSB") return (a.relevance_score || 0) >= 70
        if (domain !== "AIS") return true
        const rule = a.rule_name || a.alert_type || ""
        if (!AIS_WHITELIST.some(r => rule.toLowerCase().includes(r.toLowerCase()))) return false
        if (rule.toLowerCase().includes("dark")) return (a.relevance_score || 0) >= 70
        return (a.relevance_score || 0) >= 50
    }

    const visibleAlerts  = alerts.filter(shouldRender)
    const visibleFusions = fusions.filter(f => f.lat != null && f.lon != null && isFinite(Number(f.lat)) && f.marker_visible !== false)

    return (
        <>
            {visibleAlerts.map((a, i) => {
                const lat = Number(a.lat)
                const lon = Number(a.lng ?? a.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const mp  = markerProps({ ...a, domain: (a.domain || a.source || "").toUpperCase() })
                const img = getCachedCanvas(mp.color, mp.size, mp.pulse, mp.signalCount)
                return (
                    <Entity
                        id={`alert-forge-${a.id || i}`}
                        key={a.id || i}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           img,
                            width:           mp.size,
                            height:          mp.size,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            scaleByDistance: new NearFarScalar(1000, 1.3, 12_000_000, 0.30),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                        }}
                    />
                )
            })}
            {visibleFusions.map(f => {
                const lat = Number(f.lat)
                const lon = Number(f.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const mp  = markerProps({ ...f, domain: "FUSION", fusion_id: f.fusion_id })
                const img = getCachedCanvas(mp.color, mp.size, mp.pulse, mp.signalCount)
                return (
                    <Entity
                        id={`fusion-${f.fusion_id}`}
                        key={f.fusion_id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           img,
                            width:           mp.size,
                            height:          mp.size,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            scaleByDistance: new NearFarScalar(1000, 1.4, 12_000_000, 0.30),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 25_000_000),
                        }}
                    />
                )
            })}
        </>
    )
}
