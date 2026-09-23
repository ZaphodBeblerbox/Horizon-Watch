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
        phases: [
            { at: 0.00, label: "reconnaissance-fire contact" },
            { at: 0.22, label: "artillery preparation" },
            { at: 0.42, label: "penetration on a narrow front" },
            { at: 0.72, label: "exploitation, defence repositions" },
        ],
        units: [
            // Recon crosses first and fast, and it is why the rest is timed.
            { x: 60, y: 108, aff: "hostile", size: "coy", id: "R", via: [[200, 100]],
              to: [316, 104], domain: "ground", icon: "recon",
              start: 0.00, end: 0.30 },
            // Aviation, quick, and it does not use the road the armour does.
            { x: 42, y: 40, aff: "hostile", size: "regt", id: "A", via: [[220, 52]],
              to: [352, 74], domain: "air", icon: "air",
              start: 0.18, end: 0.46 },
            // Guns move up but stay short of the border: they fire across it.
            { x: 70, y: 178, aff: "hostile", size: "bn", id: "G", to: [214, 172],
              domain: "ground", icon: "artillery", start: 0.20, end: 0.44 },
            // The main body, committed after the preparation, on an elbow
            // route rather than a ruled line.
            { x: 90, y: 60, aff: "hostile", size: "bde", id: "1",
              via: [[196, 72], [286, 84]], to: [386, 92],
              domain: "ground", icon: "armour", start: 0.42, end: 0.92 },
            { x: 90, y: 150, aff: "hostile", size: "bn", id: "2",
              via: [[200, 148]], to: [366, 150],
              domain: "ground", icon: "infantry", start: 0.48, end: 1.00 },
            // The defence does not move until the axis has shown itself.
            { x: 478, y: 80, aff: "friendly", size: "bn", id: "E",
              via: [[440, 96]], to: [408, 110],
              domain: "ground", icon: "infantry", start: 0.62, end: 1.00 },
            { x: 478, y: 168, aff: "friendly", size: "coy", id: "N", to: [430, 160],
              domain: "ground", icon: "artillery", start: 0.70, end: 1.00 },
        ],
    },
    hybrid: {
        doctrine: "Pressure below the threshold of armed attack: interference, "
                + "provocation and cyber, calibrated to stay under a response.",
        phases: [
            { at: 0.00, label: "probing, below the threshold" },
            { at: 0.40, label: "interference and provocation" },
            { at: 0.75, label: "calibrated pause" },
        ],
        line: "M330,18 L330,222", lineLabel: "border · no crossing",
        units: [
            { x: 96, y: 108, aff: "unknown", size: "coy", id: "C", to: [250, 108],
              domain: "ground", icon: "recon" },
            { x: 470, y: 72, aff: "friendly", size: "coy", id: "E", to: [470, 72],
              domain: "ground", icon: "infantry" },
            { x: 470, y: 164, aff: "friendly", size: "coy", id: "P", to: [470, 164],
              domain: "ground", icon: "none" },
        ],
    },
    demo: {
        doctrine: "Demonstration: forces moved and exercised visibly. "
                + "Signalling, not preparation.",
        phases: [
            { at: 0.00, label: "movement into view" },
            { at: 0.45, label: "exercise — visible, and meant to be" },
            { at: 0.80, label: "hold" },
        ],
        line: "M330,18 L330,222", lineLabel: "border · demonstration only",
        units: [
            { x: 80, y: 70, aff: "hostile", size: "regt", id: "1", to: [200, 70],
              domain: "ground", icon: "armour" },
            { x: 80, y: 150, aff: "hostile", size: "regt", id: "2", to: [200, 150],
              domain: "ground", icon: "artillery" },
            { x: 470, y: 110, aff: "friendly", size: "bn", id: "E", to: [470, 110],
              domain: "ground", icon: "infantry" },
        ],
    },
    reroute: {
        doctrine: "Littoral interdiction: episodic attack calibrated to the "
                + "insurance response rather than to tonnage destroyed.",
        phases: [
            { at: 0.00, label: "traffic on its normal track" },
            { at: 0.35, label: "episodic attack at the chokepoint" },
            { at: 0.65, label: "rerouting, and the insurance response" },
        ],
        line: "M300,80 L300,160", lineLabel: "chokepoint",
        units: [
            { x: 70, y: 170, aff: "neutral", size: "coy", id: "M", to: [470, 60],
              domain: "sea", icon: "naval" },
            { x: 70, y: 190, aff: "neutral", size: "coy", id: "M", to: [470, 80],
              domain: "sea", icon: "naval" },
            { x: 300, y: 118, aff: "hostile", size: "bn", id: "X", to: [300, 118],
              domain: "ground", icon: "missile" },
        ],
    },
    reprisal: {
        doctrine: "Violence directed at a population rather than at a force: "
                + "movement toward settlements, no opposing formation to meet, "
                + "and displacement as the measurable effect.",
        line: "M300,20 L300,220", lineLabel: "area of civilian presence",
        phases: [
            { at: 0.00, label: "movement toward settlements" },
            { at: 0.35, label: "cordon of the populated area" },
            { at: 0.65, label: "displacement — the measurable effect" },
        ],
        units: [
            { x: 70, y: 60, aff: "unknown", size: "coy", id: "1",
              via: [[176, 66]], to: [286, 76], domain: "ground", icon: "infantry",
              start: 0.00, end: 0.60 },
            { x: 70, y: 160, aff: "unknown", size: "coy", id: "2",
              via: [[178, 164]], to: [286, 160], domain: "ground", icon: "infantry",
              start: 0.08, end: 0.68 },
            { x: 40, y: 110, aff: "unknown", size: "bn", id: "A", to: [214, 116],
              domain: "ground", icon: "recon", start: 0.00, end: 0.42 },
            // Neutral, static, and in the way: the population is the
            // object of the doctrine, not a participant in it.
            { x: 400, y: 80, aff: "neutral", size: "coy", id: "C", to: [400, 80],
              domain: "ground", icon: "none" },
            { x: 400, y: 150, aff: "neutral", size: "coy", id: "C", to: [400, 150],
              domain: "ground", icon: "none" },
        ],
    },
    strike: {
        doctrine: "Interdiction against a node rather than a corridor, which "
                + "changes who is exposed.",
        phases: [
            { at: 0.00, label: "launch" },
            { at: 0.55, label: "terminal phase against the node" },
        ],
        line: "M400,70 L400,170", lineLabel: "terminal",
        units: [
            { x: 120, y: 80, aff: "hostile", size: "bn", id: "A", to: [400, 120],
              domain: "air", icon: "missile" },
            { x: 400, y: 120, aff: "neutral", size: "coy", id: "P", to: [400, 120],
              domain: "ground", icon: "none" },
        ],
    },
}

export const TEMPLATE_KEYS = Object.keys(TPL)

/** The full path of a unit: origin, any waypoints, destination. */
export function legsOf(u) {
    if (!u) return []
    return [[u.x, u.y], ...(u.via || []), u.to || [u.x, u.y]]
}

/** Whether a unit actually moves, so static ones get no axis or chevron. */
export function isMoving(u) {
    const pts = legsOf(u)
    if (pts.length < 2) return false
    return pts.some(([x, y]) => x !== u.x || y !== u.y)
}

/**
 * A unit's own clock within the run.
 *
 * Formations do not all step off together, and drawing them as though
 * they do is the single thing that made the first version read as a
 * diagram: reconnaissance makes contact before the main body commits,
 * artillery fires before the penetration, follow-on echelons wait for
 * the breach. `start` and `end` are fractions of the window, so a unit
 * that has not begun sits at its line of departure and one that has
 * arrived stays put instead of drifting past.
 */
export function localT(u, t) {
    const a = typeof u?.start === "number" ? u.start : 0
    const b = typeof u?.end === "number" ? u.end : 1
    const k = Math.max(0, Math.min(1, Number(t) || 0))
    if (b <= a) return k >= a ? 1 : 0
    return Math.max(0, Math.min(1, (k - a) / (b - a)))
}

/**
 * Position at time t, walked along the unit's polyline BY DISTANCE.
 *
 * Interpolating leg-by-leg on equal time would make a formation sprint
 * down a short leg and crawl along a long one, which reads as
 * acceleration nobody claimed. Walking by cumulative length gives one
 * steady rate along the whole route, which is the honest default when
 * the template asserts no rate at all.
 */
export function positionAt(u, t) {
    const pts = legsOf(u)
    const k = localT(u, t)
    if (pts.length < 2) return { x: u.x, y: u.y }

    const seg = []
    let total = 0
    for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        seg.push(d)
        total += d
    }
    if (total === 0) return { x: u.x, y: u.y }

    let want = k * total
    for (let i = 0; i < seg.length; i++) {
        if (want <= seg[i] || i === seg.length - 1) {
            const f = seg[i] === 0 ? 0 : Math.max(0, Math.min(1, want / seg[i]))
            return {
                x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
            }
        }
        want -= seg[i]
    }
    const last = pts[pts.length - 1]
    return { x: last[0], y: last[1] }
}

/** Chevron ahead of a moving unit, aligned to the leg it is ON. */
export function chevron(u, t) {
    if (!isMoving(u)) return null
    const k = localT(u, t)
    if (k <= 0.02 || k >= 0.999) return null
    const here = positionAt(u, t)
    const ahead = positionAt(u, Math.min(1, t + 0.02))
    const a = Math.atan2(ahead.y - here.y, ahead.x - here.x)
    if (!Number.isFinite(a) || (ahead.x === here.x && ahead.y === here.y)) return null
    const tipX = here.x + Math.cos(a) * 20, tipY = here.y + Math.sin(a) * 20
    return `M${tipX},${tipY} l${-Math.cos(a - 0.5) * 9},${-Math.sin(a - 0.5) * 9} `
         + `M${tipX},${tipY} l${-Math.cos(a + 0.5) * 9},${-Math.sin(a + 0.5) * 9}`
}

/** The phase a template is in at time t, or null. */
export function phaseAt(tpl, t) {
    const ph = tpl?.phases
    if (!Array.isArray(ph) || !ph.length) return null
    const k = Math.max(0, Math.min(1, Number(t) || 0))
    let cur = null
    for (const p of ph) if (k >= (p.at ?? 0)) cur = p
    return cur
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
    reprisal: "Violence against a population",
}
