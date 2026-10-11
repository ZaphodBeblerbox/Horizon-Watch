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
 * WHERE SOMETHING WAS FOUND (owner, 2026-10-11). The server attaches
 * `findings` to every zone (backend/zone_change.py): detections in the
 * last scan and the last 7 days, and `fresh` — a radar change or objects
 * new since the previous pass, in the last 72 h. This reads it the one way
 * the list, the picker and both maps draw it.
 */
export function zoneFinding(z) {
    const f = z?.findings || {}
    const fresh = f.fresh && typeof f.fresh === "object" ? f.fresh : null
    return {
        fresh: Boolean(fresh),
        text: fresh?.text || null,
        kind: fresh?.kind || null,
        count: Number(fresh?.count) || 0,
        last: Number(f.last_detections) || 0,
        week: Number(f.detections_7d) || 0,
        findingsWeek: Number(f.findings_7d) || 0,
        radar: f.radar_change || null,
    }
}

/** A zone with something to look at: fresh, or found anything this week. */
export const hasFindings = (z) => { const f = zoneFinding(z); return f.fresh || f.findingsWeek > 0 }

const byFindings = (a, b) => {
    const fa = zoneFinding(a), fb = zoneFinding(b)
    return (fb.fresh - fa.fresh) || (fb.findingsWeek - fa.findingsWeek) || (fb.week - fa.week)
}

/**
 * @param zones  /api/watch-zones rows
 * @param opts   {findingsFirst} — zones with fresh findings first in each
 *               subgroup (and subgroups/groups keep their order)
 * @returns [{group, count, proposed, subgroups: [{subgroup, zones, proposed}]}]
 *          groups alphabetically with "Other" last; subgroups in the
 *          generator's order, unknown ones after, alphabetically.
 */
export function buildZoneTree(zones, opts = {}) {
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
                // proposals first, (with findings first,) best score first, then by name
                zones: [...list].sort((a, b) => (isProposal(b) - isProposal(a))
                    || (opts.findingsFirst ? byFindings(a, b) : 0)
                    || ((b.metadata?.score ?? 0) - (a.metadata?.score ?? 0))
                    || String(a.name).localeCompare(String(b.name))),
                proposed: list.filter(isProposal).length,
                fresh: list.filter((z) => zoneFinding(z).fresh).length,
                week: list.reduce((n, z) => n + zoneFinding(z).week, 0),
            }))
        out.push({
            group, subgroups,
            count: subgroups.reduce((n, s) => n + s.zones.length, 0),
            proposed: subgroups.reduce((n, s) => n + s.proposed, 0),
            fresh: subgroups.reduce((n, s) => n + s.fresh, 0),
            week: subgroups.reduce((n, s) => n + s.week, 0),
        })
    }
    return out.sort((a, b) => (a.group === "Other") - (b.group === "Other") || a.group.localeCompare(b.group))
}
