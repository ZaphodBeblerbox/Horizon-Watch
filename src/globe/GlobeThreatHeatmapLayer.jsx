// Threat heatmap: region grid skin + radial ellipse hotspots driven by threat matrix data.
// Emerging/escalating regions pulse via CallbackProperty.
// Data sourced from /api/analytics/threat-matrix (10 min refresh).

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    Rectangle, Color, HeightReference, Cartesian3, NearFarScalar,
    CallbackProperty, ColorMaterialProperty, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

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

// Deterministic per-cell noise — eliminates flicker on re-render
function cellNoise(lat, lon) {
    let h = (Math.round(lat * 10) * 1000003 + Math.round(lon * 10)) | 0
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}

// Score 0–100 → interpolated RGBA
const GRADIENT_STOPS = [
    { s: 0,   r: 0x06, g: 0x18, b: 0x3d },
    { s: 15,  r: 0x1d, g: 0x4e, b: 0xd8 },
    { s: 30,  r: 0x06, g: 0x96, b: 0xff },
    { s: 45,  r: 0x00, g: 0xc4, b: 0xa0 },
    { s: 60,  r: 0xff, g: 0xcc, b: 0x00 },
    { s: 75,  r: 0xff, g: 0x6a, b: 0x00 },
    { s: 90,  r: 0xff, g: 0x18, b: 0x00 },
    { s: 100, r: 0xcc, g: 0x00, b: 0x00 },
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

// Pulse period: escalating = 1s, emerging = 2s
function makePulseColor(score, minAlpha, maxAlpha, periodMs) {
    // CallbackProperty for material must return a MaterialProperty, not a raw Color.
    // Wrapping in ColorMaterialProperty satisfies Cesium's getType() requirement.
    return new CallbackProperty(() => {
        const t   = (Date.now() % periodMs) / periodMs
        const sin = Math.sin(t * Math.PI * 2) * 0.5 + 0.5
        const a   = minAlpha + (maxAlpha - minAlpha) * sin
        return new ColorMaterialProperty(scoreToRgba(score, a))
    }, false)
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
                    const score      = s.threat_score ?? s.score ?? 0
                    const isEscalate = s.is_escalating === true
                    const isEmerge   = s.is_emerging   === true
                    const isPulse    = isEscalate || isEmerge
                    const regionData = {
                        region_name:  s.region_name,
                        threat_score: score,
                        threat_level: s.threat_level,
                        trend:        s.trend,
                        trend_delta:  s.trend_delta,
                        is_emerging:  s.is_emerging,
                        is_escalating: s.is_escalating,
                        narrative:    s.narrative,
                        alert_count:  s.alert_count  ?? 0,
                        fusion_count: s.fusion_count ?? 0,
                        signal_count_24h: s.signal_count_24h ?? 0,
                        signals:      s.contributing_signals ?? [],
                    }

                    // ── 1° grid cells ──────────────────────────────────────
                    for (let lat = bbox.south; lat < bbox.north; lat += 1) {
                        for (let lon = bbox.west; lon < bbox.east; lon += 1) {
                            const cellScore = Math.max(0, score + (cellNoise(lat, lon) - 0.5) * 10)
                            const alpha = 0.01 + Math.pow(cellScore / 100, 0.7) * 0.04  // max ~0.05, subtle glow
                            const material = isPulse
                                ? makePulseColor(cellScore, alpha * 0.6, alpha * 1.4, isEscalate ? 1000 : 2000)
                                : scoreToRgba(cellScore, alpha)
                            const id  = `hm-${s.region_name}-${lat}-${lon}`
                            const ent = viewer.entities.add({
                                id,
                                rectangle: {
                                    coordinates:     Rectangle.fromDegrees(lon, lat, lon + 1, lat + 1),
                                    material,
                                    heightReference: HeightReference.CLAMP_TO_GROUND,
                                },
                            })
                            setEntity(id, "threat_region", regionData)
                            added.push(ent)
                        }
                    }

                    // ── Radial ellipse hotspot (centroid) ─────────────────
                    const cx = (bbox.west + bbox.east) / 2
                    const cy = (bbox.south + bbox.north) / 2
                    const semiMajorM = ((bbox.east - bbox.west) / 2) * 111_000
                    const semiMinorM = ((bbox.north - bbox.south) / 2) * 111_000
                    const ellipseAlphaBase = score >= 75 ? 0.07 : score >= 50 ? 0.05 : score >= 25 ? 0.04 : 0.02
                    const ellipseMaterial  = isPulse
                        ? makePulseColor(score, ellipseAlphaBase * 0.5, ellipseAlphaBase * 1.6, isEscalate ? 1000 : 2000)
                        : scoreToRgba(score, ellipseAlphaBase)
                    const ellipseId = `hm-ellipse-${s.region_name}`
                    const ellipseEnt = viewer.entities.add({
                        id: ellipseId,
                        position: Cartesian3.fromDegrees(cx, cy, 0),
                        ellipse: {
                            semiMajorAxis:   semiMajorM,
                            semiMinorAxis:   semiMinorM,
                            material:        ellipseMaterial,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            outline:         score >= 50,
                            outlineColor:    scoreToRgba(score, 0.15),
                            outlineWidth:    1.5,
                        },
                    })
                    setEntity(ellipseId, "threat_region", regionData)
                    added.push(ellipseEnt)

                    // ── Region label (trend arrow for HIGH/CRITICAL) ───────
                    const trendArrow = s.trend === "escalating"    ? " ↑"
                                     : s.trend === "de-escalating" ? " ↓"
                                     : ""
                    const deltaStr = (s.trend_delta && Math.abs(s.trend_delta) >= 1)
                        ? ` (${s.trend_delta > 0 ? "+" : ""}${s.trend_delta})`
                        : ""
                    const labelBadge = (isEscalate ? "⚠ ESCALATING\n" : isEmerge ? "⚡ EMERGING\n" : "")
                    const labelText  = `${labelBadge}${s.region_name}\n${s.threat_level} · ${score}${trendArrow}${deltaStr}`
                    const labelId    = `hm-label-${s.region_name}`
                    const labelEnt   = viewer.entities.add({
                        id: labelId,
                        rectangle: {
                            coordinates:  Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
                            material:     Color.TRANSPARENT,
                            outline:      true,
                            outlineColor: scoreToRgba(score, 0.15),
                            outlineWidth: 1.5,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                        },
                        label: {
                            text:        labelText,
                            font:        score >= 55 ? "bold 11px Arial" : "10px Arial",
                            fillColor:   Color.fromCssColorString("#E8ECF1"),
                            outlineColor:Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:       2,
                            showBackground:  true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.82),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            position:    Cartesian3.fromDegrees(cx, cy, 50000),
                            scaleByDistance: new NearFarScalar(1.5e5, 1.2, 1.5e7, 0.5),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 4_000_000),
                        },
                    })
                    setEntity(labelId, "threat_region", { region_name: s.region_name, threat_score: score, threat_level: s.threat_level })
                    added.push(labelEnt)
                })

                entitiesRef.current = added
            })
            .catch(err => console.warn("[threat-heatmap]", err))
    }

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
                            pixelSize:          sev === "critical" ? 9 : sev === "high" ? 7 : 5,
                            outlineColor:       Color.WHITE.withAlpha(0.35),
                            outlineWidth:       1.5,
                            heightReference:    HeightReference.CLAMP_TO_GROUND,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            scaleByDistance:    new NearFarScalar(1e4, 1.8, 2e6, 0.6),
                        },
                    })
                    setEntity(id, "alert", a)
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

        matrixTimer.current = setInterval(drawMatrix, 600_000)  // 10 min
        alertTimer.current  = setInterval(drawAlerts,  900_000) // 15 min

        return () => {
            clearInterval(matrixTimer.current)
            clearInterval(alertTimer.current)
            cleanup(viewer, entitiesRef)
            cleanup(viewer, alertEntRef)
        }
    }, [viewer, enabled])  // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
