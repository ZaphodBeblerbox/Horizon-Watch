/**
 * ontologyApi.js — the ontology of one thing (backend ontology_view.py via
 * POST /api/ontology/of): by graph id, or by a sidebar record.
 */
import API_BASE from "../apiBase.js"

const cache = new Map()

// Only what the backend reads: a record can carry megabytes of other fields.
const KEEP = ["id", "alert_id", "signal_id", "event_id", "headline", "title", "name", "label", "vessel_name", "summary_en", "summary",
    "description", "text", "event_type", "alert_type", "kind", "category", "type", "place", "location_name", "location", "city",
    "country_code", "country", "flag", "location_country", "lat", "lon", "lng", "channel_title", "source_name", "source", "channel",
    "provider", "operator", "owner", "registered_owner", "airline", "aircraft_type", "model", "type_name", "vessel_type", "ship_type",
    "vessel_mmsi", "mmsi", "MMSI", "iso2", "code", "icao", "ident", "severity", "severity_tier", "posted_at", "created_at", "timestamp", "party", "role", "entity_type", "entity_id", "iso3", "iso_code", "country_name"]

export function slimRecord(data) {
    const out = {}
    for (const k of KEEP) {
        const v = data?.[k]
        if (v == null || v === "") continue
        out[k] = typeof v === "string" ? v.slice(0, 1500) : (typeof v === "object" ? undefined : v)
    }
    return out
}

export async function fetchOntology({ id = null, entityType = null, data = null, hops = 1 }) {
    const body = id ? { id, hops } : { entity_type: entityType, data: slimRecord(data), hops }
    const key = JSON.stringify(body)
    if (cache.has(key)) return cache.get(key)
    const p = fetch(`${API_BASE}/api/ontology/of`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then((r) => (r.ok ? r.json() : null)).then((d) => (d?.available ? d : null))
    cache.set(key, p)
    p.catch(() => cache.delete(key))
    if (cache.size > 120) cache.delete(cache.keys().next().value)
    return p
}
