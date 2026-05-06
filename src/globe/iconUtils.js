// SVG data-URI generators for Cesium billboard icons

function svgUri(svgStr) {
    return "data:image/svg+xml," + encodeURIComponent(svgStr)
}

// ── Aircraft ─────────────────────────────────────────────────────────────────
// Top-down airliner silhouette (24×24 viewBox, bow points up = north)
const AC_PATH = "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"

export function aircraftSvgUri(type = "commercial") {
    const colors = {
        commercial: "rgba(0,200,255,0.95)",
        military:   "rgba(255,80,40,0.95)",
        helicopter: "rgba(0,221,102,0.95)",
        general:    "rgba(200,200,255,0.85)",
    }
    const color = colors[type] || colors.commercial
    return svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">` +
        `<path d="${AC_PATH}" fill="${color}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>` +
        `</svg>`
    )
}

// ── Vessels ───────────────────────────────────────────────────────────────────
const VESSEL_HULL = {
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

export function vesselSvgUri(shipType = "other") {
    const color = VESSEL_COLORS[shipType] || VESSEL_COLORS.other
    const path  = VESSEL_HULL[shipType]  || VESSEL_HULL.other
    return svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 28" width="16" height="28">` +
        `<path d="${path}" fill="${color}" stroke="rgba(0,0,0,0.55)" stroke-width="0.8"/>` +
        `</svg>`
    )
}

// ── Events ────────────────────────────────────────────────────────────────────
export function eventSvgUri(hex) {
    return svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">` +
        `<circle cx="10" cy="10" r="7" fill="${hex}" stroke="#0F1721" stroke-width="1.5"/>` +
        `<circle cx="10" cy="10" r="3" fill="rgba(255,255,255,0.6)"/>` +
        `</svg>`
    )
}

// ── POI ───────────────────────────────────────────────────────────────────────
export function poiSvgUri(hex) {
    return svgUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 24" width="20" height="24">` +
        `<path d="M10 1 C6 1 3 4 3 8 C3 13 10 23 10 23 C10 23 17 13 17 8 C17 4 14 1 10 1Z" fill="${hex}" stroke="#0F1721" stroke-width="1.2"/>` +
        `<circle cx="10" cy="8" r="3" fill="rgba(255,255,255,0.7)"/>` +
        `</svg>`
    )
}

// ── Chokepoints ───────────────────────────────────────────────────────────────
export const CHOKEPOINT_URI = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">` +
    `<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#FF6D00" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>` +
    `<circle cx="12" cy="12" r="3" fill="rgba(255,255,255,0.7)"/>` +
    `</svg>`
)

// ── Aircraft classification ───────────────────────────────────────────────────
export function acClassify(ac) {
    if (ac.military || ac.interesting) return "military"
    const cat = ac.category || ""
    if (cat === "A7") return "helicopter"
    if (["A1","A2"].includes(cat)) return "general"
    if (["A3","A4","A5","A6"].includes(cat)) return "commercial"
    const cs = (ac.flight || "").trim().toUpperCase()
    if (/^[A-Z]{3}\d/.test(cs)) return "commercial"
    return "general"
}

// Altitude coloring (ft) matching 2D layer
export function altColorHex(alt) {
    if (alt == null || isNaN(alt)) return "#94a3b8"
    if (alt < 10000) return "#22c55e"
    if (alt < 25000) return "#38bdf8"
    if (alt < 35000) return "#3b82f6"
    return "#a855f7"
}
