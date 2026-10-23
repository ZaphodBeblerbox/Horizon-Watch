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
import { Color, DistanceDisplayCondition, HeightReference, LabelStyle, VerticalOrigin, Cartesian2, CallbackProperty } from "cesium"
import { dotIcon, SIZE } from "../lib/mapIcons.js"
import { useMemo, useRef } from "react"
import { useLivePeople } from "../location/useLivePositions.js"
import { positionStream } from "../location/positionStream.js"
import { freshness, presence } from "../location/glide.js"
import { useGlidingPosition, useRenderTick } from "./useGlidingPosition.js"
import { getCurrentUser } from "../state/authStore.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

// THE ONE TYPOLOGY (lib/mapIcons.js): a team member is a blue dot, 12 px; hollow when not live, a dotted edge
// for a city-level fix
const teamDot = (live, coarse) => dotIcon({ role: "team", live, coarse }).uri
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
                billboard={{ image: teamDot(live, coarseOf(p)), width: SIZE.team, height: SIZE.team, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: MARKER_DEPTH_TEST_M, }}
                label={{ text, font: "600 12.5px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                         style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 9),
                         heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                         distanceDisplayCondition: new DistanceDisplayCondition(0, 3_000_000) }} />
    )
}

export default function GlobeTeamLayer({ enabled = true }) {
    const people = useLivePeople(enabled)
    useRenderTick(enabled && people.length > 0, 1000)
    const uid = getCurrentUser()?.id
    // you are the blue dot (GlobeMeLayer), never also a team dot on top of it (owner, 2026-10-23 evening)
    const others = people.filter((p) => String(p.user_id) !== String(uid))
    if (!enabled || !others.length) return null
    return <>{others.map((p) => <Person key={p.user_id} p={p} me={false} />)}</>
}
