import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color, JulianDate } from "cesium"
import API_BASE from "../apiBase.js"
import { Cartographic, Math as CesiumMath } from "cesium"
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
                    // The boundary's own extent, so a click can ask what is
                    // in the water here. An EEZ entity is a LINE, not a
                    // polygon, so there is no area to test against — the
                    // extent of the line, padded, is the honest stand-in and
                    // the panel says it is reading a box.
                    let bounds = null
                    try {
                        const pos = entity.polyline?.positions?.getValue?.(_TIME) || []
                        if (pos.length) {
                            let s0 = 90, n0 = -90, w0 = 180, e0 = -180
                            for (const c of pos) {
                                const carto = Cartographic.fromCartesian(c)
                                if (!carto) continue
                                const la = CesiumMath.toDegrees(carto.latitude)
                                const lo = CesiumMath.toDegrees(carto.longitude)
                                if (la < s0) s0 = la
                                if (la > n0) n0 = la
                                if (lo < w0) w0 = lo
                                if (lo > e0) e0 = lo
                            }
                            if (s0 <= n0 && w0 <= e0) {
                                const pad = 0.25
                                bounds = { south: +(s0 - pad).toFixed(4), north: +(n0 + pad).toFixed(4),
                                           west: +(w0 - pad).toFixed(4), east: +(e0 + pad).toFixed(4) }
                            }
                        }
                    } catch { /* a boundary we cannot measure still draws */ }
                    setEntity(entity.id, "eez", {
                        bounds,
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

    // WHICH LINE DID I CLICK. EEZ boundaries converge and overlap, and with
    // every one drawn identically a selection was invisible — you could open
    // a panel about a boundary and have no idea which of the five lines under
    // the cursor it described.
    useEffect(() => {
        if (!viewer || !enabled) return
        const apply = () => {
            const sel = viewer.selectedEntity
            for (const id of entityIdsRef.current) {
                const e = dsRef.current?.entities?.getById?.(id)
                if (!e?.polyline) continue
                const on = !!sel && sel.id === id
                e.polyline.material = on ? EEZ_SELECTED : EEZ_STROKE
                e.polyline.width = on ? 3.5 : 1.2
            }
        }
        const off = viewer.selectedEntityChanged?.addEventListener?.(apply)
        apply()
        return () => { if (typeof off === "function") off() }
    }, [viewer, enabled])

    return null
}
