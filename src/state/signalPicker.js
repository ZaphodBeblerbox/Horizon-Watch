/**
 * signalPicker.js — choosing signals by urgency and sector.
 *
 * THREE SURFACES ASK THE SAME QUESTION. The editor wants "the critical
 * maritime ones", the deck builder wants a slide per imagery detection,
 * the generator wants every wire report left out. All three were picking
 * from a flat list sorted by one key, which is fine at eight signals and
 * useless at eighty.
 *
 * The vocabulary is the one the case tree already files into — filing.js
 * decides what a sector is and what an urgency is, and this does not get a
 * second opinion. What is added here is the maths on top: counts per facet,
 * filtering, and grouping into ordered buckets.
 *
 * THE COUNTS ARE OF THE OTHER FACET'S RESULT, not of everything. With
 * "critical" on, the sector chips say how many critical signals each sector
 * holds — otherwise the chips promise rows that the filter then withholds.
 */
import { URGENCY, sectorOf, urgencyOf } from "./filing.js"

export { URGENCY, sectorOf, urgencyOf }

/** Where an urgency sits, lower being more urgent. Unknown sorts last. */
export function urgencyRank(u) {
    const i = URGENCY.indexOf(String(u || "").toLowerCase())
    return i < 0 ? URGENCY.length : i
}

/* The corpus, the map and the case tree each grew their own severity
   words. One vocabulary, so "medium" and "elevated" are not two different
   bands in two different windows. */
const URGENCY_ALIAS = {
    severe: "critical", emergency: "critical", red: "critical",
    major: "significant", warning: "significant", amber: "significant",
    medium: "elevated", moderate: "elevated", watch: "elevated",
    low: "routine", info: "routine", informational: "routine",
    minor: "routine", none: "routine", green: "routine",
}

export function normaliseUrgency(raw) {
    const s = String(raw || "").toLowerCase().trim()
    if (URGENCY.includes(s)) return s
    return URGENCY_ALIAS[s] || "routine"
}

/* The generator's corpus arrives in snapshot buckets rather than as
   records with a domain, so the bucket name is the sector. Same words as
   the case tree uses, so "Imagery" means one thing in the whole app. */
const SNAPSHOT_SECTOR = {
    ais_anomalies: "Vessels",
    adsb_anomalies: "Aircraft",
    sentinel_detections: "Imagery",
    news_assessments: "Wire Reports",
    top_articles: "Wire Reports",
    geoconfirmed_signals: "Verified Events",
    fusion_events: "Surge & Fusion",
    surge_events: "Surge & Fusion",
    foresight_risks: "Outlook",
    strategic_zones: "Zones",
}

export function sectorOfSnapshotSection(snapSection) {
    return SNAPSHOT_SECTOR[snapSection] || "Other"
}

/**
 * The sector a saved item belongs to.
 *
 * A stored sector wins: it was decided when the thing was filed, against
 * the record as it then was, and re-deriving it from a thinned-out cache
 * entry is how a vessel ends up in "Other" a week later.
 */
export function sectorOfSaved(item) {
    const stored = item?.sector
    return typeof stored === "string" && stored.trim() ? stored.trim() : sectorOf(item)
}

export function urgencyOfSaved(item) {
    return normaliseUrgency(item?.urgency || item?.severity || item?.severity_tier)
}

/**
 * How many items sit under each urgency and each sector.
 *
 * Each facet is counted against the OTHER facet's filter, never against
 * the full set: a chip that says 4 and yields 0 rows is a lie about the
 * data, and people read the chips to decide where to look.
 *
 * @param items      the signals, in whatever shape the surface holds them
 * @param read       {urgency, sector} readers for this surface's shape
 * @param filters    {urgency: Set, sector: Set} — what is currently on
 */
export function facetCounts(items, read, filters = {}) {
    const onU = filters.urgency instanceof Set && filters.urgency.size ? filters.urgency : null
    const onS = filters.sector instanceof Set && filters.sector.size ? filters.sector : null
    const urgency = {}
    const sector = {}
    for (const it of items || []) {
        const u = read.urgency(it)
        const s = read.sector(it)
        if (!onS || onS.has(s)) urgency[u] = (urgency[u] || 0) + 1
        if (!onU || onU.has(u)) sector[s] = (sector[s] || 0) + 1
    }
    return { urgency, sector }
}

/** The sectors present, most-populated first, then alphabetically. */
export function sectorsPresent(items, read) {
    const n = {}
    for (const it of items || []) {
        const s = read.sector(it)
        n[s] = (n[s] || 0) + 1
    }
    return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b))
}

/** The urgencies present, in urgency order — never alphabetical. */
export function urgenciesPresent(items, read) {
    const seen = new Set((items || []).map((it) => read.urgency(it)))
    return URGENCY.filter((u) => seen.has(u))
}

/**
 * Filter by the chips and the search box.
 *
 * An EMPTY facet means "everything", not "nothing". A fresh picker with no
 * chip pressed has to show the whole set, or the first thing a person sees
 * is an empty list they have to configure their way out of.
 */
export function applyFilters(items, read, { urgency, sector, q } = {}) {
    const onU = urgency instanceof Set && urgency.size ? urgency : null
    const onS = sector instanceof Set && sector.size ? sector : null
    const text = String(q || "").trim().toLowerCase()
    return (items || []).filter((it) => {
        if (onU && !onU.has(read.urgency(it))) return false
        if (onS && !onS.has(read.sector(it))) return false
        if (text && !String(read.text ? read.text(it) : "").toLowerCase().includes(text)) return false
        return true
    })
}

/**
 * Ordered buckets for the list.
 *
 * @param by  "urgency" | "sector" | "none"
 * @returns [{ key, items }] — urgency buckets in urgency order, sector
 *          buckets largest first, and "none" as one unlabelled bucket.
 */
export function group(items, read, by = "urgency") {
    const list = items || []
    if (by === "none") return list.length ? [{ key: null, items: sortWithin(list, read) }] : []
    const keyOf = by === "sector" ? read.sector : read.urgency
    const bucket = new Map()
    for (const it of list) {
        const k = keyOf(it)
        if (!bucket.has(k)) bucket.set(k, [])
        bucket.get(k).push(it)
    }
    const keys = [...bucket.keys()]
    keys.sort(by === "urgency"
        ? (a, b) => urgencyRank(a) - urgencyRank(b)
        : (a, b) => bucket.get(b).length - bucket.get(a).length || a.localeCompare(b))
    return keys.map((k) => ({ key: k, items: sortWithin(bucket.get(k), read) }))
}

/* Inside a bucket, the most urgent first and then the most recent — the
   order you would read them in, not the order they were saved in. */
function sortWithin(list, read) {
    return [...list].sort((a, b) =>
        urgencyRank(read.urgency(a)) - urgencyRank(read.urgency(b)) ||
        (read.at ? (read.at(b) || 0) - (read.at(a) || 0) : 0))
}

/** The reader for anything that came out of savedForBriefing. */
export const SAVED_READ = {
    urgency: urgencyOfSaved,
    sector: sectorOfSaved,
    at: (s) => Date.parse(s?.when) || s?.savedAt || 0,
    text: (s) => [s?.headline, s?.label, s?.region, s?.source].filter(Boolean).join(" "),
}
