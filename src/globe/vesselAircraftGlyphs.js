/**
 * vesselAircraftGlyphs.js — PARALLAX §7: form under a fixed light.
 *
 * Four paths in one group, rotated together by heading. The previous glyphs
 * were a hollow chevron for a hull and a filled triangle for an airframe —
 * readable as "a thing", but not as a ship or a plane, and with no sense of
 * which way is up.
 *
 * §7's geometry is used verbatim: `body` is the silhouette, `shade` is the
 * left half in flat black, `hl` a highlight down the right of the bow, `det`
 * a detail line. The light is FIXED in the glyph's own frame, so a vessel
 * turning through 360° keeps its modelled form instead of appearing lit from
 * a rotating sun.
 *
 * SHADING IS A NEUTRAL OVERLAY, NEVER ITS OWN HUE — §7's rule 2. That is what
 * lets a sanctioned hull stay red and still read as a hull: black at 30% and
 * white at 26% darken and lighten whatever colour is underneath without
 * shifting it.
 *
 * ── Three deliberate departures ──────────────────────────────────────────
 *
 * 1. THE WAKE IS IN THE BILLBOARD, SHORTENED. §9's translation table makes
 *    `.wake` a separate PolylineDashMaterialProperty in map space at 22 (hull)
 *    / 34 (airframe) units. Kept inside the image instead, as the previous
 *    implementation did and for its reason: one billboard rotation carries
 *    hull and wake together to the true course, where a separate polyline
 *    needs its own per-track entity and its own heading sync. The length is
 *    therefore proportional to the glyph rather than to the map — a full
 *    22-unit wake in a square billboard would shrink the hull to a speck.
 *
 * 2. AIRCRAFT KEEP THEIR CLASSIFICATION COLOUR. §7 gives airframes one colour
 *    (--ta8b6c2) plus a watchlist amber. This app tints them by real
 *    classification — military / helicopter / commercial / general — and that
 *    is exactly what §7's own rule 2 asks colour to be: state, not decoration.
 *    Collapsing four real classes into one grey would delete information to
 *    match a palette. Watchlisted still overrides everything, as in both.
 *
 * 3. Rendered as an SVG data URI rather than §9's "canvas per (type, state)".
 *    Same caching shape — one image per distinct (kind, colour, theme, size) —
 *    and Cesium treats either identically as a billboard image.
 */

// ── §7's own path data, in its own coordinate space ──────────────────────
const SHIP = {
    body:  "M0,-7.4 C2.2,-4.8 3.05,-2.1 3.05,0.5 L3.05,5.5 C3.05,6.4 2.45,7 1.6,7 "
         + "L-1.6,7 C-2.45,7 -3.05,6.4 -3.05,5.5 L-3.05,0.5 C-3.05,-2.1 -2.2,-4.8 0,-7.4 Z",
    shade: "M0,-7.4 C-2.2,-4.8 -3.05,-2.1 -3.05,0.5 L-3.05,5.5 C-3.05,6.4 -2.45,7 -1.6,7 L0,7 Z",
    hl:    "M0,-7.4 C1.5,-5.2 2.1,-3.2 2.25,-1.2 L1.1,-0.8 C0.95,-3 0.6,-5 0,-6.4 Z",
    det:   "M-2.1,2.5 H2.1 V5.2 H-2.1 Z M-1.3,3.3 H1.3",
    bow: -7.4,     // the glyph's own extents, used to frame it
    stern: 7,      // where the wake starts
    scale: 1.7,
}

const PLANE = {
    body:  "M0,-8.2 C0.95,-6.5 1.2,-3.6 1.2,0 L1.2,5.3 C1.2,6.7 0.72,7.8 0,8.2 "
         + "C-0.72,7.8 -1.2,6.7 -1.2,5.3 L-1.2,0 C-1.2,-3.6 -0.95,-6.5 0,-8.2 Z"
         + " M-1.15,-1.5 L-7.8,3.1 L-7.8,4.35 L-1.15,2.0 Z"
         + " M1.15,-1.5 L7.8,3.1 L7.8,4.35 L1.15,2.0 Z"
         + " M-1.0,5.1 L-3.5,6.95 L-3.5,7.7 L-1.0,6.7 Z"
         + " M1.0,5.1 L3.5,6.95 L3.5,7.7 L1.0,6.7 Z",
    shade: "M0,-8.2 C-0.95,-6.5 -1.2,-3.6 -1.2,0 L-1.2,5.3 C-1.2,6.7 -0.72,7.8 0,8.2 Z"
         + " M-1.15,-1.5 L-7.8,3.1 L-7.8,4.35 L-1.15,2.0 Z"
         + " M-1.0,5.1 L-3.5,6.95 L-3.5,7.7 L-1.0,6.7 Z",
    hl:    "M0,-8.2 C0.6,-6.8 0.85,-4.6 0.95,-2.2 L0.25,-2.0 C0.2,-4.4 0.1,-6.4 0,-7.2 Z",
    det:   "M-1.05,1.1 H1.05",
    bow: -8.2,
    stern: 8.2,
    scale: 1.5,
}

// §7's palette, resolved to the literal hex its tokens carry in each theme.
// Data URIs are rendered outside the document, so var(--…) cannot reach them.
const PALETTE = {
    dark:  {
        vessel: "#7fa8c9", sanctioned: "#c4453c",
        aircraft: "#a8b6c2", watch: "#b7822c",
        outline: "#171b20", wake: "#5f7b91",
        shade: "rgba(0,0,0,.30)", hl: "rgba(255,255,255,.26)", det: "rgba(0,0,0,.34)",
    },
    light: {
        vessel: "#37719f", sanctioned: "#ad3229",
        aircraft: "#506d86", watch: "#926317",
        outline: "#ece5dc", wake: "#4c6f8a",
        shade: "rgba(40,30,16,.26)", hl: "rgba(255,252,244,.42)", det: "rgba(40,30,16,.34)",
    },
}

export const VESSEL_COLOR = PALETTE.dark.vessel
export const VESSEL_SANCTIONED_COLOR = PALETTE.dark.sanctioned
export const AIRCRAFT_WATCHLISTED_COLOR = PALETTE.dark.watch

// Real classification tint for BOTH kinds — §7 rule 2, "colour is state,
// never decoration". A hull's trade and an airframe's class are exactly that:
// a tanker and a trawler in the same strait are not the same fact, and a
// single blue for everything afloat throws that away.
//
// The vessel hues are iconUtils.js's VESSEL_COLORS, which has been defined in
// this codebase all along with nothing reading it. Sanctioned still overrides
// the trade colour, and watchlisted still overrides the airframe class —
// "this one is flagged" outranks "this one is a tanker".
export const VESSEL_TYPE_COLOR = {
    tanker:    "#f59e0b",
    cargo:     "#14b8a6",
    container: "#06b6d4",
    // NOT red. iconUtils.js's table had military hulls at #ef4444, which is
    // within a few percent of the sanctioned red — a naval vessel and a
    // sanctioned hull would have been the same mark to the eye, and
    // "sanctioned" is the more urgent state and owns red across this app.
    // Purple is what military ALREADY means on the aircraft side, so one
    // colour now reads "military" whether it floats or flies.
    military:  "#C084FC",
    passenger: "#3b82f6",
    fishing:   "#84cc16",
    // No entry for "other" on purpose. The named trades are categorical hues
    // and are the same on paper as on the dark ground; an UNCLASSIFIED hull
    // has no category to signal, so it falls back to the theme's own vessel
    // colour below. Pinning a hex here put the dark-theme blue on the light
    // theme — a hull that was the only thing on the map not following the
    // palette.
}

// Deliberately excludes blue, which the globe already spends on vessels.
export const AIRCRAFT_TYPE_COLOR = {
    military: "#C084FC",
    helicopter: "#FB923C",
    commercial: "#3DDC97",
    general: "#9AA5B1",
}

const _cache = new Map()

/**
 * The glyph, framed so the hull sits in the upper part of a square box with
 * its wake trailing astern — the whole image rotates as one, so `rotation`
 * set from real heading carries form and wake to the true course together.
 */
function glyphSvg(shape, fill, theme, size, wakeLen) {
    const p = PALETTE[theme] || PALETTE.dark
    const s = shape.scale
    // Put the bow near the top of the box and leave the rest below for the
    // wake, so both kinds sit at the same optical weight in the same 26px
    // billboard despite very different native proportions.
    const BOW_Y = -17
    const dy = BOW_Y - shape.bow * s
    const sternY = shape.stern * s + dy

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-20 -20 40 40">`
        // §7's wake is stroke-width .9 with a 2/3 dash IN THE GLYPH'S OWN
        // space. The wake is drawn outside the scale() group (so its length
        // is framed against the box, not the hull), which means its stroke
        // has to be scaled by hand — left at .9 it renders sub-pixel in a
        // 26px billboard and the wake simply is not there.
        + `<path d="M0,${sternY} V${sternY + wakeLen}" fill="none" stroke="${p.wake}" `
        + `stroke-width="${(0.9 * s).toFixed(2)}" stroke-dasharray="${(2 * s).toFixed(1)} ${(3 * s).toFixed(1)}" opacity="0.7"/>`
        + `<g transform="translate(0,${dy.toFixed(2)}) scale(${s})">`
        + `<path d="${shape.body}" fill="${fill}" stroke="${p.outline}" stroke-width="0.7" stroke-linejoin="round"/>`
        + `<path d="${shape.shade}" fill="${p.shade}"/>`
        + `<path d="${shape.hl}" fill="${p.hl}"/>`
        + `<path d="${shape.det}" fill="none" stroke="${p.det}" stroke-width="0.55"/>`
        + `</g></svg>`
}

const dataUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

function cached(key, make) {
    if (!_cache.has(key)) _cache.set(key, dataUri(make()))
    return _cache.get(key)
}

export function getVesselMarkerDataUri({
    sanctioned = false, shipType = "other", size = 26, theme = "dark",
} = {}) {
    const p = PALETTE[theme] || PALETTE.dark
    const fill = sanctioned ? p.sanctioned : (VESSEL_TYPE_COLOR[shipType] || p.vessel)
    return cached(`v:${fill}:${theme}:${size}`, () => glyphSvg(SHIP, fill, theme, size, 10.5))
}

export function getAircraftMarkerDataUri({
    watchlisted = false, classification = "general", size = 26, theme = "dark",
} = {}) {
    const p = PALETTE[theme] || PALETTE.dark
    const fill = watchlisted ? p.watch : (AIRCRAFT_TYPE_COLOR[classification] || AIRCRAFT_TYPE_COLOR.general)
    return cached(`a:${fill}:${theme}:${size}`, () => glyphSvg(PLANE, fill, theme, size, 12))
}

export const __shapes = { SHIP, PLANE, PALETTE }
