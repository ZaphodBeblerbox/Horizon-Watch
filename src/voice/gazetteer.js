/**
 * gazetteer.js — turning a spoken place into somewhere the camera can go.
 *
 * "Go to Yemen" needs three things: that Yemen is a place, where its
 * centre is, and how far out to sit so you see the country rather than a
 * field. All three already exist in this app and none of them were
 * reachable from a command:
 *
 *   public/data/world-land.json  159 countries, each with a centroid and a
 *                                radius — the Minimap's own label data
 *   public/data/world-cities.json cities, for "fly to Aden"
 *   src/data/regionCoords.js     the named regions the mission profile uses
 *   GET /api/country-codes       ISO2 ↔ ISO3, so a country can be looked up
 *                                in the risk index, which is keyed by ISO3
 *
 * ALTITUDE COMES FROM THE PLACE'S OWN SIZE. A fixed height frames Russia
 * and Bahrain identically, which means one of them is wrong. The label
 * data carries a radius; the camera height is derived from it, clamped so
 * a city is not a street view and a continent is not the whole globe.
 */
import { REGION_COORDS } from "../data/regionCoords.js"
import API_BASE from "../apiBase.js"

const base = import.meta.env?.BASE_URL || "/"

let _places = null          // Promise<Place[]>
let _a2a3 = null            // Promise<Map<string,string>>

/** @typedef {{ name: string, kind: "country"|"city"|"region", lat: number, lon: number, altitude: number, iso2?: string }} Place */

/**
 * Camera height for a place of this size, in metres.
 *
 * world-land's `r` is an AREA-like figure, not a width: Russia is 2821 and
 * Yemen is 38, a ratio of 74 where the real linear ratio is about 6. Using
 * it directly framed every country except the largest at street level —
 * Yemen came out at 99km up. The square root turns it back into something
 * proportional to width, and 180,000 was fitted against known cases:
 * Taiwan ~320km, Syria ~770km, Yemen ~1,100km, Sudan ~2,250km, Russia at
 * the 9,000km ceiling.
 */
function altitudeFor(r) {
    if (!Number.isFinite(r)) return 1_200_000
    return Math.min(9_000_000, Math.max(200_000, Math.sqrt(r) * 180_000))
}

async function loadPlaces() {
    const [land, cities] = await Promise.all([
        fetch(`${base}data/world-land.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${base}data/world-cities.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    const out = []
    for (const c of land?.labels || []) {
        if (!Array.isArray(c.c)) continue
        out.push({
            name: c.n, kind: "country", iso2: c.a2,
            lon: c.c[0], lat: c.c[1], altitude: altitudeFor(c.r),
        })
    }
    for (const [name, v] of Object.entries(REGION_COORDS)) {
        out.push({ name, kind: "region", lat: v.lat, lon: v.lon, altitude: 2_600_000 })
    }
    for (const c of Array.isArray(cities) ? cities : (cities?.cities || [])) {
        const lat = c.y ?? c.lat, lon = c.x ?? c.lon
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
        out.push({ name: c.n || c.name, kind: "city", lat, lon, altitude: 180_000 })
    }
    return out.filter((p) => p.name)
}

export function places() {
    if (!_places) _places = loadPlaces().catch(() => [])
    return _places
}

export function a2ToA3() {
    if (!_a2a3) {
        _a2a3 = fetch(`${API_BASE}/api/country-codes`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => new Map(Object.entries(d?.iso2_to_iso3 || {})))
            .catch(() => new Map())
    }
    return _a2a3
}

/* Words that are never a place, however much they look like one once the
   command verb has been stripped. Without this, "go to the map" resolves
   to Mali on a two-character edit. */
const STOPWORDS = new Set([
    "the", "a", "an", "it", "this", "that", "there", "here", "me", "us",
    "map", "risk", "index", "signals", "briefing", "basket", "note",
    "please", "now", "back", "home", "view", "level", "score",
])

/**
 * Find the place a sentence is talking about.
 *
 * Longest match wins, so "South Sudan" is not Sudan, and a whole-name
 * match always beats a fuzzy one — "Chad" must not become "Chad"-ish
 * something else just because another entry is one edit closer to a
 * neighbouring word.
 */
export async function findPlace(text) {
    const t = String(text || "").toLowerCase()
    if (!t.trim()) return null
    const all = await places()

    let best = null
    for (const p of all) {
        const n = p.name.toLowerCase()
        if (n.length < 3 || STOPWORDS.has(n)) continue
        /* Word-boundary match, so "oman" does not fire inside "romania".
           The optional trailing s catches the possessive: normalize()
           strips the apostrophe, so "Yemen's risk" arrives as "yemens". */
        const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`)
        if (!re.test(t)) continue
        const rank = (p.kind === "country" ? 2 : p.kind === "region" ? 1 : 0)
        if (!best || n.length > best.n.length || (n.length === best.n.length && rank > best.rank)) {
            best = { place: p, n, rank }
        }
    }
    return best?.place || null
}

/** The risk index for a country, or a reason there is none. */
export async function riskFor(place) {
    if (!place || place.kind !== "country" || !place.iso2) {
        return { ok: false, why: `The risk index is published per country; ${place?.name || "that"} is not one.` }
    }
    const iso3 = (await a2ToA3()).get(String(place.iso2).toUpperCase())
    if (!iso3) return { ok: false, why: `No ISO code for ${place.name}, so the risk index cannot be looked up.` }
    try {
        const r = await fetch(`${API_BASE}/api/risk-index/country/${iso3}`, { credentials: "include" })
        if (r.status === 404) return { ok: false, why: `${place.name} has no risk index — not enough recorded events.` }
        if (!r.ok) return { ok: false, why: `Risk index unavailable (${r.status}).` }
        const d = await r.json()
        return { ok: true, iso3, ...d }
    } catch (e) {
        return { ok: false, why: `Risk index unavailable — ${e.message || e}` }
    }
}
