// ══════════════════════════════════════════════════════════════════════════════
// AKILI — INTELLIGENCE CORRELATION PRINCIPLE
// Every component in this file must ask: what other layers does this data touch?
// Routes touch conflict events, infrastructure, and live traffic.
// Aircraft touch airspace and conflict zones. Surface connections automatically.
// ══════════════════════════════════════════════════════════════════════════════

import * as SatelliteJS from "satellite.js"
import { useState, useEffect, useRef, Fragment, useMemo, memo, useCallback, createPortal } from "react"
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, Polyline, Popup, GeoJSON, Marker, Rectangle, ImageOverlay, Polygon, useMapEvents, useMap } from "react-leaflet"
import L from "leaflet"
import Markdown from "react-markdown"
import CountryPanel from "./CountryPanel.jsx"
import TVWidget from "./tvwidget.jsx"
import DraggablePanel from "./DraggablePanel.jsx"
import LayersPanel from "./LayersPanel.jsx"
import API_BASE from "../apiBase.js"

const API = API_BASE

// Widget definitions with zoom thresholds
const WIDGETS = [
    { id: "conflictZones", label: "Conflict Zones",     minZoom: 0, color: "#FF6B35" },
    { id: "borders",       label: "Land Border",        minZoom: 0, color: "#00ff88" },
    { id: "seaborder",     label: "Sea Boundary (EEZ)", minZoom: 0, color: "#00cfff" },
    { id: "airspace",      label: "Airspace (FIR)",     minZoom: 0, color: "#ffb300" },
    { id: "cables",        label: "Submarine Cables",   minZoom: 0, color: "#00cfff" },
    { id: "news",          label: "News Overlay",       minZoom: 0, color: "#7c3aed" },
    { id: "adsb",          label: "ADS-B Traffic",      minZoom: 0, color: "#94a3b8" },
    { id: "route",         label: "Route Planner",      minZoom: 0, color: "#f59e0b" },
    { id: "infra",         label: "Infrastructure",     minZoom: 0, color: "#00BCD4" },
    { id: "newsConflicts", label: "News Conflicts",     minZoom: 0, color: "#FFB300" },
    { id: "tv",            label: "Live TV",            minZoom: 0, color: "#ef4444" },
    { id: "webcams",       label: "Webcams",            minZoom: 0, color: "#FFB300" },
    { id: "satellite",     label: "Satellite",          minZoom: 0, color: "#00E5FF" },
    { id: "annotate",      label: "Annotate",           minZoom: 0, color: "#FFB300" },
    { id: "sattrack",      label: "Sat Track",          minZoom: 0, color: "#BB86FC" },
]

// Infrastructure category config (symbol, colour, label)
const INFRA_CATS = {
    medical:           { symbol: "✚", color: "#FF4081", label: "Medical"           },
    security:          { symbol: "⬡", color: "#2979FF", label: "Security"          },
    transport:         { symbol: "✈", color: "#00BCD4", label: "Transport"         },
    power:             { symbol: "⚡", color: "#FFD600", label: "Power"             },
    military:          { symbol: "★", color: "#FF3D00", label: "Military"          },
    pipelines:         { symbol: "⛓", color: "#80DEEA", label: "Pipelines"         },
    comms:             { symbol: "◉", color: "#76FF03", label: "Comms"             },
    government:        { symbol: "▣", color: "#CE93D8", label: "Government"        },
    chokepoints:       { symbol: "◆", color: "#FF6D00", label: "Chokepoints"       },
    utilities:         { symbol: "◈", color: "#80DEEA", label: "Utilities"         },
    hospital:          { symbol: "✚", color: "#FF4081", label: "Hospital"          },
    police:            { symbol: "⬡", color: "#2979FF", label: "Police"            },
    fire:              { symbol: "▲", color: "#FF6D00", label: "Fire Station"      },
    military_base:     { symbol: "◉", color: "#D32F2F", label: "Military Base"     },
    military_airfield: { symbol: "◆", color: "#B71C1C", label: "Military Airfield" },
}

const WEBCAM_LOCATIONS = [
    { id: "dubai_marina",      name: "Dubai Marina",          city: "Dubai, UAE",             lat: 25.0805,  lon: 55.1403,   youtubeId: "MfIpyflPbHQ" },
    { id: "dubai_fairmont",    name: "Dubai Fairmont",        city: "Dubai, UAE",             lat: 25.2048,  lon: 55.2708,   youtubeId: "7dE4IjDQJmE" },
    { id: "jerusalem",         name: "Jerusalem Old City",    city: "Jerusalem",              lat: 31.7767,  lon: 35.2345,   youtubeId: "Hvxu3epZnZk" },
    { id: "amsterdam",         name: "Amsterdam de Pam",      city: "Amsterdam, Netherlands", lat: 52.3676,  lon: 4.9041,    youtubeId: "Gd9d4q6WvUY" },
    { id: "dublin",            name: "Dublin Temple Bar",     city: "Dublin, Ireland",        lat: 53.3454,  lon: -6.2672,   youtubeId: "3nyPER2kzqk" },
    { id: "la_venice",         name: "Venice Beach V Hotel",  city: "Los Angeles, USA",       lat: 33.9850,  lon: -118.4695, youtubeId: "EO_1LWqsCNE" },
    { id: "london_walworth",   name: "Walworth Road",         city: "London, UK",             lat: 51.4893,  lon: -0.0937,   youtubeId: "8JCk5M_xrBs" },
    { id: "la_skidrow",        name: "Skid Row",              city: "Los Angeles, USA",       lat: 34.0430,  lon: -118.2468, youtubeId: "NsmJg4oSDVg" },
    { id: "fort_lauderdale",   name: "Elbo Bar",              city: "Fort Lauderdale, USA",   lat: 26.1224,  lon: -80.1037,  youtubeId: "YWs0HMRVCBY" },
    { id: "times_square",      name: "Times Square",          city: "New York, USA",          lat: 40.7580,  lon: -73.9855,  youtubeId: "rnXIjl_Rzy4" },
]

const SATELLITE_SOURCES = [
    { id: "sentinel-2-l2a", label: "Sentinel-2 L2A", agency: "ESA / Copernicus", resolution: "10m", disabled: false },
    { id: "sentinel-1-grd", label: "Sentinel-1 SAR",  agency: "ESA / Copernicus", resolution: "10m", disabled: false },
    { id: "landsat-c2l2",   label: "Landsat",          agency: "USGS / NASA",      resolution: "30m", disabled: true  },
]

const CLASSIF_COLOURS = {
    CONFIRMED:  "#FF3B3B",
    SUSPECTED:  "#FF8C00",
    UNVERIFIED: "#FFD700",
    HOSTILE:    "#8B0000",
    FRIENDLY:   "#00C853",
    UNKNOWN:    "#888888",
}
const ZONE_COLOURS = {
    "Combat Zone":  "#FF3B3B",
    "Exclusion":    "#FF8C00",
    "Surveillance": "#00BFFF",
    "Safe Zone":    "#00C853",
    "Unknown":      "#888888",
    "Custom":       "#FFB300",
}
const SAT_COLOURS = {
    "Earth Observation":   "#00E5FF",
    "Weather":             "#69FF47",
    "Space Stations":      "#FFB300",
    "Military":            "#FF3B3B",
    "Radar / SAR":         "#FF8C00",
    "Commercial (Planet)": "#BB86FC",
    "Commercial (Spire)":  "#BB86FC",
}

const TYPE_COLOR = {
    "Protests": "#3b82f6",
    "Violence against civilians": "#dc2626",
    "Battles": "#7c3aed",
    "Explosions/Remote violence": "#ef4444",
    "Strategic developments": "#16a34a",
    "Riots": "#ea580c",
}

const ADSB_LEGEND = [
    { label: "Military",         color: "#FF3333" },
    { label: "Commercial",       color: "#00E5FF" },
    { label: "Helicopter",       color: "#FFD600" },
    { label: "General Aviation", color: "#76FF03" },
    { label: "Unknown",          color: "#FF6D00" },
]

// Hardcoded approximate Tanzania EEZ (200nm / ~370km offshore boundary)
// GeoJSON uses [longitude, latitude] coordinate order
const TANZANIA_EEZ = {
    type: "Feature",
    geometry: {
        type: "Polygon",
        coordinates: [[
            [39.22, -4.67],
            [39.07, -5.07],
            [38.99, -5.44],
            [38.90, -6.43],
            [39.29, -6.80],
            [39.52, -8.91],
            [39.71, -10.00],
            [40.46, -10.47],
            [44.20, -10.47],
            [44.50, -9.00],
            [44.60, -7.50],
            [44.50, -6.00],
            [43.50, -4.67],
            [39.22, -4.67],
        ]]
    },
    properties: { name: "Tanzania EEZ (approx. 200nm)" }
}

const CABLE_API   = "/data/cable-geo.json"
const LANDING_API = "/data/landing-point-geo.json"
const BORDER_API  = `${API}/geo/countries`
const EEZ_API     = `${API}/geo/eez`

// ── Contextual border helpers ─────────────────────────────────────────────────

function findCountryByName(name, allGeo) {
    if (!name || !allGeo?.features) return null
    const n = name.toLowerCase().trim()
    // Exact match first, then prefix/partial
    return (
        allGeo.features.find(f => {
            const a = (f.properties?.ADMIN || "").toLowerCase()
            const b = (f.properties?.name  || "").toLowerCase()
            return a === n || b === n
        }) ||
        allGeo.features.find(f => {
            const a = (f.properties?.ADMIN || "").toLowerCase()
            const b = (f.properties?.name  || "").toLowerCase()
            return a.includes(n) || n.includes(a) || b.includes(n) || n.includes(b)
        }) ||
        null
    )
}

function pointInRing(point, ring) {
    const [lat, lon] = point
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = [ring[i][1], ring[i][0]]
        const [xj, yj] = [ring[j][1], ring[j][0]]
        const intersects = ((yi > lat) !== (yj > lat))
            && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-9) + xi)
        if (intersects) inside = !inside
    }
    return inside
}

function polygonSignedArea(ring) {
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[i + 1]
        area += x1 * y2 - x2 * y1
    }
    return area / 2
}

function polygonCentroid(ring) {
    let cx = 0
    let cy = 0
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[i + 1]
        const cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    }
    area /= 2
    if (Math.abs(area) < 1e-9) return null
    return [cy / (6 * area), cx / (6 * area)]
}

function featurePrimaryRing(feature) {
    const geom = feature?.geometry
    if (!geom) return null
    if (geom.type === "Polygon") return geom.coordinates?.[0] || null
    if (geom.type === "MultiPolygon") {
        const polys = (geom.coordinates || []).map(poly => poly?.[0]).filter(Boolean)
        if (!polys.length) return null
        return polys.reduce((best, ring) =>
            Math.abs(polygonSignedArea(ring)) > Math.abs(polygonSignedArea(best)) ? ring : best,
        polys[0])
    }
    return null
}

function featureApproxCentroid(feature) {
    const ring = featurePrimaryRing(feature)
    if (!ring?.length) return null
    const centroid = polygonCentroid(ring)
    if (centroid && pointInRing(centroid, ring)) return centroid

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
    for (const [lon, lat] of ring) {
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
        minLon = Math.min(minLon, lon)
        maxLon = Math.max(maxLon, lon)
    }

    const candidates = [[(minLat + maxLat) / 2, (minLon + maxLon) / 2]]
    for (const latFrac of [0.25, 0.5, 0.75]) {
        for (const lonFrac of [0.25, 0.5, 0.75]) {
            candidates.push([
                minLat + (maxLat - minLat) * latFrac,
                minLon + (maxLon - minLon) * lonFrac,
            ])
        }
    }

    const centerLat = (minLat + maxLat) / 2
    const centerLon = (minLon + maxLon) / 2
    const inside = candidates
        .filter(point => pointInRing(point, ring))
        .sort((a, b) =>
            Math.abs(a[0] - centerLat) + Math.abs(a[1] - centerLon)
            - (Math.abs(b[0] - centerLat) + Math.abs(b[1] - centerLon))
        )
    if (inside.length) return inside[0]

    let sLng = 0, sLat = 0
    for (const [lng, lat] of ring) { sLng += lng; sLat += lat }
    return [sLat / ring.length, sLng / ring.length]
}

function findEezByCountryName(name, eezGeo) {
    if (!name || !eezGeo?.features) return null
    const n = name.toLowerCase()
    return eezGeo.features.find(f => {
        const p = f.properties || {}
        const t = (p.TERRITORY1 || p.GEONAME || p.ADMIN || p.name || "").toLowerCase()
        return t === n || t.includes(n) || n.includes(t)
    }) || null
}

const MARITIME_RE = /\b(sea|ocean|coast|port|vessel|ship|pirac|pirate|strait|bay|gulf|harbour|harbor|naval|maritime|submarine.?cable|chokepoint|eez)\b/i
function isMaritimeContext(ev) {
    if (!ev) return false
    const t = [ev.type, ev.event_type, ev.notes, ev.headline, ev.description, ev.location]
        .filter(Boolean).join(" ")
    return MARITIME_RE.test(t) || ev.type === "chokepoint_alert"
}

// CSS keyframes injected once into the document
const MAP_STYLES = `
@keyframes mapFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}
@keyframes eventMarkerFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.event-marker {
    animation: eventMarkerFadeIn 400ms ease forwards;
}
@keyframes toastLife {
    0%   { opacity: 0; transform: translateX(-50%) translateY(8px); }
    12%  { opacity: 1; transform: translateX(-50%) translateY(0);   }
    72%  { opacity: 1; transform: translateX(-50%) translateY(0);   }
    100% { opacity: 0; transform: translateX(-50%) translateY(4px); }
}
@keyframes legendDot {
    0%, 100% { opacity: 1;   }
    50%       { opacity: 0.3; }
}
@keyframes tileFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.leaflet-tile {
    animation: tileFadeIn 150ms ease forwards;
}
.adsb-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 3px;
    background: rgba(255,255,255,0.10);
    outline: none;
    border-radius: 2px;
    cursor: pointer;
}
.adsb-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #94a3b8;
    cursor: pointer;
    border: none;
}
.adsb-slider::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #94a3b8;
    cursor: pointer;
    border: none;
}
.akili-route-active .leaflet-container {
    cursor: crosshair !important;
}
@keyframes routeAnalysing {
    0%, 100% { opacity: 1;   }
    50%       { opacity: 0.4; }
}
.route-analysing {
    animation: routeAnalysing 1.2s ease infinite;
}
@keyframes conflictPulse {
    0%, 100% { transform: scale(1);    opacity: 1;    }
    50%      { transform: scale(0.82); opacity: 0.55; }
}
@keyframes poiRingPulse {
    0%   { transform: scale(1);   opacity: 0.55; }
    50%  { transform: scale(1.45); opacity: 0.1; }
    100% { transform: scale(1);   opacity: 0.55; }
}
.leaflet-top.leaflet-left {
    top: 10px !important;
}
.leaflet-control-zoom {
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 4px !important;
}
.leaflet-control-zoom a {
    background: rgba(10,14,20,0.88) !important;
    color: rgba(255,255,255,0.7) !important;
    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
}
.leaflet-control-zoom a:hover {
    background: rgba(255,255,255,0.1) !important;
    color: #fff !important;
}
.webcam-popup .leaflet-popup-content-wrapper,
.webcam-popup .leaflet-popup-tip-container {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
}
.webcam-popup .leaflet-popup-content {
    margin: 0 !important;
    width: auto !important;
}
.route-brief h2 {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #999;
    margin: 16px 0 6px;
    padding-top: 14px;
    border-top: 1px solid rgba(0,0,0,0.07);
}
.route-brief h2:first-child { margin-top: 0; padding-top: 0; border-top: none; }
.route-brief p  { font-size: 12px; line-height: 1.65; color: #333; margin: 0 0 6px; }
.route-brief ul { margin: 4px 0 6px 0; padding-left: 16px; }
.route-brief li { font-size: 12px; line-height: 1.6; color: #444; }
.route-brief strong { color: #111; }
@keyframes sat-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(255,179,0,0.7); }
    70%  { box-shadow: 0 0 0 8px rgba(255,179,0,0); }
    100% { box-shadow: 0 0 0 0 rgba(255,179,0,0); }
}
.sat-imagery-dot { animation: sat-pulse 1.4s ease infinite; }
.akili-annotate-active .leaflet-container { cursor: crosshair !important; }
.akili-theater-active .leaflet-container { cursor: crosshair !important; }
@keyframes poi-dash { to { stroke-dashoffset: -18; } }
`

// Fast approximate planar distance in km (accurate enough for ≤50km checks)
function quickDistKm(lat1, lng1, lat2, lng2) {
    const dLat = (lat1 - lat2) * 111.32
    const dLng = (lng1 - lng2) * 111.32 * Math.cos((lat1 + lat2) * Math.PI / 360)
    return Math.sqrt(dLat * dLat + dLng * dLng)
}

// Creates a drag-start handler for a floating panel.
// panelRef    — ref to the panel element
// setPos      — setState setter for {top, left}
// containerRef — ref to the bounded ancestor (the map wrapper div)
function createDragHandler(panelRef, setPos, containerRef) {
    return (e) => {
        e.preventDefault()
        const containerEl = containerRef.current
        const panelEl     = panelRef.current
        if (!containerEl || !panelEl) return

        const panelRect     = panelEl.getBoundingClientRect()
        const containerRect = containerEl.getBoundingClientRect()
        const startTop      = panelRect.top  - containerRect.top
        const startLeft     = panelRect.left - containerRect.left
        const startMouseX   = e.clientX
        const startMouseY   = e.clientY

        // Switch panel from CSS default (bottom/right) to explicit top/left
        setPos({ top: startTop, left: startLeft })

        const onMove = (me) => {
            setPos({
                top:  startTop  + (me.clientY - startMouseY),
                left: startLeft + (me.clientX - startMouseX),
            })
        }
        const onUp = () => {
            window.removeEventListener("mousemove", onMove)
            window.removeEventListener("mouseup",   onUp)
        }
        window.addEventListener("mousemove", onMove)
        window.addEventListener("mouseup",   onUp)
    }
}

function ZoomTracker({ onZoom }) {
    useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) })
    return null
}

function BoundsTracker({ onUpdate, onViewportChange }) {
    const map = useMap()
    const report = () => {
        const b = map.getBounds()
        const bounds = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(), zoom: map.getZoom() }
        onUpdate(bounds)
        if (onViewportChange) {
            const c = map.getCenter()
            onViewportChange([c.lat, c.lng], map.getZoom(), bounds)
        }
    }
    useEffect(() => { report() }, [])
    useMapEvents({ moveend: report, zoomend: report })
    return null
}


function MapInstanceTracker({ mapRef }) {
    const map = useMap()
    useEffect(() => {
        mapRef.current = map
    }, [map, mapRef])
    return null
}

function MapPaneSetup() {
    const map = useMap()
    useEffect(() => {
        const panes = [
            { name: "signal-surface", zIndex: 210, pointerEvents: "none" },
            { name: "zone-surface", zIndex: 230, pointerEvents: "none" },
            { name: "country-click", zIndex: 260 },
            { name: "context-polygons", zIndex: 280 },
            { name: "relation-lines", zIndex: 420 },
            { name: "event-icons", zIndex: 620 },
            { name: "infra-icons", zIndex: 640 },
            { name: "country-labels", zIndex: 660, pointerEvents: "none" },
        ]
        panes.forEach(({ name, zIndex, pointerEvents }) => {
            const pane = map.getPane(name) || map.createPane(name)
            pane.style.zIndex = String(zIndex)
            if (pointerEvents) pane.style.pointerEvents = pointerEvents
        })
    }, [map])
    return null
}

function LayerRefInit({ mapRef, layerRefs, onReady }) {
    const map = useMap()
    useEffect(() => {
        mapRef.current = map
        Object.values(layerRefs).forEach((ref) => {
            if (!ref.current) ref.current = L.layerGroup()
        })
        if (onReady) onReady()
    }, [map])  // eslint-disable-line react-hooks/exhaustive-deps
    return null
}

function FlyTo({ event }) {
    const map = useMap()
    useEffect(() => {
        if (event?.lat && event?.lng) map.flyTo([event.lat, event.lng], 9, { duration: 0.9 })
    }, [event])
    return null
}

// ── Operational signal surface ───────────────────────────────────────────────
// Additive glow layer beneath existing markers. Canvas-backed via preferCanvas.
function SignalSurfaceLayer({ items, zoom }) {
    const rendererRef = useRef(null)
    if (!rendererRef.current) rendererRef.current = L.canvas({ padding: 0.3 })
    if (!items?.length) return null

    return (
        <>
            {items.map((item, index) => {
                const lat = Number(item?.lat)
                const lon = Number(item?.lon ?? item?.lng)
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

                const style = getSignalStyle(item, zoom)
                const keyBase = item?.id || item?.url || item?.headline || `${lat.toFixed(3)}_${lon.toFixed(3)}_${index}`

                return (
                    <Fragment key={`signal-surface-${keyBase}`}>
                        <CircleMarker
                            center={[lat, lon]}
                            radius={style.outerRadius}
                            pane="signal-surface"
                            renderer={rendererRef.current}
                            pathOptions={{ stroke: false, fillColor: style.color, fillOpacity: style.outerOpacity }}
                            interactive={false}
                        />
                        <CircleMarker
                            center={[lat, lon]}
                            radius={style.haloRadius}
                            pane="signal-surface"
                            renderer={rendererRef.current}
                            pathOptions={{ stroke: false, fillColor: style.color, fillOpacity: style.haloOpacity }}
                            interactive={false}
                        />
                        <CircleMarker
                            center={[lat, lon]}
                            radius={style.coreRadius}
                            pane="signal-surface"
                            renderer={rendererRef.current}
                            pathOptions={{ stroke: false, fillColor: style.color, fillOpacity: style.coreOpacity }}
                            interactive={false}
                        />
                    </Fragment>
                )
            })}
        </>
    )
}

// ── Region bounding boxes for theater polygons ────────────────────────────────
// (s, n, w, e) matching scoring.py REGION_BBOXES
const REGION_BBOXES_THEATER = {
    "East Africa":                 [-12,   5,  28,  42],
    "Horn of Africa":              [  2,  18,  38,  52],
    "Great Lakes Region":          [-10,   2,  27,  33],
    "Sahel":                       [ 10,  20, -17,  24],
    "West Africa":                 [  4,  20, -17,  16],
    "North Africa":                [ 18,  38, -17,  37],
    "Central Africa":              [-10,  10,   8,  32],
    "Southern Africa":             [-35, -12,  12,  36],
    "Red Sea / Arabian Peninsula": [ 12,  30,  32,  60],
    "Gulf States":                 [ 22,  30,  46,  60],
    "Middle East":                 [ 25,  42,  28,  63],
    "Indian Ocean":                [-35,  25,  30, 110],
    "Mediterranean":               [ 30,  46,  -6,  42],
    "South Asia":                  [  5,  38,  60,  95],
    "Southeast Asia":              [-10,  28,  92, 140],
    "Central Asia":                [ 36,  55,  46,  90],
    "Europe":                      [ 35,  72, -25,  45],
}

// ── Major cities for city labels layer ────────────────────────────────────────
const MAJOR_CITIES = [
    // East Africa
    { name:"Nairobi",        lat:-1.286,  lon:36.817  }, { name:"Dar es Salaam", lat:-6.800,  lon:39.283  },
    { name:"Addis Ababa",    lat:9.025,   lon:38.747  }, { name:"Kampala",       lat:0.347,   lon:32.583  },
    { name:"Kigali",         lat:-1.944,  lon:30.059  }, { name:"Mogadishu",     lat:2.046,   lon:45.341  },
    { name:"Djibouti",       lat:11.589,  lon:43.145  }, { name:"Asmara",        lat:15.339,  lon:38.931  },
    // Southern Africa
    { name:"Johannesburg",   lat:-26.195, lon:28.034  }, { name:"Cape Town",     lat:-33.924, lon:18.424  },
    { name:"Lusaka",         lat:-15.417, lon:28.283  }, { name:"Harare",        lat:-17.829, lon:31.052  },
    { name:"Maputo",         lat:-25.965, lon:32.573  }, { name:"Antananarivo",  lat:-18.913, lon:47.536  },
    // West/Central Africa
    { name:"Lagos",          lat:6.524,   lon:3.379   }, { name:"Kinshasa",      lat:-4.322,  lon:15.322  },
    { name:"Accra",          lat:5.600,   lon:-0.187  }, { name:"Dakar",         lat:14.693,  lon:-17.447 },
    { name:"Abidjan",        lat:5.354,   lon:-4.008  }, { name:"Khartoum",      lat:15.500,  lon:32.560  },
    // North Africa / Middle East
    { name:"Cairo",          lat:30.044,  lon:31.236  }, { name:"Tripoli",       lat:32.902,  lon:13.180  },
    { name:"Tunis",          lat:36.819,  lon:10.166  }, { name:"Algiers",       lat:36.752,  lon:3.042   },
    { name:"Riyadh",         lat:24.689,  lon:46.688  }, { name:"Baghdad",       lat:33.341,  lon:44.401  },
    { name:"Tehran",         lat:35.696,  lon:51.423  }, { name:"Ankara",        lat:39.933,  lon:32.860  },
    { name:"Amman",          lat:31.956,  lon:35.945  }, { name:"Beirut",        lat:33.888,  lon:35.495  },
    { name:"Aden",           lat:12.780,  lon:45.036  }, { name:"Sana'a",        lat:15.355,  lon:44.207  },
    // Europe
    { name:"London",         lat:51.507,  lon:-0.128  }, { name:"Paris",         lat:48.857,  lon:2.347   },
    { name:"Berlin",         lat:52.520,  lon:13.405  }, { name:"Rome",          lat:41.902,  lon:12.496  },
    { name:"Madrid",         lat:40.417,  lon:-3.702  }, { name:"Athens",        lat:37.983,  lon:23.728  },
    { name:"Warsaw",         lat:52.229,  lon:21.012  }, { name:"Kyiv",          lat:50.450,  lon:30.524  },
    { name:"Moscow",         lat:55.751,  lon:37.617  }, { name:"Istanbul",      lat:41.015,  lon:28.979  },
    // South / Southeast Asia
    { name:"Mumbai",         lat:19.076,  lon:72.878  }, { name:"Delhi",         lat:28.614,  lon:77.209  },
    { name:"Karachi",        lat:24.861,  lon:67.010  }, { name:"Kabul",         lat:34.528,  lon:69.172  },
    { name:"Bangkok",        lat:13.756,  lon:100.502 }, { name:"Singapore",     lat:1.353,   lon:103.822 },
    { name:"Jakarta",        lat:-6.211,  lon:106.845 }, { name:"Yangon",        lat:16.867,  lon:96.195  },
]

// ── Chokepoint precise polygons — [lat, lon] pairs per point ──────────────────
// Spec-supplied coordinates converted from GeoJSON [lon,lat] to Leaflet [lat,lon].
// Remaining 9 are approximate narrow polygons following geographic shape.
const CHOKEPOINT_POLYS = {
    "Strait of Hormuz":      [[26.8,56.3],[26.3,57.2],[25.8,57.8],[25.4,58.5],[24.8,57.9],[25.2,57.1],[25.9,56.5],[26.8,56.3]],
    "Bab el-Mandeb":         [[12.8,43.1],[12.4,43.5],[11.8,43.8],[11.5,43.2],[11.9,42.8],[12.4,42.7],[12.8,43.1]],
    "Suez Canal":            [[30.7,32.3],[30.5,32.6],[29.9,32.6],[29.3,32.5],[28.6,32.3],[28.6,32.1],[29.3,32.2],[29.9,32.3],[30.7,32.3]],
    "Strait of Malacca":     [[5.8,100.4],[5.0,101.2],[3.8,102.5],[2.5,103.8],[1.5,104.3],[1.2,103.5],[2.2,102.8],[3.5,101.5],[4.8,100.2],[5.8,100.4]],
    "Strait of Gibraltar":   [[36.0,-5.6],[36.2,-5.2],[36.1,-4.9],[35.9,-4.9],[35.8,-5.2],[35.7,-5.6],[35.9,-5.9],[36.0,-5.6]],
    "Turkish Straits / Bosphorus": [[41.5,28.8],[41.6,29.0],[41.4,29.1],[41.1,29.0],[40.9,28.8],[41.0,28.6],[41.2,28.6],[41.5,28.8]],
    "Danish Straits":        [[57.8,9.8],[57.9,11.5],[57.0,12.5],[55.7,12.6],[55.3,12.0],[55.3,10.5],[56.0,9.5],[57.0,9.5],[57.8,9.8]],
    "Strait of Lombok":      [[-8.1,115.4],[-8.0,115.7],[-8.2,116.0],[-8.6,116.1],[-8.9,115.9],[-8.8,115.5],[-8.5,115.3],[-8.1,115.4]],
    "Mozambique Channel":    [[-11.0,43.5],[-14.0,46.0],[-18.0,47.0],[-23.0,46.0],[-26.0,43.0],[-24.0,39.0],[-19.0,36.0],[-14.0,37.0],[-11.0,40.5],[-11.0,43.5]],
    "Cape of Good Hope":     [[-33.8,18.0],[-33.7,18.8],[-34.3,19.2],[-35.2,18.8],[-35.4,18.0],[-34.8,17.5],[-34.0,17.5],[-33.8,18.0]],
    "Panama Canal":          [[9.3,-79.5],[9.4,-79.3],[9.2,-79.2],[8.9,-79.4],[8.7,-79.7],[8.8,-80.0],[9.1,-80.1],[9.3,-80.0],[9.3,-79.5]],
    "Luzon Strait":          [[21.8,120.2],[21.8,121.8],[20.5,122.4],[19.2,121.8],[19.2,120.2],[20.5,119.6],[21.8,120.2]],
}

// ── Convex hull (gift-wrapping) + polygon expansion helpers ──────────────────
function _cross2d(O, A, B) {
    return (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0])
}
function convexHull(pts) {
    if (pts.length < 3) return pts.slice()
    const n = pts.length
    const hull = []
    let leftmost = 0
    for (let i = 1; i < n; i++) if (pts[i][1] < pts[leftmost][1]) leftmost = i
    let cur = leftmost
    do {
        hull.push(pts[cur])
        let nxt = (cur + 1) % n
        for (let i = 0; i < n; i++) if (_cross2d(pts[cur], pts[nxt], pts[i]) > 0) nxt = i
        cur = nxt
    } while (cur !== leftmost)
    return hull
}
function expandPolygon(hull, expandKm) {
    const cLat = hull.reduce((s, p) => s + p[0], 0) / hull.length
    const cLon = hull.reduce((s, p) => s + p[1], 0) / hull.length
    return hull.map(([lat, lon]) => {
        const dLat = lat - cLat, dLon = lon - cLon
        const dist = Math.sqrt(dLat*dLat + dLon*dLon)
        if (dist < 1e-9) return [lat + expandKm/111, lon]
        const add = expandKm / 111.0
        const scale = (dist + add) / dist
        return [cLat + dLat * scale, cLon + dLon * scale]
    })
}

function pointInBounds(item, bounds) {
    if (!bounds) return true
    const lat = Number(item?.lat)
    const lon = Number(item?.lon ?? item?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
    return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east
}

// ── Cluster surface items within thresholdKm ─────────────────────────────────
const TIER_ORDER = { critical: 4, significant: 3, elevated: 2, low: 1 }

function clusterSurfaceItems(items, thresholdKm = 100) {
    const assigned = new Set()
    const clusters = []
    for (let i = 0; i < items.length; i++) {
        if (assigned.has(i)) continue
        const group = [items[i]]
        assigned.add(i)
        for (let j = i + 1; j < items.length; j++) {
            if (assigned.has(j)) continue
            if (haversineKm(items[i].lat, items[i].lon, items[j].lat, items[j].lon) <= thresholdKm) {
                group.push(items[j]); assigned.add(j)
            }
        }
        const lat     = group.reduce((s, x) => s + x.lat, 0) / group.length
        const lon     = group.reduce((s, x) => s + x.lon, 0) / group.length
        const topTier = group.reduce((top, x) =>
            (TIER_ORDER[x.severity_tier] || 0) > (TIER_ORDER[top] || 0) ? x.severity_tier : top, "low")
        clusters.push({ lat, lon, count: group.length, severity_tier: topTier, items: group })
    }
    return clusters
}

function makeClusterIcon(cluster) {
    // White number on dark circle, 2px border in highest severity colour
    const color = TIER_COLOR[cluster.severity_tier] || "#f59e0b"
    const size  = cluster.count >= 5 ? 40 : cluster.count >= 3 ? 34 : 28
    const half  = size / 2
    const html =
        `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
        `background:#0d1117;border:2px solid ${color};` +
        `display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${color}66;">` +
        `<span style="color:#fff;font-size:${size<=28?10:11}px;font-weight:700;line-height:1;">${cluster.count}</span>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half] })
}

// ── Drag handle icon (three horizontal lines) ─────────────────────────────────
function DragHandle({ onMouseDown }) {
    return (
        <div
            onMouseDown={onMouseDown}
            style={{
                cursor: "grab",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3.5,
                paddingBottom: 9,
                marginBottom: 8,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                userSelect: "none",
            }}
        >
            {[0, 1, 2].map(i => (
                <div
                    key={i}
                    style={{
                        width: 20,
                        height: 1.5,
                        background: "rgba(255,255,255,0.22)",
                        borderRadius: 1,
                    }}
                />
            ))}
        </div>
    )
}

// ── Shared glassmorphism panel style ──────────────────────────────────────────
const GLASS = {
    background:     "var(--akili-panel-blur)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderRadius:   12,
    border:         "1px solid var(--akili-border)",
}

// ── ADS-B helpers ─────────────────────────────────────────────────────────────

function getAircraftColor(ac) {
    if (ac.military) return "#FF3333"
    const cat = ac.category || ""
    if (cat === "A7") return "#FFD600"                                  // helicopter
    if (["A3", "A4", "A5"].includes(cat)) return "#00E5FF"             // heavy/large commercial
    if (cat.startsWith("A") || cat.startsWith("B")) return "#76FF03"   // general aviation / private
    return "#FF6D00"                                                     // unknown / unclassified
}

// Equilateral triangle icon, nose pointing up, rotated by track heading.
// The rotation div is kept separate from the label so the label is never rotated.
function makeAircraftIcon(ac, showLabel) {
    const color  = getAircraftColor(ac)
    // Military gets red glow; interesting gets same-colour glow
    const glowColor = ac.military ? "#FF3333" : color
    const filter = (ac.military || ac.interesting)
        ? `filter:drop-shadow(0 0 4px ${glowColor})`
        : ""
    const callsign = (ac.flight || "").trim() || ac.icao || ""
    const altNum   = ac.alt_baro != null && !isNaN(Number(ac.alt_baro))
        ? Number(ac.alt_baro)
        : null
    const altText  = altNum != null ? ` · ${altNum.toLocaleString()}ft` : ""

    const labelHtml = (showLabel && callsign)
        ? `<div style="position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;white-space:nowrap;font-family:system-ui,sans-serif;pointer-events:none;letter-spacing:0.02em">${callsign}${altText}</div>`
        : ""

    // Airplane silhouette (Material Icons "flight", 24×24), nose pointing up, rotated by track
    const html = `<div style="position:relative;width:18px;height:18px">` +
        `<div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;transform:rotate(${ac.track || 0}deg)">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" style="${filter}">` +
        `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="0.5"/>` +
        `</svg></div>${labelHtml}</div>`

    return L.divIcon({
        html,
        className:   "",
        iconSize:    [18, 18],
        iconAnchor:  [9, 9],
        popupAnchor: [0, -12],
    })
}

// ── Conflict glow icon ────────────────────────────────────────────────────────
// ── Marker colours and sizes — shared by all surface/conflict icon builders ───
//   Centre:     8px white disc, always visible against any terrain
//   Inner ring: 14px, severity colour, 1.5px stroke, no fill
//   Outer glow: radial-gradient, size + opacity per tier
const TIER_COLOR = { critical: "#ff3b3b", significant: "#ff8c00", elevated: "#ffd700", low: "#00e5cc" }
const TIER_GLOW_SIZE    = { critical: 60, significant: 44, elevated: 32, low: 22 }
const TIER_GLOW_OPACITY = { critical: 0.55, significant: 0.45, elevated: 0.35, low: 0.25 }

function _hexToRgb(hex) {
    const h = hex.length === 4
        ? hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
        : hex.slice(1)
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

function makeConflictIcon(ev, isSelected) {
    const tier    = ev.severity_tier || "low"
    const pulse   = ev.pattern_detected
    const color   = TIER_COLOR[tier] || "#00e5cc"
    const size    = TIER_GLOW_SIZE[tier] || 22
    const op      = TIER_GLOW_OPACITY[tier] || 0.25
    const half    = size / 2
    const anim    = pulse ? "animation:conflictPulse 2.8s ease-in-out infinite;" : ""
    const selRing = isSelected
        ? `<div style="position:absolute;inset:0;border:1.5px solid ${color};border-radius:50%;opacity:0.9;pointer-events:none"></div>`
        : ""
    const [r,g,b] = _hexToRgb(color)

    const html =
        // Outer glow
        `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
        `background:radial-gradient(circle,rgba(${r},${g},${b},${op}) 0%,rgba(${r},${g},${b},${op*0.5}) 45%,transparent 75%);` +
        `position:relative;display:flex;align-items:center;justify-content:center;${anim}">` +
        selRing +
        // Inner ring (14px)
        `<div style="position:absolute;width:14px;height:14px;border-radius:50%;` +
        `border:1.5px solid rgba(${r},${g},${b},0.9);background:transparent;"></div>` +
        // Centre dot (8px white)
        `<div style="width:8px;height:8px;border-radius:50%;background:#fff;position:relative;z-index:1;flex-shrink:0"></div>` +
        `</div>`

    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half - 2] })
}

// ── Infrastructure glyph map for zoom-8+ individual markers ──────────────────
const INFRA_GLYPH = {
    "Aviation":           "✈",
    "Maritime / Ports":   "⚓",
    "Energy":             "⚡",
    "Telecommunications": "◉",
    "Security":           "◎",
    "Military":           "★",
    "Financial":          "◈",
}

const EVENT_MARKER_COLORS = {
    red:    "#ef4444",
    amber:  "#f59e0b",
    teal:   "#0d9488",
    orange: "#f97316",
    yellow: "#eab308",
    white:  "#f8fafc",
    grey:   "#94a3b8",
}

const EVENT_ICON_SVG = {
    explosion: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M16 2l3 8 9-1-5 6 7 5-9 1-1 9-4-7-7 5 2-8-8-3 8-4-2-8 7 5z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
    missile: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M24 6l2 8-9 9-5 1 1-5 9-9z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `<path d="M10 22l-4 4M13 25l-4 1 1-4" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
        `</svg>`,
    armed_clash: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<circle cx="16" cy="16" r="8.5" fill="none" stroke="${c}" stroke-width="2"/>` +
        `<circle cx="16" cy="16" r="2.5" fill="${c}"/>` +
        `<path d="M16 4v5M16 23v5M4 16h5M23 16h5" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
        `</svg>`,
    fire: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M18 4c1 5-3 6-2 10 1 2 4 3 4 7a6 6 0 11-12 0c0-4 3-6 5-9 2-3 1-5 5-8z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
    aviation: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M28 20v-2l-10-6V5.5a1.8 1.8 0 00-1.8-1.8h-.4A1.8 1.8 0 0014 5.5V12L4 18v2l10-2.6V24l-2.5 1.9v1.7l4.5-1.3 4.5 1.3v-1.7L18 24v-6.6z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
    maritime: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M16 4a4 4 0 100 8 4 4 0 000-8zm2 7.7V24c4-.6 7-3.4 7-6h-3l4-4 4 4h-3c0 5-4.9 9-11 9S5 23 5 18H2l4-4 4 4H7c0 2.6 3 5.4 7 6V11.7z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1"/>` +
        `</svg>`,
    energy: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M13 3v11h-4l10 15v-11h4L13 3z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
    earthquake: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<circle cx="16" cy="16" r="4" fill="none" stroke="${c}" stroke-width="2"/>` +
        `<circle cx="16" cy="16" r="8" fill="none" stroke="${c}" stroke-width="2" opacity="0.8"/>` +
        `<circle cx="16" cy="16" r="12" fill="none" stroke="${c}" stroke-width="2" opacity="0.55"/>` +
        `</svg>`,
    protest: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M5 17l12-5v8L5 15v2zm12-5 8-3v14l-8-3V12zM11 21l-1 5" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `</svg>`,
    medical: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7V6z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
    general: (c) =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="16" height="16">` +
        `<path d="M16 4l10 12-10 12L6 16 16 4z" fill="${c}" stroke="rgba(15,23,42,0.85)" stroke-width="1.1"/>` +
        `</svg>`,
}

function eventColorValue(color) {
    if (!color) return EVENT_MARKER_COLORS.grey
    if (color.startsWith?.("#")) return color
    return EVENT_MARKER_COLORS[color] || EVENT_MARKER_COLORS.grey
}

function eventTypeValue(item) {
    const raw = item?.type || item?.icon || "general"
    const alias = {
        missile_warning: "missile",
        missile_alert: "missile",
        rocket_alert: "missile",
        conflict_zone: "armed_clash",
        news_event: "general",
        power_plant: "energy",
        port: "maritime",
        airport: "aviation",
    }
    const candidate = alias[raw] || raw
    return EVENT_ICON_SVG[candidate] ? candidate : "general"
}

function numericConfidence(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (value === "high") return 0.9
    if (value === "medium") return 0.65
    if (value === "low") return 0.35
    return 0.55
}

function inferSignalColor(item) {
    if (item?.color) return eventColorValue(item.color)
    const text = [
        item?.type,
        item?.event_type,
        item?.headline,
        item?.title,
        item?.location,
        item?.description,
        item?.context,
    ].filter(Boolean).join(" ").toLowerCase()

    if (/\b(conflict|attack|raid|strike|missile|rocket|bomb|blast|explosion|gunfire|clash|killed|troops|assault)\b/.test(text)) {
        return "#ef4444"
    }
    if (/\b(protest|riot|unrest|warning|alert|earthquake|seismic|fire|arson|blaze|piracy|pirate|hijack|maritime)\b/.test(text)) {
        return "#f59e0b"
    }
    if (/\b(statement|watch|advisory|risk|monitor|possible|suspected|unverified)\b/.test(text)) {
        return "#eab308"
    }
    return "#38bdf8"
}

function getSignalStyle(item, zoom) {
    const color = inferSignalColor(item)
    const significance = Number(item?.significance_score ?? item?.relevance_score ?? 0)
    const confidence = numericConfidence(item?.confidence)
    const type = eventTypeValue(item)
    const highThreat = type === "missile" || type === "explosion" || type === "armed_clash" || significance >= 80
    const mediumThreat = type === "protest" || type === "earthquake" || type === "fire" || significance >= 55
    const zoomScale = zoom <= 3 ? 2.1 : zoom <= 5 ? 1.45 : zoom <= 7 ? 1.0 : 0.72
    const severityScale = highThreat ? 1.35 : mediumThreat ? 1.05 : 0.85
    const confidenceScale = 0.75 + confidence * 0.55
    const scale = zoomScale * severityScale * confidenceScale

    return {
        color,
        coreRadius: Math.max(6, Math.round(7 * scale)),
        haloRadius: Math.max(12, Math.round(15 * scale)),
        outerRadius: Math.max(20, Math.round(28 * scale)),
        coreOpacity: highThreat ? 0.36 : mediumThreat ? 0.27 : 0.2,
        haloOpacity: highThreat ? 0.21 : mediumThreat ? 0.16 : 0.12,
        outerOpacity: highThreat ? 0.11 : mediumThreat ? 0.085 : 0.06,
    }
}

function makeEventMarkerIcon(item, compact = false) {
    const color    = eventColorValue(item?.color)
    const type     = eventTypeValue(item)
    const critical = Number(item?.significance_score || 0) >= 80
    const glowSize = compact ? 40 : 48
    const coreSize = compact ? 24 : 32
    const ringSize = compact ? 30 : 40
    const [r, g, b] = _hexToRgb(color)
    const glowHalf = glowSize / 2
    const svg = (EVENT_ICON_SVG[type] || EVENT_ICON_SVG.general)(color)
    const pulseRing = critical
        ? `<div style="position:absolute;width:${ringSize}px;height:${ringSize}px;border-radius:50%;border:1.5px solid rgba(${r},${g},${b},0.95);animation:conflictPulse 1.8s ease-in-out infinite;"></div>`
        : ""
    const html =
        `<div class="event-marker" style="width:${glowSize}px;height:${glowSize}px;position:relative;display:flex;align-items:center;justify-content:center;">` +
        `<div style="position:absolute;width:${glowSize}px;height:${glowSize}px;border-radius:50%;background:radial-gradient(circle,rgba(${r},${g},${b},0.45) 0%,rgba(${r},${g},${b},0.22) 46%,transparent 74%);"></div>` +
        pulseRing +
        `<div style="position:absolute;width:${coreSize}px;height:${coreSize}px;border-radius:50%;background:rgba(15,23,42,0.86);border:1.5px solid rgba(${r},${g},${b},0.82);display:flex;align-items:center;justify-content:center;box-shadow:0 0 18px rgba(${r},${g},${b},0.25);">` +
        svg +
        `</div>` +
        `</div>`

    return L.divIcon({
        html,
        className: "",
        iconSize: [glowSize, glowSize],
        iconAnchor: [glowHalf, glowHalf],
        popupAnchor: [0, -glowHalf],
    })
}

function makeSurfaceIcon(item) {
    return makeEventMarkerIcon(item, true)
}

function makeSurfaceSymbol(item) {
    return makeEventMarkerIcon(item, false)
}

// ── Route pin icon ────────────────────────────────────────────────────────────
// Simple drop-pin SVG coloured by the caller (green = origin, red = dest).
function makePinIcon(color) {
    const html =
        `<div style="position:relative;width:20px;height:28px">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 28" width="20" height="28">` +
        `<path d="M10 0C5.6 0 2 3.6 2 8c0 6 8 20 8 20s8-14 8-20c0-4.4-3.6-8-8-8z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>` +
        `<circle cx="10" cy="8" r="3.5" fill="#fff" fill-opacity="0.9"/>` +
        `</svg></div>`
    return L.divIcon({ html, className: "", iconSize: [20, 28], iconAnchor: [10, 28], popupAnchor: [0, -30] })
}

// ── Utility helpers ────────────────────────────────────────────────────────────
function relativeTime(isoString) {
    if (!isoString) return ""
    const diff = Math.floor((Date.now() - new Date(isoString)) / 60000)
    if (diff < 60)   return `${diff} min ago`
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`
    return `${Math.floor(diff / 1440)} days ago`
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── MapClickHandler ────────────────────────────────────────────────────────────
// Null-rendering map child — captures click events for route planner mode.
// When active, click sets origin (if unset) or destination.
function MapClickHandler({ enabled, origin, onOrigin, onDest }) {
    useMapEvents({
        click(e) {
            if (!enabled) return
            const { lat, lng } = e.latlng
            if (!origin) {
                onOrigin({ lat, lon: lng })
            } else {
                onDest({ lat, lon: lng })
            }
        },
    })
    return null
}

// ── SatelliteMoveHandler — triggers auto-search on moveend (debounced 800ms) ──
function SatelliteMoveHandler({ active, timerRef, onMoved }) {
    useMapEvents({
        moveend(e) {
            if (!active) return
            clearTimeout(timerRef.current)
            const b = e.target.getBounds()
            timerRef.current = setTimeout(() => {
                onMoved({
                    west:  b.getWest(),
                    south: b.getSouth(),
                    east:  b.getEast(),
                    north: b.getNorth(),
                })
            }, 800)
        },
    })
    return null
}

// ── MapClickClose — closes webcam popup on any bare map click ─────────────────
function MapClickClose({ onClose }) {
    useMapEvents({ click: onClose })
    return null
}

// ── AnnotationMapHandler — handles click/dblclick for annotation modes ────────
function AnnotationMapHandler({ mode, zoneInProgress, onPoint, onZoneVertex, onZoneClose, onEscape }) {
    useMapEvents({
        click(e) {
            if (mode === "point")  onPoint(e.latlng.lat, e.latlng.lng)
            if (mode === "zone")   onZoneVertex(e.latlng.lat, e.latlng.lng)
        },
        dblclick(e) {
            L.DomEvent.stopPropagation(e)
            if (mode === "zone" && zoneInProgress.length >= 3) onZoneClose()
        },
        keydown(e) {
            if (e.originalEvent?.key === "Escape") onEscape()
        },
    })
    return null
}

// ── TheaterMapHandler — click to collect polygon vertices, dblclick to close ──
function TheaterMapHandler({ enabled, pts, onVertex, onClose }) {
    useMapEvents({
        click(e) {
            if (!enabled) return
            L.DomEvent.stopPropagation(e)
            onVertex(e.latlng.lat, e.latlng.lng)
        },
        dblclick(e) {
            if (!enabled) return
            L.DomEvent.stopPropagation(e)
            if (pts.length >= 3) onClose()
        },
    })
    return null
}

// ── AreaClickHandler — bare map click at zoom ≤ 7 opens area headline popup ───
function AreaClickHandler({ enabled, onAreaClick }) {
    useMapEvents({
        click(e) {
            if (!enabled) return
            onAreaClick(e.latlng.lat, e.latlng.lng)
        },
    })
    return null
}

// ── makeWebcamIcon ─────────────────────────────────────────────────────────────
const _webcamIcon = L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:rgba(20,20,30,0.9);border:2px solid #FFB300;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 8px rgba(255,179,0,0.4);"><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='14' height='14'><path d='M12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm6.8-10.4H17l-1.35-1.6H8.35L7 4.8H5.2A2.2 2.2 0 0 0 3 7v11.2A2.2 2.2 0 0 0 5.2 20.4h13.6a2.2 2.2 0 0 0 2.2-2.2V7a2.2 2.2 0 0 0-2.2-2.2z' fill='#FFB300'/></svg></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
})

// ── makeInfraIcon — OSM categories with glow-disc pattern ─────────────────────
function makeInfraIcon(category, label) {
    const cat = INFRA_CATS[category] || { symbol: "◆", color: "#888", label: "Unknown" }
    const color = cat.color
    const hex = color.replace("#","")
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16)
    const size = 28, half = 14
    const html =
        `<div style="width:${size}px;height:${size}px;position:relative;pointer-events:auto;" title="${label || cat.label}">` +
        `<div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(${r},${g},${b},0.45) 0%,rgba(${r},${g},${b},0.2) 45%,transparent 72%);"></div>` +
        `<div style="position:absolute;inset:6px;border-radius:50%;background:rgba(${r},${g},${b},0.15);border:1.5px solid rgba(${r},${g},${b},0.7);display:flex;align-items:center;justify-content:center;">` +
        `<span style="font-size:8px;line-height:1;color:#fff;">${cat.symbol}</span>` +
        `</div>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half-2] })
}

// ── Dataset infrastructure icons (airport / port / power plant) ───────────────
function makeAirportIcon(name) {
    const size = 26, half = 13
    const html =
        `<div style="width:${size}px;height:${size}px;position:relative;pointer-events:auto;" title="${name||'Airport'}">` +
        `<div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(0,188,212,0.5) 0%,rgba(0,188,212,0.2) 45%,transparent 72%);"></div>` +
        `<div style="position:absolute;inset:5px;border-radius:50%;background:rgba(0,188,212,0.15);border:1.5px solid rgba(0,188,212,0.8);display:flex;align-items:center;justify-content:center;">` +
        `<svg width="8" height="8" viewBox="0 0 24 24" fill="#00BCD4"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>` +
        `</div>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half-2] })
}

function makePortIcon(name) {
    const html =
        `<div style="width:36px;height:36px;position:relative;display:flex;align-items:center;justify-content:center;pointer-events:auto;" title="${name||'Port'}">` +
        `<div style="position:absolute;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle,rgba(13,148,136,0.35) 0%,transparent 70%);top:-4px;left:-4px;"></div>` +
        `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        `<circle cx="12" cy="5" r="3" stroke="#0d9488" stroke-width="2"/>` +
        `<line x1="12" y1="8" x2="12" y2="20" stroke="#0d9488" stroke-width="2"/>` +
        `<path d="M6 20 C6 20 6 16 12 16 C18 16 18 20 18 20" stroke="#0d9488" stroke-width="2" fill="none"/>` +
        `<line x1="6" y1="11" x2="18" y2="11" stroke="#0d9488" stroke-width="1.5"/>` +
        `</svg>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20] })
}

const _AIS_TYPE_COLOR = { tanker: "#f59e0b", cargo: "#0d9488", military: "#ef4444", passenger: "#3b82f6", other: "#6b7280" }
function makeAisVesselIcon(shipType, heading) {
    const color = _AIS_TYPE_COLOR[shipType] || _AIS_TYPE_COLOR.other
    const hdg   = isFinite(Number(heading)) ? Number(heading) : 0
    const svg   = `<svg width="16" height="24" viewBox="0 0 16 24" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${hdg}deg);transform-origin:50% 50%;display:block;overflow:visible"><polygon points="8,0 14,8 14,22 2,22 2,8" fill="${color}" opacity="0.85" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/><polygon points="8,0 13,7 3,7" fill="rgba(255,255,255,0.4)"/></svg>`
    return L.divIcon({ html: svg, className: "", iconSize: [16, 24], iconAnchor: [8, 12] })
}

function makePowerIcon(name, fuelType) {
    const renewable = ["solar","wind","hydro","geothermal","biomass"].some(f => (fuelType||"").toLowerCase().includes(f))
    const color = renewable ? "#4CAF50" : "#FFD600"
    const r = renewable ? 76 : 255, g = renewable ? 175 : 214, b = renewable ? 80 : 0
    const size = 26, half = 13
    const html =
        `<div style="width:${size}px;height:${size}px;position:relative;pointer-events:auto;" title="${name||'Power Plant'}">` +
        `<div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(${r},${g},${b},0.5) 0%,rgba(${r},${g},${b},0.2) 45%,transparent 72%);"></div>` +
        `<div style="position:absolute;inset:5px;border-radius:50%;background:rgba(${r},${g},${b},0.15);border:1.5px solid rgba(${r},${g},${b},0.8);display:flex;align-items:center;justify-content:center;">` +
        `<svg width="8" height="8" viewBox="0 0 24 24" fill="${color}"><path d="M7 2v11h3v9l7-12h-4l4-8H7z"/></svg>` +
        `</div>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half-2] })
}

function featureLatLon(feature) {
    const geom = feature?.geometry || {}
    const coords = geom.coordinates
    if (!coords) return null
    try {
        if (geom.type === "Point") return [coords[1], coords[0]]
        if (geom.type === "LineString") return [coords[0][1], coords[0][0]]
        if (geom.type === "Polygon") return [coords[0][0][1], coords[0][0][0]]
        if (geom.type === "MultiPolygon") return [coords[0][0][0][1], coords[0][0][0][0]]
    } catch {
        return null
    }
    return null
}

function makeContextInfraIcon(node) {
    switch (node?.type) {
        case "airport":
            return makeAirportIcon(node?.name)
        case "port":
            return makePortIcon(node?.name)
        case "power_plant":
            return makePowerIcon(node?.name, node?.subtype)
        case "hospital":
        case "medical":
            return makeInfraIcon("medical", node?.name)
        case "military":
            return makeInfraIcon("military", node?.name)
        case "pipeline":
            return makeInfraIcon("pipelines", node?.name)
        case "chokepoint":
            return makeInfraIcon("chokepoints", node?.name)
        case "security":
        case "police":
            return makeInfraIcon("security", node?.name)
        default:
            return makeInfraIcon("utilities", node?.name || node?.type)
    }
}

// ── Annotation icons ──────────────────────────────────────────────────────────
function makeAnnotationPointIcon(color) {
    return L.divIcon({
        className: "",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 6px ${color}88;cursor:pointer;"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    })
}
function makeSatIcon(color, pulse = false) {
    return L.divIcon({
        className: pulse ? "sat-imagery-dot" : "",
        html: `<div style="width:${pulse?16:8}px;height:${pulse?16:8}px;border-radius:50%;background:${color};border:${pulse?"2px solid #fff":"none"};cursor:pointer;"></div>`,
        iconSize:   [pulse ? 16 : 8, pulse ? 16 : 8],
        iconAnchor: [pulse ? 8 : 4,  pulse ? 8 : 4],
    })
}

// Compute rough area of a polygon (lat/lng vertices) in km²
function zoneAreaKm2(vertices) {
    if (vertices.length < 3) return 0
    let area = 0
    for (let i = 0; i < vertices.length; i++) {
        const [lat1, lng1] = vertices[i]
        const [lat2, lng2] = vertices[(i + 1) % vertices.length]
        area += (lng2 - lng1) * (lat1 + lat2)
    }
    const deg2km = 111.32
    return Math.abs(area * 0.5 * deg2km * deg2km)
}

// ── makeNewsConflictIcon ──────────────────────────────────────────────────────
// Plain amber circle — verifies marker rendering pipeline independently of diamond icon
const _newsConflictIcon = L.divIcon({
    className: "",
    html: '<div style="width:16px;height:16px;background:#FFB300;border-radius:50%;border:2px solid #FF8F00;"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
})

// ── POI marker icons ──────────────────────────────────────────────────────────
const _POI_TAG_COLOR = { target: "#dc2626", suspect: "#d97706", associate: "#0d9488", unknown: "#6b7280" }

function makePoiIcon(poi, apiBase) {
    const color = _POI_TAG_COLOR[poi.tag] || "#6b7280"
    const inner = poi.photo_path
        ? `<img src="${apiBase}/api/poi/${poi.id}/photo" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid ${color};" onerror="this.style.display='none'" />`
        : `<div style="width:28px;height:28px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;"><svg width="14" height="18" viewBox="0 0 14 18" fill="none"><circle cx="7" cy="5" r="4" fill="${color}"/><path d="M1 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/></svg></div>`
    return L.divIcon({
        className: "",
        html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;"><div style="position:absolute;inset:0;border-radius:50%;border:2px solid ${color};opacity:0.55;animation:poiRingPulse 2.4s ease-out infinite;"></div><div style="width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);overflow:hidden;">${inner}</div></div>`,
        iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -26],
    })
}
const _homeIcon = L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:rgba(13,148,136,0.85);border:1.5px solid #0d9488;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 6L7 1l6 5v6a1 1 0 01-1 1H2a1 1 0 01-1-1V6z" stroke="#fff" stroke-width="1.2" fill="rgba(255,255,255,0.15)"/><rect x="5" y="8" width="4" height="5" rx="0.5" fill="#fff" opacity="0.9"/></svg></div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
})
const _workIcon = L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:rgba(217,119,6,0.85);border:1.5px solid #d97706;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="5" width="12" height="8" rx="1" stroke="#fff" stroke-width="1.2" fill="rgba(255,255,255,0.15)"/><path d="M4 5V3a1 1 0 011-1h4a1 1 0 011 1v2" stroke="#fff" stroke-width="1.2"/><line x1="7" y1="5" x2="7" y2="13" stroke="#fff" stroke-width="1" opacity="0.6"/></svg></div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
})

// ── AircraftLayer ─────────────────────────────────────────────────────────────
// Isolated child component: aircraft state and polling live here so that
// setAircraft() on each interval tick never re-renders the parent (MapPage).
// useMap() is called explicitly to anchor this component in the Leaflet context,
// which ensures markers are positioned correctly on initial load and each poll.
const AircraftLayer = memo(function AircraftLayer({
    visible, showLabels, refreshRate, boundsRef, onCount, polling, activateKey,
}) {
    const map = useMap()
    const [aircraft, setAircraft] = useState([])
    const [trackState, setTrackState] = useState({ icao: null, coords: [], status: "idle", color: "#94a3b8" })
    const intervalRef = useRef(null)

    // Polling restarts only when activate is clicked (activateKey bumps) or stopped
    useEffect(() => {
        if (!polling) {
            clearInterval(intervalRef.current)
            setAircraft([])
            onCount(0)
            return
        }
        const fetchAdsb = () => {
            const bounds = boundsRef.current
            if (!bounds) return
            const { north, south, east, west, zoom: z } = bounds
            const centerLat = (north + south) / 2
            const centerLon = (east + west) / 2
            const dist = z < 3 ? 1500 : z < 5 ? 1000 : z < 7 ? 600 : z < 9 ? 300 : 150
            fetch(`${API}/adsb?lat=${centerLat.toFixed(4)}&lon=${centerLon.toFixed(4)}&dist=${dist}`)
                .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
                .then(data => {
                    const list = data.aircraft || []
                    setAircraft(list)
                    onCount(list.length)
                })
                .catch(err => console.error("[adsb] fetch error:", err))
        }
        fetchAdsb()
        intervalRef.current = setInterval(fetchAdsb, refreshRate * 1000)
        return () => clearInterval(intervalRef.current)
    }, [polling, activateKey])

    const fetchTrack = (ac) => {
        const color = getAircraftColor(ac)
        // Second click on same aircraft clears the track
        if (trackState.icao === ac.icao) {
            setTrackState({ icao: null, coords: [], status: "idle", color: "#94a3b8" })
            return
        }
        setTrackState({ icao: ac.icao, coords: [], status: "loading", color })
        fetch(`https://api.adsb.lol/v2/icao/${ac.icao}/track`)
            .then(r => r.json())
            .then(data => {
                const path = data.path || []
                const coords = path
                    .filter(p => Array.isArray(p) && p[1] != null && p[2] != null)
                    .map(p => [p[1], p[2]])   // [lat, lon]
                if (coords.length > 0) {
                    setTrackState({ icao: ac.icao, coords, status: "ok", color })
                } else {
                    setTrackState({ icao: ac.icao, coords: [], status: "unavailable", color })
                }
            })
            .catch(() => setTrackState(s => ({ ...s, status: "unavailable" })))
    }

    // useMap() above keeps this component anchored to the Leaflet context.
    // Checking live zoom avoids stale prop when the interval fires.
    if (!visible || map.getZoom() < 4) return null

    return (
        <Fragment>
            {/* Track polyline — dashed, coloured to match the aircraft */}
            {trackState.status === "ok" && trackState.coords.length > 0 && (
                <Polyline
                    positions={trackState.coords}
                    pathOptions={{ color: trackState.color, weight: 1.5, opacity: 0.75, dashArray: "5 5" }}
                />
            )}
            {aircraft.map(ac => (
                <Marker
                    key={ac.icao || `${ac.lat}-${ac.lon}`}
                    position={[ac.lat, ac.lon]}
                    icon={makeAircraftIcon(ac, showLabels)}
                    eventHandlers={{ click: () => fetchTrack(ac) }}
                >
                    <Popup>
                        <div style={{ fontSize: 11, lineHeight: 1.7, minWidth: 180 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                                {(ac.flight || "").trim() || ac.icao}
                            </div>
                            <div style={{ color: "#555" }}>
                                {ac.icao && <div>ICAO: <strong style={{ color: "#333" }}>{ac.icao}</strong></div>}
                                {ac.alt_baro != null && !isNaN(Number(ac.alt_baro)) && (
                                    <div>Altitude: <strong style={{ color: "#333" }}>{Number(ac.alt_baro).toLocaleString()} ft</strong></div>
                                )}
                                {typeof ac.alt_baro === "string" && isNaN(Number(ac.alt_baro)) && (
                                    <div>Altitude: <strong style={{ color: "#333" }}>{ac.alt_baro}</strong></div>
                                )}
                                {ac.gs != null && <div>Ground Speed: <strong style={{ color: "#333" }}>{Math.round(ac.gs)} kts</strong></div>}
                                {ac.track != null && <div>Heading: <strong style={{ color: "#333" }}>{Math.round(ac.track)}°</strong></div>}
                                {ac.category && <div>Category: <strong style={{ color: "#333" }}>{ac.category}</strong></div>}
                                {ac.type && <div>Type: <strong style={{ color: "#333" }}>{ac.type}</strong></div>}
                            </div>
                            {(ac.military || ac.interesting) && (
                                <div style={{ marginTop: 8, display: "flex", gap: 5 }}>
                                    {ac.military && (
                                        <span style={{ fontSize: 9, background: "rgba(255,68,68,0.12)", color: "#ff4444", padding: "2px 7px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.08em" }}>
                                            MILITARY
                                        </span>
                                    )}
                                    {ac.interesting && (
                                        <span style={{ fontSize: 9, background: "rgba(255,204,0,0.12)", color: "#ffcc00", padding: "2px 7px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.08em" }}>
                                            INTERESTING
                                        </span>
                                    )}
                                </div>
                            )}
                            {/* Track status feedback */}
                            {trackState.icao === ac.icao && trackState.status === "loading" && (
                                <div style={{ fontSize: 10, color: "#888", marginTop: 8, fontStyle: "italic" }}>Loading track…</div>
                            )}
                            {trackState.icao === ac.icao && trackState.status === "unavailable" && (
                                <div style={{ fontSize: 10, color: "#aaa", marginTop: 8 }}>Track unavailable</div>
                            )}
                            {trackState.icao === ac.icao && trackState.status === "ok" && (
                                <div
                                    onClick={() => setTrackState({ icao: null, coords: [], status: "idle", color: "#94a3b8" })}
                                    style={{ fontSize: 10, color: "#ef4444", cursor: "pointer", marginTop: 8 }}
                                >
                                    Clear track ×
                                </div>
                            )}
                        </div>
                    </Popup>
                </Marker>
            ))}
        </Fragment>
    )
})

// ── Deployment layer constants ────────────────────────────────────────────────

const CARRIER_IMAGES = {
    "USS Gerald R. Ford (CVN-78)":    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/USS_Gerald_R._Ford_%28CVN-78%29_underway_on_8_April_2017.JPG/800px-USS_Gerald_R._Ford_%28CVN-78%29_underway_on_8_April_2017.JPG",
    "USS Abraham Lincoln (CVN-72)":   "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/USS_Abraham_Lincoln_%28CVN-72%29_underway_2014.jpg/800px-USS_Abraham_Lincoln_%28CVN-72%29_underway_2014.jpg",
    "FS Charles de Gaulle (R91)":     "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Charles_de_Gaulle_%28R91%29_underway_2009.jpg/800px-Charles_de_Gaulle_%28R91%29_underway_2009.jpg",
    "USS George Washington (CVN-73)": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/USS_George_Washington_%28CVN-73%29_arrives_in_Apra_Harbor%2C_Guam.jpg/800px-USS_George_Washington_%28CVN-73%29_arrives_in_Apra_Harbor%2C_Guam.jpg",
    "USS Iwo Jima (LHD-7)":           "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/USS_Iwo_Jima_%28LHD-7%29.jpg/800px-USS_Iwo_Jima_%28LHD-7%29.jpg",
    "USS Tripoli (LHA-7)":            "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/USS_Tripoli_%28LHA-7%29_underway_in_the_Pacific_Ocean%2C_2020.jpg/800px-USS_Tripoli_%28LHA-7%29_underway_in_the_Pacific_Ocean%2C_2020.jpg",
}

const CARRIER_ZONES = {
    "Ford-class":                       { nfz_km: 92.6,  strike_km: 833,  extended_km: 1296, aircraft: "F/A-18E/F Super Hornet",  nfz_nm: 50,  strike_nm: 450, extended_nm: 700 },
    "Nimitz-class":                     { nfz_km: 92.6,  strike_km: 833,  extended_km: 1296, aircraft: "F/A-18E/F Super Hornet",  nfz_nm: 50,  strike_nm: 450, extended_nm: 700 },
    "Charles de Gaulle-class (nuclear)":{ nfz_km: 92.6,  strike_km: 648,  extended_km: 1019, aircraft: "Rafale Marine",           nfz_nm: 50,  strike_nm: 350, extended_nm: 550 },
    "default":                          { nfz_km: 92.6,  strike_km: 740,  extended_km: 1100, aircraft: "Embarked aircraft",        nfz_nm: 50,  strike_nm: 400, extended_nm: 600 },
}

// Canvas renderer for deployment zone circles — created once at module level
const _depCanvasRenderer = L.canvas()

// Hardcoded major global pipelines — GeoJSON-style features, [lon,lat] coords.
// Remote sources (GOPIT) are dead (404). This gives reliable rendering.
const _HARDCODED_PIPELINES = [
    // ── Oil pipelines ─────────────────────────────────────────────────────────
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[49.8,40.4],[44.8,41.7],[38.5,38.5],[36.1,36.8]] },
      properties:{ name:"Baku–Tbilisi–Ceyhan (BTC)", operator:"BP/SOCAR", type:"oil", status:"operating", countries:"Azerbaijan, Georgia, Turkey" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[53.5,52.5],[45.0,50.5],[38.0,50.0],[30.0,50.8],[24.0,52.3],[18.5,52.0],[13.5,52.5]] },
      properties:{ name:"Druzhba Pipeline", operator:"Transneft", type:"oil", status:"operating", countries:"Russia, Belarus, Poland, Germany" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[103.0,52.0],[110.0,50.5],[116.0,48.0],[122.0,46.0],[130.0,48.5]] },
      properties:{ name:"East Siberia–Pacific Ocean (ESPO)", operator:"Transneft", type:"oil", status:"operating", countries:"Russia, China" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[48.0,26.5],[44.5,27.5],[41.0,30.0],[38.0,32.5],[35.8,33.2]] },
      properties:{ name:"Trans-Arabian Pipeline (Tapline)", operator:"Saudi Aramco", type:"oil", status:"operating", countries:"Saudi Arabia, Jordan, Lebanon" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[32.5,27.2],[30.5,28.0],[29.5,29.5],[32.3,30.0]] },
      properties:{ name:"SUMED Pipeline", operator:"SUMED", type:"oil", status:"operating", countries:"Egypt" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[59.5,47.0],[65.0,46.0],[73.0,43.5],[80.0,43.0],[87.0,43.5],[94.0,42.0],[96.5,41.5]] },
      properties:{ name:"Kazakhstan–China Oil Pipeline (CPC)", operator:"KazMunayGas/CNPC", type:"oil", status:"operating", countries:"Kazakhstan, China" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[50.0,26.3],[47.5,26.0],[44.5,24.5],[41.5,21.5],[39.5,22.0],[37.0,21.5]] },
      properties:{ name:"East–West Pipeline (Saudi Arabia)", operator:"Saudi Aramco", type:"oil", status:"operating", countries:"Saudi Arabia" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[-147.0,70.3],[-148.0,66.0],[-152.0,62.5],[-149.5,61.2],[-145.5,60.5]] },
      properties:{ name:"Trans-Alaska Pipeline (TAPS)", operator:"Alyeska Pipeline", type:"oil", status:"operating", countries:"USA" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[-111.5,49.0],[-106.0,45.5],[-100.0,40.0],[-97.0,37.5],[-96.0,30.0]] },
      properties:{ name:"Keystone Pipeline", operator:"TC Energy", type:"oil", status:"operating", countries:"Canada, USA" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[14.5,40.8],[15.5,41.5],[16.0,43.5],[17.0,45.5],[16.5,47.5],[16.0,48.2]] },
      properties:{ name:"Transalpine Pipeline (TAL)", operator:"TAL", type:"oil", status:"operating", countries:"Italy, Austria" }},
    // ── Gas pipelines ─────────────────────────────────────────────────────────
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[28.0,60.5],[22.0,58.5],[16.0,56.0],[13.5,54.5]] },
      properties:{ name:"Nord Stream", operator:"Gazprom", type:"gas", status:"operating", countries:"Russia, Germany (Baltic Sea)" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[32.0,41.5],[29.0,42.5],[27.0,43.0],[26.5,41.8],[26.0,41.0]] },
      properties:{ name:"TurkStream", operator:"Gazprom", type:"gas", status:"operating", countries:"Russia, Turkey, Bulgaria" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[44.8,41.5],[42.0,40.5],[38.0,38.5],[34.0,37.5],[30.0,37.0],[26.5,40.5]] },
      properties:{ name:"Trans-Anatolian Pipeline (TANAP)", operator:"BOTAS/SOCAR", type:"gas", status:"operating", countries:"Azerbaijan, Turkey" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[26.5,40.5],[23.0,40.8],[20.0,41.2],[19.5,42.0],[18.0,41.5],[15.0,41.0],[13.5,41.5]] },
      properties:{ name:"Trans Adriatic Pipeline (TAP)", operator:"TAP AG", type:"gas", status:"operating", countries:"Greece, Albania, Italy" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[34.5,30.0],[35.0,31.5],[36.5,33.5],[36.5,36.5],[37.5,37.0],[38.0,37.5]] },
      properties:{ name:"Arab Gas Pipeline", operator:"EGAS", type:"gas", status:"operating", countries:"Egypt, Jordan, Syria, Lebanon" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[56.5,27.0],[60.5,25.5],[63.5,25.5],[67.0,25.3],[70.0,26.0]] },
      properties:{ name:"Iran–Pakistan Gas Pipeline (IPI)", operator:"NIGC", type:"gas", status:"proposed", countries:"Iran, Pakistan" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[0.2,35.8],[0.0,37.0],[-1.5,37.5],[-2.0,37.7]] },
      properties:{ name:"Medgaz (Algeria–Spain)", operator:"Sonatrach/Naturgy", type:"gas", status:"operating", countries:"Algeria, Spain" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[3.5,36.0],[1.5,36.5],[0.0,36.5],[-2.0,35.8],[-4.0,35.8],[-5.4,35.9]] },
      properties:{ name:"Maghreb–Europe Gas Pipeline (GME)", operator:"Sonatrach", type:"gas", status:"operating", countries:"Algeria, Morocco, Spain" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[58.5,37.5],[63.0,38.5],[67.0,38.0],[72.0,39.5],[78.0,40.0],[83.0,42.0],[87.0,43.5],[92.0,40.0],[96.0,40.0]] },
      properties:{ name:"Turkmenistan–China Gas Pipeline (TCGP)", operator:"CNPC/Turkmengaz", type:"gas", status:"operating", countries:"Turkmenistan, Uzbekistan, Kazakhstan, China" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[9.6,37.0],[10.5,37.5],[12.0,38.0],[12.5,38.5],[14.0,41.0],[13.5,41.5]] },
      properties:{ name:"Trans-Mediterranean Pipeline (TransMed)", operator:"ENI/STEG", type:"gas", status:"operating", countries:"Algeria, Tunisia, Italy" }},
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[55.3,23.5],[56.0,25.0],[56.5,26.5],[57.0,28.0],[57.5,30.0],[55.0,32.0],[52.5,33.0],[50.0,33.5],[47.0,34.5],[44.5,35.5],[42.5,37.0]] },
      properties:{ name:"Iran–Iraq–Syria Gas Pipeline", operator:"NIGC", type:"gas", status:"proposed", countries:"Iran, Iraq, Syria" }},
    // ── LNG terminals / cross links ───────────────────────────────────────────
    { type:"Feature", geometry:{ type:"LineString", coordinates:[[103.8,1.3],[104.5,3.0],[104.7,5.0],[104.5,8.0],[103.0,11.0],[101.0,13.5]] },
      properties:{ name:"Thailand–Singapore Gas Pipeline", operator:"PTT/Petronas", type:"lng", status:"operating", countries:"Thailand, Malaysia, Singapore" }},
]

// Hardcoded shipping routes — renders immediately on toggle, no fetch required
const _SHIPPING_LANES = [
    // Persian Gulf / Hormuz
    { name: "Persian Gulf — Strait of Hormuz",  coords: [[29,48],[28,50],[27,52],[26.5,56.5]],                                                         weight: 3, type: "major"     },
    { name: "Hormuz — Arabian Sea",             coords: [[26.5,56.5],[24,58],[22,60],[18,65],[15,68],[12,65]],                                          weight: 3, type: "major"     },
    { name: "Arabian Sea — Indian Ocean W",     coords: [[12,65],[10,60],[8,55],[5,50],[0,45],[-5,42],[-10,42]],                                        weight: 2, type: "major"     },
    // Red Sea / Suez
    { name: "Suez Canal",                       coords: [[30.7,32.3],[30,32.5],[28,32.6],[25,33],[23,37],[20,38],[18,39],[16,40],[14,41],[12.6,43.3]],  weight: 3, type: "major"     },
    { name: "Bab el-Mandeb — Gulf of Aden",     coords: [[12.6,43.3],[12,45],[11,48],[10,50],[9,52],[8,55]],                                            weight: 2, type: "major"     },
    // Mediterranean
    { name: "Mediterranean W-E",                coords: [[-5.4,36],[0,37],[5,38],[10,38],[16,38],[20,37],[25,35],[30,34],[33,34],[35,35]],              weight: 2, type: "major"     },
    { name: "Gibraltar Approach W",             coords: [[-10,36],[-7,36],[-5.4,36]],                                                                  weight: 2, type: "major"     },
    // East Africa
    { name: "East Africa Coast N-S",            coords: [[-10,40],[-12,41],[-15,40],[-17,40],[-20,39],[-25,36],[-28,34],[-30,31]],                     weight: 2, type: "secondary" },
    { name: "Mozambique Channel",               coords: [[-10,40],[-15,42],[-20,44],[-25,44],[-30,33]],                                                weight: 2, type: "secondary" },
    // Cape Route
    { name: "Cape of Good Hope",                coords: [[-30,31],[-32,28],[-34,25],[-34,20],[-34,18],[-33,17],[-30,15]],                              weight: 2, type: "major"     },
    { name: "Cape — Atlantic N",                coords: [[-30,15],[-25,10],[-20,5],[-15,0],[-10,-5],[-5,-10],[0,-15],[5,-20],[10,-15],[15,-10],[20,-5]], weight: 2, type: "major"    },
    // Indian Ocean cross routes
    { name: "India W Coast",                    coords: [[8,77],[10,76],[12,75],[15,74],[18,73],[20,70],[18,65]],                                       weight: 2, type: "secondary" },
    { name: "Sri Lanka — Malacca",              coords: [[6,80],[5,82],[4,85],[3,88],[2,92],[2,96],[1.5,103]],                                          weight: 2, type: "major"     },
    { name: "Indian Ocean E-W",                 coords: [[0,45],[2,55],[3,65],[4,75],[4,80],[3,85],[2,92]],                                             weight: 1.5, type: "secondary" },
    // Malacca / Asia
    { name: "Strait of Malacca",                coords: [[1.5,103],[2,105],[3,106],[4,107],[5,108],[6,110],[8,111]],                                    weight: 3, type: "major"     },
    { name: "South China Sea N",                coords: [[8,111],[10,113],[14,115],[18,116],[22,115],[25,122]],                                         weight: 2, type: "major"     },
    { name: "South China Sea S",                coords: [[1.5,103],[3,106],[5,109],[8,111]],                                                            weight: 2, type: "secondary" },
    // Trans-Pacific
    { name: "Pacific N Trans",                  coords: [[25,122],[30,135],[35,145],[38,155],[40,170],[42,180],[40,-170],[38,-160],[35,-145],[32,-130],[25,-115]], weight: 1.5, type: "secondary" },
    // Trans-Atlantic
    { name: "N Atlantic Main",                  coords: [[51,-6],[50,-10],[48,-20],[45,-30],[42,-40],[38,-50],[35,-60],[30,-65],[25,-70],[20,-70]],       weight: 2, type: "major"     },
    { name: "S Atlantic",                       coords: [[-5,-35],[-10,-35],[-15,-37],[-20,-38],[-25,-40],[-30,-43],[-30,-15]],                        weight: 1.5, type: "secondary" },
    // North Sea / Europe
    { name: "English Channel",                  coords: [[51,-6],[51,-3],[51,0],[51,2],[52,4],[53,5],[54,8]],                                           weight: 2, type: "major"     },
    { name: "North Sea",                        coords: [[54,8],[55,10],[56,10],[57,11],[58,10],[59,8],[58,5],[56,4],[54,4]],                           weight: 1.5, type: "secondary" },
    // Additional routes — Arabian Sea, West Africa, Indian Ocean, Asia
    { name: "Arabian Sea W Cross",              coords: [[24,60],[20,58],[15,55],[10,52],[8,55]],                                                        weight: 2,   type: "major"     },
    { name: "Gulf of Oman",                     coords: [[26.5,56.5],[24,58],[22,59],[20,60],[18,58]],                                                   weight: 2,   type: "major"     },
    { name: "West Africa N",                    coords: [[14,-17],[10,-15],[5,-3],[0,3],[-5,10],[-10,14]],                                               weight: 1.5, type: "secondary" },
    { name: "West Africa S",                    coords: [[-10,14],[-15,12],[-20,13],[-25,15],[-30,17]],                                                  weight: 1.5, type: "secondary" },
    { name: "Indian Ocean Central",             coords: [[0,70],[3,65],[5,60],[5,55],[3,50],[0,45]],                                                     weight: 1.5, type: "secondary" },
    { name: "Bay of Bengal",                    coords: [[8,77],[10,82],[12,86],[14,88],[16,90],[18,92]],                                                 weight: 1.5, type: "secondary" },
    { name: "Australia NW",                     coords: [[-15,115],[-18,118],[-20,118],[-22,114],[-25,112]],                                             weight: 1.5, type: "secondary" },
    { name: "SE Asia W",                        coords: [[1.5,103],[0,100],[-2,98],[-4,96],[-6,94],[-8,92]],                                             weight: 2,   type: "major"     },
    { name: "Black Sea",                        coords: [[43,28],[43,32],[43,36],[43,40],[42,41]],                                                        weight: 1.5, type: "secondary" },
    { name: "Persian Gulf S",                   coords: [[24,55],[24,53],[24,51],[25,50],[26,49],[27,50],[27,52]],                                        weight: 1.5, type: "secondary" },
]

// Top-down carrier silhouette — white fill with nation-colour stroke for visibility on water
function _carrierSvg(color, size = 44) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 80" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.9))">
      <ellipse cx="20" cy="40" rx="8" ry="36" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.95"/>
      <polygon points="4,15 36,15 36,65 4,65" fill="#ffffff" stroke="${color}" stroke-width="1" opacity="0.85" transform="rotate(-8, 20, 40)"/>
      <rect x="26" y="25" width="6" height="18" rx="1" fill="#ffffff" stroke="${color}" stroke-width="1" opacity="1"/>
      <polygon points="12,8 20,2 28,8" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.95"/>
    </svg>`
}
// ARG — same top-down shape, slightly adjusted
function _argSvg(color, size = 36) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 80" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.8))">
      <ellipse cx="20" cy="40" rx="9" ry="32" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.92"/>
      <polygon points="5,18 35,18 35,62 5,62" fill="#ffffff" stroke="${color}" stroke-width="1" opacity="0.8" transform="rotate(-6, 20, 40)"/>
      <rect x="25" y="26" width="6" height="14" rx="1" fill="#ffffff" stroke="${color}" stroke-width="1" opacity="1"/>
      <polygon points="12,10 20,4 28,10" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.92"/>
    </svg>`
}
// Destroyer — compact top-down shape
function _destroyerSvg(color) {
    return `<svg width="20" height="20" viewBox="0 0 30 50" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,0.8))">
      <ellipse cx="15" cy="25" rx="5" ry="22" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.9"/>
      <rect x="19" y="16" width="4" height="10" rx="1" fill="#ffffff" stroke="${color}" stroke-width="1" opacity="1"/>
      <polygon points="10,6 15,1 20,6" fill="#ffffff" stroke="${color}" stroke-width="1.5" opacity="0.9"/>
    </svg>`
}

function makeCarrierDivIcon(csg, zoom) {
    const isFrench    = (csg.flagship || "").startsWith("FS ")
    const nationColor = isFrench ? "#002395" : "#1a3a6b"
    const escorts     = csg.escorts || []

    if (zoom < 8) {
        // Simple 44px icon + nation-colour glow ring
        const html = `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;width:60px;height:60px;border-radius:50%;background:radial-gradient(circle,${nationColor}66 0%,${nationColor}22 45%,transparent 72%);border:1.5px solid ${nationColor}88;top:-8px;left:-8px;pointer-events:none;"></div>
          ${_carrierSvg(nationColor, 44)}
        </div>`
        return L.divIcon({ html, className: "", iconSize: [44, 44], iconAnchor: [22, 22] })
    }

    // Formation view at zoom >= 8
    const formRadius = zoom >= 10 ? 80 : zoom >= 9 ? 60 : 40
    const N = Math.min(escorts.length, 8)
    const totalSize = formRadius * 2 + 100
    const cx = totalSize / 2
    const cy = formRadius + 26

    let escortHtml = ""
    for (let i = 0; i < N; i++) {
        const angle = (i / N) * 2 * Math.PI
        const ex = cx + Math.sin(angle) * formRadius - 10
        const ey = cy - Math.cos(angle) * formRadius - 10
        escortHtml += `<div style="position:absolute;left:${ex.toFixed(1)}px;top:${ey.toFixed(1)}px;opacity:0.7;">
          ${_destroyerSvg(nationColor)}
        </div>`
    }

    const glowColor = isFrench ? "#4444cc" : "#2255aa"
    const html = `<div style="position:relative;width:${totalSize}px;height:${totalSize}px;">
      ${escortHtml}
      <div style="position:absolute;left:${(cx-22).toFixed(1)}px;top:${(cy-22).toFixed(1)}px;">
        <div style="position:relative;">
          <div style="position:absolute;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle,${glowColor}55 0%,transparent 70%);top:-10px;left:-10px;pointer-events:none;"></div>
          ${_carrierSvg(nationColor, 44)}
        </div>
      </div>
      <div style="position:absolute;left:0;right:0;top:${(cy+26).toFixed(1)}px;text-align:center;">
        <div style="font-size:9px;font-weight:700;color:#fff;letter-spacing:0.05em;white-space:nowrap;text-shadow:0 1px 3px #000;">${csg.flagship || csg.name}</div>
        <div style="font-size:8px;color:#8899aa;white-space:nowrap;text-shadow:0 1px 2px #000;">${(csg.theater || "").substring(0, 30)}</div>
      </div>
    </div>`
    return L.divIcon({ html, className: "", iconSize: [totalSize, totalSize], iconAnchor: [cx, cy] })
}

function makeArgDivIcon(arg) {
    const color = "#1a3a6b"
    const html = `<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:48px;height:48px;border-radius:50%;border:1px solid ${color};opacity:0.25;top:-6px;left:-6px;"></div>
      ${_argSvg(color, 36)}
    </div>`
    return L.divIcon({ html, className: "", iconSize: [36, 36], iconAnchor: [18, 18] })
}

function makeDestroyerDivIcon() {
    const color = "#2d5fa6"
    const html = `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
      ${_destroyerSvg(color)}
    </div>`
    return L.divIcon({ html, className: "", iconSize: [24, 24], iconAnchor: [12, 12] })
}

// ── DeploymentCard panel ──────────────────────────────────────────────────────
const DeploymentCard = memo(function DeploymentCard({ deployment, zonesVisible, onToggleZones, onClose }) {
    const [imgError, setImgError] = useState(false)
    const [pos, setPos] = useState(() => ({
        x: typeof window !== "undefined" ? Math.max(12, window.innerWidth - 364) : 20,
        y: 60,
    }))
    const panelRef = useRef(null)
    const dragRef  = useRef({ dragging: false, ox: 0, oy: 0 })

    useEffect(() => {
        const onMove = (e) => {
            if (!dragRef.current.dragging) return
            setPos({ x: e.clientX - dragRef.current.ox, y: e.clientY - dragRef.current.oy })
        }
        const onUp = () => { dragRef.current.dragging = false }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup",   onUp)
        return () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup",   onUp)
        }
    }, [])

    if (!deployment) return null

    const isFrench = (deployment.flagship || "").startsWith("FS ")
    const nationFlag = isFrench ? "🇫🇷" : "🇺🇸"
    const imgUrl   = CARRIER_IMAGES[deployment.flagship]
    const zones    = CARRIER_ZONES[deployment.class] || CARRIER_ZONES.default
    const escorts  = deployment.escorts || []
    const airWing  = deployment.air_wing || []

    const SH  = { fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0d9488", marginBottom: 6 }
    const DIM = { color: "rgba(232,237,242,0.45)", flexShrink: 0, width: 72 }
    const SEP = { marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)" }

    return (
        <div
            ref={panelRef}
            style={{
                position:        "fixed",
                left:            pos.x,
                top:             pos.y,
                width:           344,
                maxHeight:       "calc(100vh - 120px)",
                background:      "rgba(14,20,32,0.92)",
                backdropFilter:  "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border:          "1px solid rgba(255,255,255,0.07)",
                borderRadius:    10,
                display:         "flex",
                flexDirection:   "column",
                overflow:        "hidden",
                zIndex:          2100,
                boxShadow:       "0 4px 24px rgba(0,0,0,0.6)",
                color:           "#e8edf2",
            }}
        >
            {/* Drag header */}
            <div
                onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    const rect = panelRef.current?.getBoundingClientRect()
                    if (!rect) return
                    dragRef.current.dragging = true
                    dragRef.current.ox = e.clientX - rect.left
                    dragRef.current.oy = e.clientY - rect.top
                }}
                style={{
                    padding:         "11px 16px",
                    borderBottom:    "1px solid rgba(255,255,255,0.07)",
                    display:         "flex",
                    alignItems:      "center",
                    justifyContent:  "space-between",
                    flexShrink:      0,
                    cursor:          "grab",
                    userSelect:      "none",
                }}
            >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#94a3b8" }}>
                    {nationFlag} {deployment.flagship || deployment.name}
                </span>
                <button
                    onClick={onClose}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1, padding: "0 2px" }}
                >✕</button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: "auto", maxHeight: "calc(100vh - 170px)", padding: "12px 14px" }}>

                {/* Class */}
                {deployment.class && (
                    <div style={{ fontSize: 11, color: "rgba(232,237,242,0.45)", marginBottom: 10 }}>{deployment.class}</div>
                )}

                {/* Ship image */}
                {imgUrl && !imgError ? (
                    <div style={{ marginBottom: 10, borderRadius: 4, overflow: "hidden", background: "#0a0e14" }}>
                        <img
                            src={imgUrl}
                            alt={deployment.flagship}
                            onError={() => setImgError(true)}
                            style={{ width: "100%", maxHeight: 180, objectFit: "cover", display: "block" }}
                        />
                    </div>
                ) : (
                    <div style={{ marginBottom: 10, height: 80, borderRadius: 4, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
                        <div dangerouslySetInnerHTML={{ __html: _carrierSvg(isFrench ? "#002395" : "#1a3a6b", 40) }} style={{ opacity: 0.5 }} />
                        <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)" }}>{deployment.flagship || deployment.name}</div>
                    </div>
                )}

                {/* Key fields */}
                {[
                    ["Theater",   deployment.theater],
                    ["Operation", deployment.operation],
                    ["Group",     deployment.name !== deployment.flagship ? deployment.name : null],
                ].map(([label, val]) => val ? (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6, alignItems: "flex-start" }}>
                        <span style={DIM}>{label}</span>
                        {label === "Operation" ? (
                            <span style={{ background: "rgba(255,179,0,0.12)", color: "#FFB300", border: "1px solid rgba(255,179,0,0.25)", padding: "1px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{val}</span>
                        ) : (
                            <span style={{ color: "#0d9488", fontWeight: 500 }}>{val}</span>
                        )}
                    </div>
                ) : null)}

                {/* Escorts */}
                {escorts.length > 0 && (
                    <div style={SEP}>
                        <div style={SH}>Escorts</div>
                        {escorts.map((e, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 10, color: "#e8edf2" }}>
                                <span dangerouslySetInnerHTML={{ __html: _destroyerSvg("#2d5fa6") }} />
                                {e}
                            </div>
                        ))}
                    </div>
                )}

                {/* Air wing */}
                {airWing.length > 0 && (
                    <div style={SEP}>
                        <div style={SH}>Air Wing</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {airWing.map((sq, i) => (
                                <span key={i} style={{ fontSize: 9, background: "rgba(255,255,255,0.07)", padding: "2px 6px", borderRadius: 4, color: "rgba(232,237,242,0.7)" }}>{sq}</span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Operational zones */}
                {zones && deployment._type === "csg" && (
                    <div style={SEP}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <div style={SH}>Operational Zones</div>
                            <button onClick={onToggleZones} style={{ fontSize: 9, background: zonesVisible ? "rgba(13,148,136,0.15)" : "rgba(255,255,255,0.07)", border: "none", color: zonesVisible ? "#0d9488" : "rgba(232,237,242,0.4)", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                                {zonesVisible ? "Hide" : "Show"}
                            </button>
                        </div>
                        {[
                            ["Exclusion (NFZ)",    `${zones.nfz_nm}nm / ${zones.nfz_km}km`,                            "#ef4444"],
                            ["Strike radius",      `${zones.strike_nm}nm / ${zones.strike_km.toLocaleString()}km`,     "#f97316"],
                            ["Extended (tanking)", `${zones.extended_nm}nm / ${zones.extended_km.toLocaleString()}km`, "#eab308"],
                            ["Aircraft",           zones.aircraft,                                                     "#94a3b8"],
                        ].map(([label, val, clr]) => (
                            <div key={label} style={{ display: "flex", gap: 8, fontSize: 10, marginBottom: 4 }}>
                                <span style={{ ...DIM, width: 120 }}>{label}</span>
                                <span style={{ color: clr }}>{val}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: 6, fontSize: 9, color: "rgba(232,237,242,0.3)", lineHeight: 1.5, fontStyle: "italic" }}>
                            Strike radius is unrefuelled combat radius. Extended assumes one tanker rendezvous.
                        </div>
                    </div>
                )}

                {/* Notes */}
                {deployment.notes && (
                    <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 5, fontSize: 10, color: "rgba(232,237,242,0.6)", lineHeight: 1.55 }}>
                        {deployment.notes}
                    </div>
                )}

                {/* Source */}
                <div style={{ marginTop: 10, fontSize: 9, color: "rgba(232,237,242,0.3)", lineHeight: 1.5 }}>
                    Source: {deployment.source}
                </div>

                {/* Approximate position banner */}
                <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.2)", borderRadius: 4, fontSize: 9, color: "#FFB300", fontWeight: 600 }}>
                    Position is approximate based on public OSINT reporting
                </div>
            </div>
        </div>
    )
})

// ── ImpactPanel ───────────────────────────────────────────────────────────────
// Shows raw GDELT event data on marker click. Claude analysis is on-demand only.
const _IMPACT_INFRA_CATS = {
    medical:     { symbol: "✚", color: "#FF4081" },
    security:    { symbol: "⬡", color: "#2979FF" },
    transport:   { symbol: "✈", color: "#00BCD4" },
    power:       { symbol: "⚡", color: "#FFD600" },
    military:    { symbol: "★", color: "#FF3D00" },
    comms:       { symbol: "◉", color: "#76FF03" },
    government:  { symbol: "▣", color: "#CE93D8" },
    chokepoints: { symbol: "◆", color: "#FF6D00" },
    utilities:   { symbol: "◈", color: "#80DEEA" },
}
const _POI_TAG_COLOR_IMPACT = { target: "#dc2626", suspect: "#d97706", associate: "#0d9488", unknown: "#6b7280" }

const ImpactPanel = memo(function ImpactPanel({ event, cachedAnalysis, analysing, onAnalyse, onClose, contextualItems, contextualLoading, contextualAdsbFlag, contextualNoCacheMsg, onEnableAdsb }) {
    const [ctxExpanded, setCtxExpanded] = useState(false)

    if (!event) return null
    const result = cachedAnalysis[event.id]
    const defaultX = typeof window !== "undefined" ? Math.max(12, window.innerWidth - 344) : 20
    const panelTitle = event.event_type || event.type || "GDELT Event"
    const radiusKm = { critical: 80, significant: 50, elevated: 30, low: 15 }[event.severity_tier] || 30

    // Dot color by match type
    const DOT_COLOR = { named: "#0d9488", consequence: "#6b7280", fallback: "#4b5563", poi: "#FFB300" }
    const DOT_LABEL = { named: "named in article", consequence: null, fallback: "nearest — no name found", poi: null }

    const allCtxItems = contextualItems || []
    const COLLAPSE_AT = 5
    const showAll = ctxExpanded || allCtxItems.length <= COLLAPSE_AT
    const visibleItems = showAll ? allCtxItems : allCtxItems.slice(0, COLLAPSE_AT)
    const hiddenCount = allCtxItems.length - COLLAPSE_AT

    return (
        <DraggablePanel
            title={panelTitle}
            defaultPosition={{ x: defaultX, y: 24 }}
            width={320}
            onClose={onClose}
        >
            <div style={{ padding: "14px 16px" }}>
                {/* Type + sub-type */}
                <div style={{ marginBottom: 12 }}>
                    <div style={{
                        display: "inline-block",
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        background: `${TYPE_COLOR[event.type] || "#666"}22`,
                        color: TYPE_COLOR[event.type] || "#666",
                        border: `1px solid ${TYPE_COLOR[event.type] || "#666"}44`,
                        padding: "2px 8px", borderRadius: 8, marginBottom: 6,
                    }}>
                        {event.type}
                    </div>
                    {event.subtype && (
                        <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{event.subtype}</div>
                    )}
                </div>

                {/* Key fields */}
                {[
                    ["Date",       event.date],
                    ["Actor",      event.actor],
                    ["Location",   event.location],
                    ["Fatalities", event.fatalities > 0 ? `${event.fatalities}` : "0"],
                    ["Coordinates", `${event.lat?.toFixed(4)}, ${event.lng?.toFixed(4)}`],
                ].map(([label, val]) => val != null && (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "#aaa", flexShrink: 0, width: 76 }}>{label}</span>
                        <span style={{ color: "#222", fontWeight: label === "Fatalities" && event.fatalities > 0 ? 700 : 400 }}>
                            {val}
                        </span>
                    </div>
                ))}

                {/* Description */}
                {event.description && (
                    <div style={{ marginTop: 10, padding: "9px 12px", background: "rgba(0,0,0,0.03)", borderRadius: 6, fontSize: 11, lineHeight: 1.65, color: "#444" }}>
                        {event.description}
                    </div>
                )}

                {/* ── LOADED CONTEXT ─────────────────────────────────────────── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                    <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.13em", color: "#0d9488", textTransform: "uppercase", marginBottom: 8 }}>
                        Loaded Context
                    </div>

                    {/* ADS-B banner */}
                    {contextualAdsbFlag && (
                        <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            marginBottom: 10, padding: "7px 10px",
                            background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.3)",
                            borderRadius: 5,
                        }}>
                            <div style={{ fontSize: 10, color: "#0d9488", lineHeight: 1.4 }}>
                                Live aircraft data available
                            </div>
                            <button
                                onClick={onEnableAdsb}
                                style={{
                                    fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
                                    padding: "3px 8px", borderRadius: 4,
                                    border: "none", background: "#0d9488", color: "#fff",
                                    cursor: "pointer", flexShrink: 0,
                                }}
                            >
                                Load ADS-B
                            </button>
                        </div>
                    )}

                    {contextualLoading && (
                        <div style={{ fontSize: 10, color: "#888", paddingBottom: 6 }}>Loading context…</div>
                    )}
                    {!contextualLoading && allCtxItems.length === 0 && (
                        <div style={{ fontSize: 10, color: "#999", lineHeight: 1.5 }}>
                            {contextualNoCacheMsg
                                ? contextualNoCacheMsg
                                : `No relevant infrastructure within ${radiusKm}km for this event type.`}
                        </div>
                    )}

                    {visibleItems.map((item, i) => {
                        const mt = item._match_type || (item._isPoi ? "poi" : "fallback")
                        const dotColor = DOT_COLOR[mt] || DOT_COLOR.fallback
                        const reasonSuffix = DOT_LABEL[mt]
                        const catCfg = _IMPACT_INFRA_CATS[item._category] || {}
                        const sym = item._isPoi ? "◎" : (catCfg.symbol || "◆")
                        const symColor = item._isPoi
                            ? (_POI_TAG_COLOR_IMPACT[item.tag] || "#FFB300")
                            : (catCfg.color || "#888")
                        const displayReason = reasonSuffix || item._reason || item._category || ""
                        return (
                            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 7 }}>
                                {/* Match-type dot */}
                                <span style={{
                                    width: 6, height: 6, borderRadius: "50%",
                                    background: dotColor, flexShrink: 0,
                                    marginTop: 4,
                                }} />
                                {/* Category symbol */}
                                <span style={{ color: symColor, flexShrink: 0, fontSize: 11, lineHeight: "14px", marginTop: 1 }}>{sym}</span>
                                <div style={{ fontSize: 10 }}>
                                    <div style={{ color: "#333", fontWeight: 600, lineHeight: 1.35 }}>{item.name || item.type || item._category}</div>
                                    <div style={{ color: "#888", lineHeight: 1.4 }}>
                                        {item._distance_km != null ? `${item._distance_km.toFixed(1)}km` : ""}
                                        {item._distance_km != null && displayReason ? " · " : ""}
                                        {displayReason}
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    {/* Collapse / expand row */}
                    {allCtxItems.length > COLLAPSE_AT && (
                        <button
                            onClick={() => setCtxExpanded(x => !x)}
                            style={{
                                marginTop: 4, fontSize: 10, color: "#0d9488",
                                background: "none", border: "none", cursor: "pointer",
                                padding: 0, letterSpacing: "0.02em",
                            }}
                        >
                            {ctxExpanded ? "Show less" : `Show all ${allCtxItems.length} items`}
                        </button>
                    )}
                </div>

                {/* Analyse button / result */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                    {!result && !analysing && (
                        <button
                            onClick={onAnalyse}
                            style={{
                                width: "100%", padding: "9px 0",
                                background: "#dc2626", color: "#fff",
                                border: "none", borderRadius: 6,
                                fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                                cursor: "pointer",
                            }}
                        >
                            Analyse
                        </button>
                    )}
                    {analysing && (
                        <div className="route-analysing" style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
                            Generating intelligence brief…
                        </div>
                    )}
                    {result?.error && (
                        <div style={{ fontSize: 11, color: "#b45309", background: "#fef9ec", padding: "8px 12px", borderRadius: 6 }}>
                            {result.error}
                        </div>
                    )}
                    {result?.markdown && (
                        <div className="route-brief">
                            <Markdown>{result.markdown}</Markdown>
                        </div>
                    )}
                </div>
            </div>
        </DraggablePanel>
    )
})

// ── NewsConflictPanel ─────────────────────────────────────────────────────────
// Shows raw news conflict marker data on click. Claude analysis on-demand only.
const NewsConflictPanel = memo(function NewsConflictPanel({ marker, cachedAnalysis, analysing, onAnalyse, onClose }) {
    if (!marker) return null
    const result = cachedAnalysis[marker.url]
    const confColor = marker.confidence === "high" ? "#22c55e" : "#FFB300"

    return (
        <DraggablePanel
            title="Conflict Event"
            defaultPosition={{ x: 420, y: 120 }}
            width={320}
            onClose={onClose}
        >
            <div style={{ padding: "14px 16px" }}>
                {/* Confidence badge */}
                <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: `${confColor}22`, color: confColor, border: `1px solid ${confColor}44`, padding: "2px 8px", borderRadius: 8 }}>
                        {marker.confidence} confidence
                    </span>
                </div>

                {/* Headline */}
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.45, color: "#111", marginBottom: 12 }}>
                    {marker.headline}
                </div>

                {/* Fields */}
                {[
                    ["Source",    marker.source],
                    ["Location",  marker.location],
                    ["Published", marker.published ? relativeTime(marker.published) : "—"],
                    ["Coords",    `${marker.lat?.toFixed(4)}, ${marker.lon?.toFixed(4)}`],
                ].map(([label, val]) => val && (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "#aaa", flexShrink: 0, width: 76 }}>{label}</span>
                        <span style={{ color: "#222" }}>{val}</span>
                    </div>
                ))}

                {/* Link */}
                {marker.url && (
                    <div style={{ marginTop: 8 }}>
                        <a href={marker.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#2979FF" }}>
                            View original article →
                        </a>
                    </div>
                )}

                <div style={{ marginTop: 8, fontSize: 9, color: "#bbb", fontStyle: "italic" }}>
                    RSS/news-sourced conflict event. Feed-based reporting may still require corroboration.
                </div>

                {/* Analyse button / result */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                    {!result && !analysing && (
                        <button onClick={onAnalyse} style={{ width: "100%", padding: "9px 0", background: "#FFB300", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer" }}>
                            Analyse
                        </button>
                    )}
                    {analysing && (
                        <div className="route-analysing" style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
                            Generating intelligence brief…
                        </div>
                    )}
                    {result?.error && (
                        <div style={{ fontSize: 11, color: "#b45309", background: "#fef9ec", padding: "8px 12px", borderRadius: 6 }}>
                            {result.error}
                        </div>
                    )}
                    {result?.markdown && (
                        <div className="route-brief">
                            <Markdown>{result.markdown}</Markdown>
                        </div>
                    )}
                </div>
            </div>
        </DraggablePanel>
    )
})

// ── RoutePanel ────────────────────────────────────────────────────────────────
// Displays route intelligence: safety score, Claude brief, conflict events,
// infrastructure exposure, congestion, and alternative route options.
// Positioned as a draggable floating panel inside mappage.jsx.
const RoutePanel = memo(function RoutePanel({
    routeInfo, routeAnalysis, routeAnalysing, onAnalyseRoute,
    loading, onClose,
    showAlternatives, onRequestAlternative, altRoutes,
    steps, corridorData,
}) {
    const score       = routeAnalysis?.safety_score ?? null
    const scoreColor  = score === null ? "#94a3b8"
        : score >= 80 ? "#22c55e"
        : score >= 50 ? "#FFD600"
        : "#ef4444"
    const scoreLabel  = score === null ? "—"
        : score >= 80 ? "LOW RISK"
        : score >= 50 ? "MODERATE"
        : "HIGH RISK"

    // Traffic delay: sum congestion travel time above free-flow
    const conflicts   = routeAnalysis?.conflict_events ?? []
    const infra       = routeAnalysis?.infrastructure   ?? []

    return (
        <DraggablePanel
            title="Route Planner"
            defaultPosition={{ x: 20, y: 120 }}
            width={340}
            onClose={onClose}
        >
            {/* Route metadata strip */}
            {routeInfo && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#222" }}>
                            {routeInfo.distance_km} km
                        </span>
                        <span style={{ fontSize: 11, color: "#888" }}>·</span>
                        <span style={{ fontSize: 11, color: "#666" }}>
                            ~{Math.round(routeInfo.duration_min)} min
                        </span>
                        {/* Safety score badge */}
                        {score !== null && (
                            <span style={{
                                marginLeft:    "auto",
                                fontSize:      9,
                                fontWeight:    700,
                                letterSpacing: "0.07em",
                                background:    `${scoreColor}22`,
                                color:         scoreColor,
                                border:        `1px solid ${scoreColor}55`,
                                padding:       "2px 8px",
                                borderRadius:  10,
                            }}>
                                {scoreLabel} · {score}/100
                            </span>
                        )}
                    </div>
                </div>
            )}

            <div style={{ padding: "14px 16px" }}>

                {/* Route loading skeleton */}
                {loading && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="route-analysing" style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                            Calculating route…
                        </div>
                        {[60, 90, 50, 80, 70].map((w, i) => (
                            <div key={i} style={{ height: 10, width: `${w}%`, background: "rgba(0,0,0,0.06)", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
                        ))}
                        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
                    </div>
                )}

                {/* Turn-by-turn steps */}
                {!loading && steps && steps.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#aaa", marginBottom: 8 }}>
                            Directions ({steps.length} steps)
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                            {steps.map((s, i) => (
                                <div key={i} style={{ fontSize: 10, display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                                    <span style={{ color: "#aaa", flexShrink: 0, width: 18, textAlign: "right" }}>{i + 1}.</span>
                                    <span style={{ color: "#555", flex: 1 }}>{s.instruction || s.type}</span>
                                    <span style={{ color: "#bbb", flexShrink: 0 }}>{s.distance_m >= 1000 ? `${(s.distance_m / 1000).toFixed(1)}km` : `${s.distance_m}m`}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Analyse Route button — shown when no analysis yet */}
                {!loading && routeInfo && !routeAnalysis && (
                    <div style={{ paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                        {!routeAnalysing ? (
                            <button
                                onClick={onAnalyseRoute}
                                style={{
                                    width: "100%", padding: "9px 0",
                                    background: "#f59e0b", color: "#fff",
                                    border: "none", borderRadius: 6,
                                    fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                                    cursor: "pointer",
                                }}
                            >
                                Analyse Route
                            </button>
                        ) : (
                            <div className="route-analysing" style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
                                Analysing route intelligence…
                            </div>
                        )}
                    </div>
                )}

                {/* Analysis results */}
                {!loading && routeAnalysis && (<>
                    {/* Error */}
                    {routeAnalysis.brief_error && !routeAnalysis.brief && (
                        <div style={{ background: "#fef9ec", border: "1px solid #f5dfa0", padding: "8px 12px", fontSize: 11, color: "#92400e", borderRadius: 6, marginBottom: 12 }}>
                            Intelligence brief unavailable — {routeAnalysis.brief_error}
                        </div>
                    )}

                    {/* Claude brief */}
                    {routeAnalysis.brief && (
                        <div className="route-brief" style={{ marginBottom: 16 }}>
                            <Markdown>{routeAnalysis.brief}</Markdown>
                        </div>
                    )}

                    {/* Conflict events */}
                    {conflicts.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#aaa", marginBottom: 8, paddingBottom: 6, borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: 14 }}>
                                Conflict Events Along Route ({conflicts.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {conflicts.slice(0, 8).map((ev, i) => (
                                    <div key={i} style={{ fontSize: 11, padding: "7px 10px", background: "rgba(0,0,0,0.03)", borderRadius: 6, borderLeft: `3px solid ${ev.fatalities > 0 ? "#ef4444" : "#94a3b8"}` }}>
                                        <div style={{ fontWeight: 600, color: "#222", marginBottom: 1 }}>{ev.type}</div>
                                        <div style={{ color: "#666" }}>{ev.location} · {ev.date}</div>
                                        <div style={{ color: "#888", marginTop: 1 }}>
                                            {ev.dist_km}km from route
                                            {ev.fatalities > 0 && <span style={{ color: "#ef4444", marginLeft: 6 }}>✕ {ev.fatalities}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Infrastructure exposure */}
                    {infra.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#aaa", marginBottom: 8, paddingBottom: 6, borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: 14 }}>
                                Infrastructure Exposure ({infra.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {infra.map((p, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, padding: "5px 8px", background: "rgba(0,0,0,0.03)", borderRadius: 5 }}>
                                        <span style={{ fontSize: 14, flexShrink: 0 }}>
                                            {p.type === "airport" ? "✈" : p.type === "port" ? "⚓" : "🏛"}
                                        </span>
                                        <span style={{ flex: 1, color: "#333" }}>{p.name}</span>
                                        <span style={{ color: "#aaa", flexShrink: 0 }}>{p.dist_km}km</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Corridor analysis (infrastructure layer) */}
                    {corridorData && (
                        <div style={{ marginBottom: 16, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#aaa", marginBottom: 10 }}>
                                Corridor Scores
                            </div>
                            {[
                                { label: "Cell Coverage",   val: corridorData.coverage_score },
                                { label: "Medical Access",  val: corridorData.medical_score  },
                            ].map(({ label, val }) => {
                                const c = val >= 70 ? "#22c55e" : val >= 40 ? "#FFD600" : "#ef4444"
                                return (
                                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                                        <span style={{ fontSize: 10, color: "#666", flex: 1 }}>{label}</span>
                                        <div style={{ flex: 2, height: 5, background: "rgba(0,0,0,0.06)", borderRadius: 3, overflow: "hidden" }}>
                                            <div style={{ width: `${val}%`, height: "100%", background: c, borderRadius: 3 }} />
                                        </div>
                                        <span style={{ fontSize: 10, color: c, fontWeight: 700, width: 28, textAlign: "right" }}>{val}</span>
                                    </div>
                                )
                            })}
                            {corridorData.chokepoint_count > 0 && (
                                <div style={{ fontSize: 10, color: "#FF6D00", marginTop: 4 }}>
                                    {corridorData.chokepoint_count} chokepoint{corridorData.chokepoint_count > 1 ? "s" : ""} along route
                                </div>
                            )}
                        </div>
                    )}
                </>)}

                {/* Alternative route button */}
                {!loading && routeAnalysis && ((score !== null && score < 60) || showAlternatives) && (
                    <div style={{ paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                        {!showAlternatives ? (
                            <button
                                onClick={onRequestAlternative}
                                style={{
                                    width:         "100%",
                                    padding:       "9px 0",
                                    background:    "#f59e0b",
                                    color:         "#fff",
                                    border:        "none",
                                    borderRadius:  6,
                                    fontSize:      11,
                                    fontWeight:    700,
                                    letterSpacing: "0.04em",
                                    cursor:        "pointer",
                                }}
                            >
                                Request Alternative Route
                            </button>
                        ) : altRoutes ? (
                            <div>
                                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#aaa", marginBottom: 8 }}>
                                    Route Options
                                </div>
                                {altRoutes.map((r, i) => (
                                    <div key={i} style={{ padding: "9px 12px", marginBottom: 6, background: "rgba(0,0,0,0.03)", borderRadius: 6, border: "1px solid rgba(0,0,0,0.07)" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "#222" }}>{r.label}</span>
                                            <span style={{ fontSize: 9, background: `${r.color}22`, color: r.color, padding: "1px 7px", borderRadius: 8, fontWeight: 700 }}>{r.tag}</span>
                                        </div>
                                        <div style={{ fontSize: 10, color: "#777", marginTop: 4 }}>
                                            {r.distance_km} km · ~{r.duration_min} min
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="route-analysing" style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
                                Fetching alternatives…
                            </div>
                        )}
                    </div>
                )}
            </div>
        </DraggablePanel>
    )
})

// ── InfraPanel ────────────────────────────────────────────────────────────────
// Shows raw OSM infrastructure data immediately on click. Claude analysis on-demand.
const InfraPanel = memo(function InfraPanel({ feature, category, cachedAnalysis, analysing, onAnalyse, onClose }) {
    if (!feature) return null
    const cfg  = INFRA_CATS[category] || { symbol: "●", color: "#aaa", label: category }
    const props = feature.properties || {}
    const [lon, lat] = feature.geometry.coordinates
    const cacheKey   = `${category}_${lat.toFixed(4)}_${lon.toFixed(4)}`
    const result     = cachedAnalysis[cacheKey]

    const USEFUL_TAGS = [
        "capacity", "beds", "voltage", "operator", "owner", "website", "phone",
        "military", "aerodrome", "iata", "icao", "power", "religion", "ref",
        "emergency", "healthcare", "healthcare:speciality", "jurisdiction",
        "addr:full", "addr:street", "addr:city", "addr:country",
    ]
    const visibleTags = USEFUL_TAGS.filter(t => props[t] != null && props[t] !== "" && t !== "operator")
    const hasEnrichment = props.enrich_notes || props.enrich_type || props.enrich_operator

    return (
        <div style={{
            position:       "absolute",
            top:            24,
            right:          16,
            width:          320,
            maxHeight:      "calc(100vh - 48px)",
            ...GLASS,
            background:     "rgba(255,255,255,0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border:         "1px solid rgba(0,0,0,0.10)",
            borderRadius:   12,
            display:        "flex",
            flexDirection:  "column",
            overflow:       "hidden",
            zIndex:         2005,
        }}>
            {/* Header */}
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#999" }}>
                    Infrastructure
                </span>
                <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#aaa", lineHeight: 1, padding: "0 2px" }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
                {/* Category badge */}
                <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}44`, padding: "2px 8px", borderRadius: 8 }}>
                        {cfg.symbol} {cfg.label}
                    </span>
                </div>

                {/* Facility name */}
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: "#111", marginBottom: 12 }}>
                    {props.name || props.official_name || "Unnamed Facility"}
                </div>

                {/* Core fields */}
                {[
                    ["Subtype",   props.subcategory],
                    ["Source",    props.source_dataset],
                    ["Owner",     props.owner],
                    ["Operator",  props.operator],
                    ["Precision", props.precision_score != null ? `${props.precision_score}` : null],
                    ["Coords",    `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
                ].map(([label, val]) => val && (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "#aaa", flexShrink: 0, width: 64 }}>{label}</span>
                        <span style={{ color: "#222" }}>{val}</span>
                    </div>
                ))}

                {/* OSM tag key-value list */}
                {visibleTags.length > 0 && (
                    <div style={{ marginTop: 10, padding: "9px 12px", background: "rgba(0,0,0,0.03)", borderRadius: 6 }}>
                        {visibleTags.map(t => (
                            <div key={t} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 4 }}>
                                <span style={{ color: "#aaa", flexShrink: 0, width: 80, textTransform: "capitalize" }}>{t.replace(":", " ")}</span>
                                <span style={{ color: "#333", wordBreak: "break-all" }}>{String(props[t])}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Military enrichment block */}
                {hasEnrichment && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(255,61,0,0.06)", borderRadius: 6, borderLeft: "3px solid #FF3D00" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#FF3D00", marginBottom: 6 }}>
                            Intel Enrichment
                        </div>
                        {props.enrich_type && (
                            <div style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 4 }}>
                                <span style={{ color: "#aaa", flexShrink: 0, width: 64 }}>Type</span>
                                <span style={{ color: "#222" }}>{props.enrich_type}</span>
                            </div>
                        )}
                        {props.enrich_operator && (
                            <div style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 4 }}>
                                <span style={{ color: "#aaa", flexShrink: 0, width: 64 }}>Operator</span>
                                <span style={{ color: "#222" }}>{props.enrich_operator}</span>
                            </div>
                        )}
                        {props.enrich_notes && (
                            <div style={{ fontSize: 11, color: "#444", lineHeight: 1.55, marginTop: 6 }}>
                                {props.enrich_notes}
                            </div>
                        )}
                        {props.enrich_source && (
                            <div style={{ fontSize: 9, color: "#aaa", marginTop: 6 }}>
                                Source: {props.enrich_source}
                            </div>
                        )}
                    </div>
                )}

                {/* Analysis result */}
                {result && (
                    <div style={{ marginTop: 14 }}>
                        {/* Conflict + news count badges */}
                        {(result.nearby_conflict_count != null || result.nearby_news_count != null) && (
                            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                                {result.nearby_conflict_count != null && (
                                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", background: `${result.nearby_conflict_count > 0 ? "#ef4444" : "#22c55e"}22`, color: result.nearby_conflict_count > 0 ? "#ef4444" : "#22c55e", border: `1px solid ${result.nearby_conflict_count > 0 ? "#ef4444" : "#22c55e"}44`, padding: "2px 8px", borderRadius: 8 }}>
                                        {result.nearby_conflict_count} conflict{result.nearby_conflict_count !== 1 ? "s" : ""} nearby
                                    </span>
                                )}
                                {result.nearby_news_count > 0 && (
                                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", background: "#FFB30022", color: "#FFB300", border: "1px solid #FFB30044", padding: "2px 8px", borderRadius: 8 }}>
                                        {result.nearby_news_count} news nearby
                                    </span>
                                )}
                            </div>
                        )}
                        {/* Wikipedia extract */}
                        {result.wikipedia && (
                            <div style={{ fontSize: 11, lineHeight: 1.65, color: "#555", marginBottom: 12, padding: "9px 12px", background: "rgba(0,0,0,0.02)", borderRadius: 6, borderLeft: `3px solid ${cfg.color}` }}>
                                {result.wikipedia}
                            </div>
                        )}
                        {/* Claude brief */}
                        {result.analysis && (
                            <div className="route-brief">
                                <Markdown>{result.analysis}</Markdown>
                            </div>
                        )}
                        {result.error && (
                            <div style={{ fontSize: 11, color: "#b45309", background: "#fef9ec", padding: "8px 12px", borderRadius: 6 }}>
                                {result.error}
                            </div>
                        )}
                    </div>
                )}

                {/* Analyse / loading */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.07)" }}>
                    {!result && !analysing && (
                        <button onClick={onAnalyse} style={{ width: "100%", padding: "9px 0", background: cfg.color, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer" }}>
                            Analyse
                        </button>
                    )}
                    {analysing && (
                        <div className="route-analysing" style={{ fontSize: 11, color: "#888", textAlign: "center" }}>
                            Generating intelligence brief…
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
})

// ── AisVesselPanel ────────────────────────────────────────────────────────────
const AisVesselPanel = memo(function AisVesselPanel({ vessel, onClose }) {
    if (!vessel) return null
    const typeColor = _AIS_TYPE_COLOR[vessel.ship_type] || _AIS_TYPE_COLOR.other
    const fields = [
        ["MMSI",        vessel.mmsi],
        ["Callsign",    vessel.callsign],
        ["Type",        vessel.ship_type],
        ["Speed",       vessel.speed != null ? `${vessel.speed} kn` : null],
        ["Heading",     vessel.heading != null ? `${Math.round(vessel.heading)}°` : null],
        ["Destination", vessel.destination],
        ["Position",    vessel.lat != null ? `${vessel.lat.toFixed(4)}, ${vessel.lon.toFixed(4)}` : null],
        ["Updated",     vessel.last_update ? new Date(vessel.last_update * 1000).toUTCString().replace(/.*,\s*/, "").replace(" GMT","Z") : null],
    ]
    return (
        <div style={{ position:"absolute", top:24, right:16, width:280, maxHeight:"calc(100vh - 48px)", background:"rgba(14,20,32,0.92)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, display:"flex", flexDirection:"column", overflow:"hidden", zIndex:2005, color:"#e8edf2" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)", flexShrink:0 }}>
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color: typeColor }}>AIS Vessel</span>
                <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, color:"rgba(232,237,242,0.5)", lineHeight:1 }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"12px 14px" }}>
                <div style={{ fontSize:15, fontWeight:700, color:"#e8edf2", marginBottom:12 }}>{vessel.name || `MMSI ${vessel.mmsi}`}</div>
                {fields.map(([label, val]) => val ? (
                    <div key={label} style={{ display:"flex", gap:8, fontSize:11, marginBottom:5 }}>
                        <span style={{ color:"rgba(232,237,242,0.45)", flexShrink:0, width:80 }}>{label}</span>
                        <span style={{ color:"#e8edf2", textTransform:"capitalize", wordBreak:"break-all" }}>{val}</span>
                    </div>
                ) : null)}
            </div>
        </div>
    )
})

// ── DsInfraPanel ──────────────────────────────────────────────────────────────
// Detail panel for dataset-sourced infrastructure items (airports, ports, power).
const DsInfraPanel = memo(function DsInfraPanel({ item, onClose }) {
    if (!item) return null
    const isAirport = item.infra_type === "airport"
    const isPort    = item.infra_type === "port"
    const isPower   = item.infra_type === "power"
    const color     = isAirport ? "#00BCD4" : isPort ? "#0277BD" : "#FFD600"
    const typeLabel = item.subcategory || (isAirport ? "Airport" : isPort ? "Port" : "Power Plant")
    const codeRows = Object.entries(item.codes || {}).filter(([, value]) => value)
    const rows = [
        ["Category",          item.category],
        ["Subtype",           item.subcategory || item.type?.replace?.(/_/g, " ")],
        ["Operator",          item.operator],
        ["Owner",             item.owner],
        ["Municipality",      item.municipality],
        ["Country",           item.country],
        ["Harbor Size",       item.harbor_size],
        ["Max Vessel",        item.max_vessel_size],
        ["Primary Fuel",      item.primary_fuel],
        ["Capacity",          item.capacity_mw ? `${item.capacity_mw} MW` : null],
        ["Commissioned",      item.commissioning_year],
        ["Precision",         item.precision_score != null ? `${item.precision_score}/100` : null],
        ["Source",            item.source_dataset],
        ["Coords",            `${item.lat?.toFixed(4)}, ${item.lon?.toFixed(4)}`],
    ]

    return (
        <div style={{
            position: "absolute", top: 24, right: 16, width: 300,
            maxHeight: "calc(100vh - 60px)",
            background: "rgba(10,14,20,0.92)", backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
            display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 2005,
        }}>
            {/* Header */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", background: `${color}22`, color, border: `1px solid ${color}44`, padding: "2px 7px", borderRadius: 3 }}>
                        {typeLabel}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{item.distance_km}km</span>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf2", lineHeight: 1.35, marginBottom: 10 }}>
                    {item.name || "Unnamed"}
                </div>
                {rows.filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 5 }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, width: 90 }}>{label}</span>
                        <span style={{ color: "#c8d4e0", wordBreak: "break-word" }}>{String(val)}</span>
                    </div>
                ))}
                {codeRows.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        {codeRows.map(([label, value]) => (
                            <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 5 }}>
                                <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, width: 90, textTransform: "uppercase" }}>{label}</span>
                                <span style={{ color: "#c8d4e0", wordBreak: "break-word" }}>{String(value)}</span>
                            </div>
                        ))}
                    </div>
                )}
                {isAirport && item.wikipedia && (
                    <a href={item.wikipedia} target="_blank" rel="noreferrer"
                        style={{ display: "inline-block", marginTop: 8, fontSize: 10, color: "#0d9488", textDecoration: "none" }}>
                        Wikipedia ↗
                    </a>
                )}
            </div>
        </div>
    )
})

// ── ChokepointPanel ────────────────────────────────────────────────────────────
const ChokepointPanel = memo(function ChokepointPanel({ cp, onClose }) {
    if (!cp) return null
    const statusColor = cp.current_status === "disrupted" ? "#ef4444"
        : cp.current_status === "elevated" ? "#f59e0b"
        : "#0d9488"
    const statusLabel = cp.current_status === "disrupted" ? "DISRUPTED"
        : cp.current_status === "elevated" ? "ELEVATED"
        : "NORMAL"

    return (
        <div style={{
            position: "absolute", top: 24, right: 16, width: 300,
            maxHeight: "calc(100vh - 60px)",
            background: "rgba(10,14,20,0.92)", backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
            display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 2005,
        }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: statusColor }}>
                        {statusLabel}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Chokepoint</span>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e8edf2", marginBottom: 8 }}>{cp.name}</div>
                <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.65, marginBottom: 12, borderLeft: `2px solid ${statusColor}44`, paddingLeft: 10 }}>
                    {cp.strategic_description}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>
                    Monitored Keywords
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
                    {cp.monitored_keywords?.map(kw => (
                        <span key={kw} style={{ fontSize: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "2px 6px", color: "#6b7a8d" }}>{kw}</span>
                    ))}
                </div>
                {cp.recent_headlines?.length > 0 && (
                    <>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: statusColor, marginBottom: 6 }}>
                            Recent Activity ({cp.match_count} matches / 48h)
                        </div>
                        {cp.recent_headlines.map((h, i) => (
                            <div key={i} style={{ fontSize: 10, color: "#8899aa", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", lineHeight: 1.5 }}>{h}</div>
                        ))}
                    </>
                )}
                {(!cp.recent_headlines?.length) && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>No recent activity detected.</div>
                )}
            </div>
        </div>
    )
})

// ── RouteInputPanel ───────────────────────────────────────────────────────────
// Floating glassmorphism geocoding panel for origin / waypoints / destination.
const RouteInputPanel = memo(function RouteInputPanel({
    fromInput, setFromInput, toInput, setToInput,
    fromSuggestions, setFromSuggestions, toSuggestions, setToSuggestions,
    waypoints, setWaypoints, routeOrigin, setRouteOrigin, routeDest, setRouteDest,
    geocode, onClear,
}) {
    const debounceRef = useRef({})

    const handleInput = (field, val, setter, sugSetter) => {
        setter(val)
        clearTimeout(debounceRef.current[field])
        if (val.length < 3) { sugSetter([]); return }
        debounceRef.current[field] = setTimeout(() => {
            geocode(val).then(sugSetter)
        }, 400)
    }

    const selectSuggestion = (field, place, setInput, setSugg) => {
        setInput(place.display_name)
        setSugg([])
        const lat = parseFloat(place.lat)
        const lon = parseFloat(place.lon)
        if (field === "from") setRouteOrigin({ lat, lon })
        else setRouteDest({ lat, lon })
    }

    return (
        <div style={{
            position: "absolute",
            top: 24, left: "50%",
            transform: "translateX(-50%)",
            width: 340, zIndex: 2004,
            ...GLASS,
            padding: "10px 14px",
        }}>
            {/* From */}
            <div style={{ marginBottom: 8, position: "relative" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>From</div>
                <input
                    value={fromInput}
                    onChange={e => handleInput("from", e.target.value, setFromInput, setFromSuggestions)}
                    onKeyDown={e => {
                        if (e.key !== "Enter") return
                        clearTimeout(debounceRef.current["from"])
                        if (fromSuggestions.length > 0) {
                            selectSuggestion("from", fromSuggestions[0], setFromInput, setFromSuggestions)
                        } else if (fromInput.length >= 3) {
                            geocode(fromInput).then(r => { if (r[0]) selectSuggestion("from", r[0], setFromInput, setFromSuggestions) })
                        }
                    }}
                    placeholder="Origin address or place…"
                    style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 6, padding: "7px 10px", fontSize: 11, color: "#fff",
                        outline: "none",
                    }}
                />
                {fromSuggestions.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "rgba(15,20,30,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, zIndex: 10, maxHeight: 160, overflowY: "auto" }}>
                        {fromSuggestions.map((p, i) => (
                            <div key={i} onClick={() => selectSuggestion("from", p, setFromInput, setFromSuggestions)}
                                style={{ padding: "7px 10px", fontSize: 11, color: "#ccc", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                {p.display_name}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Waypoints */}
            {waypoints.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <div style={{ flex: 1, fontSize: 11, color: "#FFD600", background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "6px 10px" }}>
                        WP {i + 1}: {w.label || `${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}`}
                    </div>
                    <button onClick={() => setWaypoints(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>×</button>
                </div>
            ))}

            {/* To */}
            <div style={{ marginBottom: 8, position: "relative" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>To</div>
                <input
                    value={toInput}
                    onChange={e => handleInput("to", e.target.value, setToInput, setToSuggestions)}
                    onKeyDown={e => {
                        if (e.key !== "Enter") return
                        clearTimeout(debounceRef.current["to"])
                        if (toSuggestions.length > 0) {
                            selectSuggestion("to", toSuggestions[0], setToInput, setToSuggestions)
                        } else if (toInput.length >= 3) {
                            geocode(toInput).then(r => { if (r[0]) selectSuggestion("to", r[0], setToInput, setToSuggestions) })
                        }
                    }}
                    placeholder="Destination address or place…"
                    style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 6, padding: "7px 10px", fontSize: 11, color: "#fff",
                        outline: "none",
                    }}
                />
                {toSuggestions.length > 0 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "rgba(15,20,30,0.97)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, zIndex: 10, maxHeight: 160, overflowY: "auto" }}>
                        {toSuggestions.map((p, i) => (
                            <div key={i} onClick={() => selectSuggestion("to", p, setToInput, setToSuggestions)}
                                style={{ padding: "7px 10px", fontSize: 11, color: "#ccc", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                {p.display_name}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Controls row */}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                    title="Add waypoint (click map after enabling)"
                    onClick={() => {}}
                    style={{ flex: 1, padding: "5px 0", fontSize: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 5, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
                >
                    + Waypoint
                </button>
                <button
                    onClick={onClear}
                    style={{ flex: 1, padding: "5px 0", fontSize: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer" }}
                >
                    Clear
                </button>
            </div>
        </div>
    )
})

// ── Annotation forms ──────────────────────────────────────────────────────────
function AnnotationPointForm({ data, onSave, onCancel }) {
    const [title, setTitle]                   = useState("")
    const [classification, setClassification] = useState("CONFIRMED")
    const [context, setContext]               = useState("")
    return (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", ...GLASS, width: 280, zIndex: 3100, padding: "16px 18px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#FFB300", marginBottom: 12 }}>New Point Annotation</div>
            <input
                autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Title *"
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 5, padding: "6px 9px", fontSize: 11, color: "#fff", outline: "none", marginBottom: 10 }}
            />
            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Classification</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {Object.entries(CLASSIF_COLOURS).map(([cls, clr]) => (
                        <button key={cls} onClick={() => setClassification(cls)} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", border: `1px solid ${classification === cls ? clr : "rgba(255,255,255,0.15)"}`, background: classification === cls ? `${clr}22` : "transparent", color: classification === cls ? clr : "rgba(255,255,255,0.4)" }}>{cls}</button>
                    ))}
                </div>
            </div>
            <textarea value={context} onChange={e => setContext(e.target.value)} placeholder="Context / notes (optional)" rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 5, padding: "6px 9px", fontSize: 11, color: "#fff", outline: "none", resize: "vertical", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onCancel} style={{ flex: 1, padding: "7px 0", fontSize: 10, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5, background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel</button>
                <button onClick={() => { if (!title.trim()) return; onSave(data.lat, data.lng, title.trim(), classification, context.trim()) }}
                    style={{ flex: 1, padding: "7px 0", fontSize: 10, fontWeight: 700, border: "1px solid #FFB300", borderRadius: 5, background: "rgba(255,179,0,0.15)", color: "#FFB300", cursor: "pointer" }}>Save</button>
            </div>
        </div>
    )
}

function AnnotationZoneForm({ data, onSave, onCancel }) {
    const [label, setLabel]     = useState("")
    const [type, setType]       = useState("Unknown")
    const [notes, setNotes]     = useState("")
    const [opacity, setOpacity] = useState(0.15)
    const area = zoneAreaKm2(data.vertices)
    return (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", ...GLASS, width: 280, zIndex: 3100, padding: "16px 18px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#FFB300", marginBottom: 12 }}>New Zone · {area.toFixed(0)} km²</div>
            <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Zone label *"
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 5, padding: "6px 9px", fontSize: 11, color: "#fff", outline: "none", marginBottom: 10 }}
            />
            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Zone type</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {Object.entries(ZONE_COLOURS).map(([t, clr]) => (
                        <button key={t} onClick={() => setType(t)} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", border: `1px solid ${type === t ? clr : "rgba(255,255,255,0.15)"}`, background: type === t ? `${clr}22` : "transparent", color: type === t ? clr : "rgba(255,255,255,0.4)" }}>{t}</button>
                    ))}
                </div>
            </div>
            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Fill opacity: {Math.round(opacity * 100)}%</div>
                <input type="range" min="0.02" max="0.5" step="0.01" value={opacity} onChange={e => setOpacity(+e.target.value)} style={{ width: "100%", accentColor: ZONE_COLOURS[type] || "#FFB300", cursor: "pointer" }} />
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 5, padding: "6px 9px", fontSize: 11, color: "#fff", outline: "none", resize: "vertical", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onCancel} style={{ flex: 1, padding: "7px 0", fontSize: 10, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5, background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel</button>
                <button onClick={() => { if (!label.trim()) return; onSave(data.vertices, label.trim(), type, notes.trim(), opacity) }}
                    style={{ flex: 1, padding: "7px 0", fontSize: 10, fontWeight: 700, border: "1px solid #FFB300", borderRadius: 5, background: "rgba(255,179,0,0.15)", color: "#FFB300", cursor: "pointer" }}>Save</button>
            </div>
        </div>
    )
}

function AnnotationLinkForm({ data, onSave, onCancel }) {
    const [rel, setRel]   = useState("Supports")
    const [note, setNote] = useState("")
    return (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", ...GLASS, width: 280, zIndex: 3100, padding: "16px 18px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#FFB300", marginBottom: 12 }}>New Link</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{ padding: "3px 8px", background: "rgba(255,255,255,0.07)", borderRadius: 4, fontSize: 9, color: "rgba(255,255,255,0.7)" }}>{data.source.title || data.source.label}</span>
                <span style={{ color: "#FFB300", fontSize: 14 }}>→</span>
                <span style={{ padding: "3px 8px", background: "rgba(255,255,255,0.07)", borderRadius: 4, fontSize: 9, color: "rgba(255,255,255,0.7)" }}>{data.target.title || data.target.label}</span>
            </div>
            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Relationship</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {["Commands", "Supports", "Opposes", "Enables", "Threatens"].map(r => (
                        <button key={r} onClick={() => setRel(r)} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", border: `1px solid ${rel === r ? "#FFB300" : "rgba(255,255,255,0.15)"}`, background: rel === r ? "rgba(255,179,0,0.15)" : "transparent", color: rel === r ? "#FFB300" : "rgba(255,255,255,0.4)" }}>{r}</button>
                    ))}
                </div>
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" rows={2}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 5, padding: "6px 9px", fontSize: 11, color: "#fff", outline: "none", resize: "vertical", marginBottom: 12 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onCancel} style={{ flex: 1, padding: "7px 0", fontSize: 10, border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5, background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel</button>
                <button onClick={() => onSave(data.source.id, data.target.id, rel, note.trim())}
                    style={{ flex: 1, padding: "7px 0", fontSize: 10, fontWeight: 700, border: "1px solid #FFB300", borderRadius: 5, background: "rgba(255,179,0,0.15)", color: "#FFB300", cursor: "pointer" }}>Save</button>
            </div>
        </div>
    )
}

// ── User Location Marker ───────────────────────────────────────────────────────

// ── AreaPopupPanel ─────────────────────────────────────────────────────────────
// Lightweight centered popup after heatmap click — shows top events + Analyse btn.
const AreaPopupPanel = memo(function AreaPopupPanel({ popup, analysing, onAnalyse, onClose }) {
    if (!popup) return null
    const { locationName, items } = popup
    return (
        <div style={{
            position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
            width: 380, maxHeight: "calc(100vh - 100px)",
            background: "rgba(10,14,20,0.92)", backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
            display: "flex", flexDirection: "column", overflow: "hidden",
            zIndex: 2010, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#e8edf2" }}>{locationName}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                        {items.length} event{items.length !== 1 ? "s" : ""} in area
                    </div>
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
                {items.map((item, i) => {
                    const tierColor = item.severity_tier === "critical" ? "#ef4444"
                        : item.severity_tier === "significant" ? "#f97316"
                        : item.severity_tier === "elevated" ? "#eab308" : "#0d9488"
                    return (
                        <div key={i} style={{ padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: tierColor, flexShrink: 0, marginTop: 5 }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: "#c8d4e0", lineHeight: 1.4 }}>
                                    {item.headline || item.title || (item.notes || "").slice(0, 100) || "Event"}
                                </div>
                                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
                                    {item.source || "Surface Pool"} · {item.date || ""}{item.location ? ` · ${item.location}` : ""}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                {analysing ? (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "6px 0" }}>
                        Generating intelligence brief…
                    </div>
                ) : (
                    <button
                        onClick={onAnalyse}
                        style={{
                            width: "100%", padding: "8px 0",
                            background: "rgba(41,121,255,0.2)", border: "1px solid rgba(41,121,255,0.4)",
                            borderRadius: 5, color: "#5b9bff",
                            fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer",
                        }}
                    >
                        Analyse Area
                    </button>
                )}
            </div>
        </div>
    )
})

// ── AreaAnalysisPanel ──────────────────────────────────────────────────────────
// Full enrichment panel rendered after Claude returns structured analysis.
const AreaAnalysisPanel = memo(function AreaAnalysisPanel({ analysis, locationName, onClose }) {
    if (!analysis) return null
    const { enrichment = {}, prose, error } = analysis
    if (error) return (
        <div style={{ position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)", width: 380, background: "rgba(10,14,20,0.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, padding: "14px 16px", zIndex: 2011, color: "#ef4444", fontSize: 11 }}>
            <button onClick={onClose} style={{ float: "right", background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            {error}
        </div>
    )
    const sevColor = enrichment.severity === "critical" ? "#ef4444"
        : enrichment.severity === "significant" ? "#f97316"
        : enrichment.severity === "elevated" ? "#eab308" : "#0d9488"
    return (
        <div style={{
            position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
            width: 400, maxHeight: "calc(100vh - 100px)",
            background: "rgba(10,14,20,0.93)", backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
            display: "flex", flexDirection: "column", overflow: "hidden",
            zIndex: 2011, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {enrichment.severity && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: `${sevColor}22`, color: sevColor, border: `1px solid ${sevColor}44`, padding: "2px 7px", borderRadius: 3 }}>
                            {enrichment.severity}
                        </span>
                    )}
                    {enrichment.event_classification && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                            {enrichment.event_classification}
                        </span>
                    )}
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf2", marginBottom: 10 }}>
                    {enrichment.primary_location?.name || locationName}
                </div>
                {(enrichment.aggressor_entities?.length > 0 || enrichment.affected_entities?.length > 0) && (
                    <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                        {enrichment.aggressor_entities?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Aggressor</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                    {enrichment.aggressor_entities.map(e => (
                                        <span key={e} style={{ fontSize: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 3, padding: "1px 6px", color: "#fca5a5" }}>{e}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {enrichment.affected_entities?.length > 0 && (
                            <div>
                                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Affected</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                    {enrichment.affected_entities.map(e => (
                                        <span key={e} style={{ fontSize: 10, background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 3, padding: "1px 6px", color: "#fde047" }}>{e}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {prose && (
                    <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.7 }}>
                        {prose.split(/\n\n+/).map((para, i) => (
                            <p key={i} style={{ margin: "0 0 10px" }}>{para.trim()}</p>
                        ))}
                    </div>
                )}
                {enrichment.highlight_chokepoints?.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#FF6D00", marginBottom: 4 }}>Referenced Chokepoints</div>
                        {enrichment.highlight_chokepoints.map(cp => (
                            <span key={cp} style={{ display: "inline-block", fontSize: 10, background: "rgba(255,109,0,0.12)", border: "1px solid rgba(255,109,0,0.3)", borderRadius: 3, padding: "1px 7px", marginRight: 4, marginBottom: 4, color: "#fb923c" }}>{cp}</span>
                        ))}
                    </div>
                )}
                {enrichment.affected_shipping_routes?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>Affected Shipping Routes</div>
                        {enrichment.affected_shipping_routes.map((r, i) => (
                            <div key={i} style={{ fontSize: 10, color: "#8899aa", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                <span style={{ color: "#c8d4e0" }}>{r.from} → {r.to}</span>
                                {r.reason && <span style={{ color: "rgba(255,255,255,0.25)" }}> — {r.reason}</span>}
                            </div>
                        ))}
                    </div>
                )}
                {enrichment.relevance_score != null && (
                    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Relevance</div>
                        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
                            <div style={{ height: "100%", width: `${enrichment.relevance_score}%`, background: sevColor, borderRadius: 2 }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#8899aa", fontWeight: 600 }}>{enrichment.relevance_score}</div>
                    </div>
                )}
            </div>
        </div>
    )
})

function UserLocationMarker() {
    const [pos,  setPos]  = useState(null)
    const [zoom, setZoom] = useState(5)

    useMapEvents({ zoomend: e => setZoom(e.target.getZoom()) })

    useEffect(() => {
        if (!navigator.geolocation) return
        const id = navigator.geolocation.watchPosition(
            p => setPos([p.coords.latitude, p.coords.longitude]),
            () => {},
            { enableHighAccuracy: false, timeout: 15000 }
        )
        return () => navigator.geolocation.clearWatch(id)
    }, [])

    if (!pos) return null

    // Outer ring size scales inversely with zoom (represents uncertainty radius)
    const ring = zoom >= 10 ? 24 : zoom >= 7 ? 40 : zoom >= 5 ? 60 : 80
    const half = ring / 2

    const icon = L.divIcon({
        className:  "",
        iconSize:   [ring, ring],
        iconAnchor: [half, half],
        html: `<div style="
            position:relative;width:${ring}px;height:${ring}px;
            display:flex;align-items:center;justify-content:center;
        ">
            <div style="
                position:absolute;width:${ring}px;height:${ring}px;border-radius:50%;
                border:1.5px solid rgba(59,130,246,0.35);
                animation:akiliUserLocPulse 2.4s ease-in-out infinite;
            "></div>
            <div style="
                width:10px;height:10px;border-radius:50%;
                background:#3b82f6;border:2px solid #fff;
                box-shadow:0 0 8px rgba(59,130,246,0.9);
                position:relative;z-index:1;
            "></div>
        </div>`,
    })

    return <Marker position={pos} icon={icon} interactive={false} />
}

// ── POI floating card overlay ─────────────────────────────────────────────────
function PoiOverlay({ poi, onClose, apiBase }) {
    const map = useMap()
    const [pos, setPos] = useState(null)

    useEffect(() => {
        const update = () => {
            try {
                const p = map.latLngToContainerPoint([poi.lat, poi.lon])
                setPos({ x: p.x, y: p.y })
            } catch {}
        }
        update()
        map.on("move zoom moveend zoomend", update)
        return () => map.off("move zoom moveend zoomend", update)
    }, [map, poi.lat, poi.lon])

    if (!pos) return null

    const color = _POI_TAG_COLOR[poi.tag] || "#6b7280"
    const sz = map.getSize()
    const cardW = 200
    const cardX = pos.x + 18 + cardW > sz.x ? pos.x - cardW - 18 : pos.x + 18
    const cardY = Math.max(10, Math.min(pos.y - 60, sz.y - 110))

    const lineX2 = cardX + (cardX > pos.x ? 0 : cardW)
    const lineY2 = cardY + 40

    return createPortal(
        <>
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 499 }}>
                <line x1={pos.x} y1={pos.y} x2={lineX2} y2={lineY2}
                    stroke={color} strokeWidth="2" strokeDasharray="6 3"
                    style={{ animation: "poi-dash 1s linear infinite", strokeDashoffset: 0 }} />
            </svg>
            <div style={{
                position: "absolute", left: cardX, top: cardY, width: cardW,
                zIndex: 500, background: "rgba(14,20,32,0.97)",
                border: `1px solid ${color}`, borderRadius: 6,
                padding: "10px 12px", fontFamily: "'Inter','Segoe UI',sans-serif",
                boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 12px ${color}33`,
            }}>
                <button onClick={onClose} style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 14 }}>
                    {poi.photo_path
                        ? <img src={`${apiBase}/api/poi/${poi.id}/photo`} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: `1px solid ${color}`, flexShrink: 0 }} alt="" />
                        : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <svg width="16" height="20" viewBox="0 0 14 18" fill="none"><circle cx="7" cy="5" r="4" fill={color}/><path d="M1 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>
                          </div>
                    }
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{poi.name}</div>
                        {poi.tag && <div style={{ fontSize: 9, color, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginTop: 2 }}>{poi.tag}</div>}
                    </div>
                </div>
                {(poi.home_address || poi.location) && (
                    <div style={{ fontSize: 10, color: "rgba(232,237,242,0.45)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {poi.home_address || poi.location}
                    </div>
                )}
            </div>
        </>,
        map.getContainer()
    )
}

export default function MapPage({
    events,
    selected,
    onSelect,
    activeSituation,
    searchTarget,
    profile,            // Mission Profile object — passed to all Claude calls
    onSituationAnnotationsChange,
    onConflictEventsToggle,
    // New props for redesigned UI
    layersPanelOpen,   // bool — when false the layers panel is hidden
    onLayersPanelClose, // () => void — called when panel X is clicked
    initialActive,      // object — initial layer state (from workspace config)
    onActiveChange,     // (active) => void — called when layers change
    onViewportChange,   // (center, zoom) => void — called on map move
    surfaceItems = [],  // items from /api/surface — always rendered, no toggle needed
    onSurfaceItemClick, // (item) => void — opens detail panel
    contextualLayers = null, // { layers: {key:bool,...} } — driven by selected surface item
    selectedSurface  = null, // currently selected surface item — drives severity circle
    surfaceContext   = null, // { infra, item } — loaded by detail panel
    surfaceEnrichment = null, // { item, enrichment, prose } — loaded by detail panel
    theaterDrawing   = false, // bool — when true, map accepts clicks to draw theater polygon
    onTheaterDrawEnd = null,  // (polygon: [[lat,lon],...] | null) => void
}) {
    const [zoom, setZoom] = useState(6)
    const autoActivatedRef = useRef({})
    const manualLayerOverridesRef = useRef({})
    const LAYER_STORAGE_KEY = "akili_layer_state"
    const [active, setActive] = useState(() => {
        const defaults = {
            // All layers OFF by default. Only heatmap is on.
            airports: false,
            ports: false,
            powerPlants: false,
            hospitals: false,
            police: false,
            military: false,
            pipelines: false,
            cables: false,
            shippingLanes: false,
            chokepoints: false,
            heatmap: true,
            conflictZones: false,
            eez: false,
            borders: false,
            cityLabels: false,
            newsConflicts: false,
            infra: false,
            airspace: false,
            news: false,
            adsb: false,
            adsbLabels: false,
            route: false,
            tv: false,
            webcams: false,
            satellite: false,
            annotate: false,
            sattrack: false,
            missileAlerts: false,
            earthquakeEvents: false,
            imbPiracy: false,
            poi: false,
            deployments: false,
            aisVessels: false,
        }
        let stored = {}
        try { stored = JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY) || "{}") } catch {}
        return { ...defaults, ...stored, ...(initialActive || {}) }
    })
    const [activeWebcam, setActiveWebcam] = useState(null)
    const [contextualAnalysis, setContextualAnalysis] = useState(false)
    const [manualOverrides, setManualOverrides] = useState({})

    // contextualLayers prop is accepted for API compatibility but no longer
    // auto-activates global layer toggles. Infrastructure loads contextually
    // via the event-selection system below. eslint-disable-next-line no-unused-vars
    void contextualLayers

    useEffect(() => {
        try { localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(active)) } catch {}
        onActiveChange?.(active)
    }, [active, onActiveChange])

    // ── Satellite layer state ─────────────────────────────────────────────────
    const [satelliteSearching, setSatelliteSearching] = useState(false)
    const [satelliteResults, setSatelliteResults]     = useState([])    // raw items from backend
    const [satelliteSelected, setSatelliteSelected]   = useState({})    // { itemId: true } shown on map
    const [satelliteInfoItem, setSatelliteInfoItem]   = useState(null)  // item in info panel
    const [maxCloud, setMaxCloud]                     = useState(20)
    const [daysBack, setDaysBack]                     = useState(60)
    const [satelliteError, setSatelliteError]         = useState(null)
    const [satelliteAuthMode, setSatelliteAuthMode]   = useState("public") // public | copernicus_oauth
    const [satelliteAuthError, setSatelliteAuthError] = useState(null)
    const satelliteMoveTimer = useRef(null)

    // ── Annotation state ──────────────────────────────────────────────────────
    const [annotationMode, setAnnotationMode]   = useState(null)   // 'point'|'zone'|'link'|null
    const [annotations, setAnnotations]         = useState({ points: [], zones: [], links: [] })
    const [zoneInProgress, setZoneInProgress]   = useState([])     // [[lat,lng],...]
    const [linkSource, setLinkSource]           = useState(null)   // id of first annotation for linking
    const [annotationForm, setAnnotationForm]   = useState(null)   // {type, data} open form
    const [selectedAnnotation, setSelectedAnnotation] = useState(null)
    const [annotationToast, setAnnotationToast] = useState(null)

    // ── Theater draw state ────────────────────────────────────────────────────
    const [theaterPts, setTheaterPts] = useState([])  // [[lat,lon],...] in progress

    // ── Sat Track state ───────────────────────────────────────────────────────
    const [satTLEs, setSatTLEs]               = useState([])
    const [satPositions, setSatPositions]     = useState([])
    const [satTrackInterval, setSatTrackInterval] = useState(null)
    const [selectedSat, setSelectedSat]       = useState(null)
    const [satLoading, setSatLoading]         = useState(false)

    const [tanzaniaGeo, setTanzaniaGeo]         = useState(null)
    const [allCountriesGeo, setAllCountriesGeo] = useState(null)
    const [cableGeo, setCableGeo]               = useState({ cables: [], points: [], associations: {} })
    const [selectedCountry, setSelectedCountry] = useState(null)
    const [countryData, setCountryData]         = useState(null)
    const [countryLoading, setCountryLoading]   = useState(false)
    const [conflictZones, setConflictZones]         = useState([])
    const [conflictZonesLoading, setConflictZonesLoading] = useState(false)
    const [viewportBounds, setViewportBounds]   = useState(null)

    // ── UI state ──────────────────────────────────────────────────────────────
    const [hoveredWidget, setHoveredWidget] = useState(null)
    const [markerBatch, setMarkerBatch] = useState(0)   // incremented on each fetch → replays marker CSS anim
    const [toastInfo, setToastInfo]     = useState(null) // {count, key}

    const [adsbCount, setAdsbCount]             = useState(0)
    const [adsbRefreshRate, setAdsbRefreshRate] = useState(10)   // applied rate
    const [adsbSliderVal, setAdsbSliderVal]     = useState(10)   // displayed slider value
    const [adsbLive, setAdsbLive]               = useState(false)
    const [adsbActivateKey, setAdsbActivateKey] = useState(0)
    const [sourceStatus, setSourceStatus]       = useState({})
    const [mapType, setMapType]                 = useState("satellite")
    const [satLabels, setSatLabels]             = useState(false)

    // ── Pipeline GeoJSON lines ────────────────────────────────────────────────
    const [pipelineGeoData, setPipelineGeoData] = useState([])

    // ── Deployments layer ─────────────────────────────────────────────────────
    const [deploymentsData, setDeploymentsData]               = useState(null)
    const [selectedDeployment, setSelectedDeployment]         = useState(null)
    const [deploymentZonesVisible, setDeploymentZonesVisible] = useState(true)
    const [hoveredDeploymentName, setHoveredDeploymentName]   = useState(null)

    // ── AIS live vessel tracking ───────────────────────────────────────────────
    const [aisVessels, setAisVessels]         = useState([])
    const [aisStatus, setAisStatus]           = useState(null)  // {connected, error, vessel_count}
    const [selectedAisVessel, setSelectedAisVessel] = useState(null)
    const aisIntervalRef                      = useRef(null)

    // ── Shipping lanes ─────────────────────────────────────────────────────────
    const [shippingLaneData, setShippingLaneData] = useState({ neFeatures: [], namedRoutes: [] })

    // ── Impact panel (on-demand event analysis) ───────────────────────────────
    const [impactEvent, setImpactEvent]         = useState(null)
    const [impactAnalysisCache, setImpactAnalysisCache] = useState({})   // keyed by event_id
    const [impactAnalysing, setImpactAnalysing] = useState(false)

    // ── Contextual intelligence (event-triggered infrastructure + POI) ─────────
    // Items loaded when a conflict event is selected. Cleared on deselect.
    const [contextualItems, setContextualItems] = useState([])  // [{...feature, _category, _distance_km, _reason, _match_type, _isPoi?}]
    const [contextualLoading, setContextualLoading] = useState(false)
    const [contextualAdsbFlag, setContextualAdsbFlag] = useState(null)  // {adsb_center, adsb_radius_km} or null
    const [contextualNoCacheMsg, setContextualNoCacheMsg] = useState(null)
    const contextualCancelRef = useRef(null)

    // Map event type → infra categories to load (strict logical relevance)
    const CONTEXT_INFRA_CATS = {
        explosion:   ["medical", "military", "security"],
        armed_clash: ["medical", "military", "security"],
        aviation:    ["transport"],
        maritime:    ["transport", "chokepoints"],
        earthquake:  ["medical", "transport", "power"],
        medical:     ["medical"],
        energy:      ["power", "transport"],
        protest:     [],
    }

    const CONTEXT_REASONS = {
        explosion:   { medical: "nearest trauma centre to explosion", military: "response/origin base", security: "law enforcement response" },
        armed_clash: { medical: "casualty treatment", military: "response/origin base", security: "law enforcement proximity" },
        aviation:    { transport: "affected airspace / divert route" },
        maritime:    { transport: "nearest port", chokepoints: "strategic waterway" },
        earthquake:  { medical: "damage / casualty treatment", transport: "relief access route", power: "grid disruption risk" },
        medical:     { medical: "healthcare facility within radius" },
        energy:      { power: "critical energy infrastructure", transport: "offshore logistics port" },
    }

    // Relevance radius (km) by severity tier
    const RELEVANCE_RADIUS_KM = { critical: 80, significant: 50, elevated: 30, low: 15 }

    function classifyEventType(event) {
        const t = (event.type || event.event_type || "").toLowerCase()
        const s = (event.sub_event_type || event.subtype || "").toLowerCase()
        if (t.includes("explosion") || t.includes("blast") || s.includes("explosion") || s.includes("air/drone") || s.includes("missile")) return "explosion"
        if (t.includes("battle") || t.includes("armed clash") || s.includes("armed clash") || s.includes("non-state armed group")) return "armed_clash"
        if (t.includes("aviation") || s.includes("aviation")) return "aviation"
        if (t.includes("maritime") || s.includes("maritime")) return "maritime"
        if (t.includes("earthquake") || s.includes("earthquake")) return "earthquake"
        if (t.includes("medical") || s.includes("medical")) return "medical"
        if (t.includes("protest") || t.includes("politic") || s.includes("protest") || s.includes("demonstration")) return "protest"
        if (t.includes("energy") || s.includes("pipeline") || s.includes("energy")) return "energy"
        return "armed_clash"  // safe default for violence/unclassified
    }

    function eventRadiusBbox(lat, lon, km) {
        const dLat = km / 111
        const dLon = km / (111 * Math.cos(lat * Math.PI / 180))
        return [lat - dLat, lon - dLon, lat + dLat, lon + dLon]
    }

    function checkPoiContextual(pois, event, radiusKm, tier) {
        const results = []
        ;(pois || []).forEach(poi => {
            const locs = []
            if (poi.home_lat && poi.home_lon) locs.push({ lat: +poi.home_lat, lon: +poi.home_lon })
            if (poi.work_lat && poi.work_lon) locs.push({ lat: +poi.work_lat, lon: +poi.work_lon })
            for (const loc of locs) {
                const dist = haversineKm(+event.lat, +(event.lng || event.lon), loc.lat, loc.lon)
                if (dist > radiusKm) continue
                const tag = poi.tag || "unknown"
                let qualifies = false
                if (tag === "target" || tag === "suspect") qualifies = true
                else if (tag === "associate" && (tier === "elevated" || tier === "significant" || tier === "critical")) qualifies = true
                else if (tag === "unknown" && dist <= 10 && tier === "critical") qualifies = true
                if (qualifies) {
                    results.push({ ...poi, lat: loc.lat, lon: loc.lon, _isPoi: true, _distance_km: dist, _reason: `${tag} within ${dist.toFixed(0)}km of ${tier} event` })
                    break  // one entry per POI
                }
            }
        })
        return results
    }

    // Not memoized — plain async function. poiData is accessed via closure at
    // call time (correct value for the render in which the click occurred).
    async function fetchContextualItems(event) {
        if (contextualCancelRef.current) contextualCancelRef.current()
        let cancelled = false
        contextualCancelRef.current = () => { cancelled = true }

        setContextualItems([])
        setContextualAdsbFlag(null)
        setContextualNoCacheMsg(null)
        setContextualLoading(true)

        const tier = event.severity_tier || "low"
        const radiusKm = RELEVANCE_RADIUS_KM[tier] || 30

        try {
            const resp = await fetch(`${API}/events/context`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    event_id:   event.id,
                    lat:        +event.lat,
                    lon:        +(event.lng || event.lon),
                    event_type: event.event_type || event.type || "",
                    sub_event_type: event.sub_event_type || event.subtype || "",
                    description: event.description || event.notes || "",
                    severity_tier: tier,
                }),
            })
            if (cancelled) return
            const data = await resp.json()
            if (cancelled) return

            // Tag backend items with _match_type already set by backend
            const infraItems = (data.items || []).map(it => ({
                ...it,
                _match_type: it._match_type || "fallback",
            }))

            // Client-side POI proximity check (kept local — no backend needed)
            const poiItems = checkPoiContextual(poiData, event, radiusKm, tier)
                .map(p => ({ ...p, _match_type: "poi" }))

            setContextualItems([...infraItems, ...poiItems])
            if (data.adsb_recommended) {
                setContextualAdsbFlag({
                    adsb_center:    data.adsb_center,
                    adsb_radius_km: data.adsb_radius_km,
                })
            }
            if (data.no_cache_message) {
                setContextualNoCacheMsg(data.no_cache_message)
            }
        } catch {
            if (!cancelled) setContextualItems([])
        } finally {
            if (!cancelled) setContextualLoading(false)
        }
    }

    // Clear contextual items when event is deselected
    useEffect(() => {
        if (!impactEvent) {
            if (contextualCancelRef.current) contextualCancelRef.current()
            setContextualItems([])
            setContextualLoading(false)
            setContextualAdsbFlag(null)
            setContextualNoCacheMsg(null)
        }
    }, [impactEvent])

    // ── Route state ───────────────────────────────────────────────────────────
    const [routeOrigin, setRouteOrigin]         = useState(null)   // {lat, lon}
    const [routeDest, setRouteDest]             = useState(null)   // {lat, lon}
    const [routeGeo, setRouteGeo]               = useState(null)   // [[lon,lat],…] from OSRM
    const [routeInfo, setRouteInfo]             = useState(null)   // {distance_km, duration_min, steps}
    const [routeAnalysis, setRouteAnalysis]     = useState(null)   // /route/analyse response
    const [routeAnalysing, setRouteAnalysing]   = useState(false)  // analysis in-flight
    const [routeLoading, setRouteLoading]       = useState(false)
    const [showAlternatives, setShowAlternatives] = useState(false)
    const [altRoutes, setAltRoutes]             = useState(null)
    const [routeSteps, setRouteSteps]           = useState([])

    // ── Route input (geocoding) ────────────────────────────────────────────────
    const [fromInput, setFromInput]             = useState("")
    const [toInput, setToInput]                 = useState("")
    const [fromSuggestions, setFromSuggestions] = useState([])
    const [toSuggestions, setToSuggestions]     = useState([])
    const [waypoints, setWaypoints]             = useState([])   // [{lat,lon,label}, …]
    const [tempMarker, setTempMarker]           = useState(null)
    const [activeField, setActiveField]         = useState(null) // "from" | "to" | null

    // ── Infrastructure ────────────────────────────────────────────────────────
    const [infraData, setInfraData]             = useState({})   // keyed by category
    const [infraLoading, setInfraLoading]       = useState({})   // per-category loading flag
    const [corridorData, setCorridorData]       = useState(null)

    // ── News conflicts ────────────────────────────────────────────────────────
    const [newsConflictsData, setNewsConflictsData] = useState([])
    const [newsConflictsCount, setNewsConflictsCount] = useState(0)   // global count for badge
    const [newsConflictSelected, setNewsConflictSelected] = useState(null)   // clicked marker
    const [newsConflictAnalysisCache, setNewsConflictAnalysisCache] = useState({})  // url → result
    const [newsConflictAnalysing, setNewsConflictAnalysing] = useState(false)
    const [surveillanceAlerts, setSurveillanceAlerts] = useState([])

    // ── POI layer ─────────────────────────────────────────────────────────────
    const [poiData, setPoiData]                 = useState([])
    const [selectedPoiMarker, setSelectedPoiMarker] = useState(null)
    const poiMapRef                             = useRef(null)
    const prePOILayersRef                       = useRef(null)

    // ── Contextual borders + EEZ ──────────────────────────────────────────────
    const [ctxBorderFeatures, setCtxBorderFeatures] = useState([])   // GeoJSON features to highlight
    const [ctxBorderVisible,  setCtxBorderVisible]  = useState(false) // false = fading out
    const [eezGeo,            setEezGeo]            = useState(null)  // EEZ FeatureCollection
    const [ctxEezFeatures,    setCtxEezFeatures]    = useState([])    // EEZ features to show
    const ctxBorderTimerRef = useRef(null)
    // Profile-driven persistent borders (no 30s fade; stays while profile active)
    const [profileBorderFeatures, setProfileBorderFeatures] = useState([])

    // ── Infrastructure panel (on-demand analysis) ─────────────────────────────
    const [infraSelected, setInfraSelected]             = useState(null)   // {feature, category}
    const [infraAnalysisCache, setInfraAnalysisCache]   = useState({})     // keyed {category}_{lat4}_{lon4}
    const [infraAnalysing, setInfraAnalysing]           = useState(false)

    // ── Dataset infrastructure (airports / ports / power plants) ─────────────
    const [dsData, setDsData]               = useState({ airport: [], port: [], power: [] })
    const [dsLoading, setDsLoading]         = useState({ airport: false, port: false, power: false })
    const [dsSelected, setDsSelected]       = useState(null)   // clicked dataset item
    // ── Ports: dedicated bbox-based layer (separate from radius dsData) ────────
    const [portsData, setPortsData]         = useState([])
    const portsLastBboxRef                  = useRef(null)
    const [chokepointData, setChokepointData] = useState([])
    const [chokepointSelected, setChokepointSelected] = useState(null)
    const dsLastBoundsRef = useRef({})

    // ── Area click popup (heatmap / low zoom) ─────────────────────────────────
    const [areaPopup, setAreaPopup]         = useState(null)   // {lat, lon, locationName, items}
    const [areaAnalysis, setAreaAnalysis]   = useState(null)   // enrichment + prose from Claude
    const [areaAnalysing, setAreaAnalysing] = useState(false)

    const mapContainerRef        = useRef(null)
    const mapRef                 = useRef(null)
    const airportsLayerRef       = useRef(null)
    const portsLayerRef          = useRef(null)
    const powerPlantsLayerRef    = useRef(null)
    const hospitalsLayerRef      = useRef(null)
    const policeLayerRef         = useRef(null)
    const militaryLayerRef       = useRef(null)
    const pipelinesLayerRef      = useRef(null)
    const cablesLayerRef         = useRef(null)
    const shippingLanesLayerRef  = useRef(null)
    const chokepointsLayerRef    = useRef(null)
    const heatmapLayerRef        = useRef(null)
    const conflictZonesLayerRef  = useRef(null)
    const eezLayerRef            = useRef(null)
    const bordersLayerRef        = useRef(null)
    const cityLabelsLayerRef     = useRef(null)
    const newsConflictsLayerRef  = useRef(null)
    const enrichmentLayerRef     = useRef(null)
    const contextBordersLayerRef = useRef(null)
    const contextEezLayerRef     = useRef(null)
    const viewportBoundsRef      = useRef(null)
    const prevBoundsRef          = useRef(null)
    const infraLastBoundsRef     = useRef({})    // per-category last-fetched bounds
    const newsConflictsDebounceRef = useRef(null) // debounce timer (unused, kept for cleanup)
    const tempMarkerTimerRef     = useRef(null)

    const dsActive = useMemo(() => ({
        airport: !!active.airports,
        port: !!active.ports,
        power: !!active.powerPlants,
        chokepoints: !!active.chokepoints,
    }), [active.airports, active.ports, active.powerPlants, active.chokepoints])

    const infraActive = useMemo(() => ({
        medical: !!active.hospitals,
        security: !!active.police,
        // Dedicated dataset layers already cover airports and power plants with
        // higher-quality metadata. Keep OSM fallback off by default to avoid
        // vague transport/power points masquerading as precise assets.
        transport: false,
        power: false,
        military: !!active.military,
        pipelines: false,  // GEM pipeline lines rendered separately; suppress Overpass point markers
        comms: false,
        government: false,
        chokepoints: !!active.chokepoints,
        utilities: false,
    }), [active.hospitals, active.police, active.military, active.pipelines, active.chokepoints])

    // Poll health endpoint for data source status dots in layers panel
    useEffect(() => {
        let cancelled = false
        async function fetchStatus() {
            try {
                const res = await fetch(`${API}/api/health/detailed`)
                if (!res.ok || cancelled) return
                const json = await res.json()
                const status = {}
                for (const src of (json.data_sources || [])) status[src.id] = src.status
                if (!cancelled) setSourceStatus(status)
            } catch {}
        }
        fetchStatus()
        const iv = setInterval(fetchStatus, 60000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [])

    useEffect(() => {
        fetch(BORDER_API)
            .then(r => r.json())
            .then(data => {
                setAllCountriesGeo(data)
                const feature = data.features.find(f =>
                    f.properties?.name === "United Republic of Tanzania" ||
                    f.properties?.ADMIN === "Tanzania" ||
                    f.properties?.ADMIN === "United Republic of Tanzania"
                )
                if (feature) setTanzaniaGeo(feature)
            })
            .catch(() => { })
    }, [])

    // Load EEZ data once
    useEffect(() => {
        fetch(EEZ_API)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data?.features?.length) setEezGeo(data) })
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (!selectedCountry) return
        setCountryLoading(true)
        setCountryData(null)
        const encoded = encodeURIComponent(selectedCountry)
        console.info("[country/brief] request", { country: selectedCountry })
        Promise.all([
            fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`)
                .then(r => r.json()).catch(() => null),
            fetch(`${API}/news?country=${encoded}`)
                .then(r => r.json()).catch(() => ({ articles: [] })),
        ]).then(([wiki, news]) => {
            console.info("[country/brief] response", {
                country: selectedCountry,
                wiki: !!wiki && !String(wiki?.type || "").includes("error"),
                articles: Array.isArray(news?.articles) ? news.articles.length : 0,
            })
            setCountryData({ wiki, news: news.articles || [] })
            setCountryLoading(false)
        })
    }, [selectedCountry])

    // Conflict zones — fetched for the current AOI only and derived from actual conflict events.
    useEffect(() => {
        if (!active.conflictZones || !viewportBounds || (viewportBounds.zoom || zoom || 4) > 6) {
            setConflictZones([])
            return
        }
        const { north, south, east, west, zoom: viewportZoom } = viewportBounds
        const params = new URLSearchParams({
            north: String(north),
            south: String(south),
            east: String(east),
            west: String(west),
            zoom: String(viewportZoom || zoom || 4),
        })
        const started = performance.now()
        setConflictZonesLoading(true)
        fetch(`${API}/conflict-zones?${params.toString()}`)
            .then(r => r.json())
            .then(data => {
                console.info("[conflict-zones/fetch]", {
                    ms: Math.round(performance.now() - started),
                    count: Array.isArray(data?.zones) ? data.zones.length : 0,
                    diagnostics: data?.diagnostics || null,
                })
                setConflictZones(Array.isArray(data?.zones) ? data.zones : [])
                setConflictZonesLoading(false)
            })
            .catch(() => {
                setConflictZones([])
                setConflictZonesLoading(false)
            })
    }, [active.conflictZones, viewportBounds, zoom])

    useEffect(() => {
        if (!active.conflictZones || !viewportBounds || (viewportBounds.zoom || zoom || 4) > 6) return
        const iv = setInterval(() => {
            const { north, south, east, west, zoom: viewportZoom } = viewportBounds
            const params = new URLSearchParams({
                north: String(north),
                south: String(south),
                east: String(east),
                west: String(west),
                zoom: String(viewportZoom || zoom || 4),
            })
            fetch(`${API}/conflict-zones?${params.toString()}`)
                .then(r => r.json())
                .then(data => setConflictZones(Array.isArray(data?.zones) ? data.zones : []))
                .catch(() => {})
        }, 10 * 60 * 1000)
        return () => clearInterval(iv)
    }, [active.conflictZones, viewportBounds, zoom])

    // Auto-clear toast after 2.2s (matches CSS animation duration)
    useEffect(() => {
        if (!toastInfo) return
        const t = setTimeout(() => setToastInfo(null), 2200)
        return () => clearTimeout(t)
    }, [toastInfo?.key])

    // Keep viewportBoundsRef current so the polling closure can always read
    // the latest bounds without being in the dependency array.
    useEffect(() => { viewportBoundsRef.current = viewportBounds }, [viewportBounds])

    useEffect(() => {
        Promise.all([
            fetch(CABLE_API).then(r => r.json()),
            fetch(LANDING_API).then(r => r.json()),
        ]).then(([cablesData, pointsData]) => {
            const CELL = 0.1
            const grid = {}
            cablesData.features.forEach(cable => {
                if (!cable.geometry) return
                const name = cable.properties.name
                cable.geometry.coordinates.forEach(line => {
                    line.forEach(([lng, lat]) => {
                        const key = `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`
                        ;(grid[key] = grid[key] || []).push({ name, lat, lng })
                    })
                })
            })
            const associations = {}
            pointsData.features.forEach(pt => {
                if (!pt.geometry) return
                const [ptLng, ptLat] = pt.geometry.coordinates
                const bLat = Math.floor(ptLat / CELL)
                const bLng = Math.floor(ptLng / CELL)
                const found = new Set()
                for (let dl = -1; dl <= 1; dl++) {
                    for (let dm = -1; dm <= 1; dm++) {
                        ;(grid[`${bLat + dl},${bLng + dm}`] || []).forEach(({ name, lat, lng }) => {
                            if (!found.has(name) && quickDistKm(ptLat, ptLng, lat, lng) <= 5) {
                                found.add(name)
                            }
                        })
                    }
                }
                associations[pt.properties.id] = [...found]
            })
            const result = {
                cables: cablesData.features || [],
                points: pointsData.features || [],
                associations,
            }
            setCableGeo(result)
        }).catch(err => { console.error("[cables] fetch failed:", err) })
    }, [])

    // ── Route fetch: triggered when both origin + dest are set ────────────────
    useEffect(() => {
        if (!active.route || !routeOrigin || !routeDest) return
        let cancelled = false
        setRouteLoading(true)
        setRouteAnalysis(null)
        setRouteGeo(null)
        setRouteInfo(null)
        setRouteSteps([])
        setShowAlternatives(false)
        setAltRoutes(null)
        setCorridorData(null)

        // Build points array: origin, any waypoints, dest
        const pts = [
            [routeOrigin.lat, routeOrigin.lon],
            ...waypoints.map(w => [w.lat, w.lon]),
            [routeDest.lat, routeDest.lon],
        ]
        fetch(`${API}/route`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ points: pts, mode: "driving" }),
        })
            .then(r => r.json())
            .then(data => {
                if (cancelled || data.error) {
                    if (data.error) console.error("[route]", data.error)
                    return
                }
                setRouteGeo(data.coordinates)
                setRouteInfo({ distance_km: data.distance_km, duration_min: data.duration_min })
                setRouteSteps(data.steps || [])
            })
            .catch(err => console.error("[route] fetch error:", err))
            .finally(() => { if (!cancelled) setRouteLoading(false) })

        return () => { cancelled = true }
    }, [active.route, routeOrigin, routeDest, waypoints])

    // ── On-demand route analysis ───────────────────────────────────────────────
    const analyseRoute = () => {
        if (!routeGeo || routeAnalysing) return
        setRouteAnalysing(true)

        // Compute news markers within 50km of the route (sample every 10 coords)
        const routeSample = routeGeo.filter((_, i) => i % 10 === 0)
        const nearby_news = newsConflictsData
            .filter(m => m.confidence === "high" || m.confidence === "medium")
            .filter(m => routeSample.some(([lon, lat]) => haversineKm(lat, lon, m.lat, m.lon) <= 50))
            .slice(0, 5)
            .map(m => ({
                headline:      m.headline,
                source:        m.source,
                location_name: m.location,
                confidence:    m.confidence,
                published:     m.published || "",
                lat:           m.lat,
                lon:           m.lon,
            }))

        const payload = {
            coordinates:   routeGeo,
            distance_km:   routeInfo.distance_km,
            duration_min:  routeInfo.duration_min,
            origin_lat:    routeOrigin.lat,
            origin_lon:    routeOrigin.lon,
            dest_lat:      routeDest.lat,
            dest_lon:      routeDest.lon,
            nearby_news,
            contextual:    contextualAnalysis,
            mission_brief: activeSituation?.mission || "",
            profile:       profile || null,
        }
        // If infrastructure layer is active, also fetch corridor data
        const infraEnabled = Object.values(infraActive).some(Boolean)
        const requests = [
            fetch(`${API}/route/analyse`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }).then(r => r.json()),
        ]
        if (infraEnabled) {
            requests.push(
                fetch(`${API}/infrastructure/corridor`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ route_points: routeGeo.map(([lon, lat]) => [lat, lon]) }),
                }).then(r => r.json()).catch(() => null)
            )
        }
        Promise.all(requests)
            .then(([analysis, corridor]) => {
                setRouteAnalysis(analysis)
                if (corridor) setCorridorData(corridor)
            })
            .catch(err => console.error("[route/analyse]", err))
            .finally(() => setRouteAnalysing(false))
    }

    // Clear route state when route planner is toggled off
    useEffect(() => {
        if (!active.route) {
            setRouteOrigin(null); setRouteDest(null)
            setRouteGeo(null); setRouteInfo(null); setRouteSteps([])
            setRouteAnalysis(null); setRouteLoading(false); setRouteAnalysing(false)
            setShowAlternatives(false); setAltRoutes(null); setCorridorData(null)
            setFromInput(""); setToInput(""); setWaypoints([])
        }
    }, [active.route])

    // ── Infrastructure fetch: per-category, with 30% viewport-change threshold ──
    // cancelled flags collected per-effect-run so cleanup cancels any in-flight fetches
    // when a category is toggled off or viewport changes before the response arrives.
    useEffect(() => {
        if (!viewportBounds) return
        const { north, south, east, west } = viewportBounds
        const cancellers = []
        Object.entries(infraActive).forEach(([cat, on]) => {
            if (!on) return
            // Per-category 30% bounds-change threshold — prevents excessive refetches on small pans
            const last = infraLastBoundsRef.current[cat]
            if (last) {
                const latSpan = Math.abs(north - south) || 1
                const lonSpan = Math.abs(east  - west)  || 1
                const maxChange = Math.max(
                    Math.abs(north - last.north) / latSpan,
                    Math.abs(south - last.south) / latSpan,
                    Math.abs(east  - last.east)  / lonSpan,
                    Math.abs(west  - last.west)  / lonSpan,
                )
                if (maxChange < 0.30) return
            }
            // Record bounds before fetch to prevent duplicate requests on re-render
            infraLastBoundsRef.current = { ...infraLastBoundsRef.current, [cat]: { north, south, east, west } }
            setInfraLoading(prev => ({ ...prev, [cat]: true }))
            const bbox = `${south},${west},${north},${east}`
            let cancelled = false
            cancellers.push(() => { cancelled = true })
            fetch(`${API}/infrastructure?category=${cat}&bbox=${bbox}`)
                .then(r => r.json())
                .then(data => {
                    if (cancelled) return
                    setInfraData(prev => ({ ...prev, [cat]: data.features || [] }))
                })
                .catch(err => console.error(`[infra] ${cat} fetch error:`, err))
                .finally(() => { if (!cancelled) setInfraLoading(prev => ({ ...prev, [cat]: false })) })
        })
        return () => cancellers.forEach(c => c())
    }, [infraActive, viewportBounds])

    // Clear infrastructure data + loading + last-bounds when category is toggled off
    useEffect(() => {
        Object.entries(infraActive).forEach(([cat, on]) => {
            if (!on) {
                setInfraData(prev => { const n = { ...prev }; delete n[cat]; return n })
                setInfraLoading(prev => { const n = { ...prev }; delete n[cat]; return n })
                delete infraLastBoundsRef.current[cat]
            }
        })
    }, [infraActive])

    // ── Dataset infrastructure: fetch when layer on + viewport changes ────────
    const datasetInfraEnabled = active.airports || active.ports || active.powerPlants

    useEffect(() => {
        if (!datasetInfraEnabled) return
        const { north, south, east, west } = viewportBounds || {}
        if (!north) return
        const centerLat = (north + south) / 2
        const centerLon = (east + west) / 2
        const radiusKm  = Math.min(500, haversineKm(centerLat, west, centerLat, east) / 2 + 50)
        const CHANGE_THRESHOLD = 0.15

        const cancelled = { v: false }
        ;["airport", "port", "power"].forEach(type => {
            if (!dsActive[type]) return
            const last = dsLastBoundsRef.current[type]
            if (last) {
                const dLat = Math.abs(centerLat - last.lat) / (north - south || 1)
                const dLon = Math.abs(centerLon - last.lon) / (east - west || 1)
                if (dLat < CHANGE_THRESHOLD && dLon < CHANGE_THRESHOLD) return
            }
            dsLastBoundsRef.current[type] = { lat: centerLat, lon: centerLon }
            setDsLoading(prev => ({ ...prev, [type]: true }))
            fetch(`${API}/api/infrastructure/nearby?lat=${centerLat}&lon=${centerLon}&radius=${radiusKm}&type=${type}`)
                .then(r => r.json())
                .then(d => { if (!cancelled.v) setDsData(prev => ({ ...prev, [type]: d.items || [] })) })
                .catch(() => {})
                .finally(() => { if (!cancelled.v) setDsLoading(prev => ({ ...prev, [type]: false })) })
        })
        return () => { cancelled.v = true }
    }, [datasetInfraEnabled, dsActive, viewportBounds])  // eslint-disable-line

    // Clear dataset infra data when type toggled off
    useEffect(() => {
        Object.entries(dsActive).forEach(([type, on]) => {
            if (!on && ["airport","port","power"].includes(type)) {
                setDsData(prev => ({ ...prev, [type]: [] }))
                delete dsLastBoundsRef.current[type]
            }
        })
    }, [dsActive])

    // ── Chokepoints: fetch once on mount, no viewport dependency ─────────────
    useEffect(() => {
        fetch(`${API}/api/infrastructure/chokepoints`)
            .then(r => r.json())
            .then(d => setChokepointData(d.chokepoints || []))
            .catch(() => {})
    }, [])

    // ── Ports: bbox-based fetch, refreshes when viewport changes 20%+ ─────────
    useEffect(() => {
        if (!active.ports || !viewportBounds) {
            if (!active.ports) setPortsData([])
            return
        }
        const { south, west, north, east } = viewportBounds
        if (!north) return
        const last = portsLastBboxRef.current
        if (last) {
            const latSpan = north - south || 1
            const lonSpan = Math.abs(east - west) || 1
            if (Math.abs((north + south) / 2 - (last.n + last.s) / 2) / latSpan < 0.2 &&
                Math.abs((east + west) / 2 - (last.e + last.w) / 2) / lonSpan < 0.2) return
        }
        portsLastBboxRef.current = { s: south, w: west, n: north, e: east }
        const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`
        fetch(`${API}/api/infrastructure/ports?bbox=${bbox}&limit=300`)
            .then(r => r.json())
            .then(d => setPortsData(d.items || []))
            .catch(() => {})
    }, [active.ports, viewportBounds])  // eslint-disable-line

    // ── AIS vessel tracking: poll every 30s when layer on ────────────────────
    // Uses viewportBoundsRef (not viewportBounds state) so the interval does not
    // restart on every map move — only when the toggle itself changes.
    useEffect(() => {
        if (!active.aisVessels) {
            setAisVessels([])
            setSelectedAisVessel(null)
            if (aisIntervalRef.current) { clearInterval(aisIntervalRef.current); aisIntervalRef.current = null }
            return
        }
        const fetchVessels = () => {
            const b = viewportBoundsRef.current
            const q = b ? `?bbox=${b.south.toFixed(4)},${b.west.toFixed(4)},${b.north.toFixed(4)},${b.east.toFixed(4)}` : ""
            fetch(`${API}/api/ais/vessels${q}`)
                .then(r => r.json())
                .then(d => {
                    setAisVessels(d.vessels || [])
                    if (d.status) setAisStatus(d.status)
                })
                .catch(() => {})
        }
        fetchVessels()  // immediate fetch on toggle-on
        if (aisIntervalRef.current) clearInterval(aisIntervalRef.current)
        aisIntervalRef.current = setInterval(fetchVessels, 30000)
        return () => { if (aisIntervalRef.current) { clearInterval(aisIntervalRef.current); aisIntervalRef.current = null } }
    }, [active.aisVessels])  // eslint-disable-line

    // ── News conflicts: fetch all markers globally, refresh every 15 min ─────────
    useEffect(() => {
        if (!active.newsConflicts || !viewportBounds) {
            setNewsConflictsData([])
            setNewsConflictsCount(0)
            return
        }

        const normalizeMarkers = (items) => (
            (Array.isArray(items) ? items : [])
                .map((item) => {
                    const lat = Number(item?.lat)
                    const lon = Number(item?.lon)
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
                    return {
                        ...item,
                        lat,
                        lon,
                        headline: item?.headline || item?.title || "Untitled",
                        location: item?.location || item?.location_name || "Unknown location",
                        confidence: item?.confidence || "medium",
                    }
                })
                .filter(Boolean)
        )

        const fetchAll = async () => {
            try {
                const { south, west, north, east, zoom: viewportZoom } = viewportBounds
                console.info("[news-conflicts/request]", {
                    south, west, north, east, zoom: viewportZoom || zoom,
                })
                const params = new URLSearchParams({
                    south: String(south),
                    west: String(west),
                    north: String(north),
                    east: String(east),
                })
                const primaryUrl = `${API}/news-conflicts?${params.toString()}`
                const fallbackUrl = `${API}/news-geocoded`
                const [r1, r2] = await Promise.allSettled([
                    fetch(primaryUrl).then(r => r.json()),
                    fetch(fallbackUrl).then(r => r.json()),
                ])

                const d1 = r1.status === "fulfilled" ? r1.value : {}
                const d2 = r2.status === "fulfilled" ? r2.value : {}

                const raw1 = d1.markers || d1.articles || []
                const raw2 = d2.articles || d2.markers || []

                const first1 = raw1[0] || {}
                const first2 = raw2[0] || {}
                const fallback = normalizeMarkers(raw2).filter(m => pointInBounds(m, viewportBounds))
                const combined = [...normalizeMarkers(raw1), ...fallback]
                const seen = new Set()
                const existingUrls = new Set((events || []).map(e => e.url).filter(Boolean))
                const deduped = combined.filter((m) => {
                    if (existingUrls.has(m.url)) return false
                    const key = m.url || `${m.headline}_${m.lat.toFixed(4)}_${m.lon.toFixed(4)}`
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                })

                console.info("[news-conflicts/fetch]", { count: deduped.length })
                setNewsConflictsData(deduped)
                setNewsConflictsCount(deduped.length)
            } catch {
                setNewsConflictsData([])
                setNewsConflictsCount(0)
            }
        }
        fetchAll()
        const iv = setInterval(fetchAll, 15 * 60 * 1000)
        return () => clearInterval(iv)
    }, [active.newsConflicts, viewportBounds, events, zoom])

    // ── Pipeline lines — use hardcoded dataset (remote GOPIT sources are dead) ──
    useEffect(() => {
        if (active.pipelines) setPipelineGeoData(_HARDCODED_PIPELINES)
        else setPipelineGeoData([])
    }, [active.pipelines])

    // ── Deployments layer fetch ───────────────────────────────────────────────
    useEffect(() => {
        if (!active.deployments) { setDeploymentsData(null); return }
        fetch(`${API}/api/deployments`)
            .then(r => r.json())
            .then(d => setDeploymentsData(d))
            .catch(() => {})
    }, [active.deployments])

    // Shipping lanes use hardcoded _SHIPPING_ROUTES_HARDCODED constant — no fetch needed

    // ── POI layer: fetch all profiles when layer toggled on ───────────────────
    useEffect(() => {
        if (!active.poi) {
            setPoiData([])
            return
        }
        fetch(`${API}/api/poi`)
            .then(r => r.json())
            .then(d => setPoiData(Array.isArray(d) ? d.filter(p => p.lat && p.lon) : []))
            .catch(() => {})
    }, [active.poi])

    // ── POI show-on-map event (from POIPanel "Show on Map") ─────────────────
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon, poiId } = e.detail || {}
            if (!lat || !lon) return
            if (mapRef.current) {
                mapRef.current.setView([lat, lon], Math.max(mapRef.current.getZoom(), 10), { animate: true })
            }
            setActive(a => ({ ...a, poi: true }))
            // Refresh POI data and select the marker
            fetch(`${API}/api/poi`)
                .then(r => r.json())
                .then(d => {
                    const filtered = Array.isArray(d) ? d.filter(p => p.lat && p.lon) : []
                    setPoiData(filtered)
                    const target = filtered.find(p => p.id === poiId)
                    if (target) setSelectedPoiMarker(target)
                })
                .catch(() => {})
        }
        window.addEventListener("akili:poi-show-on-map", handler)
        return () => window.removeEventListener("akili:poi-show-on-map", handler)
    }, [])  // eslint-disable-line

    // ── POI location-updated event (from POIPanel save) ───────────────────────
    useEffect(() => {
        const handler = (e) => {
            const updated = e.detail
            if (!updated?.id) return
            setPoiData(prev => {
                const idx = prev.findIndex(p => p.id === updated.id)
                if (updated.lat && updated.lon) {
                    // POI has coords — upsert into visible layer
                    const entry = { ...updated }
                    if (idx >= 0) {
                        const next = [...prev]; next[idx] = entry; return next
                    }
                    return [...prev, entry]
                } else {
                    // Coords removed — drop from map
                    return idx >= 0 ? prev.filter(p => p.id !== updated.id) : prev
                }
            })
            // Also refresh selectedPoiMarker if it's the one that moved
            setSelectedPoiMarker(prev => prev?.id === updated.id ? updated : prev)
        }
        window.addEventListener("akili:poi-location-updated", handler)
        return () => window.removeEventListener("akili:poi-location-updated", handler)
    }, [])  // eslint-disable-line

    // ── Hide conflict layers when POI mode is active ──────────────────────────
    useEffect(() => {
        const handler = (e) => {
            if (e.detail.active) {
                // Save current state and hide conflict layers
                prePOILayersRef.current = {
                    heatmap: active.heatmap,
                    conflictZones: active.conflictZones,
                    acled: active.acled,
                    newsConflicts: active.newsConflicts,
                }
                setActive(a => ({ ...a, heatmap: false, conflictZones: false, acled: false, newsConflicts: false }))
            } else {
                // Restore saved state
                if (prePOILayersRef.current) {
                    const saved = prePOILayersRef.current
                    setActive(a => ({ ...a, ...saved }))
                    prePOILayersRef.current = null
                }
            }
        }
        window.addEventListener("akili:poi-mode", handler)
        return () => window.removeEventListener("akili:poi-mode", handler)
    }, []) // eslint-disable-line

    useEffect(() => {
        let cancelled = false

        const fetchAlerts = () => {
            fetch(`${API}/api/alerts/new`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (cancelled || !d?.alerts) return
                    setSurveillanceAlerts(Array.isArray(d.alerts) ? d.alerts : [])
                })
                .catch(() => {})
        }

        fetchAlerts()
        const iv = setInterval(fetchAlerts, 20000)
        return () => {
            cancelled = true
            clearInterval(iv)
        }
    }, [])

    // ── On-demand impact analysis ──────────────────────────────────────────────
    const analyseImpact = () => {
        if (!impactEvent || impactAnalysing) return
        const cached = impactAnalysisCache[impactEvent.id]
        if (cached) return
        setImpactAnalysing(true)
        fetch(`${API}/analyse`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: impactEvent, contextual: contextualAnalysis, mission_brief: activeSituation?.mission || "", profile: profile || null }),
        })
            .then(r => r.json())
            .then(data => setImpactAnalysisCache(prev => ({ ...prev, [impactEvent.id]: data })))
            .catch(err => console.error("[analyse]", err))
            .finally(() => setImpactAnalysing(false))
    }

    // ── On-demand news conflict analysis ──────────────────────────────────────
    const analyseNewsConflict = () => {
        if (!newsConflictSelected || newsConflictAnalysing) return
        const cacheKey = newsConflictSelected.url
        if (cacheKey && newsConflictAnalysisCache[cacheKey]) return
        setNewsConflictAnalysing(true)
        fetch(`${API}/analyse-news`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marker: newsConflictSelected, contextual: contextualAnalysis, mission_brief: activeSituation?.mission || "", profile: profile || null }),
        })
            .then(r => r.json())
            .then(data => setNewsConflictAnalysisCache(prev => ({ ...prev, [cacheKey]: data })))
            .catch(err => console.error("[analyse-news]", err))
            .finally(() => setNewsConflictAnalysing(false))
    }

    // ── On-demand infrastructure analysis ─────────────────────────────────────
    const analyseInfra = () => {
        if (!infraSelected || infraAnalysing) return
        const { feature, category } = infraSelected
        const [lon, lat] = feature.geometry.coordinates
        const cacheKey = `${category}_${lat.toFixed(4)}_${lon.toFixed(4)}`
        if (infraAnalysisCache[cacheKey]) return
        setInfraAnalysing(true)
        const props = feature.properties || {}
        fetch(`${API}/infrastructure/analyse`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: props.name || null, operator: props.operator || null, category, lat, lon, tags: props, contextual: contextualAnalysis, mission_brief: activeSituation?.mission || "", profile: profile || null }),
        })
            .then(r => r.json())
            .then(data => setInfraAnalysisCache(prev => ({ ...prev, [cacheKey]: data })))
            .catch(err => console.error("[infra/analyse]", err))
            .finally(() => setInfraAnalysing(false))
    }

    // ── Address geocoding helpers ──────────────────────────────────────────────
    const geocode = (query) => {
        const q = (query || "").trim()
        if (q.length < 3) return Promise.resolve([])
        const p = new URLSearchParams({ q, limit: "5" })
        return fetch(`${API}/geocode?${p}`)
            .then(r => (r.ok ? r.json() : []))
            .then(data => Array.isArray(data) ? data : [])
            .catch(() => [])
    }

    // ── Area click handler — finds nearby surface items and opens popup ────────
    const handleAreaClick = useCallback((lat, lon) => {
        if (!surfaceItems.length) return
        const radius = zoom <= 3 ? 1500 : zoom <= 5 ? 800 : 400
        const nearby = surfaceItems
            .filter(item => haversineKm(lat, lon, item.lat, item.lon) <= radius)
            .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
        if (!nearby.length) return
        const locationName = nearby[0]?.location || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
        setAreaPopup({ lat, lon, locationName, items: nearby.slice(0, 8) })
        setAreaAnalysis(null)
        setAreaAnalysing(false)
    }, [surfaceItems, zoom])

    // ── Area analysis — sends headlines to /analyse/area ─────────────────────
    const analyseArea = useCallback(async () => {
        if (!areaPopup || areaAnalysing) return
        setAreaAnalysing(true)
        try {
            const headlines = areaPopup.items.map(item => ({
                title:       item.headline || item.title || (item.notes || "").slice(0, 120) || "Event",
                source:      item.source || "Surface Pool",
                date:        item.date || "",
                description: (item.notes || "").slice(0, 200),
            }))
            const nearbyChokepoints = chokepointData
                .filter(cp => cp.lat && cp.lon && haversineKm(areaPopup.lat, areaPopup.lon, cp.lat, cp.lon) <= 1500)
                .map(cp => cp.name)
            const res = await fetch(`${API}/analyse/area`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    headlines,
                    lat:               areaPopup.lat,
                    lon:               areaPopup.lon,
                    radius_km:         zoom <= 3 ? 1500 : zoom <= 5 ? 800 : 400,
                    location_name:     areaPopup.locationName,
                    nearby_chokepoints: nearbyChokepoints,
                    profile:           profile || null,
                }),
            })
            const data = await res.json()
            setAreaAnalysis(data)
        } catch (e) {
            setAreaAnalysis({ error: e.message })
        } finally {
            setAreaAnalysing(false)
        }
    }, [areaPopup, areaAnalysing, chokepointData, zoom, profile])

    useEffect(() => {
        return () => clearTimeout(tempMarkerTimerRef.current)
    }, [])

    useEffect(() => {
        if (!searchTarget) return
        const lat = Number(searchTarget.lat)
        const lon = Number(searchTarget.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

        let attempts = 0
        const jumpToTarget = () => {
            if (!mapRef.current) {
                attempts += 1
                if (attempts < 20) setTimeout(jumpToTarget, 100)
                return
            }
            mapRef.current.flyTo([lat, lon], searchTarget.zoom || 12, { duration: 0.9 })
            const label = searchTarget.label?.split(",")[0] || "Location"
            setTempMarker({ lat, lon, label })
            clearTimeout(tempMarkerTimerRef.current)
            tempMarkerTimerRef.current = setTimeout(() => setTempMarker(null), 10000)
        }
        jumpToTarget()
    }, [searchTarget])

    // ── Satellite search ──────────────────────────────────────────────────────
    const searchSatellite = async () => {
        if (!viewportBounds) return
        setSatelliteSearching(true)
        setSatelliteError(null)
        setSatelliteAuthError(null)
        setSatelliteResults([])
        setSatelliteSelected({})
        setSatelliteInfoItem(null)
        const { west, south, east, north } = viewportBounds
        try {
            const res = await fetch(`${API}/satellite/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bbox: [west, south, east, north], max_cloud: maxCloud, days_back: daysBack }),
            })
            const data = await res.json()
            if (data.error) setSatelliteError(data.error)
            setSatelliteAuthMode(data.auth_mode || "public")
            setSatelliteAuthError(data.auth_error || null)
            setSatelliteResults(data.items || [])
        } catch (e) {
            setSatelliteError("Search failed — check backend connection")
        } finally {
            setSatelliteSearching(false)
        }
    }

    // ── Stop ADS-B polling when the layer is toggled off ─────────────────────
    useEffect(() => {
        if (!active.adsb) setAdsbLive(false)
    }, [active.adsb])

    // ── Alternative routes: fetch when requested ──────────────────────────────
    const requestAlternatives = () => {
        setShowAlternatives(true)
        if (!routeInfo) return
        // Build three pseudo-alternatives from the same route with adjusted metadata
        const score = routeAnalysis?.safety_score ?? 50
        const km    = routeInfo.distance_km
        const min   = routeInfo.duration_min
        setAltRoutes([
            { label: "Fastest",  tag: "FASTEST",  color: "#3b82f6", distance_km: km,              duration_min: Math.round(min),             },
            { label: "Safest",   tag: "SAFEST",   color: "#22c55e", distance_km: round1(km * 1.18), duration_min: Math.round(min * 1.22),     },
            { label: "Balanced", tag: "BALANCED", color: "#f59e0b", distance_km: round1(km * 1.08), duration_min: Math.round(min * 1.10),     },
        ])
    }
    function round1(n) { return Math.round(n * 10) / 10 }

    // ── Annotation helpers ────────────────────────────────────────────────────
    const showAnnotationToast = (msg) => {
        setAnnotationToast(msg)
        setTimeout(() => setAnnotationToast(null), 2500)
    }

    const saveAnnotations = () => {
        fetch(`${API}/annotations/save`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(annotations),
        }).then(() => showAnnotationToast("Saved ✓"))
          .catch(() => showAnnotationToast("Save failed"))
    }

    const loadAnnotations = () => {
        fetch(`${API}/annotations/load`)
            .then(r => r.json())
            .then(data => {
                setAnnotations(data)
                const n = (data.points?.length||0) + (data.zones?.length||0) + (data.links?.length||0)
                showAnnotationToast(`Loaded ${n} annotations`)
            })
            .catch(() => showAnnotationToast("Load failed"))
    }

    const clearAnnotations = () => {
        if (!window.confirm("Clear all annotations? This cannot be undone.")) return
        setAnnotations({ points: [], zones: [], links: [] })
        setSelectedAnnotation(null)
    }

    // Find lat/lng centre of any annotation (point or zone centroid)
    const annotationCenter = (ann) => {
        if (ann._type === "point") return [ann.lat, ann.lng]
        if (ann._type === "zone") {
            const lats = ann.vertices.map(v => v[0])
            const lngs = ann.vertices.map(v => v[1])
            return [lats.reduce((a,b)=>a+b,0)/lats.length, lngs.reduce((a,b)=>a+b,0)/lngs.length]
        }
        return null
    }

    // Handle annotation map clicks
    const handleAnnotationPoint = (lat, lng) => {
        setAnnotationForm({ type: "point", data: { lat, lng } })
    }
    const handleZoneVertex = (lat, lng) => {
        setZoneInProgress(prev => [...prev, [lat, lng]])
    }
    const handleZoneClose = () => {
        if (zoneInProgress.length < 3) return
        setAnnotationForm({ type: "zone", data: { vertices: zoneInProgress } })
        setZoneInProgress([])
    }
    const handleAnnotationEscape = () => {
        setZoneInProgress([])
        setLinkSource(null)
        setAnnotationForm(null)
    }

    const savePointAnnotation = (lat, lng, title, classification, context) => {
        const pt = { id: crypto.randomUUID(), lat, lng, title, classification, context, timestamp: new Date().toISOString(), _type: "point" }
        setAnnotations(prev => ({ ...prev, points: [...prev.points, pt] }))
        setAnnotationForm(null)
    }
    const saveZoneAnnotation = (vertices, label, type, notes, opacity) => {
        const z = { id: crypto.randomUUID(), vertices, label, type, notes, opacity, timestamp: new Date().toISOString(), _type: "zone" }
        setAnnotations(prev => ({ ...prev, zones: [...prev.zones, z] }))
        setAnnotationForm(null)
    }
    const saveLinkAnnotation = (sourceId, targetId, relationship, note) => {
        const lk = { id: crypto.randomUUID(), sourceId, targetId, relationship, note, timestamp: new Date().toISOString(), _type: "link" }
        setAnnotations(prev => ({ ...prev, links: [...prev.links, lk] }))
        setAnnotationForm(null)
        setLinkSource(null)
    }
    const deleteAnnotation = (type, id) => {
        setAnnotations(prev => ({ ...prev, [type]: prev[type].filter(a => a.id !== id) }))
        setSelectedAnnotation(null)
    }

    // Link mode: click on existing annotation
    const handleLinkClick = (ann) => {
        if (!linkSource) {
            setLinkSource(ann)
        } else if (linkSource.id !== ann.id) {
            setAnnotationForm({ type: "link", data: { source: linkSource, target: ann } })
            setLinkSource(null)
        }
    }

    // Load annotations on mount
    useEffect(() => {
        fetch(`${API}/annotations/load`)
            .then(r => r.json())
            .then(data => setAnnotations({
                points: (data.points||[]).map(p => ({...p, _type:"point"})),
                zones:  (data.zones||[]).map(z => ({...z, _type:"zone"})),
                links:  (data.links||[]).map(l => ({...l, _type:"link"})),
            }))
            .catch(() => {})
    }, [])

    // When active situation changes, load its annotations into local state
    useEffect(() => {
        if (!activeSituation?.annotations) return
        const ann = activeSituation.annotations
        setAnnotations({
            points: (ann.points||[]).map(p => ({...p, _type:"point"})),
            zones:  (ann.zones||[]).map(z => ({...z, _type:"zone"})),
            links:  (ann.links||[]).map(l => ({...l, _type:"link"})),
        })
    }, [activeSituation?.id])

    // Load global annotations on startup (when no active situation)
    useEffect(() => {
        if (activeSituation?.annotations) return
        fetch(`${API}/api/annotations`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                const hasData = d.points?.length || d.zones?.length || d.links?.length
                if (!hasData) return
                setAnnotations({
                    points: (d.points || []).map(p => ({ ...p, _type: "point" })),
                    zones:  (d.zones  || []).map(z => ({ ...z, _type: "zone"  })),
                    links:  (d.links  || []).map(l => ({ ...l, _type: "link"  })),
                })
            })
            .catch(() => {})
    }, [])  // eslint-disable-line

    // Auto-save annotations back to active situation (2s debounce)
    useEffect(() => {
        if (!onSituationAnnotationsChange) return
        const t = setTimeout(() => {
            onSituationAnnotationsChange(annotations)
        }, 2000)
        return () => clearTimeout(t)
    }, [annotations])

    // Also persist annotations to /api/annotations so they survive reloads
    useEffect(() => {
        const t = setTimeout(() => {
            fetch(`${API}/api/annotations`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    points: annotations.points.map(({ _type, ...p }) => p),
                    zones:  annotations.zones.map(({ _type, ...z }) => z),
                    links:  annotations.links.map(({ _type, ...l }) => l),
                }),
            }).catch(() => {})
        }, 2500)
        return () => clearTimeout(t)
    }, [annotations])  // eslint-disable-line

    // ── Satellite tracking ────────────────────────────────────────────────────
    const computePositions = (tles) => {
        const now = new Date()
        const positions = []
        for (const sat of tles) {
            try {
                let satrec
                if (sat.MEAN_MOTION !== undefined && sat.ECCENTRICITY !== undefined) {
                    satrec = SatelliteJS.json2satrec(sat)
                } else if (sat.tle_line1 && sat.tle_line2) {
                    satrec = SatelliteJS.twoline2satrec(sat.tle_line1, sat.tle_line2)
                } else continue
                const pv = SatelliteJS.propagate(satrec, now)
                if (!pv?.position || typeof pv.position === "boolean") continue
                const gmst = SatelliteJS.gstime(now)
                const geo  = SatelliteJS.eciToGeodetic(pv.position, gmst)
                const lat  = SatelliteJS.degreesLat(geo.latitude)
                const lng  = SatelliteJS.degreesLong(geo.longitude)
                const alt  = geo.height
                const vel  = pv.velocity
                const speed = vel ? Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2) : null
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
                positions.push({ ...sat, lat, lng, alt: alt.toFixed(0), speed: speed ? speed.toFixed(2) : null })
            } catch { continue }
        }
        return positions
    }

    const isSatImagery = (sat) => {
        const loaded = satelliteResults.filter(item => satelliteSelected[item.id])
        return loaded.some(item => {
            const plat = (item.platform || "").toLowerCase()
            const name = sat.name.toLowerCase()
            return (name.includes("sentinel-2a") && plat.includes("sentinel-2a")) ||
                   (name.includes("sentinel-2b") && plat.includes("sentinel-2b")) ||
                   (name.includes("landsat-8") && plat.includes("landsat-8")) ||
                   (name.includes("landsat-9") && plat.includes("landsat-9"))
        })
    }

    useEffect(() => {
        if (!active.sattrack) {
            if (satTrackInterval) { clearInterval(satTrackInterval); setSatTrackInterval(null) }
            return
        }
        setSatLoading(true)
        fetch(`${API}/satellites/tle`)
            .then(r => r.json())
            .then(data => {
                const tles = data.satellites || []
                setSatTLEs(tles)
                setSatPositions(computePositions(tles))
                const iv = setInterval(() => {
                    setSatTLEs(prev => { setSatPositions(computePositions(prev)); return prev })
                }, 10000)
                setSatTrackInterval(iv)
            })
            .catch(e => console.error("[sattrack]", e))
            .finally(() => setSatLoading(false))
        return () => {}
    }, [active.sattrack])

    useEffect(() => () => { if (satTrackInterval) clearInterval(satTrackInterval) }, [satTrackInterval])

    const activateAdsb = () => {
        setAdsbRefreshRate(adsbSliderVal)
        setAdsbActivateKey(k => k + 1)
        setAdsbLive(true)
    }
    const stopAdsb = () => setAdsbLive(false)
    const applyAdsbRate = () => {
        setAdsbRefreshRate(adsbSliderVal)
        setAdsbActivateKey(k => k + 1)
    }

    const toggle = useCallback((id) => {
        setActive(a => {
            const next = !a[id]
            if (id === "webcams" && !next) setActiveWebcam(null)
            if (id === "satellite" && !next) {
                setSatelliteResults([])
                setSatelliteSelected({})
                setSatelliteInfoItem(null)
                setSatelliteError(null)
                setSatelliteAuthMode("public")
                setSatelliteAuthError(null)
            }
            if (id === "annotate" && !next) {
                setAnnotationMode(null)
                setZoneInProgress([])
                setLinkSource(null)
                setAnnotationForm(null)
                setSelectedAnnotation(null)
            }
            if (id === "sattrack" && !next) {
                setSatPositions([])
                setSelectedSat(null)
                setSatTLEs([])
            }
            // User interaction always wins over contextual auto-activation.
            manualLayerOverridesRef.current[id] = next
            delete autoActivatedRef.current[id]
            setManualOverrides({ ...manualLayerOverridesRef.current })
            const nextActive = { ...a, [id]: next }
            return nextActive
        })
    }, [])  // eslint-disable-line
    const isAvailable = (w)  => zoom >= w.minZoom

    const toggleInfra = useCallback((cat) => {
        const map = {
            medical: "hospitals",
            security: "police",
            transport: "airports",
            power: "powerPlants",
            military: "military",
            pipelines: "pipelines",
            chokepoints: "chokepoints",
        }
        const key = map[cat]
        if (key) toggle(key)
    }, [toggle])

    // Event types currently visible (used for legend pulsing)


    // Map-type-aware colours — satellite imagery is dark so borders need
    // high-contrast white; on light/dark tiles the themed green is fine.
    const borderGlowColor      = mapType === "satellite" ? "#ffffff" : "#00FF88"

    // ── Contextual border helpers ──────────────────────────────────────────────
    const ctxActivateCountry = useCallback((features, withEez = false) => {
        if (ctxBorderTimerRef.current) clearTimeout(ctxBorderTimerRef.current)
        setCtxBorderFeatures(features)
        setCtxBorderVisible(true)
        if (withEez) {
            setCtxEezFeatures(
                features.flatMap(f => {
                    const name = f.properties?.ADMIN || f.properties?.name || ""
                    const ef   = findEezByCountryName(name, eezGeo)
                    return ef ? [ef] : []
                })
            )
        } else {
            setCtxEezFeatures([])
        }
    }, [eezGeo])   // eslint-disable-line react-hooks/exhaustive-deps

    const ctxStartFadeOut = useCallback(() => {
        if (ctxBorderTimerRef.current) clearTimeout(ctxBorderTimerRef.current)
        ctxBorderTimerRef.current = setTimeout(() => {
            setCtxBorderVisible(false)
            ctxBorderTimerRef.current = setTimeout(() => {
                setCtxBorderFeatures([])
                setCtxEezFeatures([])
            }, 800)
        }, 30000)
    }, [])

    // Profile-driven persistent borders for focus regions
    useEffect(() => {
        if (!allCountriesGeo || !profile?.focusRegions?.length) {
            setProfileBorderFeatures([])
            return
        }
        const features = []
        for (const region of profile.focusRegions) {
            if (region === "Global") continue
            const bbox = REGION_BBOXES_THEATER[region]
            if (!bbox) continue
            const [s, n, w, e] = bbox
            for (const f of allCountriesGeo.features) {
                const centroid = featureApproxCentroid(f)
                if (!centroid) continue
                const [clat, clon] = centroid
                if (clat >= s && clat <= n && clon >= w && clon <= e) {
                    if (!features.some(x => x === f)) features.push(f)
                }
            }
        }
        setProfileBorderFeatures(features)
    }, [profile?.focusRegions, allCountriesGeo])   // eslint-disable-line react-hooks/exhaustive-deps

    const profileEezFeatures = useMemo(() => {
        if (!eezGeo?.features?.length || !profileBorderFeatures.length) return []
        const seen = new Set()
        return profileBorderFeatures.flatMap((feature) => {
            const name = feature.properties?.ADMIN || feature.properties?.name || ""
            const eezFeature = findEezByCountryName(name, eezGeo)
            if (!eezFeature) return []
            const key = name.toLowerCase()
            if (seen.has(key)) return []
            seen.add(key)
            return [eezFeature]
        })
    }, [profileBorderFeatures, eezGeo])

    const profileChokepoints = useMemo(() => {
        if (!profile?.focusRegions?.length || !chokepointData.length) return []
        if (profile.focusRegions.includes("Global")) return chokepointData
        return chokepointData.filter((cp) =>
            profile.focusRegions.some((region) => {
                const bbox = REGION_BBOXES_THEATER[region]
                if (!bbox) return false
                const [s, n, w, e] = bbox
                return cp.lat >= s && cp.lat <= n && cp.lon >= w && cp.lon <= e
            })
        )
    }, [profile?.focusRegions, chokepointData])

    const visibleProfileBorderFeatures = useMemo(() => {
        if (zoom < 5 || !viewportBounds) return []
        const { north, south, east, west } = viewportBounds
        return profileBorderFeatures.filter((feature) => {
            const centroid = featureApproxCentroid(feature)
            if (!centroid) return false
            const [lat, lon] = centroid
            return lat >= south && lat <= north && lon >= west && lon <= east
        })
    }, [profileBorderFeatures, viewportBounds, zoom])

    // Activate contextual border when a surface event or notification is selected
    useEffect(() => {
        const ev = selectedSurface || impactEvent || selected || newsConflictSelected
        if (!ev || !allCountriesGeo) {
            if (!ev) ctxStartFadeOut()
            return
        }
        // Try multiple country fields
        const raw = surfaceEnrichment?.enrichment?.primary_location?.name || ev.country || ev.admin1 || ev.location || ""
        const country = raw.split(",").pop()?.trim()
        if (!country) return
        const feature = findCountryByName(country, allCountriesGeo)
        const shouldShowEez = isMaritimeContext(ev) || ["maritime", "energy"].includes(ev.type)
        if (feature) ctxActivateCountry([feature], shouldShowEez)
    }, [selectedSurface, surfaceEnrichment, impactEvent, selected, newsConflictSelected])  // eslint-disable-line react-hooks/exhaustive-deps

    // Also activate when a chokepoint / port infra node is selected
    useEffect(() => {
        if (!infraSelected || !allCountriesGeo) return
        const cat  = infraSelected.category || ""
        const name = infraSelected.feature?.properties?.["addr:country"] ||
                     infraSelected.feature?.properties?.country || ""
        if (name) {
            const feature = findCountryByName(name, allCountriesGeo)
            if (feature) {
                const maritime = ["chokepoints", "cables", "transport"].includes(cat)
                ctxActivateCountry([feature], maritime)
            }
        }
    }, [infraSelected])  // eslint-disable-line react-hooks/exhaustive-deps

    // Route polyline colour derived from safety score
    const routeScore = routeAnalysis?.safety_score ?? null
    const routeColor = routeScore === null ? "#f59e0b"
        : routeScore >= 80 ? "#22c55e"
        : routeScore >= 50 ? "#FFD600"
        : "#ef4444"

    const isPiracySignal = useCallback((item) => {
        const text = [
            item?.type,
            item?.event_type,
            item?.headline,
            item?.title,
            item?.location,
            item?.description,
            item?.context,
        ].filter(Boolean).join(" ").toLowerCase()
        return /\b(piracy|pirate|hijack|tanker|vessel|ship|maritime|strait|naval)\b/.test(text)
    }, [])

    // ── Zoom-based progressive display ───────────────────────────────────────
    // The signal surface stays beneath icons at all zooms; marker density shifts with zoom.

    const missileAlertItems = useMemo(() => (
        !active.missileAlerts
            ? []
            : surveillanceAlerts.filter(item =>
                ["missile_warning", "missile_alert", "rocket_alert"].includes(item?.type) ||
                ["missile_warning", "missile_alert", "rocket_alert"].includes(item?.event_type)
            )
    ), [active.missileAlerts, surveillanceAlerts])

    const earthquakeAlertItems = useMemo(() => (
        !active.earthquakeEvents
            ? []
            : surveillanceAlerts.filter(item =>
                item?.type === "earthquake" || item?.event_type === "earthquake"
            )
    ), [active.earthquakeEvents, surveillanceAlerts])

    const piracyAlertItems = useMemo(() => {
        if (!active.imbPiracy) return []
        return [...events, ...newsConflictsData].filter(isPiracySignal)
    }, [active.imbPiracy, events, newsConflictsData, isPiracySignal])

    const visibleSurfaceItems = useMemo(() => (
        (surfaceItems || []).filter(item => pointInBounds(item, viewportBounds))
    ), [surfaceItems, viewportBounds])

    const signalSurfaceItems = useMemo(() => {
        if (!active.heatmap) return []
        const merged = [
            ...visibleSurfaceItems,
            ...events,
            ...(active.newsConflicts ? newsConflictsData : []),
            ...missileAlertItems,
            ...earthquakeAlertItems,
            ...piracyAlertItems,
        ]
        const seen = new Set()
        return merged.filter((item, index) => {
            const lat = Number(item?.lat)
            const lon = Number(item?.lon ?? item?.lng)
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
            const key = item?.id || item?.url || `${lat.toFixed(3)}_${lon.toFixed(3)}_${item?.headline || item?.title || index}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }, [active.heatmap, active.newsConflicts, visibleSurfaceItems, events, newsConflictsData, missileAlertItems, earthquakeAlertItems, piracyAlertItems])

    const clusterMarkers = useMemo(() => {
        if (zoom < 7 || zoom > 8 || !visibleSurfaceItems.length) return null
        const clusters = clusterSurfaceItems(visibleSurfaceItems, 100)
        return clusters.map((c, i) => (
            <Marker
                key={`cluster-${i}-z${zoom}`}
                position={[c.lat, c.lon]}
                pane="event-icons"
                icon={c.count === 1 ? makeSurfaceIcon(c.items[0]) : makeClusterIcon(c)}
                eventHandlers={{
                    click: (e) => {
                        L.DomEvent.stopPropagation(e)
                        // Open detail for highest-scoring item in cluster
                        const top = c.items.reduce((best, x) =>
                            (x.relevance_score || 0) > (best.relevance_score || 0) ? x : best, c.items[0])
                        onSurfaceItemClick?.(top)
                        if (mapRef.current) mapRef.current.flyTo([c.lat, c.lon], 7, { duration: 0.7 })
                    },
                }}
            />
        ))
    }, [visibleSurfaceItems, zoom, onSurfaceItemClick])

    const individualMarkers = useMemo(() => {
        if (zoom < 9 || !visibleSurfaceItems.length) return null
        return visibleSurfaceItems.map(item => (
            <Marker
                key={`surface-${item.id}`}
                position={[item.lat, item.lon]}
                pane="event-icons"
                icon={zoom >= 9 ? makeSurfaceSymbol(item) : makeSurfaceIcon(item)}
                eventHandlers={{
                    click: (e) => {
                        L.DomEvent.stopPropagation(e)
                        onSurfaceItemClick?.(item)
                        if (mapRef.current) {
                            const z = Math.max(mapRef.current.getZoom(), 8)
                            mapRef.current.flyTo([item.lat, item.lon], z, { duration: 0.8 })
                        }
                    },
                }}
            />
        ))
    }, [visibleSurfaceItems, zoom, onSurfaceItemClick])

    const surveillanceMarkers = useMemo(() => {
        const items = [...missileAlertItems, ...earthquakeAlertItems, ...piracyAlertItems]
        if (!items.length || zoom < 6) return null

        const seen = new Set()
        return items.flatMap((item, index) => {
            const lat = Number(item?.lat)
            const lon = Number(item?.lon ?? item?.lng)
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []

            const dedupeKey = item?.id || item?.url || `${lat.toFixed(3)}_${lon.toFixed(3)}_${item?.headline || item?.title || index}`
            if (seen.has(dedupeKey)) return []
            seen.add(dedupeKey)

            const color = inferSignalColor(item)
            const type = eventTypeValue(item)
            const markerItem = {
                ...item,
                color,
                type,
                significance_score: Number(item?.significance_score ?? item?.relevance_score ?? (type === "missile" ? 85 : 60)),
            }

            return (
                <Marker
                    key={`surveillance-${dedupeKey}`}
                    position={[lat, lon]}
                    pane="event-icons"
                    icon={zoom >= 8 ? makeSurfaceSymbol(markerItem) : makeSurfaceIcon(markerItem)}
                >
                    <Tooltip direction="top" offset={[0, -12]}>
                        <span style={{ fontSize: 10 }}>
                            {item?.headline || item?.title || item?.location || type}
                        </span>
                    </Tooltip>
                </Marker>
            )
        })
    }, [zoom, missileAlertItems, earthquakeAlertItems, piracyAlertItems])

    const relevantConflictEvents = useMemo(() => (
        (events || []).filter(ev => Number.isFinite(Number(ev?.lat)) && Number.isFinite(Number(ev?.lon)))
            .map(ev => ({ ...ev, lat: Number(ev.lat), lon: Number(ev.lon) }))
    ), [events])

    const conflictEventMarkers = useMemo(() => {
        if (zoom < 5 || !relevantConflictEvents.length) return null
        const pool = zoom < 8
            ? [...relevantConflictEvents].sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 30)
            : relevantConflictEvents
        return pool.map((event) => (
            <Marker
                key={`gdelt-event-${event.id}`}
                position={[event.lat, event.lon]}
                pane="event-icons"
                icon={makeConflictIcon(event, impactEvent?.id === event.id)}
                eventHandlers={{
                    click: (e) => {
                        L.DomEvent.stopPropagation(e)
                        setImpactEvent(event)
                        fetchContextualItems(event)
                        setAreaPopup(null)
                        setInfraSelected(null)
                        setNewsConflictSelected(null)
                    },
                }}
            >
                <Tooltip direction="top" offset={[0, -16]}>
                    <span style={{ fontSize: 10 }}>
                        {(event.headline || event.title || event.location || "Conflict event").slice(0, 88)}
                    </span>
                </Tooltip>
            </Marker>
        ))
    }, [relevantConflictEvents, zoom, impactEvent?.id])

    useEffect(() => {
        const renderedCount = zoom < 6
            ? 0
            : zoom < 8
                ? Math.min(relevantConflictEvents.length, 24)
                : relevantConflictEvents.length
        console.info("[events/render]", {
            zoom,
            fetchedCount: events?.length || 0,
            validCoordinateCount: relevantConflictEvents.length,
            renderedCount,
            suppressedByZoom: zoom < 6,
            sample: relevantConflictEvents[0] || null,
        })
        if (!relevantConflictEvents.length) return
        const started = performance.now()
        const raf = requestAnimationFrame(() => {
            console.info("[events/render/commit]", {
                ms: Math.round(performance.now() - started),
                renderedCount,
                zoom,
            })
        })
        return () => cancelAnimationFrame(raf)
    }, [events, relevantConflictEvents, zoom])

    // ── Conflict cluster theater polygons — intentionally disabled ───────────
    const conflictClusterPolygons = useMemo(() => null, [])

    // Severity radius circle around selected surface item
    const severityCircle = useMemo(() => {
        if (!selectedSurface?.lat || !selectedSurface?.lon) return null
        const color  = TIER_COLOR[selectedSurface.severity_tier] || "#00e5cc"
        const radius = { critical: 80000, significant: 50000, elevated: 30000, low: 20000 }[selectedSurface.severity_tier] || 30000
        return (
            <Circle
                key={`sev-${selectedSurface.id}`}
                center={[selectedSurface.lat, selectedSurface.lon]}
                radius={radius}
                pathOptions={{
                    color,
                    weight:      1,
                    dashArray:   "6 4",
                    opacity:     0.55,
                    fillColor:   color,
                    fillOpacity: 0.05,
                }}
            />
        )
    }, [selectedSurface])

    // Context infrastructure markers + dashed connecting lines from /api/events/{id}/context
    const surfaceContextElements = useMemo(() => {
        const nodes = surfaceContext?.infra || []
        const origin = surfaceContext?.item
        if (!nodes.length || !origin?.lat || !origin?.lon) return null
        return nodes.map((node, i) => (
            <Fragment key={`surface-context-${node.type}-${node.name}-${i}`}>
                <Polyline
                    positions={[[origin.lat, origin.lon], [node.lat, node.lon]]}
                    pane="relation-lines"
                    pathOptions={{ color: "#2dd4bf", weight: 2, dashArray: "6 6", opacity: 0.72 }}
                />
                <Marker position={[node.lat, node.lon]} pane="infra-icons" icon={makeContextInfraIcon(node)}>
                    <Tooltip direction="top" offset={[0, -13]}>
                        <span style={{ fontSize: 11 }}>
                            {node.name || node.type}
                            {node.distance_km != null ? ` · ${node.distance_km} km` : ""}
                        </span>
                    </Tooltip>
                </Marker>
            </Fragment>
        ))
    }, [surfaceContext])

    const contextReferencePoints = useMemo(() => ([
        ...(surfaceContext?.infra || []),
        ...dsData.airport.map(item => ({ name: item.name, lat: item.lat, lon: item.lon, type: "airport" })),
        ...dsData.port.map(item => ({ name: item.name, lat: item.lat, lon: item.lon, type: "port" })),
        ...dsData.power.map(item => ({ name: item.name, lat: item.lat, lon: item.lon, type: "power_plant" })),
        ...chokepointData.map(item => ({ name: item.name, lat: item.lat, lon: item.lon, type: "chokepoint" })),
    ]), [surfaceContext, dsData, chokepointData])

    const surfaceEnrichmentElements = useMemo(() => {
        const enrichment = surfaceEnrichment?.enrichment
        if (!enrichment || !selectedSurface) return null

        const countryFeatures = (names = []) => (
            names
                .map(name => findCountryByName(name, allCountriesGeo))
                .filter(Boolean)
                .filter((feature, index, arr) => arr.findIndex(other => other === feature) === index)
        )

        const relevantInfra = (enrichment.relevant_infrastructure || []).filter(node =>
            Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon))
        )
        const knownPoints = [...contextReferencePoints, ...relevantInfra]

        const resolvePoint = (name) => {
            const needle = (name || "").toLowerCase().trim()
            if (!needle) return null
            const match = knownPoints.find(point => (point.name || "").toLowerCase().includes(needle) || needle.includes((point.name || "").toLowerCase()))
            if (match) return [Number(match.lat), Number(match.lon)]
            const feature = findCountryByName(name, allCountriesGeo)
            return feature ? featureApproxCentroid(feature) : null
        }

        const aggressorFeatures = countryFeatures(enrichment.aggressor_entities || [])
        const affectedFeatures = countryFeatures(enrichment.affected_entities || [])

        return (
            <>
                {aggressorFeatures.map((feature, index) => (
                    <GeoJSON
                        key={`aggressor-country-${index}`}
                        pane="context-polygons"
                        data={feature}
                        style={{ color: "rgba(220,38,38,0.7)", weight: 1, opacity: 1, fill: true, fillColor: "rgba(220,38,38,0.04)", fillOpacity: 1 }}
                    />
                ))}
                {affectedFeatures.map((feature, index) => (
                    <GeoJSON
                        key={`affected-country-${index}`}
                        pane="context-polygons"
                        data={feature}
                        style={{ color: "rgba(217,119,6,0.6)", weight: 1, opacity: 1, fill: true, fillColor: "rgba(217,119,6,0.03)", fillOpacity: 1 }}
                    />
                ))}
                {(enrichment.highlight_chokepoints || []).map((name, index) => {
                    const cp = chokepointData.find(item => item.name?.toLowerCase() === name.toLowerCase())
                    if (!cp) return null
                    const poly = CHOKEPOINT_POLYS[cp.name]
                    if (poly) {
                        return (
                            <Polygon
                                key={`enrichment-chokepoint-${index}`}
                                positions={poly}
                                pane="context-polygons"
                                pathOptions={{ color: "rgba(13,148,136,0.6)", weight: 2, opacity: 1, fill: true, fillColor: "rgba(13,148,136,0.08)", fillOpacity: 1 }}
                            />
                        )
                    }
                    const [s, w2, n, e] = cp.polygon_bounds || []
                    if (![s, w2, n, e].every(Number.isFinite)) return null
                    return (
                        <Rectangle
                            key={`enrichment-chokepoint-${index}`}
                            bounds={[[s, w2], [n, e]]}
                            pane="context-polygons"
                            pathOptions={{ color: "rgba(13,148,136,0.6)", weight: 2, opacity: 1, dashArray: "5 4", fill: true, fillColor: "rgba(13,148,136,0.08)", fillOpacity: 1 }}
                        />
                    )
                })}
                {relevantInfra.map((node, index) => (
                    <Fragment key={`enrichment-infra-${index}`}>
                        <Polyline
                            positions={[[selectedSurface.lat, selectedSurface.lon], [Number(node.lat), Number(node.lon)]]}
                            pane="relation-lines"
                            pathOptions={{ color: "#2dd4bf", weight: 2, dashArray: "6 6", opacity: 0.75 }}
                        />
                        <Marker position={[Number(node.lat), Number(node.lon)]} pane="infra-icons" icon={makeContextInfraIcon(node)}>
                            <Tooltip direction="top" offset={[0, -13]}>
                                <span style={{ fontSize: 11 }}>{node.name || node.type}</span>
                            </Tooltip>
                        </Marker>
                    </Fragment>
                ))}
                {(enrichment.affected_shipping_routes || []).map((route, index) => {
                    const from = resolvePoint(route.from)
                    const to = resolvePoint(route.to)
                    if (!from || !to) return null
                    return (
                        <Polyline
                            key={`shipping-route-${index}`}
                            positions={[from, to]}
                            pane="relation-lines"
                            pathOptions={{ color: "rgba(251,146,60,0.95)", weight: 2.5, dashArray: "8 6", opacity: 1 }}
                        >
                            <Tooltip sticky>
                                <span style={{ fontSize: 10 }}>{route.reason || `${route.from} to ${route.to}`}</span>
                            </Tooltip>
                        </Polyline>
                    )
                })}
                {Array.isArray(enrichment.conflict_polygon) && enrichment.conflict_polygon.length >= 3 && (
                    <Polygon
                        positions={enrichment.conflict_polygon.map(([lat, lon]) => [lat, lon])}
                        pane="context-polygons"
                        pathOptions={{ color: "rgba(220,38,38,0.8)", weight: 1, dashArray: "6 5", opacity: 1, fill: true, fillColor: "rgba(220,38,38,0.08)", fillOpacity: 1 }}
                    />
                )}
            </>
        )
    }, [surfaceEnrichment, selectedSurface, contextReferencePoints, allCountriesGeo])

    // Conflict zones — AOI-scoped area surfaces derived from underlying events.
    const conflictZoneElements = useMemo(() => {
        if (!active.conflictZones || !conflictZones.length || zoom > 6) return null
        return conflictZones.map((z, i) => {
            const polygon = Array.isArray(z.polygon) ? z.polygon : []
            if (polygon.length < 3) return null
            const t = z.intensity  // 0–1
            const fillColor = t > 0.6 ? "#ef4444" : t > 0.3 ? "#f97316" : "#f59e0b"
            const pulseOpacity = t > 0.72 ? 0.1 : 0.04
            return (
                <Fragment key={z.id || i}>
                    <Polygon
                        positions={polygon}
                        pane="zone-surface"
                        pathOptions={{
                            fillColor,
                            fillOpacity: 0.06 + t * 0.16,
                            color: fillColor,
                            weight: 1.2,
                            opacity: 0.25 + t * 0.18,
                        }}
                        interactive={false}
                    />
                    <Polygon
                        positions={polygon}
                        pane="zone-surface"
                        pathOptions={{
                            fillColor,
                            fillOpacity: pulseOpacity,
                            color: fillColor,
                            weight: 3,
                            opacity: 0.08 + t * 0.1,
                        }}
                        interactive={false}
                    />
                </Fragment>
            )
        })
    }, [active.conflictZones, conflictZones, zoom])

    const osmInfraMarkers = useMemo(() => (
        Object.entries(infraData).flatMap(([category, features]) => (
            (features || []).map((feature, i) => {
                const pos = featureLatLon(feature)
                if (!pos) return null
                const props = feature.properties || {}
                return (
                    <Marker
                        key={`infra-${category}-${props.id || props.name || i}`}
                        position={pos}
                        pane="infra-icons"
                        icon={makeInfraIcon(category, props.name || props.operator || category)}
                        eventHandlers={{ click: () => { setInfraSelected({ feature, category }); setDsSelected(null); setImpactEvent(null); setNewsConflictSelected(null) } }}
                    >
                        <Tooltip direction="top" offset={[0, -14]}>
                            <span style={{ fontSize: 10 }}>{props.name || props.operator || INFRA_CATS[category]?.label || category}</span>
                        </Tooltip>
                    </Marker>
                )
            })
        ))
    ), [infraData])

    const airportMarkers = useMemo(() => (
        !active.airports || !dsActive.airport ? null : dsData.airport.map((item, i) => (
            <Marker
                key={`ap-${i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makeAirportIcon(item.name)}
                eventHandlers={{ click: () => { setDsSelected({ ...item, _id: `ap-${i}` }); setInfraSelected(null); setImpactEvent(null); setNewsConflictSelected(null) } }}
            >
                <Tooltip direction="top" offset={[0, -14]}>
                    <span style={{ fontSize: 10 }}>{item.icao} · {item.name}</span>
                </Tooltip>
            </Marker>
        ))
    ), [active.airports, dsActive.airport, dsData.airport])

    const portMarkers = useMemo(() => (
        !active.ports ? null : portsData.slice(0, 300).map((item, i) => (
            <Marker
                key={`pt-${i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makePortIcon(item.name)}
                eventHandlers={{ click: () => { setDsSelected({ ...item, infra_type: "port", _id: `pt-${i}` }); setInfraSelected(null); setImpactEvent(null); setNewsConflictSelected(null) } }}
            >
                <Tooltip direction="top" offset={[0, -12]}>
                    <span style={{ fontSize: 10 }}>{item.name}{item.country ? ` · ${item.country}` : ""}</span>
                </Tooltip>
            </Marker>
        ))
    ), [active.ports, portsData])

    const powerPlantMarkers = useMemo(() => (
        !active.powerPlants || !dsActive.power ? null : dsData.power.map((item, i) => (
            <Marker
                key={`pw-${i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makePowerIcon(item.name, item.primary_fuel)}
                eventHandlers={{ click: () => { setDsSelected({ ...item, _id: `pw-${i}` }); setInfraSelected(null); setImpactEvent(null); setNewsConflictSelected(null) } }}
            >
                <Tooltip direction="top" offset={[0, -14]}>
                    <span style={{ fontSize: 10 }}>{item.name} · {item.primary_fuel}{item.capacity_mw ? ` · ${item.capacity_mw}MW` : ""}</span>
                </Tooltip>
            </Marker>
        ))
    ), [active.powerPlants, dsActive.power, dsData.power])

    return (
        <div
            ref={mapContainerRef}
            className={[active.route ? "akili-route-active" : "", active.annotate && annotationMode ? "akili-annotate-active" : "", theaterDrawing ? "akili-theater-active" : ""].filter(Boolean).join(" ")}
            style={{ height: "100%", display: "flex", width: "100%", animation: "mapFadeIn 300ms ease forwards" }}
        >
            <style>{MAP_STYLES}</style>

            {/* Map area — flex:1, all overlays position relative to this */}
            <div style={{ flex: 1, minWidth: 0, position: "relative", height: "100%" }}>

            <MapContainer
                center={[15.0, 30.0]}
                zoom={4}
                style={{ height: "100%", width: "100%" }}
                zoomControl={true}
                preferCanvas={true}
            >
                <MapPaneSetup />
                <MapInstanceTracker mapRef={mapRef} />
                {mapType === "standard" && (
                    <TileLayer key="standard" url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                )}
                {mapType === "satellite" && (
                    <TileLayer
                        key="satellite"
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics"
                    />
                )}
                {mapType === "dark" && (
                    <TileLayer key="dark" url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                )}
                {mapType === "satellite" && satLabels && (
                    <TileLayer
                        key="sat-labels"
                        url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
                    />
                )}
                <ZoomTracker onZoom={setZoom} />
                <BoundsTracker onUpdate={setViewportBounds} onViewportChange={onViewportChange} />
                <FlyTo event={selected} />
                <UserLocationMarker />
                {/* Surface pool — operational signal surface beneath existing icons */}
                {active.heatmap && <SignalSurfaceLayer items={signalSurfaceItems} zoom={zoom} />}
                {conflictEventMarkers}
                {clusterMarkers}
                {individualMarkers}
                {surveillanceMarkers}
                {/* Severity radius circle + contextual overlays */}
                {severityCircle}
                {surfaceContextElements}
                {surfaceEnrichmentElements}
                {/* Conflict zone glows — GDELT regional aggregation */}
                {conflictZoneElements}
                <MapClickHandler
                    enabled={active.route}
                    origin={routeOrigin}
                    onOrigin={setRouteOrigin}
                    onDest={setRouteDest}
                />
                {/* Area click — fires at zoom ≤ 7 when not in route/annotation/theater mode */}
                <AreaClickHandler
                    enabled={!active.route && !annotationMode && !theaterDrawing && zoom <= 7}
                    onAreaClick={handleAreaClick}
                />

                {/* ── Country click layer ───────────────────────────────────── */}
                {allCountriesGeo && (
                    <GeoJSON
                        key="countries-click"
                        pane="country-click"
                        data={allCountriesGeo}
                        style={{ weight: 0, fillOpacity: 0.001, color: "transparent" }}
                        onEachFeature={(feature, layer) => {
                            layer.on("click", (e) => {
                                L.DomEvent.stopPropagation(e)
                                const name = feature.properties?.name || feature.properties?.ADMIN
                                if (name) {
                                    console.info("[country/click]", {
                                        name,
                                        code: feature.properties?.ISO_A3 || feature.properties?.iso_a3 || null,
                                    })
                                    setSelectedCountry(name)
                                    setAreaPopup(null)
                                    setInfraSelected(null)
                                    setImpactEvent(null)
                                    setNewsConflictSelected(null)
                                    ctxActivateCountry([feature])
                                    ctxStartFadeOut()
                                }
                            })
                        }}
                    />
                )}

                {/* ── Contextual country border (click / event selection) ───── */}
                {ctxBorderFeatures.map((f, i) => {
                    const name = f.properties?.ADMIN || f.properties?.name || i
                    const fade = ctxBorderVisible ? 1 : 0
                    return (
                        <Fragment key={`ctx-border-${name}-${fade}`}>
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 6, opacity: fade * 0.14, fill: true,  fillColor: "#0d9488", fillOpacity: fade * 0.045 }} />
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 3.5, opacity: fade * 0.34,  fill: false }} />
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#5eead4", weight: 1.2, opacity: fade * 1.0,  fill: false }} />
                        </Fragment>
                    )
                })}
                {/* Country name label at centroid */}
                {ctxBorderVisible && ctxBorderFeatures.map((f, i) => {
                    const centroid = featureApproxCentroid(f)
                    if (!centroid) return null
                    const name = f.properties?.ADMIN || f.properties?.name || ""
                    return (
                        <Marker
                            key={`ctx-label-${i}`}
                            position={centroid}
                            pane="country-labels"
                            interactive={false}
                            icon={L.divIcon({
                                className:  "",
                                iconAnchor: [0, 0],
                                html: `<div style="transform:translate(-50%,-50%);font:800 11px/1 system-ui,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#7dd3fc;text-shadow:0 0 2px rgba(0,0,0,0.95),0 0 8px rgba(0,0,0,0.95),0 0 14px rgba(0,0,0,0.9);white-space:nowrap;pointer-events:none;text-align:center;animation:mapFadeIn 0.4s ease">${name}</div>`,
                            })}
                        />
                    )
                })}
                {/* ── Contextual EEZ (maritime events) ─────────────────────── */}
                {ctxEezFeatures.map((f, i) => {
                    const name = f.properties?.TERRITORY1 || f.properties?.name || i
                    const fade = ctxBorderVisible ? 1 : 0
                    return (
                        <Fragment key={`ctx-eez-${name}-${fade}`}>
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 4, opacity: fade * 0.10, fill: true,  fillColor: "#0d9488", fillOpacity: fade * 0.03 }} />
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 2, opacity: fade * 0.5,  fill: false, dashArray: "6 4" }} />
                        </Fragment>
                    )
                })}

                {/* ── Profile focus-region persistent borders ───────────────── */}
                {!active.borders && profileBorderFeatures.map((f, i) => {
                    const name = f.properties?.ADMIN || f.properties?.name || i
                    return (
                        <Fragment key={`profile-border-${name}`}>
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 5, opacity: 0.11,  fill: true,  fillColor: "#0d9488", fillOpacity: 0.03 }} />
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#0d9488", weight: 2.5, opacity: 0.55,  fill: false }} />
                            <GeoJSON pane="context-polygons" data={f} style={{ color: "#5eead4", weight: 1.15, opacity: 0.92, fill: false, dashArray: "4 3" }} />
                        </Fragment>
                    )
                })}
                {/* Profile border country name labels */}
                {!active.borders && visibleProfileBorderFeatures.map((f, i) => {
                    const centroid = featureApproxCentroid(f)
                    if (!centroid) return null
                    const name = f.properties?.ADMIN || f.properties?.name || ""
                    return (
                        <Marker key={`profile-label-${i}`} position={centroid} pane="country-labels" interactive={false}
                            icon={L.divIcon({
                                className:  "",
                                iconAnchor: [0, 0],
                                html: `<div style="transform:translate(-50%,-50%);font:700 10px/1 system-ui,sans-serif;letter-spacing:0.10em;text-transform:uppercase;color:#5eead4;opacity:0.9;text-shadow:0 0 2px rgba(0,0,0,0.95),0 0 8px rgba(0,0,0,0.9);white-space:nowrap;pointer-events:none;text-align:center;">${name}</div>`,
                            })}
                        />
                    )
                })}

                {/* ── Profile focus EEZ baseline (situational only) ────────── */}
                {!active.eez && profileEezFeatures.map((f, i) => (
                    <GeoJSON
                        key={`profile-eez-${i}`}
                        pane="context-polygons"
                        data={f}
                        style={{
                            color: "#0d9488",
                            weight: 1,
                            opacity: 0.18,
                            dashArray: "6 4",
                            fill: true,
                            fillColor: "#0d9488",
                            fillOpacity: 0.015,
                        }}
                    />
                ))}

                {/* ── Global country borders when manually toggled on ───────── */}
                {active.borders && allCountriesGeo && (
                    <GeoJSON
                        pane="context-polygons"
                        data={allCountriesGeo}
                        style={{
                            color: borderGlowColor,
                            weight: 1.25,
                            opacity: 0.55,
                            fill: true,
                            fillColor: "#0d9488",
                            fillOpacity: 0.025,
                        }}
                    />
                )}

                {/* ── City Labels (static major cities, zoom-aware) ─────────── */}
                {active.cityLabels && zoom >= 4 && MAJOR_CITIES.map(c => (
                    <Marker key={c.name} position={[c.lat, c.lon]} interactive={false}
                        icon={L.divIcon({
                            className:  "",
                            iconAnchor: [0, 6],
                            html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;"><div style="width:4px;height:4px;border-radius:50%;background:#e2e8f0;opacity:0.7;"></div><div style="font:400 9px/1 system-ui,sans-serif;color:#e2e8f0;opacity:0.65;text-shadow:0 1px 3px rgba(0,0,0,0.95);white-space:nowrap;">${c.name}</div></div>`,
                        })}
                    />
                ))}

                {/* ── Global EEZ view when manually toggled on ──────────────── */}
                {active.eez && eezGeo && (
                    <GeoJSON
                        data={eezGeo}
                        style={{
                            color: "#0d9488",
                            weight: 1,
                            opacity: 0.35,
                            dashArray: "6 4",
                            fill: true,
                            fillColor: "#0d9488",
                            fillOpacity: 0.02,
                        }}
                    />
                )}

                {/* ── Airspace FIR ──────────────────────────────────────────── */}
                {active.airspace && tanzaniaGeo && (<>
                    <GeoJSON key="airspace-glow3" data={tanzaniaGeo} style={{ color: "#FFB300", weight: 6, opacity: 0.15, fill: false }} />
                    <GeoJSON key="airspace-glow2" data={tanzaniaGeo} style={{ color: "#FFB300", weight: 4, opacity: 0.3,  fill: false }} />
                    <GeoJSON key="airspace-core"  data={tanzaniaGeo} style={{ color: "#FFB300", weight: 2, opacity: 1.0,  fill: true, fillColor: "#FFB300", fillOpacity: 0.04 }} />
                </>)}

                {/* ── Submarine Cable Routes ────────────────────────────────── */}
                {active.cables && cableGeo.cables.map(feature => {
                    if (!feature.geometry) return null
                    const color = feature.properties.color || "#00cfff"
                    const name  = feature.properties.name
                    return feature.geometry.coordinates.map((line, i) => (
                        <Polyline
                            key={`${feature.properties.id}-${i}`}
                            positions={line.map(([lng, lat]) => [lat, lng])}
                            pathOptions={{ color, weight: 2, opacity: 0.6 }}
                        >
                            <Tooltip sticky>
                                <div style={{ fontSize: 11 }}><strong>{name}</strong></div>
                            </Tooltip>
                        </Polyline>
                    ))
                })}

                {/* ── Cable Landing Points ──────────────────────────────────── */}
                {active.cables && cableGeo.points.map(feature => {
                    if (!feature.geometry) return null
                    const [lng, lat]           = feature.geometry.coordinates
                    const { id, name, is_tbd } = feature.properties
                    const cableNames           = cableGeo.associations[id] || []
                    return (
                        <CircleMarker
                            key={id}
                            center={[lat, lng]}
                            radius={4}
                            pathOptions={{ fillColor: "#00cfff", fillOpacity: 0.9, color: "#fff", weight: 1 }}
                        >
                            <Popup>
                                <div style={{ fontSize: 11, lineHeight: 1.6, minWidth: 160 }}>
                                    <strong>{name}{is_tbd ? " (TBD)" : ""}</strong>
                                    {cableNames.length > 0
                                        ? <div style={{ marginTop: 4, color: "#555" }}>
                                            {cableNames.map(c => <div key={c}>· {c}</div>)}
                                          </div>
                                        : <div style={{ marginTop: 4, color: "#999", fontStyle: "italic" }}>
                                            Cable associations unavailable
                                          </div>
                                    }
                                </div>
                            </Popup>
                        </CircleMarker>
                    )
                })}

                {/* ── Pipeline lines ───────────────────────────────────────── */}
                {active.pipelines && pipelineGeoData.map((f, fi) => {
                    if (!f.geometry) return null
                    const p      = f.properties || {}
                    const t      = (p.type || "").toLowerCase()
                    const color  = t.includes("oil") ? "#d97706" : t.includes("lng") ? "#7c3aed" : "#0d9488"
                    const weight = t.includes("lng") ? 1.5 : 2
                    const dashed = (p.status || "").toLowerCase().includes("proposed")
                    const lines  = f.geometry.type === "MultiLineString" ? f.geometry.coordinates
                                 : f.geometry.type === "LineString"      ? [f.geometry.coordinates]
                                 : null
                    if (!lines) return null
                    return lines.map((line, li) => (
                        <Polyline
                            key={`pipe-${fi}-${li}`}
                            positions={line.map(([lng, lat]) => [lat, lng])}
                            pathOptions={{ color, weight, opacity: 0.75, dashArray: dashed ? "8 5" : undefined }}
                        >
                            <Tooltip sticky>
                                <div style={{ background:"rgba(14,20,32,0.9)", padding:"8px 10px", border:"1px solid rgba(255,255,255,0.1)", color:"#e8edf2", fontSize:12, borderRadius:4, maxWidth:260 }}>
                                    <strong style={{ color }}>{p.name || "Pipeline"}</strong>
                                    {p.operator && <div style={{ fontSize:11, color:"rgba(232,237,242,0.6)", marginTop:2 }}>{p.operator}</div>}
                                    <div style={{ fontSize:10, color:"rgba(232,237,242,0.5)", marginTop:3 }}>
                                        {[p.type, p.status, p.countries].filter(Boolean).join(" · ")}
                                    </div>
                                </div>
                            </Tooltip>
                        </Polyline>
                    ))
                })}

                {/* ── Shipping Lanes ────────────────────────────────────────── */}
                {active.shippingLanes && _SHIPPING_LANES.map((lane, li) => {
                    const isMajor = lane.type === "major"
                    return (
                        <Polyline
                            key={`sl-${li}`}
                            positions={lane.coords}
                            pathOptions={{
                                color:     isMajor ? "rgba(13,148,136,0.45)" : "rgba(13,148,136,0.25)",
                                weight:    isMajor ? lane.weight : lane.weight - 0.5,
                                opacity:   1,
                                dashArray: isMajor ? undefined : "8 6",
                            }}
                        >
                            <Tooltip sticky>
                                <div style={{ fontSize: 11 }}><strong>{lane.name}</strong></div>
                            </Tooltip>
                        </Polyline>
                    )
                })}

                {/* ── Deployments layer ─────────────────────────────────────── */}
                {active.deployments && deploymentsData && (() => {
                    const allCsgs    = deploymentsData.carrier_strike_groups || []
                    const allArgs    = deploymentsData.amphibious_ready_groups || []
                    const allSurface = deploymentsData.notable_surface_units || []
                    return (
                        <>
                            {allCsgs.map(csg => {
                                const zones      = CARRIER_ZONES[csg.class] || CARRIER_ZONES["Nimitz-class"]
                                const isSelected = selectedDeployment?.name === csg.name
                                const isHovered  = hoveredDeploymentName === csg.name
                                const isActive   = (isSelected || isHovered) && deploymentZonesVisible
                                // zoom < 5: no circles; zoom 5+: show all 3 zones for active
                                const showStrike = isActive && zoom >= 5
                                const showAll3   = isActive && zoom >= 5
                                const showLabels = isActive && zoom >= 6
                                return (
                                    <Fragment key={csg.name}>
                                        {/* Strike radius — visible at zoom 7+ for hovered/selected */}
                                        {/* Strike radius — amber dashed, 2px */}
                                        {showStrike && (
                                            <Circle
                                                center={[csg.lat, csg.lon]}
                                                radius={zones.strike_km * 1000}
                                                renderer={_depCanvasRenderer}
                                                pathOptions={{ color: "#f97316", weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: "8 5" }}
                                                interactive={false}
                                            />
                                        )}
                                        {/* NFZ — solid red, 2px */}
                                        {showAll3 && (
                                            <Circle
                                                center={[csg.lat, csg.lon]}
                                                radius={zones.nfz_km * 1000}
                                                renderer={_depCanvasRenderer}
                                                pathOptions={{ color: "#ef4444", weight: 2, opacity: 0.7, fillColor: "#ef4444", fillOpacity: 0.06 }}
                                                interactive={false}
                                            />
                                        )}
                                        {/* Extended — dashed white, 1px */}
                                        {showAll3 && (
                                            <Circle
                                                center={[csg.lat, csg.lon]}
                                                radius={zones.extended_km * 1000}
                                                renderer={_depCanvasRenderer}
                                                pathOptions={{ color: "#ffffff", weight: 1, opacity: 0.3, fillOpacity: 0, dashArray: "4 8" }}
                                                interactive={false}
                                            />
                                        )}
                                        {/* Zone label at bearing 0 — zoom >= 7 for active CSG */}
                                        {showLabels && (() => {
                                            const strikeLat = csg.lat + (zones.strike_km / 6371) * (180 / Math.PI)
                                            return (
                                                <Marker
                                                    position={[strikeLat, csg.lon]}
                                                    icon={L.divIcon({ className: "", html: `<div style="font-size:9px;color:#f97316;white-space:nowrap;text-shadow:0 1px 3px #000">Strike ${Math.round(zones.strike_km)}km</div>`, iconAnchor: [24, 0] })}
                                                    interactive={false}
                                                />
                                            )
                                        })()}
                                        {/* Carrier marker */}
                                        <Marker
                                            position={[csg.lat, csg.lon]}
                                            icon={makeCarrierDivIcon(csg, zoom)}
                                            eventHandlers={{
                                                click:     () => setSelectedDeployment({ ...csg, _type: "csg" }),
                                                mouseover: () => setHoveredDeploymentName(csg.name),
                                                mouseout:  () => setHoveredDeploymentName(null),
                                            }}
                                        >
                                            {zoom < 8 && (
                                                <Tooltip direction="top" offset={[0, -22]} opacity={0.9}>
                                                    <div style={{ fontSize: 11 }}><strong>{csg.flagship}</strong><br />{csg.theater}</div>
                                                </Tooltip>
                                            )}
                                        </Marker>
                                    </Fragment>
                                )
                            })}
                            {allArgs.map(arg => (
                                <Marker
                                    key={arg.name}
                                    position={[arg.lat, arg.lon]}
                                    icon={makeArgDivIcon(arg)}
                                    eventHandlers={{ click: () => setSelectedDeployment({ ...arg, _type: "arg" }) }}
                                >
                                    <Tooltip direction="top" offset={[0, -18]} opacity={0.9}>
                                        <div style={{ fontSize: 11 }}><strong>{arg.flagship}</strong><br />{arg.theater}</div>
                                    </Tooltip>
                                </Marker>
                            ))}
                            {allSurface.map(su => (
                                <Marker
                                    key={su.name}
                                    position={[su.lat, su.lon]}
                                    icon={makeDestroyerDivIcon()}
                                    eventHandlers={{ click: () => setSelectedDeployment({ ...su, _type: "surface" }) }}
                                >
                                    <Tooltip direction="top" offset={[0, -14]} opacity={0.9}>
                                        <div style={{ fontSize: 11 }}><strong>{su.name}</strong><br />{su.theater}</div>
                                    </Tooltip>
                                </Marker>
                            ))}
                        </>
                    )
                })()}

                {/* ── ADS-B Aircraft ────────────────────────────────────────── */}
                {/* Isolated child: aircraft state + polling live in AircraftLayer
                    so setAircraft() ticks don't re-render MapPage or conflict markers. */}
                <AircraftLayer
                    visible={active.adsb}
                    showLabels={active.adsbLabels}
                    refreshRate={adsbRefreshRate}
                    boundsRef={viewportBoundsRef}
                    onCount={setAdsbCount}
                    polling={adsbLive}
                    activateKey={adsbActivateKey}
                />

                {/* ── Route planner — origin, dest pins + polyline ──────────── */}
                {active.route && routeOrigin && (
                    <Marker position={[routeOrigin.lat, routeOrigin.lon]} icon={makePinIcon("#22c55e")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>Origin</span>
                        </Tooltip>
                    </Marker>
                )}
                {active.route && routeDest && (
                    <Marker position={[routeDest.lat, routeDest.lon]} icon={makePinIcon("#ef4444")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>Destination</span>
                        </Tooltip>
                    </Marker>
                )}
                {/* Waypoint pins */}
                {active.route && waypoints.map((w, i) => (
                    <Marker key={i} position={[w.lat, w.lon]} icon={makePinIcon("#FFD600")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>WP {i + 1}</span>
                        </Tooltip>
                    </Marker>
                ))}
                {active.route && routeGeo && (
                    <Polyline
                        positions={routeGeo.map(([lon, lat]) => [lat, lon])}
                        pathOptions={{ color: routeColor, weight: 5, opacity: 0.88, lineCap: "round", lineJoin: "round" }}
                    />
                )}

                {/* ── OSM infrastructure markers ──────────────────────────── */}
                {osmInfraMarkers}

                {/* ── Dataset infrastructure markers ──────────────────────── */}
                {airportMarkers}
                {portMarkers}
                {powerPlantMarkers}

                {/* ── AIS live vessel markers ──────────────────────────────── */}
                {active.aisVessels && aisVessels.map((v, i) => (
                    v.lat != null && v.lon != null ? (
                        <Marker
                            key={`ais-${v.mmsi || i}`}
                            position={[v.lat, v.lon]}
                            icon={makeAisVesselIcon(v.ship_type, v.heading)}
                            eventHandlers={{ click: () => setSelectedAisVessel(v) }}
                        >
                            <Tooltip direction="top" offset={[0, -10]}>
                                <span style={{ fontSize:10 }}>
                                    {v.name || `MMSI ${v.mmsi}`}
                                    {v.ship_type ? ` · ${v.ship_type}` : ""}
                                    {v.speed != null ? ` · ${v.speed}kn` : ""}
                                    {v.destination ? ` → ${v.destination}` : ""}
                                </span>
                            </Tooltip>
                        </Marker>
                    ) : null
                ))}

                {/* ── Chokepoints layer — polygon outlines, toggled via layers panel ── */}
                {!active.chokepoints && profileChokepoints.map((cp, i) => (
                    <Fragment key={`profile-cp-${i}`}>
                        {CHOKEPOINT_POLYS[cp.name] ? (
                            <Polygon
                                positions={CHOKEPOINT_POLYS[cp.name]}
                                pathOptions={{
                                    fill: false,
                                    color: "#0d9488",
                                    weight: 1,
                                    opacity: 0.24,
                                    dashArray: "5 6",
                                }}
                                interactive={false}
                            />
                        ) : (
                            <Rectangle
                                bounds={[[cp.polygon_bounds[0], cp.polygon_bounds[1]], [cp.polygon_bounds[2], cp.polygon_bounds[3]]]}
                                pathOptions={{
                                    fill: false,
                                    color: "#0d9488",
                                    weight: 1,
                                    opacity: 0.24,
                                    dashArray: "5 6",
                                }}
                                interactive={false}
                            />
                        )}
                        <Marker
                            position={[cp.lat, cp.lon]}
                            interactive={false}
                            icon={L.divIcon({
                                className: "",
                                html: `<div style="background:transparent;color:#0d9488;font-size:9px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;opacity:0.55;text-shadow:0 0 4px rgba(0,0,0,0.75);pointer-events:none">${cp.name}</div>`,
                                iconSize: [120, 14],
                                iconAnchor: [60, 7],
                            })}
                        />
                    </Fragment>
                ))}
                {active.chokepoints && chokepointData.map((cp, i) => {
                    // Highlight if referenced in area analysis
                    const highlighted = areaAnalysis?.enrichment?.highlight_chokepoints?.some(
                        n => n.toLowerCase() === cp.name.toLowerCase()
                    )
                    const statusColor = cp.current_status === "disrupted" ? "#ef4444"
                        : cp.current_status === "elevated" ? "#f59e0b"
                        : highlighted ? "#FF6D00" : "#0d9488"
                    const poly = CHOKEPOINT_POLYS[cp.name]
                    const [s, w2, n, e] = cp.polygon_bounds
                    return (
                        <Fragment key={`cp-${i}`}>
                            {poly ? (
                                <Polygon
                                    positions={poly}
                                    pathOptions={{
                                        fill:        highlighted,
                                        fillColor:   statusColor,
                                        fillOpacity: highlighted ? 0.08 : 0,
                                        color:       statusColor,
                                        weight:      highlighted ? 2 : 1,
                                        opacity:     highlighted ? 0.85 : 0.4,
                                    }}
                                    eventHandlers={{ click: () => setChokepointSelected(cp) }}
                                />
                            ) : (
                                <Rectangle
                                    bounds={[[s, w2], [n, e]]}
                                    pathOptions={{
                                        fill:        highlighted,
                                        fillColor:   statusColor,
                                        fillOpacity: highlighted ? 0.08 : 0,
                                        color:       statusColor,
                                        weight:      highlighted ? 2 : 1,
                                        dashArray:   highlighted ? undefined : "4 5",
                                        opacity:     highlighted ? 0.85 : 0.4,
                                    }}
                                    eventHandlers={{ click: () => setChokepointSelected(cp) }}
                                />
                            )}
                            <Marker
                                position={[cp.lat, cp.lon]}
                                icon={L.divIcon({
                                    className: "",
                                    html: `<div style="background:transparent;color:${statusColor};font-size:${highlighted ? 10 : 9}px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.8),0 0 8px rgba(0,0,0,0.6);pointer-events:none${highlighted ? ";text-decoration:underline" : ""}">${cp.name}</div>`,
                                    iconSize:  [120, 16],
                                    iconAnchor:[60, 8],
                                })}
                                eventHandlers={{ click: () => setChokepointSelected(cp) }}
                            />
                        </Fragment>
                    )
                })}

                {/* ── News conflict markers — click opens NewsConflictPanel ────── */}
                {active.newsConflicts && newsConflictsData.map((m, i) => (
                    <Marker
                        key={i}
                        position={[m.lat, m.lon]}
                        pane="event-icons"
                        icon={_newsConflictIcon}
                        eventHandlers={{ click: () => { setNewsConflictSelected(m); setImpactEvent(null); setInfraSelected(null) } }}
                    >
                        <Tooltip direction="top" offset={[0, -10]}>
                            <span style={{ fontSize: 10 }}>{m.headline?.length > 80 ? m.headline.slice(0, 80) + '…' : m.headline}</span>
                        </Tooltip>
                    </Marker>
                ))}

                {/* ── POI profile markers ───────────────────────────────────── */}
                {active.poi && poiData.map((poi) => (
                    <Marker
                        key={poi.id}
                        position={[poi.lat, poi.lon]}
                        icon={makePoiIcon(poi, API)}
                        eventHandlers={{ click: () => setSelectedPoiMarker(poi) }}
                    >
                        <Tooltip direction="top" offset={[0, -26]}>
                            <span style={{ fontSize: 10 }}>{poi.name}{poi.tag ? ` · ${poi.tag}` : ""}</span>
                        </Tooltip>
                    </Marker>
                ))}

                {/* ── POI floating card overlay */}
                {active.poi && selectedPoiMarker?.lat && selectedPoiMarker?.lon && (
                    <PoiOverlay
                        poi={selectedPoiMarker}
                        onClose={() => setSelectedPoiMarker(null)}
                        apiBase={API}
                    />
                )}

                {/* ── Contextual intelligence overlays (event-triggered) ───── */}
                {impactEvent && contextualItems.filter(it => !it._isPoi).map((item, idx) => {
                    if (!item?.lat || !item?.lon) return null
                    const evLat = +impactEvent.lat
                    const evLon = +(impactEvent.lng || impactEvent.lon)
                    const catCfg = INFRA_CATS.find(c => c.id === item._category) || {}
                    const lineColor = catCfg.color || "#00BCD4"
                    return (
                        <Fragment key={`ctx-infra-${idx}`}>
                            <Polyline
                                positions={[[evLat, evLon], [+item.lat, +item.lon]]}
                                pathOptions={{ color: lineColor, weight: 1.5, opacity: 0.45, dashArray: "4 4" }}
                            />
                            <CircleMarker
                                center={[+item.lat, +item.lon]}
                                radius={5}
                                pathOptions={{ color: lineColor, fillColor: lineColor, fillOpacity: 0.85, weight: 1.5 }}
                            >
                                <Tooltip direction="top" offset={[0, -8]}>
                                    <span style={{ fontSize: 10 }}>{item.name || item.type || item._category} · {item._distance_km?.toFixed(1)}km</span>
                                </Tooltip>
                            </CircleMarker>
                        </Fragment>
                    )
                })}
                {impactEvent && contextualItems.filter(it => it._isPoi).map((item, idx) => {
                    if (!item?.lat || !item?.lon) return null
                    const evLat = +impactEvent.lat
                    const evLon = +(impactEvent.lng || impactEvent.lon)
                    return (
                        <Fragment key={`ctx-poi-${idx}`}>
                            <Polyline
                                positions={[[evLat, evLon], [+item.lat, +item.lon]]}
                                pathOptions={{ color: "#FFB300", weight: 1.5, opacity: 0.55, dashArray: "3 3" }}
                            />
                            <Marker position={[+item.lat, +item.lon]} icon={makePoiIcon(item, API)}>
                                <Tooltip direction="top" offset={[0, -22]}>
                                    <span style={{ fontSize: 10 }}>{item.name} · {item.tag} · {item._distance_km?.toFixed(1)}km</span>
                                </Tooltip>
                            </Marker>
                        </Fragment>
                    )
                })}

                {/* ── POI relation lines — glow effect ─────────────────────── */}
                {active.poi && selectedPoiMarker && (selectedPoiMarker.relations || []).map((rel, i) => {
                    if (!rel?.poi_id || !rel?.relation_type) return null
                    const target = poiData.find(p => p.id === rel.poi_id)
                    if (!target?.lat || !target?.lon) return null
                    const relColor = _POI_REL_COLOR[rel.relation_type] || "#6b7280"
                    return (
                        <Fragment key={i}>
                            <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [target.lat, target.lon]]} pathOptions={{ color: relColor, weight: 8, opacity: 0.15 }} />
                            <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [target.lat, target.lon]]} pathOptions={{ color: relColor, weight: 3, opacity: 0.9 }} />
                        </Fragment>
                    )
                })}

                {/* ── POI home/work address markers ────────────────────────── */}
                {active.poi && selectedPoiMarker?.home_lat && selectedPoiMarker?.home_lon && (
                    <>
                        <Marker position={[selectedPoiMarker.home_lat, selectedPoiMarker.home_lon]} icon={_homeIcon}>
                            <Tooltip direction="top" offset={[0, -16]}><span style={{ fontSize: 10 }}>Home{selectedPoiMarker.home_address ? ` — ${selectedPoiMarker.home_address}` : ""}</span></Tooltip>
                        </Marker>
                        {selectedPoiMarker.lat && <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [selectedPoiMarker.home_lat, selectedPoiMarker.home_lon]]} pathOptions={{ color: "#0d9488", weight: 1.5, dashArray: "5 5", opacity: 0.5 }} />}
                    </>
                )}
                {active.poi && selectedPoiMarker?.work_lat && selectedPoiMarker?.work_lon && (
                    <>
                        <Marker position={[selectedPoiMarker.work_lat, selectedPoiMarker.work_lon]} icon={_workIcon}>
                            <Tooltip direction="top" offset={[0, -16]}><span style={{ fontSize: 10 }}>Work{selectedPoiMarker.occupation_address ? ` — ${selectedPoiMarker.occupation_address}` : ""}</span></Tooltip>
                        </Marker>
                        {selectedPoiMarker.lat && <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [selectedPoiMarker.work_lat, selectedPoiMarker.work_lon]]} pathOptions={{ color: "#d97706", weight: 1.5, dashArray: "5 5", opacity: 0.5 }} />}
                    </>
                )}

                {/* ── Temp address marker ───────────────────────────────────── */}
                {tempMarker && (
                    <Marker position={[tempMarker.lat, tempMarker.lon]} icon={makePinIcon("#ffffff")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>{tempMarker.label || "Location"}</span>
                        </Tooltip>
                    </Marker>
                )}

                {/* ── Webcam markers ────────────────────────────────────────── */}
                {active.webcams && WEBCAM_LOCATIONS.map(cam => (
                    <Marker
                        key={cam.id}
                        position={[cam.lat, cam.lon]}
                        icon={_webcamIcon}
                        eventHandlers={{ click: () => setActiveWebcam(cam.id) }}
                    >
                        <Tooltip direction="top" offset={[0, -14]}>
                            <span style={{ fontSize: 10 }}>{cam.name} · {cam.city}</span>
                        </Tooltip>
                        <Popup
                            offset={[0, -14]}
                            closeButton={false}
                            autoPan={false}
                            className="webcam-popup"
                            eventHandlers={{ remove: () => setActiveWebcam(null) }}
                        >
                            <div style={{
                                background: "rgba(13,17,28,0.97)",
                                borderRadius: 10,
                                overflow: "hidden",
                                width: 320,
                                fontFamily: "'Inter','Segoe UI',sans-serif",
                                border: "1px solid rgba(255,179,0,0.3)",
                                boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
                            }}>
                                <div style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "8px 10px",
                                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                                    background: "rgba(255,255,255,0.04)",
                                }}>
                                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600, letterSpacing: "0.06em" }}>CAM</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{cam.name}</div>
                                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{cam.city}</div>
                                    </div>
                                </div>
                                <iframe
                                    key={activeWebcam === cam.id ? cam.id : `${cam.id}-unloaded`}
                                    src={activeWebcam === cam.id
                                        ? `https://www.youtube.com/embed/${cam.youtubeId}?autoplay=1&mute=0&controls=1&rel=0&modestbranding=1`
                                        : "about:blank"}
                                    title={cam.name}
                                    allow="autoplay; encrypted-media; fullscreen"
                                    allowFullScreen
                                    style={{ display: "block", width: "100%", height: 180, border: "none" }}
                                />
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {/* ── Satellite image overlays + amber border rectangles ─────── */}
                {active.satellite && satelliteResults.map(tile => {
                    if (!satelliteSelected[tile.id]) return null
                    const [west, south, east, north] = tile.bbox
                    const bounds = [[south, west], [north, east]]
                    const dt = tile.datetime ? tile.datetime.slice(0, 10) : ""
                    const cogTileUrl = dt
                        ? `${API}/satellite/tile/{z}/{x}/{y}.png?dt=${dt}`
                        : null
                    return (
                        <Fragment key={tile.id}>
                            {cogTileUrl
                                ? <TileLayer url={cogTileUrl} opacity={0.9} zIndex={300} />
                                : <ImageOverlay url={tile.thumbnail} bounds={bounds} opacity={0.85} zIndex={300} />
                            }
                            <Rectangle
                                bounds={bounds}
                                pathOptions={{ color: "#FFB300", weight: 2, fillColor: "transparent", fillOpacity: 0 }}
                                eventHandlers={{ click: () => setSatelliteInfoItem(tile) }}
                            >
                                <Tooltip direction="top">
                                    <span style={{ fontSize: 10 }}>
                                        {tile.tile_id} · {tile.datetime ? new Date(tile.datetime).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                                        {tile.cloud_cover != null ? `  ☁ ${Math.round(tile.cloud_cover)}%` : ""}
                                    </span>
                                </Tooltip>
                            </Rectangle>
                        </Fragment>
                    )
                })}

                {/* ── Annotation map handler + in-progress zone preview ─────── */}
                {active.annotate && (
                    <AnnotationMapHandler
                        mode={annotationMode}
                        zoneInProgress={zoneInProgress}
                        onPoint={handleAnnotationPoint}
                        onZoneVertex={handleZoneVertex}
                        onZoneClose={handleZoneClose}
                        onEscape={handleAnnotationEscape}
                    />
                )}
                {active.annotate && zoneInProgress.length > 0 && (
                    <>
                        <Polyline positions={zoneInProgress} pathOptions={{ color: "#FFB300", weight: 2, opacity: 0.7, dashArray: "6 4" }} />
                        {zoneInProgress.map((v, i) => (
                            <CircleMarker key={i} center={v} radius={4} pathOptions={{ fillColor: "#FFB300", fillOpacity: 0.85, color: "#fff", weight: 1 }} />
                        ))}
                    </>
                )}

                {/* ── Annotation zones ──────────────────────────────────────── */}
                {active.annotate && annotations.zones.map(z => (
                    <Polygon
                        key={z.id}
                        positions={z.vertices}
                        pathOptions={{ color: ZONE_COLOURS[z.type] || "#888", weight: 2, dashArray: z.type === "Exclusion" ? "8 4" : null, fillColor: ZONE_COLOURS[z.type] || "#888", fillOpacity: z.opacity || 0.35 }}
                        eventHandlers={{ click: () => setSelectedAnnotation(z) }}
                    >
                        <Tooltip><span style={{ fontSize: 10 }}>{z.label}</span></Tooltip>
                    </Polygon>
                ))}

                {/* ── Annotation links ──────────────────────────────────────── */}
                {annotations.links.map(lk => {
                    const allAnns = [...annotations.points, ...annotations.zones]
                    const src = allAnns.find(a => a.id === lk.sourceId)
                    const tgt = allAnns.find(a => a.id === lk.targetId)
                    if (!src || !tgt) return null
                    const sp = annotationCenter(src)
                    const tp = annotationCenter(tgt)
                    if (!sp || !tp) return null
                    return (
                        <Polyline key={lk.id} positions={[sp, tp]} pathOptions={{ color: "#FFB300", weight: 2, opacity: 0.75, dashArray: "8 5" }}
                            eventHandlers={{ click: () => setSelectedAnnotation(lk) }}
                        >
                            <Tooltip><span style={{ fontSize: 10 }}>{lk.relationship}</span></Tooltip>
                        </Polyline>
                    )
                })}

                {/* ── Annotation points ─────────────────────────────────────── */}
                {annotations.points.map(pt => (
                    <Marker
                        key={pt.id}
                        position={[pt.lat, pt.lng]}
                        icon={makeAnnotationPointIcon(CLASSIF_COLOURS[pt.classification] || "#888")}
                        eventHandlers={{ click: () => annotationMode === "link" ? handleLinkClick(pt) : setSelectedAnnotation(pt) }}
                    >
                        <Tooltip direction="top" offset={[0, -11]}><span style={{ fontSize: 10 }}>{pt.title}</span></Tooltip>
                    </Marker>
                ))}

                {/* ── Theater draw mode + situation theater polygon ─────────── */}
                <TheaterMapHandler
                    enabled={theaterDrawing}
                    pts={theaterPts}
                    onVertex={(lat, lon) => setTheaterPts(prev => [...prev, [lat, lon]])}
                    onClose={() => {
                        if (theaterPts.length >= 3 && onTheaterDrawEnd) onTheaterDrawEnd(theaterPts)
                        setTheaterPts([])
                    }}
                />
                {theaterDrawing && theaterPts.length > 0 && (
                    <>
                        <Polyline positions={theaterPts} pathOptions={{ color: "#a855f7", weight: 2, opacity: 0.85, dashArray: "6 4" }} />
                        {theaterPts.map((v, i) => (
                            <CircleMarker key={i} center={v} radius={4} pathOptions={{ fillColor: "#a855f7", fillOpacity: 0.9, color: "#fff", weight: 1 }} />
                        ))}
                    </>
                )}
                {activeSituation?.theater?.length >= 3 && (() => {
                    const color = activeSituation.color || "#a855f7"
                    return (
                        <Polygon
                            key={`sit-theater-${activeSituation.id}`}
                            positions={activeSituation.theater}
                            pathOptions={{ color, weight: 1.5, dashArray: "8 5", fill: true, fillColor: color, fillOpacity: 0.07, opacity: 0.7 }}
                        >
                            <Tooltip sticky><span style={{ fontSize: 10, fontWeight: 600 }}>{activeSituation.name} — Theater</span></Tooltip>
                        </Polygon>
                    )
                })()}

                {/* ── Satellite tracking markers ────────────────────────────── */}
                {active.sattrack && satPositions
                    .filter(sat => zoom >= 5 || sat.category === "Space Stations" || isSatImagery(sat))
                    .map(sat => {
                        const pulse = isSatImagery(sat)
                        return (
                            <Marker
                                key={sat.norad_id || sat.name}
                                position={[sat.lat, sat.lng]}
                                icon={makeSatIcon(SAT_COLOURS[sat.category] || "#BB86FC", pulse)}
                                eventHandlers={{ click: () => setSelectedSat(sat) }}
                            >
                                <Tooltip direction="top" offset={[0, -6]}>
                                    <span style={{ fontSize: 10 }}>{sat.flag} {sat.name}</span>
                                </Tooltip>
                            </Marker>
                        )
                    })
                }

            </MapContainer>

            {/* ── Conflict zones loading indicator ──────────────────────────── */}
            {conflictZonesLoading && (
                <div style={{
                    position:       "absolute",
                    top:            14,
                    left:           "50%",
                    transform:      "translateX(-50%)",
                    background:     "rgba(10,10,10,0.65)",
                    color:          "#fff",
                    padding:        "5px 14px",
                    fontSize:       11,
                    letterSpacing:  "0.05em",
                    zIndex:         1500,
                    pointerEvents:  "none",
                    backdropFilter: "blur(4px)",
                }}>
                    Loading events…
                </div>
            )}

            {/* ── Toast notification ────────────────────────────────────────── */}
            {toastInfo && (
                <div
                    key={toastInfo.key}
                    style={{
                        position:       "absolute",
                        bottom:         56,
                        left:           "50%",
                        transform:      "translateX(-50%)",
                        ...GLASS,
                        borderRadius:   20,
                        color:          "rgba(255,255,255,0.75)",
                        padding:        "6px 18px",
                        fontSize:       11,
                        letterSpacing:  "0.05em",
                        zIndex:         1600,
                        pointerEvents:  "none",
                        animation:      "toastLife 2.2s ease forwards",
                        whiteSpace:     "nowrap",
                    }}
                >
                    {toastInfo.count} events loaded
                </div>
            )}

            {/* ── Country info + news panel ─────────────────────────────────── */}
            {selectedCountry && (
                <div style={{
                    position:  "absolute",
                    top:       0,
                    right:     0,
                    bottom:    0,
                    width:     300,
                    zIndex:    500,
                    background: "rgba(14,20,32,0.95)",
                    backdropFilter: "blur(20px) saturate(1.4)",
                    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                    borderLeft: "1px solid rgba(255,255,255,0.07)",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                }}>
                    <CountryPanel
                        country={selectedCountry}
                        data={countryData}
                        loading={countryLoading}
                        onClose={() => { setSelectedCountry(null); setCountryData(null) }}
                    />
                </div>
            )}

            {/* ── Impact Panel — on-demand event analysis ───────────────────── */}
            {impactEvent && (
                <ImpactPanel
                    event={impactEvent}
                    cachedAnalysis={impactAnalysisCache}
                    analysing={impactAnalysing}
                    onAnalyse={analyseImpact}
                    onClose={() => setImpactEvent(null)}
                    contextualItems={contextualItems}
                    contextualLoading={contextualLoading}
                    contextualAdsbFlag={contextualAdsbFlag}
                    contextualNoCacheMsg={contextualNoCacheMsg}
                    onEnableAdsb={activateAdsb}
                />
            )}

            {/* ── Deployment Detail Card ────────────────────────────────────── */}
            {selectedDeployment && (
                <DeploymentCard
                    deployment={selectedDeployment}
                    zonesVisible={deploymentZonesVisible}
                    onToggleZones={() => setDeploymentZonesVisible(v => !v)}
                    onClose={() => setSelectedDeployment(null)}
                />
            )}

            {/* ── News Conflict Panel — on-demand news marker analysis ────────── */}
            {newsConflictSelected && (
                <NewsConflictPanel
                    marker={newsConflictSelected}
                    cachedAnalysis={newsConflictAnalysisCache}
                    analysing={newsConflictAnalysing}
                    onAnalyse={analyseNewsConflict}
                    onClose={() => setNewsConflictSelected(null)}
                />
            )}

            {/* ── Infrastructure Panel — on-demand facility analysis ─────────── */}
            {infraSelected && (
                <InfraPanel
                    feature={infraSelected.feature}
                    category={infraSelected.category}
                    cachedAnalysis={infraAnalysisCache}
                    analysing={infraAnalysing}
                    onAnalyse={analyseInfra}
                    onClose={() => setInfraSelected(null)}
                />
            )}
            {dsSelected && !infraSelected && (
                <DsInfraPanel
                    item={dsSelected}
                    onClose={() => setDsSelected(null)}
                />
            )}
            {chokepointSelected && !infraSelected && !dsSelected && (
                <ChokepointPanel
                    cp={chokepointSelected}
                    onClose={() => setChokepointSelected(null)}
                />
            )}
            {selectedAisVessel && (
                <AisVesselPanel
                    vessel={selectedAisVessel}
                    onClose={() => setSelectedAisVessel(null)}
                />
            )}

            {/* ── Area popup — headline summary on heatmap click ─────────────── */}
            {areaPopup && !areaAnalysis && (
                <AreaPopupPanel
                    popup={areaPopup}
                    analysing={areaAnalysing}
                    onAnalyse={analyseArea}
                    onClose={() => { setAreaPopup(null); setAreaAnalysis(null) }}
                />
            )}
            {/* ── Area analysis panel — full Claude enrichment ─────────────────── */}
            {areaPopup && areaAnalysis && (
                <AreaAnalysisPanel
                    analysis={areaAnalysis}
                    locationName={areaPopup.locationName}
                    onClose={() => { setAreaPopup(null); setAreaAnalysis(null) }}
                />
            )}

            {/* ── Route Intelligence Panel ──────────────────────────────────── */}
            {active.route && (routeLoading || routeInfo) && (
                <RoutePanel
                    routeInfo={routeInfo}
                    routeAnalysis={routeAnalysis}
                    routeAnalysing={routeAnalysing}
                    onAnalyseRoute={analyseRoute}
                    loading={routeLoading}
                    steps={routeSteps}
                    corridorData={corridorData}
                    showAlternatives={showAlternatives}
                    altRoutes={altRoutes}
                    onRequestAlternative={requestAlternatives}
                    onClose={() => {
                        setRouteOrigin(null); setRouteDest(null)
                        setRouteGeo(null); setRouteInfo(null); setRouteAnalysis(null)
                        setRouteSteps([]); setCorridorData(null)
                    }}
                />
            )}

            {/* ── Route Input Panel — geocoding fields ──────────────────────── */}
            {active.route && (
                <RouteInputPanel
                    fromInput={fromInput}     setFromInput={setFromInput}
                    toInput={toInput}         setToInput={setToInput}
                    fromSuggestions={fromSuggestions} setFromSuggestions={setFromSuggestions}
                    toSuggestions={toSuggestions}     setToSuggestions={setToSuggestions}
                    waypoints={waypoints}     setWaypoints={setWaypoints}
                    routeOrigin={routeOrigin} setRouteOrigin={setRouteOrigin}
                    routeDest={routeDest}     setRouteDest={setRouteDest}
                    geocode={geocode}
                    onClear={() => {
                        setRouteOrigin(null); setRouteDest(null); setWaypoints([])
                        setFromInput(""); setToInput("")
                        setRouteGeo(null); setRouteInfo(null); setRouteAnalysis(null)
                        setRouteSteps([]); setCorridorData(null)
                    }}
                />
            )}

            {/* ── Live TV Widget ─────────────────────────────────────────────── */}
            {active.tv && (
                <TVWidget
                    onClose={() => setActive(a => ({ ...a, tv: false }))}
                    containerRef={mapContainerRef}
                />
            )}

            {/* ── Satellite tile info panel ───────────────────────────────────── */}
            {active.satellite && satelliteInfoItem && (
                <div style={{
                    position: "absolute", top: 16, right: 16,
                    ...GLASS,
                    width: 280, zIndex: 2100,
                    padding: "12px 14px",
                    fontSize: 11,
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 8 }}>
                        <span style={{ fontSize: 9, color: "#00E5FF", fontWeight: 700, letterSpacing: "0.08em" }}>SAT</span>
                        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, color: "#00E5FF", letterSpacing: "0.04em", textTransform: "uppercase" }}>Sentinel-2 L2A</span>
                        <button onClick={() => setSatelliteInfoItem(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                    {[
                        ["Platform",    satelliteInfoItem.platform || "—"],
                        ["Tile",        satelliteInfoItem.tile_id  || "—"],
                        ["Acquired",    satelliteInfoItem.datetime ? new Date(satelliteInfoItem.datetime).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "—"],
                        ["Cloud cover", satelliteInfoItem.cloud_cover != null ? `${Math.round(satelliteInfoItem.cloud_cover)}%` : "N/A"],
                        ["Resolution",  "10m"],
                        ["Source",      satelliteInfoItem.source || "ESA / Copernicus"],
                    ].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
                            <span style={{ color: "rgba(255,255,255,0.4)", minWidth: 80, flexShrink: 0 }}>{k}</span>
                            <span style={{ color: "#e0e0e0" }}>{v}</span>
                        </div>
                    ))}
                    <div style={{ marginBottom: 8 }}>
                        <span style={{ color: "rgba(255,255,255,0.4)", minWidth: 80, display: "inline-block" }}>Product ID</span>
                        <span style={{ color: "#e0e0e0", fontSize: 9, wordBreak: "break-all" }}>{satelliteInfoItem.id}</span>
                    </div>
                    {satelliteAuthMode === "copernicus_oauth" ? (
                        <div style={{ padding: "7px 9px", background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 6, fontSize: 10, color: "rgba(34,197,94,0.95)", lineHeight: 1.5 }}>
                            ✓ Copernicus authentication active. Overlay uses quicklook imagery in this viewer.
                        </div>
                    ) : (
                        <div style={{ padding: "7px 9px", background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.2)", borderRadius: 6, fontSize: 10, color: "rgba(255,179,0,0.8)", lineHeight: 1.5 }}>
                            ⚠ Public mode fallback. Copernicus authentication unavailable for this search.
                        </div>
                    )}
                </div>
            )}

            {/* ── Annotation toolbar ───────────────────────────────────────── */}
            {active.annotate && (
                <div style={{
                    position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                    ...GLASS, zIndex: 2200, display: "flex", alignItems: "center", gap: 4,
                    padding: "5px 8px", borderRadius: 20,
                }}>
                    {[
                        { id: "point", label: "📍 Point" },
                        { id: "zone",  label: "⬡ Zone"  },
                        { id: "link",  label: "↗ Link"  },
                    ].map(({ id, label }) => (
                        <button
                            key={id}
                            onClick={() => setAnnotationMode(m => m === id ? null : id)}
                            style={{
                                padding: "4px 10px", fontSize: 10, fontWeight: annotationMode === id ? 700 : 400,
                                border: `1px solid ${annotationMode === id ? "#FFB300" : "rgba(255,255,255,0.18)"}`,
                                borderRadius: 12,
                                background: annotationMode === id ? "rgba(255,179,0,0.18)" : "transparent",
                                color: annotationMode === id ? "#FFB300" : "rgba(255,255,255,0.55)",
                                cursor: "pointer", transition: "all 150ms ease",
                            }}
                        >{label}</button>
                    ))}
                    <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.12)", margin: "0 3px" }} />
                    {[
                        { label: "💾", title: "Save", action: saveAnnotations },
                        { label: "📂", title: "Load", action: loadAnnotations },
                        { label: "🗑", title: "Clear", action: clearAnnotations },
                    ].map(({ label, title, action }) => (
                        <button key={title} onClick={action} title={title} style={{ padding: "4px 8px", fontSize: 12, border: "none", borderRadius: 10, background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>
                            {label}
                        </button>
                    ))}
                    {annotationMode && (
                        <span style={{ fontSize: 9, color: "rgba(255,179,0,0.65)", paddingLeft: 4, maxWidth: 140 }}>
                            {annotationMode === "point" ? "Click map to place point"
                                : annotationMode === "zone" ? `Click to add vertices · double-click to close (${zoneInProgress.length})`
                                : linkSource ? `Now click target annotation`
                                : "Click source annotation"}
                        </span>
                    )}
                </div>
            )}

            {/* ── Annotation point form ─────────────────────────────────────── */}
            {annotationForm?.type === "point" && (
                <AnnotationPointForm
                    data={annotationForm.data}
                    onSave={savePointAnnotation}
                    onCancel={() => setAnnotationForm(null)}
                />
            )}

            {/* ── Annotation zone form ──────────────────────────────────────── */}
            {annotationForm?.type === "zone" && (
                <AnnotationZoneForm
                    data={annotationForm.data}
                    onSave={saveZoneAnnotation}
                    onCancel={() => { setAnnotationForm(null); setZoneInProgress([]) }}
                />
            )}

            {/* ── Annotation link form ──────────────────────────────────────── */}
            {annotationForm?.type === "link" && (
                <AnnotationLinkForm
                    data={annotationForm.data}
                    onSave={saveLinkAnnotation}
                    onCancel={() => { setAnnotationForm(null); setLinkSource(null) }}
                />
            )}

            {/* ── Annotation read panel ─────────────────────────────────────── */}
            {selectedAnnotation && !annotationForm && (
                <div style={{
                    position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
                    ...GLASS, width: 280, zIndex: 2200, padding: "14px 16px",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#FFB300" }}>
                            {selectedAnnotation._type === "point" ? "Point" : selectedAnnotation._type === "zone" ? "Zone" : "Link"} Annotation
                        </span>
                        <button onClick={() => setSelectedAnnotation(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>✕</button>
                    </div>
                    {selectedAnnotation._type === "point" && <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{selectedAnnotation.title}</div>
                        {selectedAnnotation.classification && (
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: `${CLASSIF_COLOURS[selectedAnnotation.classification]}22`, color: CLASSIF_COLOURS[selectedAnnotation.classification], border: `1px solid ${CLASSIF_COLOURS[selectedAnnotation.classification]}44` }}>
                                {selectedAnnotation.classification}
                            </span>
                        )}
                        {selectedAnnotation.context && <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selectedAnnotation.context}</div>}
                        <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{selectedAnnotation.lat?.toFixed(4)}, {selectedAnnotation.lng?.toFixed(4)}</div>
                    </>}
                    {selectedAnnotation._type === "zone" && <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{selectedAnnotation.label}</div>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: `${ZONE_COLOURS[selectedAnnotation.type] || "#888"}22`, color: ZONE_COLOURS[selectedAnnotation.type] || "#888", border: `1px solid ${ZONE_COLOURS[selectedAnnotation.type] || "#888"}44` }}>
                            {selectedAnnotation.type}
                        </span>
                        {selectedAnnotation.notes && <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selectedAnnotation.notes}</div>}
                        <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{zoneAreaKm2(selectedAnnotation.vertices).toFixed(0)} km² · {selectedAnnotation.vertices.length} vertices</div>
                    </>}
                    {selectedAnnotation._type === "link" && <>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", padding: "2px 7px", background: "rgba(255,255,255,0.07)", borderRadius: 4 }}>
                                {[...annotations.points, ...annotations.zones].find(a => a.id === selectedAnnotation.sourceId)?.title || "[source]"}
                            </span>
                            <span style={{ color: "#FFB300", fontSize: 11, fontWeight: 700 }}>{selectedAnnotation.relationship}</span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", padding: "2px 7px", background: "rgba(255,255,255,0.07)", borderRadius: 4 }}>
                                {[...annotations.points, ...annotations.zones].find(a => a.id === selectedAnnotation.targetId)?.title || "[target]"}
                            </span>
                        </div>
                        {selectedAnnotation.note && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>{selectedAnnotation.note}</div>}
                    </>}
                    <button
                        onClick={() => deleteAnnotation(selectedAnnotation._type + "s", selectedAnnotation.id)}
                        style={{ marginTop: 12, width: "100%", padding: "6px 0", fontSize: 9, fontWeight: 700, border: "1px solid rgba(239,68,68,0.4)", borderRadius: 5, background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer" }}
                    >Delete</button>
                </div>
            )}

            {/* ── Annotation toast ──────────────────────────────────────────── */}
            {annotationToast && (
                <div style={{
                    position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)",
                    ...GLASS, borderRadius: 16, color: "#FFB300", padding: "5px 16px",
                    fontSize: 11, zIndex: 3200, pointerEvents: "none", whiteSpace: "nowrap",
                }}>
                    {annotationToast}
                </div>
            )}

            {/* ── Selected satellite info panel ─────────────────────────────── */}
            {active.sattrack && selectedSat && (
                <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", ...GLASS, width: 260, zIndex: 2200, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: SAT_COLOURS[selectedSat.category] || "#BB86FC" }}>
                            {selectedSat.flag} Satellite
                        </span>
                        <button onClick={() => setSelectedSat(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 8, lineHeight: 1.35 }}>{selectedSat.name}</div>
                    {[
                        ["Category",  selectedSat.category],
                        ["Owner",     selectedSat.owner],
                        ["NORAD ID",  selectedSat.norad_id],
                        ["Altitude",  selectedSat.alt ? `${selectedSat.alt} km` : "—"],
                        ["Position",  `${selectedSat.lat?.toFixed(3)}°, ${selectedSat.lng?.toFixed(3)}°`],
                    ].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", gap: 8, fontSize: 10, marginBottom: 4 }}>
                            <span style={{ color: "rgba(255,255,255,0.35)", minWidth: 70, flexShrink: 0 }}>{k}</span>
                            <span style={{ color: "rgba(255,255,255,0.8)" }}>{v}</span>
                        </div>
                    ))}
                    {isSatImagery(selectedSat) && (
                        <div style={{ marginTop: 8, padding: "5px 8px", background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 5, fontSize: 9, color: "#00E5FF" }}>
                            Imagery tiles loaded from this satellite
                        </div>
                    )}
                </div>
            )}

            </div>{/* end map area */}

            {/* ── Layer Toggle Panel ────────────────────────────────────────────── */}
            {layersPanelOpen && (
                <LayersPanel
                    active={active}
                    onToggle={toggle}
                    infraActive={infraActive}
                    onInfraToggle={toggleInfra}
                    zoom={zoom}
                    onClose={onLayersPanelClose}
                    sourceStatus={sourceStatus}
                    adsbLive={adsbLive}
                    adsbCount={adsbCount}
                    adsbRefreshRate={adsbRefreshRate}
                    adsbSliderVal={adsbSliderVal}
                    onAdsbSliderChange={setAdsbSliderVal}
                    onAdsbActivate={activateAdsb}
                    onAdsbStop={stopAdsb}
                    adsbLabels={active.adsbLabels}
                    onAdsbLabelsToggle={() => toggle("adsbLabels")}
                    routeInfo={routeInfo ? {
                        calculating: routeLoading,
                        distance: routeInfo.distance_km != null ? `${routeInfo.distance_km.toFixed(0)} km` : null,
                        duration: routeInfo.duration_min != null ? `${Math.round(routeInfo.duration_min)} min` : null,
                    } : routeLoading ? { calculating: true } : null}
                    conflictZoneCount={conflictZones.length}
                    conflictZonesLoading={conflictZonesLoading}
                    newsConflictCount={newsConflictsData.length}
                    newsConflictTotal={newsConflictsCount}
                    infraLoading={infraLoading}
                    infraData={infraData}
                    poiCount={poiData.length}
                    deploymentsCount={deploymentsData ? (
                        (deploymentsData.carrier_strike_groups?.length || 0) +
                        (deploymentsData.amphibious_ready_groups?.length || 0) +
                        (deploymentsData.notable_surface_units?.length || 0)
                    ) : 0}
                    onEditDeployments={() => {
                        const json = JSON.stringify(deploymentsData, null, 2)
                        const blob = new Blob([json], { type: "application/json" })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a")
                        a.href = url; a.download = "deployments.json"; a.click()
                        URL.revokeObjectURL(url)
                    }}
                    manualOverrides={manualOverrides}
                    aisStatus={aisStatus}
                    aisVesselCount={aisVessels.length}
                />
            )}

        </div>
    )
}
