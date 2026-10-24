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
import { safeHouseIcon, placesLabel } from "../evacuation/safeHouseIcon.js"
import API_BASE from "../apiBase.js"
import { actIcon, signalIcon, signalPriority, cardText, liveSignalDrawn, mediaSources, representative, ICON_PX } from "../lib/liveSignals.js"
import { imageryIcon, markerUri, markerIcon, pinIcon, infraIcon, dotIcon, priorityOf, SIZE } from "../lib/mapIcons.js"
import { PROTESTS_PATH, LIVE_REFRESH_MS, getFrame, setMeta, protestFeatures, protestBadge, refreshMs as protestsRefreshMs } from "../lib/protests.js"
import { myPosition } from "../location/liveShare.js"
import { getCurrentUser } from "../state/authStore.js"
import { getGeoConfirmedMarkerDataUri, getFacilityMarkerDataUri } from "../globe/entityIcons.js"
import { infraGlyphUri } from "../globe/infraGlyphs.js"
import { styleFor as gfwStyleFor, summaryOf as gfwSummaryOf, ageLabel as gfwAgeLabel, gfwIcon, KINDS as GFW_KINDS } from "../globe/gfwEvents.js"
import { riskAlpha, buildA2ToA3, indexByIso3 } from "../globe/riskChoropleth.js"
import { CAT } from "../components/timeStripMath.js"
import { placeIconUri, worstAlarm, placeSubtitle, placeDetail, rememberWithin7, filterByCountry, placesUrl } from "../globe/endangeredPlaces.js"
import {
    filterStrikes, isHollow, strikeIconUri, strikeOpacity, strikePriority, strikeSettings,
    strikeSummary, strikeWindowHours, strikesUrl,
} from "../globe/strikes.js"
import {
    claimRing, claimStyle, claimSummary, milSymbol, movementArrow, movementLabel, movementStyle, movementSummary,
    movementSymbolPoint, overlayUrl, sideColour, trajectoryPath, trajectorySummary, FRONTLINE_LAYERS,
} from "../globe/frontlineClaims.js"

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
/** A feature's time in ms (event, last update, report), for "most recent" among things at one place. */
export function featureTime(f) {
    if (Number.isFinite(f?.t)) return f.t
    const r = f?.raw || {}
    for (const v of [r.event_time, r.last_update, r.time, r.last_time, r.created_at, r.published_at, r.at, r.updated_at]) {
        const t = typeof v === "number" ? v : Date.parse(v || "")
        if (Number.isFinite(t)) return t
    }
    return NaN
}
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

const SIG_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

/**
 * Points in view, none dropped: when there are more than the phone draws
 * well (MAX_FEATURES), nearby points fold into one disc with their count,
 * the grid coarsening until they fit — the worst severity inside colours
 * it, a tap names what is in it and zooming in splits it. For layers whose
 * every point is a finding (owner, 2026-10-17: "no cap on how many things
 * we can actually recognise on the map"); cullPoints stops at the cap.
 */
export function cullOrCluster(features, bounds, zoom, { noun = "points", prefix = "pt", cellPx = 48 } = {}) {
    const inView = features.filter((f) => f && finite(f.lat, f.lon) && inBounds(f.lat, f.lon, bounds))
    if (inView.length <= MAX_FEATURES) return inView
    const z = Number.isFinite(zoom) ? zoom : 5
    for (let px = cellPx; ; px *= 2) {
        const deg = (360 / 2 ** Math.max(0, z)) * (px / 256)
        const cells = new Map()
        for (const f of inView) {
            const k = `${Math.floor(num(f.lat) / deg)}:${Math.floor(num(f.lon) / deg)}`
            if (!cells.has(k)) cells.set(k, [])
            cells.get(k).push(f)
        }
        if (cells.size > MAX_FEATURES && deg < 90) continue
        const out = []
        for (const [k, list] of cells) {
            if (list.length === 1) { out.push(list[0]); continue }
            const lat = list.reduce((a, f) => a + num(f.lat), 0) / list.length
            const lon = list.reduce((a, f) => a + num(f.lon), 0) / list.length
            const sev = list.map((f) => f.severity).filter(Boolean)
                .sort((a, b) => (SIG_RANK[a] ?? 9) - (SIG_RANK[b] ?? 9))[0] || null
            // ONE ICON PER PLACE (owner, 2026-10-23 evening): the most important member's own marker, the rest in its card
            const top = representative(list.map((f) => ({ ...f, t: featureTime(f) })))
            const named = list.slice(0, 8).map((f) => f.title).filter(Boolean)
            out.push({
                id: `${prefix}-cl-${z}-${px}-${k}`, lat, lon, iconUri: top.iconUri, size: top.size, collide: true,
                iconWidth: top.iconWidth, iconHeight: top.iconHeight, iconAnchor: top.iconAnchor, pri: top.pri, t: top.t,
                title: `${list.length} ${noun} here`, sub: "Zoom in to see each one", severity: sev,
                raw: { kind: `${prefix}_cluster`, detail: `${named.join("; ")}${list.length > 8 ? `; and ${list.length - 8} more` : ""}.`,
                       lat, lon, count: list.length },
            })
        }
        return out
    }
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

// ── GDELT: news coverage, a diamond; Goldstein → priority (plan §4e) ─────
function gdeltPriority(goldstein) {
    const g = typeof goldstein === "number" ? goldstein : 0
    return g <= -8 ? "flash" : g <= -5 ? "urgent" : g < 0 ? "alert" : "info"
}
const gdeltSeverity = (g) => ({ flash: "critical", urgent: "high", alert: "medium", info: "low" }[gdeltPriority(g)])

// ── FIRMS: observed by a sensor, a square with the flame; hot = urgent, never flash (a fire is not yet an alert to you)
const firePriority = (k) => (k && k >= 360 ? "urgent" : "alert")

// ── Imagery signals: the shared typology (lib/mapIcons.js), the same module as the globe ──
const imagerySignalIcon = imageryIcon

// ── Our assets: ours, the pin (lib/mapIcons.js), its edge the exposure as priority ──
const PIN = SIZE.pin
const assetIcon = (group, exposure) => pinIcon({ glyph: group || "Sites", priority: priorityOf(exposure, "info") }).uri

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
// derived warnings: a triangle with the surge / fusion glyph, the priority from the record
const surgePriority = (x) => (x?.priority && priorityOf(x.priority) === x.priority ? x.priority : Number(x?.mult) >= 3 ? "urgent" : "alert")
const fusionPriority = (x) => {
    if (x?.priority) return priorityOf(x.priority)
    const sev = String(x?.severity || x?.level || "").toLowerCase()
    return sev === "critical" || sev === "flash" ? "flash" : "urgent"
}
const derivedMark = (glyph, priority) => markerUri({ kind: "derived", glyph, priority })

// ── Facilities (globe/GlobeFacilitiesLayer.jsx): infrastructure context, a line glyph, one size ──
const FAC_CATEGORY_LABEL = { military: "Military", medical: "Medical", security: "Police & fire" }
const FAC_TYPE_TO_CATEGORY = {
    "Military Facility": "military",
    "Medical Facility": "medical",
    "Security Facility": "security",
}
const FAC_SIZE = SIZE.infra
/** The desktop refuses (and the backend refuses) a view over 60 deg². */
const FAC_MAX_SPAN_DEG2 = 60

// ── Ports / airports / chokepoints: infrastructure context, one size (no size by class) ──
const INFRA_PX = SIZE.infra
const chokeIcon = () => infraIcon({ glyph: "chokepoint" }).uri

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
/** A power or telecom site: infrastructure context, the kind's line glyph, neutral (colours stay on the lines). */
const infraIconFor = (f) => infraIcon({ glyph: f?.kind || "power_plant" }).uri
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
        iconUri: getGeoConfirmedMarkerDataUri(),
        size: ICON_PX, collide: true, pri: "alert",
        title: p.title || p.name || "Geolocated event",
        sub: [p.faction, p.date_label].filter(Boolean).join(" · ") || null,
        severity: null,
        raw: p,
    })), normBounds(bounds))
}

async function loadGdelt({ bounds }) {
    const size = ICON_PX
    const d = await getJson(`${API_BASE}/api/gdelt/map-points?limit=1500`)
    return cullPoints(arr(d?.points).map((p) => ({
        id: `gdelt-${p.id}`,
        lat: num(p.lat), lon: num(p.lon),
        iconUri: markerUri({ kind: "news", glyph: "news", priority: gdeltPriority(p.goldstein) }),
        size, collide: true, pri: gdeltPriority(p.goldstein),
        title: p.title || p.original_title || "Wire report",
        sub: p.location_name || null,
        severity: gdeltSeverity(p.goldstein),
        raw: p,
    })), normBounds(bounds))
}

// ── Live signals: the one Telegram family (backend/live_signals.py, src/lib/liveSignals.js) ──
// Owner, 2026-10-22: signals are the nine acts, live only, one marker per event, the same on the phone and
// the desktop. Footage, announced protests, opinions, "calls to violence" and street-report words are not
// signals and have no layer; a picture or video is only the attachment of a signal's card.
export const LIVE_SIGNALS_PATH = "/api/telegram/signals/live"
export const LIVE_SIGNALS_REFRESH_MS = 30_000
const LS_SIZE = ICON_PX

export function liveSignalFeatures(d, now = Date.now()) {
    return arr(d?.signals).filter((s) => finite(s.lat, s.lon) && liveSignalDrawn(s, now)).map((s) => {
        const c = cardText(s, now)
        return {
            id: s.id, lat: num(s.lat), lon: num(s.lon), size: LS_SIZE, collide: true, pri: signalPriority(s),
            iconUri: signalIcon(s),
            title: c.title, sub: c.line, severity: s.muted ? null : (s.high_impact ? "high" : null),
            raw: { ...s, kind: "live_signal", headline: c.title, title: c.title, status_label: c.line, card_lines: c.lines,
                   sources: mediaSources(s), thumb_url: null, layerLabel: "Live signal" },
        }
    })
}

async function loadLiveSignals({ bounds }) {
    const d = await getJson(`${API_BASE}${LIVE_SIGNALS_PATH}`, { ttlMs: LIVE_SIGNALS_REFRESH_MS / 2 })
    return cullPoints(liveSignalFeatures(d), normBounds(bounds))
}

// ── Protests: live now / today / upcoming (backend/protests.py, src/lib/protests.js) ──
// Owner, 2026-10-23: "Protests should be an actual layer". Its own switch, off by default like every layer,
// the frame chosen in the segmented control (phone map chip, filters sheet; the globe shares the choice).
// Read every 15 s while something is live in the user's areas, every 60 s otherwise; not while the page is hidden.
const _protestLast = new Map()
export async function loadProtests({ bounds } = {}) {
    const frame = getFrame()
    const url = `${API_BASE}${PROTESTS_PATH}?frame=${frame}`
    const prev = _protestLast.get(frame)
    const hidden = typeof document !== "undefined" && document.hidden
    let d = prev?.d
    if (!prev || (!hidden && Date.now() - prev.t >= protestsRefreshMs(prev.d) - 500)) {
        const got = await getJson(url, { ttlMs: LIVE_REFRESH_MS - 1000 })
        if (got) { d = got; _protestLast.set(frame, { t: Date.now(), d }) }
    }
    if (d) setMeta({ counts: d.counts || null, note: d.note || null, any_live: !!d.any_live, frame, items: arr(d.items).length })
    const b = normBounds(bounds)
    return protestFeatures(d).filter((f) => inBounds(f.lat, f.lon, b, 0.5) || (f.path && lineInView(f.path, b)))
}

async function loadImagerySignals({ bounds, zoom }) {
    // Every signal of the week, not the newest 200 (owner, 2026-10-17: no caps).
    const d = await getJson(`${API_BASE}/api/alerts?source=SAT-TASK&since_hours=168&limit=0`)
    const cutoff = Date.now() - 7 * 86_400_000
    const rows = arr(Array.isArray(d) ? d : d?.alerts)
        .filter((a) => finite(a.lat, a.lon) && utcMs(a.created_at) >= cutoff)
    return cullOrCluster(rows.map((a) => ({
        id: `imgsig-${a.alert_id}`,
        lat: num(a.lat), lon: num(a.lon),
        iconUri: imagerySignalIcon(a.severity), size: ICON_PX, collide: true, pri: priorityOf(a.severity, "alert"),
        title: a.title || a.alert_type || "Imagery signal",
        sub: a.region || null,
        severity: a.severity || null,
        raw: { ...a, id: a.alert_id, source: "SAT-TASK" },
    })), normBounds(bounds), zoom, { noun: "imagery signals", prefix: "imgsig" })
}

async function loadFires({ bounds }) {
    // GlobeView mounts GlobeFiresLayer without `hours`, so the desktop
    // always shows its 72-hour default rather than the signal window.
    const size = ICON_PX
    const d = await getJson(`${API_BASE}/api/fires?hours=72&limit=2000`)
    return cullPoints(arr(d?.fires).map((f) => ({
        id: `fire-${f.id}`,
        lat: num(f.lat), lon: num(f.lon),
        iconUri: markerUri({ kind: "confirmed", glyph: "flame", priority: firePriority(f.brightness_k) }),
        size, collide: true, pri: firePriority(f.brightness_k),
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
    const size = ICON_PX
    const feats = []
    for (const x of arr(s?.surges)) {
        const cat = CAT[x.cat] || { name: x.cat || "activity" }
        feats.push({
            id: `surge-${x.id}`, lat: num(x.lat), lon: num(x.lon),
            iconUri: derivedMark("surge", surgePriority(x)), size, collide: true, pri: surgePriority(x),
            title: `${String(cat.name).toLowerCase()} reporting surging around ${x.place || "this area"}`,
            sub: surgeLabel(x), severity: "high", raw: { ...x, kind: "surge" },
        })
    }
    for (const x of arr(f?.fusions)) {
        feats.push({
            id: `fusion-${x.id}`, lat: num(x.lat), lon: num(x.lon),
            iconUri: derivedMark("fusion", fusionPriority(x)), size, collide: true, pri: fusionPriority(x),
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
        return cullPoints(arr(d.events).filter((ev) => ev?.id).map((ev) => ({
            id: `gfw-${kind}-${ev.id}`,
            lat: num(ev.lat), lon: num(ev.lon),
            iconUri: gfwIcon(kind, ev).uri, size: ICON_PX, collide: true, pri: ev.watchlisted || ev.vessel?.watchlisted || ev.sanctioned ? "urgent" : "alert",
            title: gfwSummaryOf({ ...ev, kind }),
            sub: [gfwAgeLabel(ev.start), "satellite AIS, not live"].filter(Boolean).join(" · "),
            severity: null,
            raw: { ...ev, kind, source: d.source, source_url: d.source_url, lag_days: d.lag_days },
        })), normBounds(bounds))
    }
}

/** An asset linked to this user, at this device's live fix — the server has
 *  it too, but the list is fetched every few minutes and the pin should
 *  move with the blue dot (location/liveShare.js). */
export function atMyLivePosition(a, me = myPosition(), uid = getCurrentUser()?.id) {
    if (!me?.live || !uid || String(a?.identifiers?.user_id || "") !== String(uid)) return a.position
    return { ...(a.position || {}), lat: me.lat, lon: me.lon, source: "your phone, live", live: true }
}

/** Drop the cached asset list: the first live position creates the
 *  user's own person asset, and the pin should appear at once. */
export function forgetAssets() {
    for (const k of [..._cache.keys()]) if (k.startsWith(`${API_BASE}/api/my-assets`) && !k.includes("/people")) _cache.delete(k)
}

async function loadAssets({ bounds }) {
    const d = await getJson(`${API_BASE}/api/my-assets`)
    const me = myPosition(), uid = getCurrentUser()?.id
    // safe houses are their own layer ("Safe houses", loadSafeHouses), with their own pin
    const rows = arr(d?.assets).filter((a) => a.kind !== "safe_house" && !a.is_safe_house).map((a) => ({ ...a, position: atMyLivePosition(a, me, uid) })).filter((a) => a.position)
    return cullPoints(rows.map((a) => ({
        id: `asset-${a.id}`,
        lat: num(a.position.lat), lon: num(a.position.lon),
        iconUri: assetIcon(a.group, a.exposure),
        size: PIN.w, collide: true, pri: priorityOf(a.exposure, "info"),
        // Not square: the pin is 30 x 36 and stands on its point.
        iconWidth: PIN.w, iconHeight: PIN.h, iconAnchor: [PIN.w / 2, PIN.h],
        title: a.name || a.type_label || "Asset",
        sub: [a.type_label || a.kind_label || a.group, a.exposure ? `${a.exposure} exposure` : null].filter(Boolean).join(" · ") || null,
        severity: a.exposure || null,
        raw: a,
    })), normBounds(bounds))
}

// ── Safe houses (backend/evacuation.py) — where an evacuation leads ──────
async function loadSafeHouses({ bounds }) {
    const d = await getJson(`${API_BASE}/api/evacuations/safe-houses`, { ttlMs: 60_000 })
    return cullPoints(arr(d?.safe_houses).filter((h) => h.lat != null).map((h) => ({
        id: `safehouse-${h.id}`, lat: num(h.lat), lon: num(h.lon),
        iconUri: safeHouseIcon(h.status === "closed"), size: PIN.w, iconWidth: PIN.w, iconHeight: PIN.h, iconAnchor: [PIN.w / 2, PIN.h],
        collide: true, pri: "info",
        title: `Safe house — ${h.name}`,
        sub: [h.status === "closed" ? "closed" : `open${placesLabel(h)}`, h.contact].filter(Boolean).join(" · "),
        severity: null,
        raw: { ...h, kind: "safe_house", headline: `Safe house — ${h.name}`, summary: h.contact || h.notes || null },
    })), normBounds(bounds))
}

// ── The team, where each is (the location signal) ─────────────────────────
// Everyone sharing their live location (GET /api/my-assets/people), but
// not you — you are the blue dot. A city-level fix (a desktop's connection)
// is drawn pale and says so.
const personIcon = (live, coarse) => dotIcon({ role: "team", live, coarse }).uri

async function loadPeople({ bounds }) {
    const d = await getJson(`${API_BASE}/api/my-assets/people?hours=24`, { ttlMs: 30_000 })
    const uid = getCurrentUser()?.id
    return cullPoints(arr(d?.people).filter((p) => String(p.user_id) !== String(uid)).map((p) => {
        const coarse = p.source === "ip" || (p.accuracy_m ?? 0) >= 1000
        return {
            id: `person-${p.user_id}`,
            lat: num(p.lat), lon: num(p.lon),
            iconUri: personIcon(!!p.live, coarse), size: SIZE.team,
            title: p.name || "Team member",
            sub: [p.live ? "live" : "last shared", coarse ? "city level, from their connection" : p.accuracy_m != null ? `within ${Math.round(p.accuracy_m)} m` : null].filter(Boolean).join(" · "),
            severity: null,
            raw: { ...p, headline: `${p.name || "Team member"} — ${p.live ? "live location" : "last shared location"}`, published_at: p.at },
        }
    }), normBounds(bounds))
}

async function loadChokepoints({ bounds }) {
    const d = await getJson(`${API_BASE}/api/infrastructure/chokepoints`, { ttlMs: 10 * 60_000, credentials: false })
    return cullPoints(arr(d?.chokepoints).map((c) => ({
        id: `choke-${c.id ?? c.system_id ?? c.name}`,
        lat: num(c.lat ?? c.center?.[0]), lon: num(c.lon ?? c.center?.[1]),
        iconUri: chokeIcon(), size: INFRA_PX, collide: true, pri: "info",
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
        return {
            id: `port-${p.system_id}`, lat: num(lat), lon: num(lon),
            iconUri: infraGlyphUri("port"),
            size: INFRA_PX, collide: true, pri: "info",
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
        return {
            id: `airport-${p.system_id}`, lat: num(lat), lon: num(lon),
            iconUri: infraGlyphUri("airport"),
            size: INFRA_PX, collide: true, pri: "info",
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
        return cullPoints(arr(d.facilities)
            .filter((f) => (f.category || FAC_TYPE_TO_CATEGORY[f.entity_type]) === category)
            .map((f) => ({
                id: `facility-${f.system_id}`, lat: num(f.lat), lon: num(f.lon),
                iconUri: getFacilityMarkerDataUri({ kind: f.kind }),
                size: FAC_SIZE, collide: true, pri: "info",
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
        iconUri: infraIconFor(f), size: INFRA_PX, collide: true, pri: "info",
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
                   components: row.components, contributions: row.contributions,
                   families: row.families, corroborating: row.corroborating,
                   confidence: row.confidence, explanation: row.explanation },
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

const AOI_FRESH_COLOR = "#E5484D"          // the flash colour of the one ramp (lib/mapIcons.js PRIORITY.flash)

/** The zone's fresh finding ({count, text}) or null — /api/imagery/aois `findings.fresh`. */
export function aoiFresh(z) {
    const f = z?.findings?.fresh
    return f && typeof f === "object" ? { count: Number(f.count) || 0, text: f.text || null } : null
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
        // WHERE SOMETHING WAS FOUND (owner, 2026-10-11): a zone whose latest
        // scans found something new (backend/zone_change.py) is drawn red,
        // pulsing, with the count; the rest stay plain.
        const fresh = aoiFresh(z)
        const centre = [bb.min_lat, bb.max_lat, bb.min_lon, bb.max_lon].every((v) => Number.isFinite(num(v)))
            ? [(num(bb.min_lat) + num(bb.max_lat)) / 2, (num(bb.min_lon) + num(bb.max_lon)) / 2] : null
        out.push({
            id: `aoi-${z.system_id || z.id}`, rings, color: fresh ? AOI_FRESH_COLOR : AOI_COLOR,
            fillOpacity: fresh ? 0.16 : z.status === "active" ? 0.10 : 0.04, weight: fresh ? 2.6 : 1.2,
            className: undefined,
            badge: fresh && centre ? { lat: centre[0], lon: centre[1], text: fresh.count > 0 ? String(fresh.count) : "!" } : null,
            title: fresh ? `${z.name || "Area of interest"} — new finding: ${fresh.text || "something new"}` : (z.name || "Area of interest"),
            raw: z,
        })
    }
    return cullAreas(out, normBounds(bounds))
}

// ── endangered places (globe/GlobeEndangeredPlacesLayer.jsx) ─────────────

const ALARM_SEV = { red: "high", amber: "medium", grey: "low" }
const SEV_RANK = { high: 0, medium: 1, low: 2 }
/** A place's severity on the sheet: its strongest call (a roadblock is high
 *  even a week out — the colour says how soon); low when only listed. */
const placeSev = (p) => (p.alarm === "grey" ? "low" : (p.level || ALARM_SEV[p.alarm] || "medium"))
const ALARM_RANK = { red: 0, amber: 1, grey: 2 }
/** Below this zoom, nearby places are drawn as one disc with their count. */
export const ENDANGERED_CLUSTER_BELOW = 10

function endangeredFeature(p) {
    const hasCall = arr(p.calls).length > 0 && p.alarm !== "grey"
    return {
        id: `endangered-${p.id}`, lat: num(p.lat), lon: num(p.lon),
        iconUri: placeIconUri({ kind: p.kind, alarm: p.alarm, hasCall }), size: ICON_PX, collide: true, pri: priorityOf(p.alarm, "info"),
        title: p.name || "Endangered place",
        sub: placeSubtitle(p),
        severity: placeSev(p),
        raw: { ...p, kind: "endangered_place", place_kind: p.kind, detail: placeDetail(p), url: p.source_url,
               source: p.source, location: placeSubtitle(p), place: placeSubtitle(p) },
    }
}

/**
 * Grid clustering for the phone (the desktop draws every place): one disc
 * per cell of about 56 px, coloured by the worst place inside; a tap opens a
 * sheet naming them, and "Show on the map" zooms in to split them.
 */
export function clusterPlaces(places, zoom, cellPx = 56) {
    if (zoom >= ENDANGERED_CLUSTER_BELOW) return places.map(endangeredFeature)
    const deg = (360 / 2 ** Math.max(0, zoom)) * (cellPx / 256)
    const cells = new Map()
    for (const p of places) {
        if (!finite(p.lat, p.lon)) continue
        const k = `${Math.floor(num(p.lat) / deg)}:${Math.floor(num(p.lon) / deg)}`
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(p)
    }
    const out = []
    for (const [k, list] of cells) {
        if (list.length === 1) { out.push(endangeredFeature(list[0])); continue }
        const alarm = list.reduce((a, p) => worstAlarm(a, p.alarm), "grey")
        const withCalls = list.filter((p) => arr(p.calls).length && p.alarm !== "grey")
        const lat = list.reduce((a, p) => a + num(p.lat), 0) / list.length
        const lon = list.reduce((a, p) => a + num(p.lon), 0) / list.length
        const feats = list.map((p) => ({ ...endangeredFeature(p), t: featureTime({ raw: p }) }))
        const top = representative(feats)
        const named = [...list].sort((a, b) => (ALARM_RANK[a.alarm] ?? 2) - (ALARM_RANK[b.alarm] ?? 2))
            .slice(0, 8).map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}${arr(p.calls)[0] ? ` — ${p.calls[0].label_en}` : ""}`)
        const title = withCalls.length
            ? `${list.length} endangered places here — ${withCalls.length} with calls to act`
            : `${list.length} listed places here, no call`
        out.push({
            // ONE ICON PER PLACE (owner, 2026-10-23 evening): the worst, most recent place's own marker
            id: `endangered-cl-${zoom}-${k}`, lat, lon, iconUri: top.iconUri, size: top.size, collide: true, pri: top.pri || priorityOf(alarm, "info"), t: top.t,
            title, sub: "Zoom in to see each place",
            severity: list.map(placeSev).sort((a, b) => SEV_RANK[a] - SEV_RANK[b])[0],
            raw: { kind: "endangered_cluster", detail: `${named.join("; ")}${list.length > 8 ? `; and ${list.length - 8} more` : ""}.`,
                   lat, lon, source: "Endangered places" },
        })
    }
    return out
}

async function loadEndangered({ bounds, zoom }) {
    // "Active only" (the Filters sheet): the server keeps only the places
    // with a call, or within 2 km of one — the phone does no geometry
    const d = await getJson(placesUrl(API_BASE), { ttlMs: 120_000 })
    if (!d) return []
    rememberWithin7(d.calls_within_7_days)
    const b = normBounds(bounds)
    // the Filters sheet's country chips (EndangeredCountryChips)
    const inView = filterByCountry(arr(d.places)).filter((p) => finite(p.lat, p.lon) && inBounds(p.lat, p.lon, b, 0.5))
    return clusterPlaces(inView, Number.isFinite(zoom) ? zoom : 5).slice(0, MAX_FEATURES)
}

// ── Strikes & control (globe/GlobeStrikesLayer.jsx) ───────────────────────
// The same pins (strikes.js), the same act chips and time window (the
// Filters sheet shows StrikesLayerControls), faded by age; no campaign
// replay on the phone.

function strikeFeature(e, campaign = null) {
    return {
        id: `strike-${e.id}`, lat: num(e.lat), lon: num(e.lon),
        iconUri: strikeIconUri({ event: e, hollow: isHollow(e), priority: strikePriority(e) }),
        size: ICON_PX, collide: true, pri: strikePriority(e), opacity: strikeOpacity(e),
        title: e.title || e.act_label || "Strike",
        sub: [e.actor, e.target_name ? String(e.target_name).split(",")[0] : null].filter(Boolean).join(" · "),
        raw: { ...e, kind: "strike_event", detail: strikeSummary(e, campaign), url: e.sources?.find((s) => s?.url)?.url || null,
               source: e.sources?.[0]?.source || null, published_at: e.time },
    }
}

async function loadStrikes({ bounds }) {
    const [d, c] = await Promise.all([
        getJson(strikesUrl(API_BASE), { ttlMs: 120_000 }),
        getJson(`${API_BASE}/api/strikes/campaigns?since=30d`, { ttlMs: 120_000 }),
    ])
    if (!d) return []
    const byCampaign = Object.fromEntries(arr(c?.campaigns).map((x) => [x.id, x]))
    const { acts, window: win } = strikeSettings()
    const shown = filterStrikes(arr(d.events), { acts, windowHours: strikeWindowHours(win) })
    return cullPoints(shown.map((e) => strikeFeature(e, byCampaign[e.campaign_id] || null)), normBounds(bounds))
}

// ── Frontline claims, movements, trajectories (globe/GlobeFrontlineClaimsLayer.jsx) ──
const OVERLAY_TTL = 120_000
const toLL = (p) => [p.lat, p.lon]

async function loadClaims({ bounds }) {
    const d = await getJson(overlayUrl(API_BASE), { ttlMs: OVERLAY_TTL })
    const out = []
    for (const c of arr(d?.claims)) {
        const ring = claimRing(c)
        if (ring.length < 3) continue
        const st = claimStyle(c)
        out.push({
            id: `fclaim-${c.id}`, rings: [ring.map(toLL)], color: st.color, fillOpacity: st.fill * (Number(c.opacity) || 1),
            weight: st.grey ? 1.5 : 2.5, dash: st.dash ? "6 5" : null,
            title: c.label || `${st.label}: ${c.target_name || "claim"}`,
            sub: [st.label, c.actor].filter(Boolean).join(" · "),
            raw: { ...c, kind: "frontline_claim", detail: claimSummary(c), url: c.sources?.find((s) => s?.url)?.url || null,
                   source: c.sources?.[0]?.source || null, published_at: c.time },
        })
    }
    return cullAreas(out, normBounds(bounds))
}

// ON THE PHONE A LABEL IS TEXT, NOT A BOX (owner's monochrome rule, 2026-10-17):
// white words with a dark halo so they read over any ground, small; the pill
// with a coloured border (globe/frontlineClaims.js pillUri) stays the desktop's
function textLabelUri(text, { size = 11, weight = 600 } = {}) {
    const t = String(text || "")
    const w = Math.round(t.length * size * 0.6 + 8), h = Math.round(size + 8)
    const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 3}" height="${h * 3}" viewBox="0 0 ${w} ${h}">`
        + `<text x="${w / 2}" y="${h / 2}" dy="0.35em" text-anchor="middle" fill="#f2f4f8" stroke="#05070c" stroke-width="3" stroke-opacity=".85" paint-order="stroke" stroke-linejoin="round" `
        + `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}">${esc}</text></svg>`
    return { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width: w, height: h, anchor: [Math.round(w / 2), Math.round(h / 2)] }
}
const JOINT_LABEL_ZOOM = 10          // a path's dates only once zoomed in; a siege's name always

async function loadMovements({ bounds, zoom = 0 }) {
    const d = await getJson(overlayUrl(API_BASE), { ttlMs: OVERLAY_TTL })
    const out = []
    for (const m of arr(d?.movements)) {
        const arrow = movementArrow(m)
        const tail = m.from || m.to
        if (!tail || !finite(tail.lat, tail.lon)) continue
        const colour = sideColour(m.side, m.colour)
        const st = movementStyle(m)
        // the map draws every line at one opacity: a path's earlier legs read
        // as earlier by being thinner and dashed, the newest solid and wide
        const early = m.kind === "leg" ? !m.tip : m.kind === "approach" && m.path_legs > 0
        // the unit's symbol where the evidence is: not on an open approach
        // (dashed, a direction left open, not a force seen there), and small
        // so eight of them round a siege do not bury the place
        const at = st.dash ? null : movementSymbolPoint(m)
        const sym = at ? milSymbol(m.sidc, { colour, size: m.kind === "approach" ? 12 : 15 }) : null
        const raw = { ...m, kind: "troop_movement", lat: m.to?.lat, lon: m.to?.lon, detail: movementSummary(m),
                      url: m.sources?.find((s) => s?.url)?.url || null, source: m.sources?.[0]?.source || null, published_at: m.time }
        out.push({
            id: `fmove-${m.id}`, color: colour, weight: Math.max(2, st.width - (early ? 0.5 : 0)),
            dash: st.dash ? "5 6" : early ? "8 5" : null,
            // shaft, and the head as its own part
            coords: arrow ? arrow.map((part) => part.map(toLL)) : [[toLL(tail), toLL(tail)]],
            marker: sym?.uri ? { lat: at.lat, lon: at.lon, iconUri: sym.uri, iconWidth: sym.width, iconHeight: sym.height, iconAnchor: sym.anchor } : null,
            title: m.label || "Movement",
            sub: m.from_basis || null,
            raw,
        })
        // a path's joint ("2 · 13 Oct") or a siege's name, as its own marker:
        // a line carries one image, and the symbol already has it
        const l = movementLabel(m)
        if (l && finite(l.at.lat, l.at.lon) && (l.siege || zoom >= JOINT_LABEL_ZOOM)) {
            const pill = textLabelUri(l.text, { size: l.siege ? 11.5 : 10.5 })
            out.push({
                id: `fmove-label-${m.id}`, color: colour, weight: 0, coords: [[toLL(l.at), toLL(l.at)]],
                marker: { lat: +l.at.lat, lon: +l.at.lon, iconUri: pill.uri, iconWidth: pill.width, iconHeight: pill.height,
                          iconAnchor: l.siege ? [pill.anchor[0], pill.height + 6] : [pill.anchor[0], -6], label: true },
                title: m.label || "Movement", sub: m.from_basis || null, raw,
            })
        }
    }
    return cullLines(out, normBounds(bounds))
}

async function loadTrajectories({ bounds }) {
    const d = await getJson(overlayUrl(API_BASE), { ttlMs: OVERLAY_TTL })
    const out = []
    for (const t of arr(d?.trajectories)) {
        const path = trajectoryPath(t, { samples: 24 })
        if (path.length < 2) continue
        const colour = sideColour(t.side, t.colour)
        // the launch end: a reported event (circle) with the weapon's glyph, 24 px; an assumed origin uncorroborated
        // (owner, 2026-10-23 evening: no drone toy, no red ring, no black dot: the icons used everywhere else)
        const o = markerIcon({ kind: "event", glyph: t.kind === "drone" ? "drone" : "missile", priority: "alert", state: t.from?.assumed ? "muted" : "live" })
        out.push({
            id: `ftraj-${t.id}`, color: colour, weight: 2, dash: t.from?.assumed ? "5 5" : null,
            coords: path.map(toLL),
            marker: { lat: +t.from.lat, lon: +t.from.lon, iconWidth: o.w, iconHeight: o.h, iconAnchor: o.anchor, iconUri: o.uri },
            title: t.label || t.kind_label || "Trajectory",
            sub: t.from?.name ? `${t.from.assumed ? "assumed origin" : "from"} ${t.from.name}` : null,
            raw: { ...t, kind: "trajectory", lat: t.to?.lat, lon: t.to?.lon, detail: trajectorySummary(t),
                   url: t.sources?.find((s) => s?.url)?.url || null, source: t.sources?.[0]?.source || null, published_at: t.time },
        })
    }
    return cullLines(out, normBounds(bounds))
}

// ── the registry ──────────────────────────────────────────────────────────

const G = {
    protests: "Protests",
    assets: "Our assets",
    endangered: "Endangered places",
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
    // Protests — first, so it is easy to find (owner, 2026-10-23).
    {
        key: "protests", label: "Protests", group: G.protests, defaultOn: false, kind: "points", minZoom: 0,
        refreshMs: LIVE_REFRESH_MS, legendIcon: protestBadge({ kind: "protest" }),
        load: loadProtests,
    },
    // THE SIGNAL A NOTIFICATION OPENED ("On the ground now: …", the triangle; lib/signalPin.js, drawn by
    // mobile/findingsLeaflet.js): its own switch (owner, 2026-10-24), on — it only draws the one signal you opened.
    // No features of its own to load: MMap passes the switch to setSignalPinLayer.
    {
        key: "openedSignal", label: "On the ground, opened", group: G.protests, defaultOn: true, kind: "points", minZoom: 0,
        legendIcon: markerUri({ kind: "derived", glyph: "fusion", priority: "urgent" }), load: async () => [],
    },
    // Our assets — Situation's first group.
    {
        key: "assets", label: "Our assets", group: G.assets, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: assetIcon("Sites", "quiet"), load: loadAssets,
    },
    {
        key: "people", label: "Team, live location", group: G.assets, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: personIcon(true, false), load: loadPeople,
    },
    {
        key: "safeHouses", label: "Safe houses", group: G.assets, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: safeHouseIcon(false), load: loadSafeHouses,
    },

    // Maritime (LAYER_GROUPS.maritime; live vessels are the phone's own).
    {
        key: "ports", label: "Ports", group: G.maritime, defaultOn: false, kind: "points", minZoom: 3,
        legendIcon: infraGlyphUri("port"), load: loadPorts,
    },
    {
        key: "cables", label: "Submarine Cables", group: G.maritime, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(CABLE_FALLBACK_COLOR), load: loadCables,
    },
    {
        key: "chokepoints", label: "Chokepoints", group: G.maritime, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: chokeIcon(), load: loadChokepoints,
    },
    ...GFW_KINDS.map((kind) => {
        const style = gfwStyleFor(kind)
        return {
            key: `gfw:${kind}`, label: GFW_LABEL[kind] || style.label, group: G.maritime,
            defaultOn: false, kind: "points", minZoom: 0,
            legendIcon: gfwIcon(kind).uri,
            load: gfwLoader(kind),
        }
    }),

    // Air (LAYER_GROUPS.air; live aircraft are the phone's own).
    {
        key: "airports", label: "Airports", group: G.air, defaultOn: false, kind: "points", minZoom: 3,
        legendIcon: infraGlyphUri("airport"), load: loadAirports,
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
        key: "geoConfirmed", label: "Confirmed", group: G.news, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: getGeoConfirmedMarkerDataUri(), load: loadGeoConfirmed,
    },
    // GDELT is not a map signal (owner, 2026-10-13): the country risk index only
    {
        // ONE signal layer (owner, 2026-10-22): the nine acts, live only, one marker per event
        key: "liveSignals", label: "Live signals", group: G.news, defaultOn: false, kind: "points", minZoom: 0,
        refreshMs: LIVE_SIGNALS_REFRESH_MS, legendIcon: actIcon("police_intervention"), load: loadLiveSignals,
    },
    {
        key: "strikes", label: "Strikes & control", group: G.news, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: strikeIconUri({ act: "airstrike" }), load: loadStrikes,
    },
    {
        key: "frontlineClaims", label: FRONTLINE_LAYERS[0].label, group: G.news, defaultOn: false, kind: "areas", minZoom: 0,
        legendIcon: areaSwatch(sideColour("red"), 0.3), load: loadClaims,
    },
    {
        key: "movements", label: FRONTLINE_LAYERS[1].label, group: G.news, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: milSymbol("SHGPUCI--------", { colour: sideColour("red"), size: 14 }).uri || lineSwatch(sideColour("red")), load: loadMovements,
    },
    {
        key: "trajectories", label: FRONTLINE_LAYERS[2].label, group: G.news, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(sideColour("red")), load: loadTrajectories,
    },

    // Imagery.
    {
        key: "imagerySignals", label: "Imagery signals", group: G.imagery, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: imagerySignalIcon("high"), load: loadImagerySignals,
    },
    {
        key: "fires", label: "Heat (thermal anomalies)", group: G.imagery, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: markerUri({ kind: "confirmed", glyph: "flame", priority: "alert" }), load: loadFires,
    },

    // Zones.
    {
        key: "eez", label: "Exclusive Economic Zones", group: G.zones, defaultOn: false, kind: "lines", minZoom: 0,
        legendIcon: lineSwatch(EEZ_STROKE, null, 1.8), load: loadEez,
    },

    // Alerts.
    {
        key: "derivedAlerts", label: "Surge & fusion", group: G.alerts, defaultOn: false, kind: "points", minZoom: 0,
        legendIcon: derivedMark("fusion", "urgent"), load: loadDerivedAlerts,
    },

    // Context (CONTEXT_TOGGLES; graticule, marker labels and coverage are not drawn on the phone).
    {
        key: "risk", label: "Country risk index", group: G.context, defaultOn: false, kind: "areas", minZoom: 0,
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
        legendIcon: getFacilityMarkerDataUri({ kind: "military" }),
        load: facilityLoader("military"),
    },
    {
        key: "facMedical", label: "Medical facilities", group: G.infra, defaultOn: false, kind: "points", minZoom: 7,
        legendIcon: getFacilityMarkerDataUri({ kind: "hospital" }),
        load: facilityLoader("medical"),
    },
    {
        key: "facSecurity", label: "Security facilities", group: G.infra, defaultOn: false, kind: "points", minZoom: 7,
        legendIcon: getFacilityMarkerDataUri({ kind: "police" }),
        load: facilityLoader("security"),
    },
    // Endangered places — under Infrastructure (owner, 2026-10-12).
    {
        key: "endangered", label: "Endangered places", group: G.infra,
        defaultOn: false,
        kind: "points", minZoom: 0,
        legendIcon: placeIconUri({ kind: "fuel_depot", alarm: "amber", hasCall: true }), load: loadEndangered,
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
