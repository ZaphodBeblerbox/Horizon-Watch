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
import SatellitePanel from "./SatellitePanel.jsx"
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
const _webcamIcon = null; // init in useEffect; setDsSelected(null); setImpactEvent(null); setNewsConflictSelected(null) } }}
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
                    const allArgs    = deploymentsData.amphibious_ready_groups || []
                    const allSurface = deploymentsData.notable_surface_units || []
                    return (
                        <>
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

                {/* ── IMB Piracy ───────────────────────────────────────────── */}
                {active.imbPiracy && imbIncidents.map((incident, index) => {
                    const lat = Number(incident?.lat)
                    const lon = Number(incident?.lon)
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
                    const imbIcon = L.divIcon({
                        html: `<div style="font-size:18px;filter:drop-shadow(0 0 4px rgba(220,38,38,0.8));">⚠️</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12],
                        className: "",
                    })
                    return (
                        <Marker key={`imb-${incident.id || index}`} position={[lat, lon]} icon={imbIcon}>
                            <Popup>
                                <div style={{ fontSize: 12, minWidth: 220 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{incident.type || incident.incident_type || "Piracy incident"}</div>
                                    <div>{incident.date || "Unknown date"}</div>
                                    <div>{incident.vessel_name || incident.vessel || "Unknown vessel"}</div>
                                    <div style={{ marginTop: 8, color: "#94a3b8" }}>{incident.description || incident.summary || "No description available"}</div>
                                </div>
                            </Popup>
                        </Marker>
                    )
                })}

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
                                ? <TileLayer url={cogTileUrl} opacity={satelliteOpacity / 100} zIndex={300} />
                                : <ImageOverlay url={tile.thumbnail} bounds={bounds} opacity={satelliteOpacity / 100} zIndex={300} />
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

            <SatellitePanel
                open={active.satellite}
                loading={satelliteSearching}
                error={satelliteError || satelliteAuthError}
                credentialsConfigured={satelliteCredentialsConfigured}
                scenes={satelliteResults}
                selectedId={Object.keys(satelliteSelected).find((id) => satelliteSelected[id]) || null}
                opacity={satelliteOpacity}
                onSelect={(scene) => {
                    setSatelliteSelected({ [scene.id]: true })
                    setSatelliteInfoItem(scene)
                }}
                onOpacityChange={setSatelliteOpacity}
                onClose={() => toggle("satellite")}
            />

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
                    user={currentUser}
                />
            )}

        </div>
    )
}
