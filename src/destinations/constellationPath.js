/**
 * constellationPath.js — the reachability question, and an honest answer.
 *
 * "Can something get from France to Syria, and through where?"
 *
 * WHAT THE GRAPH ACTUALLY CONTAINS, which decides what this may claim.
 * /api/ontology/relations?level=country returns ~1,980 country-to-country
 * relations distilled from reported events: a `relation` ("visited",
 * "material cooperation with", "uses military force against"), a `family`
 * (diplomatic / material / hostile), how many events supported it, when it
 * was last seen, and example source URLs.
 *
 * None of that is a shipping record. It is who was reported doing what
 * with whom. So a chain found here is NOT a proven route — it is a
 * sequence of recorded relationships that a route could ride on, and the
 * UI has to say which kind of relationship each step is. A path made of
 * "visited" hops is contact, not transfer, and presenting it as a supply
 * line would be a fabrication with a progress bar.
 *
 * That distinction is the whole reason FAMILY_WEIGHT exists rather than a
 * flat hop count: a material-cooperation hop is evidence of things moving,
 * a diplomatic hop is evidence only of contact, and a hostile hop is
 * evidence against. Shortest-by-hops would happily route materiel through
 * two countries that are shelling each other.
 */

/** Relation families, and what a step through one is worth as evidence
 *  that something physical could move along it. */
export const FAMILY = {
    material:   { w: 1.0, label: "material",   verb: "material cooperation",
                  reads: "things moving — aid, supply, joint production" },
    diplomatic: { w: 0.45, label: "diplomatic", verb: "contact",
                  reads: "contact, not transfer — meetings, agreements, talks" },
    hostile:    { w: 0.12, label: "hostile",    verb: "hostility",
                  reads: "hostility — a route here would be against the current" },
}

export const DEFAULT_FAMILIES = ["material", "diplomatic"]

/** Cost of one step. Lower is better. A step is cheap when the relation
 *  family carries goods, the evidence is thick (many events) and recent. */
function stepCost(edge, now = Date.now()) {
    const fam = FAMILY[edge.family] || FAMILY.diplomatic
    // Evidence mass: 2 events and 40 events should not cost the same.
    const ev = Math.min(1, Math.log10(1 + (edge.events || 1)) / 1.7)
    // Recency: a relation last seen 100 days ago is weaker than yesterday's.
    let age = 0.5
    try {
        const t = Date.parse(edge.last_seen)
        if (Number.isFinite(t)) age = Math.min(1, Math.max(0, 1 - (now - t) / (180 * 864e5)))
    } catch { /* an unparseable date is not evidence of staleness */ }
    const strength = fam.w * (0.45 + 0.35 * ev + 0.20 * age)
    // Never zero, never infinite.
    return 1 / Math.max(0.03, strength)
}

/** Per-step confidence, 0..1 — what this one hop is worth on its own. */
export function stepConfidence(edge, now = Date.now()) {
    return Math.max(0.05, Math.min(0.95, 1 / stepCost(edge, now)))
}

/**
 * Cheapest chain from `origin` to `destination` over the relation edges.
 *
 * Dijkstra, not breadth-first. The spec's own findPath() is a BFS, which
 * is right when every link is equivalent; here they are not, and
 * fewest-hops would prefer one weak hostile hop over two strong material
 * ones. Fewest-hops is still available via `hops: true` for the entity
 * graph, where the spec's assumption does hold.
 *
 * @param edges  [{source,target,relation,family,events,last_seen,examples}]
 * @param opts.families   which families may be stepped through
 * @param opts.via        an ISO3 the chain must pass through, or null
 * @param opts.maxHops    refuse chains longer than this (default 4)
 * @returns {{steps, hops, combined, weakest} | null}
 */
export function findRoute(edges, origin, destination, opts = {}) {
    const families = opts.families?.length ? opts.families : DEFAULT_FAMILIES
    const maxHops = opts.maxHops ?? 4
    const via = opts.via || null
    if (!origin || !destination || origin === destination) return null

    if (via && via !== origin && via !== destination) {
        /* A required waypoint is two searches, not one. Routing "through
           Türkiye" and then checking afterwards whether Türkiye happened
           to be on the cheapest path would almost always say no.

           The second leg is forbidden the first leg's countries. Without
           that, the legs are searched independently and the join doubles
           back: FRA → USA → TUR → USA → IRN was a real result, which reads
           as a route and is actually the same hop walked twice. */
        const a = findRoute(edges, origin, via, { ...opts, via: null, maxHops })
        if (!a) return null
        const used = new Set([a.steps[0].from, ...a.steps.map((st) => st.to)])
        used.delete(via)
        const b = findRoute(edges, via, destination, {
            ...opts, via: null, maxHops, exclude: used,
        })
        if (!b) return null
        return summarise([...a.steps, ...b.steps])
    }
    const exclude = opts.exclude || new Set()

    // Undirected: a relation between two countries is a channel between
    // them. Direction tells you who was reported as the actor, which is a
    // fact about the reporting, not about which way things can move.
    const adj = new Map()
    for (const e of edges) {
        if (!families.includes(e.family)) continue
        if (!e.source || !e.target) continue
        if (exclude.has(e.source) || exclude.has(e.target)) continue
        if (!adj.has(e.source)) adj.set(e.source, [])
        if (!adj.has(e.target)) adj.set(e.target, [])
        adj.get(e.source).push({ to: e.target, e, fwd: true })
        adj.get(e.target).push({ to: e.source, e, fwd: false })
    }
    if (!adj.has(origin) || !adj.has(destination)) return null

    const now = Date.now()
    const dist = new Map([[origin, 0]])
    const hops = new Map([[origin, 0]])
    const prev = new Map()
    // A plain array as the frontier: ~100 countries, so a binary heap
    // would be more code than the search it speeds up.
    const seen = new Set()
    while (true) {
        let u = null, best = Infinity
        for (const [k, v] of dist) { if (!seen.has(k) && v < best) { best = v; u = k } }
        if (u == null) break
        if (u === destination) break
        seen.add(u)
        if ((hops.get(u) ?? 0) >= maxHops) continue
        for (const { to, e, fwd } of adj.get(u) || []) {
            if (seen.has(to)) continue
            const d = best + stepCost(e, now)
            if (d < (dist.get(to) ?? Infinity)) {
                dist.set(to, d)
                hops.set(to, (hops.get(u) ?? 0) + 1)
                prev.set(to, { from: u, e, fwd })
            }
        }
    }
    if (!prev.has(destination) && destination !== origin) return null

    const steps = []
    let cur = destination
    while (prev.has(cur)) {
        const { from, e, fwd } = prev.get(cur)
        steps.unshift({ from, to: cur, edge: e, forward: fwd })
        cur = from
    }
    if (!steps.length) return null
    return summarise(steps)
}

function summarise(steps) {
    const now = Date.now()
    const confs = steps.map((s) => stepConfidence(s.edge, now))
    return {
        steps,
        hops: steps.length,
        // Independent-ish steps, so the chain is worth their product. A
        // four-hop chain of 60% steps is 13%, and saying so is the point.
        combined: confs.reduce((m, c) => m * c, 1),
        weakest: Math.min(...confs),
    }
}

/** The one-sentence reading of a route, in the terms the data supports. */
export function routeStatement(route, nameOf) {
    if (!route) return ""
    const fams = [...new Set(route.steps.map((s) => s.edge.family))]
    const onlyDiplomatic = fams.length === 1 && fams[0] === "diplomatic"
    const hasHostile = fams.includes("hostile")
    const chain = [route.steps[0].from, ...route.steps.map((s) => s.to)].map(nameOf).join(" → ")
    if (onlyDiplomatic) {
        return `${chain}. Every step on this chain is diplomatic contact — meetings, talks, agreements. `
            + `That is a channel along which something could travel, not a record of anything travelling.`
    }
    if (hasHostile) {
        return `${chain}. This chain crosses a hostile relationship, so it runs against the current: `
            + `it is the shortest recorded connection, not a plausible supply line.`
    }
    return `${chain}. Built from recorded material cooperation and contact between these states — `
        + `evidence that a route is possible, never evidence that it was used.`
}

/** BFS over the entity graph (the spec's own findPath), for Trace. */
export function findEntityPath(links, a, b) {
    if (!a || !b || a === b) return null
    const adj = new Map()
    for (const l of links) {
        if (!adj.has(l.s)) adj.set(l.s, [])
        if (!adj.has(l.t)) adj.set(l.t, [])
        adj.get(l.s).push({ o: l.t, l })
        adj.get(l.t).push({ o: l.s, l })
    }
    const prev = { [a]: null }
    const Q = [a]
    while (Q.length) {
        const x = Q.shift()
        if (x === b) break
        for (const n of adj.get(x) || []) {
            if (!(n.o in prev)) { prev[n.o] = { id: x, l: n.l }; Q.push(n.o) }
        }
    }
    if (!(b in prev)) return null
    const p = []
    let c = b
    while (c) { p.unshift({ id: c, l: prev[c] && prev[c].l }); c = prev[c] && prev[c].id }
    return p
}
