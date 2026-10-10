/**
 * radialLayout.js — where each node of one thing's ontology is drawn.
 *
 * The thing in the middle; what it links to directly on a ring around it,
 * grouped by kind and relation so like sits beside like; what those link
 * to (the overlay's second hop) on an outer ring, fanned out behind the
 * node it hangs from. Deterministic: the same graph always lands the same
 * way, nothing settles or reshuffles, so it is drawn at once
 * (project_ontology_layout: quick and smooth).
 */
export const KIND_ORDER = ["action", "conflict", "actor", "place", "object", "source"]

export function radialLayout(graph, { w, h, pad = 24, ring = 0.78 } = {}) {
    const pos = new Map()
    if (!graph?.root) return { pos, ring1: [], ring2: [] }
    const cx = w / 2, cy = h / 2
    const rootId = graph.root.id
    pos.set(rootId, { x: cx, y: cy, ring: 0, angle: 0 })
    const nodes = graph.nodes || []
    const links = graph.links || []
    const touchesRoot = new Map()
    for (const l of links) {
        if (l.src === rootId) touchesRoot.set(l.dst, l.relation)
        else if (l.dst === rootId) touchesRoot.set(l.src, l.relation)
    }
    const order = (n) => KIND_ORDER.indexOf(n.group) < 0 ? 9 : KIND_ORDER.indexOf(n.group)
    const ring1 = nodes.filter((n) => touchesRoot.has(n.id))
        .sort((a, b) => order(a) - order(b) || String(touchesRoot.get(a.id)).localeCompare(String(touchesRoot.get(b.id)))
            || String(a.label).localeCompare(String(b.label)))
    const ring2 = nodes.filter((n) => !touchesRoot.has(n.id) && n.id !== rootId)
    const R = Math.min(w, h) / 2 - pad
    const r1 = ring2.length ? R * 0.5 : R * ring
    const r2 = R * 0.95
    ring1.forEach((n, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring1.length)
        pos.set(n.id, { x: cx + r1 * Math.cos(a), y: cy + r1 * Math.sin(a), ring: 1, angle: a })
    })
    // the outer ring: each node behind the inner node it hangs from
    const parentOf = new Map()
    for (const l of links) {
        for (const [a, b] of [[l.src, l.dst], [l.dst, l.src]]) {
            if (!parentOf.has(a) && pos.get(b)?.ring === 1 && !touchesRoot.has(a) && a !== rootId) parentOf.set(a, b)
        }
    }
    const byParent = new Map()
    for (const n of ring2) {
        const p = parentOf.get(n.id) || null
        if (!byParent.has(p)) byParent.set(p, [])
        byParent.get(p).push(n)
    }
    const slot = (2 * Math.PI) / Math.max(1, ring1.length)
    for (const [p, kids] of byParent) {
        if (p == null) continue
        const base = pos.get(p).angle
        const spread = Math.min(slot * 0.9, 0.16 * kids.length)
        kids.forEach((n, i) => {
            const a = base + (kids.length === 1 ? 0 : -spread / 2 + (spread * i) / (kids.length - 1))
            pos.set(n.id, { x: cx + r2 * Math.cos(a), y: cy + r2 * Math.sin(a), ring: 2, angle: a })
        })
    }
    const loose = byParent.get(null) || []
    loose.forEach((n, i) => {
        const a = -Math.PI / 2 + slot / 2 + (2 * Math.PI * i) / Math.max(1, loose.length)
        pos.set(n.id, { x: cx + r2 * Math.cos(a), y: cy + r2 * Math.sin(a), ring: 2, angle: a })
    })
    return { pos, ring1, ring2 }
}

/**
 * The sidebar's version of a busy graph: past `max` direct links, one
 * counted node per relation and kind ("uses military force against · 14"),
 * so the drawing still says something at 320 px. A relation with a single
 * member keeps its real node. The overlay draws everything.
 */
export function summarise(graph, max = 10) {
    if (!graph?.root || (graph.nodes || []).length <= max) return graph
    const rootId = graph.root.id
    const byId = new Map((graph.nodes || []).map((n) => [n.id, n]))
    const groups = new Map()
    for (const l of graph.links || []) {
        const out = l.src === rootId
        if (!out && l.dst !== rootId) continue
        const other = byId.get(out ? l.dst : l.src)
        if (!other) continue
        const key = `${l.relation}|${other.group}`          // both directions: one relation
        if (!groups.has(key)) groups.set(key, { relation: l.relation, out, group: other.group, members: [], inferred: true })
        const g = groups.get(key)
        if (!g.members.includes(other)) g.members.push(other)
        g.inferred = g.inferred && !!l.inferred
    }
    const nodes = [], links = []
    for (const g of groups.values()) {
        if (g.members.length === 1) {
            const n = g.members[0]
            nodes.push(n)
            links.push({ src: g.out ? rootId : n.id, dst: g.out ? n.id : rootId, relation: g.relation, inferred: g.inferred })
            continue
        }
        const total = g.members.reduce((s, m) => s + (m.count || 1), 0)
        const id = `group:${g.relation}:${g.group}`
        nodes.push({ id, group: g.group, type: g.members[0].type, label: `${total.toLocaleString()} · ${g.relation}`, count: total,
                     sample: g.members.slice(0, 8).map((m) => m.label), members: g.members.length })
        links.push({ src: g.out ? rootId : id, dst: g.out ? id : rootId, relation: g.relation, inferred: g.inferred, count: total })
    }
    if (nodes.length > max) {
        // still too many relations: the biggest keep their own node, the
        // rest share one
        const size = (n) => n.count || 1
        const keep = [...nodes].sort((a, b) => size(b) - size(a)).slice(0, max - 1)
        const kept = new Set(keep.map((n) => n.id))
        const rest = nodes.filter((n) => !kept.has(n.id))
        const total = rest.reduce((s, n) => s + size(n), 0)
        const other = { id: "group:other", group: "object", type: "other", label: `${total.toLocaleString()} · other links`, count: total,
                        sample: rest.slice(0, 8).map((n) => n.label), members: rest.length }
        return { ...graph, nodes: [...keep, other],
                 links: [...links.filter((l) => kept.has(l.src) || kept.has(l.dst)), { src: rootId, dst: other.id, relation: "other links", count: total }] }
    }
    return { ...graph, nodes, links }
}
