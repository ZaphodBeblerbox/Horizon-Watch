import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color } from "cesium"
import API_BASE from "../apiBase.js"

const BORDER_COLOR  = Color.fromCssColorString("rgba(0,255,136,0.50)")
const BORDER_WIDTH  = 1.2

export default function GlobeCountryBordersLayer({ enabled }) {
    const { viewer } = useCesium()
    const dsRef = useRef(null)

    useEffect(() => {
        if (!viewer) return
        if (!enabled) {
            if (dsRef.current) {
                viewer.dataSources.remove(dsRef.current, true)
                dsRef.current = null
            }
            return
        }

        // Already loaded
        if (dsRef.current) return

        fetch(`${API_BASE}/geo/countries`)
            .then(r => r.ok ? r.json() : null)
            .then(geo => {
                if (!geo || dsRef.current) return
                return CesiumGeoJsonDataSource.load(geo, {
                    stroke:      BORDER_COLOR,
                    strokeWidth: BORDER_WIDTH,
                    fill:        Color.TRANSPARENT,
                    clampToGround: true,
                })
            })
            .then(ds => {
                if (!ds || !viewer) return
                // Suppress fill polygons — borders only
                ds.entities.values.forEach(e => {
                    if (e.polygon) {
                        e.polygon.material = Color.TRANSPARENT
                        e.polygon.fill     = false
                        e.polygon.outline  = false
                    }
                    if (e.polyline) {
                        e.polyline.material = BORDER_COLOR
                        e.polyline.width    = BORDER_WIDTH
                        e.polyline.clampToGround = true
                    }
                })
                viewer.dataSources.add(ds)
                dsRef.current = ds
            })
            .catch(err => console.warn("[GlobeCountryBorders]", err))

        return () => {
            if (viewer && dsRef.current) {
                viewer.dataSources.remove(dsRef.current, true)
                dsRef.current = null
            }
        }
    }, [viewer, enabled])

    return null
}
