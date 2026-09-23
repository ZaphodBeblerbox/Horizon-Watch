/**
 * forecastTemplate.js — APP-6 frames and the doctrinal template's geometry.
 *
 * WHAT THE TEMPLATE IS FOR, AND THE DANGER IN IT (spec F8). It is not a
 * claim that anything has been observed, and not a claim that the model
 * knows anyone's axes of advance. It is a way of asking "what would this
 * look like" fast enough to check against judgement.
 *
 *   "An animation that looks like intelligence and is actually a
 *    template is the single most dangerous object in this module."
 *
 * So the stamp is not dismissible, the doctrine is named, and every
 * frame carries the warning. Those are enforced in the component; this
 * file holds the parts that can be silently WRONG rather than merely
 * misleading — the symbology and the interpolation.
 *
 * SYMBOLS ARE DRAWN, NOT IMPORTED. An intelligence console that gets
 * military symbology approximately right is worse than one that does not
 * attempt it: an approximately-right frame is a claim about affiliation
 * that the reader will believe.
 */

/** APP-6 affiliation frames, as path data centred on the origin. */
export const FRAME = {
    friendly: "M-13,-8 H13 V8 H-13 Z",
    hostile: "M0,-11 L13,0 L0,11 L-13,0 Z",
    neutral: "M-10,-10 H10 V10 H-10 Z",
    unknown: "M-9,-9 Q0,-14 9,-9 Q14,0 9,9 Q0,14 -9,9 Q-14,0 -9,-9 Z",
}

/** Echelon ticks above the frame. */
export const SIZE = {
    coy: "I", bn: "II", regt: "III", bde: "X", div: "XX", corps: "XXX",
}

export const AFFILIATIONS = Object.keys(FRAME)

/** How long a template runs, in ms. */
export const RUN_MS = 6000

/**
 * The templates. Each is a doctrine made visible, and names the doctrine
 * it comes from so the reader can disagree with the doctrine rather than
 * with the picture.
 */
export const TPL = {
    incursion: {
        doctrine: "Combined-arms: reconnaissance-fire contact, artillery "
                + "preparation, then penetration on a narrow front.",
        line: "M330,18 L330,222", lineLabel: "border",
        units: [
            { x: 90, y: 60, aff: "hostile", size: "bde", id: "1", to: [300, 88] },
            { x: 90, y: 150, aff: "hostile", size: "bn", id: "2", to: [300, 152] },
            { x: 42, y: 108, aff: "hostile", size: "div", id: "A", to: [180, 108] },
            { x: 470, y: 80, aff: "friendly", size: "bn", id: "E", to: [392, 92] },
            { x: 470, y: 168, aff: "friendly", size: "coy", id: "N", to: [392, 158] },
        ],
    },
    hybrid: {
        doctrine: "Pressure below the threshold of armed attack: interference, "
                + "provocation and cyber, calibrated to stay under a response.",
        line: "M330,18 L330,222", lineLabel: "border · no crossing",
        units: [
            { x: 96, y: 108, aff: "unknown", size: "coy", id: "C", to: [250, 108] },
            { x: 470, y: 72, aff: "friendly", size: "coy", id: "E", to: [470, 72] },
            { x: 470, y: 164, aff: "friendly", size: "coy", id: "P", to: [470, 164] },
        ],
    },
    demo: {
        doctrine: "Demonstration: forces moved and exercised visibly. "
                + "Signalling, not preparation.",
        line: "M330,18 L330,222", lineLabel: "border · demonstration only",
        units: [
            { x: 80, y: 70, aff: "hostile", size: "regt", id: "1", to: [200, 70] },
            { x: 80, y: 150, aff: "hostile", size: "regt", id: "2", to: [200, 150] },
            { x: 470, y: 110, aff: "friendly", size: "bn", id: "E", to: [470, 110] },
        ],
    },
    reroute: {
        doctrine: "Littoral interdiction: episodic attack calibrated to the "
                + "insurance response rather than to tonnage destroyed.",
        line: "M300,80 L300,160", lineLabel: "chokepoint",
        units: [
            { x: 70, y: 170, aff: "neutral", size: "coy", id: "M", to: [470, 60] },
            { x: 70, y: 190, aff: "neutral", size: "coy", id: "M", to: [470, 80] },
            { x: 300, y: 118, aff: "hostile", size: "bn", id: "X", to: [300, 118] },
        ],
    },
    strike: {
        doctrine: "Interdiction against a node rather than a corridor, which "
                + "changes who is exposed.",
        line: "M400,70 L400,170", lineLabel: "terminal",
        units: [
            { x: 120, y: 80, aff: "hostile", size: "bn", id: "A", to: [400, 120] },
            { x: 400, y: 120, aff: "neutral", size: "coy", id: "P", to: [400, 120] },
        ],
    },
}

export const TEMPLATE_KEYS = Object.keys(TPL)

/** Whether a unit actually moves, so static ones get no axis or chevron. */
export function isMoving(u) {
    return !!u && (u.to?.[0] !== u.x || u.to?.[1] !== u.y)
}

/** A unit's position at time t in [0,1]. Linear: a template is not a track. */
export function positionAt(u, t) {
    const k = Math.max(0, Math.min(1, Number(t) || 0))
    return { x: u.x + (u.to[0] - u.x) * k, y: u.y + (u.to[1] - u.y) * k }
}

/** Chevron path ahead of a moving unit, or null when it is not moving. */
export function chevron(u, t) {
    if (!isMoving(u) || t <= 0.02) return null
    const { x, y } = positionAt(u, t)
    const a = Math.atan2(u.to[1] - u.y, u.to[0] - u.x)
    const tipX = x + Math.cos(a) * 20, tipY = y + Math.sin(a) * 20
    return `M${tipX},${tipY} l${-Math.cos(a - 0.5) * 9},${-Math.sin(a - 0.5) * 9} `
         + `M${tipX},${tipY} l${-Math.cos(a + 0.5) * 9},${-Math.sin(a + 0.5) * 9}`
}

/**
 * The T+ label. Derived from the scenario's own window so the counter
 * means something rather than counting an arbitrary six seconds.
 */
export function elapsedLabel(t, window_) {
    const days = /90/.test(String(window_ || "")) ? 90
        : /45/.test(String(window_ || "")) ? 45
        : /(\d+)\s*month/.exec(String(window_ || ""))
            ? Number(/(\d+)\s*month/.exec(String(window_))[1]) * 30
            : 45
    return `T+${Math.round((Math.max(0, Math.min(1, t)) || 0) * days)}d`
}

/** What each template is called where an analyst has to choose one. */
export const TEMPLATE_LABEL = {
    incursion: "Cross-border incursion",
    hybrid: "Sub-threshold pressure",
    demo: "Demonstration / signalling",
    reroute: "Maritime interdiction",
    strike: "Strike on a fixed node",
}
