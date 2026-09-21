import { useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, HeightReference,
    CallbackProperty, Transforms, HeadingPitchRoll, ColorBlendMode,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType } from "./iconUtils.js"
import { getRenderedTheme, subscribeRenderedTheme } from "../state/themeStore.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { getShapeMarkerDataUri } from "./entityIcons.js"
import { isMobile, AIS_CAP } from "./isMobile.js"
import { safeCartesian, billboardRotation, vesselHeading } from "./markerOrientation.js"
import { familyFor as hullFor, modelUrl as hullUrl,
         modelHeadingRadians as hullHeading } from "./vesselModels.js"
import useCameraHeading from "./useCameraHeading.js"

const BILLBOARD_SIZE = 26

// A HEMISPHERE'S WORTH. This was 200, which meant the backend's cap
// was irrelevant: looking at an ocean showed two hundred ships and an
// empty sea. Only the billboard is drawn at range — labels stop at
// 500km — so the cost of the rest is a batched quad each.
const DESKTOP_AIS_CAP = 6000

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

export default function GlobeAISLayer({ vessels, viewBounds, sanctionedMmsis }) {
    // §7's shading is a neutral overlay burned into the glyph image, and a
    // data URI cannot read a CSS variable — so the theme has to reach the
    // renderer as a value, and the glyph must be rebuilt when it turns.
    const [theme, setTheme] = useState(getRenderedTheme)
    useEffect(() => subscribeRenderedTheme(setTheme), [])
    const cameraHeading = useCameraHeading()

    const { filtered } = useMemo(() => {
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
        return { filtered: sorted.slice(0, DESKTOP_AIS_CAP) }
    }, [vessels, viewBounds])

    /**
     * Which vessels get a hull. The nearest to the view centre, bounded,
     * and only ones that reported a heading — the rest keep the glyph
     * because a hull would have to point somewhere.
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
        for (const v of byRange) {
            if (out.size >= HULL_BUDGET) break
            if (vesselHeading(v) === null) continue
            if (v.mmsi != null) out.add(String(v.mmsi))
        }
        return out
    }, [filtered, viewBounds])

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
                // A DOT, NOT A LITTLE SHIP. The old hull glyph is gone:
                // vessels are drawn as real hulls now, and anything that
                // still falls back to a flat marker does so precisely
                // because it reported no usable heading — so a shape
                // with a bow would be pointing somewhere we were never
                // told. A circle is the app's existing mark for "an
                // observation is here" and claims nothing more.
                const icon = getShapeMarkerDataUri({
                    shape: "circle",
                    color: sanctioned ? "#FF453A" : "#8E9BAA",
                    size: BILLBOARD_SIZE * 0.55,
                })

                const hdg = vesselHeading(v) ?? 0

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
                const hullAngle = hullMmsis.has(mmsiStr) ? hullHeading(v) : null
                const hull = hullAngle === null ? null : hullFor(v)

                // Null rather than a throw: Cesium's fromDegrees raises on
                // a coordinate that is not a number, and a raise here
                // unmounts the whole globe instead of dropping one hull.
                const position = safeCartesian(aisLon(v), aisLat(v), 0)
                if (!position) return null

                return (
                    <Entity
                        id={`ais-${v.mmsi}`}
                        key={v.mmsi}
                        position={position}
                        orientation={hull ? new CallbackProperty(() =>
                            Transforms.headingPitchRollQuaternion(
                                position, new HeadingPitchRoll(hullAngle, 0, 0)), false) : undefined}
                        model={hull ? {
                            uri: hullUrl(hull),
                            // Nominal metres for the TYPE — AIS gives us
                            // no length or beam — but never smaller than
                            // this on screen.
                            minimumPixelSize: 24,
                            maximumScale: 40000,
                            color: sanctioned ? Color.fromCssColorString("#FF453A") : undefined,
                            colorBlendMode: ColorBlendMode.MIX,
                            colorBlendAmount: sanctioned ? 0.75 : 0,
                        } : undefined}
                        billboard={hull ? undefined : {
                            image:           icon,
                            width:           BILLBOARD_SIZE,
                            height:          BILLBOARD_SIZE,
                            // A TRUE BEARING AT ANY CAMERA ANGLE. Billboard
                            // rotation is applied in SCREEN space, so a bare
                            // -heading is only correct while north points up
                            // the screen; rotate the globe and every hull
                            // keeps its screen angle while the world turns
                            // under it. Subtracting the camera's own heading
                            // each frame pins the bow to the real bearing,
                            // and because the billboard still faces the
                            // viewer it stays lying flat on the water rather
                            // than standing up out of it.
                            rotation: new CallbackProperty(
                                () => billboardRotation(hdg, cameraHeading.current), false),
                            alignedAxis:     Cartesian3.ZERO,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            // Stage 1 fidelity — no scaleByDistance on the
                            // glyph itself: marker size must stay constant
                            // regardless of camera distance (was shrinking
                            // to 35% at 3,000km out).
                            // Visible out to a hemisphere view. Capping below that meant
                            // zooming out to look at a whole ocean emptied it.
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 60_000_000),
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
