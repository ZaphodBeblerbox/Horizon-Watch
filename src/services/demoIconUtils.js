/**
 * demoIconUtils.js — NATO-style military unit icon badges for DemoRunner.
 *
 * Each icon is a rectangular badge (faction-coloured background + white
 * unit-type silhouette) with an optional name label below.  Badges are
 * always upright — direction of travel is shown by the trail polyline.
 */

// ── Colour helpers ─────────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

export function _bearingDeg(from, to) {
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI)
}

// ── Badge builder ─────────────────────────────────────────────────────────────

function _badge(w, h, color, innerSvg) {
  return (
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" `
    + `style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.65));">`
    + `<rect width="${w}" height="${h}" rx="4" fill="${color}" opacity="0.93" `
    + `stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`
    + innerSvg
    + `</svg>`
  )
}

function _wrapIcon(svgHtml, w, h, label, strength) {
  const lbl = label
    ? `<div style="position:absolute;top:${h+2}px;left:50%;transform:translateX(-50%);white-space:nowrap;`
      + `font-size:9px;color:#e2e8f0;text-shadow:0 0 4px rgba(0,0,0,1),0 0 4px rgba(0,0,0,1);`
      + `font-weight:700;font-family:system-ui;pointer-events:none;letter-spacing:0.02em;">${label}</div>`
    : ""
  const str = strength
    ? `<div style="position:absolute;bottom:2px;right:3px;font-size:7px;color:rgba(255,255,255,0.82);`
      + `font-weight:700;font-family:system-ui;pointer-events:none;line-height:1;">${strength}</div>`
    : ""
  return `<div style="position:relative;display:inline-block;">${svgHtml}${str}${lbl}</div>`
}

// ── Unit-type interior SVGs ───────────────────────────────────────────────────
// All coordinates are expressed as fractions of (w, h) for scaling.

const _INFANTRY = (w, h) =>
  `<line x1="${w*.25}" y1="${h*.83}" x2="${w*.75}" y2="${h*.17}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
  + `<line x1="${w*.25}" y1="${h*.17}" x2="${w*.75}" y2="${h*.83}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`

const _ARMOR = (w, h) =>
  `<ellipse cx="${w*.5}" cy="${h*.58}" rx="${w*.31}" ry="${h*.27}" fill="none" stroke="white" stroke-width="2"/>`
  + `<line x1="${w*.5}" y1="${h*.31}" x2="${w*.5}" y2="${h*.1}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`

const _ARTILLERY = (w, h) =>
  `<circle cx="${w*.5}" cy="${h*.5}" r="${w*.21}" fill="none" stroke="white" stroke-width="2"/>`
  + `<circle cx="${w*.5}" cy="${h*.5}" r="${w*.065}" fill="white"/>`

const _HELICOPTER = (w, h) =>
  `<ellipse cx="${w*.5}" cy="${h*.5}" rx="${w*.12}" ry="${h*.14}" fill="white"/>`
  + `<line x1="${w*.09}" y1="${h*.5}" x2="${w*.91}" y2="${h*.5}" stroke="white" stroke-width="1.6"/>`
  + `<line x1="${w*.5}" y1="${h*.16}" x2="${w*.5}" y2="${h*.84}" stroke="white" stroke-width="1.6"/>`

const _FIGHTER = (w, h) =>
  `<polygon points="${w*.5},${h*.11} ${w*.66},${h*.76} ${w*.5},${h*.62} ${w*.34},${h*.76}" fill="white"/>`
  + `<line x1="${w*.18}" y1="${h*.54}" x2="${w*.82}" y2="${h*.54}" stroke="white" stroke-width="1.8"/>`

const _PATROL = (w, h) =>
  `<ellipse cx="${w*.5}" cy="${h*.56}" rx="${w*.38}" ry="${h*.15}" fill="white"/>`
  + `<polygon points="${w*.5},${h*.18} ${w*.59},${h*.44} ${w*.41},${h*.44}" fill="white"/>`

const _DESTROYER = (w, h) =>
  `<polygon points="${w*.5},${h*.11} ${w*.73},${h*.5} ${w*.68},${h*.89} ${w*.32},${h*.89} ${w*.27},${h*.5}" fill="white"/>`

const _CARRIER = (w, h) =>
  `<polygon points="${w*.5},${h*.1} ${w*.72},${h*.38} ${w*.72},${h*.9} ${w*.28},${h*.9} ${w*.28},${h*.38}" fill="white"/>`
  + `<rect x="${w*.59}" y="${h*.2}" width="${w*.13}" height="${h*.32}" rx="1" fill="rgba(0,0,0,0.28)"/>`

const _FAST_ATTACK = (w, h) =>
  `<polygon points="${w*.5},${h*.11} ${w*.73},${h*.5} ${w*.68},${h*.89} ${w*.32},${h*.89} ${w*.27},${h*.5}" fill="white"/>`

const _TANKER = (w, h) =>
  `<rect x="${w*.27}" y="${h*.22}" width="${w*.46}" height="${h*.62}" rx="2" fill="white"/>`
  + `<polygon points="${w*.5},${h*.09} ${w*.65},${h*.22} ${w*.35},${h*.22}" fill="white"/>`
  + `<line x1="${w*.27}" y1="${h*.46}" x2="${w*.73}" y2="${h*.46}" stroke="${'rgba(0,0,0,0.22)'}" stroke-width="1.2"/>`

const _CARGO = (w, h) =>
  `<rect x="${w*.2}" y="${h*.2}" width="${w*.6}" height="${h*.64}" rx="2" fill="none" stroke="white" stroke-width="1.8"/>`
  + `<line x1="${w*.2}" y1="${h*.47}" x2="${w*.8}" y2="${h*.47}" stroke="white" stroke-width="1.2"/>`
  + `<polygon points="${w*.5},${h*.08} ${w*.64},${h*.2} ${w*.36},${h*.2}" fill="white"/>`

const _DRONE = (w, h) =>
  `<polygon points="${w*.5},${h*.11} ${w*.7},${h*.5} ${w*.5},${h*.42} ${w*.3},${h*.5}" fill="white"/>`
  + `<line x1="${w*.14}" y1="${h*.65}" x2="${w*.86}" y2="${h*.65}" stroke="white" stroke-width="1.5"/>`

const _SAM = (w, h) =>
  `<path d="M${w*.36},${h*.86} L${w*.5},${h*.24} L${w*.64},${h*.86}" fill="none" stroke="white" stroke-width="2"/>`
  + `<circle cx="${w*.5}" cy="${h*.24}" r="${w*.08}" fill="none" stroke="white" stroke-width="1.5"/>`

const _TROOPS = _INFANTRY  // generic ground forces = crossed rifles silhouette

// ── Dimensions per icon type ──────────────────────────────────────────────────

const ICON_SIZES = {
  carrier:    [54, 36],
  destroyer:  [44, 30],
  fast_attack:[38, 26],
  military:   [38, 26],  // alias → fast_attack
  tanker:     [44, 30],
  cargo:      [44, 30],
  fighter:    [42, 28],
  aircraft:   [42, 28],  // alias → fighter
  patrol:     [44, 28],
  helicopter: [42, 28],
  drone:      [38, 26],
  infantry:   [42, 28],
  armor:      [44, 28],
  artillery:  [40, 28],
  sam:        [40, 28],
  troops:     [42, 28],
  default:    [42, 28],
}

function _getInner(type, w, h) {
  switch (type) {
    case "infantry":
    case "troops":    return _INFANTRY(w, h)
    case "armor":     return _ARMOR(w, h)
    case "artillery": return _ARTILLERY(w, h)
    case "helicopter":return _HELICOPTER(w, h)
    case "fighter":
    case "aircraft":  return _FIGHTER(w, h)
    case "patrol":    return _PATROL(w, h)
    case "destroyer": return _DESTROYER(w, h)
    case "carrier":   return _CARRIER(w, h)
    case "tanker":    return _TANKER(w, h)
    case "fast_attack":
    case "military":  return _FAST_ATTACK(w, h)
    case "drone":     return _DRONE(w, h)
    case "sam":       return _SAM(w, h)
    case "cargo":     return _CARGO(w, h)
    default:          return _TROOPS(w, h)
  }
}

// ── Public icon factories ─────────────────────────────────────────────────────

export function makeDemoUnitIcon(type, color, label, strength) {
  const L = window.L
  if (!L) return null
  const [w, h] = ICON_SIZES[type] || ICON_SIZES.default
  const inner  = _getInner(type, w, h)
  const svg    = _badge(w, h, color, inner)
  const html   = _wrapIcon(svg, w, h, label, strength)
  return L.divIcon({
    html,
    className:  "military-unit-icon",
    iconSize:   [w, h],
    iconAnchor: [Math.round(w / 2), Math.round(h / 2)],
  })
}

// ── Pulsing deploy-zone marker ────────────────────────────────────────────────

export function makeDeployZoneIcon(label) {
  const L = window.L
  if (!L) return null
  const pulse = `@keyframes _dz_pulse{0%{transform:scale(1);opacity:.9}50%{transform:scale(1.5);opacity:.3}100%{transform:scale(1);opacity:.9}}`
  const html = `<style>${pulse}</style>`
    + `<div style="position:relative;display:inline-block;">`
    + `<div style="width:28px;height:28px;border-radius:50%;background:rgba(56,139,255,.32);`
    + `border:2px solid #3b82f6;animation:_dz_pulse 1.6s ease-in-out infinite;`
    + `display:flex;align-items:center;justify-content:center;">`
    + `<div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;"></div>`
    + `</div>`
    + (label ? `<div style="position:absolute;top:30px;left:50%;transform:translateX(-50%);white-space:nowrap;`
      + `font-size:9px;color:#93c5fd;text-shadow:0 0 4px rgba(0,0,0,1);font-weight:700;`
      + `font-family:system-ui;pointer-events:none;">${label}</div>` : "")
    + `</div>`
  return L.divIcon({ html, className: "", iconSize: [28, 28], iconAnchor: [14, 14] })
}

/**
 * Returns a raw HTML string (SVG badge + label wrapper) for use inside a
 * Leaflet divIcon that's constructed by the caller (e.g. CommandRunner).
 * Does NOT require window.L — safe to call outside a useEffect.
 */
export function getDemoUnitIconSvg(type, color, label) {
  const [w, h] = ICON_SIZES[type] || ICON_SIZES.default
  const inner  = _getInner(type, w, h)
  const svg    = _badge(w, h, color, inner)
  return _wrapIcon(svg, w, h, label || null, null)
}

// ── Main dispatcher used by DemoRunner._spawnVessel ──────────────────────────

export function makeDemoIcon(vessel, _path) {
  const color    = vessel.color    || "#3b82f6"
  const iconType = vessel.icon     || "troops"
  const label    = vessel.name     || null
  const strength = vessel.strength || null
  return makeDemoUnitIcon(iconType, color, label, strength)
}

// No-op — NATO badges are always upright; trail shows heading
export function updateMarkerHeading(_marker, _bearing) {}

export { _bearingDeg as default }
