/**
 * GlobeMeLayer.jsx — the blue dot: where you are (owner, 2026-10-10).
 *
 * A small blue dot (lib/mapIcons.js dotIcon "me", the same on the phone):
 * live while this device is sharing its location (location/liveShare.js),
 * else the place you gave. Blue, because every warm colour on this map is a
 * severity.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, HeightReference } from "cesium"
import { dotIcon, SIZE } from "../lib/mapIcons.js"
import { myPosition, subscribeMyPosition } from "../location/liveShare.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

// THE ONE TYPOLOGY (lib/mapIcons.js): you are a blue dot, 14 px, white edge; hollow when not live. No glow.
const me14 = (live) => dotIcon({ role: "me", live }).uri

export default function GlobeMeLayer() {
    const [me, setMe] = useState(() => myPosition())
    useEffect(() => subscribeMyPosition(setMe), [])
    if (!me) return null
    return (
        <Entity name={me.live ? "You (live)" : "You"} position={Cartesian3.fromDegrees(me.lon, me.lat, 0)}
                billboard={{ image: me14(!!me.live), width: SIZE.me, height: SIZE.me, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: MARKER_DEPTH_TEST_M, 
                             color: Color.WHITE }}
                description={me.live ? "Where you are now (shared live)" : `Where you said you are${me.label ? `: ${me.label}` : ""}`} />
    )
}
