/**
 * mapIcons.js — THE ONE ICON TYPOLOGY of the map, phone and globe alike (owner, 2026-10-22/23: "we use too many
 * different icon types on the map, we need one unified icon typology: obviously different icons for different
 * things but not different styles"; "remove the dots that kept getting way too big"). Our own design
 * (docs/DATAMINR_PLAN.md §4e, backlog B9). Every point marker on src/mobile and src/globe is drawn here.
 *
 *   SHAPE    what kind of knowledge it is
 *              circle    a report of something happening (live signal, protest, strike, GDELT is news)
 *              square    confirmed or observed by a sensor or an analyst (imagery, GeoConfirmed, a fire)
 *              triangle  a warning WE derived (surge, fusion, GFW event, a place with a call to act)
 *              diamond   aggregate news coverage (GDELT, RSS)
 *              pin       ours only (assets, safe houses)
 *              hull / plane, turned to the heading: moving traffic
 *              line glyph, no fill: static infrastructure context (port, airport, chokepoint, power, facility)
 *              dot: you, the team, a track's points
 *   GLYPH    inside: WHAT it is (the act, the kind). GLYPH below, one stroke weight
 *   COLOUR   what it means TO YOU, one ramp for every point marker: flash red, urgent amber, alert neutral,
 *            info grey; ours gold (assets) and blue (you, the team, routes). Actor and side colours live only on
 *            areas and lines (claims, arrows) and in card text, never on a point marker. No green for severity.
 *   STATE    one rule everywhere: developing = a ring in the same colour; live = plain; past = hollow at 0.45;
 *            upcoming = hollow with a dashed edge; muted (uncorroborated) = 0.6 with a dotted edge; selected = a
 *            white ring
 *   SIZE     constant on-screen pixels (SIZE), never scaled by zoom or camera distance, never by data
 *            (casualties, port class, a cluster's count). The phone multiplies everything by PHONE_ICON_SCALE.
 *   CLUSTER  one badge (clusterIcon): a dark disc, a ring in the highest priority inside, the count
 *
 * Each SVG is drawn in its on-screen pixels (viewBox = the display box) at 2x for HiDPI, with the one edge
 * colour EDGE at the one stroke weight STROKE. Pure, no DOM; every result is cached.
 */

// ── tokens ──────────────────────────────────────────────────────────────────
export const EDGE = "#070B14"            // the dark outline and the glyph colour on a filled shape
export const STROKE = 1.5                // the one outline weight, in screen pixels
export const GLYPH_STROKE = 1.4          // the one glyph line weight, in screen pixels
export const PRIORITY = { flash: "#E5484D", urgent: "#F5A524", alert: "#9AA9BC", info: "#6B7A90" }
export const PRIORITY_RANK = { flash: 0, urgent: 1, alert: 2, info: 3 }
export const PRIORITY_LABEL = { flash: "Flash", urgent: "Urgent", alert: "Alert", info: "Info" }
export const OURS = { gold: "#C9A227", blue: "#3B8CFF" }
export const TRAFFIC = "#C9D4E3"         // a ship or an aircraft nobody flagged
export const SELECTED = "#FFFFFF"
/** On-screen pixels. Constant at every zoom. */
export const SIZE = { event: 24, traffic: 16, infra: 18, pin: { w: 30, h: 36 }, me: 16, team: 12, dot: 12, small: 10, cluster: 30 }
export const ICON_PX = SIZE.event
export const CLUSTER_PX = SIZE.cluster
/** The phone draws every marker a fifth larger than the desktop (owner, 2026-10-17), all of them. */
export const PHONE_ICON_SCALE = 1.2
export const STATES = ["live", "developing", "past", "upcoming", "muted"]
export const STATE_ALPHA = { live: 1, developing: 1, past: 0.45, upcoming: 1, muted: 0.6 }
export const KIND_SHAPE = { event: "circle", confirmed: "square", derived: "triangle", news: "diamond" }
const SS = 2                             // supersample: the SVG's pixel size is 2x its display size

/**
 * Back-compat names for line colours (a crowd's path, a police route). Point markers never read these: they take
 * PRIORITY / OURS / TRAFFIC.
 */
export const PALETTE = { red: PRIORITY.flash, amber: PRIORITY.urgent, grey: PRIORITY.alert, blue: OURS.blue, sky: PRIORITY.alert }

// ── colour = what it means to you ───────────────────────────────────────────
const SEV_TO_PRIORITY = {
    flash: "flash", critical: "flash", red: "flash", severe: "flash",
    urgent: "urgent", high: "urgent", significant: "urgent", amber: "urgent", elevated: "urgent",
    alert: "alert", medium: "alert", moderate: "alert", grey: "info", gray: "info",
    info: "info", low: "info", quiet: "info", unknown: "info", none: "info",
}
/** A severity word (critical / high / medium / low, red / amber / grey, an exposure) → a priority. */
export function priorityOf(sev, fallback = "alert") {
    if (sev && PRIORITY[sev]) return sev
    return SEV_TO_PRIORITY[String(sev || "").toLowerCase()] || fallback
}
/** The colour of a priority (or of a severity word). */
export const priorityColor = (p) => PRIORITY[priorityOf(p)]
/** The highest of several priorities. */
export const topPriority = (list) => (list || []).map((p) => priorityOf(p, "info")).sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0] || null

// ── glyphs: what it is. Paths in a 24 grid unless `box` says otherwise; `fill` glyphs are solid shapes ──
const g = (d, extra = {}) => ({ d, box: 24, ...extra })
export const GLYPH = {
    // the nine acts on the ground (lib/liveSignals.js ACTS), drawn in a 32 grid
    arrest: g("M9 16a3 3 0 106 0 3 3 0 00-6 0M9 16v-2M15 16v-2M12 19v2", { box: 32, dx: 4 }),
    shots_fired: g("M7 16h8l3-2v4l-3-2M7 16l-2 4M10 13l1-2", { box: 32, dx: 4 }),
    explosion: g("M16 7l1.5 4.5L22 12l-4 3 1.5 5L16 17l-3.5 3 1.5-5-4-3 4.5-.5z", { box: 32 }),
    strike: g("M16 6v9M12 12l4 5 4-5M9 22h14", { box: 32 }),
    missile_launch: g("M10 22l10-12M17 9h4v4M9 18l3 3", { box: 32 }),
    missile_impact: g("M16 8v7M13 12l3 4 3-4M10 21h12M12 18l-2 3M20 18l2 3", { box: 32 }),
    crowd: g("M11 15a2 2 0 104 0 2 2 0 00-4 0M17 15a2 2 0 104 0 2 2 0 00-4 0M8 22c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5M16 22c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5", { box: 32 }),
    troops: g("M8 22v-9l8-5 8 5v9M12 22v-5h8v5", { box: 32 }),
    police: g("M16 7l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8v-5z", { box: 32 }),
    crime: g("M3.5 8h15.5v3.6h-7.2l-1.3 2.6H8.3L7 19.5H3.9l1.6-7.9H3.5zM19 9.2h1.5M10.5 11.6v2.6"),
    placard: g("M11 9h10v7H11zM16 16v8M13 24h6", { box: 32 }),
    clash: g("M10 10l12 12M22 10L10 22M16 7v3M16 22v3", { box: 32 }),
    // strikes & control (globe/strikes.js acts)
    airstrike: g("M12 21c-2.6 0-4.1-2.4-4.1-5.9S9.4 8.7 12 8.7s4.1 3 4.1 6.4S14.6 21 12 21zM9.7 9.1 8.5 4h7l-1.2 5.1M12 4v4.7"),
    missile: g("M19.5 4.5c-3 .2-5.6 1.5-7.6 3.5L7.8 12.1l4.1 4.1 4.1-4.1c2-2 3.3-4.6 3.5-7.6zM7.8 12.1 4.8 11.4 3.5 12.7l3 1.5M11.9 16.2l.7 3-1.3 1.3-1.5-3M6.6 17.4l-2.1 2.1"),
    drone: g("M12 3.5 20 18l-5.6-1.6L12 20.5l-2.4-4.1L4 18zM12 3.5v12.9"),
    shelling: g("M9.3 20V10.6c0-3.1 1.1-5.4 2.7-7.1 1.6 1.7 2.7 4 2.7 7.1V20zM7.8 20h8.4M9.3 14.3h5.4M9.3 16.7h5.4"),
    naval: g("M3 15h18l-2.7 4H5.7zM5.7 15v-3h9v3M8.3 12V8.8h3.6V12M10.1 8.8V5M14.7 12.7l4.5-2.2"),
    assault: g("M5 5l14 14M19 5L5 19M5 5v3M5 5h3M19 5v3M19 5h-3"),
    control: g("M6.5 21V3.5M6.5 4.5h11l-2.5 3.8 2.5 3.7h-11"),
    interception: g("M12 20.5s7-3.3 7-8.8V5.6L12 3 5 5.6v6.1c0 5.5 7 8.8 7 8.8zM9 11.8l2.1 2.1 4-4.2"),
    launch: g("M12 4v10M8 8l4-4 4 4M7 20h10"),
    // sensors and analysts
    imagery: g("M16 9v14M9 16h14", { box: 32 }),
    check: g("M7 12.5l3.2 3.2L17 8.5"),
    flame: g("M12 4c2.5 3 5 5 5 8.6a5 5 0 01-10 0c0-1.7.8-3 1.7-3.8.1 1.6.9 2.5 1.8 2.5 0-2.6.6-5 1.5-7.3z"),
    detection: g("M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4M10 12h4"),
    // derived warnings
    surge: g("M5 17l4-5 3 3 6-8M14 7h4v4"),
    fusion: g("M5 7l7 6 7-6M12 13v6"),
    encounter: g("M7 18l3.5-10M17 18l-3.5-10M9 13h6"),
    gap: g("M5 13h4M15 13h4M10.5 9l3 8"),
    loiter: g("M15.5 9.3a5 5 0 11-6.4-.4M9 6v3h3"),
    port_visit: g("M12 6v12M9 9h6M7 14a5 5 0 0010 0"),
    warning: g("M12 8v5M12 16v.5"),
    // news coverage
    news: g("M7 8h10M7 12h10M7 16h6"),
    // ours (globe/GlobeAssetsLayer.jsx groups)
    Vessels: g("M3 15h18l-2.5 4.5H5.5zM6 15V9h7l3 6M9 9V5.5h2.5V9"),
    Aircraft: g("M12 3v18M12 9l9 4v2l-9-2.5M12 9l-9 4v2l9-2.5M9.5 20l2.5-1.5 2.5 1.5"),
    Vehicles: g("M3 16V9.5l2.5-3h9l3 4H21V16zM6.5 18.5a1.8 1.8 0 100-.01M16.5 18.5a1.8 1.8 0 100-.01"),
    Sites: g("M3 20V10l5 3V10l5 3V7h3v13zM18 20V4h3v16"),
    Energy: g("M13 2L5 13h6l-1 9 8-11h-6z"),
    Transport: g("M4 20h16M6 20V12h12v8M9 12V7h6v5M12 7V3"),
    People: g("M12 4a3.2 3.2 0 100 6.4A3.2 3.2 0 0012 4zM5 20c.8-4 3.6-6 7-6s6.2 2 7 6"),
    Telecoms: g("M12 4v16M8.5 20l3.5-8 3.5 8M7 8a7 7 0 0 1 10 0M5 5a10 10 0 0 1 14 0"),
    house: g("M3.5 11l8.5-7 8.5 7M5.5 9.5V20h13V9.5M9 14.5l2.2 2.2 4-4.4"),
    // infrastructure context (line glyphs)
    port: g("M3 20h18M6 20V5h11M6 5 3 9M10.5 5v15M14 5v4h3"),
    airport: g("M4 15.5 15.5 4l3 3L7 18.5zM8.5 11l3.5 3.5M3 21h7"),
    chokepoint: g("M4 3c4 3.5 5.5 6.5 5.5 9S8 17.5 4 21M20 3c-4 3.5-5.5 6.5-5.5 9s1.5 5.5 5.5 9"),
    power_plant: g("M13 2 5 13h6l-1 9 8-11h-6z"),
    substation: g("M4 6h16v12H4zM8 6v12M16 6v12M4 12h16"),
    wind_turbine: g("M12 12 12 3M12 12l7.5 4.5M12 12l-7.5 4.5M12 12v10"),
    telecom_mast: g("M12 4v18M8 22l4-10 4 10M7 7a7 7 0 0 1 10 0M5 4.5a10 10 0 0 1 14 0"),
    data_center: g("M5 4h14v5H5zM5 10h14v5H5zM5 16h14v4H5zM8 6.5h.01M8 12.5h.01"),
    well: g("M4 20h16M7 20l5-12 5 12M5 9l14-4M12 8v-4"),
    petroleum_site: g("M4 20V10a4 4 0 0 1 8 0v10M12 20v-7a4 4 0 0 1 8 0v7M3 20h18"),
    hospital: g("M12 5v14M5 12h14"),
    police_station: g("M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"),
    fire_station: g("M12 3.5c2.8 3.3 5.5 5.5 5.5 9.4a5.5 5.5 0 01-11 0c0-1.9.9-3.3 1.9-4.2.1 1.8 1 2.8 2 2.8 0-2.9.6-5.5 1.6-8z"),
    military: g("M5 5l14 14M19 5L5 19M5 5v3M5 5h3M19 5v3M19 5h-3"),
    bunker: g("M3 18h18M5 18v-3a7 7 0 0114 0v3"),
    // endangered places (globe/endangeredPlaces.js kinds), line glyphs
    refinery: g("M4 20V11l5 3v-3l5 3V5h3v15z"),
    fuel_depot: g("M5 9q7-4 14 0v9q-7 3.5-14 0z"),
    fuel_station: g("M6 5h8v15H6zM14 9l3.5 2v6q0 2.5 2 1.5V9"),
    gathering: g("M7 3.5v17M7.5 4.5H18l-3 4 3 4H7.5"),
    roundabout: g("M12 5.8a6.2 6.2 0 100 12.4 6.2 6.2 0 000-12.4zM12 10a2 2 0 100 4 2 2 0 000-4z"),
    arms_company: g("M12 6a6 6 0 100 12 6 6 0 000-12zM12 3v5M12 16v5M3 12h5M16 12h5"),
    assembly: g("M6 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM12 5.5a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4zM18 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2.5 19q3.5-6.5 7 0M8 19q4-8 8 0M14.5 19q3.5-6.5 7 0"),
    raised_fist: g("M8 11V7.5a1.5 1.5 0 013 0V7a1.5 1.5 0 013 0v1a1.5 1.5 0 013 0v5q0 4-3.5 4.5V21H9v-3.5Q7 16.5 8 14z"),
    action: g("M4 10h4l9-5v14l-9-5H4zM6 14.5 7.5 20H10l-1-5.5M19.5 9.5q1.5 2.5 0 5"),
    lobby_office: g("M3 9l9-5 9 5zM5.5 10.5v7M12 10.5v7M18.5 10.5v7M3.5 19.5h17"),
    generic: g("M12 8v8M8 12h8"),
}
const glyphOf = (k) => (typeof k === "string" ? (GLYPH[k] || (k.startsWith("M") ? { d: k, box: 32 } : GLYPH.generic)) : (k || null))

/** How many grid units a glyph's drawing spans, per grid (the rest is margin). */
const CONTENT = { 24: 18, 32: 17 }
/** The glyph, its drawing `s` px across, centred at (cx, cy), in `color`, at the one glyph weight. */
function glyphMarkup(glyph, color, cx, cy, s) {
    const gl = glyphOf(glyph)
    if (!gl) return ""
    const k = s / (CONTENT[gl.box] || gl.box * 0.75)
    const tx = cx - (gl.box / 2) * k + (gl.dx || 0) * k
    const ty = cy - (gl.box / 2) * k + (gl.dy || 0) * k
    const sw = (GLYPH_STROKE / k).toFixed(2)
    return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})"><path d="${gl.d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></g>`
}

const enc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const svgOpen = (w, h, opacity = 1) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w * SS}" height="${h * SS}" viewBox="0 0 ${w} ${h}"${opacity < 1 ? ` opacity="${opacity}"` : ""}>`
const _cache = new Map()
const cached = (key, make) => { if (!_cache.has(key)) _cache.set(key, make()); return _cache.get(key) }

// ── the four knowledge shapes, in a 24 px box centred at 12 ─────────────────
const SHAPE = {
    circle: () => `<circle cx="12" cy="12" r="8.6"`,
    square: () => `<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="2"`,
    diamond: () => `<path d="M12 2.4L21.6 12L12 21.6L2.4 12Z"`,
    triangle: () => `<path d="M12 2.6L21.2 19.2H2.8Z"`,
}
const GLYPH_BOX = { circle: 11, square: 10.5, diamond: 9.5, triangle: 8.5 }
const GLYPH_DY = { circle: 0, square: 0, diamond: 0, triangle: 2.8 }

/**
 * The marker of a report, a confirmation, a derived warning or news: { uri, w, h, anchor }.
 *   kind      event | confirmed | derived | news (or shape: circle | square | triangle | diamond)
 *   glyph     a GLYPH key (or a raw 32-grid path)
 *   priority  flash | urgent | alert | info, or a severity word; `color` overrides (ours only)
 *   state     live | developing | past | upcoming | muted; `selected` adds the white ring
 *   bearing   degrees: an arrowhead on the edge toward where it moves
 */
export function markerIcon({ kind = "event", shape = null, glyph = null, priority = "alert", color = null, state = "live",
                             selected = false, bearing = null } = {}) {
    const sh = shape || KIND_SHAPE[kind] || "circle"
    const col = color || PRIORITY[priorityOf(priority)]
    const st = STATE_ALPHA[state] != null ? state : "live"
    const b = Number.isFinite(bearing) ? Math.round(bearing / 15) * 15 : null
    const gk = typeof glyph === "string" ? glyph : JSON.stringify(glyph)
    const key = `m|${sh}|${col}|${gk}|${st}|${selected ? 1 : 0}|${b}`
    return cached(key, () => {
        const S = SIZE.event
        const hollow = st === "past" || st === "upcoming"
        const fill = hollow ? `fill="${EDGE}" fill-opacity="0.72"` : `fill="${col}"`
        const edge = hollow ? col : EDGE
        const dash = st === "upcoming" ? ` stroke-dasharray="2.6 1.8"` : st === "muted" ? ` stroke-dasharray="0.1 2.4" stroke-linecap="round"` : ""
        const ew = st === "muted" ? 2 : STROKE
        let svg = svgOpen(S, S, STATE_ALPHA[st])
        if (st === "developing") svg += `<circle cx="12" cy="12" r="11" fill="none" stroke="${col}" stroke-width="1.8"/>`
        if (selected) svg += `<circle cx="12" cy="12" r="11" fill="none" stroke="${SELECTED}" stroke-width="2"/>`
        if (st === "muted") svg += `${SHAPE[sh]()} fill="${col}" stroke="none"/>`
        svg += `${SHAPE[sh]()} ${st === "muted" ? `fill="none"` : fill} stroke="${edge}" stroke-width="${ew}" stroke-linejoin="round"${dash}/>`
        svg += glyphMarkup(glyph, hollow ? col : EDGE, 12, 12 + GLYPH_DY[sh], GLYPH_BOX[sh])
        if (b !== null) svg += `<path d="M12 .4l3 3.6H9z" fill="${col}" stroke="${EDGE}" stroke-width="0.8" transform="rotate(${b} 12 12)"/>`
        svg += `</svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [S / 2, S / 2], kind: sh }
    })
}
/** Just the data URI of markerIcon(). */
export const markerUri = (o) => markerIcon(o).uri

// ── ours: the pin ───────────────────────────────────────────────────────────
const PIN_PATH = "M15 35.2 10.6 28.5H5a3.5 3.5 0 0 1-3.5-3.5V5A3.5 3.5 0 0 1 5 1.5h20A3.5 3.5 0 0 1 28.5 5v20a3.5 3.5 0 0 1-3.5 3.5h-5.6Z"
/**
 * Ours: the pin, 30x36, standing on its point. A gold tile with the glyph; the pin's edge says what it means to
 * you (an asset's exposure: high = flash … quiet = info). `tone`: gold (assets, safe houses) or blue (the team's).
 * `state` past = hollow and faint (a closed safe house); `badge` = a check in the corner (a safe house).
 */
export function pinIcon({ glyph = "Sites", priority = "info", tone = "gold", state = "live", badge = null, selected = false } = {}) {
    const key = `pin|${typeof glyph === "string" ? glyph : JSON.stringify(glyph)}|${priority}|${tone}|${state}|${badge}|${selected ? 1 : 0}`
    return cached(key, () => {
        const { w, h } = SIZE.pin
        const tile = OURS[tone] || OURS.gold
        const ring = selected ? SELECTED : PRIORITY[priorityOf(priority, "info")]
        const hollow = state === "past"
        let svg = svgOpen(w, h, STATE_ALPHA[state] ?? 1)
        svg += `<path d="${PIN_PATH}" fill="${EDGE}" stroke="${ring}" stroke-width="${selected ? 2 : STROKE + 0.5}" stroke-linejoin="round"/>`
        svg += `<rect x="4.5" y="4.5" width="21" height="21" rx="2.5" fill="${hollow ? "none" : tile}" stroke="${hollow ? tile : "none"}" stroke-width="${STROKE}"${hollow ? ` stroke-dasharray="2.6 1.8"` : ""}/>`
        svg += glyphMarkup(glyph, hollow ? tile : EDGE, 15, 15, 14)
        if (badge === "check") svg += `<circle cx="24" cy="6" r="4.6" fill="${EDGE}" stroke="${tile}" stroke-width="1.2"/>${glyphMarkup("check", tile, 24, 6, 5.5)}`
        svg += `</svg>`
        return { uri: enc(svg), w, h, anchor: [w / 2, h], kind: "pin" }
    })
}

// ── moving traffic: a hull or an aircraft, nose up; the caller turns it to the heading ──
const HULL = "M16 3 L21 10 L21 27 Q16 30 11 27 L11 10 Z"
const PLANE = "M16 2.5 C17.3 2.5 17.6 4.5 17.6 6.5 V12.5 L28.5 18.5 V21 L17.6 17.8 V24.5 L21 27.2 V29 L16 27.6 L11 29 V27.2 L14.4 24.5 V17.8 L3.5 21 V18.5 L14.4 12.5 V6.5 C14.4 4.5 14.7 2.5 16 2.5 Z"
/** Traffic tone: neutral, amber = watchlisted / sanctioned / military of interest, red = flash for you. */
export function trafficTone(x = {}) {
    if (x.priority === "flash") return "flash"
    if (x.sanctioned || x.watchlisted || x.watchlist || x.military || x.interesting || x.of_interest) return "urgent"
    return "neutral"
}
/** A ship or an aircraft, 16 px, nose up: { uri, w, h, anchor }. `tone`: neutral | urgent | flash. */
export function trafficIcon({ kind = "ship", tone = "neutral", selected = false } = {}) {
    return cached(`tr|${kind}|${tone}|${selected ? 1 : 0}`, () => {
        const S = SIZE.traffic
        const fill = tone === "neutral" ? TRAFFIC : PRIORITY[priorityOf(tone)]
        const svg = svgOpen(S, S)
            + `<g transform="scale(0.5)"><path d="${kind === "plane" || kind === "aircraft" ? PLANE : HULL}" fill="${fill}" stroke="${selected ? SELECTED : EDGE}" stroke-width="${(STROKE * 2).toFixed(1)}" stroke-linejoin="round"/></g>`
            + `</svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [S / 2, S / 2], kind: kind === "aircraft" ? "plane" : kind }
    })
}
/** The 3D model's tint for a tone (the model is the same object as the icon, close up). */
export const trafficTint = (tone) => (tone === "neutral" ? TRAFFIC : PRIORITY[priorityOf(tone)])

// ── infrastructure context: a line glyph, no fill, neutral, on a dark halo ──
/** Port, airport, chokepoint, power, facility: { uri, w, h, anchor }. One size; `priority` only for a state (port congestion). */
export function infraIcon({ glyph = "port", priority = null, state = "live" } = {}) {
    return cached(`inf|${typeof glyph === "string" ? glyph : JSON.stringify(glyph)}|${priority}|${state}`, () => {
        const S = SIZE.infra
        const col = priority ? PRIORITY[priorityOf(priority)] : TRAFFIC
        const gl = glyphOf(glyph)
        const k = (S - 2) / gl.box
        const t = `translate(1 1) scale(${k.toFixed(4)})`
        const svg = svgOpen(S, S, STATE_ALPHA[state] ?? 1)
            + `<g transform="${t}" fill="none" stroke-linecap="round" stroke-linejoin="round">`
            + `<path d="${gl.d}" stroke="${EDGE}" stroke-width="${((GLYPH_STROKE + 2.2) / k).toFixed(2)}" stroke-opacity="0.85"/>`
            + `<path d="${gl.d}" stroke="${col}" stroke-width="${(STROKE / k).toFixed(2)}"/></g></svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [S / 2, S / 2], kind: "infra" }
    })
}

// ── dots: you, the team, a track's points, an annotation ────────────────────
/**
 * role: me (16: a small blue dot with a soft blue glow, nothing else; owner, 2026-10-23) | team (12, blue) | start (hollow blue) | end (filled blue) | stop (amber) |
 * now (blue, white ring) | endpoint (10 hollow, in `priority`) | note (10 gold). `live` false = hollow;
 * `coarse` = a dotted edge (a city-level fix). `label`: a short text inside (a stop's number).
 */
export function dotIcon({ role = "team", live = true, coarse = false, label = null, priority = null } = {}) {
    return cached(`dot|${role}|${live ? 1 : 0}|${coarse ? 1 : 0}|${label}|${priority}`, () => {
        const S = role === "me" ? SIZE.me : role === "endpoint" || role === "note" ? SIZE.small : label ? 16 : SIZE.dot
        const c = S / 2
        const col = role === "stop" ? PRIORITY.urgent : role === "note" ? OURS.gold : role === "endpoint" ? PRIORITY[priorityOf(priority || "alert")] : OURS.blue
        const hollow = !live || role === "start" || role === "endpoint"
        const edge = role === "me" || role === "team" || role === "now" ? SELECTED : EDGE
        const r = c - (role === "me" ? 1.5 : 1.25)
        const dash = coarse ? ` stroke-dasharray="1.6 1.6"` : ""
        if (role === "me") {
            // a small blue glowing dot only: no white ring, no dotted circle; not live = the same dot, fainter, no glow
            const me = svgOpen(S, S, live ? 1 : 0.6)
                + `<defs><radialGradient id="g"><stop offset="0.35" stop-color="${OURS.blue}" stop-opacity="0.55"/><stop offset="1" stop-color="${OURS.blue}" stop-opacity="0"/></radialGradient></defs>`
                + (live ? `<circle cx="${c}" cy="${c}" r="${c}" fill="url(#g)"/>` : "")
                + `<circle cx="${c}" cy="${c}" r="4.2" fill="${OURS.blue}" stroke="#8FBCFF" stroke-width="1"/></svg>`
            return { uri: enc(me), w: S, h: S, anchor: [c, c], kind: "dot" }
        }
        let svg = svgOpen(S, S)
        svg += hollow
            ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${EDGE}" fill-opacity="0.6" stroke="${col}" stroke-width="${role === "me" ? 2 : STROKE}"${dash}/>`
            : `<circle cx="${c}" cy="${c}" r="${r}" fill="${col}" stroke="${edge}" stroke-width="${role === "me" || role === "now" ? 2 : STROKE}"${dash}/>`
        if (label != null) svg += `<text x="${c}" y="${c}" dy="0.36em" text-anchor="middle" font-family="-apple-system,system-ui,Helvetica,Arial,sans-serif" font-size="9" font-weight="700" fill="${EDGE}">${String(label).slice(0, 2)}</text>`
        svg += `</svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [c, c], kind: "dot" }
    })
}

// ── new on the map: one ring, briefly (owner, 2026-10-24) ──────────────────
/**
 * A new item pulses: one ring in its priority colour, edged dark like every mark, grows from the marker's own
 * size to PULSE.to times it and fades, PULSE.iterations times over PULSE.ms; then the marker rests at its
 * constant size. The same on the phone (a CSS animation of this image) and the globe (a billboard scaled by time).
 */
export const PULSE = { ms: 2800, iterations: 2, from: 1, to: 2.4 }
export function pulseRingIcon(priority = "alert") {
    const p = priorityOf(priority)
    return cached(`pulse|${p}`, () => {
        const S = SIZE.event
        const svg = svgOpen(S, S)
            + `<circle cx="12" cy="12" r="10.6" fill="none" stroke="${EDGE}" stroke-opacity="0.55" stroke-width="${STROKE + 1.6}"/>`
            + `<circle cx="12" cy="12" r="10.6" fill="none" stroke="${PRIORITY[p]}" stroke-width="${STROKE + 0.5}"/>`
            + `</svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [S / 2, S / 2], kind: "pulse" }
    })
}
/** The ring's scale and opacity at `elapsed` ms (both maps draw from this). null when the pulse is over. */
export function pulseFrame(elapsed) {
    if (!(elapsed >= 0) || elapsed >= PULSE.ms) return null
    const one = PULSE.ms / PULSE.iterations
    const k = (elapsed % one) / one
    return { scale: PULSE.from + (PULSE.to - PULSE.from) * k, alpha: 0.95 * (1 - k) }
}

// ── the one cluster badge ───────────────────────────────────────────────────
/** A cluster: a dark disc, a ring in the highest priority inside, the count. Constant size whatever the count. */
export function clusterIcon(n, priority = null) {
    const p = priority ? priorityOf(priority) : "alert"
    const label = n > 999 ? "999+" : n > 99 && n <= 999 ? String(n) : String(n)
    return cached(`cl|${label}|${p}`, () => {
        const S = SIZE.cluster
        const svg = svgOpen(S, S)
            + `<circle cx="15" cy="15" r="13.4" fill="${EDGE}" fill-opacity="0.92" stroke="${PRIORITY[p]}" stroke-width="2.4"/>`
            + `<text x="15" y="15" dy="0.36em" text-anchor="middle" font-family="-apple-system,system-ui,Helvetica,Arial,sans-serif" font-size="${label.length > 3 ? 8.5 : label.length > 2 ? 10 : 12}" font-weight="700" fill="#F1F3F5">${label}</text>`
            + `</svg>`
        return { uri: enc(svg), w: S, h: S, anchor: [S / 2, S / 2], kind: "cluster" }
    })
}
export const clusterUri = (n, p) => clusterIcon(n, p).uri

/** Decode an icon's SVG (tests, the legend's checks). */
export function svgOf(uri) {
    const s = String(uri || "")
    if (s.includes(";base64,")) return typeof atob === "function" ? atob(s.split(",")[1]) : Buffer.from(s.split(",")[1], "base64").toString()
    return decodeURIComponent(s.slice(s.indexOf(",") + 1))
}

// ── the kinds every layer draws, in one table (the legend reads it too) ────
/** Imagery signal: the sensor family, a square with the target glyph, its severity → priority. */
export function imageryIcon(sev, state = "live") {
    return markerUri({ kind: "confirmed", glyph: "imagery", priority: priorityOf(sev, "alert"), state })
}

/**
 * THE LEGEND, one definition for the phone and the desktop: shapes (what kind of knowledge), colours (what it
 * means to you), states. Each row: { key, label, uri, w, h }.
 */
export const LEGEND = {
    shapes: [
        { key: "event", label: "Reported event", icon: () => markerIcon({ kind: "event", glyph: "placard", priority: "alert" }) },
        { key: "confirmed", label: "Confirmed or observed", icon: () => markerIcon({ kind: "confirmed", glyph: "check", priority: "alert" }) },
        { key: "derived", label: "Warning we derived", icon: () => markerIcon({ kind: "derived", glyph: "surge", priority: "alert" }) },
        { key: "news", label: "News coverage", icon: () => markerIcon({ kind: "news", glyph: "news", priority: "alert" }) },
        { key: "ours", label: "Ours (assets, safe houses)", icon: () => pinIcon({ glyph: "Sites" }) },
        { key: "traffic", label: "Ship, aircraft", icon: () => trafficIcon({ kind: "ship" }) },
        { key: "infra", label: "Infrastructure", icon: () => infraIcon({ glyph: "port" }) },
        { key: "you", label: "You, the team", icon: () => dotIcon({ role: "me" }) },
        { key: "place", label: "Several things at one place: the most important is drawn, its card lists the others", icon: () => markerIcon({ kind: "event", glyph: "crowd", priority: "urgent" }) },
    ],
    colours: [
        { key: "flash", label: "Flash", icon: () => markerIcon({ kind: "event", priority: "flash" }) },
        { key: "urgent", label: "Urgent", icon: () => markerIcon({ kind: "event", priority: "urgent" }) },
        { key: "alert", label: "Alert", icon: () => markerIcon({ kind: "event", priority: "alert" }) },
        { key: "info", label: "Info", icon: () => markerIcon({ kind: "event", priority: "info" }) },
    ],
    states: [
        { key: "developing", label: "Developing", icon: () => markerIcon({ kind: "event", priority: "urgent", state: "developing" }) },
        { key: "live", label: "Live", icon: () => markerIcon({ kind: "event", priority: "urgent" }) },
        { key: "past", label: "Past", icon: () => markerIcon({ kind: "event", priority: "urgent", state: "past" }) },
        { key: "upcoming", label: "Upcoming", icon: () => markerIcon({ kind: "event", priority: "urgent", state: "upcoming" }) },
        { key: "muted", label: "Not corroborated", icon: () => markerIcon({ kind: "event", priority: "urgent", state: "muted" }) },
    ],
}
/** The legend as plain rows: [{ section, rows: [{ key, label, uri, w, h }] }]. */
export function legendRows() {
    return [["What it is", LEGEND.shapes], ["What it means to you", LEGEND.colours], ["State", LEGEND.states]].map(([section, rows]) => ({
        section, rows: rows.map((r) => { const i = r.icon(); return { key: r.key, label: r.label, uri: i.uri, w: i.w, h: i.h } }),
    }))
}

/** Back-compat: the shared badge of the earlier pass (shape + colour + glyph). Prefer markerIcon. */
export function badgeUri({ shape = "circle", color = null, priority = "alert", glyph = "", bearing = null, muted = false, state = null } = {}) {
    return markerUri({ shape, color, priority, glyph: glyph || null, bearing, state: state || (muted ? "muted" : "live") })
}
