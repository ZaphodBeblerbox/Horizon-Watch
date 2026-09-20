/**
 * GlobeFrontlinesLayer.jsx — who holds what ground.
 *
 * ONE THEATRE, SAID OUT LOUD. Control of terrain is almost never published
 * openly: LiveUAMap and Janes are paid, ISW publishes assessments as
 * images rather than geodata, and ACLED is not free. DeepStateMap serves
 * Ukraine's full control layer as GeoJSON with no key. Nothing comparable
 * exists for Sudan, Myanmar or the Sahel, so this layer covers one war and
 * the tooltip says so — an empty map over Khartoum must not read as calm.
 *
 * THE GREY ZONE IS THE POINT, and the easiest thing to misread. It is not
 * "nothing here"; it is where DeepStateMap declines to call it, which is
 * usually where the fighting is. It gets the strongest fill of the three
 * rather than the weakest.
 *
 * DRAWN THROUGH GeoJsonDataSource WITH clampToGround, the same path the
 * EEZ and risk layers use, and not through resium <Entity polygon>. The
 * hand-built version created all 94 polygons without error and rendered
 * nothing at all — measured over Donetsk, 0 changed pixels with the layer
 * on. A polygon with no height z-fights the globe surface; one with
 * height:0 stops being a ground primitive and its classificationType is
 * then ignored. clampToGround is the only setting here that actually
 * drapes geometry on the terrain.
 */
import { useEffect, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import { GeoJsonDataSource as CesiumGeoJsonDataSource, Color, JulianDate,
         Cartesian3, Math as CesiumMath } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const REFRESH_MS = 30 * 60 * 1000       // it is redrawn a few times a day
const _TIME = JulianDate.now()

// Occupied is the fact, contested is the question, retaken is the change.
const STATUS_STYLE = {
    occupied:  { fill: "#a52714", alpha: 0.32, label: "Russian-controlled" },
    unknown:   { fill: "#bcaaa4", alpha: 0.45, label: "Contested" },
    dismissed: { fill: "#0f9d58", alpha: 0.20, label: "Retaken / withdrawn" },
}

export default function GlobeFrontlinesLayer({ enabled = false, at = null }) {
    const { viewer } = useCesium()
    const dsRef = useRef(null)
    const idsRef = useRef([])
    const [meta, setMeta] = useState(null)
    const [axes, setAxes] = useState([])

    useEffect(() => {
        if (!viewer) return
        let cancelled = false

        const clear = () => {
            idsRef.current.forEach(deleteEntity)
            idsRef.current = []
            if (dsRef.current && !viewer.isDestroyed?.()) {
                try { viewer.dataSources.remove(dsRef.current, true) } catch { /* torn down */ }
            }
            dsRef.current = null
        }

        if (!enabled) { clear(); setMeta(null); setAxes([]); return }

        const load = () => {
            fetch(`${API_BASE}/api/frontlines${at ? `?at=${encodeURIComponent(at)}` : ""}`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then(async (d) => {
                    if (cancelled || !d?.available || !d.geojson?.features?.length) return
                    setAxes(Array.isArray(d.attack_axes) ? d.attack_axes : [])
                    const ds = await CesiumGeoJsonDataSource.load(d.geojson, {
                        stroke: Color.TRANSPARENT,
                        fill: Color.TRANSPARENT,
                        clampToGround: true,
                    })
                    if (cancelled || viewer.isDestroyed?.()) { ds.destroy(); return }
                    clear()
                    setMeta(d)

                    const ids = []
                    ds.entities.values.forEach((entity, i) => {
                        const raw = entity.properties?.getValue?.(_TIME) || {}
                        const style = STATUS_STYLE[raw.status]
                        if (entity.polygon && style) {
                            entity.polygon.material =
                                Color.fromCssColorString(style.fill).withAlpha(style.alpha)
                            entity.polygon.outline = false
                        }
                        entity.name = style?.label || "Control area"
                        // Cesium's Entity.id is READ-ONLY. Assigning it threw
                        // inside the promise, so the datasource was never added
                        // and the layer drew nothing while reporting a healthy
                        // 200 — the same shape of failure as the marker
                        // ceiling. Use the id GeoJsonDataSource already gave it.
                        const id = entity.id
                        setEntity(id, "frontline", {
                            id, name: style?.label || "Control area",
                            meta: {
                                status: raw.status,
                                what_it_means: raw.meaning,
                                theatre: d.theatre,
                                drawn_at: d.drawn_at,
                                viewing: at ? `historical — ${String(d.drawn_at).slice(0, 10)}`
                                            : "current",
                                source: d.source,
                                source_url: d.source_url,
                                coverage: d.coverage_note,
                                freshness: d.stale
                                    ? "last known map — refresh failed"
                                    : "current",
                            },
                        })
                        ids.push(id)
                    })
                    idsRef.current = ids
                    dsRef.current = ds
                    viewer.dataSources.add(ds)
                })
                .catch(() => { /* a dropped poll is not a peace settlement */ })
        }

        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h); clear() }
    }, [viewer, enabled, at])

    if (!enabled || !axes.length) return null

    // ── axes of attack ───────────────────────────────────────────────────
    //
    // The position is DeepStateMap's; the arrow is ours. Their map draws
    // each of these as a rotated icon and the GeoJSON export carries no
    // bearing at all, so the direction is derived from the nearest held
    // ground and every one of them says so on click. Drawn dashed and
    // semi-transparent, which is this codebase's existing convention for
    // derived rather than observed.
    const ARROW_KM = 55

    const destination = (lat, lon, bearingDeg, km) => {
        const R = 6371
        const br = CesiumMath.toRadians(bearingDeg)
        const la1 = CesiumMath.toRadians(lat)
        const lo1 = CesiumMath.toRadians(lon)
        const dr = km / R
        const la2 = Math.asin(Math.sin(la1) * Math.cos(dr)
                            + Math.cos(la1) * Math.sin(dr) * Math.cos(br))
        const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la1),
                                     Math.cos(dr) - Math.sin(la1) * Math.sin(la2))
        return [CesiumMath.toDegrees(lo2), CesiumMath.toDegrees(la2)]
    }

    return (
        <>
            {axes.map((a, i) => {
                if (a.bearing_deg == null) return null
                const [tipLon, tipLat] = destination(a.lat, a.lon, a.bearing_deg, ARROW_KM)
                // Two short barbs make the head, so it reads as an arrow
                // at a glance without needing a billboard.
                const [b1Lon, b1Lat] = destination(tipLat, tipLon, a.bearing_deg + 150, ARROW_KM * 0.3)
                const [b2Lon, b2Lat] = destination(tipLat, tipLon, a.bearing_deg - 150, ARROW_KM * 0.3)
                return (
                    <Entity key={`axis-${i}`} name="Axis of attack (illustrative)"
                        description={
                            `<div style="font:400 12px sans-serif">`
                            + `<b>Axis of attack</b><br/>`
                            + `bearing ${a.bearing_deg}&deg;<br/>`
                            + `<span style="opacity:.7">${a.bearing_basis || ""}</span></div>`
                        }
                        polyline={{
                            positions: Cartesian3.fromDegreesArray([
                                a.lon, a.lat, tipLon, tipLat,
                                b1Lon, b1Lat, tipLon, tipLat, b2Lon, b2Lat,
                            ]),
                            width: 2,
                            material: Color.fromCssColorString("#ff5252").withAlpha(0.75),
                            clampToGround: true,
                        }} />
                )
            })}
        </>
    )
}
