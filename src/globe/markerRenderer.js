/**
 * markerRenderer.js — Single source of truth for ALL globe/graph/UI markers.
 *
 * Real MIL-STD-2525/APP-6 inspired symbology, built from two independent,
 * composable axes:
 *
 *   1. AFFILIATION — who/what this contact is, drawn as the marker's FRAME:
 *        unknown  — incomplete (dashed/partial-outline) diamond
 *        neutral  — square
 *        hostile  — complete (solid) diamond
 *        suspect  — dashed diamond, distinct warning-tier color (see below)
 *        friendly — circle
 *
 *   2. ENTITY FUNCTION — what kind of thing it is, drawn as the interior
 *      GLYPH inside that frame (vessel sub-type, aircraft class, news/event,
 *      infrastructure, zone/AOI, fusion, generic).
 *
 * This replaces FOUR previously-disconnected icon systems (natoIcons.js,
 * iconUtils.js's ad hoc canvas builders, alertIcons.js's dead Lucide `icon`
 * field, and GlobalSearch.jsx's emoji table) with one real, tested module.
 *
 * ── Suspect affiliation — design decision (read before changing colors) ──
 * Real MIL-STD-2525/APP-6 doctrine is genuinely ambiguous here: Suspect is
 * usually rendered in the SAME diamond family as Hostile, sometimes in the
 * same solid red, sometimes with a dashed/incomplete outline to mirror how
 * Unknown differs from a fully-resolved affiliation. We deliberately chose
 * the dashed-outline treatment AND a distinct warning-tier color (amber,
 * `--sev-high`) rather than solid hostile red. Reasoning: this product's
 * Suspect affiliation is wired directly to a real backend "confirmed vs.
 * possible" corroboration signal (see resolveAlertAffiliation below) — a
 * flag-mismatched sanctions hit that a human analyst still needs to review.
 * Rendering that identically to a confirmed-hostile contact would train
 * analysts to react to Suspect exactly like Hostile, defeating the entire
 * point of the backend having a separate "possible" tier. Amber + dashed
 * reads unambiguously as "flagged for review," not "confirmed adverse."
 *
 * ── Why hex literals, not var(--sev-*) ──
 * These are drawn into <canvas> 2D contexts for Cesium billboard images.
 * CanvasRenderingContext2D.fillStyle/strokeStyle cannot resolve CSS custom
 * properties, so the values below are literal copies of the design tokens
 * defined in index.html's :root (Round 1 of the UI rebuild) — NOT new,
 * invented colors. Keep these in sync by hand if the tokens ever change.
 */

// ── Affiliation axis ──────────────────────────────────────────────────────────

export const AFFILIATION = {
    UNKNOWN:  "unknown",
    NEUTRAL:  "neutral",
    HOSTILE:  "hostile",
    SUSPECT:  "suspect",
    FRIENDLY: "friendly",
}

// Mirrors index.html :root — see file header for why these are hex literals.
const AFFIL_COLOR = {
    [AFFILIATION.UNKNOWN]:  "#EAB308", // mirrors --sev-medium (real MIL-STD Unknown = yellow)
    [AFFILIATION.NEUTRAL]:  "#22C55E", // mirrors --sev-low    (real MIL-STD Neutral = green)
    [AFFILIATION.HOSTILE]:  "#DC2626", // mirrors --sev-critical (real MIL-STD Hostile = red)
    [AFFILIATION.SUSPECT]:  "#F59E0B", // mirrors --sev-high   (deliberately NOT hostile red — see header)
    [AFFILIATION.FRIENDLY]: "#22D3EE", // mirrors --accent     (real MIL-STD Friendly = cyan/blue)
}

export function affiliationColor(affiliation) {
    return AFFIL_COLOR[affiliation] || AFFIL_COLOR[AFFILIATION.UNKNOWN]
}

// ── Entity-function axis ──────────────────────────────────────────────────────

export const ENTITY_FUNCTION = {
    VESSEL_TANKER:       "vessel_tanker",
    VESSEL_CARGO:        "vessel_cargo",
    VESSEL_CONTAINER:    "vessel_container",
    VESSEL_MILITARY:     "vessel_military",
    VESSEL_PASSENGER:    "vessel_passenger",
    VESSEL_FISHING:      "vessel_fishing",
    VESSEL_OTHER:        "vessel_other",
    AIRCRAFT_COMMERCIAL: "aircraft_commercial",
    AIRCRAFT_MILITARY:   "aircraft_military",
    AIRCRAFT_HELICOPTER: "aircraft_helicopter",
    AIRCRAFT_GENERAL:    "aircraft_general",
    NEWS_EVENT:          "news_event",
    INFRA_PORT:          "infra_port",
    INFRA_AIRPORT:       "infra_airport",
    INFRA_CABLE:         "infra_cable",
    ZONE:                "zone",
    FUSION:              "fusion",
    GENERIC:             "generic",
}

// Real AIS ship_type → vessel entity-function (subtype-aware, per real static
// AIS data flowing through iconUtils.js's vesselShipType()).
const VESSEL_TYPE_TO_FUNCTION = {
    tanker:    ENTITY_FUNCTION.VESSEL_TANKER,
    cargo:     ENTITY_FUNCTION.VESSEL_CARGO,
    container: ENTITY_FUNCTION.VESSEL_CONTAINER,
    military:  ENTITY_FUNCTION.VESSEL_MILITARY,
    passenger: ENTITY_FUNCTION.VESSEL_PASSENGER,
    fishing:   ENTITY_FUNCTION.VESSEL_FISHING,
    other:     ENTITY_FUNCTION.VESSEL_OTHER,
}
export function vesselTypeToFunction(shipType) {
    return VESSEL_TYPE_TO_FUNCTION[shipType] || ENTITY_FUNCTION.VESSEL_OTHER
}

// Coarse acClassify() bucket → aircraft entity-function. No finer real data
// exists (per audit) — do not invent finer sub-types than these four.
const AIRCRAFT_CLASS_TO_FUNCTION = {
    commercial: ENTITY_FUNCTION.AIRCRAFT_COMMERCIAL,
    military:   ENTITY_FUNCTION.AIRCRAFT_MILITARY,
    helicopter: ENTITY_FUNCTION.AIRCRAFT_HELICOPTER,
    general:    ENTITY_FUNCTION.AIRCRAFT_GENERAL,
}
export function aircraftClassToFunction(acClass) {
    return AIRCRAFT_CLASS_TO_FUNCTION[acClass] || ENTITY_FUNCTION.AIRCRAFT_GENERAL
}

// ── Affiliation resolvers — real data in, real affiliation out ──────────────

/**
 * A plain AIS vessel record (no alert/sanctions context) has no sanctions
 * signal available to it at this layer (that lives on the alert objects
 * produced by backend/sanctions_loader.py / detectors/correlation_engine.py
 * — see resolveAlertAffiliation). So a base vessel track can only honestly
 * report Unknown (missing identifying data) or Neutral (clean, complete
 * static data, nothing has flagged it). It never resolves to Hostile/Suspect
 * on its own — those come from the alert overlay at the same position.
 */
export function resolveVesselAffiliation(vessel) {
    if (!vessel) return AFFILIATION.UNKNOWN
    const hasIdentity = !!(vessel.name || vessel.ship_type)
    return hasIdentity ? AFFILIATION.NEUTRAL : AFFILIATION.UNKNOWN
}

/** Same reasoning as resolveVesselAffiliation, for ADSB aircraft records. */
export function resolveAircraftAffiliation(ac) {
    if (!ac) return AFFILIATION.UNKNOWN
    const cs = (ac.flight || ac.callsign || "").trim()
    const hasIdentity = !!(cs || ac.category || ac.icao || ac.icao24)
    return hasIdentity ? AFFILIATION.NEUTRAL : AFFILIATION.UNKNOWN
}

/**
 * Alert/fusion affiliation — this is the ONE real integration point for the
 * backend's confirmed/possible sanctions corroboration fields (see
 * backend/sanctions_loader.py check_sanctions_for_vessel() and
 * backend/detectors/correlation_engine.py). Checked field names across all
 * three call sites that can produce a sanctions-flavoured alert:
 *   - top-level `sanctions_hit` / `sanctions_hit_confirmed` (correlation_engine.py)
 *   - top-level `is_sanctions_confirmed` (main.py STS-pair path)
 *   - nested `payload.is_sanctions_related` / `payload.is_sanctions_confirmed`
 * A hit that the backend could not corroborate (confirmed === false) always
 * renders as Suspect, never Hostile — this is the real gap the audit found:
 * the frontend previously read none of these fields and rendered every
 * "Sanctioned Vessel"-named alert identically regardless of corroboration.
 */
export function resolveAlertAffiliation(a) {
    if (!a) return AFFILIATION.UNKNOWN
    const cat = (a.alert_category || a.alert_type || a.rule_name || a.rule_id || "").toLowerCase()
    const isSanctionRule = cat.includes("sanction")
    const isStsRule       = cat.includes("ship-to-ship") || cat.includes("sts")
    const isDarkOrUnknown = cat.includes("dark_ship") || cat.includes("dark ship") ||
                            cat.includes("unknown_contact") || cat.includes("unknown contact")

    const payload = a.payload || {}
    const confirmedFlag =
        a.sanctions_hit_confirmed ?? a.is_sanctions_confirmed ??
        payload.sanctions_hit_confirmed ?? payload.is_sanctions_confirmed ?? null
    const relatedFlag =
        a.sanctions_hit === true || a.is_sanctions_related === true ||
        payload.sanctions_hit === true || payload.is_sanctions_related === true ||
        isSanctionRule

    if (relatedFlag) {
        return confirmedFlag === false ? AFFILIATION.SUSPECT : AFFILIATION.HOSTILE
    }
    if (isStsRule) return AFFILIATION.SUSPECT
    if (isDarkOrUnknown) return AFFILIATION.UNKNOWN
    return AFFILIATION.NEUTRAL
}

/** Entity-function for a generic (non-vessel/aircraft-specific) alert. */
export function resolveAlertEntityFunction(a) {
    if (!a) return ENTITY_FUNCTION.NEWS_EVENT
    const domain = (a.domain || a.source || "").toUpperCase()
    if (domain === "AIS")  return ENTITY_FUNCTION.VESSEL_OTHER
    if (domain === "ADSB") {
        const isMilitary = a.alert_category === "MILITARY_AIRCRAFT" ||
            a.alert_type === "military_aircraft" || a.rule_name === "Military Squawk" || a.aircraft_military
        return isMilitary ? ENTITY_FUNCTION.AIRCRAFT_MILITARY : ENTITY_FUNCTION.AIRCRAFT_GENERAL
    }
    // NEWS and SENTINEL (satellite detection) share the generic event glyph —
    // there is no dedicated MIL-STD symbol for either (see NEWS_EVENT glyph
    // doc below); SENTINEL doesn't get its own category since it's a one-off
    // detection type, not a recurring entity class worth a distinct glyph.
    return ENTITY_FUNCTION.NEWS_EVENT
}

// ── Frame geometry (canvas) ───────────────────────────────────────────────────

function _diamondPath(ctx, cx, cy, r) {
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r, cy)
    ctx.closePath()
}

// Only two of the four diamond edges — a literally incomplete outline
// reflecting incomplete identifying data (Unknown), not merely a dash
// pattern applied to an otherwise-complete shape (that's Suspect, below).
function _diamondPartial(ctx, cx, cy, r) {
    const top = [cx, cy - r], right = [cx + r, cy], bottom = [cx, cy + r], left = [cx - r, cy]
    ctx.beginPath()
    ctx.moveTo(...top); ctx.lineTo(...right)
    ctx.moveTo(...bottom); ctx.lineTo(...left)
}

function _squarePath(ctx, cx, cy, r) {
    const s = r * 1.15
    ctx.beginPath()
    ctx.rect(cx - s, cy - s, s * 2, s * 2)
}

function drawAffiliationFrame(ctx, affiliation, cx, cy, r) {
    const color = affiliationColor(affiliation)
    ctx.save()
    switch (affiliation) {
        case AFFILIATION.HOSTILE:
            _diamondPath(ctx, cx, cy, r)
            ctx.fillStyle = color + "33"
            ctx.fill()
            ctx.setLineDash([])
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.6, r * 0.14)
            ctx.stroke()
            break
        case AFFILIATION.SUSPECT:
            _diamondPath(ctx, cx, cy, r)
            ctx.fillStyle = color + "1a"
            ctx.fill()
            ctx.setLineDash([r * 0.35, r * 0.28])
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.4, r * 0.12)
            ctx.stroke()
            ctx.setLineDash([])
            break
        case AFFILIATION.UNKNOWN:
            _diamondPartial(ctx, cx, cy, r)
            ctx.setLineDash([r * 0.3, r * 0.3])
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.2, r * 0.1)
            ctx.stroke()
            ctx.setLineDash([])
            break
        case AFFILIATION.FRIENDLY:
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.fillStyle = color + "26"
            ctx.fill()
            ctx.setLineDash([])
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.4, r * 0.12)
            ctx.stroke()
            break
        case AFFILIATION.NEUTRAL:
        default:
            _squarePath(ctx, cx, cy, r)
            ctx.fillStyle = color + "26"
            ctx.fill()
            ctx.setLineDash([])
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1.4, r * 0.12)
            ctx.stroke()
            break
    }
    ctx.restore()
    return color
}

// ── Frame geometry (SVG string, for inline UI use — DirectorBar/GlobalSearch) ─

function frameSvgMarkup(affiliation, cx, cy, r, color) {
    switch (affiliation) {
        case AFFILIATION.HOSTILE:
            return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" `
                + `fill="${color}33" stroke="${color}" stroke-width="${Math.max(1.6, r * 0.14).toFixed(2)}"/>`
        case AFFILIATION.SUSPECT:
            return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" `
                + `fill="${color}1a" stroke="${color}" stroke-width="${Math.max(1.4, r * 0.12).toFixed(2)}" `
                + `stroke-dasharray="${(r * 0.35).toFixed(2)},${(r * 0.28).toFixed(2)}"/>`
        case AFFILIATION.UNKNOWN:
            return `<path d="M${cx},${cy - r} L${cx + r},${cy} M${cx},${cy + r} L${cx - r},${cy}" `
                + `fill="none" stroke="${color}" stroke-width="${Math.max(1.2, r * 0.1).toFixed(2)}" `
                + `stroke-dasharray="${(r * 0.3).toFixed(2)},${(r * 0.3).toFixed(2)}"/>`
        case AFFILIATION.FRIENDLY:
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}26" stroke="${color}" `
                + `stroke-width="${Math.max(1.4, r * 0.12).toFixed(2)}"/>`
        case AFFILIATION.NEUTRAL:
        default: {
            const s = r * 1.15
            return `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" fill="${color}26" `
                + `stroke="${color}" stroke-width="${Math.max(1.4, r * 0.12).toFixed(2)}"/>`
        }
    }
}

// ── Entity-function glyphs ────────────────────────────────────────────────────
// Real MIL-STD-2525C main-icon pictograms are not reproduced pixel-for-pixel
// here (that requires full SIDC amplifier/modifier support this product does
// not have) — these are simplified, consistent-weight silhouettes. Vessel
// hull silhouettes and the commercial-aircraft silhouette are real, already-
// proven shapes carried over unchanged from the previous iconUtils.js (now
// deleted from there since this module is the one canonical home). Anything
// marked "extension" below has no confirmed real MIL-STD equivalent and is a
// deliberate, documented design addition consistent with the standard's
// visual language (frame/fill logic, stroke weight), not part of the
// official standard.

const AC_PATH = // real airliner silhouette, 24×24 box — unchanged from iconUtils.js
    "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"

const GLYPH = {
    // Real AIS ship_type hull silhouettes, 16×28 box — unchanged from iconUtils.js VESSEL_PATHS.
    [ENTITY_FUNCTION.VESSEL_TANKER]:    { box: [16, 28], fillD: "M8,1 L13,7 L14,14 L14,24 L11,27 L5,27 L2,24 L2,14 L3,7 Z" },
    [ENTITY_FUNCTION.VESSEL_CONTAINER]: { box: [16, 28], fillD: "M8,1 L14,8 L14,25 L12,27 L4,27 L2,25 L2,8 Z" },
    [ENTITY_FUNCTION.VESSEL_CARGO]:     { box: [16, 28], fillD: "M8,1 L13,7 L13,24 L11,27 L5,27 L3,24 L3,7 Z" },
    [ENTITY_FUNCTION.VESSEL_PASSENGER]: { box: [16, 28], fillD: "M8,1 L12,6 L13,12 L13,24 L10,27 L6,27 L3,24 L3,12 L4,6 Z" },
    [ENTITY_FUNCTION.VESSEL_MILITARY]:  { box: [16, 28], fillD: "M8,0 L12,5 L14,10 L14,24 L11,27 L5,27 L2,24 L2,10 L4,5 Z" },
    [ENTITY_FUNCTION.VESSEL_FISHING]:   { box: [16, 28], fillD: "M8,2 L12,8 L12,22 L10,25 L6,25 L4,22 L4,8 Z" },
    [ENTITY_FUNCTION.VESSEL_OTHER]:     { box: [16, 28], fillD: "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z" },

    // Real commercial-airliner silhouette (unchanged) for both commercial and
    // general aviation (general drawn smaller/lighter via the stroke cross
    // below instead, so the two remain visually distinct at a glance).
    [ENTITY_FUNCTION.AIRCRAFT_COMMERCIAL]: { box: [24, 24], fillD: AC_PATH },
    [ENTITY_FUNCTION.AIRCRAFT_GENERAL]:    { box: [24, 24], strokeD: "M12,2 L12,20 M3,9 L21,9 M8,20 L16,20" },
    // Delta/fighter silhouette — extension (no single confirmed real SIDC
    // main icon at this simplified fidelity level); swept-wing shape reused
    // from GlobeDirectorLayer's demo-scenario fighter glyph for visual continuity.
    [ENTITY_FUNCTION.AIRCRAFT_MILITARY]:   { box: [24, 24], fillD: "M12,2 L16,15 L12,12 L8,15 Z", strokeD: "M4,12 L20,12" },
    // Rotor cross — extension (cockpit disc + main rotor + tail boom).
    [ENTITY_FUNCTION.AIRCRAFT_HELICOPTER]: { box: [24, 24], fillD: "M10,10 a2,2 0 1,0 4,0 a2,2 0 1,0 -4,0", strokeD: "M2,12 L22,12 M14,12 L14,20" },

    // Extension — MIL-STD has no official news/event symbol (see task spec).
    // Starburst, same frame/fill/weight logic as everything else.
    [ENTITY_FUNCTION.NEWS_EVENT]: { box: [32, 32], fillD: _burstPathD(16, 16, 11, 5, 8) },

    // Real maritime pictograph convention (anchor) for port infrastructure —
    // extension in the sense that it isn't a literal reproduction of a
    // specific SIDC installation code, but the anchor glyph itself is a real,
    // widely-used maritime-infrastructure convention, not invented here.
    [ENTITY_FUNCTION.INFRA_PORT]:    { box: [32, 32], strokeD: "M16,7 L16,26 M8,14 L24,14 M8,26 Q8,20 16,26 Q24,20 24,26" },
    // Tower + runway — extension standing in for the real SIDC airfield
    // installation glyph (not reproduced at full fidelity here).
    [ENTITY_FUNCTION.INFRA_AIRPORT]: { box: [32, 32], fillD: "M16,6 L20,26 L12,26 Z", strokeD: "M6,26 L26,26" },
    // Sine-wave — extension representing a submarine cable run.
    [ENTITY_FUNCTION.INFRA_CABLE]:   { box: [32, 32], strokeD: "M4,16 Q10,6 16,16 Q22,26 28,16" },

    // Extension — point-marker stand-in for a zone/AOI whose real boundary
    // is drawn as a polygon elsewhere (GlobeChokepointsLayer/GlobeStrategicZonesLayer);
    // this reticle is only for list/search contexts needing a small icon.
    [ENTITY_FUNCTION.ZONE]: { box: [32, 32], strokeD: "M16,16 m-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 M16,3 L16,10 M16,22 L16,29 M3,16 L10,16 M22,16 L29,16" },

    // Spark/cross — carried over from the old makeFusionCanvas visual language.
    [ENTITY_FUNCTION.FUSION]: { box: [24, 24], strokeD: "M12,6 L12,18 M6,12 L18,12" },

    [ENTITY_FUNCTION.GENERIC]: { box: [24, 24], fillD: "M12,8 a4,4 0 1,0 0.01,0" },
}

function _burstPathD(cx, cy, rOuter, rInner, points) {
    const pts = []
    for (let i = 0; i < points * 2; i++) {
        const a = (i * Math.PI) / points - Math.PI / 2
        const d = i % 2 === 0 ? rOuter : rInner
        pts.push(`${(cx + Math.cos(a) * d).toFixed(2)},${(cy + Math.sin(a) * d).toFixed(2)}`)
    }
    return `M${pts.join(" L")} Z`
}

function _glyphEntry(entityFunction) {
    return GLYPH[entityFunction] || GLYPH[ENTITY_FUNCTION.GENERIC]
}

function drawEntityGlyph(ctx, entityFunction, cx, cy, r, color) {
    const g = _glyphEntry(entityFunction)
    const [bw, bh] = g.box
    const scale = (r * 1.15) / Math.max(bw, bh)
    ctx.save()
    ctx.translate(cx - (bw * scale) / 2, cy - (bh * scale) / 2)
    ctx.scale(scale, scale)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, 1.6 / scale)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (g.fillD) ctx.fill(new Path2D(g.fillD))
    if (g.strokeD) ctx.stroke(new Path2D(g.strokeD))
    ctx.restore()
}

function glyphSvgMarkup(entityFunction, color) {
    const g = _glyphEntry(entityFunction)
    let out = ""
    if (g.fillD) out += `<path d="${g.fillD}" fill="${color}"/>`
    if (g.strokeD) out += `<path d="${g.strokeD}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    return { markup: out, box: g.box }
}

// ── Composed draw / canvas / svg builders ─────────────────────────────────────

/** Direct-draw into an existing 2D context (used by ForceGraph's per-frame canvas). */
export function drawMarker(ctx, cx, cy, r, {
    affiliation = AFFILIATION.NEUTRAL,
    entityFunction = ENTITY_FUNCTION.GENERIC,
    accentColor,
    pulse = false,
    signalCount = 0,
} = {}) {
    const frameColor = drawAffiliationFrame(ctx, affiliation, cx, cy, r)
    const glyphColor = accentColor || frameColor
    drawEntityGlyph(ctx, entityFunction, cx, cy, r, glyphColor)

    if (pulse) {
        ctx.beginPath()
        ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2)
        ctx.strokeStyle = frameColor + "55"
        ctx.lineWidth = Math.max(1, r * 0.06)
        ctx.stroke()
    }

    if (signalCount >= 2) {
        const bx = cx + r * 0.78, by = cy - r * 0.78
        const br = Math.max(4, r * 0.32)
        ctx.beginPath()
        ctx.arc(bx, by, br, 0, Math.PI * 2)
        ctx.fillStyle = frameColor
        ctx.fill()
        ctx.fillStyle = "#000"
        ctx.font = `bold ${Math.max(7, br * 1.15)}px "IBM Plex Mono", "Courier New", monospace`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(String(signalCount), bx, by + 0.5)
    }
    return frameColor
}

/** Offscreen canvas suitable for a Cesium billboard `image`. */
export function makeMarkerCanvas({
    affiliation = AFFILIATION.NEUTRAL,
    entityFunction = ENTITY_FUNCTION.GENERIC,
    size = 32,
    accentColor,
    pulse = false,
    signalCount = 0,
} = {}) {
    const dpr = Math.max(typeof window !== "undefined" ? (window.devicePixelRatio || 2) : 2, 2)
    const canvas = document.createElement("canvas")
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)
    drawMarker(ctx, size / 2, size / 2, size / 2 - 2, { affiliation, entityFunction, accentColor, pulse, signalCount })
    return canvas
}

const _canvasCache = new Map()
/** Cached wrapper — key includes every option that changes the pixels. */
export function getMarkerCanvas(opts = {}) {
    const key = JSON.stringify([
        opts.affiliation, opts.entityFunction, opts.size ?? 32,
        opts.accentColor ?? "", !!opts.pulse, opts.signalCount ?? 0,
    ])
    if (_canvasCache.has(key)) return _canvasCache.get(key)
    const c = makeMarkerCanvas(opts)
    _canvasCache.set(key, c)
    return c
}

/** Inline SVG string — for non-Cesium UI (DirectorBar logo, GlobalSearch rows). */
export function markerSvg({
    affiliation = AFFILIATION.NEUTRAL,
    entityFunction = ENTITY_FUNCTION.GENERIC,
    size = 20,
    accentColor,
} = {}) {
    const r = size / 2
    const cx = r, cy = r
    const frameColor = affiliationColor(affiliation)
    const glyphColor = accentColor || frameColor
    const frame = frameSvgMarkup(affiliation, cx, cy, r, frameColor)
    const { markup: glyphMarkup, box } = glyphSvgMarkup(entityFunction, glyphColor)
    const [bw, bh] = box
    const scale = (r * 1.15) / Math.max(bw, bh)
    const tx = cx - (bw * scale) / 2
    const ty = cy - (bh * scale) / 2
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + frame
        + `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(3)})">${glyphMarkup}</g>`
        + `</svg>`
}

// ── ForceGraph (forge entity graph) support ───────────────────────────────────
// Maps a canonical graph node type (ForceGraph.jsx's canonType()) to a
// {affiliation, entityFunction} pair. Every node here is Neutral (or Unknown
// for a genuinely unrecognised type) — the graph shows ontology structure,
// not live threat assessment, so there is no real signal to justify
// Hostile/Suspect/Friendly for any of these node kinds.
const GRAPH_NODE_SYMBOL = {
    vessel:         { entityFunction: ENTITY_FUNCTION.VESSEL_OTHER },
    aircraft:       { entityFunction: ENTITY_FUNCTION.AIRCRAFT_GENERAL },
    alert:          { entityFunction: ENTITY_FUNCTION.NEWS_EVENT },
    surge:          { entityFunction: ENTITY_FUNCTION.NEWS_EVENT },
    fusion_event:   { entityFunction: ENTITY_FUNCTION.FUSION },
    assessment:     { entityFunction: ENTITY_FUNCTION.NEWS_EVENT },
    port:           { entityFunction: ENTITY_FUNCTION.INFRA_PORT },
    airport:        { entityFunction: ENTITY_FUNCTION.INFRA_AIRPORT },
    cable:          { entityFunction: ENTITY_FUNCTION.INFRA_CABLE },
    watch_zone:     { entityFunction: ENTITY_FUNCTION.ZONE },
    strategic_zone: { entityFunction: ENTITY_FUNCTION.ZONE },
    rule:           { entityFunction: ENTITY_FUNCTION.GENERIC },
}

export function graphNodeSymbol(canonType) {
    const hit = GRAPH_NODE_SYMBOL[canonType]
    if (!hit) return { affiliation: AFFILIATION.UNKNOWN, entityFunction: ENTITY_FUNCTION.GENERIC }
    return { affiliation: AFFILIATION.NEUTRAL, entityFunction: hit.entityFunction }
}

export function graphNodeColor(canonType) {
    return affiliationColor(graphNodeSymbol(canonType).affiliation)
}
