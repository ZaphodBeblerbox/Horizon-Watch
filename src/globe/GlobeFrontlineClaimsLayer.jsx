/**
 * GlobeFrontlineClaimsLayer.jsx — three layers from one response
 * (backend/frontline_claims.py, GET /api/frontlines/overlay):
 *
 *   "Frontline claims" — a disc around each place a report says was taken,
 *     on top of the official line: hatched while CLAIMED, unverified; solid
 *     once DeepStateMap agrees; grey and faint when expired or contradicted.
 *   "Movements" — an arrow from the actor's side of the front to the place,
 *     the unit's NATO APP-6 symbol (milsymbol) at its tail.
 *   "Trajectories" — each drone or missile from its launch origin (the
 *     report's, or an ASSUMED one, labelled so) to its target: drones low,
 *     ballistic missiles on a high arc, cruise missiles on a low one. A
 *     click opens the card, which asks for a replay (akili:trajectory-replay):
 *     the Shahed/Geran model (vesselThreat.js, as the vessel-of-concern
 *     simulation) or the missile flies the path, compressed, with the real
 *     flight time on its label.
 *
 * The drawing rules are in frontlineClaims.js. A click opens the inspector
 * (entity types frontline_claim, troop_movement, trajectory;
 * inspector/FrontlineClaimDetail.jsx).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    CallbackProperty, Cartesian2, Cartesian3, Color, ColorBlendMode, DistanceDisplayCondition, HeadingPitchRoll,
    HeightReference, LabelStyle, NearFarScalar, PolygonHierarchy, PolylineDashMaterialProperty, PolylineGlowMaterialProperty,
    StripeMaterialProperty, StripeOrientation, Transforms, VerticalOrigin,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import {
    claimMapLabel, claimRing, claimStyle, milSymbol, movementArrow, overlayUrl, replaySeconds, sideColour,
    trajectoryPath,
} from "./frontlineClaims.js"
import { fmtMinutes, modelHeadingRad, pathLengthKm, positionAlong, shahedModelUri } from "./vesselThreat.js"

const REFRESH_MS = 3 * 60_000
const FONT = "600 12px system-ui, -apple-system, Segoe UI, sans-serif"
const css = (c, a = 1) => Color.fromCssColorString(c).withAlpha(a)

export default function GlobeFrontlineClaimsLayer({ claimsOn = false, movementsOn = false, trajectoriesOn = false }) {
    const { viewer } = useCesium()
    const any = claimsOn || movementsOn || trajectoriesOn
    const [data, setData] = useState(null)

    useEffect(() => {
        if (!any) { setData(null); return undefined }
        let live = true
        const load = () => fetch(overlayUrl(API_BASE), { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setData(d) })
            .catch(() => {})
        load()
        const iv = setInterval(load, REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [any])

    const claims = useMemo(() => (claimsOn ? safeArray(data?.claims).filter((c) => claimRing(c).length > 2) : []), [data, claimsOn])
    const moves = useMemo(() => (movementsOn ? safeArray(data?.movements).filter((m) => m?.to) : []), [data, movementsOn])
    const trajs = useMemo(() => (trajectoriesOn ? safeArray(data?.trajectories).filter((t) => t?.from && t?.to) : []), [data, trajectoriesOn])
    // one label per launch area, however many flights left from it
    const origins = useMemo(() => {
        const by = new Map()
        for (const t of trajs) {
            const k = `${t.from.name || ""}|${(+t.from.lat).toFixed(2)}|${(+t.from.lon).toFixed(2)}`
            if (!by.has(k)) by.set(k, { key: k, t, n: 0 })
            by.get(k).n += 1
        }
        return [...by.values()]
    }, [trajs])

    useEffect(() => {
        // setEntity with the type written out, so GlobePopup.test.js finds
        // each registration and checks the click routes to the inspector.
        // lat/lon = the target, which the inspector's "jump to" reads.
        claims.forEach((c) => setEntity(`fclaim-${c.id}`, "frontline_claim", c))
        moves.forEach((m) => setEntity(`fmove-${m.id}`, "troop_movement", { ...m, lat: m.to.lat, lon: m.to.lon }))
        trajs.forEach((t) => setEntity(`ftraj-${t.id}`, "trajectory", { ...t, lat: t.to.lat, lon: t.to.lon }))
        origins.forEach((o) => setEntity(`ftraj-origin-${o.key}`, "trajectory",
            { ...o.t, lat: o.t.to.lat, lon: o.t.to.lon, flights_from_here: o.n }))
        viewer?.scene?.requestRender?.()
        return () => [
            ...claims.map((c) => `fclaim-${c.id}`), ...moves.map((m) => `fmove-${m.id}`),
            ...trajs.map((t) => `ftraj-${t.id}`), ...origins.map((o) => `ftraj-origin-${o.key}`),
        ].forEach(deleteEntity)
    }, [claims, moves, trajs, origins, viewer])

    if (!any || !data) return <TrajectoryReplay trajectories={trajs} />
    return (
        <>
            {claims.map((c) => <ClaimEntity key={c.id} c={c} />)}
            {moves.map((m) => <MovementEntity key={m.id} m={m} />)}
            {trajs.map((t) => <TrajectoryEntity key={t.id} t={t} />)}
            {origins.map((o) => <OriginEntity key={o.key} id={`ftraj-origin-${o.key}`} t={o.t} n={o.n} />)}
            <TrajectoryReplay trajectories={trajs} />
        </>
    )
}

const ClaimEntity = memo(function ClaimEntity({ c }) {
    const st = claimStyle(c)
    const ring = useMemo(() => claimRing(c), [c])
    const hierarchy = useMemo(() => new PolygonHierarchy(ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))), [ring])
    const outline = useMemo(() => ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat)), [ring])
    const centre = useMemo(() => Cartesian3.fromDegrees(+c.lon, +c.lat), [c.lon, c.lat])
    const op = Number(c.opacity) || 1
    const fill = st.hatch
        ? new StripeMaterialProperty({ evenColor: css(st.color, st.fill * op), oddColor: css(st.color, 0.04),
                                       repeat: Math.max(6, Math.round((Number(c.radius_km) || 4) * 2.5)),
                                       orientation: StripeOrientation.VERTICAL })
        : css(st.color, st.fill * op)
    const line = st.dash
        ? new PolylineDashMaterialProperty({ color: css(st.color, st.line * op), dashLength: 14 })
        : css(st.color, st.line * op)
    return (
        <Entity id={`fclaim-${c.id}`} name={c.label} position={centre}
            polygon={{ hierarchy, material: fill }}
            polyline={{ positions: outline, width: st.grey ? 1.5 : 2.5, clampToGround: true, material: line }}
            label={{
                text: claimMapLabel(c), font: FONT, fillColor: css(st.grey ? "#c3c9d2" : st.color),
                outlineColor: css("#05070C"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                showBackground: true, backgroundColor: css("#0B0F1A", 0.72), backgroundPadding: new Cartesian2(6, 4),
                verticalOrigin: VerticalOrigin.CENTER, heightReference: HeightReference.CLAMP_TO_GROUND,
                distanceDisplayCondition: new DistanceDisplayCondition(0, 2_500_000),
                scaleByDistance: new NearFarScalar(100_000, 1, 2_500_000, 0.75),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }} />
    )
})

const MovementEntity = memo(function MovementEntity({ m }) {
    const colour = sideColour(m.side, m.colour)
    const arrow = useMemo(() => movementArrow(m), [m])
    // ONE polyline for shaft and head: from → to → left barb → to → right barb
    const positions = useMemo(() => {
        if (!arrow) return null
        const [[a, b], [l, , r]] = arrow
        return [a, b, l, b, r].map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
    }, [arrow])
    const tail = m.from || m.to
    const pos = useMemo(() => Cartesian3.fromDegrees(+tail.lon, +tail.lat), [tail.lon, tail.lat])
    const sym = milSymbol(m.sidc, { colour, size: 22 })
    return (
        <Entity id={`fmove-${m.id}`} name={m.label} position={pos}
            polyline={positions ? { positions, width: 3, clampToGround: true, material: css(colour, 0.9) } : undefined}
            billboard={sym.uri ? {
                image: sym.uri, width: sym.width, height: sym.height,
                // milsymbol's anchor is the frame's centre, not the image's
                pixelOffset: new Cartesian2(sym.width / 2 - sym.anchor[0], sym.height / 2 - sym.anchor[1]),
                heightReference: HeightReference.CLAMP_TO_GROUND,
                distanceDisplayCondition: new DistanceDisplayCondition(0, 3_000_000),
                scaleByDistance: new NearFarScalar(80_000, 1.1, 3_000_000, 0.6),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            } : undefined} />
    )
})

const TrajectoryEntity = memo(function TrajectoryEntity({ t }) {
    const colour = sideColour(t.side, t.colour)
    const path = useMemo(() => trajectoryPath(t), [t])
    const positions = useMemo(() => path.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, t.kind === "drone" ? 0 : p.alt)), [path, t.kind])
    if (positions.length < 2) return null
    // drones on the ground track (the terrain would swallow a 300 m line);
    // missiles on their arc. Dashed: the origin is assumed.
    const assumed = !!t.from?.assumed
    const material = assumed
        ? new PolylineDashMaterialProperty({ color: css(colour, 0.85), dashLength: t.kind === "drone" ? 10 : 16 })
        : new PolylineGlowMaterialProperty({ color: css(colour, 0.9), glowPower: 0.15 })
    return (
        <Entity id={`ftraj-${t.id}`} name={t.label}
            polyline={{ positions, width: t.kind === "drone" ? 2 : 2.5, clampToGround: t.kind === "drone", material }} />
    )
})

function OriginEntity({ id, t, n }) {
    const colour = sideColour(t.side, t.colour)
    const pos = useMemo(() => Cartesian3.fromDegrees(+t.from.lon, +t.from.lat), [t.from.lon, t.from.lat])
    const text = `${t.from.assumed ? "Assumed origin" : "Launch point"} · ${t.from.name || "unnamed"}${n > 1 ? ` · ${n} flights` : ""}`
    return (
        <Entity id={id} name={text} position={pos}
            point={{ pixelSize: 8, color: css("#0b1220"), outlineColor: css(colour), outlineWidth: 2,
                     heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }}
            label={{
                text, font: FONT, fillColor: css(colour), outlineColor: css("#05070C"), outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -10),
                heightReference: HeightReference.CLAMP_TO_GROUND, showBackground: true,
                backgroundColor: css("#0B0F1A", 0.72), backgroundPadding: new Cartesian2(5, 3),
                distanceDisplayCondition: new DistanceDisplayCondition(0, 4_000_000),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }} />
    )
}

/**
 * One flight replayed on request (akili:trajectory-replay {id, trajectory}):
 * imperative, like GlobeVesselThreatLayer's simulation — everything it adds
 * is removed when the flight ends, another starts, or the layer goes.
 */
function TrajectoryReplay({ trajectories }) {
    const { viewer } = useCesium()
    const list = useRef(trajectories)
    list.current = trajectories
    useEffect(() => {
        if (!viewer) return undefined
        let added = []
        let raf = null
        let endTimer = null
        const stop = () => {
            if (raf) cancelAnimationFrame(raf)
            raf = null
            clearTimeout(endTimer)
            if (!viewer.isDestroyed()) added.forEach((e) => viewer.entities.remove(e))
            added = []
        }
        const render = () => { if (!viewer.isDestroyed()) viewer.scene.requestRender() }
        const onReplay = (ev) => {
            const t = list.current.find((x) => x.id === ev.detail?.id) || ev.detail?.trajectory
            if (!t) return
            const path = trajectoryPath(t)
            if (path.length < 2) return
            stop()
            const total = pathLengthKm(path)
            const secs = replaySeconds(t)
            const colour = sideColour(t.side, t.colour)
            const drone = t.kind === "drone"
            const at = (p) => Cartesian3.fromDegrees(p.lon, p.lat, p.alt)
            const span = Math.max(30, total)
            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: {
                lat: (path[0].lat + path[path.length - 1].lat) / 2, lon: (path[0].lon + path[path.length - 1].lon) / 2,
                altitude: Math.min(3_500_000, Math.max(120_000, span * 2_600)) } }))
            const t0 = performance.now()
            const kmNow = () => Math.min(total, ((performance.now() - t0) / 1000 / secs) * total)
            const posNow = () => positionAlong(path, kmNow())
            added.push(viewer.entities.add({
                id: `ftraj-replay-flown-${t.id}`,
                polyline: {
                    positions: new CallbackProperty(() => {
                        const d = kmNow()
                        return [...path.filter((p) => p.km <= d), posNow()].map((p) => (drone
                            ? Cartesian3.fromDegrees(p.lon, p.lat) : at(p)))
                    }, false),
                    width: 4, clampToGround: drone, material: css(colour, 1),
                },
            }))
            const label = {
                text: new CallbackProperty(() => {
                    const left = (Number(t.flight_minutes) || 0) * (1 - kmNow() / (total || 1))
                    return `${t.kind_label || "Flight"} → ${String(t.target_name || "target").split(",")[0]}\n`
                        + `${left > 0.5 ? `${fmtMinutes(left)} to target` : "reached"} · ${Math.round(total)} km`
                        + `${t.from?.assumed ? " · assumed origin" : ""}`
                }, false),
                font: "12px system-ui, -apple-system, Segoe UI, sans-serif", fillColor: css("#ffe2b8"),
                outlineColor: Color.BLACK, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 26), showBackground: true,
                backgroundColor: Color.BLACK.withAlpha(0.55), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
            if (drone) {
                // the Shahed/Geran-class model, as the vessel-of-concern simulation flies it
                added.push(viewer.entities.add({
                    id: `ftraj-replay-craft-${t.id}`,
                    position: new CallbackProperty(() => { const p = posNow(); return Cartesian3.fromDegrees(p.lon, p.lat, p.alt) }, false),
                    orientation: new CallbackProperty(() => {
                        const p = posNow()
                        return Transforms.headingPitchRollQuaternion(Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
                            new HeadingPitchRoll(modelHeadingRad(p.heading), 0, 0))
                    }, false),
                    model: { uri: shahedModelUri(), minimumPixelSize: 54, maximumScale: 60000, color: css("#d9cdb8"),
                             colorBlendMode: ColorBlendMode.MIX, colorBlendAmount: 0.25,
                             heightReference: HeightReference.RELATIVE_TO_GROUND },
                    label,
                }))
            } else {
                added.push(viewer.entities.add({
                    id: `ftraj-replay-craft-${t.id}`,
                    position: new CallbackProperty(() => at(posNow()), false),
                    point: { pixelSize: 10, color: css("#fff4e0"), outlineColor: css(colour), outlineWidth: 3,
                             disableDepthTestDistance: Number.POSITIVE_INFINITY },
                    label,
                }))
            }
            const tick = () => {
                render()
                if (kmNow() < total) raf = requestAnimationFrame(tick)
                else { raf = null; endTimer = setTimeout(() => { stop(); render() }, 5000) }
            }
            raf = requestAnimationFrame(tick)
        }
        window.addEventListener("akili:trajectory-replay", onReplay)
        return () => { window.removeEventListener("akili:trajectory-replay", onReplay); stop() }
    }, [viewer])
    return null
}
