/**
 * ontologyText.js — the ontology in words, for the sidebar (owner,
 * 2026-10-10: not "connected to", but connected to YEMEN, to IRAN).
 *
 * One line per relation, naming what is at the other end: "Part of: War in
 * Yemen and the Red Sea", "Involves: Ansar Allah (Houthis)", "Backs it:
 * Iran, China". Counted membership keeps its count ("963 vessels"). The
 * relation reads from this thing's side: a link pointing at it is written
 * as what the other end does to it.
 */
const PRETTY = {
    "is a": "What it is", "at": "Where", "in": "Country", "part of": "Part of", "near": "Near", "reported by": "Reported by",
    "involves": "Involves", "mentions": "Mentions", "operated by": "Operated by", "fought in": "Fought in",
    "located in": "Located in", "flagged in": "Flag", "operates": "Operates", "originates in": "Made in", "observed in": "Seen in",
}
// A link pointing at this thing, said from its side.
const INBOUND = {
    "backs": "Backed by", "flagged in": "Flagged here", "located in": "Located here", "operates": "Operated by",
    "part of": "Made up of", "fights": "Fought by", "involves": "Involved in", "near": "Near", "speaks for": "Spoken for by",
    "sides with": "Supported by", "allied with": "Allied with", "observed in": "Seen here", "originates in": "Made here",
    "uses military force against": "Attacked by", "threatens": "Threatened by", "sanctioned by": "Sanctions",
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
function inbound(rel) {
    const side = /^fights \((.+)\)$/.exec(rel)
    if (side) return `Fighting for ${side[1]}`
    return INBOUND[rel] || `${cap(rel)} this`
}

export function relationLines(graph, { max = 4 } = {}) {
    if (!graph?.root) return []
    const root = graph.root.id
    const byId = new Map((graph.nodes || []).map((n) => [n.id, n]))
    const groups = new Map()
    for (const l of graph.links || []) {
        const out = l.src === root
        if (!out && l.dst !== root) continue
        const other = byId.get(out ? l.dst : l.src)
        if (!other) continue
        // "… with" relations run both ways: one line, whichever side recorded it
        const mutual = / with$/.test(l.relation)
        const key = out || mutual ? (PRETTY[l.relation] || cap(l.relation)) : inbound(l.relation)
        if (!groups.has(key)) groups.set(key, { label: key, items: [], inferred: true })
        const g = groups.get(key)
        if (!g.items.some((x) => x.id === other.id)) g.items.push(other)
        g.inferred = g.inferred && !!l.inferred
    }
    return [...groups.values()]
        .sort((a, b) => b.items.reduce((s, x) => s + (x.count || 1), 0) - a.items.reduce((s, x) => s + (x.count || 1), 0))
        .map((g) => ({
            label: g.label, inferred: g.inferred,
            items: g.items.slice(0, max),
            more: Math.max(0, g.items.length - max),
        }))
}
