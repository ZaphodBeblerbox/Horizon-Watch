/**
 * entityIcons.js — real entity markers for the Cesium globe, replacing
 * markerRenderer.js's MIL-STD-2525-style affiliation-frame system (diamond/
 * square/circle Unknown/Neutral/Hostile/Suspect/Friendly shapes). The full
 * UI rebuild spec (section 2) explicitly cancels that system: "Do not build
 * affiliation-frame geometry... distinguish entity sub-type with a small
 * consistent-style corner badge or a distinct glyph variant within this same
 * thin-outline family — never by switching icon styles."
 *
 * Design decision, made explicitly rather than silently: the old affiliation
 * system carried one piece of REAL signal the new spec doesn't directly
 * address — a vessel's real sanctions-corroboration status (confirmed vs.
 * possible, from backend/sanctions_loader.py via resolveAlertAffiliation).
 * That's real data; dropping it silently would be a real functionality
 * regression the "no fake data" rule cuts the other way on too (real signal
 * shouldn't be thrown away either). It's preserved here as a colored status
 * ring using the spec's own --danger/--warn tokens (confirmed/possible) —
 * color, not frame shape — which fully complies with "no affiliation-frame
 * geometry" while not silently discarding a real, working backend signal.
 *
 * Every glyph reuses the exact same lucide-react icons as src/ui/Icon.jsx
 * (rendered to a real SVG string via react-dom/server, not hand-drawn path
 * data) so the on-globe markers and the UI chrome icons are visually
 * identical, not a second icon language.
 */
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { Ship, Plane, Building2, MapPin, Newspaper, TriangleAlert, Target, Sparkles, Crosshair } from "lucide-react"

export const ENTITY_ICON_COMPONENT = {
    vessel: Ship,
    aircraft: Plane,
    facility: Building2,
    poi: MapPin,
    news_event: Newspaper,
    alert: TriangleAlert,
    zone: Target,
    // GeoConfirmed conflict-event pins — real, individually geolocated/
    // verified incidents (see GlobeGeoConfirmedLayer.jsx). Deliberately NOT
    // the shared news diamond (getNewsMarkerDataUri) below: these replace
    // the raw, imprecisely-geocoded RSS points that diamond represents, and
    // reusing the same shape would visually re-conflate the two.
    geoconfirmed: Crosshair,
    // "fusion" is a real, still-used entity kind (backend /api/fusions
    // multi-domain correlated intelligence events — see GlobeAlertsLayer.jsx's
    // fusionIcon() — plus DirectorBar's own logo mark and ForceGraph's
    // fusion_event graph nodes). markerRenderer.js gave it a bespoke
    // spark/cross glyph; the new outline set has no dedicated symbol, so this
    // reuses the same Sparkles glyph Icon.jsx's "aiCouncil" UI-chrome icon
    // already uses for "AI-synthesized insight" — a real, already-established
    // meaning in this codebase, not an invented one.
    fusion: Sparkles,
    generic: MapPin,
}

// Corner-badge colors — real sub-type distinction, never a shape/frame
// change (spec section 2). Tokens match index.html's :root real values
// directly (this module has no CSS custom-property access — Cesium
// billboards are rendered outside the DOM's cascade).
const OVERLAY_BLUE   = "#3D8BFF"
const OVERLAY_GREEN  = "#3DDC97"
const OVERLAY_YELLOW = "#E8C547"
const OVERLAY_PURPLE = "#C084FC"
const TRACK_PURPLE   = "#8B7CFF"
const TEXT_MUTED     = "#6B7A90"
const DANGER = "#EF4444"
const WARN   = "#F5A524"

export const VESSEL_SUBTYPE_BADGE = {
    tanker: OVERLAY_YELLOW,
    cargo: OVERLAY_BLUE,
    container: OVERLAY_BLUE,
    military: OVERLAY_PURPLE,
    passenger: TRACK_PURPLE,
    fishing: OVERLAY_GREEN,
}

export const AIRCRAFT_SUBTYPE_BADGE = {
    military: OVERLAY_PURPLE,
    helicopter: TRACK_PURPLE,
    commercial: OVERLAY_BLUE,
    general: TEXT_MUTED,
}

/**
 * Real sanctions-corroboration status for an alert-shaped record — the
 * exact same field logic markerRenderer.js's resolveAlertAffiliation() used
 * (checked field names: top-level sanctions_hit/sanctions_hit_confirmed,
 * is_sanctions_confirmed, is_sanctions_related, and their `payload.*`
 * nested equivalents — all 3 real call sites: sanctions_loader.py's
 * check_sanctions_for_vessel(), detectors/correlation_engine.py, and
 * main.py's STS-pair path). Dropped, deliberately: the old system's
 * Unknown/Neutral distinction for non-sanctions alerts (dark-ship/unknown-
 * contact vs. clean) — that was about baseline identity completeness for
 * an affiliation FRAME, which no longer exists; with no frame to color,
 * "no real sanctions signal" is just "no ring," full stop.
 */
export function resolveSanctionsStatus(a) {
    if (!a) return null
    const cat = (a.alert_category || a.alert_type || a.rule_name || a.rule_id || "").toLowerCase()
    const isSanctionRule = cat.includes("sanction")
    const isStsRule = cat.includes("ship-to-ship") || cat.includes("sts")
    const payload = a.payload || {}
    const confirmedFlag =
        a.sanctions_hit_confirmed ?? a.is_sanctions_confirmed ??
        payload.sanctions_hit_confirmed ?? payload.is_sanctions_confirmed ?? null
    const relatedFlag =
        a.sanctions_hit === true || a.is_sanctions_related === true ||
        payload.sanctions_hit === true || payload.is_sanctions_related === true ||
        isSanctionRule
    if (relatedFlag) return confirmedFlag === false ? "possible" : "confirmed"
    if (isStsRule) return "possible"
    return null
}

/**
 * Real sanctions-corroboration status -> ring color. Returns null (no ring)
 * for a clean/unknown entity — never fabricates a status that isn't there.
 */
export function statusRingColor(sanctionsStatus) {
    if (sanctionsStatus === "confirmed") return DANGER
    if (sanctionsStatus === "possible") return WARN
    return null
}

function badgeColorFor(entityType, subtype) {
    if (entityType === "vessel") return VESSEL_SUBTYPE_BADGE[subtype] || null
    if (entityType === "aircraft") return AIRCRAFT_SUBTYPE_BADGE[subtype] || null
    return null
}

/**
 * Builds a complete, real SVG markup string for one entity marker: an
 * optional status ring, the base outline glyph (the exact same lucide icon
 * used in UI chrome), and an optional small corner badge for sub-type.
 * Suitable to pass directly as a Cesium billboard's `image` (a string URL/
 * data-URI) — Cesium loads it asynchronously itself, same pattern
 * markerRenderer.js's markerSvg() already used for non-Cesium UI.
 */
export function entityMarkerSvg({
    entityType = "generic", subtype = null, sanctionsStatus = null,
    size = 32, color = "#E8EEF7", pulse = false,
} = {}) {
    const Cmp = ENTITY_ICON_COMPONENT[entityType] || ENTITY_ICON_COMPONENT.generic
    const iconSize = Math.round(size * 0.56)
    const iconMarkup = renderToStaticMarkup(createElement(Cmp, { size: iconSize, color, strokeWidth: 1.5 }))
    const iconOffset = (size - iconSize) / 2

    const ring = statusRingColor(sanctionsStatus)
    const ringEl = ring
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1.5}" fill="none" stroke="${ring}" stroke-width="2"/>`
        : ""

    // Real, still-used visual emphasis carried over from markerRenderer.js's
    // drawMarker() `pulse` flag (a static translucent halo ring, not an
    // animated one — same as before) for higher-severity fusion events
    // (GlobeAlertsLayer.jsx) and the selected marker on NewsMiniMap. Drawn in
    // the marker's own `color` rather than a fabricated affiliation color,
    // and only when there's no status ring already occupying that space (a
    // ring already conveys "real signal here" on its own).
    const pulseEl = (pulse && !ring)
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" fill="none" stroke="${color}55" stroke-width="2"/>`
        : ""

    const badge = badgeColorFor(entityType, subtype)
    const badgeR = Math.max(3, size * 0.12)
    const badgeCx = size - badgeR - 1
    const badgeCy = badgeR + 1
    const badgeEl = badge
        ? `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${badge}" stroke="#070B14" stroke-width="1"/>`
        : ""

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + pulseEl
        + ringEl
        + `<g transform="translate(${iconOffset}, ${iconOffset})">${iconMarkup}</g>`
        + badgeEl
        + `</svg>`
}

/** data: URI wrapper — ready to assign directly to a Cesium billboard's `image`. */
export function entityMarkerDataUri(opts) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entityMarkerSvg(opts))}`
}

const _cache = new Map()
/** Cached wrapper — key includes every option that changes the pixels. */
export function getEntityMarkerDataUri(opts = {}) {
    const key = JSON.stringify([
        opts.entityType, opts.subtype, opts.sanctionsStatus,
        opts.size ?? 32, opts.color ?? "", !!opts.pulse,
    ])
    if (_cache.has(key)) return _cache.get(key)
    const uri = entityMarkerDataUri(opts)
    _cache.set(key, uri)
    return uri
}

// ── News markers — solid diamond, one fixed size ──────────────────────────────
// Design update: every news-derived marker (raw news/events in
// GlobeEventsLayer.jsx, and Forge NEWS-domain assessment alerts in
// GlobeAlertsLayer.jsx) now renders as one solid diamond at one fixed size,
// replacing the previous mix of a Newspaper lucide icon (events) and the
// generic TriangleAlert glyph (assessments) at several different tier/
// severity-scaled sizes. Colour still varies by real article/assessment
// type (unchanged); only shape and size are now uniform. A hand-drawn shape
// rather than a lucide icon, same precedent as vesselAircraftGlyphs.js's
// purpose-drawn hull/airframe silhouettes.
export const NEWS_MARKER_SIZE = 30

function newsDiamondSvg(color, size) {
    const cx = size / 2, cy = size / 2, r = size * 0.42
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + `<path d="M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z" `
        + `fill="${color}" stroke="#070B14" stroke-width="1"/>`
        + `</svg>`
}

const _newsCache = new Map()
export function getNewsMarkerDataUri({ color = TEXT_MUTED } = {}) {
    const key = `news:${color}`
    if (_newsCache.has(key)) return _newsCache.get(key)
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(newsDiamondSvg(color, NEWS_MARKER_SIZE))}`
    _newsCache.set(key, uri)
    return uri
}

// ── GeoConfirmed markers — real color-coded dot per faction/side ─────────────
// GeoConfirmed's own live map renders conflict-event pins as color-coded
// dots by faction (confirmed live 2026-09 via their real bulk placemark API,
// GET /api/Placemark/{theatre} -> [{name, color, invertColor, icons:[...]}]
// — a real per-theatre faction->color field, not a universal palette: the
// same hex denotes a different real side in a different theatre). This
// reproduces that real convention faithfully as a bespoke hand-drawn shape
// (same precedent as newsDiamondSvg above, not the shared outline-glyph
// family ENTITY_ICON_COMPONENT uses for other entity types — a plain dot is
// GeoConfirmed's own real visual language here, not a shape this app invented).
//
// `invertColor` reasoning (stated explicitly — GeoConfirmed's API exposes
// this boolean but not its own pixel-level rendering logic): applied here as
// a light-fill/colored-stroke swap, since GeoConfirmed uses it on very pale
// colors (e.g. a near-white yellow) that would be nearly invisible as a
// solid fill against a map background. Never fabricated new colors — only
// a rendering-mode choice for genuinely-real GeoConfirmed color values.
const GEOCONFIRMED_DOT_FALLBACK = "#E8C547" // pre-existing color, used only when this placemark has no real faction_color yet
export const GEOCONFIRMED_MARKER_SIZE = 22

function geoconfirmedDotSvg(color, size, invert) {
    const cx = size / 2, cy = size / 2, r = size * 0.36
    const fill = invert ? "#0B0F1A" : color
    const stroke = invert ? color : "#070B14"
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
        + `</svg>`
}

const _geoconfirmedCache = new Map()
export function getGeoConfirmedMarkerDataUri({ color, invertColor = false, size = GEOCONFIRMED_MARKER_SIZE } = {}) {
    const realColor = color || GEOCONFIRMED_DOT_FALLBACK
    const key = `geoconfirmed:${realColor}:${invertColor}:${size}`
    if (_geoconfirmedCache.has(key)) return _geoconfirmedCache.get(key)
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(geoconfirmedDotSvg(realColor, size, invertColor))}`
    _geoconfirmedCache.set(key, uri)
    return uri
}

// ── ForceGraph (forge entity graph) support ───────────────────────────────────
// Maps a canonical graph node type (ForceGraph.jsx's canonType()) to this
// module's real {entityType} identity — replaces markerRenderer.js's
// graphNodeSymbol()/graphNodeColor(). Every node here maps onto a real,
// already-established entityType bucket used elsewhere in this module
// (vessel/aircraft/alert/news_event/facility/zone/fusion/generic) — no new
// glyph vocabulary invented for the graph specifically.
//
// Deliberately NOT reproducing the old Neutral (green) vs Unknown (yellow)
// affiliation-frame color pair for "recognized vs unrecognized node type":
// that distinction never carried a real threat/identity signal (the graph
// shows ontology structure, not live assessment — see markerRenderer.js's own
// comment on GRAPH_NODE_SYMBOL), and the rebuild spec explicitly retires
// affiliation-style color coding. The generic glyph shape itself already
// signals "unrecognized type" on its own; GRAPH_UNKNOWN_COLOR just mutes it
// rather than inventing a fabricated status color.
const GRAPH_NODE_ENTITY = {
    vessel:         "vessel",
    aircraft:       "aircraft",
    alert:          "alert",
    surge:          "alert",
    // Real backend fusion events — see the `fusion` entry in
    // ENTITY_ICON_COMPONENT above.
    fusion_event:   "fusion",
    // News-derived pattern assessments (ALERT_ICONS-keyed) — real, distinct
    // from raw AIS/ADSB alerts, so they get the news glyph rather than the
    // generic alert triangle (mirrors src/inspector/adapters.js's own
    // domain-based split for real alert records).
    assessment:     "news_event",
    // Real maritime/aviation/cable infrastructure — collapsed to the single
    // shared "facility" glyph, matching the precedent already set by
    // src/inspector/adapters.js's adaptInfrastructure() for the exact same
    // real distinction (port/airport/cable/pipeline/substation/etc. all
    // resolve to entityType "facility" there too).
    port:           "facility",
    airport:        "facility",
    cable:          "facility",
    watch_zone:     "zone",
    strategic_zone: "zone",
    rule:           "generic",
}

const GRAPH_KNOWN_COLOR   = "#E8EEF7" // recognized node type — standard glyph tone
const GRAPH_UNKNOWN_COLOR = TEXT_MUTED // unrecognized type — muted, not a fabricated warning color

export function graphNodeIcon(canonType) {
    const entityType = GRAPH_NODE_ENTITY[canonType]
    return { entityType: entityType || "generic", color: entityType ? GRAPH_KNOWN_COLOR : GRAPH_UNKNOWN_COLOR }
}

const _graphIconImageCache = new Map()

/**
 * Synchronous per-frame canvas draw for ForceGraph.jsx's force-directed
 * simulation loop. ForceGraph redraws every visible node on every animation
 * frame directly into a live 2D context — structurally different from every
 * other consumer here, which hands Cesium a one-shot billboard `image`
 * string/canvas built once and cached. Calling entityMarkerSvg() (which
 * renders real React/lucide markup via renderToStaticMarkup()) 150 times ×
 * 60fps would be real, avoidable work, and Path2D can't rasterize an SVG
 * string synchronously either.
 *
 * So instead: reuse the exact same real entityMarkerSvg() glyph (never a
 * second hand-drawn icon language), pre-rendered to a real <img> exactly
 * once per (entityType, color, size) combination — decoding an <img> is
 * asynchronous, so the very first frame for a given combination draws a
 * plain placeholder circle in the node's real color, then every subsequent
 * frame (milliseconds later, once the image decodes) draws the real cached
 * glyph bitmap. Same cache-once-blit-forever technique
 * getEntityMarkerDataUri() already uses for Cesium billboards.
 */
export function drawGraphNode(ctx, cx, cy, r, canonType) {
    const { entityType, color } = graphNodeIcon(canonType)
    const size = Math.max(8, Math.round(r * 2.2))
    const key = `${entityType}|${color}|${size}`
    let img = _graphIconImageCache.get(key)
    if (!img) {
        img = new Image()
        img.decoding = "async"
        img.src = entityMarkerDataUri({ entityType, color, size })
        _graphIconImageCache.set(key, img)
    }
    if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size)
    } else {
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2)
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()
    }
}
