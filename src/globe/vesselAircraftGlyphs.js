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
export const AIRCRAFT_COLOR = "#a8b6c2"
export const AIRCRAFT_WATCHLISTED_COLOR = "#b7822c"

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

/** A simple real airframe outline (fuselage + swept wings + tail), nose forward. */
function airframeSvg(color, size) {
    const w = size, h = size
    const cx = w / 2
    const noseY = h * 0.06, tailY = h * 0.9
    const wingY = h * 0.42, wingHalf = w * 0.42
    const tailWingY = h * 0.82, tailHalf = w * 0.16
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<line x1="${cx}" y1="${noseY}" x2="${cx}" y2="${tailY}" stroke="${color}" stroke-width="1.6"/>`
        + `<line x1="${cx - wingHalf}" y1="${wingY + w * 0.08}" x2="${cx + wingHalf}" y2="${wingY - w * 0.08}" stroke="${color}" stroke-width="1.6"/>`
        + `<line x1="${cx - tailHalf}" y1="${tailWingY}" x2="${cx + tailHalf}" y2="${tailWingY}" stroke="${color}" stroke-width="1.4"/>`
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

export function getAircraftMarkerDataUri({ watchlisted = false, size = 26 } = {}) {
    const color = watchlisted ? AIRCRAFT_WATCHLISTED_COLOR : AIRCRAFT_COLOR
    const key = `a:${color}:${size}`
    if (!_cache.has(key)) _cache.set(key, dataUri(airframeSvg(color, size)))
    return _cache.get(key)
}
