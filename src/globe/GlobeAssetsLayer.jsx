/**
 * GlobeAssetsLayer.jsx — our assets on the map.
 *
 * Each registered asset (destinations/Assets.jsx) is the one typology's pin (lib/mapIcons.js):
 * its kind's glyph on gold, the edge on the priority ramp for how exposed it is
 * right now (high, elevated, low, quiet), 30x36 at every zoom. Close in, its name shows and its
 * watch radius is drawn on the ground. A click opens it in the register.
 * Vessels and aircraft are where the live feeds last saw them; an asset a
 * phone moves (a person, the car they are in) is pushed with each position
 * (location/positionStream.js) and glides there.
 */
import { useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, DistanceDisplayCondition, HeightReference, LabelStyle, VerticalOrigin, Cartesian2 } from "cesium"
import { pinIcon, priorityOf, clusterIcon, SIZE } from "../lib/mapIcons.js"
import { useDeclutter, clusterRecord } from "./screenDeclutter.js"
import API_BASE from "../apiBase.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { useStream } from "../location/useLivePositions.js"
import { useGlidingPosition } from "./useGlidingPosition.js"

// THE ONE TYPOLOGY (lib/mapIcons.js): ours is a pin, 30x36, a gold tile with the kind's glyph; the pin's edge is
// the exposure on the priority ramp (high = flash, elevated = urgent, low = alert, quiet = info: never green).
const icon = (group, exposure) => pinIcon({ glyph: group || "Sites", priority: priorityOf(exposure, "info") }).uri
const PIN = SIZE.pin

export default function GlobeAssetsLayer({ enabled = true, teamOn = false }) {
    const [assets, setAssets] = useState([])
    useEffect(() => {
        if (!enabled) { setAssets([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/my-assets`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setAssets((d.assets || []).filter((a) => a.position)) })
            .catch(() => {})
        load()
        const iv = setInterval(load, 60_000)
        const onChange = () => load()
        window.addEventListener("akili:assets-changed", onChange)
        return () => { live = false; clearInterval(iv); window.removeEventListener("akili:assets-changed", onChange) }
    }, [enabled])
    useEffect(() => {
        assets.forEach((a) => setEntity(`asset-${a.id}`, "owned_asset", a))
        return () => assets.forEach((a) => deleteEntity(`asset-${a.id}`))
    }, [assets])
    // the stream is read only when an asset here is moved by a phone
    const stream = useStream(enabled && assets.some((a) => a.identifiers?.user_id))
    // what is drawn, where: the moved position when a phone sent a fresher one
    const drawn = assets.map((a) => {
        if (a.kind === "person" && a.identifiers?.user_id && teamOn) return null
        if (a.kind === "safe_house" || a.is_safe_house) return null
        const sp = a.identifiers?.user_id ? stream.asset(a.id) : null
        const fresher = sp && sp.at >= (Date.parse(a.position?.as_of || "") || 0)
        return { a, lat: +(fresher ? sp.lat : a.position.lat), lon: +(fresher ? sp.lon : a.position.lon),
                 gapMs: fresher && sp.prevAt ? sp.at - sp.prevAt : undefined }
    }).filter(Boolean)
    const sig = drawn.map((d) => `${d.a.id}|${d.lat.toFixed(5)}|${d.lon.toFixed(5)}|${d.a.exposure}`).join(";")
    // ONE COLLISION PASS with every other point layer (screenDeclutter.js): no overlapping markers
    const items = useMemo(() => drawn.map((d) => ({ id: `asset-${d.a.id}`, lat: d.lat, lon: d.lon, size: PIN.h, pri: priorityOf(d.a.exposure, "info"),
                                                    title: d.a.name || "Asset", line: [d.a.type_label || d.a.group, d.a.exposure ? `${d.a.exposure} exposure` : null].filter(Boolean).join(" · ") })),
                          [sig]) // eslint-disable-line react-hooks/exhaustive-deps
    const layout = useDeclutter("assets", items, enabled)
    const clusters = layout.filter((g) => g.cluster)
    useEffect(() => {
        clusters.forEach((g) => setEntity(g.id, "telegram", clusterRecord(g)))
        return () => clusters.forEach((g) => deleteEntity(g.id))
    }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!enabled || !drawn.length) return null
    const single = new Set(layout.filter((g) => !g.cluster).map((g) => g.id))
    return (
        <>
            {drawn.map((d) => (single.has(`asset-${d.a.id}`)
                // ONE component whatever the source: swapping component types when the
                // first live position arrived re-added the entity id before the old one was
                // gone ("An entity with id asset-… already exists", Cesium DeveloperError)
                ? <LivePin key={d.a.id} a={d.a} lat={d.lat} lon={d.lon} gapMs={d.gapMs} /> : null))}
            {clusters.map((g) => (
                <Entity key={g.id} id={g.id} name={`${g.members.length} here`} position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                        billboard={{ image: clusterIcon(g.members.length, g.pri).uri, width: SIZE.cluster, height: SIZE.cluster,
                                     heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -120) }} />
            ))}
        </>
    )
}

function LivePin({ a, lat, lon, gapMs }) {
    return <Pin a={a} position={useGlidingPosition(lat, lon, gapMs)} />
}

function Pin({ a, position: p }) {
    return (
        <>
            <Entity id={`asset-${a.id}`} position={p}
                billboard={{ image: icon(a.group, a.exposure), width: PIN.w, height: PIN.h, verticalOrigin: VerticalOrigin.BOTTOM,
                             heightReference: HeightReference.CLAMP_TO_GROUND, eyeOffset: new Cartesian3(0, 0, -120),
                             }}
                label={{ text: a.name, font: "600 13px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                         style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 6),
                         heightReference: HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new DistanceDisplayCondition(0, 600_000) }} />
        </>
    )
}
