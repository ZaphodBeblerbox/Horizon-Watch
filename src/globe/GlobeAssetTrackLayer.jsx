/**
 * GlobeAssetTrackLayer.jsx — the shown track on the globe (location/track.js):
 * the line coloured by age (older fades), an amber numbered dot at each
 * stop of 10 minutes or more (its description says arrived, left, how
 * long), a hollow blue start, a filled blue end, and while replaying the line
 * up to the scrubber with a ringed blue dot where they were then. Every dot is
 * the one typology's (lib/mapIcons.js dotIcon), constant in size; no green. Flies to the track
 * when it is first shown.
 */
import { useEffect, useMemo, useRef } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, HeightReference, LabelStyle, PolylineDashMaterialProperty } from "cesium"
import { useTrackState } from "../location/TrackPanel.jsx"
import { ageSegments, upTo, positionAt, stopLabel, tsOf, dayHm } from "../location/track.js"
import { useRenderTick } from "./useGlidingPosition.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"
import { dotIcon } from "../lib/mapIcons.js"

// LINES A FEW METRES UP, NOT CLAMPED: a ground polyline needs GPU support some
// machines (and headless checks) lack, and then draws nothing; with a
// depth-fail material the line still shows where terrain rises over it.
const flat = (coords) => Cartesian3.fromDegreesArrayHeights(coords.flatMap(([lat, lon]) => [lon, lat, 4]))
/** A track's dot as a billboard: start, end, stop (with its number), now (lib/mapIcons.js dotIcon). */
const dot = (role, label = null) => {
    const i = dotIcon({ role, label })
    return { image: i.uri, width: i.w, height: i.h, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: MARKER_DEPTH_TEST_M }
}

export default function GlobeAssetTrackLayer() {
    const s = useTrackState()
    const { viewer } = useCesium() || {}
    const flown = useRef(null)
    const all = s.data?.points || []
    const range = all.length ? [tsOf(all[0]), tsOf(all[all.length - 1])] : null
    const pts = s.scrubT != null ? upTo(all, s.scrubT) : all
    const segs = useMemo(() => ageSegments(pts, 14, range), [pts, range?.[0], range?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
    const now = s.scrubT != null ? positionAt(all, s.scrubT) : null

    useEffect(() => { if (viewer && !viewer.isDestroyed?.()) viewer.scene?.requestRender?.() })
    useRenderTick(!!s.target && all.length > 0, 1000)     // lines built off the main thread: render when they are ready
    // FLY to it once per shown track
    useEffect(() => {
        const key = s.target ? `${s.target.kind}:${s.target.id}:${s.range}` : null
        if (!key || !all.length || flown.current === key) return
        flown.current = key
        let [s0, n0, w0, e0] = [90, -90, 180, -180]
        for (const p of all) { s0 = Math.min(s0, p.lat); n0 = Math.max(n0, p.lat); w0 = Math.min(w0, p.lon); e0 = Math.max(e0, p.lon) }
        const span = Math.max(n0 - s0, (e0 - w0) * Math.cos(((n0 + s0) / 2) * Math.PI / 180), 0.004)
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: (n0 + s0) / 2, lon: (w0 + e0) / 2, altitude: Math.max(1500, span * 111_000 * 2.2) } }))
    }, [s.target, s.range, all.length]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!s.target || !all.length) return null
    const s0 = all[0], e = all[all.length - 1]
    return (
        <>
            {s.scrubT != null && all.length > 1 && (
                <Entity id="track-ghost" polyline={{ positions: flat(all.map((p) => [p.lat, p.lon])), width: 2, clampToGround: false,
                                                     material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#8fa3c4").withAlpha(0.35) }),
                                                     depthFailMaterial: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#8fa3c4").withAlpha(0.35) }) }} />
            )}
            {segs.map((g, i) => (
                <Entity key={`seg-${i}`} id={`track-seg-${i}`} polyline={{ positions: flat(g.coords), width: 4, clampToGround: false,
                    material: new Color(g.color.r / 255, g.color.g / 255, g.color.b / 255, g.color.a), depthFailMaterial: new Color(g.color.r / 255, g.color.g / 255, g.color.b / 255, g.color.a) }} />
            ))}
            {(s.data.stops || []).map((st, i) => (s.scrubT != null && Date.parse(st.arrived) > s.scrubT) ? null : (
                <Entity key={`stop-${i}`} id={`track-stop-${i}`} name={`Stop ${i + 1}`} description={stopLabel(st)}
                        position={Cartesian3.fromDegrees(st.lon, st.lat)} billboard={dot("stop", i + 1)} />
            ))}
            <Entity id="track-start" name="Start of the track" description={dayHm(s0.at)} position={Cartesian3.fromDegrees(s0.lon, s0.lat)}
                    billboard={dot("start")}
                    label={{ text: "Start", font: "600 12px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                             style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -16), heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            {now ? (
                <Entity id="track-now" position={Cartesian3.fromDegrees(now.lon, now.lat)} billboard={dot("now")}
                        label={{ text: dayHm(new Date(now.at).toISOString()), font: "600 12px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK,
                                 outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -18),
                                 heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            ) : (
                <Entity id="track-end" name="Latest position" description={dayHm(e.at)} position={Cartesian3.fromDegrees(e.lon, e.lat)}
                        billboard={dot("end")} />
            )}
        </>
    )
}
