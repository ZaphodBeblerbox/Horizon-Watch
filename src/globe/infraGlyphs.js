/**
 * infraGlyphs.js — PARALLAX icons addendum §I6. Port and airport map glyphs.
 *
 * These are MAP GLYPHS, not sprite icons, and §I1 says the distinction is
 * load-bearing: a glyph that has to work at 7px cannot be built from 1px
 * strokes. So these are filled silhouettes in local units around 0,0, not
 * hairline drawings on a 24px grid.
 *
 * What was here before: lucide's generic Building2 for a port and a plane
 * for an airport. The plane is the one §I6 names outright — "a plane on the
 * ground must not be the same mark as a plane in the air, that is a
 * different object with different consequences." On a map showing live
 * ADS-B, an airport drawn as a plane is not merely generic, it is wrong.
 *
 * Rendered once per (kind, state, theme) and cached, per §I7.
 */

const _cache = new Map()

/** §I6.3's palette, as literal values so a glyph never depends on cascade. */
const INK = {
    dark: {
        quay: "#7b8792", gantry: "#8d99a4", box: "#7b8792",
        strip: "#8d99a4", mark: "#12161a", taxi: "#7b8792", term: "#7b8792",
        water: "#7b8792",
    },
    light: {
        quay: "#6b7680", gantry: "#5d6670", box: "#6b7680",
        strip: "#5d6670", mark: "#f7f4ee", taxi: "#6b7680", term: "#6b7680",
        water: "#6b7680",
    },
}

/** §L7.2 / §I6.4 — congestion colours the GANTRY only. */
export const PORT_STATE_COLOR = {
    nominal: null,                 // keep the neutral gantry: a fine port must read as a port
    busy: "#7fa8c9",
    congested: "#b7822c",
    blocked: "#c4453c",
}

/**
 * §I6.1 — a portal crane on a quay.
 *
 * "The boom overhanging the water is the signature." That asymmetry is what
 * separates a container terminal from somewhere near the sea. An anchor —
 * the obvious choice — says only "maritime", which the map already told you.
 */
export function portGlyphSvg({ state = "nominal", theme = "dark", size = 26 } = {}) {
    const c = INK[theme] || INK.dark
    const gantry = PORT_STATE_COLOR[state] || c.gantry
    // local units run about -6.4..6.4; map that onto the viewBox with margin
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 16 16" width="${size}" height="${size}">`
        + `<path d="M-6.4,5.2 H6.4 M-4.2,6.5 H4.2" fill="none" stroke="${c.water}" stroke-width=".85" opacity=".45"/>`
        + `<path d="M-6.2,3.0 H6.2 V4.3 H-6.2 Z" fill="${c.quay}" opacity=".55"/>`
        + `<path d="M-5.2,-3.6 H5.2 V-2.3 H-5.2 Z M-2.7,-2.3 H-1.7 V3.0 H-2.7 Z M0.9,-2.3 H1.9 V3.0 H0.9 Z" fill="${gantry}"/>`
        + `<path d="M-5.6,0.7 H-3.4 V2.9 H-5.6 Z M-3.2,1.6 H-1.6 V2.9 H-3.2 Z M2.9,1.2 H4.9 V2.9 H2.9 Z" fill="${c.box}" opacity=".95"/>`
        + `</svg>`
}

/**
 * §I6.2 — one runway, two thresholds, a terminal set clear.
 *
 * Four failures the spec found by testing rather than reasoning, all avoided
 * here: two crossed hairlines read as an X (and an X on a chart means wreck
 * or closed); a long thin strip reads as a ruler; a fine dashed centreline
 * reads as ruler ticks; a terminal butted against the runway end merges into
 * an arrow.
 */
export function airportGlyphSvg({ theme = "dark", size = 26 } = {}) {
    const c = INK[theme] || INK.dark
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 16 16" width="${size}" height="${size}">`
        + `<path d="M-5.2,2.8 L3.8,-2.4 L5.2,0.0 L-3.8,5.2 Z" fill="${c.strip}"/>`
        + `<path d="M-3.96,2.53 L-2.96,4.27 M2.96,-1.57 L3.96,0.17 M-0.95,1.45 L0.95,0.35" `
        + `fill="none" stroke="${c.mark}" stroke-width="1.05" opacity=".9" stroke-linecap="butt"/>`
        + `<path d="M-3.7,-1.5 L-1.9,1.35" fill="none" stroke="${c.taxi}" stroke-width="1.1" opacity=".8"/>`
        + `<path d="M-5.8,-3.9 H-2.0 V-1.5 H-5.8 Z" fill="${c.term}" opacity=".95"/>`
        + `</svg>`
}

function toDataUri(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
}

/**
 * Cached per (kind, state, theme) — §I7. "Invalidate the whole cache on theme
 * change. A cached dark-theme glyph over a light-theme globe is the bug you
 * will spend an afternoon on."
 */
export function infraGlyphUri(kind, { state = "nominal", theme = "dark", size = 26 } = {}) {
    const key = `${kind}|${state}|${theme}|${size}`
    const hit = _cache.get(key)
    if (hit) return hit
    const svg = kind === "port"
        ? portGlyphSvg({ state, theme, size })
        : airportGlyphSvg({ theme, size })
    const uri = toDataUri(svg)
    _cache.set(key, uri)
    return uri
}

export function clearInfraGlyphCache() { _cache.clear() }
