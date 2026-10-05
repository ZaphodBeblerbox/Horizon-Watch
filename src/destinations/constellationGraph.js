/**
 * constellationGraph.js — the graph Constellation should have been reading.
 *
 * WHAT IT WAS READING. /api/ontology/diagram, which is a dashboard
 * summary: 160 nodes and 272 links, of which 186 links are
 * `correlates_with` at 0.6 confidence and all 40 "event" nodes share nine
 * distinct labels between them. The payload says so itself —
 * `total_real_nodes: 25280`. Constellation was drawing 0.6% of the graph,
 * and the 0.6% chosen for a summary card rather than for tracing.
 *
 * WHAT IS ACTUALLY THERE. /api/ontology/graph holds 87,599 nodes and
 * 94,191 edges with named relations — `located in`, `flagged in`,
 * `sanctioned by`, `owns`, `operates`, `allied with` — each carrying a
 * confidence, the METHOD that produced it and a BASIS sentence saying why.
 * That provenance is the difference between a graph you can trace and a
 * picture of one.
 *
 * AND THE SIGNALS. The graph store has no event or signal type at all, so
 * nothing happening today was in Constellation by construction. Live
 * signals come from /api/surface and are joined to the graph by the
 * country at the end of their place string — "Nairobi, Nairobi Area,
 * Kenya" → country:KE. That join is a real one and it is also a lossy one;
 * `joinSignals` reports what it could not place rather than dropping it
 * quietly.
 *
 * IDS DIFFER BETWEEN THE TWO STORES. The diagram says `country_YE`, the
 * real graph says `country:YE`. Passing the first to the second returns a
 * stub node with no links, which looks exactly like an entity nobody has
 * connected yet. Everything here speaks the colon form.
 */
import API_BASE from "../apiBase.js"

const get = (path) => fetch(`${API_BASE}${path}`, { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

/* Place strings end in a country name; the map asset keys on ISO2. These
   are the names the two vocabularies disagree about, measured against the
   live surface rather than guessed. */
const COUNTRY_ALIAS = {
    "united states": "US", "united states of america": "US", "usa": "US",
    "gaza strip": "PS", "west bank": "PS", "palestine": "PS",
    "russian federation": "RU", "south korea": "KR", "north korea": "KP",
    "united kingdom": "GB", "uk": "GB", "ivory coast": "CI",
    "czech republic": "CZ", "burma": "MM", "democratic republic of the congo": "CD",
    "republic of the congo": "CG", "cote divoire": "CI", "turkiye": "TR",
}

let _names = null
/** country name → ISO2, from the map asset the locator already loads. */
async function countryNames() {
    if (_names) return _names
    const base = import.meta.env?.BASE_URL || "/"
    const land = await fetch(`${base}data/world-land.json`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const m = new Map(Object.entries(COUNTRY_ALIAS))
    for (const c of land?.labels || []) if (c.n && c.a2) m.set(c.n.toLowerCase(), c.a2)
    _names = m
    return m
}

/** The graph id for the country a place string ends in, or null. */
export async function countryIdFor(place) {
    const tail = String(place || "").split(",").pop().trim().toLowerCase()
    if (!tail) return null
    const iso = (await countryNames()).get(tail)
    return iso ? `country:${iso}` : null
}

export async function searchGraph(q, limit = 12) {
    if (!q || q.trim().length < 2) return []
    const d = await get(`/api/ontology/graph/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`)
    return Array.isArray(d?.results) ? d.results : []
}

/**
 * One entity's neighbourhood.
 *
 * `limit_per_hop` has a floor of 10 server-side — asking for less is a 422,
 * not a smaller answer, which is the kind of thing that turns into "the
 * graph is empty" in a UI that swallows errors.
 */
export async function neighbourhood(id, { hops = 1, perHop = 60, minConf = 0 } = {}) {
    if (!id) return { nodes: [], links: [] }
    const d = await get(`/api/ontology/graph/neighbourhood?id=${encodeURIComponent(id)}`
        + `&hops=${hops}&limit_per_hop=${Math.max(10, perHop)}&min_conf=${minConf}`)
    return { nodes: d?.nodes || [], links: d?.links || [], counts: d?.counts || null }
}

/** Today's signals, each placed on the graph where it can be. */
export async function liveSignals() {
    const d = await get("/api/surface")
    const items = Array.isArray(d?.items) ? d.items : []
    const out = []
    let unplaced = 0
    for (const s of items) {
        const countryId = await countryIdFor(s.location)
        if (!countryId) unplaced += 1
        out.push({
            id: s.id,
            label: s.headline || s.type || s.id,
            type: "signal",
            severity: s.severity_tier || null,
            place: s.location || null,
            lat: s.lat ?? null, lon: s.lon ?? null,
            source: s.source || null,
            when: s.published_at || null,
            url: s.url || null,
            context: s.context || "",
            countryId,
        })
    }
    return { signals: out, unplaced, total: items.length }
}

/** Inferred claims awaiting a decision — "we believe X because of Y". */
export async function reviewClaims(limit = 60) {
    const d = await get(`/api/ontology/claims?limit=${limit}`)
    return Array.isArray(d?.claims) ? d.claims : []
}

/** The summary graph, kept only for the corpus counters. */
export async function graphStats() {
    const d = await get("/api/ontology/graph/stats")
    return d || null
}

/* Node type → icon and which side of a trace it belongs on. The real
   graph's own vocabulary, not the summary's. */
export const TYPE = {
    country:   { icon: "#g-globe",  label: "Country",      side: "where" },
    corridor:  { icon: "#g-gate",   label: "Corridor",     side: "where" },
    facility:  { icon: "#g-asset",  label: "Facility",     side: "where" },
    faction:   { icon: "#g-shield", label: "Faction",      side: "who" },
    org:       { icon: "#g-org",    label: "Organisation", side: "who" },
    person:    { icon: "#g-person", label: "Person",       side: "who" },
    vessel:    { icon: "#g-ship",   label: "Vessel",       side: "what" },
    aircraft:  { icon: "#g-plane",  label: "Aircraft",     side: "what" },
    equipment: { icon: "#g-asset",  label: "Equipment",    side: "what" },
    signal:    { icon: "#g-event",  label: "Signal",       side: "what" },
    event:     { icon: "#g-event",  label: "Observation",  side: "what" },
}
export const typeOf = (t) => TYPE[t] || { icon: "#g-onto", label: t || "Entity", side: "what" }
