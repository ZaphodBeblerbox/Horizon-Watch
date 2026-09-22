/**
 * clusterLayout.js — where the country plates go.
 *
 * DETERMINISTIC, BECAUSE A GRAPH THAT MOVES IS UNREADABLE. Seeded from
 * a hash of each country's own id rather than from Math.random, so the
 * same graph lays out identically every render, every reload and on
 * every machine. An analyst learns where things are; a layout that
 * reshuffles on refresh destroys that and makes two screenshots
 * incomparable.
 *
 * NOT GEOGRAPHIC. Placing each plate at its real position makes Europe
 * an unreadable pile and the Pacific empty, and spends the only degree
 * of freedom the layout has on information the globe already carries
 * far better. Position here means relationship structure.
 *
 * ONLY THE CONNECTED CORE IS LAID OUT. Of 244 countries most have no
 * link and no bridge in a given window; running them through the
 * simulation costs the quadratic term and puts 150 inert plates on
 * screen for the reader to filter by eye. They are returned separately
 * as a list instead, which is both faster and easier to read.
 */

/** A stable 0..1 from a string — the deterministic stand-in for random. */
export function hash01(str) {
    let h = 2166136261
    const s = String(str || "")
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    // >>> 0 keeps it unsigned; the division maps it into [0, 1).
    return ((h >>> 0) % 100000) / 100000
}

/**
 * Which clusters are worth drawing: those with a country-to-country
 * link, or reached by a bridge.
 */
export function connectedCore(clusters, links, bridges) {
    const live = new Set()
    for (const l of links || []) { live.add(l.src); live.add(l.dst) }
    for (const b of bridges || []) for (const c of b.countries || []) live.add(c)
    const core = [], rest = []
    for (const c of clusters || []) (live.has(c.id) ? core : rest).push(c)
    return { core, rest }
}

/**
 * A force-directed layout, fixed iteration count.
 *
 * Fixed rather than run-to-convergence on purpose: a bounded number of
 * passes is a bounded frame cost, and this has to stay smooth. 120
 * passes over the connected core settles well below a tenth of a
 * second.
 */
export function layout(clusters, links, bridges, opts = {}) {
    const {
        width = 1000, height = 700, iterations = 120,
        repulsion = 24000, springLength = 120, spring = 0.015,
        damping = 0.85, padding = 60,
    } = opts

    const { core, rest } = connectedCore(clusters, links, bridges)
    if (!core.length) return { positions: new Map(), core, rest }

    const cx = width / 2, cy = height / 2
    // Seeded on a ring, so even before any force is applied the
    // arrangement is stable and spread rather than piled at a point —
    // which is what makes a fixed iteration count enough.
    const nodes = core.map((c, i) => {
        const a = (i / core.length) * Math.PI * 2 + hash01(c.id) * 0.4
        const r = Math.min(width, height) * 0.32 * (0.7 + hash01(`${c.id}r`) * 0.3)
        return { id: c.id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
                 vx: 0, vy: 0, weight: 1 + Math.log(1 + (c.links || 0)) }
    })
    const index = new Map(nodes.map((n) => [n.id, n]))

    // Bridges pull too: two countries linked only by a shared piece of
    // equipment belong near each other, which is the entire point of
    // drawing bridges at all.
    const springs = []
    for (const l of links || []) {
        const a = index.get(l.src), b = index.get(l.dst)
        if (a && b && a !== b) springs.push([a, b, 1])
    }
    for (const br of bridges || []) {
        const cs = (br.countries || []).map((c) => index.get(c)).filter(Boolean)
        for (let i = 0; i < cs.length; i += 1) {
            for (let j = i + 1; j < cs.length; j += 1) {
                if (cs[i] !== cs[j]) springs.push([cs[i], cs[j], 0.4])
            }
        }
    }

    for (let step = 0; step < iterations; step += 1) {
        for (let i = 0; i < nodes.length; i += 1) {
            const a = nodes[i]
            for (let j = i + 1; j < nodes.length; j += 1) {
                const b = nodes[j]
                let dx = a.x - b.x, dy = a.y - b.y
                let d2 = dx * dx + dy * dy
                if (d2 < 1) { // exactly coincident: nudge apart deterministically
                    dx = hash01(a.id + b.id) - 0.5
                    dy = hash01(b.id + a.id) - 0.5
                    d2 = dx * dx + dy * dy || 1
                }
                const f = repulsion / d2
                const d = Math.sqrt(d2)
                const fx = (dx / d) * f, fy = (dy / d) * f
                a.vx += fx; a.vy += fy
                b.vx -= fx; b.vy -= fy
            }
        }
        for (const [a, b, w] of springs) {
            const dx = b.x - a.x, dy = b.y - a.y
            const d = Math.sqrt(dx * dx + dy * dy) || 1
            const f = (d - springLength) * spring * w
            const fx = (dx / d) * f, fy = (dy / d) * f
            a.vx += fx; a.vy += fy
            b.vx -= fx; b.vy -= fy
        }
        for (const n of nodes) {
            n.vx *= damping; n.vy *= damping
            n.x += n.vx; n.y += n.vy
            // Kept on screen. Without this a strongly repelled outlier
            // leaves the viewport and takes its links with it.
            n.x = Math.max(padding, Math.min(width - padding, n.x))
            n.y = Math.max(padding, Math.min(height - padding, n.y))
        }
    }

    const positions = new Map()
    for (const n of nodes) positions.set(n.id, { x: Math.round(n.x), y: Math.round(n.y) })
    return { positions, core, rest }
}

/**
 * Where a bridge sits: the centroid of the countries it touches.
 *
 * Between the plates rather than inside one of them, which is the
 * claim — a Shahed is a member of neither Iran nor Ukraine.
 */
export function bridgePosition(bridge, positions) {
    const pts = (bridge?.countries || [])
        .map((c) => positions.get(c)).filter(Boolean)
    if (!pts.length) return null
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length
    return { x: Math.round(x), y: Math.round(y) }
}

/** Plurals the node types actually need — "facilitys" is not a word. */
const PLURAL = {
    facility: "facilities", country: "countries",
    corridor: "corridors", vessel: "vessels", aircraft: "aircraft",
    person: "people", org: "orgs", faction: "factions",
    equipment: "equipment", event: "events",
}

export function pluralise(type, n) {
    if (n === 1) return type
    return PLURAL[type] || `${type}s`
}

/** "828 vessels · 9 facilities", the two largest kinds only. */
export function summarise(counts, max = 2) {
    const entries = Object.entries(counts || {}).filter(([, n]) => n > 0)
    if (!entries.length) return "nothing registered"
    entries.sort((a, b) => b[1] - a[1])
    const shown = entries.slice(0, max)
        .map(([t, n]) => `${n.toLocaleString()} ${pluralise(t, n)}`)
    const others = entries.length - shown.length
    return shown.join(" · ") + (others > 0 ? ` · +${others} more` : "")
}
