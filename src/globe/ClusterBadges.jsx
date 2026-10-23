/**
 * ClusterBadges.jsx — the groups a layer owns in the shared collision pass (screenDeclutter.js): each drawn as ONE
 * ICON, its most important member's own marker (ClusterMark), registered in the entity store as the list card.
 */
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

export default function ClusterBadges({ layout }) {
    useClusterRecords(layout)
    return (layout || []).filter((g) => g.cluster).map((g) => <ClusterMark key={g.id} g={g} />)
}
