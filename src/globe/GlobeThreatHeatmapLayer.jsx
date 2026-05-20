// Threat heatmap: dense 1° grid per threat region colored by score, plus
// alert hotspot points from /api/alerts.
// Data sourced from /api/analytics/threat-matrix (hourly) + /api/alerts (15 min).

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { Rectangle, Color, HeightReference, Cartesian3, NearFarScalar } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const CesiumMath = { toRadians: (d) => d * Math.PI / 180 }

// Region bbox definitions (must match backend threat_matrix.py REGIONS)
const REGION_BBOXES = {
    "Baltic":                  { west: 10,   south: 53,  east: 30,  north: 66  },
    "East Mediterranean":      { west: 25,   south: 30,  east: 37,  north: 37  },
    "Black Sea / Ukraine":     { west: 27,   south: 40,  east: 42,  north: 50  },
    "Persian Gulf":            { west: 48,   south: 23,  east: 60,  north: 30  },
    "Red Sea / Bab el-Mandeb": { west: 32,   south: 12,  east: 45,  north: 22  },
    "Sahel":                   { west: -15,  south: 10,  east: 15,  north: 20  },
    "Horn of Africa":          { west: 35,   south: -5,  east: 55,  north: 15  },
    "South China Sea":         { west: 105,  south: 5,   east: 125, north: 25  },
    "Taiwan Strait":           { west: 116,  south: 22,  east: 125, north: 28  },
    "Indian Ocean":            { west: 55,   south: -10, east: 80,  north: 15  },
}

// Score 0–100 → interpolated color (transparent→blue→cyan→green→yellow→orange→red)
const GRADIENT_STOPS = [
    { s: 0,   r: 0x06, g: 0x18, b: 0x3d },  // near-black navy
    { s: 15,  r: 0x1d, g: 0x4e, b: 0xd8 },  // blue
    { s: 30,  r: 0x06, g: 0x96, b: 0xff },  // bright blue
    { s: 45,  r: 0x00, g: 0xc4, b: 0xa0 },  // cyan
    { s: 60,  r: 0xff, g: 0xcc, b: 0x00 },  // yellow
    { s: 75,  r: 0xff, g: 0x6a, b: 0x00 },  // orange
    { s: 90,  r: 0xff, g: 0x18, b: 0x00 },  // red-orange
    { s: 100, r: 0xcc, g: 0x00, b: 0x00 },  // dark red
]

function scoreToRgba(score, alpha) {
    const s = Math.max(0, Math.min(100, score))
    let lo = GRADIENT_STOPS[0], hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1]
    for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
        if (s >= GRADIENT_STOPS[i].s && s <= GRADIENT_STOPS[i + 1].s) {
            lo = GRADIENT_STOPS[i]; hi = GRADIENT_STOPS[i + 1]; break
        }
    }
    const t = (hi.s - lo.s) === 0 ? 0 : (s - lo.s) / (hi.s - lo.s)
    const r = Math.round(lo.r + (hi.r - lo.r) * t)
    const g = Math.round(lo.g + (hi.g - lo.g) * t)
    const b = Math.round(lo.b + (hi.b - lo.b) * t)
    return Color.fromBytes(r, g, b, Math.round(alpha * 255))
}

// Severity → alpha bonus for alert hotspots
const SEV_ALPHA = { critical: 0.85, high: 0.65, medium: 0.45, low: 0.3 }
const SEV_COLOR = {
    critical: { r: 239, g: 68,  b: 68  },
    high:     { r: 245, g: 158, b: 11  },
    medium:   { r: 59,  g: 130, b: 246 },
    low:      { r: 34,  g: 197, b: 94  },
}

function alertColor(severity) {
    const c = SEV_COLOR[severity?.toLowerCase()] || SEV_COLOR.low
    return Color.fromBytes(c.r, c.g, c.b, Math.round((SEV_ALPHA[severity?.toLowerCase()] ?? 0.4) * 255))
}

export default function GlobeThreatHeatmapLayer({ enabled }) {
    const { viewer }  = useCesium()
    const entitiesRef = useRef([])
    const alertEntRef = useRef([])
    const matrixTimer = useRef(null)
    const alertTimer  = useRef(null)

    const cleanup = (v, ref) => {
        ref.current.forEach(e => {
            if (v && v.entities.contains(e)) v.entities.remove(e)
            if (e.id) { try { deleteEntity(e.id) } catch (_) {} }
        })
        ref.current = []
    }

    // ── Threat matrix grid ──────────────────────────────────────────────────
    const drawMatrix = () => {
        if (!viewer || !enabled) return
        fetch(`${API_BASE}/api/analytics/threat-matrix`)
            .then(r => r.ok ? r.json() : [])
            .then(scores => {
                if (!viewer) return
                cleanup(viewer, entitiesRef)
                const added = []

                scores.forEach(s => {
                    const bbox  = REGION_BBOXES[s.region_name]
                    if (!bbox)  return
                    const score = s.threat_score ?? 0
                    const regionData = {
                        region_name:  s.region_name,
                        threat_score: score,
                        threat_level: s.threat_level,
                        trend:        s.trend,
                        alert_count:  s.alert_count  ?? 0,
                        fusion_count: s.fusion_count ?? 0,
                        signals:      s.signals      ?? [],
                    }

                    // 1° grid cells within the region
                    for (let lat = bbox.south; lat < bbox.north; lat += 1) {
                        for (let lon = bbox.west; lon < bbox.east; lon += 1) {
                            const cellScore = Math.max(0, score + (Math.random() - 0.5) * 10)
                            const alpha = 0.04 + (cellScore / 100) * 0.22
                            const color = scoreToRgba(cellScore, alpha)
                            const id    = `hm-${s.region_name}-${lat}-${lon}`
                            const ent   = viewer.entities.add({
                                id,
                                rectangle: {
                                    coordinates:     Rectangle.fromDegrees(lon, lat, lon + 1, lat + 1),
                                    material:        color,
                                    heightReference: HeightReference.CLAMP_TO_GROUND,
                                },
                            })
                            // Register so GlobePopup.jsx click handler can identify it
                            setEntity(id, "threat_region", regionData)
                            added.push(ent)
                        }
                    }

                    // Region outline + label (single entity per region)
                    const outlineColor = scoreToRgba(score, 0.55)
                    const cx = (bbox.west + bbox.east) / 2
                    const cy = (bbox.south + bbox.north) / 2
                    const labelId = `hm-label-${s.region_name}`
                    const labelEnt = viewer.entities.add({
                        id: labelId,
                        rectangle: {
                            coordinates:  Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
                            material:     Color.TRANSPARENT,
                            outline:      true,
                            outlineColor: outlineColor,
                            outlineWidth: 1.5,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                        },
                        label: {
                            text:        `${s.region_name}\n${s.threat_level} · ${score}`,
                            font:         "10px Arial",
                            fillColor:    Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:        2,
                            showBackground:  true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.78),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            position:     Cartesian3.fromDegrees(cx, cy, 50000),
                            scaleByDistance: new NearFarScalar(1.5e5, 1.2, 1.5e7, 0.5),
                        },
                    })
                    setEntity(labelId, "threat_region", {
                        region_name: s.region_name, threat_score: score, threat_level: s.threat_level,
                    })
                    added.push(labelEnt)
                })

                entitiesRef.current = added
            })
            .catch(err => console.warn("[threat-heatmap]", err))
    }

    // ── Alert hotspots ──────────────────────────────────────────────────────
    const drawAlerts = () => {
        if (!viewer || !enabled) return
        fetch(`${API_BASE}/api/alerts?limit=300&status=active`)
            .then(r => r.ok ? r.json() : { alerts: [] })
            .then(data => {
                if (!viewer) return
                cleanup(viewer, alertEntRef)
                const items  = Array.isArray(data) ? data : (data?.alerts ?? [])
                const added  = []
                items.forEach((a, i) => {
                    const lat = a.lat ?? a.latitude
                    const lon = a.lon ?? a.lng ?? a.longitude
                    if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return
                    const sev = (a.severity || "low").toLowerCase()
                    const col = alertColor(sev)
                    const id  = `alert-hotspot-${a.alert_id || i}`
                    const ent = viewer.entities.add({
                        id,
                        position: Cartesian3.fromDegrees(lon, lat, 0),
                        point: {
                            color:              col,
                            pixelSize:          sev === "critical" ? 8 : sev === "high" ? 6 : 4,
                            outlineColor:       Color.WHITE.withAlpha(0.3),
                            outlineWidth:       1,
                            heightReference:    HeightReference.CLAMP_TO_GROUND,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            scaleByDistance:    new NearFarScalar(1e4, 1.8, 2e6, 0.6),
                        },
                    })
                    added.push(ent)
                })
                alertEntRef.current = added
            })
            .catch(err => console.warn("[threat-heatmap alerts]", err))
    }

    useEffect(() => {
        if (!viewer || !enabled) {
            cleanup(viewer, entitiesRef)
            cleanup(viewer, alertEntRef)
            return
        }

        drawMatrix()
        drawAlerts()

        matrixTimer.current = setInterval(drawMatrix, 3_600_000)  // hourly
        alertTimer.current  = setInterval(drawAlerts,   900_000)  // 15 min

        return () => {
            clearInterval(matrixTimer.current)
            clearInterval(alertTimer.current)
            cleanup(viewer, entitiesRef)
            cleanup(viewer, alertEntRef)
        }
    }, [viewer, enabled])  // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
