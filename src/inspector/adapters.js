/**
 * adapters.js — pure entity → InspectorPanel normalization functions.
 *
 * Each adapter takes whatever raw `data` payload the caller already has
 * (the same object today's bespoke Globe*Popup components receive) and maps
 * it to a normalized shape:
 *
 *   {
 *     identity:   { title, subtitle, entityType, subtype, sanctionsStatus },
 *     attributes: [{ label, value }, ...],   // only fields actually present
 *     provenance: { feed, ingestedAt } | null,
 *     actions:    { canJumpToLocation },
 *   }
 *
 * These are pure functions — no React, no DOM, no fetch — so they're unit
 * tested directly in adapters.test.js without mounting anything.
 *
 * `identity.entityType`/`subtype`/`sanctionsStatus` feed directly into
 * src/globe/entityIcons.js's entityMarkerSvg() — the full-UI-rebuild icon
 * system (real outline glyph + real sub-type corner badge + a real status
 * ring for genuine sanctions corroboration, never an affiliation-frame
 * shape). This replaces the Round-1 markerRenderer.js AFFILIATION/
 * ENTITY_FUNCTION system that the rebuild spec explicitly cancels.
 *
 * Ground rule: never invent a field. If something isn't in `data`, omit it.
 */

import { resolveSanctionsStatus } from "../globe/entityIcons.js"
import { vesselShipType, acClassify } from "../globe/iconUtils.js"

// ── Shared helpers ────────────────────────────────────────────────────────────

function attr(label, value) {
    if (value === null || value === undefined || value === "") return null
    return { label, value }
}

function compact(list) {
    return list.filter(Boolean)
}

function isFiniteNum(v) {
    return v !== null && v !== undefined && v !== "" && isFinite(Number(v))
}

function fmtCoord(lat, lon) {
    if (!isFiniteNum(lat) || !isFiniteNum(lon)) return null
    return `${Number(lat).toFixed(3)}°, ${Number(lon).toFixed(3)}°`
}

function fmtUnit(v, unit, decimals = 1) {
    if (!isFiniteNum(v)) return null
    return `${Number(v).toFixed(decimals)} ${unit}`
}

function fmtDeg(v) {
    if (!isFiniteNum(v)) return null
    return `${Math.round(Number(v))}°`
}

function fmtTimestamp(ts) {
    if (!ts) return null
    try {
        const d = new Date(ts)
        if (isNaN(d.getTime())) return String(ts)
        return d.toLocaleString()
    } catch {
        return String(ts)
    }
}

/** Real position field, wherever it lives on the payload — never fabricated. */
function pointOf(data) {
    const lat = data?.lat ?? data?.latitude ?? null
    const lon = data?.lon ?? data?.lng ?? data?.longitude ?? null
    if (isFiniteNum(lat) && isFiniteNum(lon)) return { lat: Number(lat), lon: Number(lon) }
    return null
}

/**
 * Provenance — "where did this data come from" (feed name / ingestion time).
 * Shared across every adapter since any entity type's payload might (or
 * might not) carry these. Returns null rather than a half-empty object when
 * nothing real is present.
 */
function extractProvenance(data) {
    if (!data) return null
    const feed = data.feed_name || data.feed || data.source_feed || data.ingest_source || data.provider || null
    const ingestedAtRaw = data.ingested_at || data.ingestion_timestamp || data.fetched_at || null
    if (!feed && !ingestedAtRaw) return null
    return { feed: feed || null, ingestedAt: ingestedAtRaw ? fmtTimestamp(ingestedAtRaw) : null }
}

function humanizeKey(key) {
    return key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── vessel ─────────────────────────────────────────────────────────────────────

/**
 * Sanctions corroboration lives on vessel data as whatever the caller already
 * fetched from check_sanctions_for_vessel() (backend/sanctions_loader.py) —
 * shape `{status: "confirmed"|"possible", hit, mmsi, vessel_name}`. Fed
 * straight into entityIcons.js's status ring (real color, no frame shape).
 */
export function adaptVessel(data = {}) {
    const subtype = vesselShipType(data)
    const sanctions = data.sanctions || data.sanctions_check || null
    const sanctionsStatus = sanctions?.status || null

    const sog = data.sog ?? data.speed
    const hdg = isFiniteNum(data.heading) && Number(data.heading) !== 511
        ? Number(data.heading)
        : (data.cog ?? null)
    const point = pointOf(data)

    const attributes = compact([
        attr("Name", data.name),
        attr("MMSI", data.mmsi),
        attr("IMO", data.imo),
        attr("Callsign", data.callsign),
        attr("Flag", data.flag || data.flag_country || data.country),
        attr("Type", data.ship_type),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
        attr("Course", fmtDeg(hdg)),
        attr("Speed", fmtUnit(sog, "kn")),
        attr("Destination", data.destination),
        attr("Status", data.nav_status),
        attr("Dimensions", data.length ? `${data.length}m × ${data.beam || "?"}m` : null),
        attr("Sanctions", sanctions?.status ? `${sanctions.status} match${sanctions.vessel_name ? ` — ${sanctions.vessel_name}` : ""}` : null),
    ])

    return {
        identity: {
            title: data.name || "Unknown Vessel",
            subtitle: data.ship_type || null,
            entityType: "vessel",
            subtype,
            sanctionsStatus,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── aircraft ───────────────────────────────────────────────────────────────────

export function adaptAircraft(data = {}) {
    const acClass = acClassify(data)

    const registration = data.registration || data.tail_number || null
    const callsign = (data.flight || data.callsign || "").trim() || null
    const icao = data.icao ?? data.icao24 ?? null
    const alt = data.alt_baro ?? data.altitude ?? data.baro_altitude
    const gs = data.gs ?? data.velocity ?? data.ground_speed
    const point = pointOf(data)

    const attributes = compact([
        attr("Registration", registration),
        attr("Airline", data.airline || null),
        attr("Callsign", callsign),
        attr("ICAO24", icao),
        attr("Type", data.aircraft_type || data.type_designator || null),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
        attr("Heading", fmtDeg(data.track ?? data.heading)),
        attr("Speed", fmtUnit(gs, "kts", 0)),
        attr("Altitude", isFiniteNum(alt) ? `${Number(alt).toLocaleString()} ft` : null),
        attr("Squawk", data.squawk),
        attr("Origin", data.origin_country),
    ])

    return {
        identity: {
            title: callsign || registration || icao || "Unknown Aircraft",
            subtitle: acClass ? humanizeKey(acClass) : null,
            entityType: "aircraft",
            subtype: acClass,
            sanctionsStatus: null,
        },
        attributes,
        // Real reference photo (Planespotters.net, via GET /api/aviation/photo/{icao24})
        // — shown only when a real photo exists for this real aircraft; never a
        // placeholder or stock image. Not AI-derived: this is a real photo lookup
        // keyed by ICAO24, same as the route/registration lookup above.
        media: data.photo_url ? {
            photoUrl: data.photo_url,
            photographer: data.photographer || null,
            sourceLabel: "Planespotters.net",
        } : null,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── alert ──────────────────────────────────────────────────────────────────────

/**
 * Real domain-based icon choice for an alert — same logic
 * markerRenderer.js's resolveAlertEntityFunction() used (AIS -> vessel
 * glyph, ADS-B -> aircraft glyph with a real military/general sub-type
 * badge, everything else -> the generic alert/warning glyph).
 *
 * Exported so src/globe/GlobeAlertsLayer.jsx's real Cesium billboards can
 * reuse the exact same domain-based classification this file already uses
 * for InspectorPanel — one source of truth for "what glyph does this alert
 * get", not two independently-maintained copies of the same real logic.
 */
export function alertEntityTypeAndSubtype(a) {
    const domain = (a.domain || a.source || "").toUpperCase()
    if (domain === "AIS") return { entityType: "vessel", subtype: null }
    if (domain === "ADSB") {
        const isMilitary = a.alert_category === "MILITARY_AIRCRAFT" ||
            a.alert_type === "military_aircraft" || a.rule_name === "Military Squawk" || a.aircraft_military
        return { entityType: "aircraft", subtype: isMilitary ? "military" : "general" }
    }
    return { entityType: "alert", subtype: null }
}

export function adaptAlert(data = {}) {
    const { entityType, subtype } = alertEntityTypeAndSubtype(data)
    const sanctionsStatus = resolveSanctionsStatus(data)
    const point = pointOf(data)
    const domain = data.domain || data.source || null
    const summary = data.message || data.title || data.summary || null
    const evidence = data.explanation || data.evidence || data.analyst_note || null

    const attributes = compact([
        attr("Severity", data.severity),
        attr("Domain", domain),
        attr("Rule", data.rule_name),
        attr("Timestamp", fmtTimestamp(data.timestamp)),
        attr("Summary", summary),
        attr("Evidence", evidence),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
    ])

    return {
        identity: {
            title: data.vessel || data.aircraft || data.entity_name || data.rule_name || "Alert",
            subtitle: (data.severity || "").toUpperCase() || null,
            entityType,
            subtype,
            sanctionsStatus,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── zone ───────────────────────────────────────────────────────────────────────

function zoneBoundsText(data) {
    if (data.bounds && typeof data.bounds === "object") {
        return Object.entries(data.bounds)
            .map(([k, v]) => `${humanizeKey(k)} ${Number(v).toFixed(2)}`)
            .join(", ")
    }
    const bboxKeys = ["bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat"]
    if (bboxKeys.every((k) => isFiniteNum(data[k]))) {
        return `${Number(data.bbox_min_lon).toFixed(2)}, ${Number(data.bbox_min_lat).toFixed(2)} → `
            + `${Number(data.bbox_max_lon).toFixed(2)}, ${Number(data.bbox_max_lat).toFixed(2)}`
    }
    if (Array.isArray(data.coordinates) && data.coordinates.length) {
        const lons = data.coordinates.map((c) => c[0])
        const lats = data.coordinates.map((c) => c[1])
        return `${Math.min(...lons).toFixed(2)}, ${Math.min(...lats).toFixed(2)} → `
            + `${Math.max(...lons).toFixed(2)}, ${Math.max(...lats).toFixed(2)}`
    }
    return null
}

function zoneRulesText(data) {
    const rules = data.rules || data.associated_rules || data.zone_rules || null
    if (!Array.isArray(rules) || !rules.length) return null
    return rules.map((r) => (typeof r === "string" ? r : (r.name || r.rule_name || r.rule_id))).filter(Boolean).join(", ")
}

function zoneCentroid(data) {
    const bboxKeys = ["bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat"]
    if (bboxKeys.every((k) => isFiniteNum(data[k]))) {
        return { lat: (Number(data.bbox_min_lat) + Number(data.bbox_max_lat)) / 2, lon: (Number(data.bbox_min_lon) + Number(data.bbox_max_lon)) / 2 }
    }
    if (Array.isArray(data.coordinates) && data.coordinates.length) {
        const lons = data.coordinates.map((c) => c[0])
        const lats = data.coordinates.map((c) => c[1])
        return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 }
    }
    return pointOf(data)
}

export function adaptZone(data = {}) {
    const bounds = zoneBoundsText(data)
    const rules = zoneRulesText(data)
    const point = zoneCentroid(data)

    const attributes = compact([
        attr("Name", data.name),
        attr("Zone type", data.zone_type),
        attr("Severity baseline", data.severity_baseline),
        attr("Bounds", bounds),
        attr("Associated rules", rules),
        attr("Description", data.description),
    ])

    return {
        identity: {
            title: data.name || "Zone",
            subtitle: data.zone_type || null,
            entityType: "zone",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            // Not every zone (e.g. a purely descriptive AOI with no real
            // bounds data) has a real point to fly to — only offer the
            // action when one can be honestly derived.
            canJumpToLocation: !!point,
        },
    }
}

// ── news / event ───────────────────────────────────────────────────────────────

export function adaptNews(data = {}) {
    const point = pointOf(data)
    const headline = data.headline || data.clean_title || data.title || null
    const sources = Array.isArray(data.sources) ? data.sources : (data.source_name ? [data.source_name] : [])
    const category = data.event_type || data.type || data.category || null
    const timestamp = data.latest_event || data.published_at || data.published || data.timestamp || null

    const attributes = compact([
        attr("Headline", headline),
        attr("Source", sources.join(", ") || null),
        attr("Timestamp", fmtTimestamp(timestamp)),
        attr("Category", category),
        attr("Severity", data.severity_tier || data.severity),
        attr("Location", data.location),
        attr("Summary", data.summary || data.body || data.context_summary),
    ])

    return {
        identity: {
            title: headline || "News Event",
            subtitle: category || null,
            entityType: "news_event",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── infrastructure ───────────────────────────────────────────────────────────────

const INFRA_TYPE_LABELS = {
    line: "Power Line", cable: "Power Cable", substation: "Substation",
    plant: "Power Plant", tower: "Transmission Tower", transformer: "Transformer",
    pipeline: "Pipeline", telecoms: "Telecoms Line",
}

function infraKind(tags, data) {
    if (tags.power) return INFRA_TYPE_LABELS[tags.power] || "Power infrastructure"
    if (tags.man_made === "pipeline") return "Pipeline"
    if (tags.telecom) return "Telecoms"
    return data.infra_type || data.type || "Infrastructure"
}

export function adaptInfrastructure(data = {}) {
    // Two real shapes flow into this adapter: a raw Overpass/OSM element
    // (tags/lat/lon/center, from the ad hoc infra click query) or a
    // normalized ontology infrastructure record (name/infra_type/lat/lon).
    const el = Array.isArray(data.elements) && data.elements.length ? data.elements[0] : data
    const tags = el.tags || {}
    const kind = infraKind(tags, data)
    const name = tags.name || tags.ref || data.name || kind
    const lat = el.lat ?? el.center?.lat ?? data.lat
    const lon = el.lon ?? el.center?.lon ?? data.lon ?? data.lng
    const point = isFiniteNum(lat) && isFiniteNum(lon) ? { lat: Number(lat), lon: Number(lon) } : null

    const attributes = compact([
        attr("Name", name !== kind ? name : null),
        attr("Type", kind),
        attr("Location", point ? fmtCoord(point.lat, point.lon) : null),
        attr("Voltage", tags.voltage),
        attr("Operator", tags.operator || data.operator),
        attr("Cables", tags.cables),
        attr("Circuits", tags.circuits),
        attr("Ref", tags.ref),
    ])

    return {
        identity: {
            title: name || "Infrastructure",
            subtitle: kind || null,
            entityType: "facility",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── generic fallback (fusion, cable, eez, port, airport, chokepoint,
//    sentinel_detection, assessment, threat_region, and anything else) ─────────

const GENERIC_SKIP_KEYS = new Set(["name", "title", "headline", "entity_name"])

export function adaptGeneric(data = {}, entityType) {
    const title = data.name || data.title || data.headline || data.entity_name
        || data.region_name || data.zone_id || data.system_id || entityType || "Entity"
    const point = pointOf(data)

    const attributes = compact(
        Object.entries(data)
            .filter(([k, v]) => !GENERIC_SKIP_KEYS.has(k) && v !== null && v !== undefined && v !== ""
                && typeof v !== "object" && typeof v !== "function")
            .map(([k, v]) => attr(humanizeKey(k), String(v)))
    )

    return {
        identity: {
            title,
            subtitle: entityType || null,
            entityType: "generic",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: extractProvenance(data),
        actions: {
            canJumpToLocation: !!point,
        },
    }
}

// ── dispatch ───────────────────────────────────────────────────────────────────

const ADAPTERS = {
    vessel: adaptVessel,
    aircraft: adaptAircraft,
    alert: adaptAlert,
    zone: adaptZone,
    watch_zone: adaptZone,
    strategic_zone: adaptZone,
    news: adaptNews,
    event: adaptNews,
    infra: adaptInfrastructure,
    infrastructure: adaptInfrastructure,
}

/**
 * Normalize any raw entity payload for InspectorPanel. `entityType` is
 * whatever the caller's click handler already knows (mirrors GlobePopup.jsx's
 * `popup.type`). Anything not in ADAPTERS falls back to adaptGeneric — never
 * throws, never fabricates a field.
 */
export function normalizeEntity(entityType, data) {
    const key = (entityType || "").toLowerCase()
    const adapter = ADAPTERS[key]
    if (adapter) return adapter(data || {})
    return adaptGeneric(data || {}, entityType)
}
