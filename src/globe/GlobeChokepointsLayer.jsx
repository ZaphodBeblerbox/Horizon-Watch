import { useState, useEffect } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian3, Cartesian2, Color, HeightReference,
    PolygonHierarchy, ClassificationType,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import API_BASE from "../apiBase.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { showTip, hideTip } from "./mapTip.js"

// Chokepoints previously had no point marker at all — just the polygon +
// text label below, which disappears at typical zoomed-out camera heights.
// A small "zone" billboard (the real boundary is drawn as the polygon, not
// this point icon) keeps the chokepoint visible/clickable at any zoom level.
// Lazily built (not at module load) so importing this file never touches
// the DOM.
let _chokeIcon = null
function getChokeIcon() {
    if (!_chokeIcon) {
        _chokeIcon = getEntityMarkerDataUri({ entityType: "zone", size: 26 })
    }
    return _chokeIcon
}

export default function GlobeChokepointsLayer({ enabled }) {
    const [data, setData] = useState([])
    const { viewer } = useCesium()

    /**
     * The hover callout, in the shared §6/§A9 style rather than the bespoke
     * box this layer never had. §14's point about these is that the location
     * is not the intelligence — "Bab el-Mandeb" is a place, "Cape reroute
     * adds 9-14 days" is what an analyst needs — so the strategic description
     * leads, and the live match count sits under it as the reason this
     * chokepoint is worth looking at right now.
     */
    const tipFor = (c, mv) => {
        const rect = viewer?.scene?.canvas?.getBoundingClientRect?.()
        if (!rect || !mv?.endPosition) return
        showTip(
            <>
                <div className="tipk">
                    <svg><use href="#i-anchor" /></svg><span>Chokepoint</span>
                    {c.current_status ? <em>{c.current_status}</em> : null}
                </div>
                <b>{c.name}</b>
                {c.strategic_description ? <p className="tipp">{c.strategic_description}</p> : null}
                {Number.isFinite(c.match_count) && (
                    <div className="tipm">
                        <div><b>{c.match_count}</b><span>recent mentions</span></div>
                        <div><b>{(c.monitored_keywords || []).length}</b><span>watched terms</span></div>
                        <div><b>{(c.recent_headlines || []).length}</b><span>headlines</span></div>
                    </div>
                )}
            </>,
            rect.left + mv.endPosition.x, rect.top + mv.endPosition.y,
        )
    }

    useEffect(() => {
        if (!enabled) return
        fetch(`${API_BASE}/api/infrastructure/chokepoints`)
            .then(r => r.ok ? r.json() : null)
            .then(d => setData(d?.chokepoints || []))
            .catch(() => {})
    }, [enabled])

    // Register entities for click handling via GlobePopup
    useEffect(() => {
        if (!data.length) return
        const ids = []
        data.forEach(c => {
            const id = `choke-${c.id ?? c.system_id ?? c.name}`
            setEntity(id, "chokepoint", {
                ...c,
                system_id: c.system_id || c.id || c.name?.toLowerCase().replace(/\s+/g, "-"),
            })
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [data])

    if (!enabled || !data.length) return null

    return (
        <>
            {data.map(c => {
                const lat  = c.lat  ?? c.center?.[0]
                const lon  = c.lon  ?? c.center?.[1]
                const name = c.name ?? "Chokepoint"
                if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null

                const id   = c.id ?? c.system_id ?? name
                const entityId = `choke-${id}`

                const polyPositions = Array.isArray(c.polygon)
                    ? c.polygon
                        .filter(p => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
                        .map(([plat, plon]) => Cartesian3.fromDegrees(plon, plat, 0))
                    : []

                return (
                    <Entity
                        id={entityId}
                        key={entityId}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        onMouseMove={(_m, mv) => tipFor(c, mv)}
                        onMouseLeave={hideTip}
                        billboard={{
                            image:           getChokeIcon(),
                            width:           26,
                            height:          26,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                            scaleByDistance: new NearFarScalar(1000, 1.2, 8_000_000, 0.25),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 10_000_000),
                        }}
                        polygon={polyPositions.length >= 3 ? {
                            hierarchy:          new PolygonHierarchy(polyPositions),
                            material:           Color.fromCssColorString("#FF6D00").withAlpha(0.12),
                            outline:            true,
                            outlineColor:       Color.fromCssColorString("#FF6D00").withAlpha(0.8),
                            outlineWidth:       2,
                            height:             0,
                            classificationType: ClassificationType.TERRAIN,
                        } : undefined}
                        label={{
                            text:             name,
                            font:             "bold 11px Arial",
                            fillColor:        Color.fromCssColorString("#FF6D00"),
                            outlineColor:     Color.fromCssColorString("#0F1721"),
                            outlineWidth:     2,
                            style:            2,
                            pixelOffset:      new Cartesian2(0, -14),
                            scaleByDistance:           new NearFarScalar(1000, 1.0, 5_000_000, 0.3),
                            distanceDisplayCondition:  new DistanceDisplayCondition(0, 4_000_000),
                            showBackground:   true,
                            backgroundColor:  Color.fromCssColorString("#0F1721").withAlpha(0.85),
                        }}
                    />
                )
            })}
        </>
    )
}
