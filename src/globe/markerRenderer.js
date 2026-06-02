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

/** Choose color and size for any alert/event object. */
export function markerProps(item) {
  const rule   = item.rule_name || item.alert_type || ''
  const domain = (item.domain || item.source || item.source_type || '').toUpperCase()
  const sev    = item.severity || 'medium'
  const nCorr  = (item.correlated_alert_ids || []).length
  const isFusion    = domain === 'FUSION' || !!item.fusion_id
  const isSanction  = rule === 'Sanctioned Vessel' || rule === 'SANCTIONED_VESSEL'
  const isSTS       = rule === 'Ship-to-Ship Transfer' || rule === 'STS_TRANSFER'

  let color, size, pulse, signalCount = 0

  if (isSanction) {
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
  } else {
    color = DOMAIN_COLOR[domain] || SEVERITY_COLOR[sev]
    size  = sev === 'critical' ? 16 : sev === 'high' ? 13 : sev === 'medium' ? 10 : 7
    pulse = false
  }

  return { color, size, pulse, signalCount }
}

const _canvasCache = new Map()
export function getCachedCanvas(color, size, pulse, signalCount) {
  const key = `${color}-${size}-${pulse}-${signalCount}`
  if (_canvasCache.has(key)) return _canvasCache.get(key)
  const c = makeMarkerCanvas(color, size, pulse, signalCount)
  _canvasCache.set(key, c)
  return c
}
