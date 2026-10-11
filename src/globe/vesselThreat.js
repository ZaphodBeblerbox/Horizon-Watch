// Vessel of concern — pure helpers for the live view and the simulated
// drone flight (GlobeVesselThreatLayer.jsx, the inspector section, the
// phone map). No Cesium, no DOM: geometry, the flight path, and a
// procedurally built glTF of a Shahed-136/Geran-2-STYLE drone (delta wing,
// wingtip fins, cylindrical body, rear pusher propeller) — generated here,
// never downloaded.

export const ALERT_TYPE = "Russia-linked vessel loitering"
const R = 6371.0088
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

/** Is this alert/notification a vessel-of-concern alert? */
export function isVesselThreatAlert(data, entityId) {
  if (!data && !entityId) return false
  const t = String(data?.alert_type || data?.type || "")
  if (t === ALERT_TYPE) return true
  return [data?.alert_id, data?.alertId, data?.id, entityId].some((x) => /(^|[^A-Z])RUL-\d{6,}/.test(String(x || "")))
}

/** The MMSI of a vessel-of-concern alert. */
export function mmsiOf(data, entityId) {
  const direct = String(data?.mmsi || data?.entity_id || "").trim()
  if (/^\d{6,}$/.test(direct)) return direct
  for (const x of [data?.alert_id, data?.alertId, data?.id, entityId]) {
    const m = /RUL-(\d{6,})-/.exec(String(x || ""))
    if (m) return m[1]
  }
  return null
}

export function haversineKm(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat)
  const dp = p2 - p1, dl = rad(b.lon - a.lon)
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDeg(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function destination(p, bearing, km) {
  const d = km / R, b = rad(bearing), p1 = rad(p.lat), l1 = rad(p.lon)
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 }
}

/** A geodesic circle of radius km as n+1 points (closed). */
export function ringPoints(center, km, n = 128) {
  const out = []
  for (let i = 0; i <= n; i++) out.push(destination(center, (360 * i) / n, km))
  return out
}

/** The point a fraction f of the way along the great circle a→b. */
export function greatCircleAt(a, b, f) {
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon)
  const d = haversineKm(a, b) / R
  if (d < 1e-9) return { lat: a.lat, lon: a.lon }
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d)
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2)
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2)
  const z = A * Math.sin(p1) + B * Math.sin(p2)
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) }
}

// A small deterministic PRNG so the same vessel/target gives the same path.
export function seededRandom(seed) {
  let s = 0
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  s = s || 1
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

/**
 * A plausible low-level path from the vessel to the target: the great
 * circle, with gentle sideways jitter at a few waypoints (never at the ends)
 * and an altitude that wanders inside [minAlt, maxAlt]. Returns points with
 * cumulative distance: [{lat, lon, alt, km}].
 */
export function buildFlightPath(from, to, { seed = "sim", waypoints = 6, jitterKm = null, altitude = [100, 500], step = 40 } = {}) {
  const total = haversineKm(from, to)
  const rnd = seededRandom(seed)
  const jit = jitterKm ?? Math.min(12, total * 0.04)
  const [aMin, aMax] = altitude
  const brg = bearingDeg(from, to)
  const wps = [{ ...from, off: 0, alt: aMin }]
  for (let i = 1; i < waypoints; i++) {
    const f = i / waypoints
    wps.push({ ...greatCircleAt(from, to, f), off: (rnd() * 2 - 1) * jit, alt: aMin + rnd() * (aMax - aMin), f })
  }
  wps.push({ ...to, off: 0, alt: aMin })
  const pts = []
  for (let w = 0; w < wps.length - 1; w++) {
    const a = wps[w], b = wps[w + 1]
    const seg = Math.max(2, Math.ceil(step * (1 / waypoints)))
    for (let k = 0; k < seg; k++) {
      const t = k / seg
      const s = (1 - Math.cos(Math.PI * t)) / 2 // ease between waypoints
      const base = greatCircleAt(a, b, t)
      const off = a.off + (b.off - a.off) * s
      const p = Math.abs(off) > 1e-6 ? destination(base, (brg + (off > 0 ? 90 : -90) + 360) % 360, Math.abs(off)) : base
      pts.push({ lat: p.lat, lon: p.lon, alt: a.alt + (b.alt - a.alt) * s })
    }
  }
  pts.push({ lat: to.lat, lon: to.lon, alt: aMin })
  let km = 0
  pts[0].km = 0
  for (let i = 1; i < pts.length; i++) {
    km += haversineKm(pts[i - 1], pts[i])
    pts[i].km = km
  }
  return pts
}

export function pathLengthKm(path) {
  return path.length ? path[path.length - 1].km : 0
}

/** Position, altitude and heading after flying `km` along the path. */
export function positionAlong(path, km) {
  if (!path.length) return null
  const total = pathLengthKm(path)
  const d = Math.max(0, Math.min(total, km))
  let i = 1
  while (i < path.length - 1 && path[i].km < d) i++
  const a = path[i - 1], b = path[i]
  const span = b.km - a.km || 1
  const t = Math.max(0, Math.min(1, (d - a.km) / span))
  const p = greatCircleAt(a, b, t)
  return { lat: p.lat, lon: p.lon, alt: a.alt + (b.alt - a.alt) * t, heading: bearingDeg(a, b), km: d, done: d >= total }
}

export function flightMinutes(km, cruiseKmh) {
  return (km / Math.max(1e-6, cruiseKmh)) * 60
}

export function fmtMinutes(m) {
  if (!Number.isFinite(m)) return "—"
  if (m < 60) return `${Math.max(1, Math.round(m))} min`
  const h = Math.floor(Math.round(m) / 60), mm = Math.round(m) % 60
  return `${h} h ${String(mm).padStart(2, "0")} min`
}

// ── a Shahed-136 / Geran-2-STYLE drone as a glTF binary, built in code ──
//
// Units are metres, glTF axes: +X forward (nose), +Y up, +Z right wing.
// Rough public proportions: ~3.5 m long, ~2.5 m span. Flat-shaded
// triangles (no indices); two materials: airframe and propeller.

function tri(out, a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const l = Math.hypot(...n) || 1
  n = n.map((x) => x / l)
  for (const p of [a, b, c]) { out.pos.push(...p); out.nrm.push(...n) }
}
const quad = (o, a, b, c, d) => { tri(o, a, b, c); tri(o, a, c, d) }

/** A closed prism: polygon (x, z) in the horizontal plane, from y0 to y1. */
function slab(o, poly, y0, y1) {
  const n = poly.length
  for (let i = 1; i < n - 1; i++) {
    tri(o, [poly[0][0], y1, poly[0][1]], [poly[i + 1][0], y1, poly[i + 1][1]], [poly[i][0], y1, poly[i][1]])
    tri(o, [poly[0][0], y0, poly[0][1]], [poly[i][0], y0, poly[i][1]], [poly[i + 1][0], y0, poly[i + 1][1]])
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    quad(o, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]])
  }
}

/** A box from min to max corner. */
function box(o, [x0, y0, z0], [x1, y1, z1]) {
  slab(o, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1)
}

export function shahedGeometry() {
  const body = { pos: [], nrm: [] }, prop = { pos: [], nrm: [] }
  // Fuselage: a cylinder along X with a pointed nose and a blunt tail.
  const r = 0.2, seg = 14, x0 = -1.6, x1 = 1.3, nose = 1.85
  const ring = (x, rr) => Array.from({ length: seg }, (_, i) => {
    const a = (2 * Math.PI * i) / seg
    return [x, rr * Math.sin(a), rr * Math.cos(a)]
  })
  const tail = ring(x0, r * 0.85), mid = ring(x1, r)
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg
    quad(body, tail[i], tail[j], mid[j], mid[i])
    tri(body, mid[i], mid[j], [nose, 0, 0])
    tri(body, tail[j], tail[i], [x0, 0, 0])
  }
  // Cropped delta wing, low on the body: root from near the nose back to
  // the tail; tips swept back to the trailing edge.
  const wy = -0.06, th = 0.05
  for (const s of [1, -1]) {
    slab(body, s > 0
      ? [[0.75, 0.15], [-1.6, 0.15], [-1.6, 1.25], [-1.25, 1.25]]
      : [[0.75, -0.15], [-1.25, -1.25], [-1.6, -1.25], [-1.6, -0.15]], wy, wy + th)
    // Wingtip fins: vertical, above and below the wing.
    box(body, [-1.62, -0.32, s * 1.25 - 0.025], [-1.12, 0.38, s * 1.25 + 0.025])
  }
  // Rear pusher propeller: a hub and two crossed blades behind the tail.
  box(prop, [-1.78, -0.07, -0.07], [-1.6, 0.07, 0.07])
  box(prop, [-1.76, -0.42, -0.05], [-1.72, 0.42, 0.05])
  box(prop, [-1.76, -0.05, -0.42], [-1.72, 0.05, 0.42])
  return { body, prop }
}

function minmax(arr) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k])
  }
  return { min: mn, max: mx }
}

/** The drone as a GLB (Uint8Array). */
export function buildShahedGlb({ body = [0.62, 0.6, 0.55, 1], prop = [0.12, 0.12, 0.13, 1] } = {}) {
  const g = shahedGeometry()
  const parts = [g.body, g.prop]
  const arrays = []
  for (const p of parts) arrays.push(new Float32Array(p.pos), new Float32Array(p.nrm))
  const views = [], accessors = []
  let off = 0
  arrays.forEach((a, i) => {
    views.push({ buffer: 0, byteOffset: off, byteLength: a.byteLength, target: 34962 })
    const acc = { bufferView: i, componentType: 5126, count: a.length / 3, type: "VEC3" }
    if (i % 2 === 0) Object.assign(acc, minmax(a))
    accessors.push(acc)
    off += a.byteLength
  })
  const json = {
    asset: { version: "2.0", generator: "parallax vesselThreat.js (procedural)" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "shahed-style-drone" }],
    meshes: [{ primitives: [
      { attributes: { POSITION: 0, NORMAL: 1 }, material: 0 },
      { attributes: { POSITION: 2, NORMAL: 3 }, material: 1 },
    ] }],
    materials: [
      { name: "airframe", pbrMetallicRoughness: { baseColorFactor: body, metallicFactor: 0.1, roughnessFactor: 0.8 }, doubleSided: true },
      { name: "propeller", pbrMetallicRoughness: { baseColorFactor: prop, metallicFactor: 0.2, roughnessFactor: 0.6 }, doubleSided: true },
    ],
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
  }
  let js = new TextEncoder().encode(JSON.stringify(json))
  const jsPad = (4 - (js.length % 4)) % 4
  const binPad = (4 - (off % 4)) % 4
  const total = 12 + 8 + js.length + jsPad + 8 + off + binPad
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true) // "glTF"
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, js.length + jsPad, true)
  dv.setUint32(16, 0x4e4f534a, true) // "JSON"
  out.set(js, 20)
  for (let i = 0; i < jsPad; i++) out[20 + js.length + i] = 0x20
  let p = 20 + js.length + jsPad
  dv.setUint32(p, off + binPad, true)
  dv.setUint32(p + 4, 0x004e4942, true) // "BIN\0"
  p += 8
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), p); p += a.byteLength }
  js = null
  return out
}

let _uri = null
/** The drone as a data: URI, built once. */
export function shahedModelUri() {
  if (_uri) return _uri
  const bytes = buildShahedGlb()
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  _uri = `data:model/gltf-binary;base64,${btoa(bin)}`
  return _uri
}

/** Cesium heading (radians) for this model from a compass bearing. Measured
 *  on the globe (2026-10-11): with heading h the nose (+X in glTF) points at
 *  compass bearing h — an offset of -90 had it flying sideways. */
export function modelHeadingRad(bearing) {
  return rad(bearing)
}

export const SIM_LABEL = "Simulation — what is in reach, not a prediction"
