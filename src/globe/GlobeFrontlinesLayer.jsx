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
import { crossfade, progress } from "./frontlineFade.js"
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
    // The snapshot being faded out, and the animation running the fade.
    const fadingRef = useRef(null)
    const rafRef = useRef(0)
    // Which snapshot is on screen, so an unchanged refresh is a no-op.
    const snapshotRef = useRef(null)
    // Teardown is held in a ref because the effect below must NOT tear
    // the map down when only the date changes — see its return.
    const clearRef = useRef(null)
    const [meta, setMeta] = useState(null)
    const [axes, setAxes] = useState([])

    useEffect(() => {
        if (!viewer) return
        let cancelled = false

        const drop = (ds, ids) => {
            (ids || []).forEach(deleteEntity)
            if (ds && !viewer.isDestroyed?.()) {
                try { viewer.dataSources.remove(ds, true) } catch { /* torn down */ }
            }
        }

        // Ends any fade in flight and removes the snapshot it was
        // retiring, so a fast scrub cannot strand a half-faded map.
        const settle = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            if (fadingRef.current) {
                drop(fadingRef.current.ds, fadingRef.current.ids)
                fadingRef.current = null
            }
        }

        const clear = () => {
            settle()
            drop(dsRef.current, idsRef.current)
            idsRef.current = []
            dsRef.current = null
        }

        // Opacity as a fraction of each area's own base opacity, which
        // differs by status: contested ground is drawn heavier than
        // retaken ground and must stay that way through the fade.
        const applyAlpha = (ds, k) => {
            if (!ds) return
            ds.entities.values.forEach((e) => {
                if (e.polygon && e.__fill) {
                    e.polygon.material =
                        Color.fromCssColorString(e.__fill).withAlpha(e.__baseAlpha * k)
                }
            })
        }

        if (!enabled) { clear(); setMeta(null); setAxes([]); return }

        const load = () => {
            fetch(`${API_BASE}/api/frontlines${at ? `?at=${encodeURIComponent(at)}` : ""}`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then(async (d) => {
                    if (cancelled) return
                    // An explicit "no map for this date" clears, because
                    // leaving the previous snapshot up under the new
                    // date's label reads as a fact about that date. A
                    // dropped request is different — it is no answer at
                    // all, and is handled by .catch below, which keeps
                    // what is on screen.
                    if (!d?.available || !d.geojson?.features?.length) {
                        clear(); snapshotRef.current = null
                        setMeta(d || null); setAxes([])
                        return
                    }
                    setAxes(Array.isArray(d.attack_axes) ? d.attack_axes : [])
                    const ds = await CesiumGeoJsonDataSource.load(d.geojson, {
                        stroke: Color.TRANSPARENT,
                        fill: Color.TRANSPARENT,
                        clampToGround: true,
                    })
                    if (cancelled || viewer.isDestroyed?.()) { ds.destroy(); return }

                    // The refresh poll returns the same map most of the
                    // time. Rebuilding identical geometry every cycle
                    // churned the whole layer and would now also fade it
                    // into itself, so an unchanged snapshot is left alone.
                    if (dsRef.current && d.snapshot_id
                        && d.snapshot_id === snapshotRef.current) { ds.destroy(); return }
                    snapshotRef.current = d.snapshot_id

                    setMeta(d)

                    const ids = []
                    ds.entities.values.forEach((entity, i) => {
                        const raw = entity.properties?.getValue?.(_TIME) || {}
                        const style = STATUS_STYLE[raw.status]
                        if (entity.polygon && style) {
                            // Kept on the entity so the fade can scale it
                            // without re-deriving the status every frame.
                            entity.__fill = style.fill
                            entity.__baseAlpha = style.alpha
                            entity.polygon.material =
                                Color.fromCssColorString(style.fill).withAlpha(0)
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
                    // CROSSFADE, NOT A SWAP. The outgoing snapshot stays
                    // on the map until the incoming one has loaded and is
                    // being faded up, so scrubbing the slider no longer
                    // flashes an empty country between every pair of
                    // dates. Only opacity moves: every frame is made of
                    // geometry somebody actually surveyed.
                    settle()
                    const outgoing = dsRef.current
                        ? { ds: dsRef.current, ids: idsRef.current } : null
                    fadingRef.current = outgoing
                    idsRef.current = ids
                    dsRef.current = ds
                    viewer.dataSources.add(ds)

                    if (!outgoing) { applyAlpha(ds, 1); return }

                    const t0 = performance.now()
                    const step = () => {
                        if (viewer.isDestroyed?.()) return
                        const t = progress(performance.now(), t0)
                        const { outgoing: o, incoming: i } = crossfade(t)
                        applyAlpha(ds, i)
                        applyAlpha(outgoing.ds, o)
                        // The scene may be in requestRender mode, where
                        // changing a material does not itself draw a frame.
                        viewer.scene?.requestRender?.()
                        if (t < 1) { rafRef.current = requestAnimationFrame(step); return }
                        rafRef.current = 0
                        fadingRef.current = null
                        drop(outgoing.ds, outgoing.ids)
                    }
                    rafRef.current = requestAnimationFrame(step)
                })
                .catch(() => { /* a dropped poll is not a peace settlement */ })
        }

        clearRef.current = clear
        load()
        const h = setInterval(load, REFRESH_MS)
        // DELIBERATELY NOT clear(). This effect re-runs whenever the date
        // changes, and clearing here tore the map down BEFORE the next
        // snapshot had even been requested — so scrubbing emptied the
        // country and there was nothing left to fade from. Measured: 102
        // of 108 sampled frames during one scrub had no polygons at all.
        // Teardown now happens on unmount, or when the layer is switched
        // off, both of which go through clear() directly.
        return () => { cancelled = true; clearInterval(h) }
    }, [viewer, enabled, at])

    // Unmount is the only place the layer is torn down without being
    // replaced by something.
    useEffect(() => () => { clearRef.current?.(); clearRef.current = null }, [])

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
