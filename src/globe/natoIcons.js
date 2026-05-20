/**
 * natoIcons.js — NATO MIL-STD-2525C inspired intelligence symbology
 *
 * Two APIs:
 *   drawNatoIcon(ctx, type, cx, cy, r, color)  — canvas draw function
 *   natoIconSvg(type, size, color)              — inline SVG string
 *
 * Supported types:
 *   NAVAL_VESSEL, UNKNOWN_VESSEL, HOSTILE_VESSEL, AIRCRAFT,
 *   MISSILE_STRIKE, INFRASTRUCTURE, EXPLOSION,
 *   NEWS_SURGE, FUSION_EVENT, DARK_SHIP
 */

const ICON_COLORS = {
    NAVAL_VESSEL:    "#3b82f6",
    UNKNOWN_VESSEL:  "#a78bfa",
    HOSTILE_VESSEL:  "#ef4444",
    AIRCRAFT:        "#38bdf8",
    MISSILE_STRIKE:  "#f97316",
    INFRASTRUCTURE:  "#f59e0b",
    EXPLOSION:       "#ef4444",
    NEWS_SURGE:      "#fb923c",
    FUSION_EVENT:    "#ec4899",
    DARK_SHIP:       "#64748b",
}

export const NATO_ICON_TYPES = Object.keys(ICON_COLORS)

export function iconColor(type) {
    return ICON_COLORS[type] || "#94a3b8"
}

// ── Canvas draw functions ─────────────────────────────────────────────────────

function _drawOctagon(ctx, cx, cy, r) {
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8 - Math.PI / 2
        ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    ctx.closePath()
}

function _drawDiamond(ctx, cx, cy, r) {
    ctx.beginPath()
    ctx.moveTo(cx,     cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx,     cy + r)
    ctx.lineTo(cx - r, cy)
    ctx.closePath()
}

function _drawStar5(ctx, cx, cy, r) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
        const outerA = (i * 4 * Math.PI) / 5 - Math.PI / 2
        const innerA = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2
        ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(outerA) * r, cy + Math.sin(outerA) * r)
        ctx.lineTo(cx + Math.cos(innerA) * r * 0.42, cy + Math.sin(innerA) * r * 0.42)
    }
    ctx.closePath()
}

function _drawTriangleUp(ctx, cx, cy, r) {
    ctx.beginPath()
    ctx.moveTo(cx,             cy - r)
    ctx.lineTo(cx + r * 0.87,  cy + r * 0.5)
    ctx.lineTo(cx - r * 0.87,  cy + r * 0.5)
    ctx.closePath()
}

function _drawCross(ctx, cx, cy, r) {
    const t = r * 0.28
    ctx.beginPath()
    ctx.moveTo(cx - t, cy - r)
    ctx.lineTo(cx + t, cy - r)
    ctx.lineTo(cx + t, cy - t)
    ctx.lineTo(cx + r, cy - t)
    ctx.lineTo(cx + r, cy + t)
    ctx.lineTo(cx + t, cy + t)
    ctx.lineTo(cx + t, cy + r)
    ctx.lineTo(cx - t, cy + r)
    ctx.lineTo(cx - t, cy + t)
    ctx.lineTo(cx - r, cy + t)
    ctx.lineTo(cx - r, cy - t)
    ctx.lineTo(cx - t, cy - t)
    ctx.closePath()
}

function _drawHexagon(ctx, cx, cy, r) {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6
        ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    ctx.closePath()
}

function _drawBurst(ctx, cx, cy, r) {
    ctx.beginPath()
    const pts = 8
    for (let i = 0; i < pts * 2; i++) {
        const a = (i * Math.PI) / pts - Math.PI / 2
        const d = i % 2 === 0 ? r : r * 0.5
        ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(a) * d, cy + Math.sin(a) * d)
    }
    ctx.closePath()
}

const DRAW_SHAPES = {
    NAVAL_VESSEL:   (ctx, cx, cy, r) => _drawOctagon(ctx, cx, cy, r),
    UNKNOWN_VESSEL: (ctx, cx, cy, r) => _drawDiamond(ctx, cx, cy, r),
    HOSTILE_VESSEL: (ctx, cx, cy, r) => _drawStar5(ctx, cx, cy, r),
    AIRCRAFT:       (ctx, cx, cy, r) => _drawTriangleUp(ctx, cx, cy, r),
    MISSILE_STRIKE: (ctx, cx, cy, r) => _drawTriangleUp(ctx, cx, cy, r),
    INFRASTRUCTURE: (ctx, cx, cy, r) => _drawCross(ctx, cx, cy, r),
    EXPLOSION:      (ctx, cx, cy, r) => _drawBurst(ctx, cx, cy, r),
    NEWS_SURGE:     (ctx, cx, cy, r) => _drawHexagon(ctx, cx, cy, r),
    FUSION_EVENT:   (ctx, cx, cy, r) => _drawStar5(ctx, cx, cy, r),
    DARK_SHIP:      (ctx, cx, cy, r) => _drawOctagon(ctx, cx, cy, r),
}

export function drawNatoIcon(ctx, type, cx, cy, r, color) {
    const drawFn = DRAW_SHAPES[type]
    if (!drawFn) {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
    } else {
        drawFn(ctx, cx, cy, r)
    }
    const c = color || ICON_COLORS[type] || "#94a3b8"
    ctx.fillStyle   = c + "cc"
    ctx.fill()
    ctx.strokeStyle = c
    ctx.lineWidth   = 1.5
    ctx.stroke()
}

// ── SVG string generators ─────────────────────────────────────────────────────

function _svgOctagon(r) {
    const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI * 2) / 8 - Math.PI / 2
        return `${(r + Math.cos(a) * r).toFixed(1)},${(r + Math.sin(a) * r).toFixed(1)}`
    }).join(" ")
    return `<polygon points="${pts}"/>`
}

function _svgDiamond(r) {
    return `<polygon points="${r},0 ${r*2},${r} ${r},${r*2} 0,${r}"/>`
}

function _svgTriUp(r) {
    return `<polygon points="${r},0 ${(r+r*0.87).toFixed(1)},${(r+r*0.5).toFixed(1)} ${(r-r*0.87).toFixed(1)},${(r+r*0.5).toFixed(1)}"/>`
}

function _svgHex(r) {
    const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 6
        return `${(r + Math.cos(a) * r).toFixed(1)},${(r + Math.sin(a) * r).toFixed(1)}`
    }).join(" ")
    return `<polygon points="${pts}"/>`
}

function _svgStar5(r) {
    const pts = []
    for (let i = 0; i < 5; i++) {
        const oa = (i * 4 * Math.PI) / 5 - Math.PI / 2
        const ia = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2
        pts.push(`${(r + Math.cos(oa) * r).toFixed(1)},${(r + Math.sin(oa) * r).toFixed(1)}`)
        pts.push(`${(r + Math.cos(ia) * r * 0.42).toFixed(1)},${(r + Math.sin(ia) * r * 0.42).toFixed(1)}`)
    }
    return `<polygon points="${pts.join(" ")}"/>`
}

function _svgBurst(r) {
    const pts = []
    for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8 - Math.PI / 2
        const d = i % 2 === 0 ? r : r * 0.5
        pts.push(`${(r + Math.cos(a) * d).toFixed(1)},${(r + Math.sin(a) * d).toFixed(1)}`)
    }
    return `<polygon points="${pts.join(" ")}"/>`
}

function _svgCross(r) {
    const t = r * 0.3
    return `<path d="M${r-t} 0 L${r+t} 0 L${r+t} ${r-t} L${r*2} ${r-t} L${r*2} ${r+t} L${r+t} ${r+t} L${r+t} ${r*2} L${r-t} ${r*2} L${r-t} ${r+t} L0 ${r+t} L0 ${r-t} L${r-t} ${r-t} Z"/>`
}

const SVG_SHAPES = {
    NAVAL_VESSEL:   (r) => _svgOctagon(r),
    UNKNOWN_VESSEL: (r) => _svgDiamond(r),
    HOSTILE_VESSEL: (r) => _svgStar5(r),
    AIRCRAFT:       (r) => _svgTriUp(r),
    MISSILE_STRIKE: (r) => _svgTriUp(r),
    INFRASTRUCTURE: (r) => _svgCross(r),
    EXPLOSION:      (r) => _svgBurst(r),
    NEWS_SURGE:     (r) => _svgHex(r),
    FUSION_EVENT:   (r) => _svgStar5(r),
    DARK_SHIP:      (r) => _svgOctagon(r),
}

export function natoIconSvg(type, size = 16, color) {
    const r    = size / 2
    const c    = color || ICON_COLORS[type] || "#94a3b8"
    const body = (SVG_SHAPES[type] || SVG_SHAPES.NAVAL_VESSEL)(r)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="${c}cc" stroke="${c}" stroke-width="1.2">${body}</g></svg>`
}

// ── Entity-type → NATO icon type mapping ─────────────────────────────────────

export function entityTypeToIcon(entityType) {
    const map = {
        vessel:         "NAVAL_VESSEL",
        dark_vessel:    "DARK_SHIP",
        aircraft:       "AIRCRAFT",
        fusion_event:   "FUSION_EVENT",
        surge:          "NEWS_SURGE",
        alert:          "HOSTILE_VESSEL",
        cable:          "INFRASTRUCTURE",
        port:           "INFRASTRUCTURE",
        airport:        "AIRCRAFT",
        watch_zone:     "NEWS_SURGE",
        strategic_zone: "NEWS_SURGE",
        explosion:      "EXPLOSION",
        missile:        "MISSILE_STRIKE",
    }
    return map[entityType] || "UNKNOWN_VESSEL"
}
