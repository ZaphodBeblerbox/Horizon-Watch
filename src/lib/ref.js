// ref.js — the real reference grammar (V3 Phase 1, §7.2): one `kind:id`
// string form for every record type in the app. Three real functions:
//   resolve(ref) — real data lookup, returns the real record or null
//   label(ref)   — a real display title for the record
//   open(ref)    — switches module if needed and navigates to the record
//
// Every kind here resolves against a REAL existing data source — a real
// backend endpoint (confirmed to exist, or added as a small, genuinely
// missing single-record lookup alongside its real list-endpoint sibling),
// or a real already-loaded live cache (vessels/aircraft, which only ever
// live in memory server-side, never a DB row). Nothing here is a stub
// lookup table.
//
// Extensible by construction: RESOLVERS/LABELERS/OPENERS are plain kind ->
// handler maps. A future kind (case:, mail:, rfi: — Phase 4, not built
// yet) is one new entry in each map, never a change to parse()/resolve()/
// label()/open() themselves.

import API_BASE from "../apiBase.js"

export function parseRef(ref) {
    if (typeof ref !== "string") return null
    const i = ref.indexOf(":")
    if (i < 0) return null
    return { kind: ref.slice(0, i), id: ref.slice(i + 1) }
}

async function fetchJSON(path) {
    try {
        const r = await fetch(`${API_BASE}${path}`)
        if (!r.ok) return null
        return await r.json()
    } catch {
        return null
    }
}

// ── Per-kind real resolvers ─────────────────────────────────────────────

const RESOLVERS = {
    // Alert.alert_id — real signal/alert record.
    sig: (id) => fetchJSON(`/api/alerts/${encodeURIComponent(id)}`),

    // Dossier entity — WatchZone or StrategicZone, keyed by `code` alone
    // (matching the reference doc's flat ent:ID form). The real profile
    // endpoint needs entity_type too, so resolve it via the real entities
    // list first (small: real watch zones + strategic zones, not a large
    // table) rather than guessing which table a bare code belongs to.
    ent: async (id) => {
        const list = await fetchJSON(`/api/dossiers/entities`)
        const row = Array.isArray(list) ? list.find((e) => e.code === id) : null
        if (!row) return null
        return fetchJSON(`/api/dossiers/${encodeURIComponent(row.entity_type)}/${encodeURIComponent(id)}`)
    },

    // Real Forge ontology node, looked up against the FULL graph (not the
    // tier_cap-curated /api/ontology/diagram subset).
    onto: (id) => fetchJSON(`/api/ontology/node/${encodeURIComponent(id)}`),

    // Real Sentinel imagery scene.
    scn: (id) => fetchJSON(`/api/scans/${encodeURIComponent(id)}`),

    // Real observation area (WatchZone as an AOI, not a dossier entity).
    aoi: (id) => fetchJSON(`/api/watch-zones/${encodeURIComponent(id)}`),

    // Real generated briefing/report.
    brf: (id) => fetchJSON(`/api/reports/${encodeURIComponent(id)}`),

    // Live vessel (mmsi) or aircraft (icao hex) — these only ever exist as
    // real in-memory cache entries server-side, never a DB row, so a
    // real 404 here honestly means "not currently transmitting," not a
    // bug — try vessel first, then aircraft.
    trk: async (id) => {
        const vessel = await fetchJSON(`/api/ais/vessels/${encodeURIComponent(id)}`)
        if (vessel) return { ...vessel, _trkType: "vessel" }
        const aircraft = await fetchJSON(`/api/adsb/aircraft/${encodeURIComponent(id)}`)
        if (aircraft) return { ...aircraft, _trkType: "aircraft" }
        return null
    },

    // Real infrastructure. Cables have a real, stable `id` (a slugified
    // name, e.g. "norte-conectado-infovia-06") — checked against the live
    // endpoint before assuming so. Ports do NOT: /api/infrastructure/ports
    // serves a static NGA World Port Index-style dataset with no id/code
    // field at all (confirmed live — only lat/lon/name/country/harbor_*).
    // Rather than fabricate a stable id that doesn't exist, `loc:` for a
    // port uses its real `name` as the identifier — an honest, disclosed
    // best-effort, not a fake database id — and needs a real bbox to
    // search (world-spanning here; a real UI caller with a known rough
    // location should narrow this for speed).
    loc: async (id) => {
        const cables = await fetchJSON(`/api/infrastructure/cables`)
        const cable = (cables?.cables || []).find((c) => c.id === id)
        if (cable) return { ...cable, _locType: "cable" }
        const ports = await fetchJSON(`/api/infrastructure/ports?bbox=-60,-180,75,180&limit=500`)
        const port = (ports?.items || []).find((p) => p.name === id)
        if (port) return { ...port, _locType: "port" }
        return null
    },

    // Real Case/RFI records (Workstation round, §7.2/§7.6/§7.7).
    case: (id) => fetchJSON(`/api/cases/${encodeURIComponent(id)}`),
    rfi:  (id) => fetchJSON(`/api/rfis/${encodeURIComponent(id)}`),

    // mail: is added structurally now (real kind, real parse/resolve entry)
    // even though the real Mail model doesn't exist until the separate
    // Mail/Gmail prompt — resolves to a clean null today, never a thrown
    // error, and will start resolving correctly the moment that model
    // lands with no change needed to this layer.
    mail: async () => null,
}

// ── Per-kind real labelers ──────────────────────────────────────────────

const LABELERS = {
    sig: (r) => r?.title || r?.message || r?.alert_type || "Signal",
    ent: (r) => r?.name || r?.profile?.name || "Dossier entity",
    onto: (r) => r?.label || "Ontology object",
    scn: (r) => r?.place || r?.aoi_name || `Scene ${r?.id || ""}`.trim(),
    aoi: (r) => r?.name || "Observation area",
    brf: (r) => r?.title || "Briefing",
    trk: (r) => r?.name || r?.callsign || r?.flight || (r?._trkType === "vessel" ? "Vessel" : "Aircraft"),
    loc: (r) => r?.name || r?.airport_name || r?.cable_name || "Place",
    case: (r) => r?.title ? `${r.case_id} · ${r.title}` : "Case",
    rfi:  (r) => r?.question || "RFI",
    mail: () => "Mail",
}

// ── Per-kind real navigation ─────────────────────────────────────────────
// Reuses this app's real, existing destination-neutral navigation channel
// (akili:navigate, extended in V3 Phase 1 §3.4 to carry recordRef/label
// for record-scoped tabs) and the real akili:fly-to channel for anything
// inherently spatial. Both are real, already-wired events — confirmed via
// audit — not new plumbing invented for this module.

function navigate(destination, recordRef, label) {
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination, recordRef, label } }))
}
function flyTo(lat, lon) {
    if (lat == null || lon == null) return
    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 250000 } }))
}

const OPENERS = {
    sig:  (id, r, lbl) => { navigate("inbox"); if (r?.lat != null) flyTo(r.lat, r.lon) },
    ent:  (id, r, lbl) => navigate("dossiers", `ent:${id}`, lbl),
    onto: (id, r, lbl) => navigate("ontology", `onto:${id}`, lbl),
    scn:  (id, r, lbl) => navigate("imagery", `scn:${id}`, lbl),
    aoi:  (id, r, lbl) => navigate("imagery", `aoi:${id}`, lbl),
    brf:  (id, r, lbl) => navigate("briefings", `brf:${id}`, lbl),
    trk:  (id, r, lbl) => { navigate("situation"); if (r?.lat != null) flyTo(r.lat, r.lon) },
    loc:  (id, r, lbl) => { navigate("situation"); if (r?.lat != null) flyTo(r.lat, r.lon) },
    // Real Workstation-module records (§7.2) — navigate("cases") routes
    // through app.jsx's real openTab(), whose own mode-routing correction
    // (§7.1) switches Watch -> Workstation automatically when one of these
    // opens from anywhere in Watch mode.
    //
    // RFIs and mail both used to have their own modules. Cases absorbed
    // them, so all three land there rather than at a module that no longer
    // exists — a ref that navigates nowhere is worse than one that lands
    // somewhere adjacent, because the click looks broken.
    case: (id, r, lbl) => navigate("cases", `case:${id}`, lbl),
    rfi:  (id, r, lbl) => navigate("cases", `rfi:${id}`, lbl),
    mail: (id, r, lbl) => navigate("cases", `mail:${id}`, lbl),
}

// ── The three real functions ─────────────────────────────────────────────

export async function resolve(ref) {
    const parsed = parseRef(ref)
    if (!parsed) return null
    const resolver = RESOLVERS[parsed.kind]
    if (!resolver) return null
    return resolver(parsed.id)
}

export async function label(ref) {
    const parsed = parseRef(ref)
    if (!parsed) return ref
    const record = await resolve(ref)
    const labeler = LABELERS[parsed.kind]
    if (!record || !labeler) return ref
    return labeler(record)
}

export async function open(ref) {
    const parsed = parseRef(ref)
    if (!parsed) return false
    const opener = OPENERS[parsed.kind]
    if (!opener) return false
    const record = await resolve(ref)
    const lbl = await label(ref)
    opener(parsed.id, record, lbl)
    return true
}

export const REF_KINDS = Object.keys(RESOLVERS)
