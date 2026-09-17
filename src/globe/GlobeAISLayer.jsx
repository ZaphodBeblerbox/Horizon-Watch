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
import { clusterTracks } from "./trackClustering.js"

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

    const { filtered, clusters } = useMemo(() => {
        if (!vessels?.length) return { filtered: [], clusters: [] }
        if (isMobile) {
            const priority = (v) => {
                const t = vesselShipType(v)
                return t === "cargo" || t === "tanker" ? 0 : t === "passenger" ? 1 : 2
            }
            return { filtered: [...vessels].sort((a, b) => priority(a) - priority(b)).slice(0, AIS_CAP), clusters: [] }
        }
        const valid = vessels.filter(v => v.lat != null && (v.lon ?? v.lng) != null)
        if (valid.length <= DESKTOP_AIS_CAP) return { filtered: valid, clusters: [] }
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const sorted = [...valid].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.lng) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.lng) - centerLng)
            return da - db
        })
        // Real clustering above the cap — dense-cell groups get one real
        // cluster marker (with a real count) instead of the excess vessels
        // simply vanishing from render past DESKTOP_AIS_CAP.
        const { individual, clusters: dense } = clusterTracks(sorted, {
            getLat: aisLat, getLon: aisLon, viewBounds, maxIndividual: DESKTOP_AIS_CAP,
        })
        return { filtered: individual.slice(0, DESKTOP_AIS_CAP), clusters: dense }
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

    if (!filtered.length && !clusters.length) return null
    return (
        <>
            {clusters.map((c, i) => (
                <Entity
                    key={`ais-cluster-${i}`}
                    position={Cartesian3.fromDegrees(c.lon, c.lat, 0)}
                    point={{ pixelSize: 16, color: Color.fromCssColorString("#0ea5e9").withAlpha(0.55), outlineColor: Color.WHITE, outlineWidth: 1, heightReference: HeightReference.CLAMP_TO_GROUND }}
                    label={{
                        text: String(c.count),
                        font: "11px Arial", fillColor: Color.WHITE,
                        outlineColor: Color.fromCssColorString("#0F1721"), outlineWidth: 2, style: 2,
                        distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                    }}
                />
            ))}
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
                const icon = getVesselMarkerDataUri({ sanctioned, size: BILLBOARD_SIZE, theme })

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
