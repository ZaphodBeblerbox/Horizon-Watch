// Threat heatmap: one Rectangle per threat region, colored by threat level.
// Data sourced from /api/analytics/threat-matrix (hourly cache, no auth).

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { Rectangle, Color, HeightReference, Cartesian3 } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const CesiumMath = { toRadians: (d) => d * Math.PI / 180 }

const LEVEL_COLOR = {
    CRITICAL: "#ef4444",
    HIGH:     "#f59e0b",
    MEDIUM:   "#f59e0b",
    ELEVATED: "#60a5fa",
    LOW:      "#22c55e",
}

const LEVEL_ALPHA = { CRITICAL: 0.40, HIGH: 0.30, MEDIUM: 0.25, ELEVATED: 0.20, LOW: 0.10 }

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

export default function GlobeThreatHeatmapLayer({ enabled }) {
    const { viewer } = useCesium()
    const entitiesRef = useRef([])
    const intervalRef = useRef(null)

    const cleanup = (v) => {
        entitiesRef.current.forEach(e => {
            if (v && v.entities.contains(e)) v.entities.remove(e)
            if (e.id) deleteEntity(e.id)
        })
        entitiesRef.current = []
    }

    useEffect(() => {
        if (!viewer || !enabled) {
            cleanup(viewer)
            return
        }

        const draw = () => {
            fetch(`${API_BASE}/api/analytics/threat-matrix`)
                .then(r => r.ok ? r.json() : [])
                .then(scores => {
                    if (!viewer) return
                    cleanup(viewer)
                    const added = []
                    scores.forEach(s => {
                        const bbox = REGION_BBOXES[s.region_name]
                        if (!bbox) return
                        const level = s.threat_level || "LOW"
                        const hex   = LEVEL_COLOR[level] || "#22c55e"
                        const alpha = LEVEL_ALPHA[level] || 0.10
                        const color = Color.fromCssColorString(hex).withAlpha(alpha)
                        const id    = `threat-heatmap-${s.region_name}`

                        const entity = viewer.entities.add({
                            id,
                            rectangle: {
                                coordinates: Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
                                material:        color,
                                heightReference: HeightReference.CLAMP_TO_GROUND,
                                outline:         true,
                                outlineColor:    Color.fromCssColorString(hex).withAlpha(0.5),
                                outlineWidth:    1,
                            },
                            label: {
                                text:       `${s.region_name}\n${level} · ${s.threat_score}`,
                                font:       "10px Arial",
                                fillColor:  Color.fromCssColorString("#E8ECF1"),
                                outlineColor: Color.fromCssColorString("#0F1721"),
                                outlineWidth: 2,
                                style:      2,
                                showBackground:   true,
                                backgroundColor:  Color.fromCssColorString("#0F1721").withAlpha(0.75),
                                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                                position: Cartesian3.fromDegrees(
                                    (bbox.west + bbox.east) / 2,
                                    (bbox.south + bbox.north) / 2,
                                    50000
                                ),
                            },
                        })
                        setEntity(id, "threat_region", {
                            region_name:  s.region_name,
                            threat_score: s.threat_score,
                            threat_level: level,
                            alert_count:  s.alert_count,
                        })
                        added.push(entity)
                    })
                    entitiesRef.current = added
                })
                .catch(err => console.warn("[threat-heatmap]", err))
        }

        draw()
        intervalRef.current = setInterval(draw, 3_600_000)  // refresh hourly

        return () => {
            clearInterval(intervalRef.current)
            cleanup(viewer)
        }
    }, [viewer, enabled])

    return null
}
