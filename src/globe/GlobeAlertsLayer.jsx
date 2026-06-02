import { useState, useEffect, useRef } from "react"
import { Entity } from "resium"
import { Cartesian2, Cartesian3, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { makeAlertCanvas, makeAssessmentCanvas, makeFusionCanvas } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { ALERT_ICONS } from "../constants/alertIcons.js"
import { markerProps, getCachedCanvas } from "./markerRenderer.js"

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
    if (a.domain === "NEWS" && iconType && ALERT_ICONS[iconType]) {
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

function isSanctioned(a) {
    return (a.alert_type || a.rule_name || "").toLowerCase().includes("sanctioned vessel")
}
function isSts(a) {
    return (a.alert_type || a.rule_name || "").toLowerCase().includes("ship-to-ship")
}

// Visual hierarchy scale based on alert type / severity / relevance
function getMarkerScale(a) {
    if (isSanctioned(a))                                       return 2.0
    if (isSts(a))                                              return 1.6
    const sev = (a.severity || "").toLowerCase()
    const rel = a.relevance_score ?? 0
    if (sev === "critical" || rel >= 80)                       return 1.6
    if (sev === "high"     || rel >= 50)                       return 1.2
    if (sev === "low"      || (rel > 0 && rel < 30))           return 0.8
    return 1.0
}

function getMarkerOpacity(a) {
    if (isSanctioned(a) || isSts(a)) return 1.0
    const sev = (a.severity || "").toLowerCase()
    if (sev === "critical" || sev === "high") return 1.0
    if (sev === "medium")                     return 0.85
    return 0.5
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
    const sanctionedMmsiRef = useRef(new Set())

    // Load sanctions MMSI list once on mount
    useEffect(() => {
        fetch(`${API_BASE}/api/sanctions/mmsi-list`)
            .then(r => r.ok ? r.json() : { mmsi_list: [] })
            .then(d => { sanctionedMmsiRef.current = new Set(d.mmsi_list || []) })
            .catch(() => {})
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
            } else if (a.domain === "NEWS" && a.icon_type && ALERT_ICONS[a.icon_type]) {
                entityType = "assessment"
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

    // Deduplicate by id before rendering — backend can return duplicates which
    // cause Cesium "entity already exists" crashes and React duplicate-key warnings
    const _seenIds = new Set()
    const visibleAlerts = alerts.filter(a => {
        if (a.lat == null || (a.lng ?? a.lon) == null || !isFinite(Number(a.lat))) return false
        const id = a.id || a.alert_id
        if (!id || _seenIds.has(id)) return false
        _seenIds.add(id)
        // Dark ship markers only render if the vessel is on the sanctions list
        const isDarkShip = (a.alert_category === "DARK_SHIP" || (a.alert_type || a.rule_name || "").toLowerCase().includes("dark ship"))
        if (isDarkShip) {
            const mmsi = a.mmsi || a.entity_id || ""
            const onSanctions = a.sanctions_hit || a.on_sanctions_list || sanctionedMmsiRef.current.has(mmsi)
            if (!onSanctions) return false
        }
        return true
    })
    const visibleFusions = fusions.filter(f => f.lat != null && f.lon != null && isFinite(Number(f.lat)) && f.marker_visible !== false)

    return (
        <>
            {visibleAlerts.map((a, i) => {
                const lat = Number(a.lat)
                const lon = Number(a.lng ?? a.lon)
                if (!isFinite(lat) || !isFinite(lon)) return null

                const mp  = markerProps({ ...a, domain: (a.domain || a.source || "").toUpperCase() })
                const img = getCachedCanvas(mp.color, mp.size, mp.pulse, mp.signalCount, mp.shape)
                if (!img) return null

                const sanctioned = isSanctioned(a)
                const sts        = isSts(a)
                const isMilitary = mp.shape === 'military'
                const callsign   = (a.aircraft || a.callsign || "").slice(0, 8)
                const labelText  = sanctioned ? "SANCTIONED"
                                 : sts        ? "STS DETECTED"
                                 : isMilitary && callsign ? callsign
                                 : null

                const labelColor = sanctioned ? "#FF3B30" : isMilitary ? "#FF4444" : "#FF9500"
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
                            scaleByDistance: new NearFarScalar(1000, 1.3, 12_000_000, 0.28),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                        }}
                        label={labelText ? {
                            text:            labelText,
                            font:            "bold 9px Arial",
                            fillColor:       Color.fromCssColorString(labelColor),
                            outlineColor:    Color.fromCssColorString("#0F1721"),
                            outlineWidth:    2,
                            style:           2,
                            showBackground:  true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.85),
                            pixelOffset:     new Cartesian2(0, -(mp.size / 2 + 8)),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 8_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        } : undefined}
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
