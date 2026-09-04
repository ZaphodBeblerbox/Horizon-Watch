import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { Cartesian3, Color, PolylineDashMaterialProperty } from "cesium"

// Fidelity pass, build spec v2 §4 — a real 10° graticule ("Graticule 10°"
// context layer), genuinely computed lat/lon lines at exact 10-degree
// increments (not an approximate procedural tile grid, which would render
// a different apparent spacing at different zoom levels). Meridians run
// pole-to-pole every 10° of longitude; parallels run the full globe every
// 10° of latitude, stopping short of the poles themselves.
const STEP_DEG = 10
const SEGMENTS_PER_LINE = 36 // smooths the great-circle/parallel curvature

function meridianPositions(lon) {
    const pts = []
    for (let i = 0; i <= SEGMENTS_PER_LINE; i++) {
        const lat = -90 + (180 * i) / SEGMENTS_PER_LINE
        pts.push(Cartesian3.fromDegrees(lon, lat))
    }
    return pts
}

function parallelPositions(lat) {
    const pts = []
    for (let i = 0; i <= SEGMENTS_PER_LINE; i++) {
        const lon = -180 + (360 * i) / SEGMENTS_PER_LINE
        pts.push(Cartesian3.fromDegrees(lon, lat))
    }
    return pts
}

const GRATICULE_COLOR = Color.fromCssColorString("#39424a").withAlpha(0.55)

export default function GlobeGraticuleLayer({ enabled }) {
    const { viewer } = useCesium()
    const entityIdsRef = useRef([])

    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            if (!viewer.isDestroyed()) {
                for (const id of entityIdsRef.current) {
                    const e = viewer.entities.getById(id)
                    if (e) viewer.entities.remove(e)
                }
            }
            entityIdsRef.current = []
        }

        if (!enabled) { cleanup(); return cleanup }

        const ids = []
        for (let lon = -180; lon < 180; lon += STEP_DEG) {
            const id = `graticule-mer-${lon}`
            viewer.entities.add({
                id,
                polyline: {
                    positions: meridianPositions(lon),
                    width: 1,
                    material: new PolylineDashMaterialProperty({ color: GRATICULE_COLOR, dashLength: 8 }),
                    clampToGround: false,
                },
            })
            ids.push(id)
        }
        for (let lat = -80; lat <= 80; lat += STEP_DEG) {
            const id = `graticule-par-${lat}`
            viewer.entities.add({
                id,
                polyline: {
                    positions: parallelPositions(lat),
                    width: 1,
                    material: new PolylineDashMaterialProperty({ color: GRATICULE_COLOR, dashLength: 8 }),
                    clampToGround: false,
                },
            })
            ids.push(id)
        }
        entityIdsRef.current = ids

        return cleanup
    }, [viewer, enabled])

    return null
}
