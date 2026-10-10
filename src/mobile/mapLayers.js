/**
 * mapLayers.js — every desktop map layer, for the phone's Leaflet map.
 *
 * ONE REGISTRY, READ FROM THE DESKTOP. Each entry below is a reading of a
 * src/globe/Globe*Layer.jsx component: the same endpoint, the same query
 * parameters, the same filtering, and the same marker image built by the
 * same helper with the same arguments. Where a desktop layer keeps its
 * colour function or glyph private (and importing the .jsx would drag
 * Cesium onto the phone), the function is copied here verbatim, with the
 * file it came from named beside it. Nothing here invents a colour.
 *
 * Keys, labels and groups follow src/components/layerRailConfig.js
 * (LAYER_GROUPS, SUB_LAYERS, INFRA_TOGGLES, CONTEXT_TOGGLES); defaults
 * follow destinations/Situation.jsx, which is where the desktop's defaults
 * actually live.
 *
 * Every load() is cheap and never throws: bounds go to endpoints that take
 * them, everything else is culled to the viewport here, each layer is
 * capped, and any failure is an empty list.
 */
import API_BASE from "../apiBase.js"
import {
    getShapeMarkerDataUri, getGeoConfirmedMarkerDataUri, getFacilityMarkerDataUri,
    getEntityMarkerDataUri, GEOCONFIRMED_MARKER_SIZE, MARK_SIZE,
} from "../globe/entityIcons.js"
import { infraGlyphUri } from "../globe/infraGlyphs.js"
import { styleFor as gfwStyleFor, summaryOf as gfwSummaryOf, ageLabel as gfwAgeLabel, KINDS as GFW_KINDS } from "../globe/gfwEvents.js"
import { riskAlpha, buildA2ToA3, indexByIso3 } from "../globe/riskChoropleth.js"
import { CAT } from "../components/timeStripMath.js"

/** No layer draws more than this many features on the phone. */
export const MAX_FEATURES = 600

// ── plumbing ──────────────────────────────────────────────────────────────

const _inflight = new Map()
const _cache = new Map()

/**
 * GET as JSON, or null on any failure. Concurrent callers of the same URL
 * share one request, and a result is reused for `ttlMs` — several phone
 * layers read one endpoint (the three facility rows, Telegram and unrest,
 * the power grid's lines and sites) and must not each pay for it.
 */
async function getJson(url, { ttlMs = 15_000, credentials = true } = {}) {
    const hit = _cache.get(url)
    if (hit && Date.now() - hit.t < ttlMs) return hit.v
    if (_inflight.has(url)) return _inflight.get(url)
    const p = (async () => {
        try {
            const r = await fetch(url, credentials ? { credentials: "include" } : undefined)
            if (!r.ok) return null
            const v = await r.json()
            _cache.set(url, { t: Date.now(), v })
            return v
        } catch {
            return null
        } finally {
            _inflight.delete(url)
        }
    })()
    _inflight.set(url, p)
    return p
}

const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v))
const finite = (lat, lon) => Number.isFinite(num(lat)) && Number.isFinite(num(lon))
const clampLat = (v) => Math.max(-90, Math.min(90, v))
const clampLon = (v) => Math.max(-180, Math.min(180, v))

/** Leaflet bounds can run past ±180 when the map wraps; endpoints cannot. */
function normBounds(b) {
    if (!b) return null
    const south = clampLat(num(b.south)), north = clampLat(num(b.north))
    let west = num(b.west), east = num(b.east)
    if (![south, north, west, east].every(Number.isFinite)) return null
    if (east - west >= 360) { west = -180; east = 180 }
    return { south, north, west: clampLon(west), east: clampLon(east) }
}

/** Is a point in view? Handles a view across the antimeridian. */
function inBounds(lat, lon, b, pad = 0) {
    if (!b) return true
    const la = num(lat), lo = num(lon)
    if (la < b.south - pad || la > b.north + pad) return false
    const w = num(b.west), e = num(b.east)
    if (e - w >= 360) return true
    const wn = ((w + 540) % 360) - 180, en = ((e + 540) % 360) - 180
    const l = ((lo + 540) % 360) - 180
    return wn <= en ? (l >= wn - pad && l <= en + pad) : (l >= wn - pad || l <= en + pad)
}

/** Does a list of [lat, lon] touch the view? Cheap bbox test. */
function lineInView(coords, b) {
    if (!b) return true
    let s = 90, n = -90, w = 180, e = -180
    for (const [la, lo] of coords) {
        if (la < s) s = la; if (la > n) n = la
        if (lo < w) w = lo; if (lo > e) e = lo
    }
    if (n < b.south || s > b.north) return false
    if (num(b.east) - num(b.west) >= 360 || b.west > b.east) return true
    return !(e < b.west || w > b.east)
}

/** Points in view, finite, capped. */
function cullPoints(features, bounds) {
    const out = []
    for (const f of features) {
        if (!f || !finite(f.lat, f.lon)) continue
        if (!inBounds(f.lat, f.lon, bounds)) continue
        out.push(f)
        if (out.length >= MAX_FEATURES) break
    }
    return out
}

function cullLines(features, bounds) {
    const out = []
    for (const f of features) {
        const parts = Array.isArray(f.coords?.[0]?.[0]) ? f.coords : [f.coords]
        if (!parts.some((c) => c && c.length >= 2 && lineInView(c, bounds))) continue
        out.push(f)
        if (out.length >= MAX_FEATURES) break
    }
    return out
}

/** GeoJSON [lon, lat] list to Leaflet [lat, lon], dropping bad pairs. */
function ll(coords) {
    const out = []
    for (const p of arr(coords)) {
        const lon = num(p?.[0]), lat = num(p?.[1])
        if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon])
    }
    return out
}

/** A GeoJSON Polygon / MultiPolygon geometry as Leaflet rings. */
function geomRings(geom) {
    if (!geom) return null
    if (geom.type === "Polygon") {
        const rings = arr(geom.coordinates).map(ll).filter((r) => r.length >= 3)
        return rings.length ? rings : null
    }
    if (geom.type === "MultiPolygon") {
        const polys = arr(geom.coordinates)
            .map((poly) => arr(poly).map(ll).filter((r) => r.length >= 3))
            .filter((p) => p.length)
        return polys.length ? polys : null
    }
    return null
}

/** GeoJSON LineString / MultiLineString as Leaflet line parts. */
function geomLines(geom) {
    if (!geom) return []
    if (geom.type === "LineString") return [ll(geom.coordinates)].filter((c) => c.length >= 2)
    if (geom.type === "MultiLineString") return arr(geom.coordinates).map(ll).filter((c) => c.length >= 2)
    return []
}

function ringsInView(rings, bounds) {
    if (!bounds || !rings) return true
    const flat = []
    const walk = (x) => {
        if (Array.isArray(x) && typeof x[0] === "number") flat.push(x)
        else if (Array.isArray(x)) x.forEach(walk)
    }
    walk(rings)
    return flat.length ? lineInView(flat, bounds) : false
}

function cullAreas(features, bounds) {
    const out = []
    for (const f of features) {
        if (!f?.rings || !ringsInView(f.rings, bounds)) continue
        out.push(f)
        if (out.length >= MAX_FEATURES) break
    }
    return out
}

const bboxQuery = (b, digits = 4) =>
    `min_lat=${b.south.toFixed(digits)}&max_lat=${b.north.toFixed(digits)}`
    + `&min_lon=${b.west.toFixed(digits)}&max_lon=${b.east.toFixed(digits)}`

/** A small legend swatch for a line layer, in the layer's own colour. */
function lineSwatch(color, dash = null, width = 2.5) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
        + `<path d="M3 17 C 8 6, 15 20, 21 7" fill="none" stroke="${color}" stroke-width="${width}" `
        + `stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** A small legend swatch for an area layer, in the layer's own colour. */
function areaSwatch(color, fillOpacity = 0.3, stroke = true) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
        + `<path d="M4 7 L12 3 L20 8 L19 18 L9 21 L3 15 Z" fill="${color}" fill-opacity="${fillOpacity}" `
        + `${stroke ? `stroke="${color}" stroke-width="1.5"` : `stroke="none"`} stroke-linejoin="round"/></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Parse the backend's mixed timestamp spellings as UTC. */
function utcMs(s) {
    if (!s) return NaN
    const str = String(s).replace(" ", "T")
    return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`)
}

// ── GDELT (globe/GlobeGdeltLayer.jsx colourFor, verbatim) ─────────────────
function gdeltColourFor(goldstein) {
    const g = typeof goldstein === "number" ? goldstein : 0
    if (g <= -8) return "var(--sev-critical, #d4553f)"
    if (g <= -5) return "var(--sev-high, #e8a33d)"
    if (g < 0) return "var(--sev-medium, #c9a227)"
    return "var(--txt-4, #6f8fa8)"
}
function gdeltSeverity(goldstein) {
    const g = typeof goldstein === "number" ? goldstein : 0
    return g <= -8 ? "critical" : g <= -5 ? "high" : g < 0 ? "medium" : "low"
}

// ── FIRMS (globe/GlobeFiresLayer.jsx colourFor, verbatim) ─────────────────
function fireColourFor(k) {
    if (!k) return "var(--txt-4, #6f8fa8)"
    if (k >= 360) return "var(--sev-critical, #d4553f)"   // intense
    if (k >= 330) return "var(--sev-high, #e8a33d)"
    return "var(--sev-medium, #c9a227)"                    // warm, common
}

// ── Imagery signals (globe/GlobeImagerySignalsLayer.jsx icon, verbatim) ───
const IMG_SEV = { critical: "#E5484D", high: "#F5A524", moderate: "#8FB4E8", medium: "#8FB4E8", low: "#9AA9BC" }
const _imgIcons = {}
function imagerySignalIcon(sev) {
    const c = IMG_SEV[sev] || IMG_SEV.moderate
    if (_imgIcons[c]) return _imgIcons[c]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="5" y="5" width="22" height="22" fill="${c}" stroke="#0b1220" stroke-width="2.5"/>
      <path d="M16 9v14M9 16h14" stroke="#0b1220" stroke-width="2.4"/><circle cx="16" cy="16" r="4" fill="none" stroke="#0b1220" stroke-width="2.2"/></svg>`
    _imgIcons[c] = `data:image/svg+xml;base64,${btoa(svg)}`
    return _imgIcons[c]
}

// ── Telegram (globe/GlobeTelegramLayer.jsx icons, verbatim) ───────────────
const TG_SIZE = 18
let _tgUnrest = null, _tgSoon = null, _tgNow = null, _tgIcon = null
function tgUnrestIcon(announced = false) {
    if (announced ? _tgSoon : _tgUnrest) return announced ? _tgSoon : _tgUnrest
    const svg = announced
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#0b1220" stroke="#F5A524" stroke-width="3"/>
      <circle cx="16" cy="16" r="4.6" fill="none" stroke="#F5A524" stroke-width="1.8"/><path d="M16 13.6V16l1.8 1.2" stroke="#F5A524" stroke-width="1.6" fill="none"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#F5A524" stroke="#0b1220" stroke-width="2.5"/>
      <g fill="#0b1220"><circle cx="12.5" cy="14" r="1.7"/><circle cx="16" cy="13" r="1.9"/><circle cx="19.5" cy="14" r="1.7"/><path d="M10.5 19c.4-2 1.2-3 2-3s1.6 1 2 3zM14 19c.4-2.3 1.2-3.4 2-3.4s1.6 1.1 2 3.4zM17.5 19c.4-2 1.2-3 2-3s1.6 1 2 3z"/></g></svg>`
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`
    if (announced) _tgSoon = uri; else _tgUnrest = uri
    return uri
}
function tgNowIcon() {
    if (_tgNow) return _tgNow
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#E5484D" stroke="#0b1220" stroke-width="2.5"/>
      <path d="M16 10.5v6.8" stroke="#0b1220" stroke-width="2.6"/><circle cx="16" cy="21" r="1.6" fill="#0b1220"/></svg>`
    _tgNow = `data:image/svg+xml;base64,${btoa(svg)}`
    return _tgNow
}
function tgIcon() {
    if (_tgIcon) return _tgIcon
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#229ED9" stroke="#0b1220" stroke-width="2.5"/></svg>`
    _tgIcon = `data:image/svg+xml;base64,${btoa(svg)}`
    return _tgIcon
}

/**
 * The desktop draws a live development (telegram/situations) whenever
 * EITHER Telegram or Unrest is on. On the phone each is its own layer, so
 * a development is filed under the one its kind belongs to — crowd and
 * police actions under unrest, the rest under the front — rather than
 * drawn twice when both are on.
 */
const UNREST_SITUATION_KINDS = new Set(["kettle", "charge", "tear_gas", "water_cannon", "clashes", "closure"])

// ── Our assets (globe/GlobeAssetsLayer.jsx icon, verbatim) ────────────────
const ASSET_GLYPH = {
    Vessels: "M3 15h18l-2.5 4.5H5.5zM6 15V9h7l3 6M9 9V5.5h2.5V9",
    Aircraft: "M12 3v18M12 9l9 4v2l-9-2.5M12 9l-9 4v2l9-2.5M9.5 20l2.5-1.5 2.5 1.5",
    Vehicles: "M3 16V9.5l2.5-3h9l3 4H21V16zM6.5 18.5a1.8 1.8 0 100-.01M16.5 18.5a1.8 1.8 0 100-.01",
    Sites: "M3 20V10l5 3V10l5 3V7h3v13zM18 20V4h3v16",
    Energy: "M13 2L5 13h6l-1 9 8-11h-6z",
    Transport: "M4 20h16M6 20V12h12v8M9 12V7h6v5M12 7V3",
    People: "M12 4a3.2 3.2 0 100 6.4A3.2 3.2 0 0012 4zM5 20c.8-4 3.6-6 7-6s6.2 2 7 6",
    Telecoms: "M12 4v16M8.5 20l3.5-8 3.5 8M7 8a7 7 0 0 1 10 0M5 5a10 10 0 0 1 14 0",
}
const ASSET_RING = { high: "#E5484D", elevated: "#F5A524", low: "#8FB4E8", quiet: "#4CAF7A", unknown: "#9AA9BC" }
const _assetIcons = {}
function assetIcon(group, exposure) {
    const key = `${group}|${exposure}`
    if (_assetIcons[key]) return _assetIcons[key]
    const ring = ASSET_RING[exposure] || ASSET_RING.unknown
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
      <path d="M24 55 L16 44 H8 a6 6 0 0 1 -6 -6 V8 a6 6 0 0 1 6 -6 H40 a6 6 0 0 1 6 6 V38 a6 6 0 0 1 -6 6 H32 Z" fill="#0b1220" stroke="${ring}" stroke-width="3.5"/>
      <rect x="7" y="7" width="34" height="32" rx="4" fill="#C9A227"/>
      <g transform="translate(10 9) scale(1.17)" fill="none" stroke="#0b1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ASSET_GLYPH[group] || ASSET_GLYPH.Sites}"/></g>
    </svg>`
    _assetIcons[key] = `data:image/svg+xml;base64,${btoa(svg)}`
    return _assetIcons[key]
}

// ── Surge & fusion (globe/GlobeDerivedAlertsLayer.jsx, verbatim) ──────────
function surgeLabel(s) {
    const topic = (CAT[s.cat]?.name || s.cat || "activity")
        .split(" / ")[0].split(" ")[0].toUpperCase()
    const mult = Number(s.mult)
    if (Number.isFinite(mult) && mult >= 2) return `${topic} ×${Math.round(mult)}`
    return `${topic} · ${s.n}`
}
function fusionLabel(f) {
    const head = String(f.headline || "Converging evidence").replace(/\s+—.*$/, "")
    const short = head.length > 38 ? `${head.slice(0, 36).trim()}…` : head
    const n = (f.mods || []).length
    return n ? `${short} · ${n} kinds agree` : short
}
const derivedMark = (color) => getShapeMarkerDataUri({ shape: "triangle", color, size: MARK_SIZE.alert, strokeWidth: 1.5 })
const SURGE_MARK = "#b7822c"
const FUSION_MARK = "#c4453c"

// ── Facilities (globe/GlobeFacilitiesLayer.jsx, verbatim) ─────────────────
const FAC_COLOUR = { military: "#C084FC", medical: "#3DDC97", security: "#3D8BFF" }
const FAC_CATEGORY_LABEL = { military: "Military", medical: "Medical", security: "Police & fire" }
const FAC_TYPE_TO_CATEGORY = {
    "Military Facility": "military",
    "Medical Facility": "medical",
    "Security Facility": "security",
}
const FAC_SIZE = 18
/** The desktop refuses (and the backend refuses) a view over 60 deg². */
const FAC_MAX_SPAN_DEG2 = 60

// ── Ports / airports (globe/GlobePortLayer.jsx, GlobeAirportLayer.jsx) ─────
const PORT_ICON_SIZE = { "Very Large": 30, "Large": 26, "Medium": 22, "Small": 18 }
const AIRPORT_ICON_SIZE = { large_airport: 34, medium_airport: 28, small_airport: 22, seaplane_base: 26 }

// ── Chokepoints (globe/GlobeChokepointsLayer.jsx) ─────────────────────────
const CHOKE_SIZE = 26
let _chokeIcon = null
function chokeIcon() {
    if (!_chokeIcon) _chokeIcon = getEntityMarkerDataUri({ entityType: "zone", size: 26 })
    return _chokeIcon
}

// ── Airspace (globe/GlobeAirspaceLayer.jsx, verbatim) ─────────────────────
const AIRSPACE_MAX_SPAN_DEG = 14
const AIRSPACE_CLASS_COLOR = {
    A: "#4C8DFF", B: "#4C8DFF", C: "#5AC8FA", D: "#5AC8FA",
    E: "#7FD1AE", F: "#B9A6FF", G: "#B9A6FF",
    unclassified: "#8E9BAA",
}

// ── Nav interference (globe/GlobeGpsInterferenceLayer.jsx colorFor) ───────
// The desktop builds Cesium Colors; this is the same hue and alpha split
// into the colour and fill opacity Leaflet takes.
const GPS_CELL_DEG = 0.5
function gpsStyle(level, pct) {
    if (level === "clear") return { color: "#5c6b78", fillOpacity: 0.07 }
    const t = Math.max(0, Math.min(1, (num(pct) - 10) / 50)) || 0
    if (level === "severe") return { color: "#c4453c", fillOpacity: 0.3 + 0.45 * t }
    return { color: "#b7822c", fillOpacity: 0.22 + 0.35 * t }
}

// ── Frontlines (globe/GlobeFrontlinesLayer.jsx STATUS_STYLE, verbatim) ────
const FRONT_STATUS_STYLE = {
    occupied:  { fill: "#a52714", alpha: 0.32, label: "Russian-controlled" },
    unknown:   { fill: "#bcaaa4", alpha: 0.45, label: "Contested" },
    dismissed: { fill: "#0f9d58", alpha: 0.20, label: "Retaken / withdrawn" },
}

// ── Cables / EEZ / risk (globe/GlobeCablesLayer.jsx etc.) ─────────────────
const CABLE_URL = "/data/cable-geo.json"
const CABLE_FALLBACK_COLOR = "#9B59B6"
const EEZ_STROKE = "rgba(0,207,255,0.65)"
const RISK_COLOR = "#c4453c"          // RISK_RGB [196, 69, 60]
const RISK_STROKE = "rgba(196,69,60,0.55)"

// ── Flows (globe/GlobeFlowsLayer.jsx) ─────────────────────────────────────
const TRADE_COLOR = "#8E9BAA"
const DISRUPTED_COLOR = "#b7822c"
const ENERGY_COLOR = "#B9A6FF"
const GAS_CSS = "#2BB3A3"
const OIL_CSS = "#9B6B3D"

// ── Power grid (globe/GlobeInfraLayer.jsx, verbatim) ──────────────────────
function voltageColor(kv) {
    const v = Number(kv) || 0
    if (v >= 550) return "#4A6CF5"
    if (v >= 330) return "#00C1CF"
    if (v >= 220) return "#B54EB2"
    if (v >= 132) return "#C73030"
    if (v >= 52) return "#B55D00"
    if (v >= 25) return "#B59F10"
    if (v >= 10) return "#55B555"
    return "#8A8A95"
}
const PIPE = { gas: "#BFBC6B", oil: "#6B583F", fuel: "#7C6040", water: "#7B7CBA", hot_water: "#B07CC0", steam: "#C0A0D0" }
function infraLineStyle(f) {
    const p = f.props || {}
    if (f.kind === "power_line" || f.kind === "power_cable") {
        const v = Number(p.voltage) || 0
        return { color: voltageColor(v), width: v >= 380 ? 2.6 : v >= 220 ? 2.2 : v >= 100 ? 1.8 : 1.3, dashed: f.kind === "power_cable" }
    }
    if (f.kind === "pipeline" || f.kind === "water_pipeline") {
        return { color: PIPE[p.substance] || (f.kind === "water_pipeline" ? PIPE.water : "#A08A60"), width: 2, dashed: p.location === "underground" }
    }
    if (f.kind === "telecom_line") return { color: "#61B37A", width: 1.4, dashed: true }
    return { color: "#999999", width: 1.2, dashed: false }
}
const SOURCE_COLOR = { nuclear: "#E5D33A", coal: "#8B7B6B", gas: "#E58A3A", oil: "#9A6A40", wind: "#4FB4E8",
                       solar: "#F2C230", hydro: "#3A7FE5", biomass: "#5FA05A", waste: "#8F8F6A", battery: "#B0B0FF" }
const INFRA_GLYPH = {
    power_plant: "M13 2 5 13h6l-1 9 8-11h-6z",
    substation: "M4 6h16v12H4zM8 6v12M16 6v12M4 12h16",
    wind_turbine: "M12 12 12 3M12 12l7.5 4.5M12 12l-7.5 4.5M12 12v10",
    telecom_mast: "M12 4v18M8 22l4-10 4 10M7 7a7 7 0 0 1 10 0M5 4.5a10 10 0 0 1 14 0",
    data_center: "M5 4h14v5H5zM5 10h14v5H5zM5 16h14v4H5zM8 6.5h.01M8 12.5h.01",
    well: "M4 20h16M7 20l5-12 5 12M5 9l14-4M12 8v-4",
    petroleum_site: "M4 20V10a4 4 0 0 1 8 0v10M12 20v-7a4 4 0 0 1 8 0v7M3 20h18",
}
const _infraIcons = new Map()
function infraIconFor(f) {
    const p = f.props || {}
    const fill = f.kind === "power_plant" ? (SOURCE_COLOR[p.source] || "#E58A3A")
        : f.kind === "substation" ? voltageColor(p.voltage)
        : f.kind === "wind_turbine" ? SOURCE_COLOR.wind
        : f.kind === "telecom_mast" || f.kind === "data_center" ? "#61B37A"
        : "#B08850"
    const key = `${f.kind}|${fill}`
    if (_infraIcons.has(key)) return _infraIcons.get(key)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="17" fill="#0b1220" stroke="${fill}" stroke-width="3"/>
      <g transform="translate(8 8)" fill="none" stroke="${fill}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${INFRA_GLYPH[f.kind] || INFRA_GLYPH.power_plant}"/></g>
    </svg>`
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`
    _infraIcons.set(key, uri)
    return uri
}
const INFRA_POINT_SIZE = { power_plant: 26, substation: 18, wind_turbine: 16, telecom_mast: 16, data_center: 20, well: 15, petroleum_site: 20 }
const infraZoom = (z) => Math.max(2, Math.min(15, Math.round(Number(z) || 2)))

// AOIs have no map drawing on the desktop (the toggle is wired to nothing
// there); drawn here as the zones they are, in the console's overlay blue.
const AOI_COLOR = "#3D8BFF"

// ── loaders ───────────────────────────────────────────────────────────────

async function loadGeoConfirmed({ bounds, hours }) {
    // GlobeView: maxAgeDays = ceil(signalWindowHours / 24), at least 1.
    const days = Math.max(1, Math.ceil((Number(hours) || 24 * 30) / 24))
    const d = await getJson(`${API_BASE}/api/geoconfirmed/placemarks?max_age_days=${days}&limit=2000`)
    return cullPoints(arr(d?.placemarks).map((p) => ({
        id: `geoconfirmed-${p.id}`,
        lat: num(p.lat), lon: num(p.lon),
        iconUri: getGeoConfirmedMarkerDataUri({
            color: p.faction_color, invertColor: !!p.faction_invert_color, size: GEOCONFIRMED_MARKER_SIZE,
        }),
        size: GEOCONFIRMED_MARKER_SIZE,
        title: p.title || p.name || "Geolocated event",
        sub: [p.faction, p.date_label].filter(Boolean).join(" · ") || null,
        severity: null,
        raw: p,
    })), normBounds(bounds))
}

async function loadGdelt({ bounds }) {
    const size = MARK_SIZE.gdelt
    const d = await getJson(`${API_BASE}/api/gdelt/map-points?limit=1500`)
    return cullPoints(arr(d?.points).map((p) => ({
        id: `gdelt-${p.id}`,
        lat: num(p.lat), lon: num(p.lon),
        iconUri: getShapeMarkerDataUri({ shape: "diamond", color: gdeltColourFor(p.goldstein), size }),
        size,
        title: p.title || p.original_title || "Wire report",
        sub: p.location_name || null,
        severity: gdeltSeverity(p.goldstein),
        raw: p,
    })), normBounds(bounds))
}

const tgHours = (hours) => Math.max(48, Number(hours) || 48)

async function loadTelegram({ bounds, hours }) {
    const [posts, sit] = await Promise.all([
        getJson(`${API_BASE}/api/telegram/posts?hours=${tgHours(hours)}`),
        getJson(`${API_BASE}/api/telegram/situations`),
    ])
    const feats = []
    for (const a of arr(sit?.situations)) {
        if (UNREST_SITUATION_KINDS.has(a.kind)) continue
        feats.push({
            id: a.id, lat: num(a.lat), lon: num(a.lon), iconUri: tgNowIcon(), size: TG_SIZE + 4,
            title: a.happening || a.place || "Live development",
            sub: [a.place, a.channel_title].filter(Boolean).join(" · ") || null,
            severity: "high", raw: a,
        })
    }
    for (const p of arr(posts?.posts)) {
        if (p.category === "unrest") continue
        feats.push({
            id: p.id, lat: num(p.lat), lon: num(p.lon), iconUri: tgIcon(), size: TG_SIZE,
            title: p.headline || p.summary_en || "Telegram post",
            sub: [p.place, p.channel_title].filter(Boolean).join(" · ") || null,
            severity: p.severity_tier || null,
            raw: { ...p, thumb_url: p.thumb_url ? `${API_BASE}${p.thumb_url}` : null },
        })
    }
    return cullPoints(feats, normBounds(bounds))
}

async function loadUnrest({ bounds, hours }) {
    const [posts, sit, up] = await Promise.all([
        getJson(`${API_BASE}/api/telegram/posts?hours=${tgHours(hours)}`),
        getJson(`${API_BASE}/api/telegram/situations`),
        getJson(`${API_BASE}/api/telegram/upcoming?days=14`, { ttlMs: 60_000 }),
    ])
    const feats = []
    for (const a of arr(sit?.situations)) {
        if (!UNREST_SITUATION_KINDS.has(a.kind)) continue
        feats.push({
            id: a.id, lat: num(a.lat), lon: num(a.lon), iconUri: tgNowIcon(), size: TG_SIZE + 4,
            title: a.happening || a.place || "Live development",
            sub: [a.place, a.channel_title].filter(Boolean).join(" · ") || null,
            severity: "high", raw: a,
        })
    }
    for (const p of arr(posts?.posts)) {
        if (p.category !== "unrest") continue
        feats.push({
            id: p.id, lat: num(p.lat), lon: num(p.lon), iconUri: tgUnrestIcon(), size: TG_SIZE,
            title: p.headline || p.summary_en || "Unrest",
            sub: [p.place, p.channel_title].filter(Boolean).join(" · ") || null,
            severity: p.severity_tier || null,
            raw: { ...p, thumb_url: p.thumb_url ? `${API_BASE}${p.thumb_url}` : null },
        })
    }
    for (const a of arr(up?.upcoming)) {
        feats.push({
            id: a.id, lat: num(a.lat), lon: num(a.lon), iconUri: tgUnrestIcon(true), size: TG_SIZE + 2,
            title: a.headline || a.what || "Announced gathering",
            sub: [a.when_label, a.channel_title].filter(Boolean).join(" · ") || null,
            severity: null, raw: a,
        })
    }
    return cullPoints(feats, normBounds(bounds))
}

async function loadImagerySignals({ bounds }) {
    const d = await getJson(`${API_BASE}/api/alerts?source=SAT-TASK&limit=200`)
    const cutoff = Date.now() - 7 * 86_400_000
    const rows = arr(Array.isArray(d) ? d : d?.alerts)
        .filter((a) => finite(a.lat, a.lon) && utcMs(a.created_at) >= cutoff)
    return cullPoints(rows.map((a) => ({
        id: `imgsig-${a.alert_id}`,
        lat: num(a.lat), lon: num(a.lon),
        iconUri: imagerySignalIcon(a.severity), size: 22,
        title: a.title || a.alert_type || "Imagery signal",
        sub: a.region || null,
        severity: a.severity || null,
        raw: { ...a, id: a.alert_id, source: "SAT-TASK" },
    })), normBounds(bounds))
}

async function loadFires({ bounds }) {
    // GlobeView mounts GlobeFiresLayer without `hours`, so the desktop
    // always shows its 72-hour default rather than the signal window.
    const size = MARK_SIZE.fire
    const d = await getJson(`${API_BASE}/api/fires?hours=72&limit=2000`)
    return cullPoints(arr(d?.fires).map((f) => ({
        id: `fire-${f.id}`,
        lat: num(f.lat), lon: num(f.lon),
        iconUri: getShapeMarkerDataUri({ shape: "circle", color: fireColourFor(f.brightness_k), size }),
        size,
        title: f.label || "Thermal anomaly",
        sub: [f.instrument || "VIIRS", f.satellite, f.frp ? `${f.frp} MW` : null].filter(Boolean).join(" · "),
        severity: !f.brightness_k ? null : f.brightness_k >= 360 ? "critical" : f.brightness_k >= 330 ? "high" : "medium",
        raw: f,
    })), normBounds(bounds))
}

async function loadDerivedAlerts({ bounds }) {
    const [s, f] = await Promise.all([
        getJson(`${API_BASE}/api/alerts/surges`, { credentials: false }),
        getJson(`${API_BASE}/api/alerts/fusions`, { credentials: false }),
    ])
    const size = MARK_SIZE.alert
    const feats = []
    for (const x of arr(s?.surges)) {
        const cat = CAT[x.cat] || { name: x.cat || "activity" }
        feats.push({
            id: `surge-${x.id}`, lat: num(x.lat), lon: num(x.lon),
            iconUri: derivedMark(SURGE_MARK), size,
            title: `${String(cat.name).toLowerCase()} reporting surging around ${x.place || "this area"}`,
            sub: surgeLabel(x), severity: "high", raw: { ...x, kind: "surge" },
        })
    }
    for (const x of arr(f?.fusions)) {
        feats.push({
            id: `fusion-${x.id}`, lat: num(x.lat), lon: num(x.lon),
            iconUri: derivedMark(FUSION_MARK), size,
            title: x.headline || "Converging evidence",
            sub: [x.place, fusionLabel(x)].filter(Boolean).join(" · ") || null,
            severity: "critical", raw: { ...x, kind: "fusion" },
        })
    }
    return cullPoints(feats, normBounds(bounds))
}

function gfwLoader(kind) {
    return async ({ bounds }) => {
        const d = await getJson(`${API_BASE}/api/gfw/events?kind=${encodeURIComponent(kind)}&days=14&limit=300`,
                                { ttlMs: 5 * 60_000 })
        if (!d?.available) return []
        const style = gfwStyleFor(kind)
        const icon = getShapeMarkerDataUri({ shape: style.shape, color: style.color, size: 15, invert: true, strokeWidth: 1.6 })
        return cullPoints(arr(d.events).filter((ev) => ev?.id).map((ev) => ({
            id: `gfw-${kind}-${ev.id}`,
            lat: num(ev.lat), lon: num(ev.lon),
            iconUri: icon, size: 15,
            title: gfwSummaryOf({ ...ev, kind }),
            sub: [gfwAgeLabel(ev.start), "satellite AIS, not live"].filter(Boolean).join(" · "),
            severity: null,
            raw: { ...ev, kind, source: d.source, source_url: d.source_url, lag_days: d.lag_days },
        })), normBounds(bounds))
    }
}

async function loadAssets({ bounds }) {
    const d = await getJson(`${API_BASE}/api/my-assets`)
    const rows = arr(d?.assets).filter((a) => a.position)
    return cullPoints(rows.map((a) => ({
        id: `asset-${a.id}`,
        lat: num(a.position.lat), lon: num(a.position.lon),
        iconUri: assetIcon(a.group, a.exposure),
        size: 34,
        // Not square: the pin is 34 x 40 and stands on its point.
        iconWidth: 34, iconHeight: 40, iconAnchor: [17, 40],
        title: a.name || a.type_label || "Asset",
        sub: [a.type_label || a.kind_label || a.group, a.exposure ? `${a.exposure} exposure` : null].filter(Boolean).join(" · ") || null,
        severity: a.exposure || null,
        raw: a,
    })), normBounds(bounds))
}

async function loadChokepoints({ bounds }) {
    const d = await getJson(`${API_BASE}/api/infrastructure/chokepoints`, { ttlMs: 10 * 60_000, credentials: false })
    return cullPoints(arr(d?.chokepoints).map((c) => ({
        id: `choke-${c.id ?? c.system_id ?? c.name}`,
        lat: num(c.lat ?? c.center?.[0]), lon: num(c.lon ?? c.center?.[1]),
        iconUri: chokeIcon(), size: CHOKE_SIZE,
        title: c.name || "Chokepoint",
        sub: c.current_status || c.strategic_description || null,
        severity: null,
        raw: c,
    })), normBounds(bounds))
}

async function loadPorts({ bounds }) {
    const b = normBounds(bounds)
    if (!b) return []
    const d = await getJson(`${API_BASE}/api/ports/in-viewport?${bboxQuery(b)}`, { credentials: false })
    return cullPoints(arr(d?.features).map((f) => {
        const p = f.properties || {}
        const [lon, lat] = f.geometry?.coordinates || []
        const sz = PORT_ICON_SIZE[p.port_size] || 18
        return {
            id: `port-${p.system_id}`, lat: num(lat), lon: num(lon),
            iconUri: infraGlyphUri("port", { state: "nominal", theme: "dark", size: PORT_ICON_SIZE[p.port_size || "Small"] || 22 }),
            size: sz,
            title: p.port_name || p.name || "Port",
            sub: [p.port_size ? `${p.port_size} port` : null, p.country].filter(Boolean).join(" · ") || null,
            severity: null,
            raw: { ...p, lat, lon },
        }
    }), b)
}

async function loadAirports({ bounds }) {
    const b = normBounds(bounds)
    if (!b) return []
    const d = await getJson(`${API_BASE}/api/airports/in-viewport?${bboxQuery(b)}`, { credentials: false })
    return cullPoints(arr(d?.features).map((f) => {
        const p = f.properties || {}
        const [lon, lat] = f.geometry?.coordinates || []
        const type = p.airport_type || "small_airport"
        return {
            id: `airport-${p.system_id}`, lat: num(lat), lon: num(lon),
            iconUri: infraGlyphUri("airport", { theme: "dark", size: AIRPORT_ICON_SIZE[type] || 20 }),
            size: AIRPORT_ICON_SIZE[p.airport_type] || 22,
            title: p.airport_name || p.name || p.ident || "Airport",
            sub: [p.iata_code || p.icao_code, p.municipality, p.country_name].filter(Boolean).join(" · ") || null,
            severity: null,
            raw: { ...p, lat, lon },
        }
    }), b)
}

function facilityLoader(category) {
    return async ({ bounds }) => {
        const b = normBounds(bounds)
        if (!b) return []
        const span = Math.abs(b.north - b.south) * Math.abs(b.east - b.west)
        if (span > FAC_MAX_SPAN_DEG2) return []
        const d = await getJson(`${API_BASE}/api/facilities/in-viewport?${bboxQuery(b, 3)}`, { ttlMs: 60_000 })
        if (!d || d.refused) return []
        const colour = FAC_COLOUR[category]
        return cullPoints(arr(d.facilities)
            .filter((f) => (f.category || FAC_TYPE_TO_CATEGORY[f.entity_type]) === category)
            .map((f) => ({
                id: `facility-${f.system_id}`, lat: num(f.lat), lon: num(f.lon),
                iconUri: getFacilityMarkerDataUri({ kind: f.kind, color: colour, size: FAC_SIZE }),
                size: FAC_SIZE,
                title: f.name || `${String(f.kind || "site").replace(/_/g, " ")} (unnamed)`,
                sub: [FAC_CATEGORY_LABEL[category], f.operator].filter(Boolean).join(" · ") || null,
                severity: null,
                raw: f,
            })), b)
    }
}

async function loadInfraRaw({ bounds, zoom }) {
    const b = normBounds(bounds)
    if (!b) return null
    // Rounded so a small pan reuses the last answer rather than refetching.
    const r = (v) => v.toFixed(2)
    return getJson(`${API_BASE}/api/infra/features?west=${r(b.west)}&south=${r(b.south)}`
                   + `&east=${r(b.east)}&north=${r(b.north)}&zoom=${infraZoom(zoom)}`, { ttlMs: 60_000 })
}

async function loadPowerLines({ bounds, zoom }) {
    const d = await loadInfraRaw({ bounds, zoom })
    const out = []
    for (const f of arr(d?.features)) {
        if (!f?.line) continue
        const st = infraLineStyle(f)
        const parts = arr(f.line).map((seg) => ll(seg)).filter((c) => c.length >= 2)
        if (!parts.length) continue
        out.push({
            id: f.id, coords: parts, color: st.color, weight: st.width,
            dash: st.dashed ? "6 6" : null,
            title: f.title || String(f.kind || "line").replace(/_/g, " "),
            raw: f,
        })
    }
    return cullLines(out, normBounds(bounds))
}

async function loadPowerSites({ bounds, zoom }) {
    const d = await loadInfraRaw({ bounds, zoom })
    return cullPoints(arr(d?.features).filter((f) => f && !f.line).map((f) => ({
        id: f.id, lat: num(f.lat), lon: num(f.lon),
        iconUri: infraIconFor(f), size: INFRA_POINT_SIZE[f.kind] || 16,
        title: f.title || String(f.kind || "site").replace(/_/g, " "),
        sub: String(f.kind || "").replace(/_/g, " ") || null,
        severity: null,
        raw: f,
    })), normBounds(bounds))
}

async function loadCables({ bounds }) {
    const geo = await getJson(CABLE_URL, { ttlMs: 24 * 3600_000, credentials: false })
    const out = []
    arr(geo?.features).forEach((feature, fi) => {
        const p = feature.properties || {}
        const parts = geomLines(feature.geometry)
        if (!parts.length) return
        out.push({
            id: `cable-${p.feature_id || p.id || fi}`,
            coords: parts, color: p.color || CABLE_FALLBACK_COLOR, weight: 2, dash: null,
            title: p.name || "Unknown Cable",
            raw: p,
        })
    })
    return cullLines(out, normBounds(bounds))
}

async function loadEez({ bounds }) {
    const geo = await getJson(`${API_BASE}/geo/eez`, { ttlMs: 24 * 3600_000, credentials: false })
    const out = []
    arr(geo?.features).forEach((feature, fi) => {
        const raw = feature.properties || {}
        const parts = geomLines(feature.geometry)
        if (!parts.length) return
        out.push({
            id: `eez-${raw.line_id ?? raw.id ?? fi}`,
            coords: parts, color: EEZ_STROKE, weight: 1.5, dash: null,
            title: raw.eez1 || raw.line_name || "EEZ Boundary",
            raw,
        })
    })
    return cullLines(out, normBounds(bounds))
}

async function loadRisk({ bounds }) {
    const [geo, risk] = await Promise.all([
        getJson("/data/world-countries.json", { ttlMs: 24 * 3600_000, credentials: false }),
        getJson(`${API_BASE}/api/risk-index/countries`, { ttlMs: 5 * 60_000, credentials: false }),
    ])
    if (!arr(geo?.features).length) return []
    const a2ToA3 = buildA2ToA3(geo.features)
    const { byIso } = indexByIso3(risk?.countries, a2ToA3)
    const out = []
    for (const f of geo.features) {
        const p = f.properties || {}
        const row = byIso.get(String(p.a3 || "").toUpperCase())
        if (!row) continue
        const alpha = riskAlpha(row.score, row.band)
        if (!(alpha > 0)) continue
        const rings = geomRings(f.geometry)
        if (!rings) continue
        out.push({
            id: `risk-${p.a3}`, rings, color: RISK_COLOR, fillOpacity: alpha, weight: 1,
            strokeColor: RISK_STROKE,
            title: `${p.n || row.iso_code} — country risk`,
            raw: { iso3: p.a3, country: p.n, score: row.score, band: row.band,
                   components: row.components, contributions: row.contributions },
        })
    }
    return cullAreas(out, normBounds(bounds))
}

async function loadFrontlines({ bounds }) {
    const d = await getJson(`${API_BASE}/api/frontlines`, { ttlMs: 10 * 60_000 })
    if (!d?.available) return []
    const out = []
    arr(d.geojson?.features).forEach((f, i) => {
        const raw = f.properties || {}
        const style = FRONT_STATUS_STYLE[raw.status]
        if (!style) return
        const rings = geomRings(f.geometry)
        if (!rings) return
        out.push({
            id: `frontline-${raw.id ?? i}`, rings, color: style.fill, fillOpacity: style.alpha, weight: 0,
            title: style.label,
            raw: { ...raw, theatre: d.theatre, drawn_at: d.drawn_at, source: d.source,
                   source_url: d.source_url, coverage: d.coverage_note },
        })
    })
    return cullAreas(out, normBounds(bounds))
}

async function loadAirspace({ bounds }) {
    const b = normBounds(bounds)
    if (!b) return []
    if (Math.max(b.north - b.south, b.east - b.west) > AIRSPACE_MAX_SPAN_DEG) return []
    const q = `west=${b.west.toFixed(2)}&south=${b.south.toFixed(2)}&east=${b.east.toFixed(2)}&north=${b.north.toFixed(2)}`
    const d = await getJson(`${API_BASE}/api/airspace?${q}&limit=400`, { ttlMs: 60_000 })
    if (!d?.available) return []
    const out = []
    for (const a of arr(d.airspaces)) {
        if (!a?.id) continue
        const ring = ll(a.ring)
        if (ring.length < 3) continue
        out.push({
            id: `airspace-${a.id}`, rings: [ring],
            color: AIRSPACE_CLASS_COLOR[a.icao_class] || AIRSPACE_CLASS_COLOR.unclassified,
            fillOpacity: 0.10, weight: 1,
            title: a.name || `Airspace ${a.icao_class}`,
            raw: { ...a, source: d.source, source_url: d.source_url },
        })
    }
    return cullAreas(out, b)
}

async function loadGpsInterference({ bounds }) {
    // Not viewport-bounded on the desktop on purpose (a continental fact,
    // cheap cells); fetched whole here too and only culled for drawing.
    const d = await getJson(`${API_BASE}/api/gps-interference`, { credentials: false })
    const b = normBounds(bounds)
    const out = []
    for (const c of arr(d?.cells)) {
        if (!finite(c.lat, c.lon)) continue
        const lat = num(c.lat), lon = num(c.lon)
        const half = (Number(c.cell_deg) || GPS_CELL_DEG) / 2
        if (!inBounds(lat, lon, b, half)) continue
        const st = gpsStyle(c.level, c.pct)
        const pct = Number.isFinite(num(c.pct)) ? `${Math.round(num(c.pct))}%` : "?"
        out.push({
            id: `gpsjam-${c.cell}`,
            rings: [[[lat - half, lon - half], [lat - half, lon + half], [lat + half, lon + half], [lat + half, lon - half]]],
            color: st.color, fillOpacity: st.fillOpacity, weight: 0,
            title: c.level === "clear"
                ? `Nav integrity normal — ${c.aircraft ?? "?"} aircraft`
                : `Nav interference (${c.level}) — ${pct} of ${c.aircraft ?? "?"} aircraft degraded`,
            raw: c,
        })
        if (out.length >= MAX_FEATURES) break
    }
    return out
}

async function loadFlows({ bounds }) {
    const [tr, pl, st] = await Promise.all([
        getJson(`${API_BASE}/api/infrastructure/shipping-routes`, { ttlMs: 10 * 60_000 }),
        getJson(`${API_BASE}/api/infrastructure/pipelines-osm`, { ttlMs: 10 * 60_000 }),
        getJson(`${API_BASE}/api/flows/status`, { ttlMs: 60_000 }),
    ])
    const status = {}
    for (const r of arr(st?.routes)) status[r.id] = r
    const out = []
    for (const r of arr(tr?.routes)) {
        const coords = ll(r?.coordinates)
        if (coords.length < 2 || !r?.id) continue
        const disrupted = !!status[r.id]?.disrupted
        out.push({
            id: `flow-trade-${r.id}`, coords,
            color: disrupted ? DISRUPTED_COLOR : TRADE_COLOR,
            weight: disrupted ? 3.5 : 2,
            // Dashed because the line is schematic; shorter when disrupted.
            dash: disrupted ? "4 4" : "9 9",
            title: r.name || r.id,
            raw: { ...r, status: status[r.id] || null },
        })
    }
    arr(pl?.pipelines).forEach((p, i) => {
        const coords = ll(p?.coordinates)
        if (coords.length < 2) return
        out.push({
            id: `flow-energy-${p.id || i}`, coords,
            color: p.substance === "oil" ? OIL_CSS : p.substance === "gas" ? GAS_CSS : ENERGY_COLOR,
            weight: 2, dash: null,
            title: `${p.name || "Pipeline"}${p.substance ? ` · ${p.substance}` : ""}`,
            raw: p,
        })
    })
    return cullLines(out, normBounds(bounds))
}

async function loadAois({ bounds }) {
    const d = await getJson(`${API_BASE}/api/imagery/aois`, { ttlMs: 60_000, credentials: false })
    const out = []
    for (const z of arr(d)) {
        let rings = geomRings(z.polygon_geojson?.type ? z.polygon_geojson : z.polygon_geojson?.geometry)
        const bb = z.bbox || {}
        if (!rings && [bb.min_lat, bb.min_lon, bb.max_lat, bb.max_lon].every((v) => Number.isFinite(num(v)))) {
            rings = [[[bb.min_lat, bb.min_lon], [bb.min_lat, bb.max_lon], [bb.max_lat, bb.max_lon], [bb.max_lat, bb.min_lon]]]
        }
        if (!rings) continue
        out.push({
            id: `aoi-${z.system_id || z.id}`, rings, color: AOI_COLOR,
            fillOpacity: z.status === "active" ? 0.10 : 0.04, weight: 1.2,
            title: z.name || "Area of interest",
            raw: z,
        })
    }
    return cullAreas(out, normBounds(bounds))
}

// ── the registry ──────────────────────────────────────────────────────────

const G = {
    assets: "Our assets",
    maritime: "Maritime",
    air: "Air",
    news: "News",
    imagery: "Imagery",
    zones: "Zones",
    alerts: "Alerts",
    context: "Context",
    infra: "Infrastructure",
}

const GFW_LABEL = {
    encounters: "Vessel encounters",
    gaps: "AIS gaps",
    loitering: "Loitering",
    "port-visits": "Port visits",
}

export const PHONE_LAYERS = [
    // Our assets — Situation's first group.
    {
        key: "assets", label: "Our assets", group: G.assets, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: assetIcon("Sites", "quiet"), load: loadAssets,
    },

    // Maritime (LAYER_GROUPS.maritime; live vessels are the phone's own).
    {
        key: "ports", label: "Ports", group: G.maritime, defaultOn: true, kind: "points", minZoom: 3,
        legendIcon: infraGlyphUri("port", { state: "nominal", theme: "dark", size: 22 }), load: loadPorts,
    },
    {
        key: "cables", label: "Submarine Cables", group: G.maritime, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(CABLE_FALLBACK_COLOR), load: loadCables,
    },
    {
        key: "chokepoints", label: "Chokepoints", group: G.maritime, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: getEntityMarkerDataUri({ entityType: "zone", size: 26 }), load: loadChokepoints,
    },
    ...GFW_KINDS.map((kind) => {
        const style = gfwStyleFor(kind)
        return {
            key: `gfw:${kind}`, label: GFW_LABEL[kind] || style.label, group: G.maritime,
            defaultOn: false, kind: "points", minZoom: 0,
            legendIcon: getShapeMarkerDataUri({ shape: style.shape, color: style.color, size: 15, invert: true, strokeWidth: 1.6 }),
            load: gfwLoader(kind),
        }
    }),

    // Air (LAYER_GROUPS.air; live aircraft are the phone's own).
    {
        key: "airports", label: "Airports", group: G.air, defaultOn: true, kind: "points", minZoom: 3,
        legendIcon: infraGlyphUri("airport", { theme: "dark", size: 22 }), load: loadAirports,
    },
    {
        key: "gpsInterference", label: "Nav interference", group: G.air, defaultOn: false, kind: "areas", minZoom: 0,
        legendIcon: areaSwatch("#c4453c", 0.55, false), load: loadGpsInterference,
    },
    {
        key: "airspace", label: "Controlled airspace", group: G.air, defaultOn: false, kind: "areas", minZoom: 6,
        legendIcon: areaSwatch(AIRSPACE_CLASS_COLOR.C, 0.2), load: loadAirspace,
    },

    // News.
    {
        key: "geoConfirmed", label: "Confirmed", group: G.news, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: getGeoConfirmedMarkerDataUri({ color: null, size: GEOCONFIRMED_MARKER_SIZE }), load: loadGeoConfirmed,
    },
    {
        key: "gdelt", label: "Unconfirmed (wire)", group: G.news, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: getShapeMarkerDataUri({ shape: "diamond", color: gdeltColourFor(-6), size: MARK_SIZE.gdelt }), load: loadGdelt,
    },
    {
        key: "telegram", label: "Telegram", group: G.news, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: tgIcon(), load: loadTelegram,
    },
    {
        key: "unrest", label: "Unrest & protests", group: G.news, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: tgUnrestIcon(), load: loadUnrest,
    },

    // Imagery.
    {
        key: "imagerySignals", label: "Imagery signals", group: G.imagery, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: imagerySignalIcon("high"), load: loadImagerySignals,
    },
    {
        key: "fires", label: "Heat (thermal anomalies)", group: G.imagery, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: getShapeMarkerDataUri({ shape: "circle", color: fireColourFor(340), size: MARK_SIZE.fire }), load: loadFires,
    },

    // Zones.
    {
        key: "eez", label: "Exclusive Economic Zones", group: G.zones, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(EEZ_STROKE, null, 1.8), load: loadEez,
    },

    // Alerts.
    {
        key: "derivedAlerts", label: "Surge & fusion", group: G.alerts, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: derivedMark(FUSION_MARK), load: loadDerivedAlerts,
    },

    // Context (CONTEXT_TOGGLES; graticule, marker labels and coverage are not drawn on the phone).
    {
        key: "risk", label: "Country risk index", group: G.context, defaultOn: true, kind: "areas", minZoom: 0,
        legendIcon: areaSwatch(RISK_COLOR, 0.46), load: loadRisk,
    },
    {
        key: "flows", label: "Trade & energy flows", group: G.context, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(TRADE_COLOR, "4 3"), load: loadFlows,
    },
    {
        key: "aois", label: "Areas of interest", group: G.context, defaultOn: false, kind: "areas", minZoom: 0,
        legendIcon: areaSwatch(AOI_COLOR, 0.15), load: loadAois,
    },
    {
        key: "frontlines", label: "Frontlines", group: G.context, defaultOn: false, kind: "areas", minZoom: 0,
        legendIcon: areaSwatch(FRONT_STATUS_STYLE.occupied.fill, 0.45, false), load: loadFrontlines,
    },

    // Infrastructure (INFRA_TOGGLES; ports, chokepoints and cables live under Maritime, airfields under Air).
    {
        key: "power", label: "Power grid", group: G.infra, defaultOn: false, kind: "lines", minZoom: 3,
        legendIcon: lineSwatch(voltageColor(380)), load: loadPowerLines,
    },
    {
        key: "power:sites", label: "Power grid — plants & substations", group: G.infra, defaultOn: false, kind: "points", minZoom: 3,
        legendIcon: infraIconFor({ kind: "power_plant", props: {} }), load: loadPowerSites,
    },
    {
        key: "facMilitary", label: "Military facilities", group: G.infra, defaultOn: false, kind: "points", minZoom: 7,
        legendIcon: getFacilityMarkerDataUri({ kind: "military", color: FAC_COLOUR.military, size: FAC_SIZE }),
        load: facilityLoader("military"),
    },
    {
        key: "facMedical", label: "Medical facilities", group: G.infra, defaultOn: false, kind: "points", minZoom: 7,
        legendIcon: getFacilityMarkerDataUri({ kind: "hospital", color: FAC_COLOUR.medical, size: FAC_SIZE }),
        load: facilityLoader("medical"),
    },
    {
        key: "facSecurity", label: "Security facilities", group: G.infra, defaultOn: false, kind: "points", minZoom: 7,
        legendIcon: getFacilityMarkerDataUri({ kind: "police", color: FAC_COLOUR.security, size: FAC_SIZE }),
        load: facilityLoader("security"),
    },
]

/** PHONE_LAYERS grouped, in order: [{ group, layers: [...] }]. */
export function layerGroups() {
    const out = []
    const at = new Map()
    for (const l of PHONE_LAYERS) {
        if (!at.has(l.group)) { at.set(l.group, out.length); out.push({ group: l.group, layers: [] }) }
        out[at.get(l.group)].layers.push(l)
    }
    return out
}

/** For tests: forget cached responses. */
export function _clearLayerCache() { _cache.clear(); _inflight.clear() }
