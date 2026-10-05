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
import { extentOf } from "../utils/extent.js"
import { fmtWhen } from "../utils/formatTime.js"

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

// One date format for the whole panel (src/utils/formatTime.js). This was
// toLocaleString(), which printed American dates and gave day-precision
// records an invented midnight.
function fmtTimestamp(ts, opts) {
    return fmtWhen(ts, opts)
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
function ownershipAttrs(own) {
    if (!own) return []
    const o = own.owner
    if (!o) return own.reason ? [attr("Registered owner", own.reason)] : []
    const period = [o.since, o.until].filter(Boolean).join(" → ")
    return [
        attr("Registered owner", o.name),
        attr("Owner country", o.country),
        attr("Ownership on record", [period, o.source].filter(Boolean).join(" · ") || null),
    ]
}

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
        attr("ETA", data.eta ? `${fmtTimestamp(data.eta, { precision: "minute" })}${data.eta_stale ? " · not updated" : ""}` : null),
        attr("Status", data.nav_status),
        // How deep the hull sits. Against its usual value it says loaded or
        // in ballast — the cargo question, answered from the ship's own report.
        attr("Draught", isFiniteNum(data.draught) ? `${Number(data.draught).toFixed(1)} m` : null),
        attr("Dimensions", data.length ? `${data.length} m × ${data.beam || "?"} m` : null),
        // Only when it differs from heading by more than 10°: then the hull
        // is being set sideways by current or wind, which is the news.
        attr("Course over ground", isFiniteNum(data.cog) && isFiniteNum(hdg)
            && Math.abs(((Number(data.cog) - Number(hdg) + 540) % 360) - 180) > 10 ? fmtDeg(data.cog) : null),
        attr("Rate of turn", isFiniteNum(data.rot) && data.rot !== 0 ? `${data.rot > 0 ? "starboard" : "port"} ${Math.abs(data.rot)}` : null),
        attr("Sanctions", sanctions?.status ? `${sanctions.status} match${sanctions.vessel_name ? ` — ${sanctions.vessel_name}` : ""}` : null),
        // Flag -> registered owner -> owner's country (backend/vessel_owner.py).
        // A registered owner, not an operator; and when there is none, the
        // reason, because "no registry record" is a finding, not a blank.
        ...ownershipAttrs(data.ownership),
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

    const registration = data.registration || data.r || data.tail_number || null
    const callsign = (data.flight || data.callsign || "").trim() || null
    const icao = data.icao ?? data.icao24 ?? null
    const alt = data.alt_baro ?? data.altitude ?? data.baro_altitude
    const gs = data.gs ?? data.velocity ?? data.ground_speed
    const point = pointOf(data)

    const vr = Number(data.vertical_rate)
    const sel = Number(data.selected_altitude)
    const vertical = isFiniteNum(data.vertical_rate)
        ? (Math.abs(vr) < 200 ? "Level" : `${vr > 0 ? "Climbing" : "Descending"} ${Math.abs(vr).toLocaleString()} ft/min`)
            + (isFiniteNum(data.selected_altitude) ? ` → ${sel.toLocaleString()} ft selected` : "")
        : (isFiniteNum(data.selected_altitude) ? `${sel.toLocaleString()} ft selected` : null)
    const speeds = [
        isFiniteNum(data.ias) ? `IAS ${data.ias} kt` : null,
        isFiniteNum(data.tas) ? `TAS ${data.tas} kt` : null,
        isFiniteNum(data.mach) ? `M${Number(data.mach).toFixed(2)}` : null,
    ].filter(Boolean).join(" · ") || null
    const weather = [
        isFiniteNum(data.wind_dir) && isFiniteNum(data.wind_speed) ? `wind ${String(Math.round(data.wind_dir)).padStart(3, "0")}° ${data.wind_speed} kt` : null,
        isFiniteNum(data.outside_temp) ? `${data.outside_temp} °C` : null,
    ].filter(Boolean).join(" · ") || null
    // Same thresholds as backend/gps_interference.py: NIC < 7 or NACp < 8
    // is a receiver that cannot vouch for its own fix.
    const gps = (isFiniteNum(data.nic) || isFiniteNum(data.nac_p))
        ? ((isFiniteNum(data.nic) && data.nic < 7) || (isFiniteNum(data.nac_p) && data.nac_p < 8)
            ? `Degraded (NIC ${data.nic ?? "?"}, NACp ${data.nac_p ?? "?"})` : "Good")
        : null

    const attributes = compact([
        attr("Registration", registration),
        attr("Airline", data.airline || null),
        // The chain from the callsign (backend/airlines.py): this flight ->
        // its airline -> that airline's country and home base. Only present
        // when the designator is one whose attribution is certain.
        attr("Airline country", data.operator?.country || null),
        attr("Airline hub", data.operator?.hub || null),
        attr("Callsign", callsign),
        attr("ICAO24", icao),
        attr("Type", data.type_description || data.aircraft_type || data.type_designator || data.type || null),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
        attr("Heading", fmtDeg(data.track ?? data.heading)),
        attr("Speed", fmtUnit(gs, "kts", 0)),
        // "ground" IS the altitude. ADS-B reports the literal string for
        // an aircraft on the surface — 113 of 724 live aircraft in one
        // sample — and treating it as unparseable dropped the row
        // entirely, hiding a fact we actually knew for 16% of traffic.
        attr("Altitude", isFiniteNum(alt) ? `${Number(alt).toLocaleString()} ft`
            : (String(alt).trim().toLowerCase() === "ground" ? "On ground" : null)),
        attr("Vertical", vertical),
        attr("Airspeed", speeds),
        attr("Squawk", data.squawk ? `${data.squawk}${data.squawk_meaning ? ` — ${data.squawk_meaning}` : ""}` : null),
        attr("Emergency", data.emergency && data.emergency !== "none" ? data.emergency : null),
        attr("GPS fix", gps),
        attr("Position from", data.position_source
            ? `${data.position_source}${isFiniteNum(data.seen_pos) ? ` · ${Math.round(data.seen_pos)} s ago` : ""}` : null),
        attr("Privacy", data.privacy),
        attr("Conditions", weather),
        attr("Operator (registry)", data.owner_operator),
        attr("Built", data.year_built),
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
        // THE IMAGE IS thumbnail_url, NOT photo_url. Planespotters returns
        // photo_url as the HTML PAGE for the photo
        // (planespotters.net/photo/1951141/hb-jcn-swiss-...), which can never
        // load in an <img>. That is why aircraft photos rendered as a broken
        // image even once the ICAO24 lookup was fixed. The page URL is still
        // worth keeping — as a link, which is what it is.
        media: data.thumbnail_url ? {
            photoUrl: data.thumbnail_url,
            linkUrl: data.photo_url || null,
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
        const xs = extentOf(lons), ys = extentOf(lats)
        return `${xs.min.toFixed(2)}, ${ys.min.toFixed(2)} → `
            + `${xs.max.toFixed(2)}, ${ys.max.toFixed(2)}`
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
        const ys = extentOf(lats), xs = extentOf(lons)
        return { lat: (ys.min + ys.max) / 2, lon: (xs.min + xs.max) / 2 }
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

// ── GeoConfirmed conflict-event pin ──────────────────────────────────────────

export function adaptGeoConfirmed(data = {}) {
    const point = pointOf(data)
    // THE HEADLINE IS WHAT HAPPENED. `name` is GeoConfirmed's own label and
    // is nearly always just the date ("05 OCT 2026"), which made the
    // biggest line in the panel the least informative one. The record also
    // carries `title` — the event, composed with its country — and that is
    // the headline; the date moves to the subtitle with the place.
    const title = (data.title || "").trim()
        || (data.description ? data.description.slice(0, 140) : "")
        || data.name || "GeoConfirmed placemark"
    const sources = (data.original_source || "").split("\n").map((s) => s.trim()).filter(Boolean)
    const geoloc = (data.geolocation_source || "").split("\n").map((s) => s.trim()).filter(Boolean)
    // "8GRGC47C+67 Palanca, Moldova" -> "Palanca, Moldova"
    const place = String(data.plus_code || "").replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}\s*/i, "").trim() || null
    const when = data.date ? fmtTimestamp(data.date, { precision: data.date_precision === "day" ? "day" : undefined }) : null
    const theatre = data.theatre_slug ? humanizeKey(data.theatre_slug) : null

    const attributes = compact([
        attr("Faction", data.faction),
        attr("Theatre", theatre),
        attr("Location", place),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
        attr("ORBAT unit", data.orbat_unit_name),
        attr("Origin media", data.origin),
        attr("Original post", sources.join("\n") || null),
        attr("Geolocation", geoloc.join("\n") || null),
    ])

    // The description often IS the title (title is composed from it). Shown
    // only when it says more, so the panel does not print the event twice.
    const desc = (data.description || "").trim()
    const descAddsSomething = desc && !title.replace(/\s+—\s+[^—]+$/, "").includes(desc.replace(/\.$/, ""))

    return {
        identity: {
            title,
            subtitle: ["GeoConfirmed", place, when].filter(Boolean).join(" · "),
            entityType: "geoconfirmed",
            subtype: null,
            sanctionsStatus: null,
        },
        description: descAddsSomething ? desc : null,
        attributes,
        provenance: { feed: "GeoConfirmed", ingestedAt: null },
        actions: {
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
// Keys that are plumbing, not facts about the thing: identifiers, raw
// coordinates (shown once, formatted, as Position) and long prose (shown as
// the description). Listed raw, a chokepoint read "System Id CHOKE-007 /
// Lat 56 / Lon 10.5" above anything a reader wanted.
const GENERIC_PLUMBING = /^(id|uuid|system_id|.+_id|lat|lon|lng|latitude|longitude|polygon_bounds|strategic_description|description|summary)$/i
const DESCRIPTION_KEYS = ["description", "strategic_description", "summary"]

export function adaptGeneric(data = {}, entityType) {
    data = data || {}
    const title = data.name || data.title || data.headline || data.entity_name
        || data.region_name || data.zone_id || data.system_id || entityType || "Entity"
    const point = pointOf(data)

    const attributes = compact([
        ...Object.entries(data)
            .filter(([k, v]) => !GENERIC_SKIP_KEYS.has(k) && !GENERIC_PLUMBING.test(k)
                && v !== null && v !== undefined && v !== ""
                && typeof v !== "object" && typeof v !== "function")
            .map(([k, v]) => attr(humanizeKey(k), String(v))),
        attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
    ])
    const description = DESCRIPTION_KEYS.map((k) => data[k]).find((v) => typeof v === "string" && v.trim()) || null

    return {
        description,
        identity: {
            title,
            subtitle: entityType ? humanizeKey(entityType) : null,
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

/**
 * Ports and airports had NO adapter, so they fell through to adaptGeneric and
 * the inspector showed the bare word "port" or "airport" over an empty panel
 * — while the API had been returning the full record all along.
 */
function adaptAirport(data) {
    const name = data.airport_name || data.name || data.ident || "Airport"
    const codes = [data.icao_code, data.iata_code].filter(Boolean).join(" / ")
    const point = pointOf(data)
    return {
        identity: {
            title: name,
            subtitle: [codes, data.municipality, data.country_name].filter(Boolean).join(" · ") || null,
            kindLabel: (data.airport_type || "airport").replace(/_/g, " "),
        },
        attributes: [
            ["ICAO", data.icao_code], ["IATA", data.iata_code],
            ["Type", (data.airport_type || "").replace(/_/g, " ")],
            ["Municipality", data.municipality], ["Country", data.country_name],
            ["Elevation", data.elevation_ft != null ? `${data.elevation_ft} ft` : null],
            ["Identifier", data.ident], ["Record", data.system_id],
        ].filter(([, v]) => v != null && v !== "").map(([k, v]) => ({ label: k, value: String(v) })),
        provenance: extractProvenance(data),
        actions: { canJumpToLocation: !!point },
    }
}

function adaptPort(data) {
    const name = data.port_name || data.name || data.portname || "Port"
    return {
        identity: {
            title: name,
            subtitle: [data.locode || data.un_locode, data.country_name || data.country]
                .filter(Boolean).join(" · ") || null,
            kindLabel: data.harbor_type || data.port_type || "port",
        },
        attributes: [
            ["UN/LOCODE", data.locode || data.un_locode], ["Country", data.country_name || data.country],
            ["Harbour type", data.harbor_type], ["Harbour size", data.harbor_size],
            ["Max draught", data.max_draught != null ? `${data.max_draught} m` : null],
            ["Berths", data.berths], ["Record", data.system_id],
        ].filter(([, v]) => v != null && v !== "").map(([k, v]) => ({ label: k, value: String(v) })),
        provenance: extractProvenance(data),
        actions: { canJumpToLocation: !!pointOf(data) },
    }
}

// ── chokepoint ─────────────────────────────────────────────────────────────────
//
// Fell to adaptGeneric, which listed its system id, raw lat/lon, a keyword
// match count and the traffic sentence the "Traffic vs normal" section below
// already shows in full. What a reader wants first is what the strait is for
// and whether the news says anything about it.
function adaptChokepoint(data = {}) {
    const point = pointOf(data)
    const mentions = Number.isFinite(data.match_count) ? data.match_count : null
    return {
        identity: {
            title: data.name || "Chokepoint",
            subtitle: ["Chokepoint", data.traffic_verdict ? `traffic ${data.traffic_verdict}` : null]
                .filter(Boolean).join(" · "),
            entityType: "chokepoint", subtype: null, sanctionsStatus: null,
        },
        description: data.strategic_description || null,
        attributes: compact([
            attr("News (48h)", mentions == null ? null
                : mentions ? `${mentions} matching headline${mentions === 1 ? "" : "s"} · ${data.current_status || "normal"}`
                    : "No matching headlines"),
            attr("Position", point ? fmtCoord(point.lat, point.lon) : null),
        ]),
        provenance: extractProvenance(data),
        actions: { canJumpToLocation: !!point },
    }
}

// ── dispatch ───────────────────────────────────────────────────────────────────


// ── GDELT event ──────────────────────────────────────────────────────────
//
// Without an adapter this fell to adaptGeneric, which drops every value
// that is an object — and the whole payload lives under `meta`. The panel
// therefore showed a headline and a coordinate over nothing, which is the
// worst possible presentation for the one source on this map that most
// needs its caveats read.

export function adaptGdeltEvent(data = {}) {
    const m = data.meta || {}
    const point = pointOf(data)
    const types = Array.isArray(m.event_types) && m.event_types.length
        ? m.event_types.join(" / ") : m.event_type

    const attributes = compact([
        attr("Headline", data.name || m.title),
        attr("Coding", types),
        attr("Actors", m.actors),
        attr("Location", m.location_name),
        attr("Date", m.date ? fmtTimestamp(m.date) : null),
        attr("Mentions", m.mentions != null ? String(m.mentions) : null),
        // Goldstein is meaningless as a bare number to anyone who has not
        // read the codebook, so the scale is stated with it.
        attr("Goldstein", m.goldstein != null
            ? `${m.goldstein} (−10 force … +10 cooperation)` : null),
        attr("Article", m.source_url),
        // THE CAVEAT IS AN ATTRIBUTE, not a footnote. A GDELT coordinate is
        // a place NAMED IN THE ARTICLE that a machine matched to a gazetteer
        // — it is not where anyone confirmed anything happened.
        attr("Geolocation", "city named in the article, machine-matched — "
                          + "not a confirmed incident location"),
        attr("Confidence", "machine-coded from wire text; no human verified this"),
    ])

    return {
        identity: {
            title: data.name || m.title || "Wire report",
            subtitle: types || "machine-coded event",
            entityType: "gdelt_event",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: { feed: "Wire reports", ingestedAt: m.date || null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── thermal anomaly (FIRMS) ──────────────────────────────────────────────

export function adaptThermalAnomaly(data = {}) {
    const m = data.meta || {}
    const point = pointOf(data)

    const attributes = compact([
        attr("Instrument", [m.instrument, m.satellite].filter(Boolean).join(" · ") || null),
        attr("Acquired", m.acquired_at ? fmtTimestamp(m.acquired_at) : null),
        attr("Brightness", m.brightness_k != null ? `${m.brightness_k} K` : null),
        attr("Radiative power", m.frp_mw != null ? `${m.frp_mw} MW` : null),
        attr("Detection confidence", m.confidence),
        attr("Location", point ? fmtCoord(point.lat, point.lon) : null),
        // Whether it was acted on. "Seen and judged not worth a scan" is a
        // different record from "never seen", and the reader cannot tell
        // them apart unless the panel says which.
        attr("Imagery", m.triggered_scan
            ? `tasked a scan in ${m.zone || "a watch zone"}`
            : "not in a watch zone — no scan tasked"),
        // WHY THIS IS NOT CALLED A FIRE. The instrument measured a
        // temperature; a gas flare, burning stubble and a munitions strike
        // are identical to it.
        attr("What this is", "a thermal anomaly — a gas flare, burning stubble "
                           + "and a strike look identical to the instrument"),
    ])

    return {
        identity: {
            title: data.name || "Thermal anomaly",
            subtitle: m.instrument || "VIIRS",
            entityType: "thermal_anomaly",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: { feed: m.source || "NASA FIRMS", ingestedAt: m.acquired_at || null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── a record a fusion point was built from ───────────────────────────────
//
// The far end of one of the dashed threads. These had no id and no store
// entry at all, so clicking one did nothing whatsoever — the reported
// "random dots with no explanations". WHY IT IS LINKED is the first thing
// the panel says, because that is the question the line provokes.

export function adaptFusionMember(data = {}) {
    const m = data.meta || {}
    const point = pointOf(data)
    const attributes = compact([
        attr("Why it is linked", m.why_linked),
        attr("Part of", m.belongs_to),
        attr("Modality", m.modality),
        attr("Observed", m.observed_at ? fmtTimestamp(m.observed_at) : null),
        attr("Place", m.place || (point ? fmtCoord(point.lat, point.lon) : null)),
        attr("Source reference", m.reference),
    ])
    return {
        identity: {
            title: data.name || "Contributing record",
            subtitle: m.modality || null,
            entityType: "fusion_member",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: { feed: m.modality || null, ingestedAt: m.observed_at || null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── country risk index ───────────────────────────────────────────────────
//
// Registered by the choropleth with its full decomposition and never
// routable, so clicking a shaded country did nothing at all. The score is
// the least useful thing in the payload: "Afghanistan 70" is unarguable
// and unactionable. WHAT MADE IT 70, and HOW MUCH EVIDENCE IS UNDER IT,
// are the two things a reader needs, and both are already computed.

const RISK_COMPONENT_LABEL = {
    vol:  "Event volume vs baseline",
    tone: "Media tone",
    gold: "Conflictual coding (Goldstein)",
    conf: "Confirmed incidents",
}

export function adaptCountryRisk(data = {}) {
    const contrib = data.contributions || {}
    const comps = data.components || {}
    const point = pointOf(data)

    // Descending, because the question is "what is driving this".
    const ranked = Object.entries(contrib)
        .filter(([, v]) => typeof v === "number")
        .sort((a, b) => b[1] - a[1])

    // How much observation the score rests on. A band-4 country scored
    // from two wire stories is a different claim from one scored from
    // six hundred, and the number is right here in the payload.
    const counts = Object.values(comps)
        .map(c => c && (c.n_events ?? c.recent_count ?? c.count))
        .filter(n => typeof n === "number")
    const evidence = counts.length ? counts.reduce((m, c) => (c > m ? c : m), -Infinity) : null

    const attributes = compact([
        attr("Risk score", data.score != null
            ? `${data.score} (band ${data.band ?? "—"} of 5)` : null),
        attr("Window", data.window_days ? `${data.window_days} days` : null),
        ...ranked.map(([k, v]) =>
            attr(RISK_COMPONENT_LABEL[k] || humanizeKey(k),
                 `${v} of ${data.score ?? "?"} points`)),
        attr("Observations behind it", evidence != null
            ? `${evidence} event(s) in the window` : null),
        // Said plainly rather than left for the reader to work out from a
        // count they would have to go looking for.
        evidence != null && evidence < 10
            ? attr("Caution", `this score rests on ${evidence} observation(s) — `
                            + "treat the band as a prompt to look, not a finding")
            : null,
    ])

    return {
        identity: {
            title: data.name || data.country || data.iso3 || "Country risk",
            subtitle: data.band != null ? `band ${data.band}` : null,
            entityType: "country_risk",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes,
        provenance: { feed: "Parallax risk index (wire reports + confirmed incidents)",
                      ingestedAt: null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── territorial control ──────────────────────────────────────────────────

export function adaptFrontline(data = {}) {
    const m = data.meta || {}
    return {
        identity: {
            title: data.name || "Control area",
            subtitle: m.theatre || null,
            entityType: "frontline",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes: compact([
            attr("Status", m.what_it_means || m.status),
            // Which map this is. A reader scrubbed back three years is
            // looking at a historical front and must not read it as now.
            attr("Viewing", m.viewing),
            attr("Assessed", m.drawn_at ? fmtTimestamp(m.drawn_at) : null),
            attr("Freshness", m.freshness),
            // The coverage limit travels with every single area, because a
            // reader who sees Ukraine mapped will reasonably assume the
            // layer is global and read an empty Sudan as a quiet Sudan.
            attr("Coverage", m.coverage),
            attr("Source", m.source),
        ]),
        provenance: { feed: m.source || "DeepStateMap", ingestedAt: m.drawn_at || null },
        actions: { canJumpToLocation: false },
    }
}

// ── a surge, and what it is a surge OF ───────────────────────────────────
//
// Reported: "the surge point should show what did it even surge about???
// what topic, how much increase?" The payload always carried the category,
// the count, the expected count from this cell's own 90-day baseline and a
// Poisson p — the mark just showed "SURGE · 5".

const SURGE_CATEGORY = {
    conflict: "Conflict / strike", equipment: "Equipment loss",
    infrastructure: "Infrastructure", maritime: "Maritime",
    air: "Air activity", orbat: "Unit / ORBAT", civil: "Civil / protest",
}

export function adaptSurge(data = {}) {
    const point = pointOf(data)
    const mult = Number(data.mult)
    const topic = SURGE_CATEGORY[data.cat] || data.cat || "activity"
    return {
        identity: {
            title: `${topic} surging around ${data.place || "this cell"}`,
            subtitle: Number.isFinite(mult) ? `${mult.toFixed(1)}x normal` : null,
            entityType: "surge",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes: compact([
            attr("What surged", topic),
            attr("How much", Number.isFinite(mult)
                ? `${data.n} in ${Math.round(data.window_days ?? 7)} days, `
                  + `against ${Number(data.expected ?? 0).toFixed(1)} expected `
                  + `— ${mult.toFixed(1)}x` : null),
            attr("Baseline", data.baseline_days
                ? `this cell's own previous ${Math.round(data.baseline_days)} days` : null),
            attr("Chance of coincidence", data.p != null
                ? `${Number(data.p).toExponential(1)} (Poisson)` : null),
            attr("Where", data.place || (point ? fmtCoord(point.lat, point.lon) : null)),
            // THE CAVEAT IS THE POINT. A surge is a change in how much is
            // being REPORTED, which is not the same as a change on the
            // ground — coverage follows attention.
            attr("What this is not", "a change in reporting volume, not a "
                + "confirmed change on the ground"),
        ]),
        provenance: { feed: "Horizon-Watch surge detection", ingestedAt: null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── a control point from a community war map ────────────────────────────

export function adaptWarmapArea(data = {}) {
    const m = data.meta || {}
    const point = pointOf(data)
    return {
        identity: {
            title: data.name || "Control point",
            subtitle: m.held_by || null,
            entityType: "warmap_area",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes: compact([
            attr("Held by", m.held_by),
            attr("Theatre", m.theatre),
            // Which map this is. A front from 2016 drawn in today's
            // colours is otherwise indistinguishable from now.
            attr("Viewing", m.viewing),
            // Stated before anything else about the shape, because a
            // derived boundary looks identical to a surveyed one.
            attr("Boundary", m.boundary),
            attr("Map last edited", m.last_edited ? fmtTimestamp(m.last_edited) : null),
            // WHO SAYS SO is the first thing a reader needs here. This is
            // not a sensor reading or a verified geolocation; it is an
            // editor's assertion on a page anyone can change.
            attr("Basis", m.basis),
            attr("Caveat", m.caveat),
            attr("Source", m.source_url),
        ]),
        provenance: { feed: m.source || "Wikipedia war map", ingestedAt: m.last_edited || null },
        actions: { canJumpToLocation: !!point },
    }
}

// ── a mapped facility ────────────────────────────────────────────────────

export function adaptFacilityOsm(data = {}) {
    const m = data.meta || {}
    const point = pointOf(data)
    return {
        identity: {
            title: data.name || "Facility",
            subtitle: m.kind || m.category || null,
            entityType: "facility_osm",
            subtype: null,
            sanctionsStatus: null,
        },
        attributes: compact([
            attr("Type", m.kind),
            attr("Category", m.category),
            attr("Operator", m.operator),
            attr("Inside zone", m.zone),
            attr("Location", point ? fmtCoord(point.lat, point.lon) : null),
            m.named === false
                ? attr("Name", "not mapped — labelled by type") : null,
            // THE ABSENCE CAVEAT, which matters more here than the
            // presence one: a planner reading an empty area as "no
            // medical capacity" would be badly wrong.
            attr("Completeness", "OpenStreetMap, crowd-mapped — a missing "
                + "facility means nobody mapped it, not that none exists"),
            attr("Source", m.source_url),
        ]),
        provenance: { feed: m.source || "OpenStreetMap", ingestedAt: null },
        actions: { canJumpToLocation: !!point },
    }
}


// ── GPS / navigation interference cell ───────────────────────────────────
/**
 * A clicked interference tile has to explain itself, because the number on
 * it is easy to misread in three specific ways.
 *
 * It is a RATE, so it needs its denominator: 80% of five aircraft and 80%
 * of four hundred are different claims. It describes a NEIGHBOURHOOD wider
 * than the square drawn, so the square is not a boundary. And it cannot
 * distinguish jamming from spoofing, or name who is responsible — an
 * aircraft that has been successfully spoofed reports a healthy fix for a
 * position that is wrong, and this method cannot see that at all.
 *
 * All three go in the panel rather than in a doc nobody opens.
 */
export function adaptGpsInterference(data = {}) {
    const pct = isFiniteNum(data.pct) ? data.pct : null
    const total = isFiniteNum(data.aircraft) ? data.aircraft : null
    const bad = isFiniteNum(data.degraded) ? data.degraded : null
    const level = (data.level || "clear").toLowerCase()

    const verdict = level === "severe" ? "Severe interference"
                  : level === "degraded" ? "Degraded"
                  : "No interference detected"

    const reading = (bad != null && total != null)
        ? `${bad} of ${total} aircraft could not hold a satellite fix`
          + (pct != null ? ` (${pct}%)` : "")
        : null

    const attributes = compact([
        attr("Reading", reading),
        attr("Assessment", verdict),
        attr("Aircraft sampled", total != null ? String(total) : null),
        attr("Without a fix", bad != null ? String(bad) : null),
        attr("Position", fmtCoord(data.lat, data.lon)),
        attr("Tile", isFiniteNum(data.cell_deg) ? `${data.cell_deg}°` : null),
        attr("Measured over", isFiniteNum(data.radius_deg)
            ? `${data.radius_deg}° around this tile — the square is where it is drawn, not the edge of the effect`
            : null),
        attr("Last aircraft seen", fmtTimestamp(data.last_seen)),
        attr("How this is measured",
            "Aircraft broadcast their own navigation integrity (NIC/NACp). One "
            + "reporting no usable containment radius has lost GNSS. Only aircraft "
            + "above 10,000 ft are counted, because below that a poor reading says "
            + "more about the avionics than about the sky."),
        attr("What it cannot tell you",
            "Jamming and spoofing are not separated, and nothing here names a "
            + "source. An aircraft successfully spoofed may report a healthy fix "
            + "for a position that is wrong, which this method cannot see."),
    ])

    return {
        identity: {
            title: verdict,
            subtitle: reading || "Navigation interference",
            entityType: "gps_interference",
            subtype: level,
            sanctionsStatus: null,
        },
        attributes,
        provenance: {
            feed: "Aircraft-reported navigation integrity",
            ingestedAt: data.last_seen || null,
        },
        actions: { canJumpToLocation: isFiniteNum(data.lat) && isFiniteNum(data.lon) },
    }
}


// ── Vessel-activity detection (encounter, AIS gap, loitering, port visit) ─
/**
 * These detections fell through to adaptGeneric, which drops any value that
 * is an object — and everything worth reading about them lives under `meta`.
 * So a click on an encounter, an AIS gap or a loitering event showed a title
 * and a coordinate, and the one question they exist to answer — WHICH SHIPS,
 * and where are they now — could not be asked at all.
 *
 * The vessels come through as rows rather than as a pre-joined sentence, so
 * the panel can offer each one as something to look up. Where a vessel is
 * NOW is deliberately not fetched here: this adapter is synchronous and must
 * not make the inspector wait on the network. It hands the panel the MMSI
 * and the position at detection, which is what a "where is it now" lookup
 * needs, and the panel can resolve it when the reader asks.
 */
export function adaptGfwEvent(data = {}) {
    const m = data.meta || {}
    const vessels = Array.isArray(m.vessel_list) ? m.vessel_list : []

    const attributes = compact([
        attr("Detection", m.event || null),
        attr("When", fmtTimestamp(m.when)),
        attr("Ended", fmtTimestamp(m.end)),
        attr("Age", m.age || null),
        attr("Where it happened", fmtCoord(m.detected_lat, m.detected_lon)),
        attr("Vessels involved", vessels.length ? String(vessels.length) : null),
        ...vessels.map((v, i) => attr(
            `Vessel ${i + 1}`,
            compact([v.name, v.mmsi ? `MMSI ${v.mmsi}` : null, v.flag, v.type]).join(" · ")
                || "unidentified")),
        attr("Encounter type", m.encounter_type || null),
        attr("Median separation", fmtUnit(m.median_distance_km, "km")),
        attr("Distance from shore", fmtUnit(m.km_from_shore, "km")),
        attr("High seas", m.high_seas === true ? "yes" : m.high_seas === false ? "no" : null),
        // The supplier's own assessment stays labelled as theirs, never
        // restated as this system's finding.
        attr("Supplier risk flag", m.gfw_potential_risk === true ? "flagged by the supplier" : null),
        attr("Freshness", m.freshness || null),
        attr("What this is",
            "A detection derived from vessel transponder tracks. The position "
            + "is where the behaviour was observed, not where the vessels are "
            + "now — this feed publishes days behind."),
    ])

    return {
        identity: {
            title: data.name || m.event || "Vessel activity",
            subtitle: vessels.length
                ? vessels.map((v) => v.name || v.mmsi || "unidentified").join(" · ")
                : (m.event || null),
            entityType: "gfw_event",
            subtype: m.event || null,
            sanctionsStatus: null,
        },
        attributes,
        // Handed through so the panel can offer a live lookup per vessel.
        vessels: vessels.filter((v) => v.mmsi),
        provenance: { feed: m.source || null, ingestedAt: m.when || null },
        actions: {
            canJumpToLocation: isFiniteNum(m.detected_lat) && isFiniteNum(m.detected_lon),
        },
    }
}

const ADAPTERS = {
    vessel: adaptVessel,
    aircraft: adaptAircraft,
    alert: adaptAlert,
    zone: adaptZone,
    watch_zone: adaptZone,
    strategic_zone: adaptZone,
    news: adaptNews,
    event: adaptNews,
    geoconfirmed: adaptGeoConfirmed,
    infra: adaptInfrastructure,
    infrastructure: adaptInfrastructure,
    airport: adaptAirport,
    port: adaptPort,
    gdelt_event: adaptGdeltEvent,
    thermal_anomaly: adaptThermalAnomaly,
    fusion_member: adaptFusionMember,
    country_risk: adaptCountryRisk,
    frontline: adaptFrontline,
    surge: adaptSurge,
    warmap_area: adaptWarmapArea,
    facility_osm: adaptFacilityOsm,
    gps_interference: adaptGpsInterference,
    gfw_event: adaptGfwEvent,
    chokepoint: adaptChokepoint,
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
