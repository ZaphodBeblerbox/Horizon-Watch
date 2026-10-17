/**
 * GlobeDemonstrationsLayer.jsx — "Demonstrations, live" (owner, 2026-10-17:
 * "I want to be able to more or less follow in real time the demonstrations
 * and happenings in a city").
 *
 * One answer, read every minute while on (GET /api/routes/demonstrations,
 * backend/demonstrations.py):
 *   · every current demonstration or happening the route planner ("Get me
 *     out") avoids — its own hazards — as the unrest diamond in the planner's
 *     ring (entity type "demonstration");
 *   · protester movement RECONSTRUCTED from Telegram reports: one line per
 *     hop, fainter with age, an arrowhead on the latest and "last reported
 *     HH:MM" at its head (entity type "protest_track"; each hop carries the
 *     posts behind it).
 * The drawing rules are in demonstrations.js, shared with the phone.
 */
import { memo, useEffect, useMemo, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { DEMOS_PATH, DEMOS_REFRESH_MS, DEMO_SIZE, TRACK_COLOUR, demoIconUri, demoRaw, trackSegments } from "./demonstrations.js"

const css = (c, a = 1) => Color.fromCssColorString(c).withAlpha(a)

export default function GlobeDemonstrationsLayer({ enabled = false }) {
    const { viewer } = useCesium()
    const [data, setData] = useState(null)
    const [nowMs, setNowMs] = useState(() => Date.now())

    useEffect(() => {
        if (!enabled) { setData(null); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}${DEMOS_PATH}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) { setData(d); setNowMs(Date.now()) } })
            .catch(() => { /* a dropped poll is not an empty city */ })
        load()
        const iv = setInterval(load, DEMOS_REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])

    const points = useMemo(() => safeArray(data?.demonstrations)
        .filter((h) => Number.isFinite(+h?.lat) && Number.isFinite(+h?.lon))
        .map((h) => ({ id: `demo-${h.id}`, h, raw: demoRaw(h, nowMs) })), [data, nowMs])
    const hops = useMemo(() => safeArray(data?.tracks).flatMap((t) => trackSegments(t, nowMs))
        .map((s) => ({ ...s, id: `demo-move-${s.id}` })), [data, nowMs])

    useEffect(() => {
        points.forEach((p) => setEntity(p.id, "demonstration", p.raw))
        hops.forEach((s) => {
            setEntity(s.id, "protest_track", s.raw)
            if (s.marker) setEntity(`${s.id}-head`, "protest_track", s.raw)
        })
        viewer?.scene?.requestRender?.()
        return () => {
            points.forEach((p) => deleteEntity(p.id))
            hops.forEach((s) => { deleteEntity(s.id); deleteEntity(`${s.id}-head`) })
        }
    }, [points, hops, viewer])

    if (!enabled || !data) return null
    return (
        <>
            {hops.map((s) => <HopEntity key={s.id} s={s} />)}
            {points.map((p) => (
                <Entity key={p.id} id={p.id} name={p.raw.title} position={Cartesian3.fromDegrees(+p.h.lon, +p.h.lat, 0)}
                        billboard={{ image: demoIconUri(p.h, nowMs), width: DEMO_SIZE, height: DEMO_SIZE,
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000),
                                     eyeOffset: new Cartesian3(0, 0, -65) }} />
            ))}
        </>
    )
}

/** One hop: the shaft (and, on the latest, the arrowhead as from → to → barb → to → barb), the head's words. */
const HopEntity = memo(function HopEntity({ s }) {
    const positions = useMemo(() => {
        const [shaft, head] = Array.isArray(s.coords[0]?.[0]) ? s.coords : [s.coords, null]
        const pts = head ? [shaft[0], shaft[1], head[0], head[1], head[2]] : shaft
        return pts.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat))
    }, [s.coords])
    const mk = s.marker
    return (
        <>
            <Entity id={s.id} name={s.title}
                    polyline={{ positions, width: s.weight, clampToGround: true, material: css(TRACK_COLOUR, s.alpha) }} />
            {mk && (
                <Entity id={`${s.id}-head`} name={s.title} position={Cartesian3.fromDegrees(mk.lon, mk.lat, 0)}
                        billboard={{ image: mk.iconUri, width: mk.iconWidth, height: mk.iconHeight,
                                     // the ring's centre on the place, the words to its right
                                     pixelOffset: new Cartesian2(mk.iconWidth / 2 - mk.iconAnchor[0], mk.iconHeight / 2 - mk.iconAnchor[1]),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 400_000),
                                     disableDepthTestDistance: Number.POSITIVE_INFINITY }} />
            )}
        </>
    )
})
