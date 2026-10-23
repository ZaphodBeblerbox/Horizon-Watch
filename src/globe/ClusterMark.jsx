/**
 * ClusterMark.jsx — the globe's one cluster badge (lib/mapIcons.js clusterIcon, ringed in the highest priority
 * inside), drawn by whichever layer owns a group in the shared collision pass (screenDeclutter.js). A click opens
 * the existing list card (kind live_cluster) through the entity store.
 */
import { useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference } from "cesium"
import { clusterIcon } from "../lib/mapIcons.js"
import { clusterRecord } from "./screenDeclutter.js"
import { setEntity, deleteEntity } from "./entityStore.js"

/** Register every cluster of `layout` in the entity store (the list card), and forget them after. */
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

export default function ClusterMark({ g }) {
    const ic = clusterIcon(g.members.length, g.pri)
    return (
        <Entity id={g.id} name={`${g.members.length} here`} position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                billboard={{ image: ic.uri, width: ic.w, height: ic.h, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -90) }} />
    )
}
