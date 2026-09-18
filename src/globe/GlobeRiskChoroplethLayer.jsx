import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color, JulianDate } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { riskAlpha, buildA2ToA3, indexByIso3, FLOOR } from "./riskChoropleth.js"

/**
 * Country risk, drawn.
 *
 * The risk index has been computed and panelled for a long time and never
 * put a single pixel on the globe — the layer toggled a legend beside a map
 * that showed nothing. This is that layer.
 *
 * Only countries the index actually scores are filled. A country with no
 * data is left alone rather than tinted at the bottom of the ramp, because
 * "we have no reporting from here" and "it is calm here" are opposite
 * claims and must not look identical. On the live index that is 16 of ~190
 * countries; the rest of the world stays untouched.
 */
const _TIME = new JulianDate()

// The console's severity colour, not a new one.
const RISK_RGB = [196, 69, 60]
const STROKE = Color.fromCssColorString("rgba(196,69,60,0.55)")

export default function GlobeRiskChoroplethLayer({ enabled }) {
    const { viewer } = useCesium()
    const dsRef = useRef(null)
    const idsRef = useRef([])

    useEffect(() => {
        if (!viewer) return

        const cleanup = () => {
            if (dsRef.current && !viewer.isDestroyed()) {
                viewer.dataSources.remove(dsRef.current, true)
                dsRef.current = null
            }
            idsRef.current.forEach(deleteEntity)
            idsRef.current = []
        }

        if (!enabled) { cleanup(); return }

        let cancelled = false

        Promise.all([
            fetch("/data/world-countries.json").then((r) => (r.ok ? r.json() : null)),
            fetch(`${API_BASE}/api/risk-index/countries`).then((r) => (r.ok ? r.json() : null)),
        ])
            .then(async ([geo, risk]) => {
                if (cancelled || !geo?.features?.length) return
                const a2ToA3 = buildA2ToA3(geo.features)
                const { byIso, unresolved } = indexByIso3(risk?.countries, a2ToA3)
                if (unresolved.length) {
                    // A code we cannot place is a fact about the data. Saying
                    // so beats a country quietly never being painted.
                    console.warn("[risk] unmappable country codes:", unresolved.join(", "))
                }

                // Only the scored countries above the floor are drawn at all.
                const painted = geo.features.filter((f) => {
                    const row = byIso.get(String(f.properties?.a3 || "").toUpperCase())
                    return row && riskAlpha(row.score, row.band) > 0
                })
                if (!painted.length || cancelled) return

                const ds = await CesiumGeoJsonDataSource.load(
                    { type: "FeatureCollection", features: painted },
                    { stroke: STROKE, strokeWidth: 1, fill: Color.TRANSPARENT, clampToGround: true },
                )
                if (cancelled) { ds.destroy(); return }

                const ids = []
                ds.entities.values.forEach((entity) => {
                    const raw = entity.properties?.getValue?.(_TIME) || {}
                    const row = byIso.get(String(raw.a3 || "").toUpperCase())
                    if (!row) return
                    const alpha = riskAlpha(row.score, row.band)
                    if (entity.polygon) {
                        // Density IS the severity. Same hue throughout: a
                        // second colour would imply a second variable.
                        entity.polygon.material = Color.fromBytes(...RISK_RGB, Math.round(alpha * 255))
                        entity.polygon.outline = true
                        entity.polygon.outlineColor = STROKE
                    }
                    setEntity(entity.id, "country_risk", {
                        name: `${raw.n || row.iso_code} — country risk`,
                        iso3: raw.a3, country: raw.n,
                        score: row.score, band: row.band,
                        components: row.components, contributions: row.contributions,
                    })
                    ids.push(entity.id)
                })
                idsRef.current = ids

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

export { FLOOR }
