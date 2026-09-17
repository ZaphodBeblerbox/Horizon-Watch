import { useEffect, useMemo, useState } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, HeightReference,
    Math as CesiumMath,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType } from "./iconUtils.js"
import { getVesselMarkerDataUri } from "./vesselAircraftGlyphs.js"
import { getRenderedTheme, subscribeRenderedTheme } from "../state/themeStore.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, AIS_CAP } from "./isMobile.js"

const BILLBOARD_SIZE = 26

const DESKTOP_AIS_CAP = 200
const aisLat = (v) => v.lat
const aisLon = (v) => v.lon ?? v.lng

export default function GlobeAISLayer({ vessels, viewBounds, sanctionedMmsis }) {
    // §7's shading is a neutral overlay burned into the glyph image, and a
    // data URI cannot read a CSS variable — so the theme has to reach the
    // renderer as a value, and the glyph must be rebuilt when it turns.
    const [theme, setTheme] = useState(getRenderedTheme)
    useEffect(() => subscribeRenderedTheme(setTheme), [])

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
                const icon = getVesselMarkerDataUri({ sanctioned, shipType: vesselShipType(v), size: BILLBOARD_SIZE, theme })

                const hdg = isFinite(Number(v.heading)) && Number(v.heading) !== 511
                    ? Number(v.heading)
                    : isFinite(Number(v.cog)) ? Number(v.cog) : 0

                const position = Cartesian3.fromDegrees(v.lon, v.lat, 0)

                return (
                    <Entity
                        id={`ais-${v.mmsi}`}
                        key={v.mmsi}
                        position={position}
                        billboard={{
                            image:           icon,
                            width:           BILLBOARD_SIZE,
                            height:          BILLBOARD_SIZE,
                            rotation:        CesiumMath.toRadians(-hdg),
                            alignedAxis:     Cartesian3.ZERO,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            // Stage 1 fidelity — no scaleByDistance on the
                            // glyph itself: marker size must stay constant
                            // regardless of camera distance (was shrinking
                            // to 35% at 3,000km out).
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
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
