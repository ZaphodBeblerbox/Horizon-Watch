/**
 * GlobeMeLayer.jsx — the blue dot: where you are (owner, 2026-10-10).
 *
 * A small blue dot with a soft glow, the way maps on a phone show "you":
 * live while this device is sharing its location (location/liveShare.js),
 * else the place you gave. Blue, because every warm colour on this map is a
 * severity.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, HeightReference, NearFarScalar } from "cesium"
import { myPosition, subscribeMyPosition } from "../location/liveShare.js"

const GLOW = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs><radialGradient id="g"><stop offset="0" stop-color="#3b8cff" stop-opacity=".55"/><stop offset=".55" stop-color="#3b8cff" stop-opacity=".18"/><stop offset="1" stop-color="#3b8cff" stop-opacity="0"/></radialGradient></defs>
  <circle cx="32" cy="32" r="32" fill="url(#g)"/>
  <circle cx="32" cy="32" r="8.5" fill="#2f7cf6" stroke="#ffffff" stroke-width="3"/>
</svg>`)}`

export default function GlobeMeLayer() {
    const [me, setMe] = useState(() => myPosition())
    useEffect(() => subscribeMyPosition(setMe), [])
    if (!me) return null
    return (
        <Entity name={me.live ? "You (live)" : "You"} position={Cartesian3.fromDegrees(me.lon, me.lat, 0)}
                billboard={{ image: GLOW, width: 40, height: 40, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new NearFarScalar(2e5, 1.15, 2e7, 0.75),
                             color: me.live ? Color.WHITE : Color.WHITE.withAlpha(0.85) }}
                description={me.live ? "Where you are now (shared live)" : `Where you said you are${me.label ? `: ${me.label}` : ""}`} />
    )
}
