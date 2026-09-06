// vesselAircraftGlyphs.js — real hull/airframe outline glyphs, build spec v2
// §7: "Only signal/event map markers use the .dia rotated-square severity
// diamond. Vessels and aircraft are not diamonds." Distinct from
// entityIcons.js's generic lucide-icon system (built for many entity types
// generically) — these are purpose-drawn silhouettes, each rendered as one
// static SVG image (hull/airframe + wake drawn together) so a single
// Cesium billboard rotation correctly carries both the hull and its wake
// to the vessel's real heading, without needing a second, independently-
// positioned polyline entity per track.
//
// Colors are the literal build-spec values — never re-derived from the
// generic severity/entity palette:
export const VESSEL_COLOR = "#7fa8c9"
export const VESSEL_SANCTIONED_COLOR = "#c4453c"
export const AIRCRAFT_WATCHLISTED_COLOR = "#b7822c"

// Design update: aircraft are colour-coded by real classification
// (iconUtils.js's acClassify()) instead of one flat grey — deliberately
// excluding blue (already heavily used elsewhere on the globe for vessels/
// water features, so aircraft need their own distinct family). Watchlisted
// status still overrides type colour entirely (a real "flagged for review"
// signal takes priority over routine classification).
export const AIRCRAFT_TYPE_COLOR = {
    military: "#C084FC",   // purple
    helicopter: "#FB923C", // orange
    commercial: "#3DDC97", // green
    general: "#9AA5B1",    // muted grey
}

const _cache = new Map()

/**
 * A simple real hull outline (bow pointed up/forward in the glyph's own
 * frame, stern flat) with a dashed wake trailing straight down (astern) —
 * the billboard's own `rotation` (set from real heading) carries both
 * together to the vessel's true course.
 */
function hullSvg(color, size) {
    const w = size, h = size
    const bowY = h * 0.08, sternY = h * 0.52
    const halfW = w * 0.16
    const cx = w / 2
    const wakeStartY = sternY + 2, wakeEndY = h * 0.98
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<path d="M ${cx} ${bowY} L ${cx + halfW} ${sternY} L ${cx + halfW * 0.6} ${sternY + h * 0.06} L ${cx - halfW * 0.6} ${sternY + h * 0.06} L ${cx - halfW} ${sternY} Z" `
        + `fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`
        + `<line x1="${cx}" y1="${wakeStartY}" x2="${cx}" y2="${wakeEndY}" stroke="${color}" stroke-width="1.2" stroke-dasharray="2,2" opacity="0.75"/>`
        + `</svg>`
}

/** A solid triangle, nose (apex) forward — the billboard's own `rotation`
 * (set from real heading/track) carries it to the aircraft's true course,
 * same convention the previous airframe outline used. */
function aircraftTriangleSvg(color, size) {
    const w = size, h = size
    const cx = w / 2
    const noseY = h * 0.08, tailY = h * 0.88
    const halfW = w * 0.34
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<path d="M ${cx} ${noseY} L ${cx + halfW} ${tailY} L ${cx - halfW} ${tailY} Z" `
        + `fill="${color}" stroke="#070B14" stroke-width="1" stroke-linejoin="round"/>`
        + `</svg>`
}

function dataUri(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function getVesselMarkerDataUri({ sanctioned = false, size = 26 } = {}) {
    const color = sanctioned ? VESSEL_SANCTIONED_COLOR : VESSEL_COLOR
    const key = `v:${color}:${size}`
    if (!_cache.has(key)) _cache.set(key, dataUri(hullSvg(color, size)))
    return _cache.get(key)
}

export function getAircraftMarkerDataUri({ watchlisted = false, classification = "general", size = 26 } = {}) {
    const color = watchlisted ? AIRCRAFT_WATCHLISTED_COLOR : (AIRCRAFT_TYPE_COLOR[classification] || AIRCRAFT_TYPE_COLOR.general)
    const key = `a:${color}:${size}`
    if (!_cache.has(key)) _cache.set(key, dataUri(aircraftTriangleSvg(color, size)))
    return _cache.get(key)
}
