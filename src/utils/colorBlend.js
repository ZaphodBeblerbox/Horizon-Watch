// colorBlend.js — real, generic hex/rgb(a) color interpolation. Used by
// themeStore.js's Auto-mode fade — deliberately has no idea what a "theme
// token" is, just blends two real CSS color strings by a real 0..1 factor.

function parseColor(str) {
    if (!str) return null
    const s = str.trim()
    let m = /^#([0-9a-f]{6})$/i.exec(s)
    if (m) {
        const n = parseInt(m[1], 16)
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
    }
    m = /^#([0-9a-f]{3})$/i.exec(s)
    if (m) {
        const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16))
        return { r, g, b, a: 1 }
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
    if (m) {
        return {
            r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]),
            a: m[4] !== undefined ? parseFloat(m[4]) : 1,
        }
    }
    return null
}

/** Real linear interpolation between two real CSS color strings (hex or
 * rgb/rgba) at real factor t (0 = a, 1 = b). Returns `b` unparsed if either
 * side isn't a plain color this can parse (e.g. a multi-value box-shadow
 * shorthand) — an honest, safe fallback (an instant swap for that one
 * token) rather than silently producing garbage. */
export function blendColor(a, b, t) {
    const ca = parseColor(a)
    const cb = parseColor(b)
    if (!ca || !cb) return t < 0.5 ? a : b
    const lerp = (x, y) => x + (y - x) * t
    const r = Math.round(lerp(ca.r, cb.r))
    const g = Math.round(lerp(ca.g, cb.g))
    const bl = Math.round(lerp(ca.b, cb.b))
    const al = lerp(ca.a, cb.a)
    return al >= 1 ? `rgb(${r}, ${g}, ${bl})` : `rgba(${r}, ${g}, ${bl}, ${al.toFixed(4)})`
}

export function isParseableColor(str) {
    return parseColor(str) !== null
}
