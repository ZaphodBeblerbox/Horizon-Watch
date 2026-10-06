/**
 * searchModel.js — what the search box suggests, in what order. Pure.
 *
 * The box answers "where" first: a place is the commonest thing anyone
 * types into a map console. Local places (159 countries, named regions,
 * the major cities — already shipped for the Minimap and voice) answer on
 * the first keystroke; the backend's geocoder (streets, towns, straits,
 * addresses) answers a few seconds later and is merged in, not appended
 * blindly — "Berlin" must not appear twice because two sources know it.
 */

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

/** 0 = exact, 1 = starts with, 2 = a word starts with, 3 = contains, -1 = no. */
export function matchRank(name, q) {
    const n = norm(name), t = norm(q)
    if (!t) return -1
    if (n === t) return 0
    if (n.startsWith(t)) return 1
    if (n.split(/[\s,()-]+/).some((w) => w.startsWith(t))) return 2
    if (n.includes(t)) return 3
    return -1
}

/** Camera height for a geocoder hit, from what kind of thing it is. */
export function altitudeForHit(hit) {
    const cat = String(hit?.category || "").toLowerCase()
    const osm = String(hit?.osm_type || "").toLowerCase()
    // A sea or gulf is hundreds of kilometres across, whatever category the
    // geocoder files it under (the Black Sea comes back as a "place").
    const t = String(hit?.type || "").toLowerCase()
    if (t === "sea" || t === "ocean" || /\b(sea|ocean|gulf)\b/i.test(hit?.name || "")) return 1_800_000
    if (cat === "highway" || cat === "building" || cat === "amenity" || cat === "shop") return 3_000
    if (cat === "place" || cat === "railway" || cat === "aeroway") return 40_000
    if (cat === "natural" || cat === "waterway") return 350_000
    // Countries come from the local list with their own size; a boundary the
    // geocoder returns is far more often a town or district ("Khor Fakkan"
    // is a boundary relation) than a country.
    if (cat === "boundary") return osm === "relation" ? 150_000 : 60_000
    return 60_000
}

const KIND_LABEL = {
    country: "Country", region: "Region", city: "City",
    chokepoint: "Chokepoint", port: "Port", airport: "Airport", cable: "Cable",
    strategic_zone: "Zone", zone: "Zone", location: "Place",
}

function near(a, b) {
    return Math.abs(a.lat - b.lat) < 0.5 && Math.abs(a.lon - b.lon) < 0.5
}

/**
 * Build grouped suggestions.
 * @returns {{ group: string, items: object[] }[]}
 */
export function buildSuggestions(query, { places = [], remote = [], theaters = [], modules = [], signals = [] } = {}) {
    const q = norm(query)
    const groups = []
    if (!q) {
        if (theaters.length) groups.push({ group: "Theaters", items: theaters.slice(0, 6).map((t) => ({ kind: "theater", id: t.id, label: t.name, raw: t })) })
        if (modules.length) groups.push({ group: "Go to", items: modules.slice(0, 6).map((m) => ({ kind: "module", id: m.key, label: m.label, raw: m })) })
        return groups
    }

    // Places: local first (instant), then geocoder hits that are not the same place.
    const local = places
        .map((p) => ({ p, r: matchRank(p.name, q) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || (a.p.kind === "country" ? -1 : 0) - (b.p.kind === "country" ? -1 : 0) || a.p.name.length - b.p.name.length)
        .slice(0, 4)
        .map(({ p }) => ({
            kind: "place", id: `${p.kind}:${p.name}`, label: p.name, sub: KIND_LABEL[p.kind] || "Place",
            lat: p.lat, lon: p.lon, altitude: p.altitude,
        }))
    // What you typed first: "Unter den Lin" is Unter den Linden before the
    // opera house that merely stands on it.
    const geo = remote.filter((h) => h.type === "location" && Number.isFinite(h.lat) && Number.isFinite(h.lon))
        .map((h, i) => ({ h, i, r: matchRank(h.name, q) }))
        .sort((a, b) => (a.r < 0 ? 9 : a.r) - (b.r < 0 ? 9 : b.r) || a.i - b.i)
        .map((x) => x.h)
    const localCountries = new Set(local.filter((x) => x.sub === "Country").map((x) => norm(x.label)))
    const extra = []
    for (const h of geo) {
        const item = {
            kind: "place", id: `geo:${h.display_name || h.name}:${h.lat}`, label: h.name,
            sub: [h.display_name && h.display_name !== h.name ? h.display_name.replace(`${h.name}, `, "") : null,
                  h.category && h.category !== "boundary" ? h.category : null].filter(Boolean).join(" · ") || "Place",
            lat: h.lat, lon: h.lon, altitude: altitudeForHit(h),
        }
        // A country the local list already has is that country, wherever
        // the geocoder put its second centroid.
        const dup = (h.category === "boundary" && localCountries.has(norm(h.name)))
            || [...local, ...extra].some((x) => norm(x.label) === norm(item.label) && near(x, item))
        if (!dup) extra.push(item)
    }
    const allPlaces = [...local, ...extra].slice(0, 7)
    if (allPlaces.length) groups.push({ group: "Places", items: allPlaces })

    // Things on the map the backend knows by name: chokepoints, ports, airports, cables, zones.
    // One ship or one aircraft, live: its own group, first — an identifier
    // typed into a map search is the most specific thing anyone asks for.
    const tracks = remote.filter((h) => (h.type === "vessel" || h.type === "aircraft") && Number.isFinite(h.lat))
        .slice(0, 6)
        .map((h) => ({
            kind: "track", id: `${h.type}:${h.mmsi || h.icao}`, label: h.name,
            sub: h.type === "vessel"
                ? ["Vessel", h.ship_type, h.flag, `MMSI ${h.mmsi}`].filter(Boolean).join(" · ")
                : ["Aircraft", h.airline, h.registration, h.icao].filter(Boolean).join(" · "),
            raw: h,
        }))
    if (tracks.length) groups.unshift({ group: "Live tracks", items: tracks })

    const feats = remote.filter((h) => !["location", "rule", "vessel", "aircraft"].includes(h.type) && Number.isFinite(h.lat) && Number.isFinite(h.lon))
        .map((h, i) => ({ h, i, r: matchRank(h.name, q) }))
        .sort((a, b) => (a.r < 0 ? 9 : a.r) - (b.r < 0 ? 9 : b.r) || a.i - b.i)
        .map((x) => x.h)
        .slice(0, 4)
        .map((h) => {
            // A GeoConfirmed placemark's `name` is its date ("30 MAR 2026");
            // what happened is in the description.
            const isGc = h.type === "geoconfirmed"
            const what = isGc ? String(h.description || "").split(/\n|(?<=\.)\s/)[0].trim() : ""
            return {
                kind: "entity", id: `${h.type}:${h.system_id || h.name}`, label: (isGc && what) || h.name,
                sub: [KIND_LABEL[h.type] || (isGc ? "GeoConfirmed" : h.type), isGc ? h.name : h.country].filter(Boolean).join(" · "),
                raw: h,
            }
        })
    if (feats.length) groups.push({ group: "On the map", items: feats })
    // THE CLOSER MATCH LEADS, whichever list it is in. "Bab el" is Bab
    // el-Mandeb (a chokepoint, prefix match), not Al-Bab (a town that merely
    // contains the word) — and Enter takes whatever is first.
    const best = (g) => Math.min(...g.items.map((i) => { const r = matchRank(i.label, q); return r < 0 ? 9 : r }))
    const pi = groups.findIndex((g) => g.group === "Places"), fi = groups.findIndex((g) => g.group === "On the map")
    if (pi >= 0 && fi >= 0 && best(groups[fi]) < best(groups[pi])) {
        const [f] = groups.splice(fi, 1)
        groups.splice(pi, 0, f)
    }

    const th = theaters.filter((t) => matchRank(t.name, q) >= 0).slice(0, 3)
        .map((t) => ({ kind: "theater", id: t.id, label: t.name, sub: "Theater", raw: t }))
    if (th.length) groups.push({ group: "Theaters", items: th })

    const sig = signals
        .map((s) => ({ s, r: Math.min(...[s.headline, s.title, s.location, s.location_country].map((v) => { const r = matchRank(v, q); return r < 0 ? 9 : r })) }))
        .filter((x) => x.r < 9).sort((a, b) => a.r - b.r).slice(0, 4)
        .map(({ s }) => ({ kind: "signal", id: s.id || s.fusion_id || s.headline, label: s.headline || s.title || "Signal",
                           sub: s.location_country || s.location || "", severity: s.severity_tier || s.severity, raw: s }))
    if (sig.length) groups.push({ group: "Signals", items: sig })

    const mods = modules.filter((m) => matchRank(m.label, q) >= 0).slice(0, 3)
        .map((m) => ({ kind: "module", id: m.key, label: m.label, sub: "Open", raw: m }))
    if (mods.length) groups.push({ group: "Go to", items: mods })

    return groups
}

/**
 * Coordinates typed straight in, the way Google Earth takes them:
 * "26.5, 56.4", "26.5 56.4", "26.5N 56.4E", "26°30'N 56°24'E" is not
 * attempted — decimal degrees with optional hemisphere letters only.
 */
export function parseCoords(text) {
    const t = String(text || "").trim().toUpperCase()
    const m = /^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/.exec(t)
    if (!m) return null
    let lat = parseFloat(m[1]), lon = parseFloat(m[3])
    if (m[2] === "S") lat = -Math.abs(lat)
    if (m[4] === "W") lon = -Math.abs(lon)
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return { lat, lon }
}
