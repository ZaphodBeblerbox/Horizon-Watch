/**
 * demoIconUtils.js — Leaflet divIcon factories for DemoRunner.
 * Mirrors the exact SVG shapes used in mappage.jsx for AIS vessels,
 * ADS-B aircraft, and carrier/escort silhouettes.
 * All functions use window.L — call only after Leaflet has loaded.
 */

function _hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function _bearingDeg(from, to) {
  const dLat = to[0] - from[0]
  const dLng = to[1] - from[1]
  return Math.atan2(dLng, dLat) * (180 / Math.PI)
}

// ── AIS vessel (top-down hull silhouette, bow up = 0°) ─────────────────────────

const HULL_PATHS = {
  tanker:   "M8,1 L13,7 L14,14 L14,24 L11,27 L5,27 L2,24 L2,14 L3,7 Z",
  military: "M8,0 L12,5 L14,10 L14,24 L11,27 L5,27 L2,24 L2,10 L4,5 Z",
  cargo:    "M8,1 L13,7 L13,24 L11,27 L5,27 L3,24 L3,7 Z",
  other:    "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z",
}

const HULL_DETAILS = {
  tanker:   `<ellipse cx="8" cy="14" rx="4" ry="3" fill="rgba(0,0,0,0.22)"/><ellipse cx="8" cy="21" rx="4" ry="3" fill="rgba(0,0,0,0.22)"/>`,
  military: `<rect x="6" y="12" width="4" height="9" fill="rgba(0,0,0,0.3)"/><circle cx="8" cy="8" r="2" fill="rgba(0,0,0,0.35)"/>`,
  cargo:    `<rect x="5" y="12" width="6" height="8" rx="1" fill="rgba(0,0,0,0.2)"/>`,
  other:    `<rect x="5" y="13" width="6" height="6" fill="rgba(0,0,0,0.18)"/>`,
}

export function makeDemoVesselSvgHtml(shipType, color, heading = 0) {
  const [r, g, b] = _hexToRgb(color)
  const glow = `rgba(${r},${g},${b},0.55)`
  const hull = HULL_PATHS[shipType] || HULL_PATHS.other
  const detail = HULL_DETAILS[shipType] || ""
  return (
    `<svg width="16" height="28" viewBox="0 0 16 28" xmlns="http://www.w3.org/2000/svg" `
    + `style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;`
    + `filter:drop-shadow(0 0 4px ${glow});">`
    + `<path d="${hull}" fill="${color}" stroke="rgba(255,255,255,0.25)" stroke-width="0.7" opacity="0.92"/>`
    + detail
    + `</svg>`
  )
}

export function makeDemoVesselIcon(shipType, color, heading = 0) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoVesselSvgHtml(shipType, color, heading),
    className:  "",
    iconSize:   [16, 28],
    iconAnchor: [8, 14],
  })
}

// ── Carrier (large top-down shape with flight deck) ────────────────────────────

export function makeDemoCarrierSvgHtml(color, heading = 0) {
  const [r, g, b] = _hexToRgb(color)
  return (
    `<svg width="22" height="48" viewBox="0 0 22 48" xmlns="http://www.w3.org/2000/svg" `
    + `style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;`
    + `filter:drop-shadow(0 0 8px rgba(${r},${g},${b},0.65));">`
    + `<path d="M11,1 L16,5 L17,12 L17,38 L14,47 L8,47 L5,38 L5,12 L6,5 Z" fill="${color}" stroke="rgba(255,255,255,0.3)" stroke-width="0.6" opacity="0.93"/>`
    + `<path d="M5,10 L1,14 L1,36 L5,38" fill="${color}" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" opacity="0.85"/>`
    + `<rect x="15" y="17" width="4" height="11" rx="0.5" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.2)" stroke-width="0.4"/>`
    + `</svg>`
  )
}

export function makeDemoCarrierIcon(color, heading = 0) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoCarrierSvgHtml(color, heading),
    className:  "",
    iconSize:   [22, 48],
    iconAnchor: [11, 24],
  })
}

// ── Escort / destroyer ────────────────────────────────────────────────────────

export function makeDemoEscortSvgHtml(color, heading = 0) {
  const [r, g, b] = _hexToRgb(color)
  return (
    `<svg width="14" height="30" viewBox="0 0 14 30" xmlns="http://www.w3.org/2000/svg" `
    + `style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;`
    + `filter:drop-shadow(0 0 6px rgba(${r},${g},${b},0.6));">`
    + `<path d="M7,1 L11,5 L12,11 L12,24 L10,29 L4,29 L2,24 L2,11 L3,5 Z" fill="${color}" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" opacity="0.92"/>`
    + `<rect x="4" y="12" width="6" height="7" rx="0.5" fill="rgba(255,255,255,0.28)"/>`
    + `</svg>`
  )
}

export function makeDemoEscortIcon(color, heading = 0) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoEscortSvgHtml(color, heading),
    className:  "",
    iconSize:   [14, 30],
    iconAnchor: [7, 15],
  })
}

// ── Fighter aircraft (same path as military ADS-B icon, top-down plan) ────────

export function makeDemoFighterSvgHtml(color, heading = 0) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" `
    + `style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;`
    + `filter:drop-shadow(0 0 7px ${color}cc);">`
    + `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>`
    + `</svg>`
  )
}

export function makeDemoFighterIcon(color, heading = 0) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoFighterSvgHtml(color, heading),
    className:  "",
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
  })
}

// ── Drone (small circle with arms) ────────────────────────────────────────────

export function makeDemoDroneSvgHtml(color, heading = 0) {
  return (
    `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" `
    + `style="transform:rotate(${heading}deg);transform-origin:50% 50%;display:block;overflow:visible;`
    + `filter:drop-shadow(0 0 4px ${color}aa);">`
    + `<circle cx="7" cy="7" r="3" fill="${color}" opacity="0.9"/>`
    + `<line x1="7" y1="0" x2="7" y2="4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
    + `<line x1="7" y1="10" x2="7" y2="14" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
    + `<line x1="0" y1="7" x2="4" y2="7" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
    + `<line x1="10" y1="7" x2="14" y2="7" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
    + `<circle cx="1" cy="1" r="1.5" fill="${color}" opacity="0.7"/>`
    + `<circle cx="13" cy="1" r="1.5" fill="${color}" opacity="0.7"/>`
    + `<circle cx="1" cy="13" r="1.5" fill="${color}" opacity="0.7"/>`
    + `<circle cx="13" cy="13" r="1.5" fill="${color}" opacity="0.7"/>`
    + `</svg>`
  )
}

export function makeDemoDroneIcon(color, heading = 0) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoDroneSvgHtml(color, heading),
    className:  "",
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
  })
}

// ── Troops (shield silhouette, 24×24) — RULE 9: minimum 24px ────────────────

export function makeDemoTroopsSvgHtml(color) {
  return (
    `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" `
    + `style="display:block;overflow:visible;filter:drop-shadow(0 0 5px ${color}aa);">`
    + `<path d="M12,2 L20,5 L20,12 C20,17 16,20.5 12,22 C8,20.5 4,17 4,12 L4,5 Z" `
    + `fill="${color}" stroke="rgba(255,255,255,0.4)" stroke-width="1" opacity="0.92"/>`
    + `<line x1="12" y1="7" x2="12" y2="17" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>`
    + `<line x1="7"  y1="12" x2="17" y2="12" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>`
    + `</svg>`
  )
}

export function makeDemoTroopsIcon(color) {
  const L = window.L
  if (!L) return null
  return L.divIcon({
    html:       makeDemoTroopsSvgHtml(color),
    className:  "",
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
  })
}

// ── Icon factory dispatcher ───────────────────────────────────────────────────
// vessel.icon: 'tanker'|'carrier'|'destroyer'|'military'|'aircraft'|'fighter'|'drone'|'troops'

export function makeDemoIcon(vessel, path) {
  const color   = vessel.color || "#3b82f6"
  const bearing = path?.length >= 2 ? _bearingDeg(path[0], path[1]) : 0
  const iconKey = vessel.icon || "other"

  switch (iconKey) {
    case "carrier":   return makeDemoCarrierIcon(color, bearing)
    case "destroyer": return makeDemoEscortIcon(color, bearing)
    case "aircraft":
    case "fighter":   return makeDemoFighterIcon(color, bearing)
    case "drone":     return makeDemoDroneIcon(color, bearing)
    case "troops":    return makeDemoTroopsIcon(color)
    case "tanker":    return makeDemoVesselIcon("tanker",   color, bearing)
    case "military":  return makeDemoVesselIcon("military", color, bearing)
    case "cargo":     return makeDemoVesselIcon("cargo",    color, bearing)
    default:          return makeDemoVesselIcon("military", color, bearing)
  }
}

// Updates the SVG element's transform rotation inside a Leaflet marker
export function updateMarkerHeading(marker, bearing) {
  try {
    const el = marker.getElement()
    if (!el) return
    const svg = el.querySelector("svg")
    if (svg) svg.style.transform = `rotate(${bearing}deg)`
  } catch (_) {}
}

export { _bearingDeg }
