/**
 * markerRenderer.js — Single source of truth for ALL globe markers.
 * Corner-bracket style. Color = domain. Size = importance.
 */

export const DOMAIN_COLOR = {
  AIS:       '#34AADC',
  ADSB:      '#9B8FE0',
  NEWS:      '#E8A838',
  SENTINEL:  '#3DAD6E',
  FUSION:    '#7B6FD4',
  SURGE:     '#E0883A',
  SANCTIONS: '#E03A3A',
}

export const SEVERITY_COLOR = {
  critical: '#E03A3A',
  high:     '#E07A3A',
  medium:   '#E0C03A',
  low:      '#5599BB',
  info:     '#667788',
}

/** Military aircraft: red diamond with white cross. */
export function makeMilitaryCanvas(size = 18) {
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2, cy = size / 2

  // Red diamond fill
  ctx.beginPath()
  ctx.moveTo(cx, 1)
  ctx.lineTo(size - 1, cy)
  ctx.lineTo(cx, size - 1)
  ctx.lineTo(1, cy)
  ctx.closePath()
  ctx.fillStyle   = '#FF4444'
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth   = Math.max(1.5, size * 0.08)
  ctx.fill()
  ctx.stroke()

  // White inner cross
  const arm = size * 0.20
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth   = Math.max(1, size * 0.09)
  ctx.lineCap     = 'round'
  ctx.beginPath(); ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm); ctx.stroke()

  return canvas
}

/** News surge: 8-pointed starburst in vivid orange. */
export function makeSurgeCanvas(size = 14, velocityScore = 0) {
  const scale  = velocityScore > 0.8 ? 1.4 : velocityScore > 0.5 ? 1.2 : 1.0
  const actual = Math.round(size * scale)
  const canvas = document.createElement('canvas')
  canvas.width  = actual
  canvas.height = actual
  const ctx  = canvas.getContext('2d')
  const cx   = actual / 2, cy = actual / 2
  const outerR = actual * 0.47
  const innerR = actual * 0.24
  const points = 8

  // Radial gradient fill
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR)
  grad.addColorStop(0, '#FFB347')
  grad.addColorStop(1, '#FF6B00')

  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI / points) * i - Math.PI / 2
    const r     = i % 2 === 0 ? outerR : innerR
    const x     = cx + r * Math.cos(angle)
    const y     = cy + r * Math.sin(angle)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle   = grad
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth   = Math.max(1, actual * 0.06)
  ctx.fill()
  ctx.stroke()

  return canvas
}

const _militaryCache = new Map()
export function getCachedMilitaryCanvas(size = 18) {
  if (!_militaryCache.has(size)) _militaryCache.set(size, makeMilitaryCanvas(size))
  return _militaryCache.get(size)
}

const _surgeCache = new Map()
export function getCachedSurgeCanvas(size = 14, velocityScore = 0) {
  const key = `${size}-${velocityScore > 0.8 ? 'xl' : velocityScore > 0.5 ? 'lg' : 'md'}`
  if (!_surgeCache.has(key)) _surgeCache.set(key, makeSurgeCanvas(size, velocityScore))
  return _surgeCache.get(key)
}

/** Returns a canvas with corner-bracket marker. */
export function makeMarkerCanvas(color, size = 24, pulse = false, signalCount = 0) {
  const canvas = document.createElement('canvas')
  canvas.width  = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const pad = size * 0.14
  const arm = size * 0.30
  const lw  = Math.max(1, size * 0.055)

  ctx.strokeStyle = color
  ctx.lineWidth   = lw
  ctx.lineCap     = 'square'

  const corners = [
    [pad,      pad,       1,  1],
    [size-pad, pad,      -1,  1],
    [pad,      size-pad,  1, -1],
    [size-pad, size-pad, -1, -1],
  ]
  corners.forEach(([x, y, dx, dy]) => {
    ctx.beginPath()
    ctx.moveTo(x + dx * arm, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * arm)
    ctx.stroke()
  })

  const cx = size / 2, cy = size / 2
  const dotR = size * (pulse ? 0.10 : 0.07)
  ctx.beginPath()
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.globalAlpha = 0.95
  ctx.fill()

  if (pulse) {
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.30, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth   = lw * 0.6
    ctx.globalAlpha = 0.30
    ctx.stroke()
  }

  if (signalCount >= 2) {
    const bx = size - pad * 0.5
    const by = pad * 0.5
    const br = size * 0.18
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#000'
    ctx.font = `bold ${Math.max(7, size * 0.22)}px "IBM Plex Mono", monospace`
    ctx.textAlign     = 'center'
    ctx.textBaseline  = 'middle'
    ctx.fillText(String(signalCount), bx, by + 0.5)
  }

  return canvas
}

/** Choose color, size, shape, and pulse for any alert/event object.
 *  shape: 'bracket' (default) | 'military' | 'surge'
 */
export function markerProps(item) {
  const rule   = item.rule_name || item.alert_type || ''
  const domain = (item.domain || item.source || item.source_type || '').toUpperCase()
  const sev    = item.severity || 'medium'
  const cat    = item.alert_category || ''
  const nCorr  = (item.correlated_alert_ids || []).length
  const isFusion    = domain === 'FUSION' || !!item.fusion_id
  const isSanction  = rule === 'Sanctioned Vessel' || rule === 'SANCTIONED_VESSEL' || cat === 'SANCTIONS_VIOLATION'
  const isSTS       = rule === 'Ship-to-Ship Transfer' || rule === 'STS_TRANSFER'
  const isMilitary  = cat === 'MILITARY_AIRCRAFT' || rule === 'military_aircraft' || rule === 'Military Squawk'
  const isSurge     = domain === 'SURGE'

  let color = DOMAIN_COLOR[domain] || SEVERITY_COLOR[sev]
  let size  = sev === 'critical' ? 16 : sev === 'high' ? 13 : sev === 'medium' ? 10 : 7
  let pulse = false
  let signalCount = 0
  let shape = 'bracket'

  if (isMilitary) {
    shape = 'military'; size = 18; pulse = true; color = '#FF4444'
  } else if (isSurge) {
    shape = 'surge'; size = 14; pulse = sev === 'critical' || sev === 'high'; color = '#FF6B00'
  } else if (isSanction) {
    color = DOMAIN_COLOR.SANCTIONS; size = 30; pulse = true
  } else if (isFusion) {
    color = DOMAIN_COLOR.FUSION; size = 26; pulse = true
    signalCount = item.signal_count || nCorr || 0
  } else if (isSTS) {
    color = DOMAIN_COLOR.SANCTIONS; size = 24; pulse = true
  } else if (nCorr >= 2) {
    color = DOMAIN_COLOR.FUSION; size = 22; pulse = false; signalCount = nCorr
  } else if (nCorr === 1) {
    color = DOMAIN_COLOR[domain] || SEVERITY_COLOR[sev]; size = 18; pulse = false
  }

  return { color, size, pulse, signalCount, shape }
}

const _canvasCache = new Map()
export function getCachedCanvas(color, size, pulse, signalCount, shape = 'bracket') {
  const key = `${shape}-${color}-${size}-${pulse}-${signalCount}`
  if (_canvasCache.has(key)) return _canvasCache.get(key)
  let c
  if (shape === 'military') {
    c = makeMilitaryCanvas(size)
  } else if (shape === 'surge') {
    c = makeSurgeCanvas(size)
  } else {
    c = makeMarkerCanvas(color, size, pulse, signalCount)
  }
  _canvasCache.set(key, c)
  return c
}
