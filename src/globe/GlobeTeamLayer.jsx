/**
 * GlobeTeamLayer.jsx — the team on the globe, live (owner, 2026-10-12: "the
 * location has to update in real time").
 *
 * Everyone sharing their location whom this user may see, pushed as each
 * position is sent (location/positionStream.js — no polling), drawn as a
 * blue dot that glides to each new fix, with the name and how fresh it is:
 * "live · 3 s ago", or "last seen 4 min ago". A city-level fix (a
 * connection's, not a device's) is pale and says so. Shown with "Our
 * assets": the team is what those assets are for.
 */
import { Entity } from "resium"
import { Color, DistanceDisplayCondition, HeightReference, LabelStyle, NearFarScalar, VerticalOrigin, Cartesian2, CallbackProperty } from "cesium"
import { useMemo, useRef } from "react"
import { useLivePeople } from "../location/useLivePositions.js"
import { positionStream } from "../location/positionStream.js"
import { freshness, presence } from "../location/glide.js"
import { useGlidingPosition, useRenderTick } from "./useGlidingPosition.js"
import { getCurrentUser } from "../state/authStore.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

const dot = (fill, live) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="18" fill="${fill}" fill-opacity="${live ? 0.26 : 0.12}"/>
  <circle cx="20" cy="20" r="8" fill="${fill}" stroke="#ffffff" stroke-width="3" ${live ? "" : 'stroke-dasharray="3 3"'}/>
</svg>`)}`
const ICONS = { "1|0": dot("#3b8cff", true), "0|0": dot("#3b8cff", false), "1|1": dot("#8FB4E8", true), "0|1": dot("#8FB4E8", false) }
const coarseOf = (p) => p.source === "ip" || (p.accuracy_m ?? 0) >= 1000

function Person({ p, me }) {
    const position = useGlidingPosition(p.lat, p.lon, p.prevAt ? p.at - p.prevAt : undefined)
    const pRef = useRef(p)
    pRef.current = p
    const name = me ? `${p.name} (you)` : p.name
    // the label counts up between positions, on the server's clock
    const text = useMemo(() => new CallbackProperty(() => {
        const q = pRef.current
        return `${name}\n${presence(q.at, positionStream().serverNow())}`
    }, false), [name])
    const live = freshness(p.at, positionStream().serverNow()).live
    return (
        <Entity id={`team-${p.user_id}`} name={name} position={position}
                description={`${name} — ${coarseOf(p) ? "city level, from their connection" : p.accuracy_m != null ? `within ${Math.round(p.accuracy_m)} m` : "live location"}`}
                billboard={{ image: ICONS[`${live ? 1 : 0}|${coarseOf(p) ? 1 : 0}`], width: 30, height: 30, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: MARKER_DEPTH_TEST_M, scaleByDistance: new NearFarScalar(2e4, 1.1, 8e6, 0.7) }}
                label={{ text, font: "600 12.5px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                         style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 14),
                         heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                         distanceDisplayCondition: new DistanceDisplayCondition(0, 3_000_000) }} />
    )
}

export default function GlobeTeamLayer({ enabled = true }) {
    const people = useLivePeople(enabled)
    useRenderTick(enabled && people.length > 0, 1000)
    const uid = getCurrentUser()?.id
    if (!enabled || !people.length) return null
    return <>{people.map((p) => <Person key={p.user_id} p={p} me={String(p.user_id) === String(uid)} />)}</>
}
