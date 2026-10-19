/**
 * GlobeDemonstrationsLayer.jsx — "Demonstrations, live" (owner, 2026-10-17:
 * "I want to be able to more or less follow in real time the demonstrations
 * and happenings in a city").
 *
 * NEAR REAL TIME (owner, 2026-10-19: "the protest movements can be followed
 * in near real time in the desktop version"): every answer is read again
 * every 15 s while something is under way and every 2 min when nothing is
 * (demoLive.js), at once when the window comes back; the ages on the map
 * ("12 min ago", "reports 3 min ago") count up every 15 s between reads.
 *
 * One answer (GET /api/routes/demonstrations, backend/demonstrations.py):
 *   · every current demonstration or happening the route planner ("Get me
 *     out") avoids — its own hazards — as the unrest diamond in the planner's
 *     ring (entity type "demonstration");
 *   · protester movement RECONSTRUCTED from Telegram reports: one line per
 *     hop, fainter with age, an arrowhead on the latest and "last reported
 *     HH:MM" at its head (entity type "protest_track"; each hop carries the
 *     posts behind it).
 *   · the CITY SITUATION (owner, 2026-10-17: "last known locations,
 *     probable points of convergence … Movements displayed in real time"),
 *     GET /api/routes/demonstrations/situation every 30 s: crowds' last known
 *     places fading with age and their paths ("demo_crowd", "demo_path"),
 *     dashed walking routes toward the probable convergence points
 *     ("demo_route") and those points, ringed and labelled as an estimate
 *     ("demo_convergence"). A crowd's path covers the reconstructed tracks
 *     (and the positions people report themselves), so once the situation
 *     has answered the track hops are not drawn twice.
 *   · ANNOUNCED PROTESTS and where they stand now (owner, 2026-10-18: "I
 *     want to read e.g. 'Currently ongoing'"): the same answer's `protests`
 *     (backend protest_status.py), a crowd mark ringed by status with its
 *     words — "Ongoing · since 14:00", "Planned · starts in 3 h" — beside it
 *     (entity type "protest"; the card has the photos, videos and crowd).
 * The drawing rules are in demonstrations.js and demoSituation.js, shared with the phone.
 */
import { memo, useEffect, useMemo, useState } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference, PolylineDashMaterialProperty } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { DEMOS_PATH, DEMO_SIZE, TRACK_COLOUR, demoIconUri, demoRaw, trackSegments } from "./demonstrations.js"
import { SITUATION_PATH, situationFeatures } from "./demoSituation.js"
import { LIVE_MS, livePoll } from "./demoLive.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"
import { protestPoints } from "./protests.js"

const css = (c, a = 1) => Color.fromCssColorString(c).withAlpha(a)

export default function GlobeDemonstrationsLayer({ enabled = false }) {
    const { viewer } = useCesium()
    const [data, setData] = useState(null)
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [sit, setSit] = useState(null)

    useEffect(() => {
        if (!enabled) { setData(null); return undefined }
        // a dropped poll is not an empty city: the last answer stays
        return livePoll(`${API_BASE}${DEMOS_PATH}`, (d) => { setData(d); setNowMs(Date.now()) })
    }, [enabled])

    useEffect(() => {
        if (!enabled) { setSit(null); return undefined }
        return livePoll(`${API_BASE}${SITUATION_PATH}`, (d) => { setSit(d); setNowMs(Date.now()) })
    }, [enabled])

    // the ages count up between reads ("12 min ago", "reports 3 min ago")
    useEffect(() => {
        if (!enabled) return undefined
        const iv = setInterval(() => setNowMs(Date.now()), LIVE_MS)
        return () => clearInterval(iv)
    }, [enabled])

    const points = useMemo(() => safeArray(data?.demonstrations)
        // an announced gathering is drawn once, as its protest (below)
        .filter((h) => Number.isFinite(+h?.lat) && Number.isFinite(+h?.lon) && !h.protest_id)
        .map((h) => ({ id: `demo-${h.id}`, h, raw: demoRaw(h, nowMs) })), [data, nowMs])
    const situation = useMemo(() => situationFeatures(sit, nowMs), [sit, nowMs])
    const protests = useMemo(() => protestPoints(data, nowMs), [data, nowMs])
    const hasPaths = situation.some((f) => f.type === "demo_crowd")
    const hops = useMemo(() => (hasPaths ? [] : safeArray(data?.tracks).flatMap((t) => trackSegments(t, nowMs))
        .map((s) => ({ ...s, id: `demo-move-${s.id}` }))), [data, nowMs, hasPaths])

    useEffect(() => {
        points.forEach((p) => setEntity(p.id, "demonstration", p.raw))
        hops.forEach((s) => {
            setEntity(s.id, "protest_track", s.raw)
            if (s.marker) setEntity(`${s.id}-head`, "protest_track", s.raw)
        })
        situation.forEach((f) => setEntity(f.id, f.type, f.raw))
        protests.forEach((p) => setEntity(p.id, "protest", p.raw))
        viewer?.scene?.requestRender?.()
        return () => {
            protests.forEach((p) => deleteEntity(p.id))
            points.forEach((p) => deleteEntity(p.id))
            hops.forEach((s) => { deleteEntity(s.id); deleteEntity(`${s.id}-head`) })
            situation.forEach((f) => deleteEntity(f.id))
        }
    }, [points, hops, situation, protests, viewer])

    if (!enabled || (!data && !sit)) return null
    return (
        <>
            {situation.map((f) => <SituationEntity key={f.id} f={f} />)}
            {protests.map((p) => (
                <Entity key={p.id} id={p.id} name={p.title} position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{ image: p.iconUri, width: p.iconWidth, height: p.iconHeight,
                                     // the ring's centre on the place, its status to its right
                                     pixelOffset: new Cartesian2(p.iconWidth / 2 - p.iconAnchor[0], p.iconHeight / 2 - p.iconAnchor[1]),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 3_000_000),
                                     disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            ))}
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
                                     disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            )}
        </>
    )
})

const dashOf = (dash) => { const n = String(dash || "").split(/\s+/).map(Number); return n[0] && n[1] ? (n[0] + n[1] > 10 ? 0xff00 : 0xf0f0) : 0xff00 }

/** One feature of the city situation: a path or route line (dashed for a
 *  route), or a crowd / convergence mark with its words. */
const SituationEntity = memo(function SituationEntity({ f }) {
    const positions = useMemo(() => (f.marker ? null : f.coords.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat))), [f])
    const material = useMemo(() => {
        if (f.marker) return null
        const c = Color.fromCssColorString(f.color)
        return f.dash ? new PolylineDashMaterialProperty({ color: c, dashLength: 14, dashPattern: dashOf(f.dash) }) : c
    }, [f])
    if (f.marker) {
        const mk = f.marker
        return (
            <Entity id={f.id} name={f.title} position={Cartesian3.fromDegrees(mk.lon, mk.lat, 0)}
                    billboard={{ image: mk.iconUri, width: mk.iconWidth, height: mk.iconHeight,
                                 // the mark's centre on the place, its words beside or below it
                                 pixelOffset: new Cartesian2(mk.iconWidth / 2 - mk.iconAnchor[0], mk.iconHeight / 2 - mk.iconAnchor[1]),
                                 heightReference: HeightReference.CLAMP_TO_GROUND,
                                 distanceDisplayCondition: new DistanceDisplayCondition(0, f.maxCameraM || 600_000),
                                 disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
        )
    }
    // a reach ring (maxCameraM) only from street level: its size is on the ground, never swelling with zoom
    const ddc = f.maxCameraM ? new DistanceDisplayCondition(0, f.maxCameraM) : undefined
    return <Entity id={f.id} name={f.title} polyline={{ positions, width: f.weight, clampToGround: true, material, distanceDisplayCondition: ddc }} />
})
