import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color } from "cesium"
import API_BASE from "../apiBase.js"

const BORDER_COLOR = Color.fromCssColorString("rgba(0,255,136,0.50)")
const BORDER_WIDTH = 1.2

// GeoJsonDataSource polygon outlines don't render when clampToGround:true
// (Cesium GroundPrimitive doesn't support outline). Convert all polygon
// rings to LineString features so they load as GroundPolylines instead.
function polygonsToLines(geojson) {
    const features = []
    for (const f of (geojson.features || [])) {
        const geom = f.geometry
        if (!geom) continue
        const rings = []
        if (geom.type === "Polygon") {
            rings.push(...geom.coordinates)
        } else if (geom.type === "MultiPolygon") {
            for (const poly of geom.coordinates) rings.push(...poly)
        } else {
            features.push(f)
            continue
        }
        for (const ring of rings) {
            features.push({
                type:       "Feature",
                geometry:   { type: "LineString", coordinates: ring },
                properties: f.properties,
            })
        }
    }
    return { type: "FeatureCollection", features }
}

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

        if (dsRef.current) return

        fetch(`${API_BASE}/geo/countries`)
            .then(r => r.ok ? r.json() : null)
            .then(geo => {
                if (!geo || dsRef.current) return
                return CesiumGeoJsonDataSource.load(polygonsToLines(geo), {
                    stroke:        BORDER_COLOR,
                    strokeWidth:   BORDER_WIDTH,
                    clampToGround: true,
                })
            })
            .then(ds => {
                if (!ds || !viewer || viewer.isDestroyed()) return
                viewer.dataSources.add(ds)
                dsRef.current = ds
            })
            .catch(err => console.warn("[GlobeCountryBorders]", err))

        return () => {
            if (viewer && !viewer.isDestroyed() && dsRef.current) {
                viewer.dataSources.remove(dsRef.current, true)
                dsRef.current = null
            }
        }
    }, [viewer, enabled])

    return null
}
