/**
 * GlobePoliceActionsLayer.jsx — street reports on the globe, part of
 * "Demonstrations, live" (mounted beside GlobeDemonstrationsLayer with the
 * same switch). Read every 30 s while on from
 * GET /api/routes/demonstrations/street (backend/street_reports.py); drawn by
 * globe/policeActions.js, shared with the phone: tear gas as a faint area,
 * a kettle as police lines across the square's exit streets, police moving in
 * as an arrow, everything else as a mark with its words. Entity type
 * "police_action": a click opens the posts behind it.
 */
import { memo, useEffect, useMemo, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference, PolylineDashMaterialProperty } from "cesium"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { POLICE_PATH, POLICE_REFRESH_MS, policeFeatures } from "./policeActions.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

export default function GlobePoliceActionsLayer({ enabled = false }) {
    const { viewer } = useCesium()
    const [data, setData] = useState(null)
    const [nowMs, setNowMs] = useState(() => Date.now())

    useEffect(() => {
        if (!enabled) { setData(null); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}${POLICE_PATH}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) { setData(d); setNowMs(Date.now()) } })
            .catch(() => { /* keep the last reports */ })
        load()
        const iv = setInterval(load, POLICE_REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])

    const feats = useMemo(() => policeFeatures(data, nowMs), [data, nowMs])

    useEffect(() => {
        // every drawn piece opens the same card: a kettle's bars, a gas area's fill
        const ids = feats.flatMap((f) => {
            const n = !f.marker && Array.isArray(f.coords?.[0]?.[0]) ? f.coords.length : 1
            return [[f.id, f], ...Array.from({ length: n - 1 }, (_, i) => [`${f.id}-${i + 1}`, f]), ...(f.area ? [[`${f.id}-fill`, f]] : [])]
        })
        ids.forEach(([id, f]) => setEntity(id, "police_action", f.raw))
        viewer?.scene?.requestRender?.()
        return () => ids.forEach(([id]) => deleteEntity(id))
    }, [feats, viewer])

    if (!enabled || !feats.length) return null
    return <>{feats.map((f) => <PoliceEntity key={f.id} f={f} />)}</>
}

const PoliceEntity = memo(function PoliceEntity({ f }) {
    const parts = useMemo(() => {
        if (f.marker) return []
        const ps = Array.isArray(f.coords?.[0]?.[0]) ? f.coords : [f.coords]
        return ps.map((p) => p.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat)))
    }, [f])
    const material = useMemo(() => {
        if (f.marker) return null
        const c = Color.fromCssColorString(f.color)
        return f.dash ? new PolylineDashMaterialProperty({ color: c, dashLength: 12 }) : c
    }, [f])
    if (f.marker) {
        const mk = f.marker
        return (
            <Entity id={f.id} name={f.title} position={Cartesian3.fromDegrees(mk.lon, mk.lat, 0)}
                    billboard={{ image: mk.iconUri, width: mk.iconWidth, height: mk.iconHeight,
                                 // the disc's centre on the place, the words to its right
                                 pixelOffset: new Cartesian2(mk.iconWidth / 2 - mk.iconAnchor[0], mk.iconHeight / 2 - mk.iconAnchor[1]),
                                 heightReference: HeightReference.CLAMP_TO_GROUND,
                                 distanceDisplayCondition: new DistanceDisplayCondition(0, 600_000),
                                 disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
        )
    }
    return (
        <>
            {f.area && (
                <Entity id={`${f.id}-fill`} name={f.title} position={Cartesian3.fromDegrees(f.area.lon, f.area.lat, 0)}
                        ellipse={{ semiMajorAxis: f.area.radius_m, semiMinorAxis: f.area.radius_m,
                                   material: Color.fromCssColorString(f.area.fill) }} />
            )}
            {parts.map((positions, i) => (
                <Entity key={i} id={i ? `${f.id}-${i}` : f.id} name={f.title}
                        polyline={{ positions, width: f.weight, clampToGround: true, material }} />
            ))}
        </>
    )
})
