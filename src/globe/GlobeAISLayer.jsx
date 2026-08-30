import { useEffect, useMemo } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color, HeightReference,
    Math as CesiumMath,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { vesselShipType } from "./iconUtils.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, AIS_CAP } from "./isMobile.js"

const BILLBOARD_SIZE = 26

const DESKTOP_AIS_CAP = 200

export default function GlobeAISLayer({ vessels, viewBounds }) {
    const filtered = useMemo(() => {
        if (!vessels?.length) return []
        if (isMobile) {
            const priority = (v) => {
                const t = vesselShipType(v)
                return t === "cargo" || t === "tanker" ? 0 : t === "passenger" ? 1 : 2
            }
            return [...vessels].sort((a, b) => priority(a) - priority(b)).slice(0, AIS_CAP)
        }
        const valid = vessels.filter(v => v.lat != null && (v.lon ?? v.lng) != null)
        if (valid.length <= DESKTOP_AIS_CAP) return valid
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        return [...valid]
            .sort((a, b) => {
                const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.lng) - centerLng)
                const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.lng) - centerLng)
                return da - db
            })
            .slice(0, DESKTOP_AIS_CAP)
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

                // Base AIS tracks have no sanctions/affiliation signal at
                // this layer (that only exists on the alert overlay — see
                // GlobeAlertsLayer.jsx) — real ship-type sub-type only, no
                // status ring. See src/globe/entityIcons.js's own header for
                // why a plain vessel track never fabricates a status here.
                const shipType = vesselShipType(v)
                const icon = getEntityMarkerDataUri({ entityType: "vessel", subtype: shipType, size: BILLBOARD_SIZE })

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
                            scaleByDistance: new NearFarScalar(1000, 1.0, 3_000_000, 0.35),
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
