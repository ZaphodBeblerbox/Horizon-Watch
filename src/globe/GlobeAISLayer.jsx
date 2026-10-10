import { useEffect, useMemo, useRef } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian2, Color,
    CallbackProperty, Transforms, HeadingPitchRoll, ColorBlendMode,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, AIS_CAP } from "./isMobile.js"
import { safeCartesian, vesselHeading, bearingBetween } from "./markerOrientation.js"
import { createMotion, VESSEL, live as liveMotion } from "./smoothMotion.js"
import { shipIcon, headingBillboard } from "./farIcons.js"
import { familyFor as hullFor, modelUrl as hullUrl,
         headingRadiansFromDegrees as hullHeadingFrom } from "./vesselModels.js"


// A HEMISPHERE'S WORTH. This was 200, which meant the backend's cap
// was irrelevant: looking at an ocean showed two hundred ships and an
// empty sea. Only the billboard is drawn at range — labels stop at
// 500km — so the cost of the rest is a batched quad each.
// Same number as HULL_BUDGET, for the reason given in GlobeADSBLayer:
// vessels past the budget draw nothing now, so carrying 5,400 of them
// through the entity store and the render was cost for no pixels.
const DESKTOP_AIS_CAP = 600

/**
 * How many vessels are drawn as hulls rather than glyphs.
 *
 * Each model is its own primitive where a billboard is one batched
 * quad, so this is bounded the same way the aircraft are. The nearest
 * this many to the view centre get geometry.
 */
const HULL_BUDGET = 600
const aisLat = (v) => v.lat
const aisLon = (v) => v.lon ?? v.lng

export default function GlobeAISLayer({ vessels, viewBounds, sanctionedMmsis,
                                        pinnedMmsi = null, near = true }) {
    // See GlobeADSBLayer's pin comment: locking the camera onto a vessel
    // zooms in far enough that the viewport query can stop returning it,
    // and the hull the operator is watching is the one that disappears.
    const PIN_COAST_MS = 60_000
    const lastSeenRef = useRef({})
    // COURSE RECOVERED FROM MOVEMENT. 44% of vessels report no usable
    // heading and this feed has no course-over-ground, so those hulls
    // had nothing to point along. A vessel that has moved between two
    // reports has told us its course by doing so. Kept in a ref because
    // it must not trigger a render of its own.
    const courseRef = useRef({})
    // Ships move slowly and AIS reports are minutes apart: each is drawn
    // continuing along its course over ground, eased onto each new report
    // (smoothMotion.js) instead of jumping when the poll lands.
    const motionRef = useRef(null)
    if (!motionRef.current) motionRef.current = createMotion(VESSEL)
    liveMotion.vessels = motionRef.current
    useEffect(() => {
        const live = new Set()
        for (const v of vessels || []) {
            const mmsi = v?.mmsi != null ? String(v.mmsi) : null
            const lat = Number(v?.lat), lon = Number(v?.lon ?? v?.lng)
            if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
            live.add(mmsi)
            const cog = Number(v.cog), hdg = Number(v.true_heading ?? v.heading)
            const track = Number.isFinite(cog) && cog < 360 ? cog : Number.isFinite(hdg) && hdg < 360 ? hdg : NaN
            const ts = Number(v.last_update) > 1e9 ? Number(v.last_update) * 1000 : undefined
            motionRef.current.update(mmsi, { lat, lon, track, gs: Number(v.speed ?? v.sog ?? 0), ts })
        }
        if (pinnedMmsi) live.add(String(pinnedMmsi))
        motionRef.current.prune(live)
    }, [vessels, pinnedMmsi])
    // Draw every frame while there are ships to move (~20 fps is plenty at ship speeds).
    const cesium = useCesium()
    const hasVessels = (vessels || []).length > 0
    useEffect(() => {
        const scene = cesium?.scene || cesium?.viewer?.scene
        if (!scene || !hasVessels) return undefined
        let raf = 0, last = 0
        const tick = (t) => {
            raf = requestAnimationFrame(tick)
            if (t - last < 50) return
            last = t
            if (!scene.isDestroyed?.()) scene.requestRender()
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [cesium?.scene, cesium?.viewer, hasVessels])
    useEffect(() => {
        const seen = courseRef.current
        for (const v of vessels || []) {
            const mmsi = v?.mmsi != null ? String(v.mmsi) : null
            if (!mmsi) continue
            const lat = v.lat, lon = v.lon ?? v.lng
            const prev = seen[mmsi]
            if (prev) {
                const brg = bearingBetween(prev.lat, prev.lon, lat, lon)
                // Only overwrite on real movement; a vessel at rest keeps
                // whatever course it was last seen making.
                if (brg !== null) seen[mmsi] = { lat, lon, course: brg }
                else seen[mmsi] = { ...prev, lat, lon }
            } else {
                seen[mmsi] = { lat, lon, course: null }
            }
            lastSeenRef.current[mmsi] = { v, ts: Date.now() }
        }
    }, [vessels])

    // The pinned vessel, carried forward when a refresh does not contain it.
    const held = useMemo(() => {
        const list = vessels || []
        if (!pinnedMmsi) return list
        if (list.some(v => v?.mmsi != null && String(v.mmsi) === pinnedMmsi)) return list
        const keep = lastSeenRef.current[pinnedMmsi]
        return keep && Date.now() - keep.ts < PIN_COAST_MS ? [...list, keep.v] : list
    }, [vessels, pinnedMmsi])

    const { filtered } = useMemo(() => {
        const vessels = held
        if (!vessels?.length) return { filtered: [] }
        if (isMobile) {
            const priority = (v) => {
                const t = vesselShipType(v)
                return t === "cargo" || t === "tanker" ? 0 : t === "passenger" ? 1 : 2
            }
            return { filtered: [...vessels].sort((a, b) => priority(a) - priority(b)).slice(0, AIS_CAP) }
        }
        const valid = vessels.filter(v => v.lat != null && (v.lon ?? v.lng) != null)
        if (valid.length <= DESKTOP_AIS_CAP) return { filtered: valid }
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const sorted = [...valid].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.lng) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.lng) - centerLng)
            return da - db
        })
        // Above the cap the nearest vessels to the view centre are drawn and
        // the rest are not. The cluster markers that used to stand in for the
        // remainder are gone: a numbered blob is not a vessel, it cannot be
        // inspected, and at these densities it covered the hulls it was
        // summarising.
        const cut = sorted.slice(0, DESKTOP_AIS_CAP)
        // The pin outranks the cap: it is the one vessel actually asked for.
        if (pinnedMmsi && !cut.some(v => String(v.mmsi) === pinnedMmsi)) {
            const p = valid.find(v => String(v.mmsi) === pinnedMmsi)
            if (p) cut.push(p)
        }
        return { filtered: cut }
    }, [held, viewBounds, pinnedMmsi])

    /**
     * Which vessels get a hull: the nearest to the view centre, bounded.
     *
     * No longer restricted to vessels that reported a heading. A ship
     * drawn as a dot is not more honest than a ship drawn as a ship —
     * it is just less useful — so the hull is always drawn, and where
     * the orientation is not known the inspector says so.
     */
    const hullMmsis = useMemo(() => {
        const out = new Set()
        if (isMobile) return out
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const byRange = [...filtered].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.lng) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.lng) - centerLng)
            return da - db
        })
        // Hull the pin first, so a full budget cannot be the reason the
        // followed vessel is the one that is not drawn.
        if (pinnedMmsi) out.add(pinnedMmsi)
        for (const v of byRange) {
            if (out.size >= HULL_BUDGET) break
            if (v.mmsi != null) out.add(String(v.mmsi))
        }
        return out
    }, [filtered, viewBounds, pinnedMmsi])

    useEffect(() => {
        if (!filtered.length) return
        const ids = []
        filtered.forEach(v => {
            if (v.mmsi) {
                setEntity(`ais-${v.mmsi}`, "vessel", v)
                ids.push(`ais-${v.mmsi}`)
            }
        })
        return () => ids.forEach(deleteEntity)
    }, [filtered])

    if (!filtered.length) return null
    return (
        <>
            {filtered.map(v => {
                if (v.lat == null || v.lon == null || !isFinite(v.lat) || !isFinite(v.lon)) return null

                // Fidelity pass, build spec v2 §7 — real hull-outline glyph
                // (not a generic entity icon), colored red when the vessel's
                // real mmsi matches a real confirmed sanctions hit from
                // GlobeView's own screening-alert fetch (never reimplementing
                // the actual screening logic, which lives entirely server-
                // side in backend/main.py's _check_sanctions_on_update()).
                const mmsiStr = v.mmsi != null ? String(v.mmsi) : null
                const sanctioned = !!(mmsiStr && sanctionedMmsis?.confirmed?.has(mmsiStr))
                // A HULL LIES ON THE WATER; A BILLBOARD CANNOT. A
                // billboard always faces the viewer, so a ship drawn as
                // one is a picture of a ship held up to the camera, and
                // its heading is only ever a screen angle. A model is
                // placed in the world, which is what makes it sit flat
                // on the sea with its bow on the real bearing whatever
                // the camera does.
                //
                // Only for vessels that reported a heading. A hull
                // points somewhere, and 44% of this feed has no usable
                // heading and no course-over-ground to fall back on —
                // those keep the glyph rather than being pointed north.
                // Reported heading, else the course it was observed
                // making, else unoriented — and the inspector is told
                // which of the three it was.
                const reportedHdg = vesselHeading(v)
                const derivedHdg = reportedHdg === null && mmsiStr
                    ? (courseRef.current[mmsiStr]?.course ?? null) : null
                const headingSource = reportedHdg !== null ? "reported"
                    : derivedHdg !== null ? "derived from movement" : "not reported"
                const usableHdg = reportedHdg ?? derivedHdg
                // NO HULL, NO MARKER. The flat square that stood in past
                // the hull budget was the "squares on the map": the
                // visibility cap is 6000 and the budget 600, so ~5,400
                // vessels were drawn as placeholders. A placeholder among
                // 3D hulls reads as a rendering fault, so the overflow is
                // no longer drawn and the count is reported instead.
                // Far out every vessel is an icon (farIcons.js); close in,
                // the budget's nearest are hulls.
                const hull = near && hullMmsis.has(mmsiStr) ? hullFor(v) : null
                if (near && !hull) return null
                const hullAngle = hull
                    ? hullHeadingFrom(usableHdg ?? 0) : null

                // Null rather than a throw: Cesium's fromDegrees raises on
                // a coordinate that is not a number, and a raise here
                // unmounts the whole globe instead of dropping one hull.
                const reported = safeCartesian(aisLon(v), aisLat(v), 0)
                if (!reported) return null
                const at = () => {
                    const m = motionRef.current.get(mmsiStr)
                    return (m && safeCartesian(m.lon, m.lat, 0)) || reported
                }
                const position = new CallbackProperty(at, false)

                if (!near) {
                    return (
                        <Entity id={`ais-${v.mmsi}`} key={v.mmsi} position={position}
                                billboard={headingBillboard(shipIcon(sanctioned ? "#FF453A" : "#8fb4e8"), usableHdg ?? 0, 14)} />
                    )
                }

                return (
                    <Entity
                        id={`ais-${v.mmsi}`}
                        key={v.mmsi}
                        position={position}
                        orientation={new CallbackProperty(() => {
                            // the reported heading when there is one; else the course it is making
                            const m = usableHdg === null ? motionRef.current.get(mmsiStr) : null
                            const ang = m && Number.isFinite(m.track) ? hullHeadingFrom(m.track) : hullAngle
                            return Transforms.headingPitchRollQuaternion(at(), new HeadingPitchRoll(ang, 0, 0))
                        }, false)}
                        model={{
                            uri: hullUrl(hull),
                            // Nominal metres for the TYPE — AIS gives us no
                            // length or beam.
                            //
                            // THE FLOOR IS WHAT MADE THE GLOBE UNREADABLE.
                            // minimumPixelSize is the size below which a
                            // model will not shrink however far away it is,
                            // so at 24 every hull in the world stayed a
                            // 24-pixel boat: zoomed out, the Channel and the
                            // Malacca Strait were solid blocks of ship with
                            // no water between them. Eight keeps a distant
                            // hull visible as a mark without it claiming the
                            // space of a city, and the real model scale
                            // takes over well before you are close enough to
                            // read a name.
                            minimumPixelSize: 8,
                            maximumScale: 40000,
                            color: sanctioned ? Color.fromCssColorString("#FF453A") : undefined,
                            colorBlendMode: ColorBlendMode.MIX,
                            colorBlendAmount: sanctioned ? 0.75 : 0,
                        }}
                        label={isMobile ? undefined : {
                            text:       v.name || "",
                            font:       "11px Arial",
                            fillColor:  Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -22),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 2_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                    />
                )
            })}
        </>
    )
}
