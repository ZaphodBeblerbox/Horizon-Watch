/**
 * minimapHeat.js — PARALLAX minimap addendum §M4. The recency/severity ramp.
 *
 * "Severity without recency is a census; recency without severity is a ticker.
 * The locator needs both, in one visual channel, because it only has one to
 * spare."
 *
 * On a 72-hour window, colouring by severity alone gives you eight identical
 * red diamonds and no way to tell which one is LIVE. So heat is both:
 *
 *   severity sets the FLOOR — a critical can never look cool, however old
 *   recency sets how far up the ramp it climbs from that floor
 *
 * The newest critical is therefore the only marker that reaches the top of
 * the scale: on any given window exactly one thing is hottest, and it is the
 * right one.
 */

/** §M4.2's floors, verbatim. */
export const SEV_FLOOR = { critical: 0.62, high: 0.40, moderate: 0.20, low: 0.06 }

/**
 * Each severity's CEILING — a deliberate departure from §M4.2's formula,
 * which contradicts its own stated invariant.
 *
 * The spec says: "The newest critical is the only marker that reaches the top
 * of the scale, so on any given window exactly one thing is hottest, and it
 * is the right one." Its formula is
 *
 *     floor + (1 - floor) * fresh
 *
 * and at age 0, `fresh` is 1, so EVERY severity evaluates to exactly 1.0 — a
 * brand-new low burns as hot as a brand-new critical, and the top of the ramp
 * stops meaning anything. On a busy window that is most of the markers.
 *
 * The ceilings below are the ramp's own stops (RAMP_DOMAIN), so each severity
 * occupies one band of the scale: a fresh high tops out at --red and only a
 * fresh critical reaches --mm-hot. That is what §M4.2's prose describes; only
 * its arithmetic disagreed.
 */
export const SEV_CEILING = { critical: 1.0, high: 0.78, moderate: 0.55, low: 0.28 }

/** Severity tiers this app also emits, mapped onto the spec's four. */
const SEV_ALIAS = { elevated: "high", medium: "moderate", warning: "moderate", info: "low" }

const canonicalSeverity = (severity) => {
    const k = String(severity || "").toLowerCase()
    return SEV_FLOOR[k] !== undefined ? k : (SEV_ALIAS[k] || "low")
}

export function severityFloor(severity) {
    return SEV_FLOOR[canonicalSeverity(severity)] ?? 0.1
}

export function severityCeiling(severity) {
    return SEV_CEILING[canonicalSeverity(severity)] ?? 0.28
}

/**
 * @param {number} ts        the record's own timestamp, ms
 * @param {string} severity
 * @param {number} now       the evaluation moment, ms
 * @param {number} windowMs  THE HOST'S window — §M7: "pass it in; do not read
 *                           a global". Replay's 72h is not the inspector's.
 */
export function heat(ts, severity, now, windowMs) {
    const floor = severityFloor(severity)
    if (!Number.isFinite(ts) || !Number.isFinite(windowMs) || windowMs <= 0) {
        // No usable timestamp: the severity floor is all we honestly know.
        // Climbing the ramp on a guessed age would make an undated record
        // look fresh, which is the one thing this ramp must never do.
        return floor
    }
    const age = Math.max(0, now - ts) / windowMs
    // Steep at first, flattening later: the per-hour fall is largest in the
    // opening hours, which is exactly where "is this live" gets decided.
    const fresh = Math.pow(1 - Math.min(1, age), 1.9)
    const ceiling = severityCeiling(severity)
    return Math.min(1, floor + Math.max(0, ceiling - floor) * fresh)
}

// ── Lab interpolation ────────────────────────────────────────────────────
// §M4.2: "interpolateLab, not the default RGB. Interpolating steel→red in RGB
// passes through a dead grey-brown around 0.4; in Lab it passes through a
// believable ember. The mid-ramp is where most of your markers live, so it is
// the part that must not look broken."
//
// d3 is not a dependency here, so the conversion is written out. It is the
// standard sRGB → linear → XYZ (D65) → CIELAB path.

const clamp01 = (x) => Math.max(0, Math.min(1, x))

export function parseColor(css) {
    const s = String(css || "").trim()
    let m = /^#([0-9a-f]{3})$/i.exec(s)
    if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16))
    m = /^#([0-9a-f]{6})$/i.exec(s)
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    m = /^rgba?\(([^)]+)\)$/i.exec(s)
    if (m) return m[1].split(",").slice(0, 3).map((v) => Math.round(parseFloat(v)))
    return null
}

const toLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const fromLinear = (v) => { const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(clamp01(c) * 255) }

export function rgbToLab([r, g, b]) {
    const R = toLinear(r), G = toLinear(g), B = toLinear(b)
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
    const y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 1.0
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const fx = f(x), fy = f(y), fz = f(z)
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb([L, a, bb]) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200
    const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
    const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883
    const R = 3.2406 * x - 1.5372 * y - 0.4986 * z
    const G = -0.9689 * x + 1.8758 * y + 0.0415 * z
    const B = 0.0557 * x - 0.2040 * y + 1.0570 * z
    return [fromLinear(R), fromLinear(G), fromLinear(B)]
}

export function mixLab(c1, c2, t) {
    const a = rgbToLab(c1), b = rgbToLab(c2)
    return labToRgb([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t))
}

/** §M4.2's stops. */
export const RAMP_DOMAIN = [0, 0.28, 0.55, 0.78, 1]

/**
 * Build the ramp from RESOLVED token values. §M4.2 is explicit that the
 * tokens must be read at theme change and memoised rather than hardcoded,
 * "or the ramp stops following the light theme".
 */
export function buildRamp(stops) {
    const rgb = stops.map((s) => parseColor(s) || [128, 128, 128])
    return (h) => {
        const x = clamp01(Number.isFinite(h) ? h : 0)
        for (let i = 0; i < RAMP_DOMAIN.length - 1; i++) {
            const a = RAMP_DOMAIN[i], b = RAMP_DOMAIN[i + 1]
            if (x <= b) {
                const t = b === a ? 0 : (x - a) / (b - a)
                const [r, g, bl] = mixLab(rgb[i], rgb[i + 1], t)
                return `rgb(${r},${g},${bl})`
            }
        }
        const [r, g, b] = rgb[rgb.length - 1]
        return `rgb(${r},${g},${b})`
    }
}

/** §M4.3 — colour, size and opacity all follow heat. */
export const heatSize = (h) => 4.4 + clamp01(h) * 4.2       // 4.4px cold → 8.6px hot
export const heatOpacity = (h) => 0.35 + clamp01(h) * 0.65

/**
 * §M4.3 — "COLDEST FIRST. SVG has no z-index; paint order IS depth. Sorting
 * ascending means the newest critical is the last thing drawn and therefore
 * the only thing that can never be occluded — which is the entire point."
 */
export function sortColdestFirst(rows, now, windowMs) {
    return [...rows].sort(
        (a, b) => heat(a.ts, a.severity, now, windowMs) - heat(b.ts, b.severity, now, windowMs),
    )
}

/** §M6 — span by context, never a constant. */
export const SPAN_BY_CONTEXT = {
    facility: 8, port: 8, berth: 8,
    city: 14, incident: 14,
    signal: 26,
    corridor: 34, chokepoint: 34,
    country: 46,
}
export const DEFAULT_SPAN = 26
export const spanFor = (context) => SPAN_BY_CONTEXT[String(context || "").toLowerCase()] ?? DEFAULT_SPAN
