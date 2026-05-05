// ══════════════════════════════════════════════════════════════════════════════
// AKILI — INTELLIGENCE CORRELATION PRINCIPLE
// Every component in this file must ask: what other layers does this data touch?
// Routes touch conflict events, infrastructure, and live traffic.
// Aircraft touch airspace and conflict zones. Surface connections automatically.
// ══════════════════════════════════════════════════════════════════════════════

import * as SatelliteJS from "satellite.js"
import { useState, useEffect, useRef, Fragment, useMemo, memo, useCallback } from "react"
import { createPortal } from "react-dom"
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, Polyline, Popup, GeoJSON, Marker, Rectangle, ImageOverlay, Polygon, useMapEvents, useMap } from "react-leaflet"
import L from "leaflet"
import Markdown from "react-markdown"
import CountryPanel from "./CountryPanel.jsx"
import EEZPanel from "./EEZPanel.jsx"
import LiveTicker from "./LiveTicker.jsx"
import TVWidget from "./tvwidget.jsx"
import DraggablePanel from "./DraggablePanel.jsx"
import LayersPanel from "./LayersPanel.jsx"
import InfrastructureLayer from "./InfrastructureLayer.jsx"
import API_BASE from "../apiBase.js"
import EventDetailPanel from "./EventDetailPanel.jsx"
import OverwatchLayer from "./OverwatchLayer.jsx"
import SentinelLayer from "./SentinelLayer.jsx"

const API = API_BASE

// Widget definitions with zoom thresholds
const WIDGETS = [
    { id: "borders",       label: "Land Border",        minZoom: 0, color: "#00ff88" },
    { id: "seaborder",     label: "Sea Boundary (EEZ)", minZoom: 0, color: "#00cfff" },
    { id: "cables",        label: "Submarine Cables",   minZoom: 0, color: "#00cfff" },
    { id: "news",          label: "News Overlay",       minZoom: 0, color: "#7c3aed" },
    { id: "adsb",          label: "ADS-B Traffic",      minZoom: 0, color: "#94a3b8" },
    { id: "route",         label: "Route Planner",      minZoom: 0, color: "#f59e0b" },
    { id: "infra",         label: "Infrastructure",     minZoom: 0, color: "#00BCD4" },
    { id: "newsConflicts",   label: "News Conflicts",     minZoom: 0, color: "#FFB300" },
    { id: "unifiedEvents",  label: "Intelligence Feed",  minZoom: 0, color: "#ef4444" },
    { id: "liveTicker",    label: "Live Ticker",        minZoom: 0, color: "#ef4444" },
    { id: "tv",             label: "Live TV",            minZoom: 0, color: "#ef4444" },
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


const CABLE_API   = "/data/cable-geo.json"
const LANDING_API = "/data/landing-point-geo.json"
const BORDER_API  = `${API}/geo/countries`
const EEZ_API     = `${API}/geo/eez`

// Maps territory name → sovereign country name (for grouped hover highlighting)
const TERRITORY_SOVEREIGN = {
    // France
    "French Polynesia": "France", "French Southern and Antarctic Lands": "France",
    "Saint Barthelemy": "France", "Saint Martin": "France",
    "Saint Pierre and Miquelon": "France", "Wallis and Futuna": "France",
    "New Caledonia": "France", "Clipperton Island": "France",
    // United Kingdom
    "British Indian Ocean Territory": "United Kingdom", "British Virgin Islands": "United Kingdom",
    "Cayman Islands": "United Kingdom", "Falkland Islands": "United Kingdom",
    "Gibraltar": "United Kingdom", "Guernsey": "United Kingdom",
    "Isle of Man": "United Kingdom", "Jersey": "United Kingdom",
    "Montserrat": "United Kingdom", "Pitcairn Islands": "United Kingdom",
    "Saint Helena": "United Kingdom", "South Georgia and the Islands": "United Kingdom",
    "Turks and Caicos Islands": "United Kingdom", "Anguilla": "United Kingdom",
    "Bermuda": "United Kingdom", "Akrotiri Sovereign Base Area": "United Kingdom",
    "Dhekelia Sovereign Base Area": "United Kingdom",
    // United States of America
    "Puerto Rico": "United States of America", "Guam": "United States of America",
    "American Samoa": "United States of America", "United States Virgin Islands": "United States of America",
    "Northern Mariana Islands": "United States of America",
    "United States Minor Outlying Islands": "United States of America",
    "US Naval Base Guantanamo Bay": "United States of America",
    // Netherlands
    "Aruba": "Netherlands", "Curaçao": "Netherlands", "Sint Maarten": "Netherlands",
    // Denmark
    "Greenland": "Denmark", "Faroe Islands": "Denmark",
    // Australia
    "Heard Island and McDonald Islands": "Australia", "Norfolk Island": "Australia",
    "Coral Sea Islands": "Australia", "Ashmore and Cartier Islands": "Australia",
    "Indian Ocean Territories": "Australia",
    // New Zealand
    "Cook Islands": "New Zealand", "Niue": "New Zealand",
    // China
    "Hong Kong S.A.R.": "China", "Macao S.A.R": "China",
    // Norway
    "Aland": "Finland",
    // Disputed / administered
    "Western Sahara": "Morocco",
}

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

/* ── Director Mode marker animations ── */
@keyframes director-marker-in {
    0%   { opacity: 0; transform: scale(0) rotate(-180deg); filter: blur(6px); }
    60%  { opacity: 1; transform: scale(1.3) rotate(10deg); filter: blur(0); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); filter: blur(0); }
}
@keyframes director-marker-out {
    from { opacity: 1; transform: scale(1); }
    to   { opacity: 0; transform: scale(0.5); }
}
@keyframes director-target-lock {
    0%   { transform: rotate(0deg) scale(2); opacity: 0; }
    50%  { transform: rotate(90deg) scale(1); opacity: 1; }
    100% { transform: rotate(180deg) scale(1); opacity: 1; }
}
@keyframes director-critical-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(255,40,40,0.7); transform: scale(1); }
    50%  { box-shadow: 0 0 0 18px rgba(255,40,40,0); transform: scale(1.05); }
    100% { box-shadow: 0 0 0 0 rgba(255,40,40,0); transform: scale(1); }
}
@keyframes director-base-pulse {
    0%, 100% { filter: drop-shadow(0 0 3px rgba(255,220,50,0.5)); }
    50%       { filter: drop-shadow(0 0 10px rgba(255,220,50,0.9)); }
}
.director-marker-enter {
    animation: director-marker-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.director-target-marker {
    animation: director-target-lock 800ms ease-out forwards;
}
.director-base-marker {
    animation: director-marker-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.director-exit {
    animation: director-marker-out 300ms ease-in forwards;
}
.director-formation-unit {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

/* ── Director Mode drawing animations ── */
.director-drawing-line path {
    stroke-dasharray: 2000;
    stroke-dashoffset: 2000;
    animation: director-draw-line 1500ms ease-out forwards;
}
@keyframes director-draw-line {
    to { stroke-dashoffset: 0; }
}
.director-drawing-line {
    filter: drop-shadow(0 0 4px currentColor) drop-shadow(0 0 8px currentColor);
}
.director-drawing-fill {
    opacity: 0;
    animation: director-fade-fill 600ms ease-out 200ms forwards;
}
@keyframes director-fade-fill {
    to { opacity: 1; }
}

/* ── Director Mode — country highlight glow labels ── */
.director-country-label {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    pointer-events: none;
}
.director-country-label-inner {
    font-family: Inter, -apple-system, sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    animation: dir-country-label-in 500ms ease-out 200ms forwards;
}
.director-country-label-context {
    font-size: 9px;
    font-weight: 600;
    color: rgba(255,255,255,0.65);
    text-shadow: 0 0 4px rgba(0,0,0,0.9);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
@keyframes dir-country-label-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

/* ── Smoother tile loading ── */
.leaflet-tile {
    transition: opacity 0.3s ease-in-out !important;
}
.leaflet-tile-loaded {
    opacity: 1 !important;
}

/* ── Director placed event markers ── */
.director-placed-event {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    pointer-events: all;
    cursor: pointer;
}
.director-placed-event svg {
    filter: drop-shadow(0 0 4px rgba(0,0,0,0.6));
    animation: director-marker-in 400ms ease-out forwards;
}
.director-placed-event-label {
    position: absolute;
    top: 32px;
    left: 50%;
    transform: translateX(-50%);
    font-family: Inter, -apple-system, sans-serif;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    background: rgba(0,0,0,0.75);
    padding: 2px 6px;
    border-radius: 3px;
    white-space: nowrap;
    pointer-events: none;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* ── Director event popup ── */
.director-event-leaflet-popup .leaflet-popup-content-wrapper {
    background: rgba(10, 20, 40, 0.94) !important;
    border: 1px solid rgba(86, 207, 255, 0.25) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 24px rgba(0,0,0,0.7) !important;
    color: #e2e8f0 !important;
    padding: 0 !important;
    backdrop-filter: blur(12px);
}
.director-event-leaflet-popup .leaflet-popup-content {
    margin: 0 !important;
    width: 280px !important;
}
.director-event-leaflet-popup .leaflet-popup-tip {
    background: rgba(10, 20, 40, 0.94) !important;
}
.director-event-leaflet-popup .leaflet-popup-close-button {
    color: rgba(226,232,240,0.6) !important;
    font-size: 18px !important;
    top: 6px !important;
    right: 8px !important;
}
.director-event-popup {
    padding: 12px 14px;
    font-family: Inter, -apple-system, sans-serif;
}
.director-event-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(86,207,255,0.15);
}
.director-event-popup-type {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: rgba(226,232,240,0.5);
}
.director-event-popup-severity {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
}
.director-event-popup-title {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    line-height: 1.4;
    margin-bottom: 6px;
}
.director-event-popup-summary {
    font-size: 11px;
    color: rgba(226,232,240,0.7);
    line-height: 1.5;
    margin-bottom: 6px;
}
.director-event-popup-source {
    font-size: 10px;
    color: rgba(86,207,255,0.7);
    font-style: italic;
}
.director-event-popup-img img {
    width: 100%;
    border-radius: 4px;
}

/* ── Director placed location markers ── */
.director-location-marker {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    pointer-events: all;
    cursor: pointer;
}

/* ── Director location popup ── */
.director-location-popup .leaflet-popup-content-wrapper {
    background: rgba(10, 15, 25, 0.94) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    border-radius: 12px !important;
    color: white !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
    padding: 0 !important;
}
.director-location-popup .leaflet-popup-content {
    margin: 0 !important;
    width: 270px !important;
}
.director-location-popup .leaflet-popup-tip {
    background: rgba(10, 15, 25, 0.94) !important;
}
.director-location-popup .leaflet-popup-close-button {
    color: rgba(255,255,255,0.45) !important;
    font-size: 16px !important;
    top: 8px !important;
    right: 10px !important;
}
.director-location-popup .leaflet-popup-close-button:hover {
    color: white !important;
}
.director-location-popup-content {
    padding: 12px 14px;
    font-family: Inter, -apple-system, sans-serif;
}
.director-popup-image img {
    width: 100%;
    border-radius: 6px;
    margin-bottom: 8px;
    display: block;
}

/* ── Director highlight pulses ── */
@keyframes director-pulse-ring {
    0%, 100% { opacity: 0.85; r: 14; }
    50%       { opacity: 0.4;  r: 20; }
}
@keyframes director-glow-ring {
    0%, 100% { filter: drop-shadow(0 0 6px rgba(86, 207, 255, 0.8)); }
    50%       { filter: drop-shadow(0 0 14px rgba(86, 207, 255, 1.0)); }
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
@keyframes hw-pulse-blue {
    0%,100% { box-shadow: 0 0 20px #3b82f688, 0 0 40px #3b82f644; }
    50%     { box-shadow: 0 0 32px #3b82f6aa, 0 0 64px #3b82f666; }
}
@keyframes hw-pulse-orange {
    0%,100% { box-shadow: 0 0 14px #f9731688, 0 0 28px #f9731644; }
    50%     { box-shadow: 0 0 24px #f97316aa, 0 0 48px #f9731666; }
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
@keyframes searchPulse {
    0%   { opacity: 0.5; transform: scale(1); }
    100% { opacity: 0;   transform: scale(2.2); }
}
.search-pulse { animation: searchPulse 2s ease-out infinite; }
.search-tooltip.leaflet-tooltip {
    background: rgba(8, 15, 35, 0.95) !important;
    color: #e2e8f0 !important;
    border: 1px solid rgba(56, 189, 248, 0.35) !important;
    border-radius: 6px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    padding: 4px 10px !important;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5) !important;
    white-space: nowrap !important;
}
.search-tooltip.leaflet-tooltip::before { display: none !important; }
@keyframes acGlowMil {
    0%, 100% { filter: drop-shadow(0 0 3px rgba(255, 80, 40, 0.65)); }
    50%       { filter: drop-shadow(0 0 7px rgba(255, 80, 40, 1.0));  }
}
@keyframes acGlowCyan {
    0%, 100% { filter: drop-shadow(0 0 3px rgba(0, 200, 255, 0.55)); }
    50%       { filter: drop-shadow(0 0 7px rgba(0, 200, 255, 0.9));  }
}
@keyframes acGlowGreen {
    0%, 100% { filter: drop-shadow(0 0 3px rgba(0, 255, 120, 0.55)); }
    50%       { filter: drop-shadow(0 0 7px rgba(0, 255, 120, 0.9));  }
}
@keyframes acGlowWhite {
    0%, 100% { filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.35)); }
    50%       { filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.65)); }
}
.ac-glow-mil  { animation: acGlowMil   2.2s ease-in-out infinite; }
.ac-glow-cyan { animation: acGlowCyan  2.5s ease-in-out infinite; }
.ac-glow-grn  { animation: acGlowGreen 2.3s ease-in-out infinite; }
.ac-glow-wht  { animation: acGlowWhite 3.0s ease-in-out infinite; }
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
@keyframes director-pulse-anim {
    0%, 100% { stroke-opacity: 0.9; stroke-width: 2; }
    50%       { stroke-opacity: 0.25; stroke-width: 7; }
}
@keyframes director-glow-anim {
    0%, 100% { stroke-opacity: 0.6; }
    50%       { stroke-opacity: 1.0; }
}
.director-highlight-pulse path { animation: director-pulse-anim 1.2s ease-in-out infinite; }
.director-highlight-glow path  { animation: director-glow-anim  1.6s ease-in-out infinite; }
.director-highlight-ring path  { stroke-dasharray: 6 4; }

/* ── OpenInfraMap popup ── */
.infra-popup .leaflet-popup-content-wrapper {
    background: rgba(26,36,51,0.97) !important;
    backdrop-filter: blur(10px) !important;
    -webkit-backdrop-filter: blur(10px) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 8px !important;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6) !important;
    padding: 0 !important;
    color: #e8edf2 !important;
}
.infra-popup .leaflet-popup-content { margin: 0 !important; }
.infra-popup .leaflet-popup-tip { background: rgba(26,36,51,0.97) !important; }
.infra-popup .leaflet-popup-close-button { color: rgba(232,237,242,0.45) !important; top: 8px !important; right: 10px !important; }
.infra-popup .leaflet-popup-close-button:hover { color: #e8edf2 !important; }
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


function MapInstanceTracker({ mapRef, depLayerRef, onMapReady }) {
    const map = useMap()
    useEffect(() => {
        mapRef.current = map
        if (depLayerRef && !depLayerRef.current) {
            depLayerRef.current = L.layerGroup()
        }
        if (onMapReady) onMapReady(map)
    }, [map, mapRef])  // eslint-disable-line react-hooks/exhaustive-deps
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

// ── Chokepoint hatch pattern component ───────────────────────────────────────
// Rendered into the React tree so SVG patterns are available document-wide.
// Leaflet's SVG overlay paths can reference url(#hatch-*) since both are inline
// in the same HTML document.
function ChokepointPatternDefs() {
    return (
        <svg width="0" height="0" style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }}>
            <defs>
                <pattern id="hatch-critical" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke="#ef4444" strokeWidth="4" strokeOpacity="0.65" />
                </pattern>
                <pattern id="hatch-high" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="10" stroke="#f59e0b" strokeWidth="4" strokeOpacity="0.6" />
                </pattern>
                <pattern id="hatch-moderate" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="12" stroke="#14b8a6" strokeWidth="4" strokeOpacity="0.6" />
                </pattern>
                <pattern id="hatch-low" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="14" stroke="#3b82f6" strokeWidth="4" strokeOpacity="0.55" />
                </pattern>
            </defs>
        </svg>
    )
}

// ── Single chokepoint polygon (outer glow + hatched fill + label) ─────────────
function ChokepointPolygon({ cp, zoom, onSelect }) {
    // ALL hooks MUST come before any conditional return — React rules of hooks
    const fillRef           = useRef(null)
    const [hovered, setHovered] = useState(false)

    const color = _THREAT_COLORS[cp.threatLevel] || "#14b8a6"
    const level = (cp.threatLevel || "moderate").toLowerCase()

    const fillOpacity = cp.threatLevel === "CRITICAL" ? (hovered ? 0.45 : 0.30)
        : cp.threatLevel === "HIGH"     ? (hovered ? 0.38 : 0.25)
        : cp.threatLevel === "MODERATE" ? (hovered ? 0.30 : 0.20)
        :                                  (hovered ? 0.25 : 0.16)

    // Imperatively set the SVG fill to the hatch pattern URL after each render.
    // pathOptions.fillColor can't express url() references, so we set it directly.
    useEffect(() => {
        const el = fillRef.current?.getElement?.()
        if (!el) return
        el.setAttribute("fill", `url(#hatch-${level})`)
        el.setAttribute("fill-opacity", String(fillOpacity * 1.8))  // patterns need boosted opacity
    })

    // Zoom gate comes AFTER all hooks — no hooks below this point
    if (cp.minZoom && zoom < cp.minZoom) return null

    const handlers = {
        click:     () => onSelect(cp),
        mouseover: () => setHovered(true),
        mouseout:  () => setHovered(false),
    }

    const strokeWeight   = cp.threatLevel === "CRITICAL" ? 3 : cp.threatLevel === "HIGH" ? 2.5 : 2
    const strokeOpacity  = hovered ? 1 : (cp.threatLevel === "CRITICAL" ? 1 : 0.8)
    const labelSize      = cp.threatLevel === "CRITICAL" ? 14 : cp.threatLevel === "HIGH" ? 13 : 12

    return (
        <Fragment>
            {/* Outer glow halo — wide soft stroke, no fill */}
            <Polygon
                positions={cp.polygon}
                pathOptions={{
                    fill:    false,
                    color,
                    weight:  12,
                    opacity: hovered ? 0.45 : 0.28,
                    className: "",
                }}
                interactive={false}
            />
            {/* Main dashed border */}
            <Polygon
                positions={cp.polygon}
                pathOptions={{
                    fill:      false,
                    color,
                    weight:    hovered ? strokeWeight + 1 : strokeWeight,
                    opacity:   strokeOpacity,
                    dashArray: cp.threatLevel === "CRITICAL" ? "8 4" : cp.threatLevel === "HIGH" ? "10 5" : "6 8",
                    className: cp.threatLevel === "CRITICAL" ? "chokepoint-pulse" : "",
                }}
                eventHandlers={handlers}
            />
            {/* Hatched fill layer — pattern set imperatively via useEffect */}
            <Polygon
                ref={fillRef}
                positions={cp.polygon}
                pathOptions={{
                    fillColor:   color,
                    fillOpacity,
                    color:       "transparent",
                    weight:      0,
                    opacity:     0,
                }}
                eventHandlers={handlers}
            >
                <Tooltip
                    permanent
                    direction="center"
                    className="chokepoint-label"
                    offset={[0, 0]}
                    interactive={false}
                >
                    <span style={{
                        color,
                        fontSize: labelSize,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        textShadow: "0 0 8px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.95), 0 1px 4px rgba(0,0,0,1)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                    }}>
                        {cp.name}
                    </span>
                </Tooltip>
            </Polygon>
        </Fragment>
    )
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

// ── Chokepoints — rich dataset with threat levels, metadata, and polygons ────
const CHOKEPOINTS = [
    {
        name: "Strait of Hormuz",
        threatLevel: "CRITICAL",
        polygon: [
            [26.45496154043563,54.83213569539235],[25.62912825527243,55.52895334532315],
            [25.71044862071026,55.72679300972084],[25.79953536826465,55.90109489656296],
            [26.24514555342548,56.15666659083359],[26.40922350596732,56.3299940862639],
            [26.3964600334261,56.50116360535718],[25.78613938664508,56.40104632562489],
            [25.72043798434647,56.30632981956199],[25.62886265873773,56.31013287567782],
            [25.60136076724721,56.37607080497331],[25.79261153921045,57.26546343441144],
            [26.45344306385928,57.04353309698143],[26.69763197669941,57.05494216697125],
            [27.00331720861606,56.85073337871168],[27.15332810522341,56.60249140917256],
            [27.16066113686722,56.28916313118259],[26.96212109618719,56.2969550376506],
            [26.6897638845019,55.96251130873996],[26.65141236431435,55.69120843437669],
            [26.5370442064279,55.27921797942465],[26.7153487533384,55.1565909104791],
            [26.45496154043563,54.83213569539235],
        ],
        center: [26.23, 56.05],
        width: "39 km",
        dailyTraffic: "21 million bbl oil/day",
        globalTradeShare: "~20% of global petroleum",
        borderingNations: ["Iran", "Oman", "United Arab Emirates"],
        wikipedia: "Strait_of_Hormuz",
        whyItMatters: "The world's most critical oil chokepoint. Roughly one-fifth of all globally traded petroleum passes through each day. A closure would immediately spike global oil prices and trigger strategic reserve releases across NATO and allied nations.",
        currentThreats: [
            "IRGCN vessel harassment of commercial tankers",
            "Iranian seizure of flagged vessels (ongoing since 2019)",
            "Houthi drone and anti-ship missile threat in approach waters",
            "Subsurface mine placement risk in contested zones",
        ],
        minZoom: 3,
    },
    {
        name: "Bab el-Mandeb",
        threatLevel: "CRITICAL",
        polygon: [
            [12.45282966953583,43.34088705310668],[12.2592158104991,43.40206416128849],
            [12.63854697332219,43.90002988027648],[12.73638629255974,43.58739652399679],
            [12.67122393193894,43.52401379258128],[12.68330267438698,43.44441667452298],
            [12.82938267612522,43.47457299482402],[13.06441340874839,43.32384562213154],
            [12.92185541197779,43.02883683715334],[12.45282966953583,43.34088705310668],
        ],
        center: [12.65, 43.36],
        width: "29 km",
        dailyTraffic: "6.2 million bbl oil/day · 3.3M TEU cargo",
        globalTradeShare: "~10% of global trade",
        borderingNations: ["Yemen", "Djibouti", "Eritrea"],
        wikipedia: "Bab-el-Mandeb",
        whyItMatters: "Gateway between the Red Sea and Gulf of Aden linking Europe to Asia via Suez. Houthi missile attacks since 2023 have diverted major shipping lines around the Cape of Good Hope, adding 10–14 days and $1–2M per voyage.",
        currentThreats: [
            "Houthi anti-ship ballistic missile attacks (active 2023–present)",
            "Drone boat swarm attacks on commercial vessels",
            "Iranian arms smuggling routes through strait",
            "US/UK Operation Prosperity Guardian interdiction operations",
        ],
        minZoom: 3,
    },
    {
        name: "Suez Canal",
        threatLevel: "CRITICAL",
        polygon: [
            [31.24467953516879,32.30118564352306],[31.10444844717359,32.30266712109401],
            [30.80112184420241,32.31241890568655],[30.771529882314,32.31769525385681],
            [30.69935928763639,32.3410586403492],[30.64043251078027,32.32499809158347],
            [30.56053848920329,32.30515017340799],[30.51175260982979,32.33758885764722],
            [30.45545585601027,32.34584231038237],[30.40964649965364,32.34650692017977],
            [30.40174645750083,32.31128000949985],[30.36055735738074,32.30493355239871],
            [30.33243303790832,32.30741471414107],[30.28525655024196,32.3484845479605],
            [30.23431241938055,32.52026666468875],[30.18890421799261,32.56194321131943],
            [30.10920680317747,32.56861033749613],[30.05730470037089,32.56979855178427],
            [30.00808799718977,32.57955539787641],[29.95531862419705,32.58055201240585],
            [29.93213842683943,32.55819885034602],[29.92748990605539,32.56313377865743],
            [29.95089206947766,32.58510266856214],[29.98532282429323,32.58840318772711],
            [30.04920485337975,32.57498635319865],[30.20625732195517,32.57672604398426],
            [30.24742073227144,32.54900164308022],[30.28320307720908,32.45407019231271],
            [30.33684297489516,32.44493500811471],[30.3938560625594,32.38186733971607],
            [30.41334227130125,32.36398268780024],[30.45062059695007,32.36084340203232],
            [30.59188803843862,32.33250562178453],[30.70125381276034,32.3531332886747],
            [30.7320589672356,32.34267613096305],[30.80926545054388,32.3199931791247],
            [30.90170031099978,32.31657360578762],[31.10238256575503,32.31285084399367],
            [31.15245160429606,32.3431634716665],[31.23457925272847,32.36259092067413],
            [31.27016639174261,32.32068545323914],[31.24467953516879,32.30118564352306],
        ],
        center: [30.84, 32.43],
        width: "205 m (canal width)",
        dailyTraffic: "~50 vessels/day",
        globalTradeShare: "12% of global trade volume",
        borderingNations: ["Egypt"],
        wikipedia: "Suez_Canal",
        whyItMatters: "Shortens the Europe–Asia route by 7,000 km versus rounding Africa. The 2021 Ever Given grounding demonstrated vulnerability: 6 days of blockage cost an estimated $9.6 billion per day in delayed trade.",
        currentThreats: [
            "Egyptian political instability risk to canal operations",
            "Houthi threat diverting traffic to Cape route (indirect closure)",
            "Terrorist attack risk on Sinai approach channels",
            "Cyber attack risk on canal traffic management systems",
        ],
        minZoom: 4,
    },
    {
        name: "Strait of Malacca",
        threatLevel: "CRITICAL",
        polygon: [
            [1.995403060916556,101.3624273521426],[2.083625611348094,101.5045581333199],
            [2.134116603907936,101.655748392181],[1.954353485630168,101.7710047625645],
            [1.727040442697845,101.6612499048179],[1.535280572315169,101.9277882377807],
            [1.614334128810148,102.0313954292689],[1.510309274399511,102.4845736402618],
            [1.154971015725261,102.4784289388365],[1.080619115062463,102.6295256852913],
            [1.176953390161864,102.7632901351257],[1.092518912414125,103.0105365518487],
            [0.8567051701589243,103.1784768127406],[1.249973584563105,103.5304631695499],
            [1.507947230213522,103.3992882051806],[1.751146305847749,102.9745458365892],
            [1.832268623693282,102.9050062272656],[1.880505779743753,102.6945624199714],
            [2.08311458158521,102.5051097788774],[2.241846096658057,102.1052784502246],
            [2.354302062008842,102.0735104747048],[2.444304028509836,101.8750307743647],
            [2.604161335632954,101.7799562424357],[2.619483854265792,101.6555069304043],
            [2.744079748142226,101.4458508665666],[2.335213753222361,101.0587264733385],
            [1.995403060916556,101.3624273521426],
        ],
        center: [1.8, 102.3],
        width: "2.8 km (narrowest point)",
        dailyTraffic: "85,000 vessels/year · 16M bbl oil/day",
        globalTradeShare: "~25% of global trade",
        borderingNations: ["Malaysia", "Singapore", "Indonesia"],
        wikipedia: "Strait_of_Malacca",
        whyItMatters: "The world's busiest shipping lane connecting the Indian Ocean to the South China Sea. A closure would force rerouting through Sunda or Lombok Straits, adding 1,000–1,600 km per voyage and disrupting East Asian supply chains.",
        currentThreats: [
            "Piracy and armed robbery against vessels (persistent low-level)",
            "Territorial disputes between Malaysia, Singapore and Indonesia",
            "South China Sea tension spillover risk",
            "High traffic density collision and grounding risk",
        ],
        minZoom: 4,
    },
    {
        name: "Strait of Gibraltar",
        threatLevel: "HIGH",
        polygon: [
            [36.16969788139049,-6.035405613830781],[35.79296107573852,-5.927298191933326],
            [35.79098065791726,-5.801480348189159],[35.77837608305592,-5.794074385423738],
            [35.78026076601697,-5.774970777177812],[35.80188526726089,-5.749520345752559],
            [35.81721480445081,-5.751334476196286],[35.83912281717355,-5.688019900682974],
            [35.82852935914157,-5.649745620872581],[35.8353771648917,-5.62461357377693],
            [35.82979628131852,-5.598947693104485],[35.84662687536444,-5.564522266714106],
            [35.84859484369717,-5.55019545792912],[35.85642494247169,-5.543376635855246],
            [35.86831977918222,-5.543351522189929],[35.90893138184412,-5.482361159408562],
            [35.91600388322919,-5.461826469925172],[35.91025745443972,-5.438417057715917],
            [35.91660867663568,-5.419402779205178],[35.92122388621294,-5.404882258839746],
            [35.91654775399325,-5.370238757448799],[35.89801467530137,-5.335534810346258],
            [35.89829188472393,-5.322928622702228],[35.89526194075059,-5.300747554202979],
            [35.90449386549779,-5.289595017012479],[36.11392401289902,-5.342567760419374],
            [36.13535602615911,-5.365227278059528],[36.15855915300806,-5.368410877949189],
            [36.17742395123273,-5.387858326500204],[36.17864287128715,-5.411169734191529],
            [36.17137957324005,-5.4306738378754],[36.15478987186889,-5.442313855716526],
            [36.09116654397025,-5.44133561870594],[36.08153230031679,-5.42805875377899],
            [36.06869789741123,-5.432550870585952],[36.06857340047181,-5.442378863331418],
            [36.0625081116256,-5.444406034717332],[36.05576417144426,-5.450762284045209],
            [36.0530139880423,-5.461022215625114],[36.05146892553353,-5.468288725113188],
            [36.05438887081029,-5.483481961954885],[36.04474473658151,-5.501498539255895],
            [36.00860483553978,-5.603734326168897],[36.04194658369207,-5.63550358229462],
            [36.05586765661424,-5.664613467039273],[36.06564451445028,-5.689481490755136],
            [36.06122005838835,-5.711682518509454],[36.06762302979691,-5.735747797118039],
            [36.08207974956557,-5.764067225751237],[36.08857318242396,-5.777332161284754],
            [36.08592172786875,-5.787024262479339],[36.07872985906487,-5.798543859905435],
            [36.18768613139926,-5.918700129050296],[36.16969788139049,-6.035405613830781],
        ],
        center: [35.97, -5.55],
        width: "14 km",
        dailyTraffic: "~300 vessels/day",
        globalTradeShare: "~10% of global maritime trade",
        borderingNations: ["Spain", "Morocco", "United Kingdom (Gibraltar)"],
        wikipedia: "Strait_of_Gibraltar",
        whyItMatters: "The only sea passage between the Mediterranean and the Atlantic Ocean. Sole exit point for Mediterranean naval forces including NATO Southern Fleet. Contested between Spain, Morocco and the UK over Gibraltar sovereignty.",
        currentThreats: [
            "Morocco–Spain territorial tensions over Ceuta and Melilla",
            "Drug and irregular migration smuggling traffic",
            "Submarine transit corridor for Russian and Chinese vessels",
            "NATO monitoring of non-allied submarine activity",
        ],
        minZoom: 4,
    },
    {
        name: "Turkish Straits / Bosphorus",
        threatLevel: "HIGH",
        polygon: [
            [41.00183517612999,28.9780438430991],[40.99097889189881,29.01641998184357],
            [40.99628515876343,29.0217233162115],[41.00708545461207,29.0105027185846],
            [41.02329376279454,29.00768839856096],[41.04899179390036,29.05131157372387],
            [41.06092609358404,29.05188092044294],[41.06479018703362,29.05740297162058],
            [41.07309177309634,29.05532666160786],[41.07674593886497,29.06485185149258],
            [41.09972817671526,29.06592403152596],[41.10685455355238,29.07377137368994],
            [41.10767280488813,29.08244108411187],[41.11664285856101,29.09129330994934],
            [41.12115506679033,29.09848603278806],[41.13306726081378,29.09349743627364],
            [41.14214172479985,29.07371310571971],[41.15480527757245,29.07896513451845],
            [41.16092685844536,29.07353002821221],[41.17865783038553,29.08662454874344],
            [41.18616439078247,29.11634582274278],[41.19986967325682,29.11892008691665],
            [41.20842633015301,29.1307447235254],[41.21491624592427,29.15058890460756],
            [41.21770450834848,29.16207194154452],[41.2240528893672,29.16760745524388],
            [41.23540273019233,29.11331338198456],[41.21761839598113,29.1061485188099],
            [41.21200116991822,29.11034556851538],[41.19810655909332,29.08893959883229],
            [41.18251821071844,29.07608538938084],[41.173585919239,29.07141986358718],
            [41.1698359811989,29.05873057394504],[41.1575681081961,29.03526451932171],
            [41.12913129630033,29.06731754300153],[41.12108564767902,29.07229165536265],
            [41.11455971117401,29.06028182856074],[41.09623936108552,29.05342838592923],
            [41.0840105497699,29.05713364778731],[41.07848487099551,29.0444356913817],
            [41.06912720454634,29.04618027439583],[41.06186410740047,29.03853294722292],
            [41.05116932513615,29.03403032154246],[41.03700913438475,28.99583433514965],
            [41.02489261463676,28.98310992214029],[41.0181463980358,28.98564609213615],
            [41.00183517612999,28.9780438430991],
        ],
        center: [41.12, 29.07],
        width: "0.7 km (narrowest point)",
        dailyTraffic: "~45,000 vessels/year · 3M bbl oil/day",
        globalTradeShare: "3% of global oil trade",
        borderingNations: ["Turkey", "Bulgaria", "Ukraine", "Russia"],
        wikipedia: "Turkish_Straits",
        whyItMatters: "The only sea link between the Black Sea and the Mediterranean. Turkey controls passage under the 1936 Montreux Convention — critical for Russian Black Sea Fleet egress and Ukrainian grain export routes. Turkey invoked Montreux in 2022 to block warship passage from both sides.",
        currentThreats: [
            "Russia–Ukraine war impact on Black Sea navigation",
            "Turkey leveraging Montreux Convention for geopolitical bargaining",
            "Maritime mine drift risk from Black Sea conflict zones",
            "Ultra-narrow channel catastrophic accident risk",
        ],
        minZoom: 4,
    },
    {
        name: "Luzon Strait",
        threatLevel: "HIGH",
        // Taiwan S tip → Luzon N tip: water between Taiwan and Philippines — 24 pts
        polygon: [
            // Taiwan southern coast (W→E)
            [22.05,120.05],[21.98,120.40],[21.82,120.72],[21.60,121.05],
            [21.38,121.38],[21.12,121.62],[20.85,121.88],[20.52,122.08],
            // Philippines northern cape (Luzon, E→W)
            [20.12,122.25],[19.72,122.22],[19.35,122.02],[19.02,121.72],
            [18.80,121.40],[18.68,121.10],[18.65,120.80],
            [18.72,120.48],[18.88,120.22],[19.12,120.00],
            // West side
            [19.42,119.85],[20.00,119.90],[20.62,119.95],
            [21.22,120.02],[22.05,120.05],
        ],
        center: [20.5, 121.0],
        width: "250 km",
        dailyTraffic: "~150 vessels/day",
        globalTradeShare: "Major trans-Pacific route",
        borderingNations: ["Philippines", "Taiwan", "China"],
        wikipedia: "Luzon_Strait",
        whyItMatters: "Critical US Navy transit corridor between the Western Pacific and South China Sea. Primary route for US carrier strike groups entering the South China Sea. Chinese PLAN submarine operations in the strait complicate strategic positioning regarding Taiwan.",
        currentThreats: [
            "PLA Navy surveillance and submarine operations",
            "Taiwan Strait crisis spillover risk",
            "Chinese coast guard confrontations with Philippine vessels",
            "US–China naval incident risk in contested waters",
        ],
        minZoom: 4,
    },
    {
        name: "Taiwan Strait",
        threatLevel: "HIGH",
        // China coast (W side, N→S) → Taiwan W coast (E side, S→N) — 26 pts
        polygon: [
            // Northern entrance
            [25.35,120.52],[25.18,121.05],[25.02,121.42],
            // Taiwan west coast (N→S)
            [24.72,121.48],[24.38,121.45],[24.02,121.42],
            [23.62,120.85],[23.22,120.38],[22.82,120.22],[22.42,120.28],
            // Southern entrance
            [22.05,120.15],[21.88,119.95],
            // China coast (Fujian/Guangdong, S→N)
            [21.95,118.98],[22.25,118.82],[22.55,118.62],
            [22.85,118.52],[23.18,118.50],[23.52,118.62],
            [23.82,118.78],[24.12,118.92],[24.42,119.08],
            [24.72,119.28],[25.00,119.58],[25.28,119.92],
            [25.35,120.52],
        ],
        center: [23.5, 120.2],
        width: "130 km",
        dailyTraffic: "~50,000 vessels/year",
        globalTradeShare: "~50% of global container traffic passes nearby",
        borderingNations: ["China", "Taiwan"],
        wikipedia: "Taiwan_Strait",
        whyItMatters: "One of the world's most geopolitically volatile waterways. Closure or conflict would disrupt global semiconductor supply chains (TSMC) and trigger US treaty obligations. China conducts regular military exercises simulating a blockade scenario.",
        currentThreats: [
            "PLA military exercises simulating Taiwan blockade (annual)",
            "Chinese grey zone operations with coast guard and militia vessels",
            "US Freedom of Navigation Operations (routine)",
            "Escalation risk from miscalculation or incident at sea",
        ],
        minZoom: 4,
    },
    {
        name: "Danish Straits",
        threatLevel: "MODERATE",
        polygon: [
            [56.11591536511848,12.35848251007932],[56.10228351905172,12.38507180079433],
            [56.100296939267,12.40949905154289],[56.09429655717405,12.42981759427206],
            [56.08876460754731,12.51569318471632],[56.04027868148,12.62422116168639],
            [56.06483340616344,12.67797831365115],[56.14558228473325,12.56980900001729],
            [56.24952485717788,12.52444538500705],[56.12870051988068,12.31560362737501],
            [56.11591536511848,12.35848251007932],
        ],
        center: [56.13, 12.48],
        width: "~15 km",
        dailyTraffic: "~40,000 vessels/year",
        globalTradeShare: "Baltic Sea access route",
        borderingNations: ["Denmark", "Sweden", "Germany"],
        wikipedia: "Danish_straits",
        whyItMatters: "The only access to and from the Baltic Sea, controlling all maritime trade for Sweden, Finland, Estonia, Latvia, Lithuania, Poland, and Russia's Baltic ports. Enhanced NATO presence has made the straits a key chokepoint for Russian Baltic Fleet operations.",
        currentThreats: [
            "Russia–NATO Baltic Sea tensions following Ukraine invasion",
            "Sabotage risk to undersea cables (Balticconnector incident 2023)",
            "Russian Baltic Fleet egress restriction risk",
            "Hybrid warfare and grey zone operations in the Baltic",
        ],
        minZoom: 4,
    },
    {
        name: "Strait of Lombok",
        threatLevel: "MODERATE",
        // Bali E coast (W side) → Lombok W coast (E side) — 18 pts
        polygon: [
            // North entrance
            [-7.98,115.52],[-8.05,115.72],[-8.12,115.90],
            // Lombok W coast (N→S)
            [-8.20,116.02],[-8.38,116.08],[-8.55,116.10],
            [-8.70,116.02],[-8.85,115.90],
            // South entrance
            [-8.88,115.68],[-8.85,115.42],
            // Bali E coast (S→N)
            [-8.80,115.25],[-8.65,115.18],[-8.45,115.22],
            [-8.28,115.28],[-8.12,115.38],[-7.98,115.52],
        ],
        center: [-8.5, 115.7],
        width: "40 km",
        dailyTraffic: "~200 vessels/week",
        globalTradeShare: "Malacca alternative route",
        borderingNations: ["Indonesia"],
        wikipedia: "Lombok_Strait",
        whyItMatters: "Primary alternative to the Strait of Malacca for large-draught vessels and US nuclear submarines transiting between the Indian and Pacific Oceans. Deeper than Malacca, it accommodates supertankers and VLCCs that cannot use the shallower northern route.",
        currentThreats: [
            "Indonesian maritime jurisdiction enforcement",
            "Increased US submarine transit activity monitored by China",
            "Piracy risk in approach waters",
        ],
        minZoom: 5,
    },
    {
        name: "Panama Canal",
        threatLevel: "MODERATE",
        polygon: [
            [8.922558325696906,-79.5600247753524],[8.931853777310277,-79.54543273718842],
            [8.948950991463327,-79.56721817692063],[8.951029998968187,-79.56608839217148],
            [8.953402148031657,-79.56804260208035],[8.956787888685735,-79.56451973664383],
            [8.963799557007874,-79.57036115311588],[8.967191662163359,-79.57377827111537],
            [8.985629232100949,-79.5799843732633],[8.990755350612462,-79.58363036507528],
            [8.994320357567352,-79.5874254981766],[9.008752964153432,-79.59804372602721],
            [9.013521979671495,-79.60158482627803],[9.027804719654773,-79.62677278793051],
            [9.0408903029647,-79.64461799581059],[9.053486625215831,-79.65319987914553],
            [9.058614083505494,-79.65697688723745],[9.067236789151234,-79.66792818684203],
            [9.070472620867397,-79.67068699458228],[9.079079488624137,-79.67461391776105],
            [9.08691395194259,-79.67840062521951],[9.10655055148162,-79.6886249729635],
            [9.108969226232126,-79.6907377648627],[9.118937715572944,-79.70668882433978],
            [9.123653657889662,-79.73939026055311],[9.12346338245665,-79.75242468655843],
            [9.118655277004672,-79.76518199734301],[9.116566255684397,-79.77015807907614],
            [9.116887086192358,-79.7745314880365],[9.12188195860826,-79.77646892359679],
            [9.122192110303134,-79.78619213145181],[9.119923146223153,-79.78656679887578],
            [9.120903687112891,-79.79417076215177],[9.126928350903615,-79.80053134802057],
            [9.133574008834154,-79.79793195223618],[9.137223953049878,-79.79650662346769],
            [9.157304576187849,-79.79548926108653],[9.159008958945765,-79.80644172419345],
            [9.171826953776774,-79.80439885853386],[9.176855332435974,-79.80614229690376],
            [9.180942115637308,-79.7991274388739],[9.186982012256566,-79.80621311828763],
            [9.17956132488896,-79.83122334989723],[9.187242751498459,-79.84096534948991],
            [9.189591308970455,-79.84835979153458],[9.184749595749146,-79.85679604389075],
            [9.264301032174645,-79.9097769221779],[9.311377221141806,-79.9166925580024],
            [9.318143324628142,-79.91026578942],[9.32517400566279,-79.90737772841449],
            [9.327922288511525,-79.91188342066366],[9.33101555574501,-79.91042339248598],
            [9.33385645667601,-79.91366482242279],[9.344495969880729,-79.90584959981668],
            [9.350567957480164,-79.90767598694138],[9.35232074331736,-79.91386461773634],
            [9.355652954545675,-79.91502454911007],[9.354658608095287,-79.90616238912305],
            [9.35690833557582,-79.90526806189496],[9.363839075263346,-79.90823898064143],
            [9.367427104069744,-79.90282611958546],[9.365636648493926,-79.89402466395522],
            [9.396765858714671,-79.88500701271455],[9.374438598164621,-79.95152146141261],
            [9.360062521470429,-79.94971211262005],[9.340090970092264,-79.95007994484838],
            [9.326807545365979,-79.94672093543356],[9.32130079510765,-79.95146328529766],
            [9.313731622337258,-79.94684406312403],[9.30995101796678,-79.93659322436233],
            [9.314399378285797,-79.92658868124229],[9.309901731389534,-79.92198600200518],
            [9.267064580000499,-79.92469847824539],[9.179326091084143,-79.86477423780801],
            [9.174765001674796,-79.86146912344979],[9.177266138956346,-79.85130170731196],
            [9.182035734701367,-79.84742189492503],[9.177294597094136,-79.84249649879668],
            [9.171986058761503,-79.84162469324079],[9.175370301702225,-79.83443179007554],
            [9.165314199958612,-79.83684594308306],[9.163501019866526,-79.83041171866601],
            [9.164718373589988,-79.82466243151107],[9.16230007504752,-79.81973328500949],
            [9.152714316847735,-79.82240364673839],[9.120161864928614,-79.81123121173114],
            [9.106521007746149,-79.8041928813484],[9.099008845998048,-79.79178560387801],
            [9.110250057917758,-79.78776183258745],[9.11188249478349,-79.77549815391153],
            [9.106314350384373,-79.76985187689206],[9.097782020581272,-79.7525445727651],
            [9.099349423610308,-79.74899892599538],[9.114791132959322,-79.75825240927664],
            [9.117780388707176,-79.75132446524236],[9.105605735570293,-79.74546812372847],
            [9.117187886576588,-79.74252155646164],[9.117427388902113,-79.73637582728561],
            [9.107884200092855,-79.72470263913984],[9.11376530177264,-79.71820282378074],
            [9.106445547635884,-79.69477223786662],[9.0870938925432,-79.68083682312687],
            [9.065883251662994,-79.67113290283605],[9.056832688298233,-79.65961535592345],
            [9.036967814342962,-79.64378749706519],[9.020893573236382,-79.62468263480933],
            [9.011970226818523,-79.61680969359448],[8.994802017549917,-79.60154198896723],
            [8.985728144349007,-79.59480333062587],[8.963568878897322,-79.57727495342266],
            [8.955385890118324,-79.57367363423867],[8.943265545860497,-79.57100008519329],
            [8.9416984688374,-79.56796816972714],[8.930524511426032,-79.56213190221783],
            [8.922558325696906,-79.5600247753524],
        ],
        center: [9.1, -79.75],
        width: "91 m (Neopanamax locks)",
        dailyTraffic: "~36–40 vessels/day",
        globalTradeShare: "5% of global maritime trade",
        borderingNations: ["Panama", "United States (historical)"],
        wikipedia: "Panama_Canal",
        whyItMatters: "Connects the Atlantic and Pacific Oceans through Central America, saving 12,800 km versus rounding Cape Horn. Critical for US Navy inter-ocean fleet repositioning. 2023 drought forced vessel draught restrictions reducing capacity by 30%.",
        currentThreats: [
            "Climate change–driven drought (Gatun Lake water level critical)",
            "Chinese port operator presence at canal approaches (Hutchison Ports)",
            "US political statements on retaking canal control (2025)",
            "Canal authority capacity restrictions during low water events",
        ],
        minZoom: 5,
    },
    {
        name: "Cape of Good Hope",
        threatLevel: "LOW",
        polygon: [
            [-39.36100834636292,13.9754436926137],[-39.41023626047757,27.84578238477849],
            [-34.07138744246208,25.64916230285606],[-33.97468290669521,25.0299445134626],
            [-34.27120780582721,24.73024905553254],[-33.98337608141084,23.89930682226183],
            [-34.11683293512792,23.35377385525357],[-33.99414379797566,22.6047361045455],
            [-34.40520702350582,21.69709340658492],[-34.85114583186469,19.93440595057201],
            [-34.64379832542308,19.37807166302456],[-34.42994736161411,19.03603203892176],
            [-34.38156821895332,18.49635581440023],[-34.14520023162071,18.27788810509916],
            [-33.61593792288365,18.35874488213614],[-33.03036829065508,17.85556922494347],
            [-39.36100834636292,13.9754436926137],
        ],
        center: [-34.4, 18.5],
        width: "Open ocean",
        dailyTraffic: "~15,000 vessels/year (diverted from Suez)",
        globalTradeShare: "Emergency alternative route",
        borderingNations: ["South Africa"],
        wikipedia: "Cape_of_Good_Hope",
        whyItMatters: "The primary alternative route when the Suez Canal or Bab el-Mandeb is disrupted. Houthi attacks on Red Sea shipping since 2023 have rerouted over 60% of container ships around the Cape, adding 10–14 days and dramatically increasing voyage costs.",
        currentThreats: [
            "Surge in traffic due to Houthi Red Sea disruption",
            "Extreme weather and Cape Rollers sea state risk",
            "Fuel and supply logistics constraints for diverted vessels",
            "South African port capacity constraints (Durban, Cape Town)",
        ],
        minZoom: 5,
    },
    {
        name: "Mozambique Channel",
        threatLevel: "LOW",
        polygon: [
            [-15.55516958546517,40.52950878218399],[-16.98180876304449,39.07256617180247],
            [-17.55584441299782,37.35587209036758],[-18.89703140346284,36.0994733864559],
            [-20.18303713778162,34.83951823502701],[-22.52950196015883,35.59583665184374],
            [-21.92548839631508,43.19107967360961],[-21.73650738161318,43.33563582682436],
            [-21.62037052198124,43.44981037290505],[-21.4262142583079,43.42406596025938],
            [-21.28499691869615,43.50012838622695],[-21.22192848086553,43.69514865619925],
            [-20.14315677246857,44.38976428815526],[-19.53399120419083,44.38340800229093],
            [-18.4946276248469,44.00507136001883],[-17.33663286520624,43.98476157831375],
            [-16.14731333622495,44.54622685982573],[-15.92642891162515,45.30291037400602],
            [-15.5929418609849,46.31901878246733],[-15.00265445729084,47.10238319626129],
            [-14.34483097884362,47.65825733029556],[-12.59503828677731,40.59596509151854],
            [-15.55516958546517,40.52950878218399],
        ],
        center: [-18.0, 42.0],
        width: "422 km",
        dailyTraffic: "~2,000 vessels/year",
        globalTradeShare: "Eastern Africa access route",
        borderingNations: ["Mozambique", "Madagascar", "Tanzania", "Comoros"],
        wikipedia: "Mozambique_Channel",
        whyItMatters: "A secondary alternative route for vessels avoiding the Cape of Good Hope or serving East African ports. Critical for access to Mozambican LNG terminals — a growing strategic energy asset for European supply diversification away from Russia.",
        currentThreats: [
            "Islamist insurgency in northern Mozambique (Cabo Delgado province)",
            "Piracy risk from Somalia in northern approaches",
            "LNG terminal security (TotalEnergies, Eni operations)",
        ],
        minZoom: 5,
    },
]

// Lookup helper for backward compatibility with profile/enrichment features
function _cpPoly(name) {
    return CHOKEPOINTS.find(c => c.name === name)?.polygon || null
}

// Name → polygon lookup used by enrichment highlight rendering
const CHOKEPOINT_POLYS = Object.fromEntries(
    CHOKEPOINTS.filter(c => c.polygon).map(c => [c.name, c.polygon])
)

// Threat level colors (defined here so ChokepointPolygon & ChokepointPanel can both reference)
const _THREAT_COLORS = { CRITICAL: "#ef4444", HIGH: "#f59e0b", MODERATE: "#14b8a6", LOW: "#3b82f6" }

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

function _acClassify(ac) {
    if (ac.military || ac.interesting) return 'military'
    const cat = ac.category || ""
    if (cat === "A7") return 'helicopter'
    if (["A1", "A2"].includes(cat)) return 'general'
    if (["A3", "A4", "A5", "A6"].includes(cat)) return 'commercial'
    // Fallback: 3-letter ICAO airline prefix → commercial
    const cs = (ac.flight || "").trim().toUpperCase()
    if (/^[A-Z]{3}\d/.test(cs)) return 'commercial'
    return 'general'
}

// Type-specific SVG bodies and sizes — all created at call-time, never at module level.
// Returns { svgInner, size, glowClass }
function _acIconParts(ac) {
    const type = _acClassify(ac)

    if (type === 'helicopter') {
        // Green airplane silhouette — same shape as commercial, green tint
        const color = "rgba(0,221,102,0.95)"
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" class="ac-glow-grn">` +
            `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>` +
            `</svg>`
        return { svg, size: 18, anchor: 9 }
    }

    if (type === 'general') {
        // Top-down light aircraft: stubby fuselage, broad wings forward, small tail
        const color = "rgba(200,200,255,0.85)"
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" class="ac-glow-wht">` +
            // Fuselage
            `<path d="M12 2 L13.2 8 L13.2 18 L14 20 L10 20 L10.8 18 L10.8 8 Z" fill="${color}"/>` +
            // Left wing (high, forward)
            `<path d="M10.8 9 L2 14 L2 15.2 L10.8 11.5 Z" fill="${color}"/>` +
            // Right wing
            `<path d="M13.2 9 L22 14 L22 15.2 L13.2 11.5 Z" fill="${color}"/>` +
            // Left horizontal stabilizer
            `<path d="M10.8 18.5 L6 20.5 L6 21.5 L10.8 19.8 Z" fill="${color}"/>` +
            // Right horizontal stabilizer
            `<path d="M13.2 18.5 L18 20.5 L18 21.5 L13.2 19.8 Z" fill="${color}"/>` +
            // Prop disc at nose
            `<ellipse cx="12" cy="2.5" rx="2.5" ry="0.8" fill="${color}" opacity="0.5"/>` +
            `</svg>`
        return { svg, size: 18, anchor: 9 }
    }

    if (type === 'military') {
        // Same airliner silhouette, red/orange
        const color = "rgba(255,80,40,0.95)"
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" class="ac-glow-mil">` +
            `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>` +
            `</svg>`
        return { svg, size: 18, anchor: 9 }
    }

    // Commercial (default)
    const color = "rgba(0,200,255,0.95)"
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" class="ac-glow-cyan">` +
        `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>` +
        `</svg>`
    return { svg, size: 18, anchor: 9 }
}

// Aircraft icon factory — called during render, never at module level.
function makeAircraftIcon(ac, showLabel) {
    const { svg, size, anchor } = _acIconParts(ac)
    const callsign = (ac.flight || "").trim() || ac.icao || ""
    const altNum   = ac.alt_baro != null && !isNaN(Number(ac.alt_baro)) ? Number(ac.alt_baro) : null
    const altText  = altNum != null ? ` · ${altNum.toLocaleString()}ft` : ""
    const labelTop = size + 2

    const labelHtml = (showLabel && callsign)
        ? `<div style="position:absolute;top:${labelTop}px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;font-size:10px;padding:1px 6px;border-radius:10px;white-space:nowrap;font-family:system-ui,sans-serif;pointer-events:none;letter-spacing:0.02em">${callsign}${altText}</div>`
        : ""

    const html =
        `<div style="position:relative;width:${size}px;height:${size}px">` +
        `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;transform:rotate(${ac.track || 0}deg)">` +
        svg + `</div>${labelHtml}</div>`

    return L.divIcon({
        html,
        className:   "",
        iconSize:    [size, size],
        iconAnchor:  [anchor, anchor],
        popupAnchor: [0, -12],
    })
}

// ── Aircraft type + airline databases ────────────────────────────────────────

const AIRCRAFT_TYPES = {
  'B738': { name: 'Boeing 737-800',           image: 'Boeing_737_Next_Generation' },
  'B38M': { name: 'Boeing 737 MAX 8',         image: 'Boeing_737_MAX' },
  'B739': { name: 'Boeing 737-900',           image: 'Boeing_737_Next_Generation' },
  'B734': { name: 'Boeing 737-400',           image: 'Boeing_737_Classic' },
  'B737': { name: 'Boeing 737-700',           image: 'Boeing_737_Next_Generation' },
  'B39M': { name: 'Boeing 737 MAX 9',         image: 'Boeing_737_MAX' },
  'B3XM': { name: 'Boeing 737 MAX 10',        image: 'Boeing_737_MAX' },
  'B752': { name: 'Boeing 757-200',           image: 'Boeing_757' },
  'B753': { name: 'Boeing 757-300',           image: 'Boeing_757' },
  'B744': { name: 'Boeing 747-400',           image: 'Boeing_747' },
  'B748': { name: 'Boeing 747-8',             image: 'Boeing_747-8' },
  'B772': { name: 'Boeing 777-200',           image: 'Boeing_777' },
  'B773': { name: 'Boeing 777-300',           image: 'Boeing_777' },
  'B77W': { name: 'Boeing 777-300ER',         image: 'Boeing_777' },
  'B77L': { name: 'Boeing 777-200LR',         image: 'Boeing_777' },
  'B788': { name: 'Boeing 787-8',             image: 'Boeing_787_Dreamliner' },
  'B789': { name: 'Boeing 787-9',             image: 'Boeing_787_Dreamliner' },
  'B78X': { name: 'Boeing 787-10',            image: 'Boeing_787_Dreamliner' },
  'B764': { name: 'Boeing 767-400',           image: 'Boeing_767' },
  'B763': { name: 'Boeing 767-300',           image: 'Boeing_767' },
  'B1':   { name: 'B-1 Lancer',               image: 'Rockwell_B-1_Lancer' },
  'B52':  { name: 'B-52 Stratofortress',       image: 'Boeing_B-52_Stratofortress' },
  'A318': { name: 'Airbus A318',              image: 'Airbus_A318' },
  'A319': { name: 'Airbus A319',              image: 'Airbus_A319' },
  'A19N': { name: 'Airbus A319neo',           image: 'Airbus_A320neo_family' },
  'A320': { name: 'Airbus A320',              image: 'Airbus_A320_family' },
  'A20N': { name: 'Airbus A320neo',           image: 'Airbus_A320neo_family' },
  'A321': { name: 'Airbus A321',              image: 'Airbus_A320_family' },
  'A21N': { name: 'Airbus A321neo',           image: 'Airbus_A321neo' },
  'A310': { name: 'Airbus A310',              image: 'Airbus_A310' },
  'A332': { name: 'Airbus A330-200',          image: 'Airbus_A330' },
  'A333': { name: 'Airbus A330-300',          image: 'Airbus_A330' },
  'A339': { name: 'Airbus A330neo',           image: 'Airbus_A330neo' },
  'A346': { name: 'Airbus A340-600',          image: 'Airbus_A340' },
  'A359': { name: 'Airbus A350-900',          image: 'Airbus_A350' },
  'A35K': { name: 'Airbus A350-1000',         image: 'Airbus_A350' },
  'A388': { name: 'Airbus A380-800',          image: 'Airbus_A380' },
  'A400': { name: 'Airbus A400M Atlas',       image: 'Airbus_A400M_Atlas' },
  'BCS1': { name: 'Airbus A220-100',          image: 'Airbus_A220' },
  'BCS3': { name: 'Airbus A220-300',          image: 'Airbus_A220' },
  'E170': { name: 'Embraer E170',             image: 'Embraer_E-Jet_family' },
  'E75L': { name: 'Embraer E175',             image: 'Embraer_E-Jet_family' },
  'E190': { name: 'Embraer E190',             image: 'Embraer_E-Jet_family' },
  'E195': { name: 'Embraer E195',             image: 'Embraer_E-Jet_family' },
  'E290': { name: 'Embraer E190-E2',          image: 'Embraer_E-Jet_E2_family' },
  'E295': { name: 'Embraer E195-E2',          image: 'Embraer_E-Jet_E2_family' },
  'CRJ2': { name: 'CRJ-200',                 image: 'Bombardier_CRJ200' },
  'CRJ7': { name: 'CRJ-700',                 image: 'Bombardier_CRJ700_series' },
  'CRJ9': { name: 'CRJ-900',                 image: 'Bombardier_CRJ700_series' },
  'DH8D': { name: 'Dash 8 Q400',             image: 'Bombardier_Q_Series' },
  'AT45': { name: 'ATR 42-500',              image: 'ATR_42' },
  'AT75': { name: 'ATR 72-500',              image: 'ATR_72' },
  'AT76': { name: 'ATR 72-600',              image: 'ATR_72' },
  'C172': { name: 'Cessna 172',              image: 'Cessna_172' },
  'C208': { name: 'Cessna 208 Caravan',      image: 'Cessna_208_Caravan' },
  'C56X': { name: 'Cessna Citation Excel',   image: 'Cessna_Citation_Excel' },
  'C130': { name: 'C-130 Hercules',          image: 'Lockheed_C-130_Hercules' },
  'C17':  { name: 'C-17 Globemaster III',    image: 'Boeing_C-17_Globemaster_III' },
  'C5M':  { name: 'C-5M Super Galaxy',       image: 'Lockheed_C-5_Galaxy' },
  'K35R': { name: 'KC-135 Stratotanker',     image: 'Boeing_KC-135_Stratotanker' },
  'KC10': { name: 'KC-10 Extender',          image: 'McDonnell_Douglas_KC-10_Extender' },
  'E3CF': { name: 'E-3 Sentry AWACS',        image: 'Boeing_E-3_Sentry' },
  'P8':   { name: 'P-8 Poseidon',            image: 'Boeing_P-8_Poseidon' },
  'E6B':  { name: 'E-6B Mercury',            image: 'Boeing_E-6_Mercury' },
  'EUFI': { name: 'Eurofighter Typhoon',     image: 'Eurofighter_Typhoon' },
  'F16':  { name: 'F-16 Fighting Falcon',    image: 'General_Dynamics_F-16_Fighting_Falcon' },
  'F15':  { name: 'F-15 Eagle',              image: 'McDonnell_Douglas_F-15_Eagle' },
  'F18H': { name: 'F/A-18 Super Hornet',     image: 'Boeing_F/A-18E/F_Super_Hornet' },
  'F35':  { name: 'F-35 Lightning II',       image: 'Lockheed_Martin_F-35_Lightning_II' },
  'V22':  { name: 'V-22 Osprey',             image: 'Bell_Boeing_V-22_Osprey' },
  'H60':  { name: 'Black Hawk',              image: 'Sikorsky_UH-60_Black_Hawk' },
  'CONC': { name: 'Concorde',                image: 'Aérospatiale/BAC_Concorde' },
  'A124': { name: 'Antonov An-124',          image: 'Antonov_An-124_Ruslan' },
  'AN12': { name: 'Antonov An-12',           image: 'Antonov_An-12' },
  'IL76': { name: 'Ilyushin Il-76',          image: 'Ilyushin_Il-76' },
  'MD11': { name: 'McDonnell Douglas MD-11', image: 'McDonnell_Douglas_MD-11' },
  'DC10': { name: 'McDonnell Douglas DC-10', image: 'McDonnell_Douglas_DC-10' },
  'F900': { name: 'Dassault Falcon 900',     image: 'Dassault_Falcon_900' },
  'GLEX': { name: 'Bombardier Global',       image: 'Bombardier_Global_Express' },
  'GL7T': { name: 'Bombardier Global 7500',  image: 'Bombardier_Global_7500' },
  'GLF5': { name: 'Gulfstream G550',         image: 'Gulfstream_V' },
  'GLF6': { name: 'Gulfstream G650',         image: 'Gulfstream_G650' },
  'H25B': { name: 'Hawker 800',              image: 'Hawker_Siddeley_HS_125' },
  'LJ45': { name: 'Learjet 45',              image: 'Learjet_45' },
  'PC12': { name: 'Pilatus PC-12',           image: 'Pilatus_PC-12' },
  'PC24': { name: 'Pilatus PC-24',           image: 'Pilatus_PC-24' },
  'BE20': { name: 'Beechcraft King Air 200', image: 'Beechcraft_Super_King_Air' },
}

const AIRLINES = {
  // Middle East
  'UAE': 'Emirates',           'ETD': 'Etihad Airways',        'FDB': 'flydubai',
  'QTR': 'Qatar Airways',      'GFA': 'Gulf Air',               'SVA': 'Saudia',
  'MEA': 'Middle East Airlines','RJA': 'Royal Jordanian',       'OMA': 'Oman Air',
  'KAC': 'Kuwait Airways',     'JZR': 'Jazeera Airways',        'ABY': 'Air Arabia',
  'KNE': 'Flynas',             'MSR': 'EgyptAir',               'ELY': 'El Al',
  'IRA': 'Iran Air',           'IAW': 'Iraqi Airways',
  // Europe
  'BAW': 'British Airways',    'DLH': 'Lufthansa',              'AFR': 'Air France',
  'KLM': 'KLM',                'RYR': 'Ryanair',                'EZY': 'easyJet',
  'WZZ': 'Wizz Air',           'SWR': 'Swiss',                  'AUA': 'Austrian Airlines',
  'BEL': 'Brussels Airlines',  'EWG': 'Eurowings',              'VLG': 'Vueling',
  'NAX': 'Norwegian',          'SAS': 'SAS',                    'FIN': 'Finnair',
  'LOT': 'LOT Polish Airlines','TAP': 'TAP Air Portugal',       'IBE': 'Iberia',
  'AZA': 'ITA Airways',        'NOS': 'Neos',                   'PGT': 'Pegasus Airlines',
  'SXS': 'SunExpress',         'THY': 'Turkish Airlines',
  // Americas
  'AAL': 'American Airlines',  'UAL': 'United Airlines',        'DAL': 'Delta Air Lines',
  'SWA': 'Southwest Airlines', 'ACA': 'Air Canada',             'LAN': 'LATAM',
  'AVA': 'Avianca',            'GLO': 'GOL',
  // Asia-Pacific
  'SIA': 'Singapore Airlines', 'CPA': 'Cathay Pacific',         'ANA': 'All Nippon Airways',
  'JAL': 'Japan Airlines',     'CCA': 'Air China',              'CES': 'China Eastern',
  'CSN': 'China Southern',     'KAL': 'Korean Air',             'AAR': 'Asiana Airlines',
  'CAL': 'China Airlines',     'EVA': 'EVA Air',                'MAS': 'Malaysia Airlines',
  'THA': 'Thai Airways',       'HVN': 'Vietnam Airlines',       'VJC': 'VietJet Air',
  'BKP': 'Bangkok Airways',    'PAL': 'Philippine Airlines',    'CEB': 'Cebu Pacific',
  'LIO': 'Lion Air',           'GIA': 'Garuda Indonesia',       'AXM': 'AirAsia',
  'QFA': 'Qantas',             'VOZ': 'Virgin Australia',       'ANZ': 'Air New Zealand',
  'JST': 'Jetstar',
  // South Asia
  'AIC': 'Air India',          'IGO': 'IndiGo',                 'PIA': 'PIA',
  'SEJ': 'SpiceJet',           'AXB': 'Air India Express',
  // Africa / CIS
  'ETH': 'Ethiopian Airlines', 'SAA': 'South African Airways',  'RAM': 'Royal Air Maroc',
  'AFL': 'Aeroflot',           'SDM': 'Rossiya',                'SBI': 'S7 Airlines',
  'TUA': 'Turkmenistan Airlines','UZB': 'Uzbekistan Airways',   'AHY': 'Azerbaijan Airlines',
  'FLY': 'FlyArystan',
  // Cargo
  'FDX': 'FedEx Express',      'UPS': 'UPS Airlines',           'GTI': 'Atlas Air',
  'CLX': 'Cargolux',           'BOX': 'AeroLogic',              'MPH': 'Martinair',
  // Japan
  'AKJ': 'Air Japan',          'JJA': 'Jeju Air',
  // Military
  'RRR': 'Royal Air Force',    'RFR': 'French Air Force',       'GAF': 'German Air Force',
  'IAM': 'Italian Air Force',  'AME': 'Spanish Air Force',      'HVK': 'Royal Netherlands AF',
  'BAF': 'Belgian Air Force',  'PLF': 'Polish Air Force',       'TKF': 'Turkish Air Force',
  'RSD': 'Russian Air Force',  'CHN': 'PLA Air Force',          'IAF': 'Indian Air Force',
  'IRI': 'IRIAF',              'ISR': 'Israeli Air Force',      'RJF': 'Royal Jordanian AF',
  'RSF': 'Royal Saudi AF',     'QAF': 'Qatar Emiri AF',         'EGF': 'Egyptian Air Force',
  'RCH': 'USAF / AMC',         'AIO': 'USAF Special Ops',       'CNV': 'US Navy',
  'PAT': 'USAF',               'NAVY': 'US Navy',               'USAF': 'US Air Force',
  // North America
  'JBU': 'JetBlue',            'NKS': 'Spirit Airlines',        'FFT': 'Frontier Airlines',
  'ASA': 'Alaska Airlines',    'HAL': 'Hawaiian Airlines',      'WJA': 'WestJet',
  'TSC': 'Air Transat',        'SKW': 'SkyWest Airlines',       'ENY': 'Envoy Air',
  'RPA': 'Republic Airways',
  // China
  'DKH': 'Juneyao Airlines',   'CDG': 'Shandong Airlines',      'CHH': 'Hainan Airlines',
  'SHJ': 'Shenzhen Airlines',  'CSC': 'Sichuan Airlines',       'CXA': 'Xiamen Airlines',
  // Japan
  'APJ': 'Peach Aviation',     'SJO': 'Star Flyer',
  // Africa
  'RWD': 'RwandAir',           'KQA': 'Kenya Airways',          'NMB': 'Air Namibia',
  // South Asia
  'ALK': 'SriLankan Airlines',
  // Caucasus / CIS
  'AZG': 'Silk Way Airlines',
  // Caribbean
  'BWA': 'BWIA',
  // Cape Verde
  'TCV': 'TACV',
  // Turkey (THY already above)
  'OHY': 'Onur Air',           'AJT': 'AJet',
  // Greece
  'AEE': 'Aegean Airlines',    'BMS': 'Air Mediterranean',
  // Germany (cargo)
  'GEC': 'Lufthansa Cargo',    'BCS': 'European Air Transport',
}

const _AC_IMG_CACHE = {}  // cacheKey → Wikipedia thumbnail URL or null

// Build a cache key from (optional) airline name + typeCode
function _acImgCacheKey(typeCode, airlineName) {
    return airlineName ? `${airlineName}__${typeCode}` : typeCode
}

// Try airline-specific image first ("Emirates Airbus A380"), then generic type, then info.image slug
async function _fetchAcImage(typeCode, airlineName) {
    if (!typeCode) return null
    const code = typeCode.toUpperCase()
    const info = AIRCRAFT_TYPES[code]
    if (!info) return null
    const cacheKey = _acImgCacheKey(code, airlineName)
    if (_AC_IMG_CACHE[cacheKey] !== undefined) return _AC_IMG_CACHE[cacheKey]
    _AC_IMG_CACHE[cacheKey] = null  // mark as in-flight to prevent duplicate requests

    const typeName = info.name
    const terms = airlineName
        ? [`${airlineName} ${typeName}`, typeName, info.image]
        : [typeName, info.image]

    for (const term of terms) {
        try {
            const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}`)
            const d = await r.json()
            if (d.thumbnail?.source) {
                _AC_IMG_CACHE[cacheKey] = d.thumbnail.source
                return d.thumbnail.source
            }
        } catch { continue }
    }
    return null
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
    const glowSize = compact ? 56 : 64
    const coreSize = compact ? 32 : 40
    const ringSize = compact ? 42 : 52
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

// ── Point-in-polygon helpers for country detection ───────────────────────────
function _pip(pt, ring) {
    const [x, y] = pt
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
            inside = !inside
    }
    return inside
}
function _pointInFeature(lngLat, feature) {
    const g = feature?.geometry
    if (!g) return false
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []
    return polys.some(poly => _pip(lngLat, poly[0]))
}

// ── CountryClickHandler — map-level click → point-in-polygon country lookup ──
function CountryClickHandler({ countriesGeo, onCountryClick, onNoCountry }) {
    const idxRef = useRef(null)
    useEffect(() => {
        if (!countriesGeo?.features) { idxRef.current = null; return }
        idxRef.current = countriesGeo.features.map(f => {
            const coords = []
            const g = f.geometry
            if (g?.type === "Polygon") coords.push(...g.coordinates[0])
            else if (g?.type === "MultiPolygon") g.coordinates.forEach(p => coords.push(...p[0]))
            if (!coords.length) return { f, minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 }
            const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1])
            return { f, minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) }
        })
    }, [countriesGeo])
    useMapEvents({
        click(ev) {
            const idx = idxRef.current
            if (!idx) return
            // Skip clicks that land directly on a marker/icon element
            const tgt = ev.originalEvent?.target
            if (tgt) {
                const tag = tgt.tagName?.toLowerCase()
                const cls = String(tgt.className || "") + String(tgt.parentElement?.className || "")
                if (tag === "img" || cls.includes("leaflet-marker") || cls.includes("hw-marker") ||
                    tgt.closest?.(".leaflet-marker-pane") || tgt.closest?.(".leaflet-shadow-pane")) return
            }
            const lat = ev.latlng.lat, lng = ev.latlng.lng
            for (const entry of idx) {
                const { f, minLat, maxLat, minLng, maxLng } = entry
                if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) continue
                if (_pointInFeature([lng, lat], f)) {
                    const name = f.properties?.ADMIN || f.properties?.name
                    if (name) { onCountryClick(f, name); return }
                }
            }
            onNoCountry?.()
        },
    })
    return null
}

// ── makeWebcamIcon ─────────────────────────────────────────────────────────────
let _webcamIcon = null
function getWebcamIcon() {
    return _webcamIcon ??= L.divIcon({
        className: "",
        html: `<div style="width:28px;height:28px;background:rgba(20,20,30,0.9);border:2px solid #FFB300;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 8px rgba(255,179,0,0.4);"><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='14' height='14'><path d='M12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zm6.8-10.4H17l-1.35-1.6H8.35L7 4.8H5.2A2.2 2.2 0 0 0 3 7v11.2A2.2 2.2 0 0 0 5.2 20.4h13.6a2.2 2.2 0 0 0 2.2-2.2V7a2.2 2.2 0 0 0-2.2-2.2z' fill='#FFB300'/></svg></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    })
}

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
    const size = 28, half = 14
    const html =
        `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;position:relative;pointer-events:auto;filter:drop-shadow(0 0 6px rgba(56,189,248,0.6));" title="${name||'Port'}">` +
        `<div style="position:absolute;inset:0;border-radius:50%;border:1.5px solid #38bdf8;background:rgba(56,189,248,0.08);"></div>` +
        `<svg width="18" height="11" viewBox="0 0 26 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:relative;">` +
        `<path d="M1 10 L5 5 L23 5 L25 10 L25 13 L1 13 Z" fill="#38bdf8"/>` +
        `<rect x="15" y="1" width="7" height="4" rx="0.5" fill="#38bdf8"/>` +
        `<rect x="20" y="0" width="2" height="1" fill="#38bdf8"/>` +
        `<line x1="8" y1="5" x2="8" y2="1" stroke="#38bdf8" stroke-width="1.2"/>` +
        `<line x1="8" y1="1" x2="14" y2="4" stroke="#38bdf8" stroke-width="0.8" opacity="0.6"/>` +
        `</svg>` +
        `</div>`
    return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [half, half], popupAnchor: [0, -half-2] })
}

const _AIS_TYPE_COLOR = { tanker: "#f59e0b", cargo: "#14b8a6", container: "#06b6d4", military: "#ef4444", passenger: "#3b82f6", fishing: "#84cc16", other: "#64748b" }

function _vesselShipType(vessel) {
    const t = (vessel.ship_type || "").toLowerCase()
    if (t.includes("tanker") || t.includes("oil") || t.includes("lng") || t.includes("lpg")) return "tanker"
    if (t.includes("container")) return "container"
    if (t.includes("cargo") || t.includes("bulk") || t.includes("general")) return "cargo"
    if (t.includes("passenger") || t.includes("cruise") || t.includes("ferry")) return "passenger"
    if (t.includes("military") || t.includes("naval") || t.includes("warship")) return "military"
    if (t.includes("fishing") || t.includes("trawler")) return "fishing"
    return "other"
}

// Top-down vessel silhouettes — bow points up (north = 0°), rotated by heading
function makeAisVesselIcon(shipType, heading) {
    const color  = _AIS_TYPE_COLOR[shipType] || _AIS_TYPE_COLOR.other
    const hdg    = isFinite(Number(heading)) && Number(heading) !== 511 ? Number(heading) : 0
    const r      = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16)
    const glow   = `rgba(${r},${g},${b},0.55)`

    // Shape variants by type — all in a 16×28 viewBox, bow at top
    const hull = {
        tanker:    "M8,1 L13,7 L14,14 L14,24 L11,27 L5,27 L2,24 L2,14 L3,7 Z",
        container: "M8,1 L14,8 L14,25 L12,27 L4,27 L2,25 L2,8 Z",
        cargo:     "M8,1 L13,7 L13,24 L11,27 L5,27 L3,24 L3,7 Z",
        passenger: "M8,1 L12,6 L13,12 L13,24 L10,27 L6,27 L3,24 L3,12 L4,6 Z",
        military:  "M8,0 L12,5 L14,10 L14,24 L11,27 L5,27 L2,24 L2,10 L4,5 Z",
        fishing:   "M8,2 L12,8 L12,22 L10,25 L6,25 L4,22 L4,8 Z",
        other:     "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z",
    }[shipType] || "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z"

    // Deck detail markings
    const detail = {
        tanker:    `<ellipse cx="8" cy="14" rx="4" ry="3" fill="rgba(0,0,0,0.22)"/><ellipse cx="8" cy="21" rx="4" ry="3" fill="rgba(0,0,0,0.22)"/>`,
        container: `<rect x="4" y="10" width="8" height="3" fill="rgba(0,0,0,0.2)"/><rect x="4" y="15" width="8" height="3" fill="rgba(0,0,0,0.2)"/><rect x="4" y="20" width="8" height="3" fill="rgba(0,0,0,0.2)"/>`,
        cargo:     `<rect x="5" y="12" width="6" height="8" rx="1" fill="rgba(0,0,0,0.2)"/>`,
        passenger: `<rect x="5" y="8" width="6" height="5" rx="1" fill="rgba(0,0,0,0.22)"/><rect x="5" y="15" width="6" height="5" rx="1" fill="rgba(0,0,0,0.22)"/>`,
        military:  `<rect x="6" y="12" width="4" height="9" fill="rgba(0,0,0,0.3)"/><circle cx="8" cy="8" r="2" fill="rgba(0,0,0,0.35)"/>`,
        fishing:   `<circle cx="8" cy="13" r="2.5" fill="rgba(0,0,0,0.25)"/>`,
        other:     `<rect x="5" y="13" width="6" height="6" fill="rgba(0,0,0,0.18)"/>`,
    }[shipType] || ""

    const svg = `<svg width="16" height="28" viewBox="0 0 16 28" xmlns="http://www.w3.org/2000/svg" `
              + `style="transform:rotate(${hdg}deg);transform-origin:50% 50%;display:block;overflow:visible;`
              + `filter:drop-shadow(0 0 3px ${glow});">`
              + `<path d="${hull}" fill="${color}" stroke="rgba(255,255,255,0.25)" stroke-width="0.7" opacity="0.92"/>`
              + detail
              + `</svg>`
    return L.divIcon({ html: svg, className: "", iconSize: [16, 28], iconAnchor: [8, 14] })
}

// Wrapper that accepts a full vessel object (uses ship_type + heading from it)
function makeAisVesselIconFromVessel(vessel) {
    return makeAisVesselIcon(_vesselShipType(vessel), vessel.heading)
}

// Zoom-aware icon: tiny colored dot at low zoom, full SVG ship at zoom ≥ 9
function makeAisVesselIconForZoom(vessel, zoom) {
    if (zoom >= 9) return makeAisVesselIconFromVessel(vessel)
    const color = _AIS_TYPE_COLOR[_vesselShipType(vessel)] || _AIS_TYPE_COLOR.other
    const sz = zoom >= 7 ? 8 : 6
    const dot = `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};`
              + `box-shadow:0 0 4px ${color};opacity:0.85;"></div>`
    return L.divIcon({ html: dot, className: "", iconSize: [sz, sz], iconAnchor: [sz/2, sz/2] })
}

// Returns hull SVG path for a given ship type (same paths as makeAisVesselIcon, for reuse in popup)
function _vesselHullPath(shipType) {
    return {
        tanker:    "M8,1 L13,7 L14,14 L14,24 L11,27 L5,27 L2,24 L2,14 L3,7 Z",
        container: "M8,1 L14,8 L14,25 L12,27 L4,27 L2,25 L2,8 Z",
        cargo:     "M8,1 L13,7 L13,24 L11,27 L5,27 L3,24 L3,7 Z",
        passenger: "M8,1 L12,6 L13,12 L13,24 L10,27 L6,27 L3,24 L3,12 L4,6 Z",
        military:  "M8,0 L12,5 L14,10 L14,24 L11,27 L5,27 L2,24 L2,10 L4,5 Z",
        fishing:   "M8,2 L12,8 L12,22 L10,25 L6,25 L4,22 L4,8 Z",
        other:     "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z",
    }[shipType] || "M8,2 L13,8 L13,23 L11,26 L5,26 L3,23 L3,8 Z"
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
function getNewsConflictIcon() {
    return L.divIcon({
        className: "",
        html: '<div style="width:16px;height:16px;background:#FFB300;border-radius:50%;border:2px solid #FF8F00;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
    })
}

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
let _homeIcon = null
function getHomeIcon() {
    return _homeIcon ??= L.divIcon({
        className: "",
        html: `<div style="width:28px;height:28px;background:rgba(13,148,136,0.85);border:1.5px solid #0d9488;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 6L7 1l6 5v6a1 1 0 01-1 1H2a1 1 0 01-1-1V6z" stroke="#fff" stroke-width="1.2" fill="rgba(255,255,255,0.15)"/><rect x="5" y="8" width="4" height="5" rx="0.5" fill="#fff" opacity="0.9"/></svg></div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
    })
}
let _workIcon = null
function getWorkIcon() {
    return _workIcon ??= L.divIcon({
        className: "",
        html: `<div style="width:28px;height:28px;background:rgba(217,119,6,0.85);border:1.5px solid #d97706;border-radius:6px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="5" width="12" height="8" rx="1" stroke="#fff" stroke-width="1.2" fill="rgba(255,255,255,0.15)"/><path d="M4 5V3a1 1 0 011-1h4a1 1 0 011 1v2" stroke="#fff" stroke-width="1.2"/><line x1="7" y1="5" x2="7" y2="13" stroke="#fff" stroke-width="1" opacity="0.6"/></svg></div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
    })
}

// ── ADS-B track altitude coloring ────────────────────────────────────────────
function _altColor(alt) {
    if (alt == null || isNaN(alt)) return "#94a3b8"
    if (alt < 10000) return "#22c55e"   // green  — low
    if (alt < 25000) return "#38bdf8"   // cyan   — medium
    if (alt < 35000) return "#3b82f6"   // blue   — high
    return "#a855f7"                     // purple — cruise
}

// Group consecutive track points by altitude band into colored segments
function _segmentTrack(points) {
    if (!points.length) return []
    const segments = []
    let cur = { color: _altColor(points[0].alt), coords: [[points[0].lat, points[0].lon]] }
    for (let i = 1; i < points.length; i++) {
        const p = points[i]
        const c = _altColor(p.alt)
        if (c === cur.color) {
            cur.coords.push([p.lat, p.lon])
        } else {
            cur.coords.push([p.lat, p.lon])   // bridge point to avoid gap
            segments.push(cur)
            cur = { color: c, coords: [[points[i - 1].lat, points[i - 1].lon], [p.lat, p.lon]] }
        }
    }
    segments.push(cur)
    return segments.filter(s => s.coords.length >= 2)
}

// ── AircraftLayer ─────────────────────────────────────────────────────────────
const AircraftLayer = memo(function AircraftLayer({
    visible, showLabels, boundsRef, onCount, polling, activateKey,
    directorAC = null,  // Set<string> of icao24 (lowercase) — Director Mode filter
    timeTravelTime = null, // ISO string — when set, replace live feed with snapshot data
}) {
    const map = useMap()
    const [aircraft,   setAircraft]   = useState([])
    const [trackState, setTrackState] = useState({ icao: null, segments: [], status: "idle", pointCount: 0 })
    const [selectedAc, setSelectedAc] = useState(null)   // compact tooltip
    const [detailAc,   setDetailAc]   = useState(null)   // full detail panel
    const [followAc,   setFollowAc]   = useState(null)   // followed aircraft (latest snapshot)
    const [acImgUrl,   setAcImgUrl]   = useState({})     // cacheKey → Wikipedia thumbnail url
    const [acTypeDesc, setAcTypeDesc] = useState({})     // typeCode → Wikipedia extract text
    const [acRoute,    setAcRoute]    = useState({})     // icao → { departure, destination, departure_name, destination_name, loading }
    const [acPhoto,    setAcPhoto]    = useState({})     // icao → { thumbnail_url, photo_url, photographer, loading }
    const [acFilter,   setAcFilter]   = useState({ military: true, commercial: true, helicopter: true, general: true })
    const [filterOpen, setFilterOpen] = useState(false)
    const intervalRef    = useRef(null)
    const followIcaoRef  = useRef(null)                  // ref so panTo effect never goes stale
    const trackHistoryRef = useRef({})                   // icao → [{lat, lon, alt, ts}]

    // ── 500ms polling ────────────────────────────────────────────────────────
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
                    // Accumulate track history per aircraft (capped at 300 pts, ~2.5 min at 500ms)
                    const now = Date.now()
                    list.forEach(ac => {
                        if (ac.lat == null || ac.lon == null) return
                        const hist = trackHistoryRef.current[ac.icao] || []
                        hist.push({ lat: ac.lat, lon: ac.lon, alt: ac.alt_baro, ts: now })
                        if (hist.length > 300) hist.splice(0, hist.length - 300)
                        trackHistoryRef.current[ac.icao] = hist
                    })
                })
                .catch(err => console.error("[adsb] fetch error:", err))
        }
        clearInterval(intervalRef.current)
        fetchAdsb()
        intervalRef.current = setInterval(fetchAdsb, 500)
        return () => clearInterval(intervalRef.current)
    }, [polling, activateKey])

    // ── Time Travel: load historical aircraft snapshot ────────────────────────
    useEffect(() => {
        if (!timeTravelTime) return
        clearInterval(intervalRef.current)   // stop live polling
        const tok = localStorage.getItem("hw-auth-token")
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
        fetch(`${API}/api/history/snapshot?timestamp=${encodeURIComponent(timeTravelTime)}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                const mapped = data.aircraft.map(ac => ({
                    icao:     ac.icao24,
                    flight:   ac.callsign || "",
                    lat:      ac.lat,
                    lon:      ac.lon,
                    alt_baro: ac.altitude,
                    gs:       ac.speed,
                    track:    ac.heading,
                    military: ac.military,
                }))
                setAircraft(mapped)
                onCount(mapped.length)
            })
            .catch(() => {})
    }, [timeTravelTime])  // eslint-disable-line

    // ── Follow mode: soft pan toward aircraft on each update ─────────────────
    // Uses panTo (not flyTo) so the user can freely pan away between ticks.
    useEffect(() => {
        if (!followIcaoRef.current || !aircraft.length) return
        const liveAc = aircraft.find(a => a.icao === followIcaoRef.current)
        if (!liveAc || liveAc.lat == null || liveAc.lon == null) return
        setFollowAc(liveAc)
        map.panTo([liveAc.lat, liveAc.lon], { animate: true, duration: 0.4 })
    }, [aircraft]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Click handler ─────────────────────────────────────────────────────────
    const handleAcClick = useCallback((ac) => {
        // Fetch Wikipedia aircraft image (airline-specific first, then generic)
        const typeCode     = (ac.t || ac.type || "").toUpperCase()
        const callsign0    = (ac.flight || "").trim()
        const airlinePrefix = callsign0.slice(0, 3).toUpperCase()
        const airlineName  = AIRLINES[airlinePrefix] || null
        if (typeCode) {
            const cacheKey = _acImgCacheKey(typeCode, airlineName)
            if (_AC_IMG_CACHE[cacheKey] !== undefined) {
                if (_AC_IMG_CACHE[cacheKey]) setAcImgUrl(prev => ({ ...prev, [cacheKey]: _AC_IMG_CACHE[cacheKey] }))
            } else {
                _fetchAcImage(typeCode, airlineName).then(url => {
                    if (url) setAcImgUrl(prev => ({ ...prev, [cacheKey]: url }))
                })
            }
        }

        // ── Enrichment: fire route + photo fetches in parallel ────────────
        // Only fetch once per ICAO (skip if already loading or loaded)
        if (!acRoute[ac.icao]) {
            setAcRoute(prev => ({ ...prev, [ac.icao]: { loading: true } }))
            const callsign = (ac.flight || "").trim()
            const routeUrl = `${API}/api/aviation/route/${ac.icao}${callsign ? `?callsign=${encodeURIComponent(callsign)}` : ""}`
            console.log("[route] fetching:", routeUrl, "| ac.icao:", ac.icao, "| callsign:", callsign || "(none)", "| full ac:", JSON.stringify(ac))
            fetch(routeUrl)
                .then(r => { console.log("[route] HTTP", r.status, routeUrl); return r.ok ? r.json() : null })
                .then(data => { console.log("[route] response:", data); setAcRoute(prev => ({ ...prev, [ac.icao]: { loading: false, ...(data || {}) } })) })
                .catch(err => { console.error("[route] fetch error:", err); setAcRoute(prev => ({ ...prev, [ac.icao]: { loading: false } })) })
        }
        if (!acPhoto[ac.icao]) {
            setAcPhoto(prev => ({ ...prev, [ac.icao]: { loading: true } }))
            fetch(`${API}/api/aviation/photo/${ac.icao}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => setAcPhoto(prev => ({ ...prev, [ac.icao]: { loading: false, ...(data || {}) } })))
                .catch(() => setAcPhoto(prev => ({ ...prev, [ac.icao]: { loading: false } })))
        }

        // Second click on same aircraft → open detail panel
        if (selectedAc?.icao === ac.icao) {
            setDetailAc(ac)
            return
        }

        // First click → show tooltip + build track from accumulated history
        setSelectedAc(ac)
        setDetailAc(null)

        const hist = trackHistoryRef.current[ac.icao] || []
        console.log("[adsb track] history for", ac.icao, ":", hist.length, "pts")
        if (hist.length >= 2) {
            setTrackState({ icao: ac.icao, segments: _segmentTrack(hist), status: "ok", pointCount: hist.length })
        } else {
            setTrackState({ icao: ac.icao, segments: [], status: "unavailable", pointCount: 0 })
        }
    }, [selectedAc, acRoute, acPhoto])

    // ── Tooltip renderer ──────────────────────────────────────────────────────
    const renderTooltip = (ac) => {
        const callsign    = (ac.flight || "").trim() || ac.icao || ""
        const icaoPrefix  = callsign.slice(0, 3).toUpperCase()
        const airline     = AIRLINES[icaoPrefix] || null
        const typeCode    = (ac.t || ac.type || "").toUpperCase()
        const typeInfo    = AIRCRAFT_TYPES[typeCode] || null
        // Prefer Planespotters photo, fall back to Wikipedia
        const photoData   = acPhoto[ac.icao] || {}
        const wikiUrl     = acImgUrl[_acImgCacheKey(typeCode, airline)] || acImgUrl[typeCode] || null
        const imgUrl      = photoData.thumbnail_url || wikiUrl
        const altNum      = ac.alt_baro != null && !isNaN(Number(ac.alt_baro)) ? Number(ac.alt_baro) : null
        const altText     = altNum != null ? `${altNum.toLocaleString()} ft` : null
        const spdText     = ac.gs != null ? `${Math.round(ac.gs)} kts` : null
        const squawk      = ac.squawk
        const isEmergency = squawk === "7500" || squawk === "7600" || squawk === "7700"
        const isMil       = ac.military || Object.prototype.hasOwnProperty.call(AIRLINES, icaoPrefix + "_MIL")
        const routeData   = acRoute[ac.icao] || {}

        return (
            <Tooltip permanent interactive direction="top" offset={[0, -12]} className="ac-tooltip-custom" pane="tooltipPane">
                <div style={{
                    background: "rgba(6,13,26,0.96)", border: "1px solid rgba(56,189,248,0.35)",
                    borderRadius: 8, padding: "10px 12px", minWidth: 210, maxWidth: 280,
                    fontFamily: "Inter,-apple-system,sans-serif", boxShadow: "0 4px 24px rgba(0,0,0,0.65)",
                    fontSize: 12, color: "#e8edf2", position: "relative", zIndex: 10000,
                }}>
                    {/* Aircraft photo */}
                    {imgUrl && (
                        <div style={{ position: "relative", marginBottom: 8 }}>
                            <img src={imgUrl} alt={typeInfo?.name || typeCode}
                                style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 4, display: "block" }}
                                onError={e => { e.target.style.display = "none" }}
                            />
                            {photoData.photographer && (
                                <span style={{
                                    position: "absolute", bottom: 3, right: 4,
                                    fontSize: 8, color: "rgba(255,255,255,0.45)",
                                    background: "rgba(0,0,0,0.55)", padding: "1px 4px", borderRadius: 2,
                                }}>© {photoData.photographer}</span>
                            )}
                        </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                        <div>
                            {airline && <div style={{ fontSize: 10, color: "#38bdf8", fontWeight: 600, marginBottom: 1 }}>{airline}</div>}
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{callsign}</div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); setSelectedAc(null) }}
                            style={{ background: "none", border: "none", color: "rgba(232,237,242,0.35)", cursor: "pointer", fontSize: 15, padding: "0 2px", lineHeight: 1 }}>✕</button>
                    </div>
                    {typeInfo && <div style={{ fontSize: 10, color: "rgba(232,237,242,0.45)", marginBottom: 4 }}>{typeInfo.name}</div>}
                    {/* Route row */}
                    {routeData.loading && (
                        <div style={{ fontSize: 9, color: "rgba(56,189,248,0.5)", marginBottom: 5 }}>Resolving route…</div>
                    )}
                    {!routeData.loading && (routeData.departure || routeData.destination) && (
                        <div style={{
                            fontSize: 10, marginBottom: 6, padding: "4px 7px", borderRadius: 4,
                            background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.18)",
                        }}>
                            <span style={{ color: "#38bdf8", fontWeight: 700 }}>
                                {routeData.departure || "?"} → {routeData.destination || "?"}
                            </span>
                            {(routeData.departure_name || routeData.destination_name) && (
                                <div style={{ fontSize: 9, color: "rgba(232,237,242,0.45)", marginTop: 1 }}>
                                    {[routeData.departure_name, routeData.destination_name].filter(Boolean).join(" → ")}
                                </div>
                            )}
                        </div>
                    )}
                    {(altText || spdText) && (
                        <div style={{ fontSize: 10, color: "rgba(232,237,242,0.6)", marginBottom: 7 }}>
                            {[altText, spdText].filter(Boolean).join(" · ")}
                        </div>
                    )}
                    {isEmergency && (
                        <div style={{ fontSize: 9, background: "rgba(239,68,68,0.18)", color: "#ef4444", padding: "3px 6px", borderRadius: 4, fontWeight: 700, marginBottom: 6 }}>
                            ⚠ SQUAWK {squawk}
                        </div>
                    )}
                    {trackState.icao === ac.icao && trackState.status === "loading" && (
                        <div style={{ fontSize: 9, color: "#38bdf8", marginBottom: 5 }}>Loading track…</div>
                    )}
                    {(isMil || ac.interesting) && (
                        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                            {isMil && <span style={{ fontSize: 9, background: "rgba(255,68,68,0.15)", color: "#ff4444", padding: "2px 5px", borderRadius: 4, fontWeight: 700 }}>MILITARY</span>}
                            {ac.interesting && <span style={{ fontSize: 9, background: "rgba(255,204,0,0.12)", color: "#ffcc00", padding: "2px 5px", borderRadius: 4, fontWeight: 700 }}>INTERESTING</span>}
                        </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button
                            onClick={e => { e.stopPropagation(); setDetailAc(ac) }}
                            style={{ flex: 1, padding: "5px 0", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 5, color: "#38bdf8", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                        >More →</button>
                        <button
                            onClick={e => {
                                e.stopPropagation()
                                followIcaoRef.current = ac.icao
                                setFollowAc(ac)
                                setSelectedAc(null)
                                map.panTo([ac.lat, ac.lon], { animate: true, duration: 0.5 })
                            }}
                            style={{ flex: 1, padding: "5px 0", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 5, color: "#22c55e", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                        >Follow ▶</button>
                    </div>
                </div>
            </Tooltip>
        )
    }

    // ── Follow mode toast ─────────────────────────────────────────────────────
    const renderFollowBar = () => {
        if (!followAc) return null
        const ac        = followAc
        const callsign  = (ac.flight || "").trim() || ac.icao || ""
        const prefix    = callsign.slice(0, 3).toUpperCase()
        const airline   = AIRLINES[prefix] || null
        const typeCode  = (ac.t || ac.type || "").toUpperCase()
        const typeInfo  = AIRCRAFT_TYPES[typeCode] || null
        const altNum    = ac.alt_baro != null && !isNaN(Number(ac.alt_baro)) ? Number(ac.alt_baro) : null
        const acColor   = _altColor(altNum)
        const routeData = acRoute[ac.icao] || {}

        const toast = (
            <div style={{
                position: "fixed",
                top: 60,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1800,
                width: "max-content",
                maxWidth: "calc(100vw - 32px)",
                background: "rgba(6,13,26,0.94)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                border: `1px solid ${acColor}44`,
                borderLeft: `3px solid ${acColor}`,
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: "Inter,-apple-system,sans-serif",
                color: "#e8edf2",
                boxShadow: `0 4px 24px rgba(0,0,0,0.55), 0 0 12px ${acColor}18`,
                pointerEvents: "auto",
            }}>
                {/* Aircraft icon */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
                    style={{ transform: `rotate(${ac.track || 0}deg)`, flexShrink: 0 }}>
                    <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill={acColor}/>
                </svg>

                {/* Flight ID + route */}
                <div style={{ flexShrink: 0, minWidth: 0 }}>
                    {airline && <div style={{ fontSize: 9, color: acColor, fontWeight: 600, letterSpacing: "0.06em", lineHeight: 1, marginBottom: 1 }}>{airline}</div>}
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
                        {callsign}
                        {!routeData.loading && (routeData.departure || routeData.destination) && (
                            <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(232,237,242,0.6)", marginLeft: 6 }}>
                                · {routeData.departure || "?"} → {routeData.destination || "?"}
                            </span>
                        )}
                    </div>
                </div>

                {/* Type — hidden on very small screens */}
                {typeInfo && (
                    <div style={{ fontSize: 10, color: "rgba(232,237,242,0.45)", flexShrink: 0, display: "var(--follow-type-display, block)", whiteSpace: "nowrap" }}>
                        {typeInfo.name}
                    </div>
                )}

                {/* Divider */}
                <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

                {/* Live stats */}
                <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                    {altNum != null && (
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8, color: "rgba(232,237,242,0.35)", letterSpacing: "0.06em", lineHeight: 1 }}>ALT</div>
                            <div style={{ color: acColor, fontWeight: 600, lineHeight: 1.3 }}>{altNum.toLocaleString()}</div>
                        </div>
                    )}
                    {ac.gs != null && (
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8, color: "rgba(232,237,242,0.35)", letterSpacing: "0.06em", lineHeight: 1 }}>SPD</div>
                            <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{Math.round(ac.gs)} kt</div>
                        </div>
                    )}
                    {ac.track != null && (
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 8, color: "rgba(232,237,242,0.35)", letterSpacing: "0.06em", lineHeight: 1 }}>HDG</div>
                            <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{Math.round(ac.track)}°</div>
                        </div>
                    )}
                </div>

                {/* Stop following */}
                <button
                    onClick={() => { followIcaoRef.current = null; setFollowAc(null) }}
                    style={{
                        background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: 5, color: "#ef4444", fontSize: 10, cursor: "pointer",
                        padding: "4px 9px", fontFamily: "inherit", fontWeight: 700, flexShrink: 0,
                        lineHeight: 1, marginLeft: 2,
                    }}
                >✕</button>
            </div>
        )
        return createPortal(toast, document.body)
    }

    // ── Fetch Wikipedia text when detail panel opens ───────────────────────────
    useEffect(() => {
        if (!detailAc) return
        const typeCode = (detailAc.t || detailAc.type || "").toUpperCase()
        const info = AIRCRAFT_TYPES[typeCode]
        if (!info || acTypeDesc[typeCode] !== undefined) return
        setAcTypeDesc(prev => ({ ...prev, [typeCode]: null }))  // mark as fetching
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(info.name.replace(/ /g, '_'))}`)
            .then(r => r.json())
            .then(d => {
                if (d.extract) {
                    const sentences = d.extract.split(/(?<=[.!?])\s+/)
                    setAcTypeDesc(prev => ({ ...prev, [typeCode]: sentences.slice(0, 3).join(' ') }))
                }
            })
            .catch(() => {})
    }, [detailAc]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Full detail panel ─────────────────────────────────────────────────────
    const renderDetailPanel = () => {
        if (!detailAc) return null
        const ac          = detailAc
        const callsign    = (ac.flight || "").trim() || ac.icao || ""
        const icaoPrefix  = callsign.slice(0, 3).toUpperCase()
        const airline     = AIRLINES[icaoPrefix] || null
        const typeCode    = (ac.t || ac.type || "").toUpperCase()
        const typeInfo    = AIRCRAFT_TYPES[typeCode] || null
        // Prefer Planespotters, fall back to Wikipedia
        const photoData   = acPhoto[ac.icao] || {}
        const wikiUrl     = acImgUrl[_acImgCacheKey(typeCode, airline)] || acImgUrl[typeCode] || null
        const imgUrl      = photoData.thumbnail_url || wikiUrl
        const typeDesc    = acTypeDesc[typeCode] || null
        const routeData   = acRoute[ac.icao] || {}
        const altNum      = ac.alt_baro != null && !isNaN(Number(ac.alt_baro)) ? Number(ac.alt_baro) : null
        const squawk      = ac.squawk
        const isEmergency = squawk === "7500" || squawk === "7600" || squawk === "7700"
        const squawkLabels = { "7500": "HIJACK", "7600": "RADIO FAIL", "7700": "EMERGENCY" }
        const isMil       = ac.military

        const panel = (
            <div style={{
                position: "fixed", top: 54, right: 0, width: 360,
                height: "calc(100vh - 54px)", background: "rgba(6,13,26,0.97)",
                backdropFilter: "blur(24px)", borderLeft: "1px solid rgba(56,189,248,0.2)",
                zIndex: 1500, display: "flex", flexDirection: "column",
                fontFamily: "Inter,-apple-system,sans-serif", color: "#e8edf2", overflowY: "auto",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                    <div>
                        {airline && <div style={{ fontSize: 10, color: "#38bdf8", fontWeight: 600, marginBottom: 2 }}>{airline}</div>}
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{callsign}</div>
                    </div>
                    <button onClick={() => setDetailAc(null)}
                        style={{ background: "none", border: "none", color: "rgba(232,237,242,0.4)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
                </div>

                {imgUrl && (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                        <img src={imgUrl} alt={typeInfo?.name || typeCode}
                            style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
                            onError={e => { e.target.style.display = "none" }}
                        />
                        {photoData.photographer && (
                            <span style={{
                                position: "absolute", bottom: 5, right: 8,
                                fontSize: 9, color: "rgba(255,255,255,0.5)",
                                background: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: 3,
                            }}>© {photoData.photographer}</span>
                        )}
                    </div>
                )}

                <div style={{ padding: "12px 16px", flex: 1 }}>
                    {/* Route */}
                    {routeData.loading && (
                        <div style={{ fontSize: 10, color: "rgba(56,189,248,0.5)", marginBottom: 12 }}>Resolving flight route…</div>
                    )}
                    {!routeData.loading && (routeData.departure || routeData.destination) && (
                        <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Route</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "#38bdf8" }}>{routeData.departure || "?"}</div>
                                    {routeData.departure_name && <div style={{ fontSize: 9, color: "rgba(232,237,242,0.4)", marginTop: 1, maxWidth: 90, textAlign: "center" }}>{routeData.departure_name}</div>}
                                </div>
                                <div style={{ flex: 1, height: 1, background: "rgba(56,189,248,0.3)", position: "relative" }}>
                                    <svg style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }} width="12" height="12" viewBox="0 0 24 24" fill="#38bdf8">
                                        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                                    </svg>
                                </div>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: 15, fontWeight: 700, color: "#38bdf8" }}>{routeData.destination || "?"}</div>
                                    {routeData.destination_name && <div style={{ fontSize: 9, color: "rgba(232,237,242,0.4)", marginTop: 1, maxWidth: 90, textAlign: "center" }}>{routeData.destination_name}</div>}
                                </div>
                            </div>
                        </div>
                    )}
                    {(typeInfo || typeCode) && (
                        <div style={{ marginBottom: typeDesc ? 6 : 12 }}>
                            <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Aircraft</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{typeInfo?.name || typeCode}</div>
                        </div>
                    )}
                    {typeDesc && (
                        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.55, marginBottom: 12 }}>
                            {typeDesc}
                        </div>
                    )}
                    {ac.r && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Registration</div>
                            <div style={{ fontSize: 13 }}>{ac.r}</div>
                        </div>
                    )}
                    {isEmergency && (
                        <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 6, marginBottom: 12 }}>
                            <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700 }}>⚠ SQUAWK {squawk} — {squawkLabels[squawk]}</div>
                        </div>
                    )}
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Live Data</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {[
                                ["Altitude",  altNum != null ? `${altNum.toLocaleString()} ft` : "—"],
                                ["Speed",     ac.gs != null ? `${Math.round(ac.gs)} kts` : "—"],
                                ["Heading",   ac.track != null ? `${Math.round(ac.track)}°` : "—"],
                                ["Vert Rate", ac.baro_rate != null ? `${ac.baro_rate > 0 ? "+" : ""}${ac.baro_rate} fpm` : "—"],
                            ].map(([k, v]) => (
                                <div key={k} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 5, padding: "6px 8px" }}>
                                    <div style={{ fontSize: 9, color: "rgba(232,237,242,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{k}</div>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, color: "rgba(232,237,242,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Flight Track</div>
                        {trackState.icao === ac.icao && trackState.status === "ok" && (
                            <div>
                                <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 6 }}>● {trackState.pointCount} position points</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    {[["#22c55e","<10k ft"],["#38bdf8","10–25k"],["#3b82f6","25–35k"],["#a855f7","35k+"]].map(([c,l]) => (
                                        <div key={l} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "rgba(232,237,242,0.5)" }}>
                                            <div style={{ width: 10, height: 2, background: c, borderRadius: 1 }} />{l}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {trackState.icao === ac.icao && trackState.status === "loading" && <div style={{ fontSize: 11, color: "#38bdf8" }}>Loading track…</div>}
                        {(trackState.icao !== ac.icao || trackState.status === "unavailable") && <div style={{ fontSize: 11, color: "rgba(232,237,242,0.3)" }}>No track data</div>}
                    </div>
                    {(isMil || ac.interesting) && (
                        <div style={{ display: "flex", gap: 6 }}>
                            {isMil && <span style={{ fontSize: 10, background: "rgba(255,68,68,0.15)", color: "#ff4444", padding: "3px 8px", borderRadius: 5, fontWeight: 700 }}>MILITARY</span>}
                            {ac.interesting && <span style={{ fontSize: 10, background: "rgba(255,204,0,0.12)", color: "#ffcc00", padding: "3px 8px", borderRadius: 5, fontWeight: 700 }}>INTERESTING</span>}
                        </div>
                    )}
                </div>
            </div>
        )
        return createPortal(panel, document.body)
    }

    // ── Filter panel (portaled, grows upward from bottom-left button) ─────────
    const renderFilterPanel = () => {
        if (!filterOpen) return null
        const allOn = Object.values(acFilter).every(Boolean)
        const cats  = [
            { key: "military",   label: "Military",        color: "#ff5533" },
            { key: "commercial", label: "Commercial",      color: "#00c8ff" },
            { key: "helicopter", label: "Helicopters",     color: "#00ff78" },
            { key: "general",    label: "General Aviation",color: "#c8c8ff" },
        ]
        const panel = (
            <>
                {/* Click-outside overlay (mobile dismiss) */}
                <div
                    onClick={() => setFilterOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 2490 }}
                />
                <div style={{
                    position: "fixed", left: 16, bottom: 136,
                    zIndex: 2500,
                    background: "rgba(0,0,0,0.4)", backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
                    padding: "12px 14px", minWidth: 185,
                    fontFamily: "Inter,-apple-system,sans-serif", color: "#e8edf2",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.55)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(232,237,242,0.7)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Aircraft Filter</span>
                        <button onClick={() => setFilterOpen(false)} style={{ background: "none", border: "none", color: "rgba(232,237,242,0.35)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                        <input type="checkbox" checked={allOn} onChange={() => {
                            const next = !allOn
                            setAcFilter({ military: next, commercial: next, helicopter: next, general: next })
                        }} style={{ accentColor: "#38bdf8", width: 13, height: 13 }} />
                        <span style={{ color: "#e8edf2", fontWeight: 600 }}>All</span>
                    </label>
                    {cats.map(({ key, label, color }) => (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", marginBottom: 7 }}>
                            <input type="checkbox" checked={acFilter[key]} onChange={e => {
                                e.stopPropagation()
                                setAcFilter(prev => ({ ...prev, [key]: !prev[key] }))
                            }} style={{ accentColor: color, width: 13, height: 13 }} />
                            <span style={{ color }}>{label}</span>
                        </label>
                    ))}
                </div>
            </>
        )
        return createPortal(panel, document.body)
    }

    // ── Render ────────────────────────────────────────────────────────────────
    // Director Mode: show even when !visible if directorAC has aircraft
    if ((!visible && !directorAC?.size) || map.getZoom() < 4) return null

    const currentZoom    = map.getZoom()
    const vpBounds       = map.getBounds().pad(0.2)
    const visibleAircraft = aircraft.filter(ac =>
        ac.lat != null && ac.lon != null && vpBounds.contains([ac.lat, ac.lon])
    )
    // In follow mode, hide all other aircraft; otherwise apply category filter
    // In Director Mode, only show aircraft whose icao24 is in directorAC
    const categoryFiltered = followAc
        ? visibleAircraft.filter(a => a.icao === followAc.icao)
        : visibleAircraft.filter(ac => acFilter[_acClassify(ac)])
    const displayAircraft = directorAC?.size
        ? categoryFiltered.filter(ac => directorAC.has((ac.icao || "").toLowerCase()))
        : categoryFiltered
    // LOD: reduce rendered count at low zoom levels
    const lodAircraft = currentZoom <= 4
        ? displayAircraft.filter(ac => _acClassify(ac) === 'military')
        : currentZoom <= 6
            ? displayAircraft.filter(ac => { const cls = _acClassify(ac); return cls === 'military' || (cls === 'commercial' && (ac.flight || "").trim()) })
            : displayAircraft
    // Cap at 500, military-priority sort
    const finalAircraft = lodAircraft.length > 500
        ? [...lodAircraft.filter(ac => _acClassify(ac) === 'military'), ...lodAircraft.filter(ac => _acClassify(ac) !== 'military')].slice(0, 500)
        : lodAircraft

    return (
        <Fragment>
            {/* Altitude-colored track segments */}
            {trackState.status === "ok" && trackState.segments.map((seg, i) => (
                <Polyline key={i} positions={seg.coords}
                    pathOptions={{ color: seg.color, weight: 2, opacity: 0.85, dashArray: "4 3" }}
                />
            ))}
            {/* Aircraft markers */}
            {finalAircraft.map(ac => (
                <Marker
                    key={ac.icao || `${ac.lat}-${ac.lon}`}
                    position={[ac.lat, ac.lon]}
                    icon={makeAircraftIcon(ac, showLabels)}
                    eventHandlers={{ click: () => handleAcClick(ac) }}
                    zIndexOffset={selectedAc?.icao === ac.icao ? 5000 : 0}
                >
                    {selectedAc?.icao === ac.icao && renderTooltip(ac)}
                </Marker>
            ))}
            {/* Portals */}
            {renderFollowBar()}
            {renderDetailPanel()}
            {renderFilterPanel()}
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

// ── Hardcoded CSG/ARG deployment data — used directly so production never needs
//    a populated backend file.  Update here to change what appears on the map.
// Country color palette for carrier icons
const _CARRIER_COUNTRY_COLORS = {
    US:          "#3b82f6",
    China:       "#ef4444",
    UK:          "#a855f7",
    France:      "#f97316",
    India:       "#22c55e",
    Russia:      "#64748b",
    Italy:       "#06b6d4",
    Japan:       "#ec4899",
    SouthKorea:  "#eab308",
    Turkey:      "#f43f5e",
    Spain:       "#d97706",
    Egypt:       "#84cc16",
    Brazil:      "#8b5cf6",
    Thailand:    "#14b8a6",
    Australia:   "#0ea5e9",
}

// Combat-radius distances in metres by country (for range ring 1)
const _CARRIER_COMBAT_RADIUS_M = {
    US:     1019000,  // ~550 nm — F/A-18E/F
    France: 1112000,  // ~600 nm — Rafale-M
    China:   926000,  // ~500 nm — J-15
    UK:      926000,  // ~500 nm — F-35B
    India:   741000,  // ~400 nm — MiG-29K
    default: 926000,
}

// Global carrier / LHD roster — March 2026, from USNI / Wikipedia / open source
const _CSG_HARDCODED_DATA = [
    // ── UNITED STATES ─────────────────────────────────────────────────────────
    {
        name:      "Carrier Strike Group 12",
        flagship:  "USS Gerald R. Ford (CVN-78)",
        hull:      "CVN-78",
        lat: 35.5,  lon: 24.0,
        country:   "US", flag: "🇺🇸",
        status:    "DEPLOYED",
        theater:   "Eastern Mediterranean (Souda Bay repairs)",
        operation: "Operation Epic Fury",
        air_wing:  "CVW-8 — ~75 aircraft",
        heading:   120,
        wikipedia: "https://en.wikipedia.org/wiki/USS_Gerald_R._Ford",
        wiki_title: "USS Gerald R. Ford",
        escorts: [
            { name: "USS Winston S. Churchill", hull: "DDG-81",  type: "Destroyer" },
            { name: "USS Bainbridge",           hull: "DDG-96",  type: "Destroyer" },
            { name: "USS Mahan",                hull: "DDG-72",  type: "Destroyer" },
        ],
    },
    {
        name:      "Carrier Strike Group 3",
        flagship:  "USS Abraham Lincoln (CVN-72)",
        hull:      "CVN-72",
        lat: 23.5,  lon: 65.0,
        country:   "US", flag: "🇺🇸",
        status:    "DEPLOYED",
        theater:   "North Arabian Sea",
        operation: "Operation Epic Fury",
        air_wing:  "CVW-9 — ~75 aircraft",
        heading:   270,
        wikipedia: "https://en.wikipedia.org/wiki/USS_Abraham_Lincoln_(CVN-72)",
        wiki_title: "USS Abraham Lincoln (CVN-72)",
        escorts: [
            { name: "USS Frank E. Petersen Jr.", hull: "DDG-121", type: "Destroyer" },
            { name: "USS Spruance",              hull: "DDG-111", type: "Destroyer" },
            { name: "USS Michael Murphy",        hull: "DDG-112", type: "Destroyer" },
            { name: "USS Preble",                hull: "DDG-88",  type: "Destroyer" },
            { name: "USS Delbert D. Black",      hull: "DDG-119", type: "Destroyer" },
        ],
    },
    {
        name:      "USS George Washington (CVN-73)",
        flagship:  "USS George Washington (CVN-73)",
        hull:      "CVN-73",
        lat: 35.28, lon: 139.67,
        country:   "US", flag: "🇺🇸",
        status:    "IN PORT",
        theater:   "Yokosuka, Japan (FDNF)",
        air_wing:  "CVW-5",
        heading:   0,
        wikipedia: "https://en.wikipedia.org/wiki/USS_George_Washington_(CVN-73)",
        wiki_title: "USS George Washington (CVN-73)",
        escorts: [],
    },
    {
        name:      "Iwo Jima Amphibious Ready Group",
        flagship:  "USS Iwo Jima (LHD-7)",
        hull:      "LHD-7",
        lat: 18.0,  lon: -66.5,
        country:   "US", flag: "🇺🇸",
        status:    "DEPLOYED",
        theater:   "Caribbean Sea",
        operation: "Operation Southern Spear",
        air_wing:  "22nd MEU — MV-22B, AH-1Z, UH-1Y",
        heading:   200,
        wikipedia: "https://en.wikipedia.org/wiki/USS_Iwo_Jima_(LHD-7)",
        wiki_title: "USS Iwo Jima (LHD-7)",
        escorts: [
            { name: "USS Fort Lauderdale", hull: "LPD-28",  type: "Amphibious Transport Dock" },
            { name: "USS San Antonio",     hull: "LPD-17",  type: "Amphibious Transport Dock" },
            { name: "USS Lake Erie",       hull: "CG-70",   type: "Cruiser" },
            { name: "USS Stockdale",       hull: "DDG-106", type: "Destroyer" },
        ],
    },
    {
        name:      "Tripoli Amphibious Ready Group",
        flagship:  "USS Tripoli (LHA-7)",
        hull:      "LHA-7",
        lat: -7.3,  lon: 72.4,
        country:   "US", flag: "🇺🇸",
        status:    "DEPLOYED",
        theater:   "Indian Ocean (Diego Garcia)",
        air_wing:  "31st MEU aviation",
        heading:   315,
        wikipedia: "https://en.wikipedia.org/wiki/USS_Tripoli_(LHA-7)",
        wiki_title: "USS Tripoli (LHA-7)",
        escorts: [
            { name: "USS New Orleans", hull: "LPD-18", type: "Amphibious Transport Dock" },
        ],
    },
    {
        name:      "Boxer Amphibious Ready Group",
        flagship:  "USS Boxer (LHD-4)",
        hull:      "LHD-4",
        lat: 25.0,  lon: -130.0,
        country:   "US", flag: "🇺🇸",
        status:    "DEPLOYED",
        theater:   "Eastern Pacific",
        air_wing:  "11th MEU aviation",
        heading:   225,
        wikipedia: "https://en.wikipedia.org/wiki/USS_Boxer_(LHD-4)",
        wiki_title: "USS Boxer (LHD-4)",
        escorts: [
            { name: "USS Comstock", hull: "LSD-45", type: "Dock Landing Ship" },
            { name: "USS Portland", hull: "LPD-27", type: "Amphibious Transport Dock" },
        ],
    },
    // US carriers in port / refit
    { name: "USS Nimitz (CVN-68)",               flagship: "USS Nimitz (CVN-68)",               hull: "CVN-68", lat: 47.56,  lon: -122.65, country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "Bremerton, WA",   heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Nimitz",                        wiki_title: "USS Nimitz",                        air_wing: null, escorts: [] },
    { name: "USS Theodore Roosevelt (CVN-71)",   flagship: "USS Theodore Roosevelt (CVN-71)",   hull: "CVN-71", lat: 32.68,  lon: -117.15, country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "San Diego, CA",   heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Theodore_Roosevelt_(CVN-71)", wiki_title: "USS Theodore Roosevelt (CVN-71)", air_wing: null, escorts: [] },
    { name: "USS Carl Vinson (CVN-70)",          flagship: "USS Carl Vinson (CVN-70)",          hull: "CVN-70", lat: 32.71,  lon: -117.18, country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "San Diego, CA",   heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Carl_Vinson",                  wiki_title: "USS Carl Vinson",                  air_wing: null, escorts: [] },
    { name: "USS John C. Stennis (CVN-74)",      flagship: "USS John C. Stennis (CVN-74)",      hull: "CVN-74", lat: 36.95,  lon: -76.33,  country: "US", flag: "🇺🇸", status: "REFIT",          theater: "Norfolk, VA (RCOH)", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_John_C._Stennis",             wiki_title: "USS John C. Stennis",             air_wing: null, escorts: [] },
    { name: "USS Harry S. Truman (CVN-75)",      flagship: "USS Harry S. Truman (CVN-75)",      hull: "CVN-75", lat: 36.96,  lon: -76.32,  country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "Norfolk, VA",     heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Harry_S._Truman",             wiki_title: "USS Harry S. Truman",             air_wing: null, escorts: [] },
    { name: "USS Ronald Reagan (CVN-76)",        flagship: "USS Ronald Reagan (CVN-76)",        hull: "CVN-76", lat: 47.57,  lon: -122.67, country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "Bremerton, WA",   heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Ronald_Reagan",               wiki_title: "USS Ronald Reagan",               air_wing: null, escorts: [] },
    { name: "USS Dwight D. Eisenhower (CVN-69)", flagship: "USS Dwight D. Eisenhower (CVN-69)", hull: "CVN-69", lat: 36.97,  lon: -76.31,  country: "US", flag: "🇺🇸", status: "IN PORT",        theater: "Norfolk, VA",     heading: 0, wikipedia: "https://en.wikipedia.org/wiki/USS_Dwight_D._Eisenhower",        wiki_title: "USS Dwight D. Eisenhower",       air_wing: null, escorts: [] },
    // ── CHINA ─────────────────────────────────────────────────────────────────
    { name: "Liaoning (CV-16)",  flagship: "Liaoning (CV-16)",  hull: "CV-16", lat: 38.95, lon: 121.6,  country: "China", flag: "🇨🇳", status: "IN PORT",          theater: "Dalian, China",           heading: 0,   wikipedia: "https://en.wikipedia.org/wiki/Chinese_aircraft_carrier_Liaoning", wiki_title: "Chinese aircraft carrier Liaoning", air_wing: "~24 J-15 + helicopters", escorts: [] },
    { name: "Shandong (CV-17)",  flagship: "Shandong (CV-17)",  hull: "CV-17", lat: 18.22, lon: 109.53, country: "China", flag: "🇨🇳", status: "IN PORT",          theater: "Yulin Naval Base, Hainan", heading: 180, wikipedia: "https://en.wikipedia.org/wiki/Chinese_aircraft_carrier_Shandong", wiki_title: "Chinese aircraft carrier Shandong", air_wing: "~36 J-15 + helicopters", escorts: [] },
    { name: "Fujian (CV-18)",    flagship: "Fujian (CV-18)",    hull: "CV-18", lat: 31.35, lon: 121.65, country: "China", flag: "🇨🇳", status: "REFIT",            theater: "Shanghai — maintenance",   heading: 90,  wikipedia: "https://en.wikipedia.org/wiki/Chinese_aircraft_carrier_Fujian",  wiki_title: "Chinese aircraft carrier Fujian",  air_wing: "J-15T, J-35 (working up)", escorts: [] },
    // ── UNITED KINGDOM ────────────────────────────────────────────────────────
    { name: "HMS Queen Elizabeth (R08)",  flagship: "HMS Queen Elizabeth (R08)",  hull: "R08", lat: 56.03, lon: -3.44, country: "UK", flag: "🇬🇧", status: "REFIT",          theater: "Rosyth, Scotland",              heading: 0, wikipedia: "https://en.wikipedia.org/wiki/HMS_Queen_Elizabeth_(R08)", wiki_title: "HMS Queen Elizabeth (R08)", air_wing: "None embarked", escorts: [] },
    { name: "HMS Prince of Wales (R09)",  flagship: "HMS Prince of Wales (R09)",  hull: "R09", lat: 50.8,  lon: -1.1,  country: "UK", flag: "🇬🇧", status: "HIGH READINESS", theater: "Portsmouth (5 days notice)",   heading: 45, wikipedia: "https://en.wikipedia.org/wiki/HMS_Prince_of_Wales_(R09)", wiki_title: "HMS Prince of Wales (R09)", air_wing: "F-35B (617 Sqn), Merlin",  escorts: [] },
    // ── FRANCE ────────────────────────────────────────────────────────────────
    {
        name:      "French Carrier Strike Group",
        flagship:  "FS Charles de Gaulle (R91)",
        hull:      "R91",
        lat: 34.5,  lon: 26.0,
        country:   "France", flag: "🇫🇷",
        status:    "DEPLOYED",
        theater:   "Eastern Mediterranean",
        air_wing:  "~30 Rafale-M, 2× E-2C Hawkeye, helicopters",
        heading:   90,
        wikipedia: "https://en.wikipedia.org/wiki/French_aircraft_carrier_Charles_de_Gaulle",
        wiki_title: "French aircraft carrier Charles de Gaulle",
        escorts: [
            { name: "FNS Chevalier Paul",    hull: "D621",    type: "Frigate" },
            { name: "Cristóbal Colón",       hull: "F105",    type: "Spanish Frigate" },
            { name: "HNLMS Evertsen",        hull: "F805",    type: "Dutch Frigate" },
        ],
    },
    // ── INDIA ─────────────────────────────────────────────────────────────────
    { name: "INS Vikramaditya (R33)", flagship: "INS Vikramaditya (R33)", hull: "R33", lat: 14.82,  lon: 74.13, country: "India", flag: "🇮🇳", status: "IN PORT",   theater: "INS Kadamba, Karwar",  heading: 0,   wikipedia: "https://en.wikipedia.org/wiki/INS_Vikramaditya", wiki_title: "INS Vikramaditya", air_wing: "MiG-29K/KUB, Ka-31",         escorts: [] },
    { name: "INS Vikrant (R11)",      flagship: "INS Vikrant (R11)",      hull: "R11", lat: 9.95,   lon: 76.27, country: "India", flag: "🇮🇳", status: "OPERATIONAL", theater: "Kochi, Kerala",        heading: 180, wikipedia: "https://en.wikipedia.org/wiki/INS_Vikrant_(2013)", wiki_title: "INS Vikrant (2013)", air_wing: "MiG-29K, Kamov helicopters", escorts: [] },
    // ── RUSSIA ────────────────────────────────────────────────────────────────
    { name: "Admiral Kuznetsov", flagship: "Admiral Kuznetsov", hull: "063", lat: 69.08, lon: 33.12, country: "Russia", flag: "🇷🇺", status: "REFIT", theater: "Murmansk (refit since 2017)", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/Russian_aircraft_carrier_Admiral_Kuznetsov", wiki_title: "Russian aircraft carrier Admiral Kuznetsov", air_wing: "Su-33, MiG-29K (not embarked)", escorts: [] },
    // ── ITALY ─────────────────────────────────────────────────────────────────
    { name: "ITS Cavour (C550)",   flagship: "ITS Cavour (C550)",   hull: "C550",  lat: 40.44, lon: 17.23, country: "Italy", flag: "🇮🇹", status: "OPERATIONAL", theater: "Taranto", heading: 90, wikipedia: "https://en.wikipedia.org/wiki/Italian_aircraft_carrier_Cavour",         wiki_title: "Italian aircraft carrier Cavour",       air_wing: "F-35B, AV-8B+, helicopters",    escorts: [] },
    { name: "ITS Trieste (L9890)", flagship: "ITS Trieste (L9890)", hull: "L9890", lat: 40.42, lon: 17.25, country: "Italy", flag: "🇮🇹", status: "OPERATIONAL", theater: "Taranto", heading: 90, wikipedia: "https://en.wikipedia.org/wiki/Italian_ship_Trieste_(L_9890)",           wiki_title: "Italian ship Trieste (L 9890)",         air_wing: "F-35B capable, helicopters",    escorts: [] },
    // ── JAPAN ─────────────────────────────────────────────────────────────────
    { name: "JS Izumo (DDH-183)", flagship: "JS Izumo (DDH-183)", hull: "DDH-183", lat: 35.28,  lon: 139.67, country: "Japan", flag: "🇯🇵", status: "OPERATIONAL", theater: "Yokosuka",           heading: 0, wikipedia: "https://en.wikipedia.org/wiki/JS_Izumo",           wiki_title: "JS Izumo",          air_wing: "F-35B (modification ongoing)", escorts: [] },
    { name: "JS Kaga (DDH-184)",  flagship: "JS Kaga (DDH-184)",  hull: "DDH-184", lat: 34.23,  lon: 132.57, country: "Japan", flag: "🇯🇵", status: "REFIT",       theater: "Kure (F-35B mod)", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/JS_Kaga_(DDH-184)", wiki_title: "JS Kaga (DDH-184)", air_wing: "F-35B (undergoing modification)", escorts: [] },
    // ── SOUTH KOREA ───────────────────────────────────────────────────────────
    { name: "ROKS Marado (LPH-6112)", flagship: "ROKS Marado (LPH-6112)", hull: "LPH-6112", lat: 35.1, lon: 129.08, country: "SouthKorea", flag: "🇰🇷", status: "OPERATIONAL", theater: "Busan",               heading: 45, wikipedia: "https://en.wikipedia.org/wiki/ROKS_Marado_(LPH-6112)", wiki_title: "ROKS Marado (LPH-6112)", air_wing: "AW159, UH-60, helicopters", escorts: [] },
    // ── TURKEY ────────────────────────────────────────────────────────────────
    { name: "TCG Anadolu (L400)", flagship: "TCG Anadolu (L400)", hull: "L400", lat: 40.68, lon: 29.42, country: "Turkey", flag: "🇹🇷", status: "OPERATIONAL", theater: "Gölcük Naval Base", heading: 180, wikipedia: "https://en.wikipedia.org/wiki/TCG_Anadolu", wiki_title: "TCG Anadolu", air_wing: "TB-3 drones, helicopters", escorts: [] },
    // ── SPAIN ─────────────────────────────────────────────────────────────────
    { name: "Juan Carlos I (L61)", flagship: "Juan Carlos I (L61)", hull: "L61", lat: 36.54, lon: -6.29, country: "Spain", flag: "🇪🇸", status: "OPERATIONAL", theater: "Rota, Spain", heading: 270, wikipedia: "https://en.wikipedia.org/wiki/Spanish_ship_Juan_Carlos_I", wiki_title: "Spanish ship Juan Carlos I", air_wing: "AV-8B Harrier II+, helicopters", escorts: [] },
    // ── EGYPT ─────────────────────────────────────────────────────────────────
    { name: "ENS Gamal Abdel Nasser (L1010)", flagship: "ENS Gamal Abdel Nasser (L1010)", hull: "L1010", lat: 31.15, lon: 29.85, country: "Egypt", flag: "🇪🇬", status: "OPERATIONAL", theater: "Alexandria", heading: 90, wikipedia: "https://en.wikipedia.org/wiki/Egyptian_ship_Gamal_Abdel_Nasser", wiki_title: "Egyptian ship Gamal Abdel Nasser", air_wing: "Ka-52K, NH-90, helicopters",          escorts: [] },
    { name: "ENS Anwar El Sadat (L1020)",     flagship: "ENS Anwar El Sadat (L1020)",     hull: "L1020", lat: 31.13, lon: 29.87, country: "Egypt", flag: "🇪🇬", status: "OPERATIONAL", theater: "Alexandria", heading: 90, wikipedia: "https://en.wikipedia.org/wiki/Egyptian_ship_Anwar_El_Sadat",     wiki_title: "Egyptian ship Anwar El Sadat",     air_wing: "Helicopters",                         escorts: [] },
    // ── BRAZIL ────────────────────────────────────────────────────────────────
    { name: "PHM Atlântico (A140)", flagship: "PHM Atlântico (A140)", hull: "A140", lat: -22.9, lon: -43.15, country: "Brazil", flag: "🇧🇷", status: "OPERATIONAL", theater: "Rio de Janeiro", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/PHM_Atl%C3%A2ntico", wiki_title: "PHM Atlântico", air_wing: "Helicopters, AH-11A Super Lynx", escorts: [] },
    // ── THAILAND ──────────────────────────────────────────────────────────────
    { name: "HTMS Chakri Naruebet", flagship: "HTMS Chakri Naruebet", hull: "CVH-911", lat: 12.68, lon: 100.9, country: "Thailand", flag: "🇹🇭", status: "IN PORT", theater: "Sattahip Naval Base", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/HTMS_Chakri_Naruebet", wiki_title: "HTMS Chakri Naruebet", air_wing: "Helicopters only (rarely sails)", escorts: [] },
    // ── AUSTRALIA ─────────────────────────────────────────────────────────────
    { name: "HMAS Canberra (L02)",  flagship: "HMAS Canberra (L02)",  hull: "L02", lat: -33.86, lon: 151.21, country: "Australia", flag: "🇦🇺", status: "OPERATIONAL", theater: "Sydney", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/HMAS_Canberra_(L02)", wiki_title: "HMAS Canberra (L02)", air_wing: "MRH-90, CH-47F, helicopters", escorts: [] },
    { name: "HMAS Adelaide (L01)",  flagship: "HMAS Adelaide (L01)",  hull: "L01", lat: -33.88, lon: 151.19, country: "Australia", flag: "🇦🇺", status: "OPERATIONAL", theater: "Sydney", heading: 0, wikipedia: "https://en.wikipedia.org/wiki/HMAS_Adelaide_(L01)", wiki_title: "HMAS Adelaide (L01)", air_wing: "MRH-90, CH-47F, helicopters", escorts: [] },
]

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

// ── Military top-down AIS-style icons — color-coded by country ───────────────
function makeCarrierAisIcon(heading = 0, color = "#3b82f6", opacity = 1) {
    const hdg = isFinite(Number(heading)) ? Number(heading) : 0
    const [r, g, b] = _hexToRgb(color)
    const glowA = opacity >= 0.9 ? 0.7 : opacity >= 0.5 ? 0.35 : 0
    const glowFilter = glowA > 0 ? `drop-shadow(0 0 8px rgba(${r},${g},${b},${glowA}))` : "none"
    const svg =
        `<svg width="22" height="48" viewBox="0 0 22 48" xmlns="http://www.w3.org/2000/svg" ` +
        `style="transform:rotate(${hdg}deg);transform-origin:50% 50%;display:block;overflow:visible;opacity:${opacity};` +
        `filter:${glowFilter};">` +
        `<path d="M11,1 L16,5 L17,12 L17,38 L14,47 L8,47 L5,38 L5,12 L6,5 Z" fill="${color}" stroke="rgba(255,255,255,0.3)" stroke-width="0.6" opacity="0.93"/>` +
        `<path d="M5,10 L1,14 L1,36 L5,38" fill="${color}" stroke="rgba(255,255,255,0.2)" stroke-width="0.4" opacity="0.85"/>` +
        `<rect x="15" y="17" width="4" height="11" rx="0.5" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.2)" stroke-width="0.4"/>` +
        `</svg>`
    return L.divIcon({ html: svg, className: "", iconSize: [22, 48], iconAnchor: [11, 24] })
}

function makeEscortAisIcon(heading = 0, color = "#3b82f6") {
    const hdg = isFinite(Number(heading)) ? Number(heading) : 0
    const [r, g, b] = _hexToRgb(color)
    const svg =
        `<svg width="14" height="30" viewBox="0 0 14 30" xmlns="http://www.w3.org/2000/svg" ` +
        `style="transform:rotate(${hdg}deg);transform-origin:50% 50%;display:block;overflow:visible;` +
        `filter:drop-shadow(0 0 6px rgba(${r},${g},${b},0.6));">` +
        `<path d="M7,1 L11,5 L12,11 L12,24 L10,29 L4,29 L2,24 L2,11 L3,5 Z" fill="${color}" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" opacity="0.92"/>` +
        `<rect x="4" y="12" width="6" height="7" rx="0.5" fill="rgba(255,255,255,0.28)"/>` +
        `</svg>`
    return L.divIcon({ html: svg, className: "", iconSize: [14, 30], iconAnchor: [7, 15] })
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

// ── PortPanel ─────────────────────────────────────────────────────────────────
const PortPanel = memo(function PortPanel({ item, onClose, isMobile }) {
    if (!item) return null
    const wikiUrl = item.wikipedia || `https://en.wikipedia.org/wiki/${encodeURIComponent((item.name || "Port").replace(/ /g, "_"))}`
    const rows = [
        ["Country",     item.country],
        ["Harbor Size", item.harbor_size],
        ["Max Vessel",  item.max_vessel_size],
        ["Operator",    item.operator],
        ["Coords",      item.lat != null ? `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}` : null],
    ].filter(([, v]) => v)

    const panelStyle = isMobile ? {
        position: "fixed", left: 0, right: 0, bottom: 0,
        maxHeight: "65vh", borderRadius: "18px 18px 0 0", zIndex: 1150,
        background: "rgba(10,14,22,0.98)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(56,189,248,0.2)", overflowY: "auto",
        fontFamily: "system-ui,-apple-system,sans-serif",
    } : {
        position: "fixed", top: 48, right: 0, bottom: 0, width: 380, zIndex: 1150,
        background: "rgba(15,23,42,0.95)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderLeft: "1px solid rgba(56,189,248,0.2)", display: "flex", flexDirection: "column",
        fontFamily: "system-ui,-apple-system,sans-serif",
    }

    return (
        <div style={panelStyle}>
            <div style={{ padding: 16, borderBottom: "1px solid rgba(56,189,248,0.15)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
                <div>
                    <div style={{ color: "#38bdf8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Port</div>
                    <h2 style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 500, margin: 0 }}>{item.name || "Unnamed Port"}</h2>
                    {item.country && <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>{item.country}</div>}
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 22, lineHeight: 1, paddingTop: 2 }}>×</button>
            </div>
            {/* Port image placeholder */}
            <div style={{ height: 140, background: "linear-gradient(135deg,rgba(8,15,30,1) 0%,rgba(12,30,52,1) 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderBottom: "1px solid rgba(56,189,248,0.1)", position: "relative", overflow: "hidden" }}>
                <div style={{ opacity: 0.12, position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(56,189,248,0.4) 18px,rgba(56,189,248,0.4) 19px),repeating-linear-gradient(90deg,transparent,transparent 18px,rgba(56,189,248,0.4) 18px,rgba(56,189,248,0.4) 19px)" }} />
                <svg width="90" height="56" viewBox="0 0 90 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 36 L13 20 L75 20 L83 32 L84 40 L5 40 Z" fill="#38bdf8" opacity="0.65"/>
                    <rect x="50" y="8" width="22" height="12" rx="1" fill="#38bdf8" opacity="0.65"/>
                    <rect x="66" y="3" width="5" height="5" rx="1" fill="#38bdf8" opacity="0.65"/>
                    <line x1="22" y1="20" x2="22" y2="6" stroke="#38bdf8" strokeWidth="2" opacity="0.45"/>
                    <line x1="22" y1="6" x2="40" y2="16" stroke="#38bdf8" strokeWidth="1" opacity="0.4"/>
                    <line x1="0" y1="44" x2="90" y2="44" stroke="#38bdf8" strokeWidth="1" opacity="0.25" strokeDasharray="5 4"/>
                </svg>
                <div style={{ position: "absolute", bottom: 8, right: 14, color: "rgba(56,189,248,0.4)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Port Facility</div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
                {rows.map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 10, fontSize: 12, marginBottom: 8, alignItems: "flex-start" }}>
                        <span style={{ color: "#64748b", flexShrink: 0, width: 100, fontSize: 11 }}>{label}</span>
                        <span style={{ color: "#e2e8f0" }}>{String(val)}</span>
                    </div>
                ))}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(56,189,248,0.1)" }}>
                    <a href={wikiUrl} target="_blank" rel="noreferrer" style={{ color: "#38bdf8", fontSize: 12, textDecoration: "none" }}>
                        Wikipedia ↗
                    </a>
                </div>
            </div>
        </div>
    )
})

// ── VesselPopupContent ────────────────────────────────────────────────────────
function VesselPopupContent({ vessel, onClose }) {
    const shipType  = _vesselShipType(vessel)
    const typeColor = _AIS_TYPE_COLOR[shipType] || _AIS_TYPE_COLOR.other
    const hullPath  = _vesselHullPath(shipType)
    const [vesselPhoto, setVesselPhoto] = useState(null)   // null = loading, false = unavailable
    const photoFetched = useRef(false)

    useEffect(() => {
        if (!vessel.mmsi || photoFetched.current) return
        photoFetched.current = true
        fetch(`${API_BASE}/api/vessel/photo/${vessel.mmsi}`)
            .then(r => r.json())
            .then(d => setVesselPhoto(d.available ? d : false))
            .catch(() => setVesselPhoto(false))
    }, [vessel.mmsi])

    const fields = [
        ["Type",        vessel.ship_type],
        ["Speed",       vessel.speed != null ? `${vessel.speed} kn` : null],
        ["Heading",     vessel.heading != null ? `${Math.round(vessel.heading)}°` : null],
        ["Destination", vessel.destination],
        ["MMSI",        vessel.mmsi],
    ].filter(([, v]) => v)
    return (
        <div style={{ width: 280, fontFamily: "system-ui,-apple-system,sans-serif", color: "#e2e8f0" }}>
            <div style={{ height: 80, background: `linear-gradient(135deg,rgba(10,14,24,1) 0%,rgba(18,28,48,1) 100%)`, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", position: "relative", borderBottom: `1px solid ${typeColor}40` }}>
                <div style={{ width: 46, height: 46, borderRadius: "50%", border: `1.5px solid ${typeColor}70`, background: `${typeColor}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="14" height="22" viewBox="0 0 16 28" fill={typeColor} opacity="0.9"><path d={hullPath}/></svg>
                </div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: typeColor, marginBottom: 3 }}>AIS Vessel</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {vessel.name || `MMSI ${vessel.mmsi}`}
                    </div>
                </div>
                <button onClick={onClose} style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            {vesselPhoto && vesselPhoto.thumbnail_url && (
                <a href={vesselPhoto.full_url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                    <img
                        src={vesselPhoto.thumbnail_url}
                        alt={vessel.name || `MMSI ${vessel.mmsi}`}
                        style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
                        onError={e => { e.currentTarget.style.display = "none" }}
                    />
                </a>
            )}
            <div style={{ padding: "10px 14px" }}>
                {fields.map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 5 }}>
                        <span style={{ color: "rgba(232,237,242,0.4)", flexShrink: 0, width: 80 }}>{label}</span>
                        <span style={{ color: "#e2e8f0", textTransform: "capitalize", wordBreak: "break-all" }}>{String(val)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── VesselMarkerItem — vessel marker with floating popup that follows the vessel ──
const VesselMarkerItem = memo(function VesselMarkerItem({ v, isSelected, onSelect, onClose, zoom }) {
    const markerRef = useRef(null)
    useEffect(() => {
        if (isSelected && markerRef.current) {
            requestAnimationFrame(() => { markerRef.current?.openPopup?.() })
        }
    }, [isSelected])
    return (
        <Marker
            ref={markerRef}
            position={[v.lat, v.lon]}
            icon={makeAisVesselIconForZoom(v, zoom || 5)}
            eventHandlers={{ click: () => onSelect(v) }}
        >
            <Tooltip direction="top" offset={[0, -10]}>
                <span style={{ fontSize: 10 }}>
                    {v.name || `MMSI ${v.mmsi}`}
                    {v.ship_type ? ` · ${v.ship_type}` : ""}
                    {v.speed != null ? ` · ${v.speed}kn` : ""}
                    {v.destination ? ` → ${v.destination}` : ""}
                </span>
            </Tooltip>
            {isSelected && (
                <Popup
                    className="vessel-popup"
                    offset={[0, -12]}
                    closeButton={false}
                    autoClose={false}
                    closeOnClick={false}
                    autoPan={false}
                    onClose={onClose}
                >
                    <VesselPopupContent vessel={v} onClose={onClose} />
                </Popup>
            )}
        </Marker>
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

// ── CSGPanel — slide-in carrier detail panel, color-coded by country ─────────
const _STATUS_META = {
    "DEPLOYED":       { color: "#22c55e", bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.35)" },
    "IN PORT":        { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.35)" },
    "REFIT":          { color: "#64748b", bg: "rgba(100,116,139,0.1)", border: "rgba(100,116,139,0.35)" },
    "HIGH READINESS": { color: "#06b6d4", bg: "rgba(6,182,212,0.1)",   border: "rgba(6,182,212,0.35)" },
    "OPERATIONAL":    { color: "#22c55e", bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.35)" },
    "SEA TRIALS / MAINTENANCE": { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.35)" },
}

const CSGPanel = memo(function CSGPanel({ csg, onClose, isMobile }) {
    const [wikiImg,     setWikiImg]     = useState(null)
    const [wikiExtract, setWikiExtract] = useState(null)
    const [imgLoaded,   setImgLoaded]   = useState(false)

    useEffect(() => {
        if (!csg) return
        setWikiImg(null); setWikiExtract(null); setImgLoaded(false)
        // Prefer pre-known images, fall back to Wikipedia thumbnail API
        const known = CARRIER_IMAGES[csg.flagship]
        if (known) { setWikiImg(known); return }
        const title = csg.wiki_title || csg.flagship
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                if (d.thumbnail?.source) setWikiImg(d.thumbnail.source)
                if (d.extract)           setWikiExtract(d.extract.split(". ").slice(0, 3).join(". ") + ".")
            })
            .catch(() => {})
    }, [csg?.flagship])  // eslint-disable-line react-hooks/exhaustive-deps

    if (!csg) return null
    const escorts  = Array.isArray(csg.escorts) ? csg.escorts : []
    const color    = _CARRIER_COUNTRY_COLORS[csg.country] || "#3b82f6"
    const statusM  = _STATUS_META[csg.status] || _STATUS_META["IN PORT"]
    const isARG    = csg.name?.toLowerCase().includes("amphibious") || csg.hull?.startsWith("LH") || csg.hull?.startsWith("LP") || csg.hull?.startsWith("L9")
    const typeLabel= isARG ? "Amphibious Ready Group" : "Carrier Strike Group"

    const panelStyle = isMobile ? {
        position: "fixed", left: 0, right: 0, bottom: 0,
        maxHeight: "80vh", borderRadius: "18px 18px 0 0", zIndex: 1150,
        background: "rgba(10,15,26,0.98)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderTop: `1px solid ${color}44`, overflowY: "auto",
        fontFamily: "system-ui,-apple-system,sans-serif",
    } : {
        position: "fixed", top: 48, right: 0, bottom: 0, width: 380, zIndex: 1150,
        background: "rgba(10,15,26,0.97)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderLeft: `1px solid ${color}44`, display: "flex", flexDirection: "column",
        fontFamily: "system-ui,-apple-system,sans-serif",
    }

    return (
        <div style={panelStyle}>
            {/* Header */}
            <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${color}22`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ color, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>
                        {csg.flag} {typeLabel}
                    </div>
                    <h2 style={{ color: "#e2e8f0", fontSize: 17, fontWeight: 600, margin: 0, lineHeight: 1.3, wordBreak: "break-word" }}>{csg.flagship}</h2>
                    {csg.hull && <div style={{ color: "#64748b", fontSize: 11, marginTop: 3 }}>{csg.hull}</div>}
                </div>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 22, lineHeight: 1, paddingTop: 2, flexShrink: 0, marginLeft: 8 }}>×</button>
            </div>

            {/* Image */}
            <div style={{ height: 200, background: `linear-gradient(135deg,rgba(8,14,28,1) 0%,rgba(12,22,44,1) 100%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", overflow: "hidden", borderBottom: `1px solid ${color}22` }}>
                {wikiImg && (
                    <img
                        src={wikiImg} alt={csg.flagship}
                        onLoad={() => setImgLoaded(true)}
                        onError={() => setWikiImg(null)}
                        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: imgLoaded ? 0.82 : 0, transition: "opacity 0.4s" }}
                    />
                )}
                {(!wikiImg || !imgLoaded) && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ opacity: 0.07, position: "absolute", inset: 0, backgroundImage: `repeating-linear-gradient(0deg,transparent,transparent 18px,${color}66 18px,${color}66 19px),repeating-linear-gradient(90deg,transparent,transparent 18px,${color}66 18px,${color}66 19px)` }} />
                        <div dangerouslySetInnerHTML={{ __html: _carrierSvg(color, 80) }} style={{ opacity: 0.5, position: "relative" }} />
                    </div>
                )}
                <div style={{ position: "absolute", bottom: 8, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{csg.flag} {csg.country}</span>
                </div>
            </div>

            {/* Status badge */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${color}18`, flexShrink: 0, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: statusM.bg, border: `1px solid ${statusM.border}`, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: statusM.color }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusM.color, display: "inline-block" }} />
                    {csg.status || "UNKNOWN"}
                </span>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
                {/* Info rows */}
                {[
                    ["Ship / Group",  csg.name !== csg.flagship ? csg.name : null],
                    ["Location",      csg.theater],
                    ["Air Wing",      csg.air_wing],
                    ["Escorts",       escorts.length ? `${escorts.length} surface combatants` : null],
                    ["Operation",     csg.operation],
                ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 10, alignItems: "flex-start" }}>
                        <span style={{ color: "#64748b", flexShrink: 0, width: 82, fontSize: 11, paddingTop: 1 }}>{label}</span>
                        <span style={{ color: "#e2e8f0", lineHeight: 1.4 }}>{val}</span>
                    </div>
                ))}

                {/* Wikipedia extract */}
                {wikiExtract && (
                    <div style={{ fontSize: 11, color: "rgba(226,232,240,0.6)", lineHeight: 1.6, marginTop: 4, padding: "10px 12px", background: `${color}08`, borderRadius: 6, border: `1px solid ${color}18` }}>
                        {wikiExtract}
                    </div>
                )}

                {/* Escort list */}
                {escorts.length > 0 && (
                    <>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b", marginTop: 16, marginBottom: 8, paddingTop: 12, borderTop: `1px solid ${color}18` }}>
                            Escort Ships
                        </div>
                        {escorts.map((e, i) => {
                            const eName = typeof e === "string" ? e : e.name
                            const eHull = typeof e === "string" ? "" : e.hull
                            const eType = typeof e === "string" ? "" : e.type
                            return (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 6, padding: "6px 8px", background: `${color}08`, borderRadius: 4, border: `1px solid ${color}18` }}>
                                    <svg width="8" height="16" viewBox="0 0 14 30" fill={color} opacity="0.7"><path d="M7,1 L11,5 L12,11 L12,24 L10,29 L4,29 L2,24 L2,11 L3,5 Z"/></svg>
                                    <div>
                                        <div style={{ color: "#e2e8f0", fontWeight: 500 }}>{eName}{eHull ? <span style={{ color: "#64748b" }}> ({eHull})</span> : null}</div>
                                        {eType && <div style={{ color: "#64748b", fontSize: 10 }}>{eType}</div>}
                                    </div>
                                </div>
                            )
                        })}
                    </>
                )}

                {/* Wikipedia link */}
                {csg.wikipedia && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${color}18` }}>
                        <a href={csg.wikipedia} target="_blank" rel="noreferrer" style={{ color, fontSize: 12, textDecoration: "none" }}>
                            Read on Wikipedia →
                        </a>
                    </div>
                )}
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", marginTop: 12 }}>⚠ Positions approximate — public OSINT</div>
            </div>
        </div>
    )
})

// ── ChokepointPanel ────────────────────────────────────────────────────────────
const _THREAT_BADGE_BG = { CRITICAL: "rgba(239,68,68,0.15)", HIGH: "rgba(245,158,11,0.15)", MODERATE: "rgba(20,184,166,0.15)", LOW: "rgba(59,130,246,0.15)" }

const ChokepointPanel = memo(function ChokepointPanel({ cp, onClose, isMobile }) {
    const [wikiImg, setWikiImg]     = useState(null)
    const [imgLoaded, setImgLoaded] = useState(false)
    const [wikiText, setWikiText]   = useState(null)

    useEffect(() => {
        if (!cp?.wikipedia) { setWikiImg(null); setWikiText(null); return }
        setWikiImg(null); setImgLoaded(false); setWikiText(null)
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cp.wikipedia)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (d?.thumbnail?.source) setWikiImg(d.thumbnail.source)
                if (d?.extract) setWikiText(d.extract.split(". ").slice(0, 3).join(". ") + ".")
            })
            .catch(() => {})
    }, [cp?.wikipedia])

    if (!cp) return null

    // Support both new rich format (threatLevel) and legacy API format (current_status)
    const isRich      = !!cp.threatLevel
    const color       = isRich ? (_THREAT_COLORS[cp.threatLevel] || "#14b8a6")
        : (cp.current_status === "disrupted" ? "#ef4444" : cp.current_status === "elevated" ? "#f59e0b" : "#14b8a6")
    const badgeBg     = isRich ? (_THREAT_BADGE_BG[cp.threatLevel] || "rgba(20,184,166,0.15)") : "rgba(20,184,166,0.15)"
    const badgeLabel  = isRich ? cp.threatLevel : (cp.current_status === "disrupted" ? "DISRUPTED" : cp.current_status === "elevated" ? "ELEVATED" : "NORMAL")

    const panelStyle = isMobile ? {
        position: "fixed", left: 0, right: 0, bottom: 0,
        maxHeight: "70vh", borderRadius: "18px 18px 0 0",
        zIndex: 1150,
        background: "rgba(10,14,22,0.98)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderTop: `1px solid ${color}33`,
        overflowY: "auto", WebkitOverflowScrolling: "touch",
        fontFamily: "system-ui, -apple-system, sans-serif",
    } : {
        position: "fixed", top: 48, right: 0, bottom: 0, width: 380,
        zIndex: 1150,
        background: "rgba(10,14,22,0.95)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderLeft: `1px solid ${color}33`,
        display: "flex", flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
    }

    return (
        <div style={panelStyle}>
            {/* Header */}
            <div style={{
                padding: "16px", borderBottom: `1px solid ${color}22`,
                display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0,
            }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                            color, background: badgeBg, border: `1px solid ${color}44`,
                            borderRadius: 4, padding: "2px 8px",
                        }}>
                            {badgeLabel}
                        </span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Strategic Chokepoint
                        </span>
                    </div>
                    <h2 style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 500, margin: 0 }}>{cp.name}</h2>
                    {isRich && cp.borderingNations?.length > 0 && (
                        <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                            {cp.borderingNations.join(" · ")}
                        </div>
                    )}
                </div>
                <button onClick={onClose} style={{
                    background: "rgba(30,41,59,0.8)", border: "1px solid rgba(148,163,184,0.3)",
                    borderRadius: 6, color: "#e2e8f0", padding: "6px 12px",
                    cursor: "pointer", fontSize: 16, lineHeight: 1, flexShrink: 0,
                }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
                {/* Wikipedia image */}
                <div style={{
                    height: 180, background: `linear-gradient(135deg,rgba(8,14,28,1) 0%,rgba(12,22,44,1) 100%)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    position: "relative", overflow: "hidden", borderBottom: `1px solid ${color}18`,
                }}>
                    {wikiImg && (
                        <img src={wikiImg} alt={cp.name}
                            onLoad={() => setImgLoaded(true)}
                            onError={() => setWikiImg(null)}
                            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: imgLoaded ? 0.8 : 0, transition: "opacity 0.4s" }}
                        />
                    )}
                    {(!wikiImg || !imgLoaded) && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                                <path d="M4 36 L8 28 L22 16 L36 28 L44 20" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
                                <path d="M4 42 L44 42" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
                                <circle cx="24" cy="18" r="4" fill={color} opacity="0.25"/>
                            </svg>
                            <div style={{ fontSize: 11, color: `${color}66`, letterSpacing: "0.08em", textTransform: "uppercase" }}>Maritime Chokepoint</div>
                        </div>
                    )}
                    {/* Gradient overlay */}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(to top,rgba(10,14,22,0.9),transparent)", pointerEvents: "none" }} />
                </div>

                <div style={{ padding: 16 }}>
                    {/* Stats grid */}
                    {isRich && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                            {[
                                { label: "Daily Traffic", value: cp.dailyTraffic },
                                { label: "Width", value: cp.width },
                                { label: "Global Trade Share", value: cp.globalTradeShare },
                                { label: "Threat Level", value: cp.threatLevel },
                            ].map(({ label, value }) => (
                                <div key={label} style={{
                                    background: "rgba(30,41,59,0.6)", border: `1px solid ${color}18`,
                                    borderRadius: 8, padding: "10px 12px",
                                }}>
                                    <div style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
                                    <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>{value || "—"}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Why it matters */}
                    {isRich && cp.whyItMatters && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ color, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                                Strategic Significance
                            </div>
                            <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.65, margin: 0, borderLeft: `2px solid ${color}44`, paddingLeft: 12 }}>
                                {cp.whyItMatters}
                            </p>
                        </div>
                    )}

                    {/* Wikipedia extract (if different from whyItMatters) */}
                    {wikiText && !isRich && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ color, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>About</div>
                            <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.65, margin: 0 }}>{wikiText}</p>
                        </div>
                    )}

                    {/* Current threats */}
                    {isRich && cp.currentThreats?.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ color, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                                Active Threat Vectors
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {cp.currentThreats.map((threat, i) => (
                                    <div key={i} style={{
                                        display: "flex", alignItems: "flex-start", gap: 8,
                                        background: `${color}08`, border: `1px solid ${color}18`,
                                        borderRadius: 6, padding: "8px 10px",
                                    }}>
                                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 4 }} />
                                        <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>{threat}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Legacy: recent headlines */}
                    {!isRich && cp.recent_headlines?.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color, marginBottom: 6 }}>
                                Recent Activity ({cp.match_count} matches / 48h)
                            </div>
                            {cp.recent_headlines.map((h, i) => (
                                <div key={i} style={{ fontSize: 10, color: "#8899aa", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", lineHeight: 1.5 }}>{h}</div>
                            ))}
                        </div>
                    )}

                    {/* Wikipedia link */}
                    {cp.wikipedia && (
                        <button
                            onClick={() => window.open(`https://en.wikipedia.org/wiki/${encodeURIComponent(cp.wikipedia)}`, "_blank", "noopener")}
                            style={{
                                width: "100%", background: `${color}18`, border: `1px solid ${color}44`,
                                borderRadius: 8, padding: 12, color, fontSize: 13,
                                cursor: "pointer", textAlign: "left", marginTop: 4,
                            }}
                        >
                            Read more on Wikipedia →
                        </button>
                    )}
                </div>
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
    focusRegions     = [],    // string[] — active focus regions for event filtering
    onPanelOpen      = null,  // () => void — called when map opens a fixed side panel
    externalPanelOpen = false, // bool — when true, close map's fixed panels
    currentUser      = null,  // authenticated user object — for superadmin-only features
    initialMapStyle  = "satellite", // "satellite" | "street" | "terrain" — from preferences
    overwatchActive   = false, // bool — Overwatch ML detection mode
    onOverwatchExit   = null,  // () => void — called when user exits Overwatch
    sentinel2Active   = false, // bool — Sentinel-2 draw mode (lifted for mobile nav)
    onSentinel2Exit   = null,  // () => void — called when Sentinel-2 is toggled off externally
    // Director Mode props
    onMapReady          = null,  // (mapInstance) => void — called when Leaflet map is ready
    directorLayerOverrides = {}, // {layerKey: bool} — merged over active for rendering
    directorHighlights  = [],   // [{id, lat, lon, style}] — animated highlight markers
    directorItems       = null, // granular director visibility state from CommandRunner
    isDirectorMode      = false, // when true, layer toggles are ignored; directorItems controls what's visible
    timeTravelTime      = null, // ISO string — when set, overrides live ADS-B + AIS with historical snapshot
}) {
    const [zoom, setZoom] = useState(6)
    const [showEventLabels, setShowEventLabels] = useState(false)
    const [selectedEvent, setSelectedEvent] = useState(null)
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const h = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])
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
            eez: false,
            borders: false,
            cityLabels: true,
            newsConflicts: false,
            unifiedEvents: true,
            liveTicker: false,
            infra: false,
            news: false,
            adsb: false,
            adsbLabels: false,
            route: false,
            tv: false,
            webcams: false,
            satellite: false,
            sentinel2: false,
            annotate: false,
            sattrack: false,
            missileAlerts: false,
            earthquakeEvents: false,
            imbPiracy: false,
            poi: false,
            deployments: false,
            aisVessels: false,
            userLocations: false,
            conflictZones: false,
            oim: false,
            oimPower: true,
            oimTelecoms: true,
            oimPetroleum: true,
            oimWater: true,
        }
        let stored = {}
        try { stored = JSON.parse(localStorage.getItem(LAYER_STORAGE_KEY) || "{}") } catch {}
        // v2 migration: unifiedEvents default changed false→true
        // If stored state predates v2, strip the stale value so defaults win
        const isPreV2 = !stored._layerStateV || stored._layerStateV < 2
        if (isPreV2) delete stored.unifiedEvents
        // Also strip from workspace initialActive if it was saved pre-v2
        const safeInitial = (initialActive && isPreV2 && initialActive.unifiedEvents === false)
            ? { ...initialActive, unifiedEvents: true }
            : (initialActive || {})
        return { ...defaults, ...stored, ...safeInitial }
    })
    // Director Mode: merge overrides over user layer state for rendering only
    const effectiveActive = useMemo(
        () => Object.keys(directorLayerOverrides).length ? { ...active, ...directorLayerOverrides } : active,
        [active, directorLayerOverrides]
    )

    // ── Director visibility helpers ───────────────────────────────────────────
    // When Director Mode is active, individual item sets control visibility.
    // When inactive, normal layer toggles apply.
    const dirCp           = isDirectorMode ? (directorItems?.chokepoints          ?? new Set()) : null
    const dirEvt          = isDirectorMode ? (directorItems?.events               ?? new Set()) : null
    const dirInfra        = isDirectorMode ? (directorItems?.infrastructure       ?? new Map()) : null
    const dirVessel       = isDirectorMode ? (directorItems?.vessels              ?? new Set()) : null
    const dirAC           = isDirectorMode ? (directorItems?.aircraft             ?? new Set()) : null
    const dirSat          = isDirectorMode ? (directorItems?.satellite            ?? false)    : null
    const dirCountries           = isDirectorMode ? (directorItems?.highlightedCountries  ?? new Map()) : null
    const dirCountryInfoOverlays = isDirectorMode ? (directorItems?.countryInfoOverlays   ?? new Set()) : new Set()
    const dirPlacedEvents     = isDirectorMode ? (directorItems?.placedEvents     ?? new Map()) : null
    const dirPlacedLocations  = isDirectorMode ? (directorItems?.placedLocations  ?? new Map()) : null

    const [activeWebcam, setActiveWebcam] = useState(null)
    const [contextualAnalysis, setContextualAnalysis] = useState(false)
    const [manualOverrides, setManualOverrides] = useState({})

    // contextualLayers prop is accepted for API compatibility but no longer
    // auto-activates global layer toggles. Infrastructure loads contextually
    // via the event-selection system below. eslint-disable-next-line no-unused-vars
    void contextualLayers

    useEffect(() => {
        try { localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify({ ...active, _layerStateV: 2 })) } catch {}
        onActiveChange?.(active)
    }, [active, onActiveChange])

    // ── Sentinel-2 loaded image (shared with OverwatchLayer for direct inference) ─
    const [sentinelImageData, setSentinelImageData] = useState(null)

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

    const [allCountriesGeo, setAllCountriesGeo] = useState(null)
    const [cableGeo, setCableGeo]               = useState({ cables: [], points: [], associations: {} })
    const [selectedCountry, setSelectedCountry]         = useState(null)
    const [selectedCountryFeature, setSelectedCountryFeature] = useState(null)
    const [countryData, setCountryData]                 = useState(null)
    const [countryLoading, setCountryLoading]           = useState(false)
    const [selectedEez, setSelectedEez]                 = useState(null)
    const selectedEezRef                                = useRef(null)
    const [viewportBounds, setViewportBounds]   = useState(null)

    // ── UI state ──────────────────────────────────────────────────────────────
    const [hoveredWidget, setHoveredWidget] = useState(null)
    const [markerBatch, setMarkerBatch] = useState(0)   // incremented on each fetch → replays marker CSS anim
    const [toastInfo, setToastInfo]     = useState(null) // {count, key}
    const [notificationsEnabled, setNotificationsEnabled] = useState(
        () => localStorage.getItem("hw-notifications-enabled") !== "false"
    )
    const notificationsEnabledRef = useRef(notificationsEnabled)
    useEffect(() => { notificationsEnabledRef.current = notificationsEnabled }, [notificationsEnabled])
    const toggleNotifications = useCallback((val) => {
        const next = val ?? !notificationsEnabled
        setNotificationsEnabled(next)
        localStorage.setItem("hw-notifications-enabled", next ? "true" : "false")
    }, [notificationsEnabled])

    const [adsbCount, setAdsbCount]             = useState(0)
    const [adsbRefreshRate, setAdsbRefreshRate] = useState(1)   // applied rate
    const [adsbSliderVal, setAdsbSliderVal]     = useState(1)   // displayed slider value
    const [adsbLive, setAdsbLive]               = useState(false)
    const [adsbActivateKey, setAdsbActivateKey] = useState(0)
    const [sourceStatus, setSourceStatus]       = useState({})
    const [mapType, setMapType]                 = useState(() => {
        const MAP = { satellite: "satellite", street: "standard", terrain: "dark" }
        return MAP[initialMapStyle] || "satellite"
    })
    useEffect(() => {
        const MAP = { satellite: "satellite", street: "standard", terrain: "dark" }
        const t = MAP[initialMapStyle]
        if (t) setMapType(t)
    }, [initialMapStyle])

    // Map-type-aware colour — must be declared before the borders useEffect that uses it
    const borderGlowColor = mapType === "satellite" ? "#ffffff" : "#00FF88"

    // ── Pipeline GeoJSON lines ────────────────────────────────────────────────
    const [pipelineGeoData, setPipelineGeoData] = useState([])

    // ── Deployments layer ─────────────────────────────────────────────────────
    const [deploymentsData, setDeploymentsData]               = useState(null)
    const [selectedDeployment, setSelectedDeployment]         = useState(null)
    const [deploymentZonesVisible, setDeploymentZonesVisible] = useState(true)
    const [hoveredDeploymentName, setHoveredDeploymentName]   = useState(null)

    // ── OpenInfraMap availability ─────────────────────────────────────────────
    const [oimUnavailable, setOimUnavailable] = useState(false)

    // ── AIS live vessel tracking ───────────────────────────────────────────────
    const [aisVessels, setAisVessels]         = useState([])
    const [aisStatus, setAisStatus]           = useState(null)  // {connected, error, vessel_count}
    const [selectedAisVessel, setSelectedAisVessel] = useState(null)
    const aisIntervalRef                      = useRef(null)

    // ── Pinned anomaly alert markers ───────────────────────────────────────────
    const [pinnedAlerts, setPinnedAlerts]     = useState([])
    const alertMarkersRef                     = useRef([])

    // ── Shipping lanes (OpenSeaMap tile overlay) ──────────────────────────────

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
    const [unifiedEvents, setUnifiedEvents]           = useState([])
    const [unifiedEventsCount, setUnifiedEventsCount] = useState(0)

    // Region bboxes for event filtering — (south, north, west, east)
    const REGION_BBOXES = {
        "East Africa":                 { south: -12, north:  18, west:  28, east:  52 },
        "Horn of Africa":              { south:   2, north:  18, west:  38, east:  52 },
        "Great Lakes Region":          { south: -10, north:   2, west:  27, east:  33 },
        "Sahel":                       { south:  10, north:  20, west: -17, east:  24 },
        "West Africa":                 { south:   4, north:  20, west: -17, east:  16 },
        "North Africa":                { south:  18, north:  38, west: -17, east:  37 },
        "Central Africa":              { south: -10, north:  10, west:   8, east:  32 },
        "Southern Africa":             { south: -35, north: -12, west:  12, east:  36 },
        "Red Sea / Arabian Peninsula": { south:  12, north:  30, west:  32, east:  60 },
        "Gulf States":                 { south:  22, north:  30, west:  46, east:  60 },
        "Middle East":                 { south:  25, north:  42, west:  28, east:  63 },
        "Levant":                      { south:  29, north:  38, west:  34, east:  42 },
        "Iran":                        { south:  25, north:  40, west:  44, east:  64 },
        "Iraq":                        { south:  29, north:  38, west:  38, east:  49 },
        "Yemen":                       { south:  12, north:  19, west:  42, east:  55 },
        "Indian Ocean":                { south: -35, north:  25, west:  30, east: 110 },
        "Mediterranean":               { south:  30, north:  46, west:  -6, east:  42 },
        "South Asia":                  { south:   5, north:  38, west:  60, east:  95 },
        "Southeast Asia":              { south: -10, north:  28, west:  92, east: 140 },
        "Central Asia":                { south:  36, north:  55, west:  46, east:  90 },
        "East Asia":                   { south:  18, north:  54, west:  73, east: 146 },
        "Europe":                      { south:  35, north:  72, west: -25, east:  45 },
        "Eastern Europe":              { south:  43, north:  60, west:  14, east:  40 },
        "Ukraine":                     { south:  44, north:  53, west:  22, east:  41 },
        "Balkans":                     { south:  38, north:  47, west:  13, east:  29 },
        "Russia":                      { south:  50, north:  77, west:  26, east:  68 },
        "North America":               { south:  24, north:  72, west:-170, east: -52 },
        "Central America":             { south:   7, north:  25, west: -92, east: -59 },
        "South America":               { south: -57, north:  13, west: -82, east: -34 },
        "Australia":                   { south: -45, north: -10, west: 112, east: 154 },
        "Global":                      null,
    }

    const filteredUnifiedEvents = useMemo(() => {
        if (focusRegions.length === 0) return unifiedEvents
        const hasGlobal = focusRegions.includes("Global")
        if (hasGlobal) return unifiedEvents
        return unifiedEvents.filter(ev => {
            if (!ev.lat || !ev.lon) return false
            return focusRegions.some(r => {
                const bbox = REGION_BBOXES[r]
                if (!bbox) return false
                return ev.lat >= bbox.south && ev.lat <= bbox.north &&
                       ev.lon >= bbox.west  && ev.lon <= bbox.east
            })
        })
    }, [unifiedEvents, focusRegions])
    const [surveillanceAlerts, setSurveillanceAlerts] = useState([])

    // ── POI layer ─────────────────────────────────────────────────────────────
    const [poiData, setPoiData]                 = useState([])
    const [selectedPoiMarker, setSelectedPoiMarker] = useState(null)
    const poiMapRef                             = useRef(null)
    const prePOILayersRef                       = useRef(null)

    const [userLocationsData, setUserLocationsData] = useState([])
    const userLocationsLayerRef                  = useRef(null)
    const [userTrackUserId, setUserTrackUserId]   = useState(null)
    const [userTrackData,   setUserTrackData]     = useState([])
    const userTrackLayerRef                      = useRef(null)

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
    const [portSelected, setPortSelected]   = useState(null)   // clicked port item
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
    const shippingLanesLayerRef  = useRef(null)   // OpenSeaMap tile layer
    const chokepointsLayerRef        = useRef(null)
    const heatmapLayerRef            = useRef(null)
    const eezLayerRef                = useRef(null)
    const bordersLayerRef            = useRef(null)
    const dirCountryHighlightRef     = useRef(null)   // Director country highlight layer
    const dirCountryLabelsRef        = useRef([])     // Director country label markers
    const dirPlacedEventsRef         = useRef([])     // Director placed event markers
    const dirPlacedLocationsRef      = useRef([])     // Director placed location markers
    const cityLabelsLayerRef     = useRef(null)
    const newsConflictsLayerRef  = useRef(null)
    const enrichmentLayerRef     = useRef(null)
    const unifiedLayerRef        = useRef(null)
    const depLayerRef            = useRef(null)
    const contextBordersLayerRef = useRef(null)
    const contextEezLayerRef     = useRef(null)
    const viewportBoundsRef      = useRef(null)
    const prevBoundsRef          = useRef(null)
    const infraLastBoundsRef     = useRef({})    // per-category last-fetched bounds
    const newsConflictsDebounceRef = useRef(null) // debounce timer (unused, kept for cleanup)
    const tempMarkerTimerRef     = useRef(null)

    // ── Pulse keyframe (injected once) ────────────────────────────────────────
    useEffect(() => {
        if (!document.getElementById("hw-pulse-style")) {
            const style = document.createElement("style")
            style.id = "hw-pulse-style"
            style.textContent = `@keyframes hw-pulse {
                0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
                70%  { box-shadow: 0 0 0 12px rgba(239,68,68,0); }
                100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
            }`
            document.head.appendChild(style)
        }
    }, [])

    // ── Event marker helpers (inside component for closure access) ────────────
    const cleanEventTitle = useCallback((headline, eventType, location) => {
        if (!headline) return eventType || "Unknown event"
        let title = headline
            .replace(/^\d{4}-\d{2}-\d{2}[T\s][\d:]+\s*/, "")
            .replace(/^(breaking|update|watch|report):\s*/i, "")
            .replace(/\s*(says|according to|reports say|officials say).*$/i, "")
            .replace(/\s*[-–—]\s*(Reuters|AP|AFP|BBC|CNN|Al Jazeera|Guardian|Times).*$/i, "")
            .replace(/\s+/g, " ")
            .trim()
        if (title.length > 60) {
            title = title.substring(0, 57).replace(/\s+\S*$/, "") + "..."
        }
        return title || location || "Event"
    }, [])

    const getNewsMarkerHTML = useCallback((marker, showLabel) => {
        const tier = marker.severity_tier || marker.confidence || "medium"
        const ageHours = marker.published
            ? (Date.now() - new Date(marker.published).getTime()) / 3600000
            : 0
        const size = tier === "critical" ? 32 : (tier === "high" || tier === "significant") ? 26 : (tier === "medium" || tier === "elevated") ? 20 : 16
        const color = tier === "critical" ? "#ef4444" : (tier === "high" || tier === "significant") ? "#f97316" : (tier === "medium" || tier === "elevated") ? "#eab308" : "#94a3b8"
        const opacity = Math.max(0.35, 1 - (ageHours / 72) * 0.65)
        const shouldPulse = (tier === "critical" || tier === "high") && ageHours < 3
        const typeIcons = { airstrike: "✦", missile: "↑", armed_clash: "✕", explosion: "◉", maritime: "▲", protest: "◆", earthquake: "⊕", fire: "◈", assassination: "◎", coerce: "!", fight: "✕", assault: "✕", general: "●" }
        const icon = typeIcons[(marker.type || "").toLowerCase()] || typeIcons[(marker.icon || "").toLowerCase()] || "●"
        const label = showLabel
            ? `<div style="position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);font-size:10px;font-family:Inter,sans-serif;color:white;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,1);pointer-events:none;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${(marker.headline || marker.location || "").substring(0, 50)}</div>`
            : ""
        return `<div style="position:relative;width:${size}px;height:${size}px;"><div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.7);opacity:${opacity};box-shadow:0 0 ${size * 2.5}px ${color},0 0 ${size * 1.2}px ${color}aa,0 0 ${size * 0.6}px rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;font-size:${Math.max(9, size - 8)}px;cursor:pointer;${shouldPulse ? "animation:hw-pulse 1.8s ease-out infinite;" : ""}">${icon}</div>${label}</div>`
    }, [])

    const getEventMarkerHTML = useCallback((event, showLabel) => {
        const tier = event.severity_tier || "low"
        const publishedAt = event.published_at ? new Date(event.published_at) : new Date()
        const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)
        const size  = tier === "critical" ? 30 : tier === "significant" ? 24 : tier === "elevated" ? 18 : 14
        const color = tier === "critical" ? "#ef4444" : tier === "significant" ? "#f97316" : tier === "elevated" ? "#eab308" : "#6b7280"
        const opacity = Math.max(0.25, 1 - (ageHours / 48) * 0.75)
        const shouldPulse = tier === "critical" && ageHours < 2
        const iconDef = (typeof EVENT_ICONS !== "undefined" && EVENT_ICONS?.[event.icon]) || (typeof EVENT_ICONS !== "undefined" && EVENT_ICONS?.[event.type]) || { symbol: "●" }
        const label = showLabel
            ? `<div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:3px;font-size:10px;font-family:Inter,sans-serif;color:white;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.9);pointer-events:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${cleanEventTitle(event.headline, event.type, event.location)}</div>`
            : ""
        return `<div style="position:relative;width:${size}px;height:${size}px;">` +
            `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:1.5px solid rgba(255,255,255,0.6);opacity:${opacity};box-shadow:0 0 ${size * 2}px ${color},0 0 ${size}px ${color}88;display:flex;align-items:center;justify-content:center;font-size:${Math.max(11, size - 4)}px;${shouldPulse ? "animation:hw-pulse 2s ease-out infinite;" : ""}">${iconDef.symbol}</div>` +
            label +
            `</div>`
    }, [cleanEventTitle])

    const dsActive = useMemo(() => ({
        airport: !!effectiveActive.airports,
        port: !!effectiveActive.ports,
        power: !!effectiveActive.powerPlants,
        chokepoints: !!effectiveActive.chokepoints,
    }), [effectiveActive.airports, effectiveActive.ports, effectiveActive.powerPlants, effectiveActive.chokepoints])

    const infraActive = useMemo(() => ({
        medical: !!effectiveActive.hospitals,
        security: !!effectiveActive.police,
        // Dedicated dataset layers already cover airports and power plants with
        // higher-quality metadata. Keep OSM fallback off by default to avoid
        // vague transport/power points masquerading as precise assets.
        transport: false,
        power: false,
        military: !!effectiveActive.military,
        pipelines: false,  // GEM pipeline lines rendered separately; suppress Overpass point markers
        comms: false,
        government: false,
        chokepoints: !!effectiveActive.chokepoints,
        utilities: false,
    }), [effectiveActive.hospitals, effectiveActive.police, effectiveActive.military, effectiveActive.pipelines, effectiveActive.chokepoints])

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

    // Auto-clear toast after 2.2s (matches CSS animation duration)
    useEffect(() => {
        if (!toastInfo) return
        const t = setTimeout(() => setToastInfo(null), 2200)
        return () => clearTimeout(t)
    }, [toastInfo?.key])

    // akili:show-country — dispatched by GDELT zone marker clicks
    useEffect(() => {
        const handler = (e) => {
            const { location, country } = e.detail || {}
            const name = location?.split(",")[0]?.trim() || country || ""
            if (name) setSelectedCountry(name)
        }
        window.addEventListener("akili:show-country", handler)
        return () => window.removeEventListener("akili:show-country", handler)
    }, [])

    // akili:jump-to — fly map to a coordinate (dispatched by NotificationBar / toasts)
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon } = e.detail || {}
            if (mapRef.current && lat && lon) {
                const targetZoom = Math.max(mapRef.current.getZoom(), 8)
                mapRef.current.flyTo([lat, lon], targetZoom, { duration: 1.5, easeLinearity: 0.3 })
            }
        }
        window.addEventListener("akili:jump-to", handler)
        return () => window.removeEventListener("akili:jump-to", handler)
    }, [])

    // akili:show-event — open EventDetailPanel for an event (dispatched by toast click)
    useEffect(() => {
        const handler = (e) => {
            const ev = e.detail
            if (!ev) return
            setSelectedEvent({
                ...ev,
                headline:     ev.clean_title || ev.headline || "",
                published_at: ev.latest_event || ev.published || "",
                published:    ev.latest_event || ev.published || "",
                type:         ev.event_type || "general",
                context:      ev.body || ev.summary || "",
            })
        }
        window.addEventListener("akili:show-event", handler)
        return () => window.removeEventListener("akili:show-event", handler)
    }, [])

    // New-events notification from incremental news conflict loader
    useEffect(() => {
        const handler = (e) => {
            const { count, severity, region, items } = e.detail
            const color = severity === "critical" ? "#ef4444"
                : severity === "significant" ? "#f97316"
                : "#eab308"
            const title = count === 1
                ? `New event — ${items[0]?.location || region}`
                : `${count} new events — ${region}`
            if (notificationsEnabledRef.current) {
                setToastInfo({ count, key: Date.now(), message: title, color })
            }
        }
        window.addEventListener("akili:new-events", handler)
        return () => window.removeEventListener("akili:new-events", handler)
    }, [])

    // Keyboard shortcut: I = toggle OpenInfraMap master layer
    // Uses setActive directly (stable React dispatcher) to avoid referencing
    // the `toggle` useCallback which is declared 2000 lines later — that
    // forward-reference causes a TDZ crash in the production bundle.
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return
            if (e.key === "i" || e.key === "I") setActive(a => ({ ...a, oim: !a.oim }))
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])

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
        if (!effectiveActive.route || !routeOrigin || !routeDest) return
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
    }, [effectiveActive.route, routeOrigin, routeDest, waypoints])

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
        if (!effectiveActive.route) {
            setRouteOrigin(null); setRouteDest(null)
            setRouteGeo(null); setRouteInfo(null); setRouteSteps([])
            setRouteAnalysis(null); setRouteLoading(false); setRouteAnalysing(false)
            setShowAlternatives(false); setAltRoutes(null); setCorridorData(null)
            setFromInput(""); setToInput(""); setWaypoints([])
        }
    }, [effectiveActive.route])

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
    const datasetInfraEnabled = effectiveActive.airports || effectiveActive.ports || effectiveActive.powerPlants

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
        if (!effectiveActive.ports || !viewportBounds) {
            if (!effectiveActive.ports) setPortsData([])
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
    }, [effectiveActive.ports, viewportBounds])  // eslint-disable-line

    // ── AIS vessel tracking: poll every 30s when layer on OR Director Mode active ─
    // Uses viewportBoundsRef (not viewportBounds state) so the interval does not
    // restart on every map move — only when the toggle itself changes.
    useEffect(() => {
        if (!effectiveActive.aisVessels && !isDirectorMode) {
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
        fetchVessels()  // immediate fetch on toggle-on or director start
        if (aisIntervalRef.current) clearInterval(aisIntervalRef.current)
        aisIntervalRef.current = setInterval(fetchVessels, 30000)
        return () => { if (aisIntervalRef.current) { clearInterval(aisIntervalRef.current); aisIntervalRef.current = null } }
    }, [effectiveActive.aisVessels, isDirectorMode])  // eslint-disable-line

    // ── Time Travel: load historical AIS vessel snapshot ─────────────────────
    useEffect(() => {
        if (!timeTravelTime) return
        if (aisIntervalRef.current) { clearInterval(aisIntervalRef.current); aisIntervalRef.current = null }
        const tok = localStorage.getItem("hw-auth-token")
        const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
        fetch(`${API}/api/history/snapshot?timestamp=${encodeURIComponent(timeTravelTime)}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                setAisVessels(data.vessels.map(v => ({
                    mmsi:           v.mmsi,
                    name:           v.name,
                    lat:            v.lat,
                    lon:            v.lon,
                    sog:            v.speed,
                    cog:            v.heading,
                    ship_type_text: v.ship_type_text,
                })))
            })
            .catch(() => {})
    }, [timeTravelTime])  // eslint-disable-line

    // ── Pinned anomaly alert markers: poll every 60s ──────────────────────────
    useEffect(() => {
        const fetchAlerts = () => {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = tok ? { Authorization: `Bearer ${tok}` } : {}
            fetch(`${API}/api/alerts/anomalies`, { headers })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (d) setPinnedAlerts((d.alerts || []).filter(a => a.pinned && !a.dismissed))
                })
                .catch(() => {})
        }
        fetchAlerts()
        const tid = setInterval(fetchAlerts, 60_000)
        return () => clearInterval(tid)
    }, [])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        // Remove old markers
        alertMarkersRef.current.forEach(m => { try { m.remove() } catch {} })
        alertMarkersRef.current = []
        if (!pinnedAlerts.length) return
        pinnedAlerts.forEach(alert => {
            if (alert.lat == null || alert.lon == null) return
            const pulse = alert.severity === 'critical' ? '#ff3333' : '#ffaa00'
            const marker = L.marker([alert.lat, alert.lon], {
                icon: L.divIcon({
                    className: "",
                    html: `<div style="position:relative;">
                        <div style="width:14px;height:14px;border-radius:50%;background:${pulse};border:2px solid white;box-shadow:0 0 10px ${pulse};"></div>
                        <div style="position:absolute;top:-26px;left:50%;transform:translateX(-50%);padding:2px 7px;border-radius:4px;background:rgba(0,0,0,0.82);color:${pulse};font-size:9px;font-weight:700;white-space:nowrap;border:1px solid ${pulse}40;font-family:system-ui;">⚠ ${(alert.title || '').substring(0, 32)}</div>
                    </div>`,
                    iconSize:   [14, 14],
                    iconAnchor: [7, 7],
                }),
                zIndexOffset: 900,
            }).addTo(map)
            alertMarkersRef.current.push(marker)
        })
        return () => {
            alertMarkersRef.current.forEach(m => { try { m.remove() } catch {} })
            alertMarkersRef.current = []
        }
    }, [pinnedAlerts])  // eslint-disable-line

    // ── OpenSeaMap seamark tiles — shown at zoom ≥ 6, anti-flicker options ─────
    useEffect(() => {
        if (!mapRef.current) return
        if (shippingLanesLayerRef.current) {
            shippingLanesLayerRef.current.remove()
            shippingLanesLayerRef.current = null
        }
        if (!effectiveActive.shippingLanes) return
        shippingLanesLayerRef.current = L.tileLayer(
            "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
            {
                attribution: "© OpenSeaMap contributors",
                opacity: 0.9,
                minZoom: 6,
                maxZoom: 18,
                zIndex: 400,
            }
        ).addTo(mapRef.current)
    }, [effectiveActive.shippingLanes])

    // ── Conflict zones layer ──────────────────────────────────────────────────────
    // Backend endpoint is currently stubbed (GDELT source removed). The toggle still
    // exists in LayersPanel for future use. Wire up the state so toggling doesn't
    // throw "effectiveActive.conflictZones is undefined" errors and so the badge/loading props
    // passed from LayersPanel don't cause warnings. No visual layer is rendered
    // until the backend provides data.
    // (No useEffect needed — conflictZones just controls the active flag; when the
    // backend is restored, add a fetch + GeoJSON render here.)

    // ── EEZ interactive layer ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!mapRef.current) return
        if (eezLayerRef.current) { eezLayerRef.current.remove(); eezLayerRef.current = null }
        if (!effectiveActive.eez || !eezGeo) return

        const defaultStyle = { color: "#0d9488", weight: 1.5, opacity: 0.45, fill: true, fillColor: "#0d9488", fillOpacity: 0.04 }
        const hoverStyle   = { weight: 2.5, opacity: 0.75, fillOpacity: 0.10 }
        const selectStyle  = { color: "#38bdf8", weight: 2.5, opacity: 1, fillColor: "#38bdf8", fillOpacity: 0.14 }

        eezLayerRef.current = L.geoJSON(eezGeo, {
            style: () => ({ ...defaultStyle }),
            onEachFeature: (feature, layer) => {
                const p    = feature.properties || {}
                const name = p.geoname || p.territory1 || "EEZ"

                layer.bindTooltip(name, {
                    sticky: true, direction: "top",
                    className: "eez-tooltip",
                })

                layer.on("mouseover", () => {
                    if (selectedEezRef.current?.mrgid !== p.mrgid) {
                        layer.setStyle(hoverStyle)
                    }
                })
                layer.on("mouseout", () => {
                    if (selectedEezRef.current?.mrgid !== p.mrgid) {
                        layer.setStyle(defaultStyle)
                    }
                })
                layer.on("click", (ev) => {
                    L.DomEvent.stopPropagation(ev)
                    // Reset all to default, then highlight clicked
                    eezLayerRef.current?.eachLayer(l => l.setStyle && l.setStyle(defaultStyle))
                    layer.setStyle(selectStyle)

                    const detail = {
                        mrgid:    p.mrgid,
                        name:     p.geoname || p.territory1,
                        country:  p.territory1,
                        sovereign: p.sovereign1,
                        area_km2: p.area_km2,
                        iso_code: p.iso_ter1,
                    }
                    selectedEezRef.current = detail
                    setSelectedEez(detail)
                })
            },
        }).addTo(mapRef.current)
    }, [effectiveActive.eez, eezGeo])

    // ── Sync selectedEezRef with state ────────────────────────────────────────────
    useEffect(() => { selectedEezRef.current = selectedEez }, [selectedEez])

    // ── Country borders — imperative with hover tooltip + territory grouping ─────
    useEffect(() => {
        if (!mapRef.current) return
        if (bordersLayerRef.current) { bordersLayerRef.current.remove(); bordersLayerRef.current = null }
        if (!effectiveActive.borders || !allCountriesGeo) return

        const baseColor    = borderGlowColor
        const defaultStyle = { color: baseColor, weight: 1.25, opacity: 0.5, fill: true, fillColor: baseColor, fillOpacity: 0.02, pane: "context-polygons" }
        const hoverStyle   = { color: baseColor, weight: 2.2, opacity: 0.9, fillColor: baseColor, fillOpacity: 0.10 }

        // Build a name→layers index so we can highlight the full sovereign group
        const layersByName = new Map()

        // Derive reverse map: sovereign → Set of territory names
        const sovereignTerritories = new Map()
        for (const [terr, sov] of Object.entries(TERRITORY_SOVEREIGN)) {
            if (!sovereignTerritories.has(sov)) sovereignTerritories.set(sov, new Set())
            sovereignTerritories.get(sov).add(terr)
        }

        bordersLayerRef.current = L.geoJSON(allCountriesGeo, {
            style:         () => ({ ...defaultStyle }),
            pane:          "context-polygons",
            onEachFeature: (feature, layer) => {
                const name = feature.properties?.name || ""
                if (name) {
                    if (!layersByName.has(name)) layersByName.set(name, [])
                    layersByName.get(name).push(layer)
                    layer.bindTooltip(name, { sticky: true, direction: "top", className: "country-tooltip" })
                }

                layer.on("mouseover", () => {
                    // Resolve the sovereign for the hovered feature
                    const sovereign = TERRITORY_SOVEREIGN[name] || name
                    // Build the full group: sovereign + all its territories
                    const group = new Set([sovereign, ...(sovereignTerritories.get(sovereign) || [])])
                    for (const [n, layers] of layersByName) {
                        if (group.has(n)) layers.forEach(l => l.setStyle(hoverStyle))
                    }
                })
                layer.on("mouseout", () => {
                    bordersLayerRef.current?.eachLayer(l => l.setStyle && l.setStyle(defaultStyle))
                })
            },
        }).addTo(mapRef.current)
    }, [effectiveActive.borders, allCountriesGeo, borderGlowColor])

    // ── Director Mode: country highlight layer ────────────────────────────────
    useEffect(() => {
        const map = mapRef.current
        if (!map) return

        // Clean up any existing highlight layer and labels
        const cleanupHighlights = () => {
            if (dirCountryHighlightRef.current) {
                dirCountryHighlightRef.current.remove()
                dirCountryHighlightRef.current = null
            }
            dirCountryLabelsRef.current.forEach(m => m.remove())
            dirCountryLabelsRef.current = []
        }

        if (!isDirectorMode || !dirCountries || dirCountries.size === 0 || !allCountriesGeo) {
            cleanupHighlights()
            return
        }

        cleanupHighlights()

        const CONTEXT_COLORS = {
            conflict: { fill: "#ff2020", stroke: "#ff4040", fillOpacity: 0.35, weight: 3 },
            allied:   { fill: "#20ff60", stroke: "#40ff80", fillOpacity: 0.30, weight: 3 },
            neutral:  { fill: "#ffc020", stroke: "#ffd040", fillOpacity: 0.30, weight: 3 },
            focus:    { fill: "#2090ff", stroke: "#40a0ff", fillOpacity: 0.35, weight: 3 },
        }

        // Helper: strict country name matching — no fuzzy includes(), only exact + alias + prefix
        const normCN = (s) => (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim()

        // Each group: ALL members are equivalent. Uses exact === only — prevents "us" matching "russia"
        const ALIAS_GROUPS = [
            ["iran", "iran islamic republic of", "islamic republic of iran"],
            ["russia", "russian federation"],
            ["united states", "united states of america", "usa"],
            ["united kingdom", "united kingdom of great britain and northern ireland", "uk", "great britain", "britain"],
            ["uae", "united arab emirates"],
            ["turkey", "turkiye", "republic of turkiye"],
            ["south korea", "korea republic of", "republic of korea"],
            ["north korea", "korea democratic peoples republic of", "democratic peoples republic of korea", "dem rep korea"],
            ["syria", "syrian arab republic"],
            ["venezuela", "venezuela bolivarian republic of"],
            ["bolivia", "bolivia plurinational state of"],
            ["tanzania", "united republic of tanzania"],
            ["vietnam", "viet nam"],
            ["laos", "lao peoples democratic republic"],
            ["ivory coast", "cote divoire", "cote d ivoire"],
            ["drc", "democratic republic of the congo", "dr congo", "congo kinshasa"],
            ["republic of the congo", "congo brazzaville"],
            ["congo", "republic of the congo"],
            ["palestine", "state of palestine", "palestinian territories"],
            ["taiwan", "taiwan province of china", "chinese taipei"],
            ["saudi arabia", "kingdom of saudi arabia"],
            ["czech republic", "czechia"],
            ["eswatini", "swaziland"],
            ["myanmar", "burma"],
            ["north macedonia", "macedonia", "republic of north macedonia"],
            ["east timor", "timor leste"],
        ]

        const matchFeature = (featureName, queryName) => {
            if (!featureName || !queryName) return false
            const fn = normCN(featureName)
            const qn = normCN(queryName)
            if (fn === qn) return true
            // Strict alias lookup: both must appear (exact ===) in the SAME group
            for (const group of ALIAS_GROUPS) {
                if (group.some(a => fn === a) && group.some(a => qn === a)) return true
            }
            // Prefix match: only if both >= 5 chars and one starts with the other
            if (fn.length >= 5 && qn.length >= 5 && (fn.startsWith(qn) || qn.startsWith(fn))) return true
            return false
        }

        // Utility: compute approximate bounding box area for a GeoJSON feature
        const getFeatureArea = (feature) => {
            try {
                const coords = []
                const collect = (arr) => {
                    if (!Array.isArray(arr)) return
                    if (typeof arr[0] === "number") { coords.push(arr); return }
                    arr.forEach(collect)
                }
                collect(feature.geometry?.coordinates)
                if (!coords.length) return 0
                const lons = coords.map(c => c[0])
                const lats = coords.map(c => c[1])
                return (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lons) - Math.min(...lons))
            } catch (_) { return 0 }
        }

        // Filter features that match highlighted countries
        const matchedFeatures = []
        for (const feature of (allCountriesGeo.features || [])) {
            const fName = feature.properties?.ADMIN || feature.properties?.name || feature.properties?.NAME || ""
            for (const [hlName] of dirCountries.entries()) {
                if (matchFeature(fName, hlName)) {
                    matchedFeatures.push({ feature, hlName })
                    break
                }
            }
        }

        if (matchedFeatures.length === 0) return

        const highlightLayer = L.geoJSON(
            { type: "FeatureCollection", features: matchedFeatures.map(m => m.feature) },
            {
                pane: "overlayPane",
                style: (feature) => {
                    const fName = feature.properties?.ADMIN || feature.properties?.name || feature.properties?.NAME || ""
                    let hlName = ""
                    for (const [name] of dirCountries.entries()) {
                        if (matchFeature(fName, name)) { hlName = name; break }
                    }
                    const hi = dirCountries.get(hlName) || { context: "focus" }
                    const c = CONTEXT_COLORS[hi.context] || CONTEXT_COLORS.focus
                    return {
                        color:       c.stroke,
                        weight:      c.weight || 3,
                        opacity:     1.0,
                        fillColor:   c.fill,
                        fillOpacity: c.fillOpacity || 0.30,
                    }
                },
            }
        ).addTo(map)
        dirCountryHighlightRef.current = highlightLayer

        // Zoom-aware opacity — fade overlays when zoomed far in so map detail shows
        const updateOpacityForZoom = () => {
            const zoom = map.getZoom()
            highlightLayer.eachLayer(l => {
                const s = l.options
                const origFill   = s._origFillOpacity   ?? s.fillOpacity ?? 0.30
                const origStroke = s._origOpacity        ?? s.opacity     ?? 1.0
                const origWeight = s._origWeight         ?? s.weight      ?? 3
                if (zoom >= 10) {
                    l.setStyle({ fillOpacity: 0.03, opacity: 0.25, weight: 1 })
                } else if (zoom >= 8) {
                    l.setStyle({ fillOpacity: 0.10, opacity: 0.45, weight: 1.5 })
                } else if (zoom >= 6) {
                    l.setStyle({ fillOpacity: 0.18, opacity: 0.65, weight: 2 })
                } else {
                    l.setStyle({ fillOpacity: origFill, opacity: origStroke, weight: origWeight })
                }
            })
        }

        // Store original styles once
        highlightLayer.eachLayer(l => {
            if (!l.options._origFillOpacity) {
                l.options._origFillOpacity = l.options.fillOpacity
                l.options._origOpacity     = l.options.opacity
                l.options._origWeight      = l.options.weight
            }
        })

        map.on("zoomend", updateOpacityForZoom)
        updateOpacityForZoom()

        // Country labels — ONE label per director country name, no context description
        // Skip countries that have an active country_info_overlay (avoids duplicated name)
        const labeledCountries = new Set()
        for (const { feature, hlName } of matchedFeatures) {
            if (labeledCountries.has(hlName)) continue
            if (dirCountryInfoOverlays.has(hlName)) continue
            labeledCountries.add(hlName)

            const hi = dirCountries.get(hlName) || { context: "focus" }
            const c = CONTEXT_COLORS[hi.context] || CONTEXT_COLORS.focus
            const centroid = featureApproxCentroid(feature)
            if (!centroid) continue
            const [lat, lon] = centroid

            // Font size proportional to geographic extent
            const area = getFeatureArea(feature)
            const fontSize = area > 200 ? "13px" : area > 25 ? "11px" : "9px"

            const labelHtml = `<div style="color:${c.stroke};font-size:${fontSize};font-weight:700;text-transform:uppercase;letter-spacing:1.5px;text-shadow:0 0 8px ${c.fill},0 0 16px ${c.fill},0 1px 3px rgba(0,0,0,0.9);white-space:nowrap;pointer-events:none;">${hlName.toUpperCase()}</div>`
            const icon = L.divIcon({
                html: labelHtml,
                className: "director-country-label",
                iconAnchor: [0, 0],
            })
            const marker = L.marker([lat, lon], { icon, interactive: false, keyboard: false }).addTo(map)
            dirCountryLabelsRef.current.push(marker)
        }

        return () => {
            map.off("zoomend", updateOpacityForZoom)
            cleanupHighlights()
        }
    }, [isDirectorMode, dirCountries, allCountriesGeo])  // eslint-disable-line react-hooks/exhaustive-deps

    // ── Director placed events: render self-geocoded event markers ────────────
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        const L = window.L
        if (!L) return

        // Cleanup previous markers
        dirPlacedEventsRef.current.forEach(m => { try { map.removeLayer(m) } catch (_) {} })
        dirPlacedEventsRef.current = []

        if (!isDirectorMode || !dirPlacedEvents || dirPlacedEvents.size === 0) return

        // SVG inner paths for each event type (rendered inside a 24×24 viewBox circle marker)
        const TYPE_ICON = {
            conflict:       { fill: "#ef4444", stroke: "#fca5a5", inner: `<line x1="7" y1="7" x2="17" y2="17" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="7" x2="7" y2="17" stroke="white" stroke-width="2" stroke-linecap="round"/>` },
            maritime:       { fill: "#3b82f6", stroke: "#93c5fd", inner: `<path d="M12 5v9M8 10l4 4 4-4M6 17h12l-1.5 2h-9z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` },
            political:      { fill: "#8b5cf6", stroke: "#c4b5fd", inner: `<rect x="7" y="13" width="10" height="6" rx="1" fill="white" opacity="0.9"/><rect x="9" y="9" width="6" height="5" rx="1" fill="white" opacity="0.9"/><rect x="11" y="6" width="2" height="4" fill="white" opacity="0.9"/>` },
            humanitarian:   { fill: "#f59e0b", stroke: "#fcd34d", inner: `<rect x="11" y="7" width="2" height="10" rx="1" fill="white"/><rect x="7" y="11" width="10" height="2" rx="1" fill="white"/>` },
            infrastructure: { fill: "#06b6d4", stroke: "#67e8f9", inner: `<path d="M12 6l1.5 4.5H18l-3.75 2.7 1.43 4.3L12 15l-3.68 2.5 1.43-4.3L6 10.5h4.5z" fill="white" opacity="0.95"/>` },
            economic:       { fill: "#10b981", stroke: "#6ee7b7", inner: `<text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="700" fill="white" font-family="system-ui,sans-serif">$</text>` },
            military:       { fill: "#dc2626", stroke: "#fca5a5", inner: `<path d="M12 6l1.5 4.5H18l-3.75 2.7 1.43 4.3L12 15l-3.68 2.5 1.43-4.3L6 10.5h4.5z" fill="white" opacity="0.95"/>` },
            general:        { fill: "#6b7280", stroke: "#d1d5db", inner: `<circle cx="12" cy="12" r="3" fill="white" opacity="0.9"/>` },
        }
        const SEVERITY_SIZE = { critical: 26, significant: 22, elevated: 18, low: 14 }

        for (const [, ev] of dirPlacedEvents.entries()) {
            if (ev.lat == null || ev.lon == null) continue
            const cfg  = TYPE_ICON[ev.type] || TYPE_ICON.general
            const size = SEVERITY_SIZE[ev.severity] || 18
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="${cfg.fill}" stroke="${cfg.stroke}" stroke-width="1.5" opacity="0.92"/>
              ${cfg.inner}
            </svg>`
            const icon = L.divIcon({
                className: "director-placed-event",
                html: `<div style="position:relative;width:${size}px;height:${size}px">${svg}<div class="director-placed-event-label">${ev.title.slice(0, 40)}</div></div>`,
                iconSize:   [size, size],
                iconAnchor: [size / 2, size / 2],
            })
            const marker = L.marker([ev.lat, ev.lon], { icon, zIndexOffset: 600 })
                .bindPopup(`<div class="director-event-popup"><div class="director-event-popup-title">${ev.title}</div>${ev.summary ? `<div class="director-event-popup-summary">${ev.summary}</div>` : ""}${ev.source ? `<div class="director-event-popup-source">${ev.source}</div>` : ""}</div>`, { className: "director-event-leaflet-popup", maxWidth: 280 })
                .addTo(map)
            dirPlacedEventsRef.current.push(marker)
        }

        return () => {
            dirPlacedEventsRef.current.forEach(m => { try { map.removeLayer(m) } catch (_) {} })
            dirPlacedEventsRef.current = []
        }
    }, [isDirectorMode, dirPlacedEvents])  // eslint-disable-line react-hooks/exhaustive-deps

    // ── Director placed locations: named cities/bases/ports/facilities ────────
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        const L = window.L
        if (!L) return

        // Cleanup previous markers
        dirPlacedLocationsRef.current.forEach(m => { try { map.removeLayer(m) } catch (_) {} })
        dirPlacedLocationsRef.current = []

        if (!isDirectorMode || !dirPlacedLocations || dirPlacedLocations.size === 0) return

        // SVG icon markup for each location type
        const TYPE_CONFIG = {
            city:     { color: "#ffffff", glow: "rgba(255,255,255,0.6)", size: 12,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${c}" opacity="0.9" filter="url(#g)"/><circle cx="6" cy="6" r="2.5" fill="rgba(0,0,0,0.4)"/></svg>` },
            base:     { color: "#ff4444", glow: "rgba(255,68,68,0.8)",   size: 16,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.5 3.5,15 5,9.5 1,6 6,6" fill="${c}" opacity="0.95"/></svg>` },
            port:     { color: "#40a0ff", glow: "rgba(64,160,255,0.8)",  size: 15,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="13"/><path d="M5 13l7 7 7-7"/><line x1="3" y1="20" x2="21" y2="20"/></svg>` },
            facility: { color: "#ffc040", glow: "rgba(255,192,64,0.8)",  size: 15,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>` },
            landmark: { color: "#e0e0ff", glow: "rgba(200,200,255,0.7)", size: 13,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><polygon points="12,2 22,22 2,22" fill="${c}" opacity="0.9"/></svg>` },
            target:   { color: "#ff2020", glow: "rgba(255,32,32,0.9)",   size: 18,
                svg: (c, g) => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/></svg>` },
        }

        // Pre-collect valid locations for proximity checks
        const validLocs = []
        for (const [, loc] of dirPlacedLocations.entries()) {
            if (loc.lat != null && loc.lon != null) validLocs.push(loc)
        }

        // Label offset directions to spread nearby labels (cycles through 8 directions)
        const OFFSET_DIRS = [
            [0, -18], [18, -12], [18, 12], [0, 18],
            [-18, 12], [-18, -12], [24, 0], [-24, 0],
        ]

        const PROXIMITY_PX = 52

        for (let vi = 0; vi < validLocs.length; vi++) {
            const loc = validLocs[vi]
            const cfg = TYPE_CONFIG[loc.type] || TYPE_CONFIG.city
            const svgHtml = cfg.svg(cfg.color, cfg.glow)

            // Compute label offset based on proximity to previous markers
            let labelOffsetX = 0, labelOffsetY = 0
            const ptThis = map.latLngToContainerPoint(L.latLng(loc.lat, loc.lon))
            let collisionCount = 0
            for (let pi = 0; pi < vi; pi++) {
                const other = validLocs[pi]
                const ptOther = map.latLngToContainerPoint(L.latLng(other.lat, other.lon))
                const dx = ptThis.x - ptOther.x
                const dy = ptThis.y - ptOther.y
                if (Math.hypot(dx, dy) < PROXIMITY_PX) collisionCount++
            }
            if (collisionCount > 0) {
                const dir = OFFSET_DIRS[(collisionCount - 1) % OFFSET_DIRS.length]
                labelOffsetX = dir[0]
                labelOffsetY = dir[1]
            }

            const labelTransform = (labelOffsetX !== 0 || labelOffsetY !== 0)
                ? `translateX(${labelOffsetX}px) translateY(${labelOffsetY}px)`
                : ""

            const markerClass = loc.type === "target" ? "director-target-marker"
                : loc.type === "base" ? "director-base-marker"
                : "director-marker-enter"
            const iconHtml = `<div style="text-align:center;position:relative;">
              ${svgHtml}
              <div style="font-size:11px;font-weight:600;color:#1a1a1a;text-shadow:0 1px 3px rgba(255,255,255,0.9),0 0 6px rgba(255,255,255,0.7);margin-top:3px;white-space:nowrap;pointer-events:none;${labelTransform ? `transform:${labelTransform};` : ""}">${loc.name}</div>
            </div>`
            const icon = L.divIcon({
                className: `director-location-marker ${markerClass}`,
                html: iconHtml,
                iconSize:   [0, 0],
                iconAnchor: [0, -(cfg.size / 2 + 4)],
            })
            const marker = L.marker([loc.lat, loc.lon], { icon, zIndexOffset: 700, interactive: true })
            if (loc.description) {
                marker.bindPopup(
                    `<div class="director-location-popup-content"><div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:6px;">${loc.name}</div><div style="font-size:12px;color:rgba(255,255,255,0.75);line-height:1.5;">${loc.description}</div></div>`,
                    { className: "director-location-popup", maxWidth: 260 }
                )
            }
            marker.addTo(map)
            dirPlacedLocationsRef.current.push(marker)
        }

        return () => {
            dirPlacedLocationsRef.current.forEach(m => { try { map.removeLayer(m) } catch (_) {} })
            dirPlacedLocationsRef.current = []
        }
    }, [isDirectorMode, dirPlacedLocations])  // eslint-disable-line react-hooks/exhaustive-deps

    // ── News conflicts: fetch all markers globally, refresh every 15 min ─────────
    // Also fetches when isDirectorMode is true so Director show_event works
    useEffect(() => {
        if ((!effectiveActive.newsConflicts && !isDirectorMode) || !viewportBounds) {
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
                const deduped = combined.filter((m) => {
                    const key = m.url || `${m.headline}_${m.lat.toFixed(4)}_${m.lon.toFixed(4)}`
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                })

                console.info("[news-conflicts/fetch]", { count: deduped.length })
                setNewsConflictsData(prev => {
                    const existingKeys = new Set(prev.map(m =>
                        m.url || `${m.headline}_${(m.lat || 0).toFixed(3)}_${(m.lon || 0).toFixed(3)}`
                    ))
                    const brandNew = deduped.filter(m => {
                        const key = m.url || `${m.headline}_${(m.lat || 0).toFixed(3)}_${(m.lon || 0).toFixed(3)}`
                        return !existingKeys.has(key)
                    })
                    if (brandNew.length > 0 && prev.length > 0) {
                        const hasCritical = brandNew.some(m => m.severity_tier === "critical")
                        const hasSignificant = brandNew.some(m => m.severity_tier === "significant")
                        const topRegion = brandNew[0]?.location?.split(",").slice(-1)[0]?.trim() || "region"
                        window.dispatchEvent(new CustomEvent("akili:new-events", {
                            detail: {
                                count: brandNew.length,
                                severity: hasCritical ? "critical" : hasSignificant ? "significant" : "elevated",
                                region: topRegion,
                                items: brandNew.slice(0, 3),
                            },
                        }))
                    }
                    const combined = [...prev, ...brandNew]
                    if (combined.length > 200) {
                        combined.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0))
                        return combined.slice(0, 200)
                    }
                    return combined
                })
                setNewsConflictsCount(deduped.length)
            } catch {
                // keep existing markers on fetch error
            }
        }
        fetchAll()
        const iv = setInterval(fetchAll, 30 * 1000)
        return () => clearInterval(iv)
    }, [effectiveActive.newsConflicts, isDirectorMode, viewportBounds, zoom])

    // ── Unified Intelligence Feed — two-phase: fast preload then full set ────────
    useEffect(() => {
        if (!effectiveActive.unifiedEvents) {
            setUnifiedEvents([])
            setUnifiedEventsCount(0)
            return
        }
        let cancelled = false

        // Phase 1: fetch top 50 raw events immediately — shows markers within ~1s
        const fetchPreload = async () => {
            try {
                const res = await fetch(`${API}/api/v2/events?mode=events&max_age_hours=72&limit=50`)
                const data = await res.json()
                if (cancelled) return
                const events = data.events || []
                if (events.length > 0) setUnifiedEvents(events)
            } catch { /* ignore — full fetch will recover */ }
        }

        // Phase 2: fetch full threaded dataset, replaces preload
        const fetchFull = async (isRefresh = false) => {
            try {
                const b = viewportBoundsRef.current
                const bboxQ = b ? `&south=${b.south.toFixed(4)}&north=${b.north.toFixed(4)}&west=${b.west.toFixed(4)}&east=${b.east.toFixed(4)}` : ""
                const res = await fetch(`${API}/api/v2/events?mode=threads&max_age_hours=72&limit=10000${bboxQ}`)
                const data = await res.json()
                if (cancelled) return
                const threads = data.events || []
                setUnifiedEvents(prev => {
                    if (isRefresh && prev.length > 0) {
                        const prevIds = new Set(prev.map(t => t.thread_id || t.id))
                        const brandNew = threads.filter(t => !prevIds.has(t.thread_id || t.id))
                        if (brandNew.length > 0) {
                            const hasCritical = brandNew.some(t => t.severity_tier === "critical")
                            window.dispatchEvent(new CustomEvent("akili:new-events", {
                                detail: {
                                    count: brandNew.length,
                                    severity: hasCritical ? "critical" : "significant",
                                    region: brandNew[0]?.location || "region",
                                    items: brandNew.slice(0, 3),
                                },
                            }))
                        }
                    }
                    return threads
                })
                setUnifiedEventsCount(threads.length)
            } catch (e) {
                console.error("[unified-events] fetch error:", e)
            }
        }

        fetchPreload()
        fetchFull(false)
        const iv = setInterval(() => fetchFull(true), 30 * 1000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [effectiveActive.unifiedEvents])

    // ── Pipeline lines — use hardcoded dataset (remote GOPIT sources are dead) ──
    useEffect(() => {
        if (effectiveActive.pipelines) setPipelineGeoData(_HARDCODED_PIPELINES)
        else setPipelineGeoData([])
    }, [effectiveActive.pipelines])

    // ── Unified events render — imperative Leaflet layerGroup ─────────────────
    useEffect(() => {
        if (!mapRef.current) return
        if (!unifiedLayerRef.current) {
            unifiedLayerRef.current = L.layerGroup()
        }
        unifiedLayerRef.current.clearLayers()
        if (!effectiveActive.unifiedEvents || filteredUnifiedEvents.length === 0) {
            unifiedLayerRef.current.remove()
            return
        }
        const _TYPE_COLORS = {
            missile: "#ef4444", airstrike: "#ef4444", explosion: "#f97316",
            armed_clash: "#f97316", fight: "#f97316", assault: "#f97316",
            maritime: "#3b82f6", protest: "#eab308", earthquake: "#a855f7",
            fire: "#f97316", assassination: "#ef4444", coerce: "#eab308",
            general: "#64748b",
        }
        filteredUnifiedEvents.forEach(thread => {
            if (!thread.lat || !thread.lon) return
            const icon = makeEventMarkerIcon({
                type: thread.event_type || "general",
                color: _TYPE_COLORS[(thread.event_type || "").toLowerCase()] || "#64748b",
                significance_score: thread.significance_score,
            }, true)
            const marker = L.marker([thread.lat, thread.lon], { icon })
            marker.on("click", (ev) => {
                L.DomEvent.stopPropagation(ev)
                setSelectedCountry(null)
                setSelectedCountryFeature(null)
                setCountryData(null)
                setSelectedEvent({
                    ...thread,
                    headline: thread.clean_title || thread.headline,
                    published_at: thread.latest_event,
                    published: thread.latest_event,
                    type: thread.event_type,
                    context: thread.body || thread.summary || "",
                    confidence: thread.corroboration_count > 3 ? 0.9 : thread.corroboration_count > 1 ? 0.7 : 0.5,
                    num_sources: (thread.sources || []).length,
                    source_name: (thread.sources || []).join(", "),
                    auto_brief: null,
                })
                if (mapRef.current && thread.lat && thread.lon) {
                    const targetZoom = Math.max(mapRef.current.getZoom(), 8)
                    mapRef.current.flyTo([thread.lat, thread.lon], targetZoom, { duration: 1.5, easeLinearity: 0.3 })
                }
            })
            unifiedLayerRef.current.addLayer(marker)
        })
        unifiedLayerRef.current.addTo(mapRef.current)
    }, [filteredUnifiedEvents, effectiveActive.unifiedEvents])

    // ── Global carrier layer — visibility follows AIS toggle ─────────────────
    // Re-renders on viewport change so distant carriers (and their range rings)
    // are culled when zoomed in. At global zoom the viewport is large enough
    // that nearly all carriers pass the check anyway.
    useEffect(() => {
        const depLayer = depLayerRef.current
        if (!effectiveActive.aisVessels) {
            if (depLayer) { depLayer.remove(); depLayer.clearLayers() }
            setDeploymentsData(null)
            return
        }
        if (!depLayerRef.current || !mapRef.current) return

        setDeploymentsData(_CSG_HARDCODED_DATA)
        const layer = depLayerRef.current
        layer.clearLayers()

        // Viewport bounds for culling — extend by largest range ring (~16.7° for 1852 km)
        const vb = viewportBoundsRef.current
        const MAX_RING_DEG = 17  // 1,852,000 m ÷ 111,000 m/deg ≈ 16.7°

        _CSG_HARDCODED_DATA.forEach(carrier => {
            if (!carrier.lat || !carrier.lon) return

            // Viewport cull: skip carrier if its position + largest ring can't reach the viewport
            if (vb) {
                const inRange = (
                    carrier.lat >= vb.south - MAX_RING_DEG &&
                    carrier.lat <= vb.north + MAX_RING_DEG &&
                    carrier.lon >= vb.west  - MAX_RING_DEG &&
                    carrier.lon <= vb.east  + MAX_RING_DEG
                )
                if (!inRange) return
            }

            const color   = _CARRIER_COUNTRY_COLORS[carrier.country] || "#3b82f6"
            const escorts = Array.isArray(carrier.escorts) ? carrier.escorts : []
            const isDeployed = carrier.status === "DEPLOYED" || carrier.status === "OPERATIONAL"
            const isRefit    = carrier.status === "REFIT"
            const iconOpacity = isRefit ? 0.28 : isDeployed ? 1 : 0.5

            // ── Concentric range rings (deployed only) ────────────────────────
            if (isDeployed) {
                const [r, g, b] = _hexToRgb(color)
                const combatR   = _CARRIER_COMBAT_RADIUS_M[carrier.country] || _CARRIER_COMBAT_RADIUS_M.default

                // Ring 1 — Aircraft combat radius (pulsing)
                const ring1 = L.circle([carrier.lat, carrier.lon], {
                    radius:      combatR,
                    color:       `rgba(${r},${g},${b},0.3)`,
                    weight:      1, dashArray: "8 6",
                    fillColor:   `rgba(${r},${g},${b},0.04)`,
                    fillOpacity: 0.04,
                    className:   "csg-radius-ring",
                    interactive: true,
                })
                ring1.bindTooltip("Aircraft Combat Radius", { direction: "top", className: "country-tooltip" })
                ring1.on("click", () => setSelectedDeployment({ ...carrier }))
                layer.addLayer(ring1)

                // Ring 2 — Cruise missile range
                const ring2 = L.circle([carrier.lat, carrier.lon], {
                    radius:      1668000,
                    color:       `rgba(${r},${g},${b},0.18)`,
                    weight:      1, dashArray: "3 7",
                    fillOpacity: 0,
                    interactive: true,
                })
                ring2.bindTooltip("Cruise Missile Range (~900 nm)", { direction: "top", className: "country-tooltip" })
                ring2.on("click", () => setSelectedDeployment({ ...carrier }))
                layer.addLayer(ring2)

                // Ring 3 — Extended air-ops range
                const ring3 = L.circle([carrier.lat, carrier.lon], {
                    radius:      1852000,
                    color:       `rgba(${r},${g},${b},0.08)`,
                    weight:      1,
                    fillOpacity: 0,
                    interactive: true,
                })
                ring3.bindTooltip("Extended Air Ops (~1,000 nm)", { direction: "top", className: "country-tooltip" })
                ring3.on("click", () => setSelectedDeployment({ ...carrier }))
                layer.addLayer(ring3)
            }

            // ── Carrier / LHD marker ─────────────────────────────────────────
            const carrierMarker = L.marker([carrier.lat, carrier.lon], {
                icon: makeCarrierAisIcon(carrier.heading, color, iconOpacity),
            })
            carrierMarker.bindTooltip(`${carrier.flag || ""} ${carrier.flagship}`, { direction: "top", className: "country-tooltip" })
            carrierMarker.on("click", () => setSelectedDeployment({ ...carrier }))
            layer.addLayer(carrierMarker)

            // ── Escort formation around deployed carriers ─────────────────────
            if (isDeployed && escorts.length > 0) {
                const n      = escorts.length
                const radDeg = 0.1
                const cosLat = Math.cos(carrier.lat * Math.PI / 180)
                escorts.forEach((escort, i) => {
                    const angle    = (i / n) * 2 * Math.PI
                    const escLat   = carrier.lat + Math.cos(angle) * radDeg
                    const escLon   = carrier.lon + Math.sin(angle) * radDeg / cosLat
                    const escHdg   = ((90 - angle * 180 / Math.PI) % 360 + 360) % 360
                    const escName  = typeof escort === "string" ? escort : `${escort.name}${escort.hull ? " (" + escort.hull + ")" : ""}`
                    const escMarker = L.marker([escLat, escLon], { icon: makeEscortAisIcon(escHdg, color) })
                    escMarker.bindTooltip(escName, { direction: "top", className: "country-tooltip" })
                    escMarker.on("click", () => setSelectedDeployment({ ...carrier }))
                    layer.addLayer(escMarker)
                })
            }
        })

        layer.addTo(mapRef.current)
    }, [effectiveActive.aisVessels, viewportBounds])  // eslint-disable-line react-hooks/exhaustive-deps

    // Shipping lanes use hardcoded _SHIPPING_ROUTES_HARDCODED constant — no fetch needed

    // ── User Locations layer (superadmin only) ────────────────────────────────
    useEffect(() => {
        const isSuperAdmin = currentUser?.is_super_admin || currentUser?.role === "superadmin"
        console.log("[user-locations] toggle:", { active: effectiveActive.userLocations, isSuperAdmin, currentUser: currentUser?.email })
        if (!effectiveActive.userLocations || !isSuperAdmin) {
            setUserLocationsData([])
            return
        }
        let cancelled = false
        const load = async () => {
            try {
                const res = await fetch(`${API}/api/admin/user-locations`, {
                    headers: { Authorization: "Bearer " + localStorage.getItem("hw-auth-token") }
                })
                console.log("[user-locations] fetch status:", res.status)
                if (!res.ok) return
                const data = await res.json()
                console.log("[user-locations] fetched:", data)
                if (!cancelled) setUserLocationsData(Array.isArray(data) ? data : [])
            } catch (e) { console.error("[user-locations] fetch error:", e) }
        }
        load()
        const iv = setInterval(load, 30000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [effectiveActive.userLocations, currentUser])

    useEffect(() => {
        console.log("[user-locations] render effect:", { mapReady: !!mapRef.current, count: userLocationsData.length, active: effectiveActive.userLocations })
        if (!mapRef.current) return
        if (!userLocationsLayerRef.current) {
            userLocationsLayerRef.current = L.layerGroup()
        }
        userLocationsLayerRef.current.clearLayers()
        if (!effectiveActive.userLocations || userLocationsData.length === 0) {
            userLocationsLayerRef.current.remove()
            return
        }
        const isSA = currentUser?.is_super_admin || currentUser?.role === "superadmin"
        userLocationsData.forEach(u => {
            if (typeof u.lat !== "number" || typeof u.lon !== "number" || isNaN(u.lat) || isNaN(u.lon)) {
                console.warn("[user-locations] skipping invalid coords for", u.email, u)
                return
            }
            const isMe = u.user_id === currentUser?.id
            let color, pulse, size
            if (isMe) {
                color = "#3b82f6"; pulse = "hw-pulse-blue 2s ease-in-out infinite"; size = 40
            } else if (u.is_live) {
                color = "#22c55e"; pulse = "none"; size = 32
            } else {
                color = "#f97316"; pulse = "hw-pulse-orange 2.5s ease-in-out infinite"; size = 32
            }
            const border = isMe ? 3 : 2
            const html = `<div style="width:${size}px;height:${size}px;background:rgba(15,23,42,0.92);border:${border}px solid ${color};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px ${color}66;animation:${pulse};font-size:${isMe ? 18 : 14}px;">&#128100;</div>`
            const icon = L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size/2, size/2] })
            const marker = L.marker([u.lat, u.lon], { icon })
            const statusLabel = u.is_live ? `<span style="color:#22c55e;">Live</span>` : `<span style="color:#f97316;">${u.age_minutes}m ago</span>`
            const trackBtn = isSA && !isMe
                ? `<button onclick="window.__akiliShowTrack('${u.user_id}')" style="margin-top:6px;width:100%;padding:4px 0;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.3);border-radius:4px;color:#38bdf8;font-size:10px;cursor:pointer;font-family:Inter,sans-serif;">Show track</button>` +
                  `<button onclick="window.__akiliLinkPOI('${u.user_id}')" style="margin-top:4px;width:100%;padding:4px 0;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:4px;color:#a78bfa;font-size:10px;cursor:pointer;font-family:Inter,sans-serif;">Link to POI</button>`
                : ""
            marker.bindPopup(
                `<div style="background:rgba(15,23,42,0.98);padding:10px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);font-family:Inter,sans-serif;min-width:140px;">` +
                `<div style="font-weight:700;font-size:12px;color:#e2e8f0;">${u.name}${isMe ? " <span style='color:#3b82f6;font-size:9px;'>(you)</span>" : ""}</div>` +
                `<div style="font-size:10px;color:#64748b;margin-top:2px;">${u.role}</div>` +
                `<div style="font-size:10px;margin-top:4px;">${statusLabel}</div>` +
                trackBtn +
                `</div>`,
                { className: "hw-user-popup", maxWidth: 200 }
            )
            userLocationsLayerRef.current.addLayer(marker)
        })
        userLocationsLayerRef.current.addTo(mapRef.current)
    }, [userLocationsData, effectiveActive.userLocations, currentUser])

    // ── User track polyline ───────────────────────────────────────────────────
    // Expose globals for popup button onclick handlers
    useEffect(() => {
        window.__akiliShowTrack = (userId) => setUserTrackUserId(userId)
        window.__akiliLinkPOI = async (userId) => {
            if (!poiData.length) {
                alert("No POI profiles loaded. Enable the POI layer first.")
                return
            }
            const names = poiData.map((p, i) => `${i + 1}. ${p.name || p.id}`).join("\n")
            const input = prompt(`Link user to POI:\n${names}\n\nEnter number:`)
            if (!input) return
            const idx = parseInt(input, 10) - 1
            const poi = poiData[idx]
            if (!poi) return
            try {
                await fetch(`${API}/api/admin/user/${userId}/link-poi`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("hw-auth-token") },
                    body: JSON.stringify({ poi_id: poi.id }),
                })
                // Refresh markers so tooltip updates
                setUserLocationsData(d => [...d])
            } catch { /* ignore */ }
        }
        return () => { delete window.__akiliShowTrack; delete window.__akiliLinkPOI }
    }, [poiData])

    useEffect(() => {
        if (!userTrackUserId) return
        fetch(`${API}/api/admin/user-track/${userTrackUserId}`, {
            headers: { Authorization: "Bearer " + localStorage.getItem("hw-auth-token") }
        })
            .then(r => r.ok ? r.json() : [])
            .then(d => setUserTrackData(Array.isArray(d) ? d : []))
            .catch(() => setUserTrackData([]))
    }, [userTrackUserId])

    useEffect(() => {
        // Clean up previous track
        if (userTrackLayerRef.current) {
            userTrackLayerRef.current.remove()
            userTrackLayerRef.current = null
        }
        if (!mapRef.current || userTrackData.length < 2) return
        const group = L.layerGroup()
        const coords = userTrackData.map(p => [p.lat, p.lon])
        L.polyline(coords, { color: "#3b82f6", weight: 2.5, opacity: 0.7, dashArray: "8 5" }).addTo(group)
        userTrackData.forEach((pt, i) => {
            const opacity = 0.25 + (i / userTrackData.length) * 0.75
            L.circleMarker([pt.lat, pt.lon], {
                radius: 3.5, fillColor: "#3b82f6", fillOpacity: opacity, stroke: false,
            })
            .bindTooltip(new Date(pt.timestamp).toLocaleString("en-GB", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }), { className: "" })
            .addTo(group)
        })
        group.addTo(mapRef.current)
        userTrackLayerRef.current = group
        return () => { group.remove() }
    }, [userTrackData])

    // ── POI layer: fetch all profiles when layer toggled on ───────────────────
    useEffect(() => {
        if (!effectiveActive.poi) {
            setPoiData([])
            return
        }
        fetch(`${API}/api/poi`)
            .then(r => r.json())
            .then(d => setPoiData(Array.isArray(d) ? d.filter(p => p.lat && p.lon) : []))
            .catch(() => {})
    }, [effectiveActive.poi])

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
                    heatmap: effectiveActive.heatmap,
                    newsConflicts: effectiveActive.newsConflicts,
                }
                setActive(a => ({ ...a, heatmap: false, newsConflicts: false }))
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

    // ── Auto-start / stop ADS-B polling with layer toggle ────────────────────
    useEffect(() => {
        if (effectiveActive.adsb) {
            setAdsbRefreshRate(adsbSliderVal || 15)
            setAdsbActivateKey(k => k + 1)
            setAdsbLive(true)
        } else {
            setAdsbLive(false)
        }
    }, [effectiveActive.adsb])  // eslint-disable-line react-hooks/exhaustive-deps

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

    // When active situation changes, clear events and fly to theater if present
    useEffect(() => {
        if (!activeSituation?.id) return
        setUnifiedEvents([])
        if (mapRef.current && Array.isArray(activeSituation.theater) && activeSituation.theater.length >= 3) {
            try {
                const lats = activeSituation.theater.map(p => p[0])
                const lons = activeSituation.theater.map(p => p[1])
                mapRef.current.flyToBounds(
                    [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
                    { duration: 1.5, padding: [40, 40] }
                )
            } catch { /* ignore */ }
        }
    }, [activeSituation?.id])

    // Panel mutual exclusion — when map opens a fixed panel, close external right panel
    useEffect(() => {
        if (selectedEvent || selectedCountry) onPanelOpen?.()
    }, [selectedEvent, selectedCountry])  // eslint-disable-line react-hooks/exhaustive-deps

    // Panel mutual exclusion — when external right panel opens, close map's fixed panels
    useEffect(() => {
        if (externalPanelOpen) {
            setSelectedEvent(null)
            setSelectedCountry(null)
            setSelectedCountryFeature(null)
            setCountryData(null)
        }
    }, [externalPanelOpen])  // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!effectiveActive.sattrack) {
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
    }, [effectiveActive.sattrack])

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
            if (id === "sentinel2" && !next) {
                onSentinel2Exit?.()
            }
            // User interaction always wins over contextual auto-activation.
            manualLayerOverridesRef.current[id] = next
            delete autoActivatedRef.current[id]
            setManualOverrides({ ...manualLayerOverridesRef.current })
            const nextActive = { ...a, [id]: next }
            return nextActive
        })
    }, [onSentinel2Exit])  // eslint-disable-line

    // Sync sentinel2Active prop (from mobile nav) into internal layer state
    useEffect(() => {
        setActive(a => ({ ...a, sentinel2: sentinel2Active }))
    }, [sentinel2Active])

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
        const ev = selectedSurface || impactEvent || selected
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
    }, [selectedSurface, surfaceEnrichment, impactEvent, selected])  // eslint-disable-line react-hooks/exhaustive-deps

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
        !effectiveActive.missileAlerts
            ? []
            : surveillanceAlerts.filter(item =>
                ["missile_warning", "missile_alert", "rocket_alert"].includes(item?.type) ||
                ["missile_warning", "missile_alert", "rocket_alert"].includes(item?.event_type)
            )
    ), [effectiveActive.missileAlerts, surveillanceAlerts])

    const earthquakeAlertItems = useMemo(() => (
        !effectiveActive.earthquakeEvents
            ? []
            : surveillanceAlerts.filter(item =>
                item?.type === "earthquake" || item?.event_type === "earthquake"
            )
    ), [effectiveActive.earthquakeEvents, surveillanceAlerts])

    const piracyAlertItems = useMemo(() => {
        if (!effectiveActive.imbPiracy) return []
        return [...newsConflictsData].filter(isPiracySignal)
    }, [effectiveActive.imbPiracy, newsConflictsData, isPiracySignal])

    const visibleSurfaceItems = useMemo(() => (
        (surfaceItems || []).filter(item => pointInBounds(item, viewportBounds))
    ), [surfaceItems, viewportBounds])

    const signalSurfaceItems = useMemo(() => {
        if (!effectiveActive.heatmap) return []
        const merged = [
            ...visibleSurfaceItems,
            ...(effectiveActive.newsConflicts ? newsConflictsData : []),
            ...missileAlertItems,
            ...earthquakeAlertItems,
            ...piracyAlertItems,
        ]
        const seen = new Set()
        const hasRegionFilter = focusRegions.length > 0 && !focusRegions.includes("Global")
        return merged.filter((item, index) => {
            const lat = Number(item?.lat)
            const lon = Number(item?.lon ?? item?.lng)
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
            const key = item?.id || item?.url || `${lat.toFixed(3)}_${lon.toFixed(3)}_${item?.headline || item?.title || index}`
            if (seen.has(key)) return false
            seen.add(key)
            if (hasRegionFilter) {
                return focusRegions.some(r => {
                    const bbox = REGION_BBOXES[r]
                    if (!bbox) return false
                    return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east
                })
            }
            return true
        })
    }, [effectiveActive.heatmap, effectiveActive.newsConflicts, visibleSurfaceItems, newsConflictsData, missileAlertItems, earthquakeAlertItems, piracyAlertItems, focusRegions])

    const clusterMarkers = useMemo(() => {
        const clickableItems = visibleSurfaceItems.filter(item => item.source_type !== "conflict_zone")
        if (zoom > 8 || !clickableItems.length) return null
        const clusters = clusterSurfaceItems(clickableItems, 30)
        return clusters.map((c, i) => (
            <Marker
                key={`cluster-${i}-z${zoom}`}
                position={[c.lat, c.lon]}
                pane="event-icons"
                icon={c.count === 1 ? makeSurfaceIcon(c.items[0]) : makeClusterIcon(c)}
                eventHandlers={{
                    click: (e) => {
                        L.DomEvent.stopPropagation(e)
                        if (mapRef.current) {
                            mapRef.current.setView([c.lat, c.lon], mapRef.current.getZoom() + 3, { animate: true, duration: 0.5 })
                        }
                    },
                }}
            />
        ))
    }, [visibleSurfaceItems, zoom, onSurfaceItemClick])

    const individualMarkers = useMemo(() => {
        // Exclude GDELT zone items — non-interactive, shown via SignalSurfaceLayer
        const clickableItems = visibleSurfaceItems.filter(item => item.source !== "gdelt" && item.source_type !== "conflict_zone")
        if (zoom < 9 || !clickableItems.length) return null
        return clickableItems.map(item => (
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


    // Viewport filter helper for marker useMemos — 25% buffer around visible bounds
    const vpFilter = useCallback((lat, lon) => {
        if (!viewportBounds) return true
        const { north, south, east, west } = viewportBounds
        const latBuf = (north - south) * 0.25
        const lonBuf = (east - west) * 0.25
        return lat >= south - latBuf && lat <= north + latBuf &&
               lon >= west  - lonBuf && lon <= east  + lonBuf
    }, [viewportBounds])

    const osmInfraMarkers = useMemo(() => (
        Object.entries(infraData).flatMap(([category, features]) => (
            (features || []).map((feature, i) => {
                const pos = featureLatLon(feature)
                if (!pos || !vpFilter(pos[0], pos[1])) return null
                const props = feature.properties || {}
                return (
                    <Marker
                        key={`infra-${category}-${props.id || props.name || i}`}
                        position={pos}
                        pane="infra-icons"
                        icon={makeInfraIcon(category, props.name || props.operator || category)}
                        eventHandlers={{ click: () => { setInfraSelected({ feature, category }); setDsSelected(null); setImpactEvent(null) } }}
                    >
                        <Tooltip direction="top" offset={[0, -14]}>
                            <span style={{ fontSize: 10 }}>{props.name || props.operator || INFRA_CATS[category]?.label || category}</span>
                        </Tooltip>
                    </Marker>
                )
            })
        ))
    ), [infraData, vpFilter])

    const airportMarkers = useMemo(() => (
        !effectiveActive.airports || !dsActive.airport ? null : dsData.airport.filter(item => vpFilter(item.lat, item.lon)).map((item, i) => (
            <Marker
                key={`ap-${item.icao || i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makeAirportIcon(item.name)}
                eventHandlers={{ click: () => { setDsSelected({ ...item, _id: `ap-${i}` }); setInfraSelected(null); setImpactEvent(null) } }}
            >
                <Tooltip direction="top" offset={[0, -14]}>
                    <span style={{ fontSize: 10 }}>{item.icao} · {item.name}</span>
                </Tooltip>
            </Marker>
        ))
    ), [effectiveActive.airports, dsActive.airport, dsData.airport, vpFilter])

    const portMarkers = useMemo(() => (
        !effectiveActive.ports ? null : portsData.filter(item => vpFilter(item.lat, item.lon)).slice(0, 300).map((item, i) => (
            <Marker
                key={`pt-${item.name || i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makePortIcon(item.name)}
                eventHandlers={{ click: () => { setPortSelected({ ...item, _id: `pt-${i}` }); setDsSelected(null); setInfraSelected(null); setImpactEvent(null) } }}
            >
                <Tooltip direction="top" offset={[0, -12]}>
                    <span style={{ fontSize: 10 }}>{item.name}{item.country ? ` · ${item.country}` : ""}</span>
                </Tooltip>
            </Marker>
        ))
    ), [effectiveActive.ports, portsData, vpFilter])

    const powerPlantMarkers = useMemo(() => (
        !effectiveActive.powerPlants || !dsActive.power ? null : dsData.power.filter(item => vpFilter(item.lat, item.lon)).map((item, i) => (
            <Marker
                key={`pw-${item.name || i}`}
                position={[item.lat, item.lon]}
                pane="infra-icons"
                icon={makePowerIcon(item.name, item.primary_fuel)}
                eventHandlers={{ click: () => { setDsSelected({ ...item, _id: `pw-${i}` }); setInfraSelected(null); setImpactEvent(null) } }}
            >
                <Tooltip direction="top" offset={[0, -14]}>
                    <span style={{ fontSize: 10 }}>{item.name} · {item.primary_fuel}{item.capacity_mw ? ` · ${item.capacity_mw}MW` : ""}</span>
                </Tooltip>
            </Marker>
        ))
    ), [effectiveActive.powerPlants, dsActive.power, dsData.power, vpFilter])

    return (
        <div
            ref={mapContainerRef}
            className={[effectiveActive.route ? "akili-route-active" : "", effectiveActive.annotate && annotationMode ? "akili-annotate-active" : "", theaterDrawing ? "akili-theater-active" : ""].filter(Boolean).join(" ")}
            style={{ height: "100%", display: "flex", width: "100%", animation: "mapFadeIn 300ms ease forwards" }}
        >
            <style>{MAP_STYLES}</style>

            {/* SVG pattern defs for chokepoint hatching — must be in DOM before map renders */}
            <ChokepointPatternDefs />

            {/* Map area — flex:1, all overlays position relative to this */}
            <div style={{ flex: 1, minWidth: 0, position: "relative", height: "100%" }}>

            <MapContainer
                center={[20, 0]}
                zoom={2}
                style={{ height: "100%", width: "100%" }}
                zoomControl={true}
                preferCanvas={true}
                worldCopyJump={false}
                maxBounds={[[-90, -180], [90, 180]]}
                maxBoundsViscosity={1.0}
                minZoom={2}
                maxZoom={19}
                zoomAnimation={true}
                fadeAnimation={true}
                markerZoomAnimation={true}
                inertia={true}
            >
                <MapPaneSetup />
                <MapInstanceTracker mapRef={mapRef} depLayerRef={depLayerRef} onMapReady={onMapReady} />
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
                {mapType === "satellite" && effectiveActive.cityLabels && (
                    <TileLayer
                        key="sat-labels"
                        url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
                        pane="overlayPane"
                        zIndex={650}
                        opacity={0.9}
                    />
                )}
                <ZoomTracker onZoom={(z) => { setZoom(z); setShowEventLabels(z >= 9) }} />
                <BoundsTracker onUpdate={setViewportBounds} onViewportChange={onViewportChange} />
                <InfrastructureLayer
                    enabled={effectiveActive.oim}
                    powerEnabled={effectiveActive.oimPower !== false}
                    telecomsEnabled={effectiveActive.oimTelecoms !== false}
                    petroleumEnabled={effectiveActive.oimPetroleum !== false}
                    waterEnabled={effectiveActive.oimWater !== false}
                />
                <FlyTo event={selected} />
                <UserLocationMarker />
                {/* Surface pool — operational signal surface beneath existing icons */}
                {effectiveActive.heatmap && <SignalSurfaceLayer items={signalSurfaceItems} zoom={zoom} />}
                {!effectiveActive.unifiedEvents && clusterMarkers}
                {!effectiveActive.unifiedEvents && individualMarkers}
                {surveillanceMarkers}
                {/* Severity radius circle + contextual overlays */}
                {severityCircle}
                {surfaceContextElements}
                {surfaceEnrichmentElements}
                <MapClickHandler
                    enabled={effectiveActive.route}
                    origin={routeOrigin}
                    onOrigin={setRouteOrigin}
                    onDest={setRouteDest}
                />
                {/* Area click — fires at zoom ≤ 7 when not in route/annotation/theater mode */}
                <AreaClickHandler
                    enabled={!effectiveActive.route && !annotationMode && !theaterDrawing && zoom <= 7}
                    onAreaClick={handleAreaClick}
                />

                {/* ── Country click — map-level PIP detection ───────────────── */}
                {/* Suppressed during Overwatch/Sentinel draw mode so pointer events go to draw tool */}
                {!overwatchActive && !effectiveActive.sentinel2 && <CountryClickHandler
                    countriesGeo={allCountriesGeo}
                    onCountryClick={(feature, name) => {
                        setSelectedEvent(null)
                        setSelectedCountry(name)
                        setSelectedCountryFeature(feature)
                        setAreaPopup(null)
                        setInfraSelected(null)
                        setImpactEvent(null)
                        try { ctxActivateCountry([feature]) } catch { /* ignore */ }
                    }}
                    onNoCountry={() => {
                        if (selectedCountry) {
                            setSelectedCountry(null)
                            setSelectedCountryFeature(null)
                        }
                    }}
                />}
                {/* ── Selected country golden glow highlight ─────────────────── */}
                {selectedCountryFeature && (
                    <GeoJSON
                        key={`country-glow-${selectedCountry}`}
                        pane="context-polygons"
                        data={selectedCountryFeature}
                        style={{
                            weight:       2.5,
                            color:        "#f5c518",
                            opacity:      0.9,
                            fillColor:    "#f5c518",
                            fillOpacity:  0.12,
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


                {/* ── Profile focus EEZ baseline (situational only) ────────── */}
                {!effectiveActive.eez && profileEezFeatures.map((f, i) => (
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

                {/* ── Country borders rendered imperatively via bordersLayerRef ─ */}

                {/* ── City Labels — custom markers on satellite, built-in on dark/light ─ */}
                {effectiveActive.cityLabels && mapType === "satellite" && zoom >= 4 && MAJOR_CITIES.map(c => (
                    <Marker key={c.name} position={[c.lat, c.lon]} interactive={false}
                        icon={L.divIcon({
                            className:  "",
                            iconAnchor: [0, 6],
                            html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;"><div style="width:4px;height:4px;border-radius:50%;background:#e2e8f0;opacity:0.7;"></div><div style="font:400 9px/1 system-ui,sans-serif;color:#e2e8f0;opacity:0.65;text-shadow:0 1px 3px rgba(0,0,0,0.95);white-space:nowrap;">${c.name}</div></div>`,
                        })}
                    />
                ))}

                {/* ── Global EEZ view — rendered imperatively via eezLayerRef ── */}

                {/* ── Submarine Cable Routes ────────────────────────────────── */}
                {effectiveActive.cables && cableGeo.cables.map(feature => {
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
                {effectiveActive.cables && cableGeo.points.map(feature => {
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
                {effectiveActive.pipelines && pipelineGeoData.map((f, fi) => {
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

                {/* Shipping lanes rendered imperatively via useEffect + shippingLanesLayerRef */}

                {/* ── Deployments layer — managed via vanilla Leaflet in useEffect above ── */}

                {/* ── ADS-B Aircraft ────────────────────────────────────────── */}
                {/* Isolated child: aircraft state + polling live in AircraftLayer
                    so setAircraft() ticks don't re-render MapPage or conflict markers. */}
                <AircraftLayer
                    visible={effectiveActive.adsb}
                    showLabels={effectiveActive.adsbLabels}
                    refreshRate={adsbRefreshRate}
                    boundsRef={viewportBoundsRef}
                    onCount={setAdsbCount}
                    polling={adsbLive || (isDirectorMode && !!dirAC?.size)}
                    activateKey={adsbActivateKey}
                    directorAC={isDirectorMode ? dirAC : null}
                    timeTravelTime={timeTravelTime}
                />

                {/* ── Route planner — origin, dest pins + polyline ──────────── */}
                {effectiveActive.route && routeOrigin && (
                    <Marker position={[routeOrigin.lat, routeOrigin.lon]} icon={makePinIcon("#22c55e")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>Origin</span>
                        </Tooltip>
                    </Marker>
                )}
                {effectiveActive.route && routeDest && (
                    <Marker position={[routeDest.lat, routeDest.lon]} icon={makePinIcon("#ef4444")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>Destination</span>
                        </Tooltip>
                    </Marker>
                )}
                {/* Waypoint pins */}
                {effectiveActive.route && waypoints.map((w, i) => (
                    <Marker key={i} position={[w.lat, w.lon]} icon={makePinIcon("#FFD600")}>
                        <Tooltip permanent direction="top" offset={[0, -28]}>
                            <span style={{ fontSize: 10 }}>WP {i + 1}</span>
                        </Tooltip>
                    </Marker>
                ))}
                {effectiveActive.route && routeGeo && (
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
                {(isDirectorMode ? false : effectiveActive.aisVessels) && (() => {
                    const vpVessels = aisVessels.filter(v => v.lat != null && v.lon != null && vpFilter(v.lat, v.lon))
                    const lodVessels = zoom <= 4
                        ? vpVessels.filter(v => (v.ship_type || "").toLowerCase().includes("military") || (v.ship_type || "").toLowerCase().includes("naval"))
                        : zoom <= 6
                            ? vpVessels.filter(v => { const t = (v.ship_type || "").toLowerCase(); return t.includes("military") || t.includes("naval") || t.includes("tanker") || t.includes("cargo") || t.includes("container") })
                            : vpVessels
                    const milVessels = lodVessels.filter(v => { const t = (v.ship_type || "").toLowerCase(); return t.includes("military") || t.includes("naval") })
                    const otherVessels = lodVessels.filter(v => { const t = (v.ship_type || "").toLowerCase(); return !t.includes("military") && !t.includes("naval") })
                    const cappedVessels = lodVessels.length > 500 ? [...milVessels, ...otherVessels].slice(0, 500) : lodVessels
                    return cappedVessels.map((v, i) => (
                        <VesselMarkerItem
                            key={`ais-${v.mmsi || i}`}
                            v={v}
                            zoom={zoom}
                            isSelected={selectedAisVessel?.mmsi === v.mmsi}
                            onSelect={setSelectedAisVessel}
                            onClose={() => setSelectedAisVessel(null)}
                        />
                    ))
                })()}

                {/* ── Director Mode: individual vessel markers ──────────────── */}
                {isDirectorMode && dirVessel && dirVessel.size > 0 && aisVessels.map((v, i) => {
                    const mmsi = String(v.mmsi || "")
                    if (!dirVessel.has(mmsi)) return null
                    if (v.lat == null || v.lon == null) return null
                    return (
                        <VesselMarkerItem
                            key={`dir-ais-${mmsi || i}`}
                            v={v}
                            zoom={zoom}
                            isSelected={selectedAisVessel?.mmsi === v.mmsi}
                            onSelect={setSelectedAisVessel}
                            onClose={() => setSelectedAisVessel(null)}
                        />
                    )
                })}

                {/* ── Chokepoints layer — polygon outlines, toggled via layers panel ── */}
                {!isDirectorMode && !effectiveActive.chokepoints && profileChokepoints.map((cp, i) => {
                    const poly = _cpPoly(cp.name)
                    return (
                        <Fragment key={`profile-cp-${i}`}>
                            {poly ? (
                                <Polygon
                                    positions={poly}
                                    pathOptions={{ fill: false, color: "#0d9488", weight: 1, opacity: 0.24, dashArray: "5 6" }}
                                    interactive={false}
                                />
                            ) : cp.polygon_bounds ? (
                                <Rectangle
                                    bounds={[[cp.polygon_bounds[0], cp.polygon_bounds[1]], [cp.polygon_bounds[2], cp.polygon_bounds[3]]]}
                                    pathOptions={{ fill: false, color: "#0d9488", weight: 1, opacity: 0.24, dashArray: "5 6" }}
                                    interactive={false}
                                />
                            ) : null}
                            {(cp.lat && cp.lon) && (
                                <Marker
                                    position={[cp.lat, cp.lon]}
                                    interactive={false}
                                    icon={L.divIcon({
                                        className: "",
                                        html: `<div style="background:transparent;color:#0d9488;font-size:9px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;opacity:0.55;text-shadow:0 0 4px rgba(0,0,0,0.75);pointer-events:none">${cp.name}</div>`,
                                        iconSize: [120, 14], iconAnchor: [60, 7],
                                    })}
                                />
                            )}
                        </Fragment>
                    )
                })}
                {/* ── Active chokepoints layer — rich hatched polygons from CHOKEPOINTS data ── */}
                {/* Normal mode: all chokepoints when layer is on */}
                {!isDirectorMode && effectiveActive.chokepoints && CHOKEPOINTS.map((cp) => (
                    <ChokepointPolygon
                        key={`cp-${cp.name}`}
                        cp={cp}
                        zoom={zoom}
                        onSelect={setChokepointSelected}
                    />
                ))}
                {/* Director mode: only individually shown chokepoints */}
                {isDirectorMode && dirCp && CHOKEPOINTS.filter(cp => dirCp.has(cp.name)).map((cp) => (
                    <ChokepointPolygon
                        key={`dir-cp-${cp.name}`}
                        cp={cp}
                        zoom={zoom}
                        onSelect={setChokepointSelected}
                    />
                ))}

                {/* ── Director Mode: individual infrastructure markers ───────── */}
                {isDirectorMode && dirInfra && dirInfra.size > 0 && Array.from(dirInfra.entries()).map(([id, item]) => {
                    if (item.lat == null || item.lon == null) return null
                    const infColors = { airport: "#00bcd4", port: "#00e5ff", military: "#ef4444", power_plant: "#ffd600", other: "#ffffff" }
                    const infSymbols = { airport: "✈", port: "⚓", military: "★", power_plant: "⚡", other: "●" }
                    const color  = infColors[item.type] || "#ffffff"
                    const symbol = infSymbols[item.type] || "●"
                    const icon   = L.divIcon({
                        className: "",
                        html: `<div class="director-marker-enter" style="
                            width:24px;height:24px;border-radius:50%;
                            background:${color}22;border:2px solid ${color};
                            display:flex;align-items:center;justify-content:center;
                            font-size:11px;color:${color};
                            box-shadow:0 0 8px ${color}55;
                        ">${symbol}</div>`,
                        iconSize: [24, 24], iconAnchor: [12, 12],
                    })
                    return (
                        <Marker key={`dir-infra-${id}`} position={[item.lat, item.lon]} icon={icon}>
                            <Tooltip direction="top" offset={[0, -14]}>
                                <span style={{ fontSize: 10 }}>{item.name} · {item.type}</span>
                            </Tooltip>
                        </Marker>
                    )
                })}

                {/* ── News conflict markers — click opens EventDetailPanel ─────── */}
                {/* Normal mode: all news conflicts when layer is on */}
                {!isDirectorMode && effectiveActive.newsConflicts && newsConflictsData.map((m, i) => {
                    if (!vpFilter(m.lat, m.lon)) return null
                    const showNewsLabel = zoom >= 7
                    const html = getNewsMarkerHTML(m, showNewsLabel)
                    const sz = m.severity_tier === "critical" ? 32 : (m.severity_tier === "high" || m.severity_tier === "significant") ? 26 : (m.severity_tier === "medium" || m.severity_tier === "elevated") ? 20 : 16
                    const hitSz = sz + 8
                    const icon = L.divIcon({ html, className: "", iconSize: [hitSz, hitSz], iconAnchor: [hitSz / 2, hitSz / 2] })
                    return (
                        <Marker
                            key={i}
                            position={[m.lat, m.lon]}
                            pane="event-icons"
                            icon={icon}
                            eventHandlers={{ click: () => { setSelectedEvent(m); setImpactEvent(null); setInfraSelected(null) } }}
                        >
                            {!showNewsLabel && (
                                <Tooltip direction="top" offset={[0, -10]}>
                                    <span style={{ fontSize: 10 }}>{m.headline?.length > 80 ? m.headline.slice(0, 80) + "…" : m.headline}</span>
                                </Tooltip>
                            )}
                        </Marker>
                    )
                })}

                {/* ── Director Mode: individual event markers ──────────────── */}
                {isDirectorMode && dirEvt && dirEvt.size > 0 && newsConflictsData.map((m, i) => {
                    const eventId = m.id || m.url || ""
                    if (!dirEvt.has(eventId)) return null
                    if (!m.lat || !m.lon) return null
                    const showNewsLabel = zoom >= 7
                    const html = getNewsMarkerHTML(m, showNewsLabel)
                    const sz = m.severity_tier === "critical" ? 32 : (m.severity_tier === "high" || m.severity_tier === "significant") ? 26 : 20
                    const hitSz = sz + 8
                    const icon = L.divIcon({ html: `<div class="director-marker-enter">${html}</div>`, className: "", iconSize: [hitSz, hitSz], iconAnchor: [hitSz / 2, hitSz / 2] })
                    return (
                        <Marker
                            key={`dir-evt-${eventId || i}`}
                            position={[m.lat, m.lon]}
                            pane="event-icons"
                            icon={icon}
                            eventHandlers={{ click: () => { setSelectedEvent(m); setImpactEvent(null); setInfraSelected(null) } }}
                        >
                            <Tooltip direction="top" offset={[0, -10]}>
                                <span style={{ fontSize: 10 }}>{m.headline?.length > 80 ? m.headline.slice(0, 80) + "…" : m.headline}</span>
                            </Tooltip>
                        </Marker>
                    )
                })}

                {/* ── POI profile markers ───────────────────────────────────── */}
                {effectiveActive.poi && poiData.map((poi) => (
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
                {effectiveActive.poi && selectedPoiMarker?.lat && selectedPoiMarker?.lon && (
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
                {effectiveActive.poi && selectedPoiMarker && (selectedPoiMarker.relations || []).map((rel, i) => {
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
                {effectiveActive.poi && selectedPoiMarker?.home_lat && selectedPoiMarker?.home_lon && (
                    <>
                        <Marker position={[selectedPoiMarker.home_lat, selectedPoiMarker.home_lon]} icon={getHomeIcon()}>
                            <Tooltip direction="top" offset={[0, -16]}><span style={{ fontSize: 10 }}>Home{selectedPoiMarker.home_address ? ` — ${selectedPoiMarker.home_address}` : ""}</span></Tooltip>
                        </Marker>
                        {selectedPoiMarker.lat && <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [selectedPoiMarker.home_lat, selectedPoiMarker.home_lon]]} pathOptions={{ color: "#0d9488", weight: 1.5, dashArray: "5 5", opacity: 0.5 }} />}
                    </>
                )}
                {effectiveActive.poi && selectedPoiMarker?.work_lat && selectedPoiMarker?.work_lon && (
                    <>
                        <Marker position={[selectedPoiMarker.work_lat, selectedPoiMarker.work_lon]} icon={getWorkIcon()}>
                            <Tooltip direction="top" offset={[0, -16]}><span style={{ fontSize: 10 }}>Work{selectedPoiMarker.occupation_address ? ` — ${selectedPoiMarker.occupation_address}` : ""}</span></Tooltip>
                        </Marker>
                        {selectedPoiMarker.lat && <Polyline positions={[[selectedPoiMarker.lat, selectedPoiMarker.lon], [selectedPoiMarker.work_lat, selectedPoiMarker.work_lon]]} pathOptions={{ color: "#d97706", weight: 1.5, dashArray: "5 5", opacity: 0.5 }} />}
                    </>
                )}

                {/* ── Temp address marker — cyan design ────────────────────── */}
                {tempMarker && (
                    <>
                        <CircleMarker
                            center={[tempMarker.lat, tempMarker.lon]}
                            radius={18}
                            pathOptions={{ color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.12, weight: 1.2, className: "search-pulse" }}
                            interactive={false}
                        />
                        <Marker
                            position={[tempMarker.lat, tempMarker.lon]}
                            icon={L.divIcon({
                                html: `<div style="width:22px;height:22px;background:rgba(56,189,248,0.92);border:2px solid #38bdf8;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 0 14px rgba(56,189,248,0.7),0 2px 6px rgba(0,0,0,0.5);"><div style="width:7px;height:7px;background:#fff;border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div></div>`,
                                className: "",
                                iconSize:   [22, 22],
                                iconAnchor: [11, 22],
                            })}
                        >
                            <Tooltip permanent direction="top" offset={[0, -26]} className="search-tooltip">
                                {tempMarker.label?.split(",")[0] || "Location"}
                            </Tooltip>
                        </Marker>
                    </>
                )}

                {/* ── Webcam markers ────────────────────────────────────────── */}
                {effectiveActive.webcams && WEBCAM_LOCATIONS.map(cam => (
                    <Marker
                        key={cam.id}
                        position={[cam.lat, cam.lon]}
                        icon={getWebcamIcon()}
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
                {effectiveActive.satellite && satelliteResults.map(tile => {
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
                {effectiveActive.annotate && (
                    <AnnotationMapHandler
                        mode={annotationMode}
                        zoneInProgress={zoneInProgress}
                        onPoint={handleAnnotationPoint}
                        onZoneVertex={handleZoneVertex}
                        onZoneClose={handleZoneClose}
                        onEscape={handleAnnotationEscape}
                    />
                )}
                {effectiveActive.annotate && zoneInProgress.length > 0 && (
                    <>
                        <Polyline positions={zoneInProgress} pathOptions={{ color: "#FFB300", weight: 2, opacity: 0.7, dashArray: "6 4" }} />
                        {zoneInProgress.map((v, i) => (
                            <CircleMarker key={i} center={v} radius={4} pathOptions={{ fillColor: "#FFB300", fillOpacity: 0.85, color: "#fff", weight: 1 }} />
                        ))}
                    </>
                )}

                {/* ── Annotation zones ──────────────────────────────────────── */}
                {effectiveActive.annotate && annotations.zones.map(z => (
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
                {effectiveActive.sattrack && satPositions
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

                {/* ── Sentinel-2 imagery overlay ───────────────────────────── */}
                <SentinelLayer
                    active={effectiveActive.sentinel2 || (isDirectorMode && !!dirSat)}
                    onToggleOff={() => toggle("sentinel2")}
                    onImageLoaded={setSentinelImageData}
                    onImageCleared={() => setSentinelImageData(null)}
                />

                {/* ── Overwatch — satellite ML object detection ────────────── */}
                <OverwatchLayer
                    active={overwatchActive}
                    onExit={onOverwatchExit}
                    sentinelImageData={sentinelImageData}
                    sentinel2Active={effectiveActive.sentinel2}
                    onToggleSentinel2={() => toggle("sentinel2")}
                />

                {/* ── Director Mode highlight markers ───────────────────────── */}
                {directorHighlights.map(h => (
                    <CircleMarker
                        key={h.id}
                        center={[h.lat, h.lon]}
                        radius={h.style === "pulse" ? 20 : 14}
                        className={`director-highlight-${h.style || "ring"}`}
                        pathOptions={{
                            color: "#56cfff",
                            weight: h.style === "ring" ? 3 : 2,
                            fill: false,
                            opacity: 0.85,
                        }}
                    />
                ))}

            </MapContainer>

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
                    {toastInfo.message || `${toastInfo.count} events loaded`}
                </div>
            )}

            {/* ── Country info + news panel ─────────────────────────────────── */}
            {selectedCountry && (
                <div style={isMobile ? {
                    // Mobile: bottom sheet — above BottomNav, does NOT cover TopBar
                    position:             "fixed",
                    left:                 0,
                    right:                0,
                    bottom:               56,
                    top:                  "auto",
                    maxHeight:            "65vh",
                    borderRadius:         "18px 18px 0 0",
                    zIndex:               1150,
                    background:           "rgba(10,14,22,0.98)",
                    backdropFilter:       "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    borderTop:            "1px solid rgba(255,255,255,0.12)",
                    boxShadow:            "0 -8px 40px rgba(0,0,0,0.5)",
                    display:              "flex",
                    flexDirection:        "column",
                    overflow:             "hidden",
                } : {
                    position:  "fixed",
                    top:       40,
                    right:     0,
                    bottom:    0,
                    width:     380,
                    zIndex:    1150,
                    background: "rgba(15,23,42,0.85)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    borderLeft: "1px solid rgba(255,255,255,0.07)",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                }}>
                    <CountryPanel
                        country={selectedCountry}
                        data={countryData}
                        loading={countryLoading}
                        onClose={() => { setSelectedCountry(null); setSelectedCountryFeature(null); setCountryData(null) }}
                    />
                </div>
            )}

            {/* ── EEZ Detail Panel ──────────────────────────────────────────── */}
            {selectedEez && (
                <EEZPanel
                    eez={selectedEez}
                    isMobile={isMobile}
                    onClose={() => {
                        selectedEezRef.current = null
                        setSelectedEez(null)
                        // Reset all EEZ layer styles to default
                        if (eezLayerRef.current) {
                            eezLayerRef.current.eachLayer(l => l.setStyle && l.setStyle({
                                color: "#0d9488", weight: 1.5, opacity: 0.45,
                                fill: true, fillColor: "#0d9488", fillOpacity: 0.04,
                            }))
                        }
                    }}
                />
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

            {/* ── CSG / ARG Detail Panel ───────────────────────────────────── */}
            {selectedDeployment && (
                <CSGPanel
                    csg={selectedDeployment}
                    isMobile={isMobile}
                    onClose={() => setSelectedDeployment(null)}
                />
            )}

            {/* ── Event Detail Panel — slide-in for conflict/news events ─────── */}
            {selectedEvent && (
                <EventDetailPanel
                    event={selectedEvent}
                    onClose={() => setSelectedEvent(null)}
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
            {portSelected && !infraSelected && !dsSelected && (
                <PortPanel
                    item={portSelected}
                    onClose={() => setPortSelected(null)}
                    isMobile={isMobile}
                />
            )}
            {chokepointSelected && !infraSelected && !dsSelected && !portSelected && (
                <ChokepointPanel
                    cp={chokepointSelected}
                    onClose={() => setChokepointSelected(null)}
                    isMobile={isMobile}
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
            {effectiveActive.route && (routeLoading || routeInfo) && (
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
            {effectiveActive.route && (
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
            {effectiveActive.tv && (
                <TVWidget
                    onClose={() => setActive(a => ({ ...a, tv: false }))}
                    containerRef={mapContainerRef}
                />
            )}

            {/* ── Satellite tile info panel ───────────────────────────────────── */}
            {effectiveActive.satellite && satelliteInfoItem && (
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
                            ✓ Copernicus authentication effectiveActive. Overlay uses quicklook imagery in this viewer.
                        </div>
                    ) : (
                        <div style={{ padding: "7px 9px", background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.2)", borderRadius: 6, fontSize: 10, color: "rgba(255,179,0,0.8)", lineHeight: 1.5 }}>
                            ⚠ Public mode fallback. Copernicus authentication unavailable for this search.
                        </div>
                    )}
                </div>
            )}

            {/* ── Annotation toolbar ───────────────────────────────────────── */}
            {effectiveActive.annotate && (
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
            {effectiveActive.sattrack && selectedSat && (
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

            {/* ── Layer Toggle Panel — portalled to body so Cesium compositing can't bury it ── */}
            {layersPanelOpen && createPortal(
                <LayersPanel
                    active={active}
                    onToggle={toggle}
                    infraActive={infraActive}
                    onInfraToggle={toggleInfra}
                    zoom={zoom}
                    onClose={onLayersPanelClose}
                    currentUser={currentUser}
                    sourceStatus={sourceStatus}
                    adsbLive={adsbLive}
                    adsbCount={adsbCount}
                    adsbRefreshRate={adsbRefreshRate}
                    adsbSliderVal={adsbSliderVal}
                    onAdsbSliderChange={setAdsbSliderVal}
                    onAdsbActivate={activateAdsb}
                    onAdsbStop={stopAdsb}
                    adsbLabels={effectiveActive.adsbLabels}
                    onAdsbLabelsToggle={() => toggle("adsbLabels")}
                    routeInfo={routeInfo ? {
                        calculating: routeLoading,
                        distance: routeInfo.distance_km != null ? `${routeInfo.distance_km.toFixed(0)} km` : null,
                        duration: routeInfo.duration_min != null ? `${Math.round(routeInfo.duration_min)} min` : null,
                    } : routeLoading ? { calculating: true } : null}
                    unifiedEventsCount={filteredUnifiedEvents.length}
                    conflictZoneCount={0}
                    conflictZonesLoading={false}
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
                    notificationsEnabled={notificationsEnabled}
                    onNotificationsToggle={toggleNotifications}
                    oimUnavailable={oimUnavailable}
                />,
                document.body
            )}

        {/* ── Live Ticker ──────────────────────────────────────────────────────── */}
        {effectiveActive.liveTicker && (
            <LiveTicker
                events={filteredUnifiedEvents}
                onItemClick={(item) => {
                    setSelectedEvent({
                        ...item,
                        headline:     item.clean_title || item.headline || "",
                        published_at: item.latest_event || item.published || "",
                        published:    item.latest_event || item.published || "",
                        type:         item.event_type || "general",
                        context:      item.body || item.summary || "",
                    })
                    if (mapRef.current && item.lat && item.lon) {
                        const targetZoom = Math.max(mapRef.current.getZoom(), 8)
                        mapRef.current.flyTo([item.lat, item.lon], targetZoom, { duration: 1.5, easeLinearity: 0.3 })
                    }
                }}
            />
        )}

        </div>
    )
}
