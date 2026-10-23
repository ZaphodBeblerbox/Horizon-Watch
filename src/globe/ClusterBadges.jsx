/**
 * ClusterBadges.jsx — the clusters a layer owns in the shared collision pass (screenDeclutter.js), drawn as the
 * one cluster badge (lib/mapIcons.js clusterIcon, ringed in the highest priority inside) at its constant size,
 * each registered in the entity store as the one list card (kind live_cluster) so a click opens what is in it.
 */
import { useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, HeightReference } from "cesium"
import { clusterIcon, SIZE } from "../lib/mapIcons.js"
import { clusterRecord } from "./screenDeclutter.js"
import { setEntity, deleteEntity } from "./entityStore.js"

export default function ClusterBadges({ layout }) {
    const clusters = (layout || []).filter((g) => g.cluster)
    const sig = clusters.map((g) => g.id).join(";")
    useEffect(() => {
        clusters.forEach((g) => setEntity(g.id, "telegram", clusterRecord(g)))
        return () => clusters.forEach((g) => deleteEntity(g.id))
    }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
    return clusters.map((g) => (
        <Entity key={g.id} id={g.id} name={`${g.members.length} here`} position={Cartesian3.fromDegrees(g.lon, g.lat, 0)}
                billboard={{ image: clusterIcon(g.members.length, g.pri).uri, width: SIZE.cluster, height: SIZE.cluster,
                             heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -120) }} />
    ))
}
