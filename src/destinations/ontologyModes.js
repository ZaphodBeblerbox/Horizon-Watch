/**
 * ontologyModes.js — PARALLAX §17's frame.
 *
 * "A segmented control in the toolbar: graph · orbat · open world · engine.
 * All four share the left nav, the centre stage and the inspector; only the
 * CONTENTS of those three columns change. Each mode owns the inspector while
 * it is on and CLEARS IT ON THE WAY OUT — otherwise the right pane keeps
 * answering questions about the previous mode."
 */

export const MODES = [
    // FINDINGS FIRST, AND AS SENTENCES. A node-link diagram makes the
    // reader reconstruct the finding themselves out of edges; what they
    // actually want to know is "UK materiel may reach Pakistan via Saudi
    // Arabia". The graph is still the BRAIN — link_predict walks it —
    // but it does not have to be the PICTURE, and drawing it was both
    // the slowest thing on the page and the least legible.
    { key: "findings", label: "findings", nav: "on-nav-findings", stage: "findingswrap" },
    { key: "graph",  label: "graph",      nav: "on-nav-graph",  stage: "graphwrap" },
    // Countries as centroids, membership counted rather than drawn, and
    // the entities that bridge two or more of them as their own class.
    // Added because the flat graph is 80,000 nodes of which 50,450 edges
    // say only "this thing is in that country" — drawn at equal weight,
    // membership buries every finding.
    { key: "clusters", label: "clusters", nav: "on-nav-clusters", stage: "clusterwrap" },
    { key: "orbat",  label: "orbat",      nav: "on-nav-orbat",  stage: "orbatwrap" },
    { key: "pat",    label: "open world", nav: "on-nav-pat",    stage: "on-pat" },
    { key: "engine", label: "engine",     nav: "on-nav-engine", stage: "en-main" },
]

export const MODE_KEYS = MODES.map((m) => m.key)

export const isMode = (k) => MODE_KEYS.includes(k)

/**
 * §17's theatres, verbatim — the ORBAT roster is filtered by these.
 */
export const THEATRES = [
    { id: "TH-RS", name: "Red Sea approaches", iso: ["YEM", "SDN", "DJI", "ERI", "SAU", "EGY"] },
    { id: "TH-SAHEL", name: "Sahel", iso: ["MLI", "BFA", "NER", "TCD", "MRT", "NGA"] },
    { id: "TH-BALTIC", name: "Baltic", iso: ["RUS", "POL", "LTU", "LVA", "EST", "FIN", "SWE"] },
    { id: "TH-BLACK", name: "Black Sea", iso: ["UKR", "TUR", "ROU", "BGR", "GEO"] },
    { id: "TH-WPAC", name: "Western Pacific", iso: ["TWN", "CHN", "PHL", "JPN", "KOR", "PRK"] },
    { id: "TH-NAF", name: "North Africa", iso: ["LBY", "TUN", "DZA", "MAR"] },
]

/** §17.1's tier geometry. */
export const TIERS = ["theatre", "country", "actor", "formation"]
export const TIER_X = [70, 250, 470, 700]
export const TIER_W = [150, 168, 196, 210]
export const ROW_PITCH = 46

/**
 * The GeoConfirmed theatre slugs each §17 theatre draws its held ORBAT from.
 * Deliberately explicit: the slugs are a different vocabulary from the ISO
 * codes above, and guessing a mapping between them is how a theatre silently
 * shows another theatre's formations.
 */
export const THEATRE_SLUGS = {
    "TH-RS": ["yemen"],
    "TH-BLACK": ["ukraine"],
    "TH-WPAC": [],
    "TH-SAHEL": ["drc"],
    "TH-BALTIC": [],
    "TH-NAF": ["israel"],
}

/**
 * §17.1 — "A country with no held ORBAT draws HOLLOW: dashed stroke, 0.5
 * opacity. Absence of evidence is a state worth showing, not a country worth
 * hiding."
 *
 * So this returns EVERY country in the theatre, each marked with whether we
 * actually hold anything for it. Filtering the empty ones out is the bug this
 * function exists to prevent.
 */
export function countriesForTheatre(theatre, heldByIso = {}) {
    if (!theatre) return []
    return theatre.iso.map((iso) => ({
        iso,
        held: heldByIso[iso] || 0,
        hollow: !(heldByIso[iso] > 0),
    }))
}

/**
 * §17.1 — "Positions are DETERMINISTIC so the graph does not reshuffle when a
 * node opens."
 */
export function layoutTier(items, tierIndex, { top = 40 } = {}) {
    return items.map((item, i) => ({
        item,
        x: TIER_X[tierIndex],
        y: top + i * ROW_PITCH,
        w: TIER_W[tierIndex],
    }))
}

/**
 * §17.1's confidence ring: green ≥.75 / steel ≥.55 / amber ≥.4 / red.
 */
export function confidenceRing(conf) {
    const c = Number(conf)
    if (!Number.isFinite(c)) return "var(--grey)"
    if (c >= 0.75) return "var(--green)"
    if (c >= 0.55) return "var(--steel)"
    if (c >= 0.4) return "var(--amber)"
    return "var(--red)"
}

/**
 * §17.1's sourcing note. "Confidence is the AGREEMENT BETWEEN these sources,
 * not an average of them. A single-source formation never exceeds 50%."
 */
export function cappedConfidence(sourceCount, raw = 1) {
    if (!sourceCount) return 0
    if (sourceCount === 1) return Math.min(0.5, raw)
    return Math.min(1, raw)
}
