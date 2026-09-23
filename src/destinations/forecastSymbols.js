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

/** Affiliation colours. Deliberately not the globe's track colours. */
export const TINT = {
    friendly: "#5AC8FA", hostile: "#FF6B6B",
    neutral:  "#8E8E93", unknown: "#FFD166",
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

/** Colour for a unit's affiliation. */
export function tintFor(unit) {
    return TINT[unit?.aff] || TINT.unknown
}
