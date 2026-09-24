/**
 * forecastSymbols.js — APP-6 frames, drawn, by affiliation AND domain.
 *
 * WHY THE FRAME CARRIES THE DOMAIN. In APP-6 the frame shape is not
 * decoration and not only affiliation: it encodes the battle dimension.
 * A land unit sits in a closed frame; an air unit sits in a frame that
 * arches over the top and is OPEN AT THE BOTTOM, because the symbol is
 * not standing on the ground; a subsurface unit's frame opens upward.
 * Drawing every unit in a land frame, as the first version of this
 * module did, says every formation is a ground formation — which is
 * exactly the claim that makes an air movement look like a road march.
 *
 * The frames here are simplified but not approximated in the ways that
 * change meaning: affiliation is unambiguous, and the dimension is
 * readable at a glance in the open or closed base.
 *
 * ICONS ARE FUNCTION, NOT DECORATION. Infantry is the crossed diagonals,
 * armour the flattened oval, artillery the filled dot, aviation the
 * rotor/fixed-wing bar, naval the hull. A reader who knows the system
 * gets the unit's arm from the glyph; one who does not still gets the
 * affiliation and dimension from the frame.
 */

/** Battle dimensions this console draws. */
export const DOMAINS = ["ground", "air", "sea"]

/**
 * Frame paths, centred on the origin, keyed domain -> affiliation.
 *
 * Air frames are open at the bottom and ground frames are closed; that
 * single difference is what stops an air movement reading as a march.
 */
export const FRAMES = {
    ground: {
        friendly: { d: "M-13,-8 H13 V8 H-13 Z", closed: true },
        hostile:  { d: "M0,-11 L13,0 L0,11 L-13,0 Z", closed: true },
        neutral:  { d: "M-10,-10 H10 V10 H-10 Z", closed: true },
        unknown:  { d: "M-9,-9 Q0,-14 9,-9 Q14,0 9,9 Q0,14 -9,9 Q-14,0 -9,-9 Z", closed: true },
    },
    air: {
        // Arched over the top, open along the base.
        friendly: { d: "M-13,9 V-2 Q-13,-11 0,-11 Q13,-11 13,-2 V9", closed: false },
        hostile:  { d: "M-13,9 L-13,-1 L0,-12 L13,-1 L13,9", closed: false },
        neutral:  { d: "M-10,9 V-10 H10 V9", closed: false },
        unknown:  { d: "M-10,9 V-4 Q-10,-13 0,-13 Q10,-13 10,-4 V9", closed: false },
    },
    sea: {
        // Closed, and wider than tall: a surface contact.
        friendly: { d: "M-15,-7 H15 V7 H-15 Z", closed: true },
        hostile:  { d: "M0,-10 L15,0 L0,10 L-15,0 Z", closed: true },
        neutral:  { d: "M-12,-8 H12 V8 H-12 Z", closed: true },
        unknown:  { d: "M-11,-8 Q0,-13 11,-8 Q15,0 11,8 Q0,13 -11,8 Q-15,0 -11,-8 Z", closed: true },
    },
}

/** Echelon ticks above the frame. */
export const SIZE = {
    team: "Ø", squad: "•", plt: "•••", coy: "I", bn: "II", regt: "III",
    bde: "X", div: "XX", corps: "XXX",
}

/** Function icons, drawn inside the frame. */
export const ICONS = {
    infantry:  "M-7,-5 L7,5 M7,-5 L-7,5",
    armour:    "M-8,0 a8,4.5 0 1,0 16,0 a8,4.5 0 1,0 -16,0",
    artillery: "M0,0 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0",
    recon:     "M-8,5 L8,-5",
    air:       "M-9,0 h18 M-5,-4 L5,4 M5,-4 L-5,4",
    rotary:    "M-9,-3 h18 M0,-3 v7",
    naval:     "M-9,2 q9,6 18,0 M0,2 V-6",
    missile:   "M0,6 V-6 M-4,-1 L0,-6 L4,-1",
    none:      "",
}

export const AFFILIATIONS = ["friendly", "hostile", "neutral", "unknown"]

/**
 * Affiliation colours: APP-6 semantics in the app's own palette.
 *
 * APP-6 specifies saturated cyan/red/green/yellow, and using them
 * literally put four fluorescent colours into a console whose whole
 * palette is muted. This takes the standard's MEANING — red is hostile,
 * blue is friendly, and nothing else may be either — and expresses it in
 * the tokens Analytics already uses. A reader loses nothing: affiliation
 * is carried by hue and by frame shape, both intact.
 *
 * These are CSS variables, so they follow the theme. That is safe here
 * in a way it would not be for an arbitrary colour: --red and --acc are
 * red and blue in BOTH themes, tuned only for contrast, so affiliation
 * never changes meaning — which was the real requirement, not literal
 * hex stability.
 *
 * No glow, no gradient, no fill beyond a flat wash. A symbol that
 * glows is decoration pretending to be emphasis.
 */
export const APP6 = {
    hostile:  { fill: "var(--red)",      frame: "var(--red)" },
    friendly: { fill: "var(--acc-hi)",   frame: "var(--acc)" },
    neutral:  { fill: "var(--txt-4)",    frame: "var(--txt-3)" },
    unknown:  { fill: "var(--amber)",    frame: "var(--amber)" },
}

/** Back-compat alias: the frame colour is what callers used as "tint". */
export const TINT = {
    friendly: APP6.friendly.frame, hostile: APP6.hostile.frame,
    neutral: APP6.neutral.frame, unknown: APP6.unknown.frame,
}

/**
 * Installation symbols. In APP-6 an installation is its affiliation
 * frame with a small filled rectangle centred on the top edge — that
 * modifier is what separates a FACILITY from a unit, and without it an
 * airfield is drawn as though it were a formation standing there.
 */
export const INSTALLATION_TAB = "M-4,-14 h8 v5 h-8 Z"

/** Facility glyphs, drawn inside an installation frame. */
export const FACILITY_ICONS = {
    airfield: "M-8,1 h16 M-4,-4 h8 M0,-4 v9",
    port:     "M0,-6 v11 M-6,1 q6,7 12,0 M-3,-6 h6",
    rail:     "M-7,-4 v9 M7,-4 v9 M-9,-1 h18 M-9,3 h18",
    nuclear:  "M0,0 m-2,0 a2,2 0 1,0 4,0 a2,2 0 1,0 -4,0 M0,-7 l3,5 h-6 Z",
    oil:      "M0,6 V-2 q0,-6 5,-6 M-5,6 h10",
    depot:    "M-7,-5 h14 v10 h-14 Z",
    city:     "M-7,5 v-7 h5 v-4 h4 v11 Z",
}

export const FACILITY_KINDS = Object.keys(FACILITY_ICONS)

/** The fill colour for a unit's affiliation. */
export function fillFor(unit) {
    return (APP6[unit?.aff] || APP6.unknown).fill
}

/** The frame for a unit, falling back to ground rather than throwing. */
export function frameFor(unit) {
    const dom = FRAMES[unit?.domain] ? unit.domain : "ground"
    const aff = FRAMES[dom][unit?.aff] ? unit.aff : "unknown"
    return FRAMES[dom][aff]
}

/** The function glyph for a unit, or "" when it declares none. */
export function iconFor(unit) {
    return ICONS[unit?.icon] ?? ""
}

/** Frame colour for a unit's affiliation. */
export function tintFor(unit) {
    return (APP6[unit?.aff] || APP6.unknown).frame
}

/** The glyph for a facility kind, or "" when unknown. */
export function facilityIcon(kind) {
    return FACILITY_ICONS[kind] ?? ""
}

/**
 * Probable strength for an echelon.
 *
 * Ranges, never a number. A brigade is not 4,000 people; it is a
 * formation that is usually somewhere between three and five thousand,
 * and which arm it is moves that more than which army it belongs to. A
 * single figure here would be invented precision on top of a symbol that
 * is already doctrinal rather than observed.
 */
export const ECHELON_STRENGTH = {
    team:   [4, 12],
    squad:  [8, 14],
    plt:    [25, 55],
    coy:    [80, 250],
    bn:     [300, 1000],
    regt:   [1000, 2500],
    bde:    [3000, 5500],
    div:    [10000, 18000],
    corps:  [30000, 60000],
}

/** "about 3,000–5,500" for an echelon, or null when unknown. */
export function strengthOf(size) {
    const r = ECHELON_STRENGTH[size]
    if (!r) return null
    const fmt = (n) => n.toLocaleString("en-GB")
    return `${fmt(r[0])}–${fmt(r[1])}`
}

/**
 * Which capability a unit's arm draws its equipment from.
 *
 * The map between what a symbol SAYS it is and which Wikipedia section
 * would list its kit. An artillery symbol should show howitzers, not the
 * army's pistols.
 */
export const ICON_CAPABILITY = {
    infantry: "small_arms",
    armour: "armour",
    artillery: "artillery",
    recon: "vehicles",
    air: "aircraft",
    rotary: "rotary",
    naval: "naval",
    missile: "missiles",
    none: null,
}

/** Equipment this unit would plausibly field, from a capability map. */
export function equipmentFor(unit, items) {
    const cap = ICON_CAPABILITY[unit?.icon]
    if (!cap || !items) return []
    return Array.isArray(items[cap]) ? items[cap] : []
}
