import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color, JulianDate } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const EEZ_STROKE = Color.fromCssColorString("rgba(0,207,255,0.65)")
const _TIME = new JulianDate()

export default function GlobeEEZLayer({ enabled }) {
    const { viewer } = useCesium()
    const dsRef        = useRef(null)
    const entityIdsRef = useRef([])

    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            if (dsRef.current && !viewer.isDestroyed()) {
                viewer.dataSources.remove(dsRef.current, true)
                dsRef.current = null
            }
            entityIdsRef.current.forEach(deleteEntity)
            entityIdsRef.current = []
        }

        if (!enabled) { cleanup(); return }

        let cancelled = false

        fetch(`${API_BASE}/geo/eez`)
            .then(r => r.ok ? r.json() : null)
            .then(async geo => {
                if (!geo?.features?.length || cancelled) return

                const ds = await CesiumGeoJsonDataSource.load(geo, {
                    stroke:        EEZ_STROKE,
                    strokeWidth:   1.5,
                    fill:          Color.TRANSPARENT,
                    clampToGround: true,
                })

                if (cancelled) { ds.destroy(); return }

                const ids = []
                ds.entities.values.forEach(entity => {
                    const raw = entity.properties?.getValue?.(_TIME) || {}
                    setEntity(entity.id, "eez", {
                        name:       raw.eez1 || raw.line_name || "EEZ Boundary",
                        eez1:       raw.eez1,
                        eez2:       raw.eez2,
                        territory1: raw.territory1,
                        territory2: raw.territory2,
                        sovereign1: raw.sovereign1,
                        sovereign2: raw.sovereign2,
                        mrgid_eez1: raw.mrgid_eez1,
                        mrgid_eez2: raw.mrgid_eez2,
                        length_km:  raw.length_km,
                        line_type:  raw.line_type,
                    })
                    ids.push(entity.id)
                })
                entityIdsRef.current = ids

                if (!viewer.isDestroyed()) {
                    viewer.dataSources.add(ds)
                    dsRef.current = ds
                }
            })
            .catch(() => {})

        return () => { cancelled = true; cleanup() }
    }, [viewer, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
