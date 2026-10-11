/**
 * overwatchTree.js — the Imagery page's areas as a group → subgroup tree.
 *
 * Overwatch zones carry their place in the tree in their metadata
 * ({group: "Ukraine", subgroup: "Air bases"}, backend/overwatch.py); an
 * area drawn by hand has neither and goes under "Other". Mirrors
 * overwatch.zone_tree on the server, so the API and the page agree.
 */

export const SUBGROUP_ORDER = [
    "Air bases", "Naval & ports", "Strike targets", "Ground bases & training grounds",
    "Front hotspots", "Hot right now", "Border sweep", "Found by sweep", "Sweep in progress",
]

const subRank = (s) => {
    const i = SUBGROUP_ORDER.indexOf(s)
    return i < 0 ? SUBGROUP_ORDER.length : i
}

/** A zone that is a proposal waiting for the user's yes or no. */
export const isProposal = (z) => z?.status === "proposed"

/** Zones that are not places to look at in the header strip: proposals,
 *  the border-sweep plan and the sweep's temporary tile. */
export const isBackground = (z) => isProposal(z) || z?.aoi_class === "sweep_plan" || z?.aoi_class === "sweep"

/**
 * @param zones  /api/watch-zones rows
 * @returns [{group, count, proposed, subgroups: [{subgroup, zones, proposed}]}]
 *          groups alphabetically with "Other" last; subgroups in the
 *          generator's order, unknown ones after, alphabetically.
 */
export function buildZoneTree(zones) {
    const groups = new Map()
    for (const z of Array.isArray(zones) ? zones : []) {
        const m = z?.metadata || {}
        const g = m.group || "Other"
        const s = m.subgroup || (g === "Other" ? "Areas" : "General")
        if (!groups.has(g)) groups.set(g, new Map())
        const subs = groups.get(g)
        if (!subs.has(s)) subs.set(s, [])
        subs.get(s).push(z)
    }
    const out = []
    for (const [group, subs] of groups) {
        const subgroups = [...subs.entries()]
            .sort(([a], [b]) => subRank(a) - subRank(b) || a.localeCompare(b))
            .map(([subgroup, list]) => ({
                subgroup,
                // proposals first, best score first, then by name
                zones: [...list].sort((a, b) => (isProposal(b) - isProposal(a))
                    || ((b.metadata?.score ?? 0) - (a.metadata?.score ?? 0))
                    || String(a.name).localeCompare(String(b.name))),
                proposed: list.filter(isProposal).length,
            }))
        out.push({
            group, subgroups,
            count: subgroups.reduce((n, s) => n + s.zones.length, 0),
            proposed: subgroups.reduce((n, s) => n + s.proposed, 0),
        })
    }
    return out.sort((a, b) => (a.group === "Other") - (b.group === "Other") || a.group.localeCompare(b.group))
}
