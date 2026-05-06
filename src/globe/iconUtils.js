// Canvas-based icon generators for Cesium billboards.
// Cesium can't reliably render SVG data-URIs — canvas elements work everywhere.

function makeCanvas(w, h, draw) {
    const dpr = Math.max(typeof window !== "undefined" ? (window.devicePixelRatio || 2) : 2, 2)
    const canvas = document.createElement("canvas")
    canvas.width  = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)
    draw(ctx, w, h)
    return canvas
}

// ── Aircraft ──────────────────────────────────────────────────────────────────
// Airliner silhouette path from a 24×24 SVG viewBox (bow points up = north)
const AC_PATH_STR = "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"

const AC_COLORS = {
    commercial: "#00C8FF",
    military:   "#FF5028",
    helicopter: "#00DD66",
    general:    "#C8C8FF",
}

export function makeAircraftCanvas(type = "commercial") {
    const color = AC_COLORS[type] || AC_COLORS.commercial
    return makeCanvas(28, 28, (ctx, w, h) => {
        ctx.save()
        ctx.scale(w / 24, h / 24)   // map 24×24 SVG coords to canvas w×h
        const path = new Path2D(AC_PATH_STR)
        ctx.fillStyle = color
        ctx.fill(path)
        ctx.strokeStyle = "rgba(0,0,0,0.45)"
        ctx.lineWidth = 0.7
        ctx.stroke(path)
        ctx.restore()
    })
}

// ── Vessels ───────────────────────────────────────────────────────────────────
// Hull paths in a ~16×28 coordinate space (bow points up = north)
const VESSEL_PATHS = {
    tanker:    "M8,1 L13,7 L14,14 L14,24 L11,27 L5,27 L2,24 L2,14 L3,7 Z",
    container: "M8,1 L14,8 L14,25 L12,27 L4,27 L2,25 L2,8 Z",
    cargo:     "M8,1 L13,7 L13,24 L11,27 L5,27 L3,24 L3,7 Z",
    passenger: "M8,1 L12,6 L13,12 L13,24 L10,27 L6,27 L3,24 L3,12 L4,6 Z",
    military:  "M8,0 L12,5 L14,10 L14,24 L11,27 L5,27 L2,24 L2,10 L4,5 Z",
    fishing:   "M8,2 L12,8 L12,22 L10,25 L6,25 L4,22 L4,8 Z",
    other:     "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z",
}

export const VESSEL_COLORS = {
    tanker:    "#f59e0b",
    cargo:     "#14b8a6",
    container: "#06b6d4",
    military:  "#ef4444",
    passenger: "#3b82f6",
    fishing:   "#84cc16",
    other:     "#64748b",
}

export function vesselShipType(vessel) {
    const t = (vessel.ship_type || "").toLowerCase()
    if (t.includes("tanker") || t.includes("oil") || t.includes("lng") || t.includes("lpg")) return "tanker"
    if (t.includes("container")) return "container"
    if (t.includes("cargo") || t.includes("bulk") || t.includes("general")) return "cargo"
    if (t.includes("passenger") || t.includes("cruise") || t.includes("ferry")) return "passenger"
    if (t.includes("military") || t.includes("naval") || t.includes("warship")) return "military"
    if (t.includes("fishing") || t.includes("trawler")) return "fishing"
    return "other"
}

export function makeVesselCanvas(shipType = "other") {
    const color   = VESSEL_COLORS[shipType] || VESSEL_COLORS.other
    const pathStr = VESSEL_PATHS[shipType]  || VESSEL_PATHS.other
    return makeCanvas(14, 25, (ctx, w, h) => {
        ctx.save()
        ctx.scale(w / 16, h / 28)
        const path = new Path2D(pathStr)
        ctx.fillStyle = color
        ctx.fill(path)
        ctx.strokeStyle = "rgba(0,0,0,0.5)"
        ctx.lineWidth = 0.9
        ctx.stroke(path)
        ctx.restore()
    })
}

// ── Events ────────────────────────────────────────────────────────────────────
export function makeEventCanvas(hex) {
    return makeCanvas(20, 20, (ctx, w, h) => {
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, w / 2 - 1.5, 0, Math.PI * 2)
        ctx.fillStyle = hex
        ctx.fill()
        ctx.strokeStyle = "#0F1721"
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255,255,255,0.6)"
        ctx.fill()
    })
}

// ── POI ───────────────────────────────────────────────────────────────────────
export function makePOICanvas(hex) {
    return makeCanvas(20, 26, (ctx, w, h) => {
        const cx = w / 2
        const cr = 7
        const cy = cr + 1
        // Pin circle
        ctx.beginPath()
        ctx.arc(cx, cy, cr, 0, Math.PI * 2)
        ctx.fillStyle = hex
        ctx.fill()
        ctx.strokeStyle = "#0F1721"
        ctx.lineWidth = 1.2
        ctx.stroke()
        // Pin tail
        ctx.beginPath()
        ctx.moveTo(cx, h - 1)
        ctx.lineTo(cx - 5, cy + cr - 1)
        ctx.lineTo(cx + 5, cy + cr - 1)
        ctx.closePath()
        ctx.fillStyle = hex
        ctx.fill()
        // Inner highlight
        ctx.beginPath()
        ctx.arc(cx, cy, 3, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255,255,255,0.7)"
        ctx.fill()
    })
}

// ── Chokepoints ───────────────────────────────────────────────────────────────
let _chokepointCanvas = null
export function makeChokepointCanvas() {
    if (_chokepointCanvas) return _chokepointCanvas
    _chokepointCanvas = makeCanvas(24, 24, (ctx, w, h) => {
        ctx.beginPath()
        ctx.moveTo(w / 2, 2)
        ctx.lineTo(w - 2, h / 2)
        ctx.lineTo(w / 2, h - 2)
        ctx.lineTo(2, h / 2)
        ctx.closePath()
        ctx.fillStyle = "#FF6D00"
        ctx.fill()
        ctx.strokeStyle = "rgba(255,255,255,0.8)"
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255,255,255,0.7)"
        ctx.fill()
    })
    return _chokepointCanvas
}

// ── Typed event icons matching 2D EVENT_ICON_SVG ─────────────────────────────
// SVG path data is in a 32×32 viewBox — scaled to fit the symbol area.
const _EVENT_FILL_PATHS = {
    explosion:  "M16 2l3 8 9-1-5 6 7 5-9 1-1 9-4-7-7 5 2-8-8-3 8-4-2-8 7 5z",
    missile:    "M24 6l2 8-9 9-5 1 1-5 9-9z",
    fire:       "M18 4c1 5-3 6-2 10 1 2 4 3 4 7a6 6 0 11-12 0c0-4 3-6 5-9 2-3 1-5 5-8z",
    aviation:   "M28 20v-2l-10-6V5.5a1.8 1.8 0 00-1.8-1.8h-.4A1.8 1.8 0 0014 5.5V12L4 18v2l10-2.6V24l-2.5 1.9v1.7l4.5-1.3 4.5 1.3v-1.7L18 24v-6.6z",
    maritime:   "M16 4a4 4 0 100 8 4 4 0 000-8zm2 7.7V24c4-.6 7-3.4 7-6h-3l4-4 4 4h-3c0 5-4.9 9-11 9S5 23 5 18H2l4-4 4 4H7c0 2.6 3 5.4 7 6V11.7z",
    energy:     "M13 3v11h-4l10 15v-11h4L13 3z",
    medical:    "M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7V6z",
    general:    "M16 4l10 12-10 12L6 16 16 4z",
}

function _hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function makeTypedEventCanvas(type, hex) {
    const SIZE = 44          // total canvas logical pixels
    const CORE = 28          // core circle diameter
    const SYM  = 14          // symbol size in canvas coords (paths are 32×32)
    return makeCanvas(SIZE, SIZE, (ctx, w, h) => {
        const cx = w / 2, cy = h / 2
        const [r, g, b] = _hexToRgb(hex)

        // Radial glow
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2)
        grd.addColorStop(0,   `rgba(${r},${g},${b},0.45)`)
        grd.addColorStop(0.5, `rgba(${r},${g},${b},0.22)`)
        grd.addColorStop(1,   `rgba(${r},${g},${b},0)`)
        ctx.beginPath()
        ctx.arc(cx, cy, w / 2, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()

        // Core circle
        ctx.beginPath()
        ctx.arc(cx, cy, CORE / 2, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(15,23,42,0.86)"
        ctx.fill()
        ctx.strokeStyle = `rgba(${r},${g},${b},0.82)`
        ctx.lineWidth = 1.5
        ctx.stroke()

        // Type symbol
        ctx.save()
        if (_EVENT_FILL_PATHS[type]) {
            ctx.translate(cx - SYM / 2, cy - SYM / 2)
            ctx.scale(SYM / 32, SYM / 32)
            ctx.fillStyle = hex
            ctx.fill(new Path2D(_EVENT_FILL_PATHS[type]))
        } else if (type === "armed_clash") {
            // Crosshair
            ctx.strokeStyle = hex
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.arc(cx, cy, SYM * 0.3, 0, Math.PI * 2)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(cx, cy - SYM / 2); ctx.lineTo(cx, cy + SYM / 2)
            ctx.moveTo(cx - SYM / 2, cy); ctx.lineTo(cx + SYM / 2, cy)
            ctx.stroke()
        } else if (type === "earthquake") {
            // Concentric rings
            for (const [ri, op] of [[3.5, 1], [5.5, 0.65], [7.5, 0.38]]) {
                ctx.globalAlpha = op
                ctx.strokeStyle = hex
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.arc(cx, cy, ri, 0, Math.PI * 2)
                ctx.stroke()
            }
            ctx.globalAlpha = 1
        } else if (type === "protest") {
            // Flag on a pole
            ctx.strokeStyle = hex; ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(cx - SYM / 2 + 1, cy - SYM / 2 + 1)
            ctx.lineTo(cx - SYM / 2 + 1, cy + SYM / 2 - 1)
            ctx.stroke()
            ctx.fillStyle = hex
            ctx.beginPath()
            ctx.moveTo(cx - SYM / 2 + 2, cy - SYM / 2 + 1)
            ctx.lineTo(cx + SYM / 2 - 1, cy - SYM / 2 + 1 + SYM * 0.35)
            ctx.lineTo(cx - SYM / 2 + 2, cy - SYM / 2 + 1 + SYM * 0.7)
            ctx.closePath()
            ctx.fill()
        } else {
            // Generic dot
            ctx.beginPath()
            ctx.arc(cx, cy, 3, 0, Math.PI * 2)
            ctx.fillStyle = hex
            ctx.fill()
        }
        ctx.restore()
    })
}

// ── Aircraft classification ───────────────────────────────────────────────────
export function acClassify(ac) {
    if (ac.military || ac.interesting) return "military"
    const cat = ac.category || ""
    if (cat === "A7") return "helicopter"
    if (["A1", "A2"].includes(cat)) return "general"
    if (["A3", "A4", "A5", "A6"].includes(cat)) return "commercial"
    const cs = (ac.flight || "").trim().toUpperCase()
    if (/^[A-Z]{3}\d/.test(cs)) return "commercial"
    return "general"
}

// Altitude coloring (ft) — matches 2D layer
export function altColorHex(alt) {
    if (alt == null || isNaN(alt)) return "#94a3b8"
    if (alt < 10000) return "#22c55e"
    if (alt < 25000) return "#38bdf8"
    if (alt < 35000) return "#3b82f6"
    return "#a855f7"
}
