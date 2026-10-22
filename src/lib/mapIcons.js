/**
 * mapIcons.js — THE ONE ICON STYLE of the map, phone and globe (owner, 2026-10-23: "different icons for
 * different things, but one style: same stroke weight, size, outline/fill rule, colour logic").
 *
 *   SHAPE    says the family: a circle for an act on the ground (live signals), a square for something a
 *            sensor found (imagery signals), a diamond for reporting, a triangle for a derived warning
 *            (globe/entityIcons.js MARKER_SHAPES, the same four)
 *   GLYPH    says WHICH thing, drawn inside in the dark edge colour, one stroke weight
 *   FILL     the colour logic: red = harm done or under way (arrest, shots, missile, critical), amber =
 *            damage and crowds (explosion, strike, crowd, high), blue = forces (troops, police), grey-blue =
 *            unknown/low. Always a filled shape with the dark edge, never an outlined ring.
 *   SIZE     ICON_PX on screen, constant at every zoom (no scale by distance, no swelling)
 *
 * globe/entityIcons.js (shape markers) takes its edge colour and stroke from here, so a facility, a fire, a
 * live signal and an imagery signal are the same family. Pure, no DOM.
 */
export const EDGE = "#070B14"            // the dark outline and the glyph colour
export const STROKE = 1.5                // the one outline weight, in icon pixels
export const ICON_PX = 26                // the one on-screen size of a signal-family badge
export const PALETTE = { red: "#E5484D", amber: "#F5A524", blue: "#229ED9", grey: "#9AA9BC", sky: "#8FB4E8" }

const SHAPES = {
    circle: (c, r) => `<circle cx="${c}" cy="${c}" r="${r}"`,
    square: (c, r) => `<rect x="${c - r}" y="${c - r}" width="${r * 2}" height="${r * 2}" rx="2.5"`,
    diamond: (c, r) => `<path d="M${c} ${c - r}L${c + r} ${c}L${c} ${c + r}L${c - r} ${c}Z"`,
    triangle: (c, r) => `<path d="M${c} ${c - r}L${c + r * 0.92} ${c + r * 0.72}L${c - r * 0.92} ${c + r * 0.72}Z"`,
}
const b64 = (svg) => `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(svg) : Buffer.from(svg).toString("base64")}`

const _cache = new Map()
/**
 * A filled shape in `color`, the dark edge, a glyph (an SVG path in a 32 box) in the edge colour.
 * `bearing`: an arrowhead on the edge toward where a crowd moves. `muted`: the same badge, fainter.
 */
export function badgeUri({ shape = "circle", color = PALETTE.grey, glyph = "", bearing = null, muted = false } = {}) {
    const b = Number.isFinite(bearing) ? Math.round(bearing / 15) * 15 : null
    const key = `${shape}|${color}|${glyph}|${b}|${muted ? 1 : 0}`
    if (_cache.has(key)) return _cache.get(key)
    const draw = (SHAPES[shape] || SHAPES.circle)(16, 13)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_PX * 2}" height="${ICON_PX * 2}" viewBox="0 0 32 32" opacity="${muted ? 0.45 : 1}">`
        + `${draw} fill="${color}" stroke="${EDGE}" stroke-width="${STROKE}" stroke-linejoin="round"/>`
        + (glyph ? `<path d="${glyph}" fill="none" stroke="${EDGE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` : "")
        + (b === null ? "" : `<path d="M16 .5l4 5h-8z" fill="${color}" stroke="${EDGE}" stroke-width="1" transform="rotate(${b} 16 16)"/>`)
        + `</svg>`
    const uri = b64(svg)
    _cache.set(key, uri)
    return uri
}

/** Imagery signal: the sensor family, a square with a target glyph, coloured by severity. */
export const IMAGERY_GLYPH = "M16 9v14M9 16h14"
export function imageryIcon(sev) {
    const color = { critical: PALETTE.red, high: PALETTE.amber, low: PALETTE.grey }[sev] || PALETTE.sky
    return badgeUri({ shape: "square", color, glyph: IMAGERY_GLYPH })
}
