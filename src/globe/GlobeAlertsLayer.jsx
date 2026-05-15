import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { makeAlertCanvas, makeAssessmentCanvas, makeFusionCanvas } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { ALERT_ICONS, NEWS_PATTERN_ICON_KEYS } from "../constants/alertIcons.js"

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
        "X-Forge-Passcode": localStorage.getItem("forge_passcode") || "",
    }
}

const ICON_CACHE = {}

function alertIcon(a) {
    const iconType = a.icon_type || ""
    const severity = a.severity || "medium"

    // News assessment — diamond icon with pattern colour
    if (NEWS_PATTERN_ICON_KEYS.has(iconType)) {
        const color = ALERT_ICONS[iconType]?.color || "#FF6B35"
        const key   = `assess-${iconType}-${severity}`
        if (!ICON_CACHE[key]) ICON_CACHE[key] = makeAssessmentCanvas(color, severity)
        return ICON_CACHE[key]
    }

    // Standard forge alert — source-coloured circle
    const key = `${a.source || "NEWS"}-${severity}`
    if (!ICON_CACHE[key]) ICON_CACHE[key] = makeAlertCanvas(a.source || "NEWS", severity)
    return ICON_CACHE[key]
}

// Scale billboard by severity for assessment markers
function severityScale(severity) {
    if (severity === "critical") return 1.4
    if (severity === "high")     return 1.2
    if (severity === "medium")   return 1.0
    return 0.85
}

const FUSION_SCALE = { critical: 1.8, high: 1.5, medium: 1.2 }

function fusionIcon(severity) {
    const key = `fusion-${severity}`
    if (!ICON_CACHE[key]) ICON_CACHE[key] = makeFusionCanvas(severity)
    return ICON_CACHE[key]
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
            const entityType = NEWS_PATTERN_ICON_KEYS.has(a.icon_type || "") ? "assessment" : "alert"
            setEntity(id, entityType, { ...a, _idx: i })
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

    const visibleAlerts  = alerts.filter(a => a.lat != null && (a.lng ?? a.lon) != null && isFinite(Number(a.lat)))
    const visibleFusions = fusions.filter(f => f.lat != null && f.lon != null && isFinite(Number(f.lat)) && f.marker_visible !== false)

    return (
        <>
            {visibleAlerts.map((a, i) => {
                const lat = Number(a.lat)
                const lon = Number(a.lng ?? a.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const icon  = alertIcon(a)
                if (!icon) return null
                const isAssessment = NEWS_PATTERN_ICON_KEYS.has(a.icon_type || "")
                const baseSize = isAssessment ? 40 : 38
                const scale    = isAssessment ? severityScale(a.severity) : 1.0
                return (
                    <Entity
                        id={`alert-forge-${a.id || i}`}
                        key={a.id || i}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           Math.round(baseSize * scale),
                            height:          Math.round(baseSize * scale),
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.3, 12_000_000, 0.28),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                            eyeOffset: isAssessment ? new (Cartesian3)(0, 0, -60) : undefined,
                        }}
                    />
                )
            })}
            {visibleFusions.map(f => {
                const lat   = Number(f.lat)
                const lon   = Number(f.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const sev   = f.severity || "medium"
                const scale = FUSION_SCALE[sev] || 1.2
                const sz    = Math.round(56 * scale)
                const icon  = fusionIcon(sev)
                return (
                    <Entity
                        id={`fusion-${f.fusion_id}`}
                        key={f.fusion_id}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           sz,
                            height:          sz,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.4, 12_000_000, 0.30),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 25_000_000),
                            eyeOffset: new (Cartesian3)(0, 0, -80),
                        }}
                    />
                )
            })}
        </>
    )
}
