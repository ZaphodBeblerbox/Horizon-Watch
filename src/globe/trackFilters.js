/**
 * trackFilters.js — which vessels and aircraft the map draws.
 *
 * Applied to the live lists before they reach the AIS and ADS-B layers, so
 * the counts, the markers and the hover all agree. A null set means "no
 * filter on this axis", an empty set means "nothing" — a reader who
 * deselected every type should see no vessels, not all of them.
 */

export const VESSEL_TYPES = [
    ["cargo", "Cargo"], ["tanker", "Tanker"], ["passenger", "Passenger"],
    ["fishing", "Fishing"], ["military", "Military"], ["other", "Other"], ["unknown", "Unknown"],
]
export const AIRCRAFT_KINDS = [
    ["military", "Military"], ["commercial", "Airline"], ["other", "Private & other"],
]

export const vesselType = (v) => {
    const t = String(v?.ship_type || "").toLowerCase()
    return VESSEL_TYPES.some(([k]) => k === t) ? t : (t ? "other" : "unknown")
}
export const aircraftKind = (a) => (a?.military ? "military" : a?.airline ? "commercial" : "other")
export const vesselFlag = (v) => v?.flag || null
export const aircraftCountry = (a) => a?.operator?.country || null

export const EMPTY_VESSEL_FILTER = { types: null, flags: null, sanctionedOnly: false }
export const EMPTY_AIRCRAFT_FILTER = { kinds: null, airlines: null, countries: null, watchlistedOnly: false }

const allows = (set, v) => !set || set.has(v)

export function filterVessels(list, f = EMPTY_VESSEL_FILTER, sanctioned = null) {
    if (!Array.isArray(list)) return []
    return list.filter((v) =>
        allows(f.types, vesselType(v))
        && allows(f.flags, vesselFlag(v))
        && (!f.sanctionedOnly || (sanctioned && sanctioned.has(String(v.mmsi)))))
}

export function filterAircraft(list, f = EMPTY_AIRCRAFT_FILTER, watchlisted = null) {
    if (!Array.isArray(list)) return []
    return list.filter((a) =>
        allows(f.kinds, aircraftKind(a))
        && allows(f.airlines, a.airline || null)
        && allows(f.countries, aircraftCountry(a))
        && (!f.watchlistedOnly || (watchlisted && watchlisted.has(String(a.icao || a.hex || "").toLowerCase()))))
}

/** [value, count] pairs, most common first, unknowns dropped. */
export function facet(list, key) {
    const c = new Map()
    for (const x of list || []) {
        const k = key(x)
        if (k) c.set(k, (c.get(k) || 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

export const isActive = (f) => Object.entries(f || {}).some(([k, v]) => (v instanceof Set ? true : k.endsWith("Only") && v))
