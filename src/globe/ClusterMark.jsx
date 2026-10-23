/**
 * ClusterMark.jsx — several things at one place in the shared collision pass (screenDeclutter.js): ONE ICON, the most
 * important member's own marker (owner, 2026-10-23 evening), drawn by the layer that owns it, its click opening the
 * list card (kind live_cluster) headed by that member, with the others under it.
 */
import { useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference, VerticalOrigin } from "cesium"
import { SIZE, ICON_PX } from "../lib/mapIcons.js"
import { clusterRecord } from "./screenDeclutter.js"
import { setEntity, deleteEntity } from "./entityStore.js"

/** Register every group of `layout` in the entity store (the list card), and forget them after. */
export function useClusterRecords(layout) {
    useEffect(() => {
        const ids = []
        for (const g of layout || []) {
            if (!g.cluster) continue
            setEntity(g.id, "telegram", clusterRecord(g))
            ids.push(g.id)
        }
        return () => ids.forEach((id) => deleteEntity(id))
    }, [layout])
}

/** The billboard of a group: its top member's own image, at its own size (a pin stands on its point). */
export function groupBillboard(item) {
    const pin = !!item?.pin
    const w = pin ? SIZE.pin.w : item?.size || ICON_PX, h = pin ? SIZE.pin.h : item?.size || ICON_PX
    return { image: item?.image, width: w, height: h, heightReference: HeightReference.CLAMP_TO_GROUND,
             ...(pin ? { verticalOrigin: VerticalOrigin.BOTTOM } : {}),
             disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -90) }
}

export default function ClusterMark({ g }) {
    if (!g?.item?.image) return null
    return (
        <Entity id={g.id} name={clusterRecord(g).headline} position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                billboard={groupBillboard(g.item)} />
    )
}
