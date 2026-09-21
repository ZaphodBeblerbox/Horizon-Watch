import { useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    CallbackProperty, Transforms, HeadingPitchRoll, ColorBlendMode,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { acClassify } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, ADSB_CAP } from "./isMobile.js"
import { safeCartesian } from "./markerOrientation.js"
import { deadReckon } from "./deadReckon.js"
import { familyForDrawing, isSurfaceVehicle, modelUrl, modelHeadingRadians } from "./aircraftModels.js"

const adsbLat = (ac) => ac.lat ?? ac.latitude
const adsbLon = (ac) => ac.lon ?? ac.longitude


/**
 * How many aircraft are drawn as geometry rather than as a glyph.
 *
 * There is no altitude gate. An earlier version only drew models below
 * 400km, which meant that at any normal working zoom the aircraft were
 * flat glyphs again — the models were there and almost never visible.
 * minimumPixelSize keeps a model legible at any range, so the only
 * thing that needs bounding is how many exist: each is its own
 * primitive, where billboards are one batched quad each.
 *
 * The nearest this many to the view centre get geometry; everything
 * beyond keeps the glyph.
 */
const MODEL_BUDGET = 800

/**
 * Drop lines are bounded far tighter than models.
 *
 * Each one is a DYNAMIC polyline — its geometry is rebuilt every frame
 * so the line stays under an aircraft that is being extrapolated. That
 * is affordable for a hundred and not for a thousand, and a thousand
 * vertical lines is visual noise at any zoom where a thousand aircraft
 * fit on screen. Zoomed in, where the line actually helps you read
 * altitude, the viewport holds few enough aircraft that they all get one.
 */
const DROP_LINE_BUDGET = 120

/**
 * How often to ask for a frame while aircraft are moving.
 *
 * The scene runs in requestRenderMode: it draws only when something
 * asks it to, and when idle it draws nothing at all — measured, zero
 * frames in four seconds. Dead reckoning lives in a per-frame position
 * callback, so with no frames the aircraft simply freeze between
 * position reports. Ten a second matches what the old smoothing timer
 * produced on screen, at none of its cost: this asks Cesium to draw,
 * where that rebuilt thousands of React components to achieve the
 * same thing.
 */
const DR_RENDER_MS = 100

// THE CAP AND THE MODEL BUDGET ARE THE SAME NUMBER ON PURPOSE. They
// used to be 6000 and 800: the extra 5,200 aircraft each became an
// entity in the store and a React component, and then drew a flat
// placeholder because there was no model left for them. Now that the
// overflow draws nothing, keeping it in the list was pure cost —
// thousands of components mounting every refresh to render null.
const DESKTOP_ADSB_CAP = 800

export default function GlobeADSBLayer({ aircraft, viewBounds, watchlistedIcaos }) {

    const drBaseRef = useRef({})
    const rawRef    = useRef([])
    const [smooth, setSmooth] = useState([])

    useEffect(() => {
        rawRef.current = aircraft ?? []
        const now = Date.now()
        ;(aircraft ?? []).forEach(ac => {
            const icao = ac.icao ?? ac.icao24 ?? ""
            const lat  = ac.lat  ?? ac.latitude
            const lon  = ac.lon  ?? ac.longitude
            if (icao && lat != null && lon != null)
                drBaseRef.current[icao] = { lat, lon, track: ac.track ?? ac.heading ?? 0, gs: ac.gs ?? 0, ts: now }
        })
        const live = new Set((aircraft ?? []).map(a => a.icao ?? a.icao24 ?? ""))
        Object.keys(drBaseRef.current).forEach(k => { if (!live.has(k)) delete drBaseRef.current[k] })
        setSmooth(aircraft ?? [])
    }, [aircraft])

    // NO 100ms SMOOTHING TIMER. It used to rebuild the whole aircraft
    // array with new objects and setState ten times a second, which
    // invalidated the memo below, re-sorted it, and re-rendered one
    // React component per aircraft — around 24,000 renders a second
    // once the cap was lifted to thousands, to move markers a few
    // metres each. Dead reckoning now happens inside the position
    // callback Cesium already evaluates per frame, which costs a
    // little arithmetic per aircraft, needs no timer at all, and is
    // smooth at the display's refresh rate instead of stepping at 10Hz.

    const cesium = useCesium()

    const { filtered } = useMemo(() => {
        if (!smooth?.length) return { filtered: [] }
        if (isMobile) {
            return {
                filtered: [...smooth]
                    .filter(ac => (ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0) > 5000)
                    .sort((a, b) => (b.alt_baro ?? b.altitude ?? 0) - (a.alt_baro ?? a.altitude ?? 0))
                    .slice(0, ADSB_CAP),
            }
        }
        // ADS-B emitter category C* is a SURFACE vehicle or a fixed
        // obstruction — pushback tugs, airport trucks, masts. Around 5%
        // of a live sample. They were being drawn as contacts; an
        // aircraft layer should simply not carry them.
        const valid = smooth.filter(ac => ac.lat != null && (ac.lon ?? ac.longitude) != null
                                          && !isSurfaceVehicle(ac))
        if (valid.length <= DESKTOP_ADSB_CAP) return { filtered: valid }
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const sorted = [...valid].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.longitude ?? 0) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.longitude ?? 0) - centerLng)
            return da - db
        })
        // Above the cap the nearest aircraft to the view centre are drawn and
        // the rest are not. The cluster markers are gone: a numbered blob is
        // not an aircraft, it cannot be inspected, and it covered the very
        // airframes it was summarising.
        return { filtered: sorted.slice(0, DESKTOP_ADSB_CAP) }
    }, [smooth, viewBounds])

    /**
     * Which aircraft are drawn as geometry rather than as a glyph.
     *
     * Separate from the visibility filter above because it answers a
     * different question: visibility follows the data, this follows the
     * camera, and it is bounded by count because each model is its own
     * primitive.
     */
    const { modelled, dropIds } = useMemo(() => {
        const m = new Map()
        const considered = new Set()
        const drops = new Set()
        if (isMobile) return { modelled: m, dropIds: drops }
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const sortedByRange = [...filtered].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.longitude ?? 0) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.longitude ?? 0) - centerLng)
            return da - db
        })
        for (const ac of sortedByRange) {
            if (considered.size >= MODEL_BUDGET) break
            const id = ac.icao ?? ac.icao24 ?? ""
            if (!id) continue
            considered.add(id)
            if (drops.size < DROP_LINE_BUDGET) drops.add(id)
            // A family only when the type or category says so — an
            // unidentified return keeps the flat glyph rather than being
            // given an airframe it was never reported to have.
            const fam = familyForDrawing(ac)
            if (fam) m.set(id, fam)
        }
        return { modelled: m, dropIds: drops }
    }, [filtered, viewBounds])

    // Keep the scene drawing while there are aircraft to move. Without
    // this the markers are correct every time they are asked for their
    // position and frozen every time you actually look at them.
    const hasAircraft = filtered.length > 0
    useEffect(() => {
        const scene = cesium?.scene || cesium?.viewer?.scene
        if (!scene || !hasAircraft) return
        const iv = setInterval(() => {
            if (!scene.isDestroyed?.()) scene.requestRender()
        }, DR_RENDER_MS)
        return () => clearInterval(iv)
    }, [cesium?.scene, cesium?.viewer, hasAircraft])

    useEffect(() => {
        if (!filtered.length) return
        const ids = []
        filtered.forEach(ac => {
            const icao = ac.icao ?? ac.icao24 ?? ""
            if (icao) {
                setEntity(`adsb-${icao}`, "aircraft", ac)
                ids.push(`adsb-${icao}`)
            }
        })
        return () => ids.forEach(deleteEntity)
    }, [filtered])

    if (!filtered.length) return null
    return (
        <>
            {filtered.map(ac => {
                const lon = ac.lon ?? ac.longitude
                const lat = ac.lat ?? ac.latitude
                const alt    = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0
                const altNum = isFinite(Number(alt)) ? Number(alt) : 0
                const altM   = altNum * 0.3048
                const track  = isFinite(Number(ac.track ?? ac.heading))
                    ? Number(ac.track ?? ac.heading ?? 0) : 0

                // Before any glyph work, and null rather than a throw:
                // Cesium's fromDegrees raises on a coordinate that is not
                // a number (a numeric STRING raises too, which is why an
                // isFinite check never protected anything), and a raise
                // inside render unmounts the entire globe rather than
                // dropping one aircraft.
                const reported = safeCartesian(lon, lat, altM)
                if (!reported) return null
                // The foot of the drop line, from the same validated
                // coordinates, so the callback below always has something
                // real to fall back to.
                const reportedGround = safeCartesian(lon, lat, 0)

                // Dead reckoned at draw time from the last real report,
                // so the marker moves smoothly between position updates
                // without any of it passing through React. Falls back to
                // the reported position whenever extrapolating would be
                // dishonest — not moving, or coasting too long.
                const icao   = ac.icao ?? ac.icao24 ?? ""
                const cs     = (ac.flight || ac.callsign || "").trim()

                // Both ends of the drop line come from one evaluation, so
                // the line stays under the aircraft as it is extrapolated
                // rather than trailing back to the last report.
                const atNow = () => {
                    const dr = deadReckon(drBaseRef.current[icao], Date.now())
                    const la = dr ? dr.lat : lat
                    const lo = dr ? dr.lon : lon
                    return {
                        air: safeCartesian(lo, la, altM) || reported,
                        ground: safeCartesian(lo, la, 0),
                    }
                }
                const position = new CallbackProperty(() => atNow().air, false)

                // Fidelity pass, build spec v2 §7 — real triangle glyph,
                // amber when this real icao matches a real "Military
                // Aircraft" watchlist alert (backend/main.py's rule_004,
                // the closest real existing "flagged for review" aircraft
                // signal — reused, not reinvented), otherwise colour-coded
                // by real classification (iconUtils.js's acClassify() — the
                // same real military/helicopter/commercial/general logic
                // the inspector panel already uses for its subtype badge,
                // now also wired into the globe billboard itself).
                const watchlisted = !!(icao && watchlistedIcaos?.has(String(icao).toUpperCase()))
                const classification = acClassify(ac)
                const dropColor = Color.fromCssColorString("#8899aa") // mirrors --text-secondary

                // GEOMETRY, NOT A PICTURE OF GEOMETRY. A billboard always
                // faces the viewer, so its heading is only ever a screen
                // angle. A model is placed in the world: the quaternion
                // below puts its nose on the real track in the local
                // East-North-Up frame, which leaves it level with the
                // horizon no matter where the camera is or which way it
                // is rolled. Measured against Cesium: hpr.heading 0 points
                // the nose east — hence the 90° — and the nose's vertical
                // component is exactly 0 at every heading.
                // NO MODEL, NO MARKER. The flat glyph that used to stand
                // in for a contact past the model budget was the "dots and
                // circles on the map" — thousands of them, because the
                // visibility cap was 6000 and the model budget 800. A
                // placeholder among 3D airframes reads as a rendering
                // fault, not as an aircraft, so the overflow is now simply
                // not drawn and the count is reported instead.
                const family = modelled.get(icao) || null
                if (!family) return null
                const orientation = family ? new CallbackProperty(() => {
                    const p = position.getValue()
                    return p ? Transforms.headingPitchRollQuaternion(
                        p, new HeadingPitchRoll(modelHeadingRadians(track), 0, 0)) : undefined
                }, false) : undefined


                return (
                    <Entity
                        id={`adsb-${icao}`}
                        key={icao || `${lat}-${lon}`}
                        position={position}
                        orientation={orientation}
                        model={{
                            uri: modelUrl(family),
                            // Real metres, so a widebody is visibly bigger
                            // than a regional jet — but never smaller than
                            // this on screen, or zooming out would make the
                            // aircraft vanish before the glyph takes over.
                            minimumPixelSize: 26,
                            maximumScale: 20000,
                            // The watchlist signal has to survive the switch
                            // from glyph to model.
                            color: watchlisted ? Color.fromCssColorString("#FFB020") : undefined,
                            colorBlendMode: ColorBlendMode.MIX,
                            colorBlendAmount: watchlisted ? 0.7 : 0,
                        }}
                        label={isMobile ? undefined : {
                            text:       cs || icao,
                            font:       "12px Arial",
                            fillColor:  Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -20),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 3_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 1_500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        /* THE POSITIONS MUST BE ONE PROPERTY, NOT AN ARRAY
                           CONTAINING ONE. This was [position, ground] after
                           position became a callback, so Cesium read x/y/z
                           off a property object, got NaN, and threw out of
                           PolylineGeometry inside the render loop — which
                           stops Cesium drawing the entire globe and leaves
                           the last frame on screen looking like a freeze.

                           Only drawn for the near set: a dynamic polyline is
                           rebuilt every frame, and two thousand of those is
                           a real cost for lines that are visual noise at any
                           altitude where you can see two thousand aircraft. */
                        /* SHOWN OR HIDDEN, NEVER ADDED AND REMOVED. Setting
                           this prop to undefined for an entity that already
                           has a live dynamic geometry updater makes Cesium
                           read .positions off nothing on the next tick, which
                           throws in the render loop and stops the globe. So
                           the graphics stay attached and `show` does the
                           work — Cesium builds no geometry while it is off,
                           so the near-set bound still holds. */
                        polyline={(isMobile || !reportedGround) ? undefined : {
                            show: dropIds.has(icao),
                            /* NEVER undefined. Cesium's dynamic polyline
                               updater reads .positions off whatever this
                               returns, so an undefined value throws in the
                               render loop and stops the globe just as surely
                               as a NaN does. */
                            positions: new CallbackProperty(() => {
                                const { air, ground } = atNow()
                                return [air, ground || reportedGround]
                            }, false),
                            width:    1,
                            material: dropColor.withAlpha(0.25),
                        }}
                    />
                )
            })}
        </>
    )
}
