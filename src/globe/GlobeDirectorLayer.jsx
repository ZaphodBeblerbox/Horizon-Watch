/**
 * GlobeDirectorLayer — Cesium rendering engine for Director Mode / Demo Briefings.
 *
 * Receives a `scene` object (same format as DemoRunner scenes) and renders all
 * scene_elements as Cesium entities/dataSources. Replaces the old Leaflet
 * rendering path in DemoRunner._renderElement.
 *
 * LAYER LIFECYCLE (mirrors DemoRunner RULE 6):
 *  - sceneLocal: entities added per-scene, removed on scene change
 *  - persistent: ships/troops added to _persistentLayers, survive scenario-within transitions
 *  - Both cleared on scenario change or director stop (scene = null)
 */

import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    GeoJsonDataSource,
    Color,
    Cartesian2,
    Cartesian3,
    HeightReference,
    LabelStyle,
    VerticalOrigin,
    ColorMaterialProperty,
    CallbackProperty,
    PolygonHierarchy,
    Math as CesiumMath,
    Rectangle,
    SceneTransforms,
} from "cesium"
import API_BASE from "../apiBase.js"
import { getMarkerCanvas, AFFILIATION, ENTITY_FUNCTION } from "./markerRenderer.js"
import { ALERT_ICONS } from "../constants/alertIcons.js"

// ── Icon sizes mirror demoIconUtils.js ─────────────────────────────────────────
const ICON_SIZES = {
    carrier:    [54, 36],
    destroyer:  [44, 30],
    fast_attack:[38, 26],
    military:   [38, 26],
    tanker:     [44, 30],
    cargo:      [44, 30],
    fighter:    [42, 28],
    aircraft:   [42, 28],
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

const AIR_ICONS = new Set(["fighter", "aircraft", "patrol", "helicopter", "drone"])

// ── SVG interior shapes (same geometry as demoIconUtils) ──────────────────────
function _inner(type, w, h) {
    const t = type || "troops"
    const W = w, H = h
    switch (t) {
        case "infantry":
        case "troops":
            return `<line x1="${W*.25}" y1="${H*.83}" x2="${W*.75}" y2="${H*.17}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="${W*.25}" y1="${H*.17}" x2="${W*.75}" y2="${H*.83}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
        case "armor":
            return `<ellipse cx="${W*.5}" cy="${H*.58}" rx="${W*.31}" ry="${H*.27}" fill="none" stroke="white" stroke-width="2"/>
                    <line x1="${W*.5}" y1="${H*.31}" x2="${W*.5}" y2="${H*.1}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
        case "helicopter":
            return `<ellipse cx="${W*.5}" cy="${H*.5}" rx="${W*.12}" ry="${H*.14}" fill="white"/>
                    <line x1="${W*.09}" y1="${H*.5}" x2="${W*.91}" y2="${H*.5}" stroke="white" stroke-width="1.6"/>
                    <line x1="${W*.5}" y1="${H*.16}" x2="${W*.5}" y2="${H*.84}" stroke="white" stroke-width="1.6"/>`
        case "fighter":
        case "aircraft":
            return `<polygon points="${W*.5},${H*.11} ${W*.66},${H*.76} ${W*.5},${H*.62} ${W*.34},${H*.76}" fill="white"/>
                    <line x1="${W*.18}" y1="${H*.54}" x2="${W*.82}" y2="${H*.54}" stroke="white" stroke-width="1.8"/>`
        case "patrol":
            return `<ellipse cx="${W*.5}" cy="${H*.56}" rx="${W*.38}" ry="${H*.15}" fill="white"/>
                    <polygon points="${W*.5},${H*.18} ${W*.59},${H*.44} ${W*.41},${H*.44}" fill="white"/>`
        case "destroyer":
            return `<polygon points="${W*.5},${H*.11} ${W*.73},${H*.5} ${W*.68},${H*.89} ${W*.32},${H*.89} ${W*.27},${H*.5}" fill="white"/>`
        case "carrier":
            return `<polygon points="${W*.5},${H*.1} ${W*.72},${H*.38} ${W*.72},${H*.9} ${W*.28},${H*.9} ${W*.28},${H*.38}" fill="white"/>
                    <rect x="${W*.59}" y="${H*.2}" width="${W*.13}" height="${H*.32}" rx="1" fill="rgba(0,0,0,0.28)"/>`
        case "fast_attack":
        case "military":
            return `<polygon points="${W*.5},${H*.11} ${W*.73},${H*.5} ${W*.68},${H*.89} ${W*.32},${H*.89} ${W*.27},${H*.5}" fill="white"/>`
        case "tanker":
            return `<rect x="${W*.27}" y="${H*.22}" width="${W*.46}" height="${H*.62}" rx="2" fill="white"/>
                    <polygon points="${W*.5},${H*.09} ${W*.65},${H*.22} ${W*.35},${H*.22}" fill="white"/>
                    <line x1="${W*.27}" y1="${H*.46}" x2="${W*.73}" y2="${H*.46}" stroke="rgba(0,0,0,0.22)" stroke-width="1.2"/>`
        case "cargo":
            return `<rect x="${W*.2}" y="${H*.2}" width="${W*.6}" height="${H*.64}" rx="2" fill="none" stroke="white" stroke-width="1.8"/>
                    <line x1="${W*.2}" y1="${H*.47}" x2="${W*.8}" y2="${H*.47}" stroke="white" stroke-width="1.2"/>
                    <polygon points="${W*.5},${H*.08} ${W*.64},${H*.2} ${W*.36},${H*.2}" fill="white"/>`
        case "drone":
            return `<polygon points="${W*.5},${H*.11} ${W*.7},${H*.5} ${W*.5},${H*.42} ${W*.3},${H*.5}" fill="white"/>
                    <line x1="${W*.14}" y1="${H*.65}" x2="${W*.86}" y2="${H*.65}" stroke="white" stroke-width="1.5"/>`
        default:
            return `<line x1="${W*.25}" y1="${H*.83}" x2="${W*.75}" y2="${H*.17}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                    <line x1="${W*.25}" y1="${H*.17}" x2="${W*.75}" y2="${H*.83}" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
    }
}

function _makeBillboardUrl(iconType, color) {
    const [w, h] = ICON_SIZES[iconType] || ICON_SIZES.default
    const inner = _inner(iconType, w, h)
    const svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
        + `<rect width="${w}" height="${h}" rx="4" fill="${color}" opacity="0.93" stroke="rgba(255,255,255,0.38)" stroke-width="0.8"/>`
        + inner
        + `</svg>`
    return "data:image/svg+xml;base64," + btoa(svg)
}

// ── Director marker icon helpers ──────────────────────────────────────────────

const _DIRECTOR_TYPE_ICON = {
    conflict:       "MILITARY_MOBILISATION",
    airstrike:      "MILITARY_MOBILISATION",
    military:       "MILITARY_MOBILISATION",
    maritime:       "DARK_SHIP",
    vessel:         "DARK_SHIP",
    navy:           "DARK_SHIP",
    infrastructure: "INFRASTRUCTURE_THREAT",
    pipeline:       "INFRASTRUCTURE_THREAT",
    cable:          "INFRASTRUCTURE_THREAT",
    chokepoint:     "CHOKEPOINT_TRANSIT",
    strait:         "CHOKEPOINT_TRANSIT",
    political:      "SANCTIONS_PRESSURE",
    sanctions:      "SANCTIONS_PRESSURE",
    energy:         "ENERGY_SUPPLY_RISK",
    oil:            "ENERGY_SUPPLY_RISK",
    gas:            "ENERGY_SUPPLY_RISK",
}

const _DIRECTOR_ICON_CACHE = {}

function _directorIconCanvas(type) {
    const key  = (type || "").toLowerCase()
    const iconKey = _DIRECTOR_TYPE_ICON[key] || "UNKNOWN_CONTACT"
    if (!_DIRECTOR_ICON_CACHE[iconKey]) {
        const color = ALERT_ICONS[iconKey]?.color || "#8E8E93"
        // Director Mode scenario markers use the same Neutral-framed
        // news/event glyph as real assessment markers (see markerRenderer.js),
        // tinted by the scenario's own ALERT_ICONS colour.
        _DIRECTOR_ICON_CACHE[iconKey] = getMarkerCanvas({
            affiliation: AFFILIATION.NEUTRAL,
            entityFunction: ENTITY_FUNCTION.NEWS_EVENT,
            accentColor: color,
            size: 40,
        })
    }
    return _DIRECTOR_ICON_CACHE[iconKey]
}

// ── Camera helpers ────────────────────────────────────────────────────────────

const ZOOM_TO_HEIGHT = {
    2: 20_000_000, 3: 12_000_000, 4: 8_000_000, 5: 5_000_000,
    6: 3_000_000,  7: 2_000_000,  8: 1_000_000, 9: 500_000,
    10: 250_000,   11: 120_000,   12: 60_000,   13: 30_000,
    14: 15_000,    15: 8_000,     16: 4_000,    17: 2_000,
}

function _flyTo(viewer, center, zoom, opts = {}) {
    if (!viewer || !center?.length) return
    const height = ZOOM_TO_HEIGHT[zoom] || 500_000
    viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center[1], center[0], height),
        orientation: {
            heading: CesiumMath.toRadians(0),
            pitch:   CesiumMath.toRadians(-90),
            roll:    0,
        },
        duration: opts.duration != null ? opts.duration / 1000 : 2.5,
    })
}

// Extract fly_to from a visuals scene and fly
function _flyToFromVisuals(viewer, visuals) {
    const ft = (visuals || []).find(v => v.action === "fly_to")
    if (!ft) return
    _flyTo(viewer, [ft.lat, ft.lon], ft.zoom, { duration: ft.duration })
}

// ── Distance / duration helpers ───────────────────────────────────────────────

function _calcAnimDurMs(path, speedKnots, speedKmh, minMs = 15_000, maxMs = 35_000) {
    if (!path || path.length < 2) return minMs
    let distKm = 0
    for (let i = 1; i < path.length; i++) {
        const dlat = (path[i][0] - path[i-1][0]) * 111.32
        const dlng = (path[i][1] - path[i-1][1]) * 111.32 * Math.cos(path[i-1][0] * Math.PI / 180)
        distKm += Math.sqrt(dlat * dlat + dlng * dlng)
    }
    const kmh = speedKmh || (speedKnots ? speedKnots * 1.852 : null)
    if (!kmh) return minMs
    return Math.max(minMs, Math.min(maxMs, (distKm / kmh) * 5_000))
}

// ── Polygon → LineString converter (same logic as GlobeCountryBordersLayer) ──

function _polygonsToLines(geojson) {
    const features = []
    for (const f of (geojson.features || [])) {
        const geom = f.geometry
        if (!geom) continue
        const rings = []
        if (geom.type === "Polygon")      rings.push(...geom.coordinates)
        else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) rings.push(...p)
        else { features.push(f); continue }
        for (const ring of rings) {
            features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: f.properties })
        }
    }
    return { type: "FeatureCollection", features }
}

// ── Handle cleanup helpers ────────────────────────────────────────────────────

function _removeHandles(viewer, handles) {
    if (!viewer || viewer.isDestroyed()) return
    for (const h of handles) {
        try {
            if (h.type === "entity")     viewer.entities.remove(h.ref)
            else if (h.type === "ds")    viewer.dataSources.remove(h.ref, true)
            else if (h.type === "dom") {
                h.cleanup?.()
                if (h.ref?.parentNode) h.ref.parentNode.removeChild(h.ref)
            }
        } catch (_) {}
    }
    handles.length = 0
}

// ── Keyed entity registry ─────────────────────────────────────────────────────
// CommandRunner's `visuals` format can show and later hide/unhighlight/remove
// the *same* logical thing (a country highlight, a placed vessel, a placed
// event…) within a single scene's action list. `sceneLocal` on its own can
// only tear everything down at once when the scene ends — it has no notion of
// "this group of entities belongs to country X". `keyed` gives each such
// group a stable id (see the `key` arguments built in _renderVisualAction)
// so a later hide_*/unhighlight_*/remove_* action in the same scene can find
// and remove exactly that group while everything else stays on screen.
function _registerKeyed(keyed, key, handle) {
    if (!keyed || !key) return
    if (!keyed.has(key)) keyed.set(key, [])
    keyed.get(key).push(handle)
}

function _removeKeyed(viewer, keyed, removed, key) {
    if (!keyed || !key) return
    removed?.add(key)
    const handles = keyed.get(key)
    if (handles) {
        _removeHandles(viewer, handles)
        keyed.delete(key)
    }
}

function _cancelTimers(frames, intervals, timeouts) {
    for (const id of frames)    cancelAnimationFrame(id)
    for (const id of intervals) clearInterval(id)
    for (const id of timeouts)  clearTimeout(id)
    frames.length = 0
    intervals.length = 0
    timeouts.length = 0
}

// ── Route fetcher (OSRM via backend) ─────────────────────────────────────────

async function _getTroopRoute(start, end) {
    try {
        const tok = localStorage.getItem("hw-auth-token")
        const r = await fetch(`${API_BASE}/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ points: [start, end], mode: "driving" }),
        })
        if (r.ok) {
            const d = await r.json()
            const path = (d.coordinates || []).map(c => [c[1], c[0]])
            if (path.length >= 2) return path
        }
    } catch (_) {}
    return null
}

// ── Wikipedia image fetcher ───────────────────────────────────────────────────

async function _fetchWikiImage(query) {
    if (!query) return null
    try {
        const r = await fetch(`${API_BASE}/api/image/wiki?q=${encodeURIComponent(query)}`)
        if (r.ok) {
            const d = await r.json()
            return d?.image || null
        }
    } catch (_) {}
    return null
}

// ── Countries GeoJSON cache (module-level, shared across scenes) ──────────────

let _countriesCache = null
let _countriesFetch = null

async function _getCountries() {
    if (_countriesCache) return _countriesCache
    if (_countriesFetch) return _countriesFetch
    _countriesFetch = fetch(`${API_BASE}/geo/countries`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { _countriesCache = d; return d })
        .catch(() => null)
    return _countriesFetch
}

// ══════════════════════════════════════════════════════════════════════════════
// Element renderers
// Each receives (el, viewer, sceneLocal, persistent, animFrames, intervals, timeouts, isAborted)
// sceneLocal / persistent are arrays of {type, ref} pushed for cleanup.
// ══════════════════════════════════════════════════════════════════════════════

function _renderSpotlight(el, viewer, sceneLocal) {
    const c = Color.fromCssColorString(el.color || "#ef4444")
    const e = viewer.entities.add({
        position: Cartesian3.fromDegrees(el.lng, el.lat, 0),
        ellipse: {
            semiMajorAxis: el.radius || 10_000,
            semiMinorAxis: el.radius || 10_000,
            material:      c.withAlpha(0.09),
            outline:       true,
            outlineColor:  c.withAlpha(0.45),
            outlineWidth:  1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
        },
    })
    sceneLocal.push({ type: "entity", ref: e })
}

function _renderFacilityMarker(el, viewer, sceneLocal, isAborted, key, keyed) {
    const billInfo = el._billboard
    const billUrl  = billInfo ? _makeBillboardUrl(billInfo.iconType, billInfo.color) : null
    const [bw, bh] = billInfo ? (ICON_SIZES[billInfo.iconType] || ICON_SIZES.default) : [0, 0]
    const c = Color.fromCssColorString(el.color || "#f59e0b")
    const e = viewer.entities.add({
        position: Cartesian3.fromDegrees(el.lng, el.lat, 0),
        billboard: billUrl ? {
            image:                    billUrl,
            width:                    bw,
            height:                   bh,
            heightReference:          HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        point: billUrl ? undefined : {
            pixelSize:    10,
            color:        c,
            outlineColor: Color.WHITE.withAlpha(0.6),
            outlineWidth: 1.5,
            heightReference:            HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance:   Number.POSITIVE_INFINITY,
        },
        label: el.name ? {
            text:          el.name,
            font:          "bold 11px system-ui,sans-serif",
            fillColor:     Color.fromCssColorString("#e2e8f0"),
            outlineColor:  Color.BLACK,
            outlineWidth:  2,
            style:         LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:           VerticalOrigin.BOTTOM,
            pixelOffset:              new Cartesian2(0, -(bh ? bh / 2 + 4 : 14)),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference:          HeightReference.CLAMP_TO_GROUND,
        } : undefined,
    })
    sceneLocal.push({ type: "entity", ref: e })
    _registerKeyed(keyed, key, { type: "entity", ref: e })

    if (el.image_query) {
        _fetchWikiImage(el.image_query).then(url => {
            if (isAborted() || !url || viewer.isDestroyed()) return
            e.billboard = {
                image:         url,
                width:         120,
                height:        80,
                verticalOrigin:           VerticalOrigin.BOTTOM,
                heightReference:          HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
            e.point = undefined
        })
    }
}

function _renderInterceptLine(el, viewer, sceneLocal) {
    const pts = el.path || (el.from && el.to ? [el.from, el.to] : [])
    if (pts.length < 2) return
    const color = Color.fromCssColorString(el.color || "#ef4444")
    const positions = pts.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 50))
    const e = viewer.entities.add({
        polyline: {
            positions,
            width:    el.weight || 2,
            material: new ColorMaterialProperty(color.withAlpha(0.9)),
        },
    })
    sceneLocal.push({ type: "entity", ref: e })

    if (el.label) {
        const mid = pts[Math.floor(pts.length / 2)]
        const le = viewer.entities.add({
            position: Cartesian3.fromDegrees(mid[1], mid[0], 200),
            label: {
                text:          el.label,
                font:          "bold 10px system-ui,sans-serif",
                fillColor:     color,
                outlineColor:  Color.BLACK,
                outlineWidth:  2,
                style:         LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        sceneLocal.push({ type: "entity", ref: le })
    }

    // Faction labels either side of front line
    if (el.labelWest || el.labelEast) {
        const mid   = pts[Math.floor(pts.length / 2)]
        const lngOff = el.labelOffset != null ? el.labelOffset : 0.04
        if (el.labelWest) {
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                position: Cartesian3.fromDegrees(mid[1] - lngOff, mid[0], 300),
                label: {
                    text: el.labelWest, font: "bold 10px system-ui,sans-serif",
                    fillColor: Color.fromCssColorString(el.colorWest || "#ef4444"),
                    outlineColor: Color.BLACK, outlineWidth: 2,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            }) })
        }
        if (el.labelEast) {
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                position: Cartesian3.fromDegrees(mid[1] + lngOff, mid[0], 300),
                label: {
                    text: el.labelEast, font: "bold 10px system-ui,sans-serif",
                    fillColor: Color.fromCssColorString(el.colorEast || "#3b82f6"),
                    outlineColor: Color.BLACK, outlineWidth: 2,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            }) })
        }
    }
}

function _renderPerimeter(el, viewer, sceneLocal) {
    if (!el.points?.length) return
    const color = Color.fromCssColorString(el.color || "#3b82f6")
    const linePos = el.points.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 30))
    const e = viewer.entities.add({
        polyline: {
            positions: linePos,
            width: 2,
            material: new ColorMaterialProperty(color.withAlpha(0.8)),
        },
    })
    sceneLocal.push({ type: "entity", ref: e })

    // Fill polygon (on ellipsoid surface)
    const fillPos = el.points.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 0))
    const fe = viewer.entities.add({
        polygon: {
            hierarchy: new PolygonHierarchy(fillPos),
            material:  color.withAlpha(0.07),
        },
    })
    sceneLocal.push({ type: "entity", ref: fe })

    if (el.label) {
        const centLat = el.points.reduce((s, p) => s + p[0], 0) / el.points.length
        const centLng = el.points.reduce((s, p) => s + p[1], 0) / el.points.length
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            position: Cartesian3.fromDegrees(centLng, centLat, 500),
            label: {
                text: el.label, font: "bold 10px system-ui,sans-serif",
                fillColor: color,
                outlineColor: Color.BLACK, outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }) })
    }
}

function _renderRadiusCircle(el, viewer, sceneLocal) {
    const c = Color.fromCssColorString(el.color || "#3b82f6")
    const r = (el.radius_nm || 100) * 1_852
    const e = viewer.entities.add({
        position: Cartesian3.fromDegrees(el.lng, el.lat, 0),
        ellipse: {
            semiMajorAxis: r,
            semiMinorAxis: r,
            material:      c.withAlpha(0.05),
            outline:       true,
            outlineColor:  c.withAlpha(0.55),
            outlineWidth:  1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
        },
    })
    sceneLocal.push({ type: "entity", ref: e })
    if (el.label) {
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            position: Cartesian3.fromDegrees(el.lng, el.lat, 500),
            label: {
                text: el.label, font: "10px system-ui,sans-serif",
                fillColor: c, outlineColor: Color.BLACK, outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }) })
    }
}

function _renderFlowArrows(el, viewer, sceneLocal) {
    for (const flow of (el.flows || [])) {
        const c = Color.fromCssColorString(flow.color || "#f59e0b")
        const positions = [
            Cartesian3.fromDegrees(flow.from[1], flow.from[0], 100),
            Cartesian3.fromDegrees(flow.to[1],   flow.to[0],   100),
        ]
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            polyline: {
                positions,
                width:    flow.width || 2,
                material: new ColorMaterialProperty(c.withAlpha(0.75)),
            },
        }) })
        // Arrow tip label at endpoint
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            position: Cartesian3.fromDegrees(flow.to[1], flow.to[0], 200),
            label: {
                text: "▲", font: "14px system-ui,sans-serif",
                fillColor: c, outlineColor: Color.BLACK, outlineWidth: 1,
                style: LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }) })
        if (flow.label) {
            const midLat = (flow.from[0] + flow.to[0]) / 2
            const midLng = (flow.from[1] + flow.to[1]) / 2
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                position: Cartesian3.fromDegrees(midLng, midLat, 300),
                label: {
                    text: flow.label, font: "bold 10px system-ui,sans-serif",
                    fillColor: c, outlineColor: Color.BLACK, outlineWidth: 2,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            }) })
        }
    }
}

function _renderDeployZones(el, viewer, sceneLocal) {
    for (const z of (el.zones || [])) {
        if (!z.position) continue
        const e = viewer.entities.add({
            position: Cartesian3.fromDegrees(z.position[1], z.position[0], 0),
            ellipse: {
                semiMajorAxis: 800,
                semiMinorAxis: 800,
                material:      Color.fromCssColorString("#3b82f6").withAlpha(0.25),
                outline:       true,
                outlineColor:  Color.fromCssColorString("#3b82f6").withAlpha(0.8),
                outlineWidth:  2,
                heightReference: HeightReference.CLAMP_TO_GROUND,
            },
            label: z.name ? {
                text: z.name, font: "9px system-ui,sans-serif",
                fillColor: Color.fromCssColorString("#93c5fd"),
                outlineColor: Color.BLACK, outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cartesian2(0, -16),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: HeightReference.CLAMP_TO_GROUND,
            } : undefined,
        })
        sceneLocal.push({ type: "entity", ref: e })
    }
}

function _renderOverwatchScan(el, viewer, sceneLocal, intervals, isAborted) {
    if (!el.bounds) return
    const [[south, west], [north, east]] = Array.isArray(el.bounds)
        ? el.bounds
        : [[el.bounds.south, el.bounds.west], [el.bounds.north, el.bounds.east]]

    const c = Color.fromCssColorString(el.color || "#38bdf8")
    const borderPos = [
        Cartesian3.fromDegrees(west,  south, 30),
        Cartesian3.fromDegrees(east,  south, 30),
        Cartesian3.fromDegrees(east,  north, 30),
        Cartesian3.fromDegrees(west,  north, 30),
        Cartesian3.fromDegrees(west,  south, 30),
    ]
    sceneLocal.push({ type: "entity", ref: viewer.entities.add({
        polyline: {
            positions: borderPos,
            width: 1.5,
            material: new ColorMaterialProperty(c.withAlpha(0.6)),
        },
    }) })

    // Scan line — animated via CallbackProperty
    let scanLng = west
    const scanPos = new CallbackProperty(
        () => [Cartesian3.fromDegrees(scanLng, south, 30), Cartesian3.fromDegrees(scanLng, north, 30)],
        false
    )
    sceneLocal.push({ type: "entity", ref: viewer.entities.add({
        polyline: { positions: scanPos, width: 2, material: c.withAlpha(0.95) },
    }) })

    const totalMs = el.scan_duration || 4_000
    let elapsed = 0
    const id = setInterval(() => {
        if (isAborted()) { clearInterval(id); return }
        elapsed += 40
        const p = Math.min(elapsed / totalMs, 1)
        scanLng = west + (east - west) * p
        if (p >= 1) clearInterval(id)
    }, 40)
    intervals.push(id)
}

function _renderDetectionBoxes(el, viewer, sceneLocal, timeouts, isAborted) {
    const dets    = el.detections || []
    const delay   = el.reveal_delay || 150
    dets.forEach((d, i) => {
        const tid = setTimeout(() => {
            if (isAborted() || viewer.isDestroyed()) return
            const hh = (d.h ?? d.height ?? 0.001) / 2
            const hw = (d.w ?? d.width  ?? 0.001) / 2
            const c  = Color.fromCssColorString(d.color || "#38bdf8")
            const boxPos = [
                Cartesian3.fromDegrees(d.lng - hw, d.lat - hh, 30),
                Cartesian3.fromDegrees(d.lng + hw, d.lat - hh, 30),
                Cartesian3.fromDegrees(d.lng + hw, d.lat + hh, 30),
                Cartesian3.fromDegrees(d.lng - hw, d.lat + hh, 30),
                Cartesian3.fromDegrees(d.lng - hw, d.lat - hh, 30),
            ]
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                polyline: { positions: boxPos, width: 2, material: c.withAlpha(0.9) },
            }) })
            if (d.label) {
                sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                    position: Cartesian3.fromDegrees(d.lng - hw, d.lat + hh, 60),
                    label: {
                        text: `${d.label} ${Math.round(d.confidence || 0)}%`,
                        font: "bold 9px system-ui,sans-serif",
                        fillColor: c, outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        pixelOffset: new Cartesian2(0, -6),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                }) })
            }
        }, i * delay)
        timeouts.push(tid)
    })
}

// ── GeoJSON-based async renderers ─────────────────────────────────────────────

async function _renderCountryHighlight(el, viewer, sceneLocal, isAborted, key, keyed, removed) {
    const geo = await _getCountries()
    if (!geo || isAborted() || viewer.isDestroyed()) return
    // A same-scene unhighlight_country/clear_country_highlights may already
    // have fired for this key while the countries GeoJSON was still loading
    // (both run through the same synchronous action loop, but this fetch is
    // async and shared across the whole app) — honor it instead of flashing
    // a highlight the scene has already asked to remove.
    if (key && removed?.has(key)) return
    const name = (el.name || el.country || "").toLowerCase().trim()
    const feat = geo.features?.find(f =>
        (f.properties?.name || f.properties?.NAME || f.properties?.ADMIN || "").toLowerCase() === name
    )
    if (!feat) { console.warn(`[GlobeDirectorLayer] no country feature for "${name}"`); return }

    const c = Color.fromCssColorString(el.color || "#ef4444")
    const fc = { type: "FeatureCollection", features: [feat] }

    // Fill — Polygon/MultiPolygon with GroundPrimitive (no outline)
    const fillDs = await GeoJsonDataSource.load(fc, {
        stroke:      Color.TRANSPARENT,
        fill:        c.withAlpha(0.18),
        strokeWidth: 0,
        clampToGround: true,
    }).catch(() => null)
    if (isAborted() || viewer.isDestroyed() || (key && removed?.has(key))) return
    if (fillDs) { viewer.dataSources.add(fillDs); sceneLocal.push({ type: "ds", ref: fillDs }); _registerKeyed(keyed, key, { type: "ds", ref: fillDs }) }

    // Outline — converted to LineStrings so clampToGround works
    const outlineDs = await GeoJsonDataSource.load(_polygonsToLines(fc), {
        stroke:        c.withAlpha(0.9),
        strokeWidth:   2,
        clampToGround: true,
    }).catch(() => null)
    if (isAborted() || viewer.isDestroyed() || (key && removed?.has(key))) return
    if (outlineDs) { viewer.dataSources.add(outlineDs); sceneLocal.push({ type: "ds", ref: outlineDs }); _registerKeyed(keyed, key, { type: "ds", ref: outlineDs }) }
}

async function _renderChokepointFromDB(el, viewer, sceneLocal, isAborted, key, keyed, removed) {
    const rawName = (el.name || el.chokepoint_name || "").toLowerCase().trim()
    try {
        const r = await fetch(`${API_BASE}/api/infrastructure/chokepoints?name=${encodeURIComponent(rawName)}`)
        if (!r.ok || isAborted() || viewer.isDestroyed() || (key && removed?.has(key))) return
        const data = await r.json()
        const items = data.chokepoints || data.items || data.features || []

        // Find best name match (API returns all chokepoints ranked by relevance)
        const item = items.find(i => (i.name || "").toLowerCase().includes(rawName)) || items[0]
        if (!item || isAborted()) return

        const c = Color.fromCssColorString(el.color || "#ef4444")

        // Build GeoJSON: API returns polygon as [[lat, lng], ...] (not GeoJSON [lng, lat])
        let feature = null
        if (item.geometry) {
            // Already a GeoJSON Feature
            feature = item
        } else if (item.polygon?.length >= 3) {
            // Convert [lat, lng] → GeoJSON [lng, lat] and close ring
            const coords = item.polygon.map(([lat, lng]) => [lng, lat])
            if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
                coords.push(coords[0])
            }
            feature = {
                type: "Feature",
                geometry: { type: "Polygon", coordinates: [coords] },
                properties: { name: item.name },
            }
        } else if (item.polygon_bounds) {
            // Fallback: rectangle from [south, west, north, east]
            const [s, w, n, e] = item.polygon_bounds
            feature = {
                type: "Feature",
                geometry: { type: "Polygon", coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]] },
                properties: { name: item.name },
            }
        }

        if (!feature || isAborted() || (key && removed?.has(key))) return
        const fc = { type: "FeatureCollection", features: [feature] }

        const fillDs = await GeoJsonDataSource.load(fc, {
            stroke: Color.TRANSPARENT, fill: c.withAlpha(0.08), strokeWidth: 0, clampToGround: true,
        }).catch(() => null)
        if (!isAborted() && fillDs && !viewer.isDestroyed() && !(key && removed?.has(key))) {
            viewer.dataSources.add(fillDs); sceneLocal.push({ type: "ds", ref: fillDs }); _registerKeyed(keyed, key, { type: "ds", ref: fillDs })
        }

        const outlineDs = await GeoJsonDataSource.load(_polygonsToLines(fc), {
            stroke: c.withAlpha(0.75), strokeWidth: 2, clampToGround: true,
        }).catch(() => null)
        if (!isAborted() && outlineDs && !viewer.isDestroyed() && !(key && removed?.has(key))) {
            viewer.dataSources.add(outlineDs); sceneLocal.push({ type: "ds", ref: outlineDs }); _registerKeyed(keyed, key, { type: "ds", ref: outlineDs })
        }
    } catch (e) { console.warn("[GlobeDirectorLayer] chokepoint_from_db:", e.message) }
}

async function _renderCableFromDB(el, viewer, sceneLocal, isAborted) {
    try {
        const name = el.cable_name || el.name || ""
        const r = await fetch(`${API_BASE}/api/infrastructure/cables?name=${encodeURIComponent(name)}`)
        if (!r.ok || isAborted() || viewer.isDestroyed()) return
        const data    = await r.json()
        const feature = data.cables?.[0]
        if (!feature?.geometry || isAborted()) return

        const ds = await GeoJsonDataSource.load(feature, {
            stroke:        Color.fromCssColorString(el.color || "#a855f7").withAlpha(0.85),
            strokeWidth:   el.weight || 2,
            clampToGround: true,
        }).catch(() => null)
        if (!isAborted() && ds && !viewer.isDestroyed()) {
            viewer.dataSources.add(ds); sceneLocal.push({ type: "ds", ref: ds })
        }
    } catch (e) { console.warn("[GlobeDirectorLayer] cable_from_db:", e.message) }
}

// ── Vessel / aircraft animation ───────────────────────────────────────────────

function _spawnVessel(vessel, animDurMs, viewer, persistent, animFrames, isAborted) {
    const path = vessel.path
    if (!path || path.length < 2) return

    const dur    = (vessel.speed_knots || vessel.speed_kmh)
        ? _calcAnimDurMs(path, vessel.speed_knots, vessel.speed_kmh)
        : animDurMs
    const isAir  = AIR_ICONS.has(vessel.icon)
    const alt    = isAir ? 8_000 : 0
    const iconType = vessel.icon || "troops"
    const color    = vessel.color || "#3b82f6"
    const billUrl  = _makeBillboardUrl(iconType, color)
    const [bw, bh] = ICON_SIZES[iconType] || ICON_SIZES.default

    // Trail (grows via CallbackProperty)
    const trailPos = [Cartesian3.fromDegrees(path[0][1], path[0][0], isAir ? alt : 5)]
    const trail = viewer.entities.add({
        polyline: {
            positions: new CallbackProperty(() => trailPos, false),
            width:     1.5,
            material:  Color.fromCssColorString(color).withAlpha(0.38),
            clampToGround: !isAir,
        },
    })
    persistent.push({ type: "entity", ref: trail })

    // Marker
    const marker = viewer.entities.add({
        position: Cartesian3.fromDegrees(path[0][1], path[0][0], alt),
        billboard: {
            image:  billUrl,
            width:  bw,
            height: bh,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: isAir ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
        },
        label: vessel.name ? {
            text:          vessel.name,
            font:          "9px system-ui,sans-serif",
            fillColor:     Color.WHITE,
            outlineColor:  Color.BLACK,
            outlineWidth:  2,
            style:         LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:           VerticalOrigin.BOTTOM,
            pixelOffset:              new Cartesian2(0, -bh / 2 - 2),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference:          isAir ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
        } : undefined,
    })
    persistent.push({ type: "entity", ref: marker })

    const n = path.length
    const startTime = performance.now()
    let lastTrailUpdate = 0

    function step() {
        if (isAborted() || viewer.isDestroyed()) return
        const elapsed  = performance.now() - startTime
        const progress = Math.min(elapsed / dur, 1)
        const sf = progress * (n - 1)
        const si = Math.min(Math.floor(sf), n - 2)
        const sp = sf - si
        const lat = path[si][0] + (path[si+1][0] - path[si][0]) * sp
        const lng = path[si][1] + (path[si+1][1] - path[si][1]) * sp

        marker.position = Cartesian3.fromDegrees(lng, lat, alt)

        if (elapsed - lastTrailUpdate > 250) {
            lastTrailUpdate = elapsed
            trailPos.push(Cartesian3.fromDegrees(lng, lat, isAir ? alt : 5))
        }

        if (progress < 1) animFrames.push(requestAnimationFrame(step))
    }
    animFrames.push(requestAnimationFrame(step))
}

async function _renderTroopMovement(el, animDurMs, viewer, persistent, animFrames, isAborted) {
    for (const unit of (el.units || [])) {
        if (isAborted()) return
        let path = await _getTroopRoute(unit.start, unit.end)
        if (isAborted()) return
        if (!path) path = [unit.start, unit.end]
        _spawnVessel(
            { name: unit.name, strength: unit.strength, color: unit.color || "#ef4444", icon: unit.icon || "infantry", path },
            animDurMs,
            viewer, persistent, animFrames, isAborted
        )
    }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

function _renderElement(el, animDurMs, viewer, sceneLocal, persistent, animFrames, intervals, timeouts, isAborted) {
    console.log(`[Director3D] element type="${el.type}"`, el)
    switch (el.type) {

        case "country_highlight":
            _renderCountryHighlight(el, viewer, sceneLocal, isAborted)
            break

        case "chokepoint_from_db":
            _renderChokepointFromDB(el, viewer, sceneLocal, isAborted)
            break

        case "cable_from_db":
            _renderCableFromDB(el, viewer, sceneLocal, isAborted)
            break

        case "spotlight":
            _renderSpotlight(el, viewer, sceneLocal)
            break

        case "facility_marker":
            _renderFacilityMarker(el, viewer, sceneLocal, isAborted)
            break

        case "intercept_line":
            _renderInterceptLine(el, viewer, sceneLocal)
            break

        case "perimeter":
            _renderPerimeter(el, viewer, sceneLocal)
            break

        case "radius_circle":
            _renderRadiusCircle(el, viewer, sceneLocal)
            break

        case "flow_arrows":
            _renderFlowArrows(el, viewer, sceneLocal)
            break

        case "overwatch_scan":
            // Animated scan overlay disabled during Director playback
            break

        case "detection_boxes":
            _renderDetectionBoxes(el, viewer, sceneLocal, timeouts, isAborted)
            break

        case "troop_deploy_interactive":
            _renderDeployZones(el, viewer, sceneLocal)
            break

        case "ship_animation":
        case "flight_animation":
        case "troop_movement":
            // Animated military unit overlays disabled during Director playback
            break

        case "combined_ops":
            for (const sub of (el.elements || []))
                _renderElement(sub, animDurMs, viewer, sceneLocal, persistent, animFrames, intervals, timeouts, isAborted)
            break

        case "zone_overlay": {
            const c = Color.fromCssColorString(el.color || "#3b82f6")
            const ps = (el.polygon || el.coords || []).map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 0))
            if (ps.length < 3) break
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                polygon: { hierarchy: new PolygonHierarchy(ps), material: c.withAlpha(0.18) },
            }) })
            break
        }

        case "data_callout":
        case "chart":
            // Handled by DemoRunner callbacks (rendered in sidebar, not on globe)
            break

        default:
            console.warn(`[Director3D] Unknown element type: "${el.type}"`, el)
            break
    }
}

// ── CommandRunner visuals-format dispatcher ───────────────────────────────────
// Translates the `visuals` array (action objects) from CommandRunner into Cesium
// primitives using the same renderers as scene_elements above.

const _CONTEXT_COLORS = {
    conflict: "#ef4444",
    focus:    "#38bdf8",
    allied:   "#22c55e",
    neutral:  "#f59e0b",
}

const _VESSEL_FACTION_COLORS = {
    hostile:  "#ef4444",
    allied:   "#22c55e",
    friendly: "#22c55e",
    neutral:  "#94a3b8",
}

const _VESSEL_TYPE_MAP = {
    warship:    "destroyer",
    carrier:    "carrier",
    submarine:  "destroyer",
    patrol:     "patrol",
    tanker_ship:"tanker",
    cargo_ship: "cargo",
    fighter:    "fighter",
    bomber:     "fighter",
    helicopter: "helicopter",
    drone:      "drone",
}

// animate_movement/troop_movement/formation units come from the AI with a
// looser, overlapping vocabulary (vessel types, aircraft types, ground-unit
// types) than either ICON_SIZES or _VESSEL_TYPE_MAP alone covers. Use the
// icon key directly when it's already a real billboard type, otherwise fall
// back through the vessel/aircraft aliases, otherwise a generic troop icon —
// never silently drop the marker for an unrecognised type.
function _resolveIconType(raw) {
    if (!raw) return "troops"
    if (ICON_SIZES[raw]) return raw
    return _VESSEL_TYPE_MAP[raw] || "troops"
}

// ── Screen-space spotlight/vignette ───────────────────────────────────────────
// A real Cesium-anchored version of the old Leaflet spotlight: a fixed DOM
// overlay with a radial-gradient hole, kept centred on the entity's actual
// projected screen position every frame via SceneTransforms — not a fake
// static circle, it tracks the globe as the camera moves.
function _renderScreenSpotlight(el, viewer, sceneLocal) {
    const lat = el.lat, lon = el.lon ?? el.lng
    if (lat == null || lon == null) return
    const radiusPx = el.radius_px || 200
    const duration = el.duration || 5000
    const pos = Cartesian3.fromDegrees(lon, lat, 0)

    const overlay = document.createElement("div")
    overlay.className = "director-spotlight-overlay"
    overlay.style.cssText = "position:fixed;inset:0;z-index:500;pointer-events:none;opacity:0;transition:opacity 500ms ease;"
    document.body.appendChild(overlay)

    const update = () => {
        if (viewer.isDestroyed()) return
        const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, pos)
        if (!sp) return
        overlay.style.background = `radial-gradient(circle ${radiusPx}px at ${sp.x}px ${sp.y}px,transparent 0%,transparent 70%,rgba(0,0,0,0.72) 100%)`
    }
    update()
    viewer.scene.postRender.addEventListener(update)
    requestAnimationFrame(() => { overlay.style.opacity = "1" })

    const stopTracking = () => { try { viewer.scene.postRender.removeEventListener(update) } catch (_) {} }
    const tid = setTimeout(() => {
        stopTracking()
        overlay.style.opacity = "0"
        setTimeout(() => { try { document.body.removeChild(overlay) } catch (_) {} }, 550)
    }, duration)

    sceneLocal.push({
        type: "dom", ref: overlay,
        cleanup: () => { stopTracking(); clearTimeout(tid) },
    })
}

// ── Pulsing border highlight ───────────────────────────────────────────────────
// Mode A: an explicit simplified border (array of [lat,lon] points) drawn as a
// polyline whose alpha pulses via CallbackProperty. Mode B: a lat/lon/radius_km
// pulsing ring fallback when no border geometry was supplied.
function _renderHighlightBorder(el, viewer, sceneLocal) {
    const color    = Color.fromCssColorString(el.color || "#56cfff")
    const duration = el.duration || 6000
    const weight   = el.weight || 3
    const startTime = performance.now()
    const pulseAlpha = new CallbackProperty(() => {
        const t     = performance.now() - startTime
        const pulse = 0.55 + 0.35 * Math.sin((t / 800) * Math.PI)
        const fadeIn = Math.min(t / 600, 1)
        return color.withAlpha(fadeIn * pulse)
    }, false)

    if (Array.isArray(el.points) && el.points.length >= 2) {
        const positions = el.points.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 50))
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            polyline: { positions, width: weight, material: new ColorMaterialProperty(pulseAlpha) },
        }) })
        return
    }

    const lat    = el.lat ?? 0
    const lon    = el.lon ?? 0
    const radius = (el.radius_km ?? 300) * 1000
    sceneLocal.push({ type: "entity", ref: viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 0),
        ellipse: {
            semiMajorAxis: radius, semiMinorAxis: radius,
            fill: false, outline: true,
            outlineColor: pulseAlpha, outlineWidth: weight,
            heightReference: HeightReference.CLAMP_TO_GROUND,
        },
    }) })
    // Duration is cosmetic here (the pulse just keeps going until the scene
    // clears it) — kept as a parameter for API parity with the old action.
    void duration
}

// ── Impact / explosion effect ─────────────────────────────────────────────────
// Flash + three expanding, fading rings — mutating each entity's own ellipse
// properties directly on a timer (the same "update the live entity" approach
// _spawnVessel uses for position), rather than CallbackProperty, since these
// are one-shot effects that fully finish and get cleaned up.
function _renderImpact(el, viewer, sceneLocal, intervals, timeouts) {
    const lat = el.lat, lon = el.lon
    if (lat == null || lon == null) return
    const color = Color.fromCssColorString(el.color || "#ff5500")

    const flash = viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat, 0),
        ellipse: {
            semiMajorAxis: 6000, semiMinorAxis: 6000,
            material: Color.WHITE.withAlpha(0.9),
            heightReference: HeightReference.CLAMP_TO_GROUND,
        },
    })
    sceneLocal.push({ type: "entity", ref: flash })
    let flashOp = 0.9
    const flashIv = setInterval(() => {
        flashOp -= 0.09
        try { flash.ellipse.material = color.withAlpha(Math.max(flashOp, 0)) } catch (_) {}
        if (flashOp <= 0) clearInterval(flashIv)
    }, 40)
    intervals.push(flashIv)

    for (let i = 0; i < 3; i++) {
        const tid = setTimeout(() => {
            let r = 1500 * (1 + i * 0.4)
            let op = 1
            const ring = viewer.entities.add({
                position: Cartesian3.fromDegrees(lon, lat, 0),
                ellipse: {
                    semiMajorAxis: r, semiMinorAxis: r,
                    material: Color.TRANSPARENT,
                    outline: true, outlineColor: color.withAlpha(op), outlineWidth: 3,
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                },
            })
            sceneLocal.push({ type: "entity", ref: ring })
            const ringIv = setInterval(() => {
                r  += 6000
                op -= 0.05
                try {
                    ring.ellipse.semiMajorAxis = r
                    ring.ellipse.semiMinorAxis = r
                    ring.ellipse.outlineColor  = color.withAlpha(Math.max(op, 0))
                } catch (_) {}
                if (op <= 0) clearInterval(ringIv)
            }, 40)
            intervals.push(ringIv)
        }, i * 200)
        timeouts.push(tid)
    }

    if (el.label) {
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            position: Cartesian3.fromDegrees(lon, lat, 300),
            label: {
                text: el.label, font: "bold 11px system-ui,sans-serif",
                fillColor: color, outlineColor: Color.BLACK, outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }) })
    }
}

// ── Animated line reveal ──────────────────────────────────────────────────────
// Draws the line progressively via CallbackProperty rather than all at once —
// the animated counterpart of the already-real "draw_line" action.
function _renderAnimatedLineReveal(el, viewer, sceneLocal) {
    const pts = el.points || []
    if (pts.length < 2) return
    const color    = Color.fromCssColorString(el.color || "#38bdf8")
    const duration = el.duration ?? 3000
    const cartesians = pts.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 50))

    const dists = [0]
    for (let i = 1; i < cartesians.length; i++) {
        dists.push(dists[i - 1] + Cartesian3.distance(cartesians[i - 1], cartesians[i]))
    }
    const total = dists[dists.length - 1] || 1
    const startTime = performance.now()

    const positionsCB = new CallbackProperty(() => {
        const t      = Math.min((performance.now() - startTime) / duration, 1)
        const target = t * total
        const visible = [cartesians[0]]
        for (let i = 0; i < dists.length - 1; i++) {
            const segLen = dists[i + 1] - dists[i]
            const rem    = target - dists[i]
            if (rem <= 0) break
            if (rem >= segLen) {
                visible.push(cartesians[i + 1])
            } else {
                const frac = segLen > 0 ? rem / segLen : 0
                visible.push(Cartesian3.lerp(cartesians[i], cartesians[i + 1], frac, new Cartesian3()))
                break
            }
        }
        return visible
    }, false)

    sceneLocal.push({ type: "entity", ref: viewer.entities.add({
        polyline: { positions: positionsCB, width: el.weight || 4, material: new ColorMaterialProperty(color.withAlpha(0.9)) },
    }) })

    if (el.label) {
        const mid = pts[Math.floor(pts.length / 2)]
        sceneLocal.push({ type: "entity", ref: viewer.entities.add({
            position: Cartesian3.fromDegrees(mid[1], mid[0], 200),
            label: {
                text: el.label, font: "bold 10px system-ui,sans-serif",
                fillColor: color, outlineColor: Color.BLACK, outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }) })
    }
}

function _renderVisualAction(action, viewer, sceneLocal, persistent, animFrames, intervals, timeouts, isAborted, keyed, removed) {
    const act = action.action
    switch (act) {
        case "fly_to":
        case "pause":
        case "narrate":
        case "summary":
        case "show_indicator":
        case "show_context_card":
        case "show_image":
        case "show_video":
        case "click_vessel":
        case "click_aircraft":
        case "click_chokepoint":
        case "click_country":
        case "click_infrastructure":
        case "hide_satellite":
        case "hide_event":
        case "open_detail":
        case "close_detail":
            // These are narration/UI/cleanup-only actions handled by CommandRunner's
            // own onOpenDetail/onDetailPanel/onImage callbacks or the satellite-toggle
            // callback (see app.jsx) — no Cesium primitives needed here.
            break

        // click_event/click_location have no marker of their own to react to here —
        // CommandRunner routes them through onOpenDetail (see commandRunner.js), the
        // same real detail-panel mechanism click_vessel/click_chokepoint/etc use.
        case "click_event":
        case "click_location":
            break

        case "highlight_country": {
            const color = _CONTEXT_COLORS[action.context] || "#38bdf8"
            const key   = `country:${(action.name || "").toLowerCase().trim()}`
            _renderCountryHighlight(
                { name: action.name, color },
                viewer, sceneLocal, isAborted, key, keyed, removed
            )
            break
        }

        case "unhighlight_country": {
            const key = `country:${(action.name || "").toLowerCase().trim()}`
            _removeKeyed(viewer, keyed, removed, key)
            break
        }

        case "clear_country_highlights": {
            for (const k of [...keyed.keys()]) {
                if (k.startsWith("country:")) _removeKeyed(viewer, keyed, removed, k)
            }
            break
        }

        case "hide_vessel":
            _removeKeyed(viewer, keyed, removed, `vessel:${action.mmsi}`)
            break

        case "hide_aircraft":
            _removeKeyed(viewer, keyed, removed, `aircraft:${String(action.icao24 || "").toLowerCase()}`)
            break

        case "hide_chokepoint":
            _removeKeyed(viewer, keyed, removed, `chokepoint:${(action.name || "").toLowerCase().trim()}`)
            break

        case "hide_infrastructure":
            _removeKeyed(viewer, keyed, removed, `infra:${action.id}`)
            break

        case "remove_event":
            _removeKeyed(viewer, keyed, removed, `placed-event:${action.title}`)
            break

        case "remove_location":
            _removeKeyed(viewer, keyed, removed, `placed-location:${action.name}`)
            break

        case "hide_person":
            _removeKeyed(viewer, keyed, removed, `person:${action.name}`)
            break

        case "clear_drawings":
        case "clear_all":
            // Wipe everything this scene has added so far — matches the old
            // CommandRunner._clearAllDrawings semantics (both actions cleared
            // literally everything imperatively drawn, not just "drawings").
            _removeHandles(viewer, sceneLocal)
            keyed.clear()
            break

        case "show_event": {
            const id = action.event_id
            if (id) {
                // show_event doesn't create a new marker — it points the camera-
                // independent popup mechanism at a LIVE GlobeEventsLayer entity
                // (see reportDeepLink.js for the same pattern). If that event
                // isn't currently registered — aged out, filtered by relevance,
                // outside the loaded viewport — this is a graceful, honest no-op
                // rather than a fabricated marker for something not really there.
                window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { id: `event-${id}` } }))
            }
            break
        }

        case "spotlight":
            _renderScreenSpotlight({
                lat: action.lat, lon: action.lon,
                radius_px: action.radius_px, duration: action.duration,
            }, viewer, sceneLocal)
            break

        case "highlight_border":
            _renderHighlightBorder(action, viewer, sceneLocal)
            break

        case "impact":
            _renderImpact({
                lat: action.lat, lon: action.lon,
                color: action.color, label: action.label,
            }, viewer, sceneLocal, intervals, timeouts)
            break

        case "draw_animated_line":
            _renderAnimatedLineReveal(action, viewer, sceneLocal)
            break

        case "recap_overview": {
            const points = Array.isArray(action.key_points) ? action.key_points
                         : Array.isArray(action.locations)  ? action.locations
                         : []
            const valid = points.filter(p => p.lat != null && p.lon != null)
            const color = Color.fromCssColorString(action.color || "#56cfff")
            if (valid.length >= 2) {
                const lats = valid.map(p => p.lat), lons = valid.map(p => p.lon)
                const rect = Rectangle.fromDegrees(
                    Math.min(...lons) - 2, Math.min(...lats) - 2,
                    Math.max(...lons) + 2, Math.max(...lats) + 2,
                )
                viewer.camera.flyTo({ destination: rect, duration: 3 })
            }
            valid.forEach(pt => {
                sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                    position: Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
                    point: {
                        pixelSize: 9, color, outlineColor: Color.WHITE, outlineWidth: 1.5,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                    label: pt.label ? {
                        text: pt.label, font: "10px system-ui,sans-serif",
                        fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        pixelOffset: new Cartesian2(0, -14),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    } : undefined,
                }) })
            })
            if (valid.length >= 2) {
                const positions = valid.map(p => Cartesian3.fromDegrees(p.lon, p.lat, 50))
                sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                    polyline: { positions, width: 1.5, material: new ColorMaterialProperty(color.withAlpha(0.5)) },
                }) })
            }
            break
        }

        case "show_person": {
            if (!action.name || !Array.isArray(action.position)) break
            const key = `person:${action.name}`
            _renderFacilityMarker({
                lat: action.position[0], lng: action.position[1],
                name: action.name, color: "#38bdf8",
                image_query: action.name,
            }, viewer, sceneLocal, isAborted, key, keyed)
            break
        }

        case "pulse_hotspot": {
            _renderSpotlight({
                lat:    action.lat,
                lng:    action.lon,
                radius: action.radius || 15_000,
                color:  action.color || "#38bdf8",
            }, viewer, sceneLocal)
            break
        }

        case "draw_circle": {
            const c  = action.center || [action.lat, action.lng || action.lon]
            const rm = (action.radius_km || 50) * 1_000
            _renderSpotlight({
                lat:    c[0],
                lng:    c[1],
                radius: rm,
                color:  action.color || "#3b82f6",
            }, viewer, sceneLocal)
            if (action.label) {
                sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                    position: Cartesian3.fromDegrees(c[1], c[0], 500),
                    label: {
                        text: action.label, font: "bold 10px system-ui,sans-serif",
                        fillColor: Color.fromCssColorString(action.color || "#3b82f6"),
                        outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                }) })
            }
            break
        }

        case "draw_arrow": {
            _renderInterceptLine({
                from:   action.from,
                to:     action.to,
                color:  action.color || "#ef4444",
                label:  action.label,
                dashed: false,
            }, viewer, sceneLocal)
            break
        }

        case "draw_line": {
            const pts = action.points || []
            if (pts.length < 2) break
            const c = Color.fromCssColorString(action.color || "#38bdf8")
            const positions = pts.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 50))
            sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                polyline: {
                    positions,
                    width:    action.weight || 2,
                    material: new ColorMaterialProperty(c.withAlpha(0.85)),
                },
            }) })
            if (action.label) {
                const mid = pts[Math.floor(pts.length / 2)]
                sceneLocal.push({ type: "entity", ref: viewer.entities.add({
                    position: Cartesian3.fromDegrees(mid[1], mid[0], 200),
                    label: {
                        text: action.label, font: "bold 10px system-ui,sans-serif",
                        fillColor: c, outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                }) })
            }
            break
        }

        case "draw_polygon": {
            if (!action.points?.length) break
            _renderPerimeter({
                points: action.points,
                color:  action.color || "#3b82f6",
                label:  action.label,
                fill:   action.fill !== false,
                dashed: true,
            }, viewer, sceneLocal)
            break
        }

        case "place_event": {
            const canvas = _directorIconCanvas(action.type)
            const e = viewer.entities.add({
                position: Cartesian3.fromDegrees(action.lon, action.lat, 0),
                billboard: {
                    image:                    canvas,
                    width:                    32,
                    height:                   32,
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: (action.title) ? {
                    text:          action.title,
                    font:          "bold 11px system-ui,sans-serif",
                    fillColor:     Color.fromCssColorString("#e2e8f0"),
                    outlineColor:  Color.BLACK,
                    outlineWidth:  2,
                    style:         LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin:           VerticalOrigin.BOTTOM,
                    pixelOffset:              new Cartesian2(0, -20),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                } : undefined,
            })
            sceneLocal.push({ type: "entity", ref: e })
            _registerKeyed(keyed, `placed-event:${action.title}`, { type: "entity", ref: e })
            break
        }

        case "place_location": {
            const locTypeToDirectorType = {
                base: "military", port: "maritime", facility: "infrastructure",
                target: "conflict",
            }
            const canvas = _directorIconCanvas(locTypeToDirectorType[action.type] || action.type)
            const e = viewer.entities.add({
                position: Cartesian3.fromDegrees(action.lon, action.lat, 0),
                billboard: {
                    image:                    canvas,
                    width:                    32,
                    height:                   32,
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: (action.name) ? {
                    text:          action.name,
                    font:          "bold 11px system-ui,sans-serif",
                    fillColor:     Color.fromCssColorString("#e2e8f0"),
                    outlineColor:  Color.BLACK,
                    outlineWidth:  2,
                    style:         LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin:           VerticalOrigin.BOTTOM,
                    pixelOffset:              new Cartesian2(0, -20),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                } : undefined,
            })
            sceneLocal.push({ type: "entity", ref: e })
            _registerKeyed(keyed, `placed-location:${action.name}`, { type: "entity", ref: e })
            break
        }

        case "place_image_marker": {
            // One-off illustrative marker — never individually hidden by any
            // CommandRunner action, so no key is needed (clear_drawings/clear_all
            // will still remove it via sceneLocal).
            _renderFacilityMarker({
                lat:         action.lat,
                lng:         action.lon,
                name:        action.name || "",
                color:       "#f59e0b",
                image_query: action.query,
            }, viewer, sceneLocal, isAborted)
            break
        }

        case "show_vessel": {
            const color    = _VESSEL_FACTION_COLORS[action.faction] || "#3b82f6"
            const iconType = _VESSEL_TYPE_MAP[action.vessel_type] || "destroyer"
            // Static marker at current position (no path = no animation)
            _renderFacilityMarker({
                lat:         action.lat,
                lng:         action.lon,
                name:        action.name || "",
                color,
                image_query: action.image_query,
                _billboard:  { iconType, color },
            }, viewer, sceneLocal, isAborted, `vessel:${action.mmsi}`, keyed)
            break
        }

        case "show_aircraft": {
            const color    = _VESSEL_FACTION_COLORS[action.faction] || "#3b82f6"
            const iconType = _VESSEL_TYPE_MAP[action.aircraft_type] || "fighter"
            _renderFacilityMarker({
                lat:         action.lat,
                lng:         action.lon,
                name:        action.callsign || action.name || "",
                color,
                image_query: action.image_query,
                _billboard:  { iconType, color },
            }, viewer, sceneLocal, isAborted, `aircraft:${String(action.icao24 || "").toLowerCase()}`, keyed)
            break
        }

        case "show_chokepoint": {
            const key = `chokepoint:${(action.name || "").toLowerCase().trim()}`
            _renderChokepointFromDB(
                { name: action.name, color: "#f59e0b" },
                viewer, sceneLocal, isAborted, key, keyed, removed
            )
            break
        }

        case "show_infrastructure": {
            _renderFacilityMarker({
                lat:   action.lat,
                lng:   action.lon,
                name:  action.name || "",
                color: "#6366f1",
            }, viewer, sceneLocal, isAborted, `infra:${action.id}`, keyed)
            break
        }

        case "troop_movement": {
            // Converging-columns movement, ported from CommandRunner's old
            // _animateTroopMovement: straight-line paths (not routed through
            // OSRM like the DemoRunner troop_movement renderer above) animated
            // via the same requestAnimationFrame interpolation _spawnVessel
            // uses for show_vessel/animate_movement.
            const target = action.target
            const tLat   = target?.lat
            const tLon   = target?.lng ?? target?.lon
            for (const unit of (action.units || [])) {
                const start = unit.start || unit.from
                if (!start) continue
                const end      = tLat != null ? [tLat, tLon] : (unit.end || unit.to || start)
                const iconType = _resolveIconType(unit.icon || unit.type) || "infantry"
                const color    = unit.color || _VESSEL_FACTION_COLORS[unit.faction] || "#ef4444"
                _spawnVessel(
                    { name: unit.label || unit.name, color, icon: iconType, path: [start, end] },
                    7_000, viewer, sceneLocal, animFrames, isAborted
                )
            }
            if (tLat != null) {
                _renderSpotlight({ lat: tLat, lng: tLon, radius: 15_000, color: "#ef4444" }, viewer, sceneLocal)
            }
            break
        }

        case "animate_movement": {
            const duration = action.speed
                ? Math.round((1 / Math.max(action.speed, 0.05)) * 5_000)
                : (action.duration ?? 20_000)
            for (const unit of (action.units || [])) {
                const from = unit.from || unit.origin
                const to   = unit.to   || unit.destination
                if (!from || !to) continue
                const waypoints = unit.waypoints || unit.path || []
                const path      = [from, ...waypoints, to]
                const iconType  = _resolveIconType(unit.type || unit.icon)
                const color     = _VESSEL_FACTION_COLORS[unit.faction] || "#94a3b8"
                _spawnVessel(
                    { name: unit.label, color, icon: iconType, path },
                    duration, viewer, sceneLocal, animFrames, isAborted
                )
            }
            break
        }

        case "formation": {
            const target  = Array.isArray(action.target) ? action.target : null
            const markers = []
            for (const unit of (action.units || [])) {
                const color    = _VESSEL_FACTION_COLORS[unit.faction] || "#94a3b8"
                const isAir    = unit.type === "aircraft"
                const iconType = isAir ? "fighter" : unit.type === "ship" ? "destroyer" : _resolveIconType(unit.icon) || "infantry"
                const alt      = isAir ? 8_000 : 0
                const startLat = unit.lat
                const startLon = unit.lon ?? unit.lng ?? 0
                const [w, h]   = ICON_SIZES[iconType] || ICON_SIZES.default
                const billUrl  = _makeBillboardUrl(iconType, color)
                const marker   = viewer.entities.add({
                    position: Cartesian3.fromDegrees(startLon, startLat, alt),
                    billboard: {
                        image: billUrl, width: w, height: h,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: isAir ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
                    },
                    label: unit.label ? {
                        text: unit.label, font: "9px system-ui,sans-serif",
                        fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: VerticalOrigin.BOTTOM,
                        pixelOffset: new Cartesian2(0, -(h / 2) - 2),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: isAir ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
                    } : undefined,
                })
                sceneLocal.push({ type: "entity", ref: marker })
                markers.push({ marker, unit, startLat, startLon, alt })
            }
            // Animate toward the target using the same converge/surround/default
            // easing CommandRunner's old Leaflet "formation" handler used —
            // ported 1:1, just mutating a Cesium entity's position each frame
            // instead of calling Leaflet's marker.setLatLng.
            if (target && markers.length) {
                const [tLat, tLon] = target
                const hostileCount = markers.filter(m => m.unit.faction !== "subject").length
                const finalPositions = markers.map((m, idx) => {
                    if (m.unit.faction === "subject") return [tLat, tLon]
                    if (action.pattern === "surround") {
                        const angle  = (idx / Math.max(hostileCount, 1)) * Math.PI * 2
                        const radius = 0.045
                        return [tLat + Math.cos(angle) * radius, tLon + Math.sin(angle) * radius]
                    }
                    if (action.pattern === "converge") return [tLat, tLon]
                    return [m.startLat + (tLat - m.startLat) * 0.7, m.startLon + (tLon - m.startLon) * 0.7]
                })
                const DURATION  = 4_000
                const startTime = performance.now()
                const step = () => {
                    if (isAborted() || viewer.isDestroyed()) return
                    const elapsed  = performance.now() - startTime
                    const progress = Math.min(elapsed / DURATION, 1)
                    const eased    = 1 - Math.pow(1 - progress, 3)
                    markers.forEach((m, idx) => {
                        const [eLat, eLon] = finalPositions[idx]
                        const lat = m.startLat + (eLat - m.startLat) * eased
                        const lon = m.startLon + (eLon - m.startLon) * eased
                        try { m.marker.position = Cartesian3.fromDegrees(lon, lat, m.alt) } catch (_) {}
                    })
                    if (progress < 1) animFrames.push(requestAnimationFrame(step))
                }
                animFrames.push(requestAnimationFrame(step))
            }
            // Pulsing target circle
            if (target) {
                _renderSpotlight({ lat: target[0], lng: target[1], radius: 15_000, color: "#ef4444" }, viewer, sceneLocal)
            }
            break
        }

        case "show_satellite":
        case "analyse_satellite":
        case "toggle_layer":
        case "highlight_event":
        case "clear_highlights":
            // show_satellite/analyse_satellite: real imagery toggling happens via
            // CommandRunner's onSatelliteToggle callback → app.jsx state → GlobeView's
            // existing satelliteEnabled prop (the same Sentinel-2 overlay the manual
            // layer toggle uses) — nothing to add on the Cesium-entity side here.
            // toggle_layer/highlight_event/clear_highlights: pre-existing legacy
            // actions — CommandRunner already labels their setLayerOverrides/
            // setHighlights callbacks "kept for legacy compat"; nothing in the app
            // reads directorLayerOverrides/directorHighlights downstream (confirmed:
            // neither is passed to GlobeView or any layer), so there is no real
            // per-layer toggle or highlight-list rendering to hook these into today.
            // Left as an honest no-op rather than wiring a second, disconnected
            // toggle mechanism.
            break

        case "pin_images":
        case "country_info_overlay":
            // Deferred — see GlobeDirectorLayer.jsx history / task report for why:
            // both are elaborate multi-element DOM compositions (image collage with
            // collision-avoided offsets; a full-screen country statistic card) that
            // were never in this pass's priority list and would need meaningfully
            // more design work to port faithfully rather than as a rough
            // approximation. Explicitly a no-op, not a fabricated simplified version.
            break

        default:
            break
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════════════════════

export default function GlobeDirectorLayer({ scene }) {
    const { viewer } = useCesium()

    // Persistent across scene changes within the same scenario
    const persistentRef  = useRef([])
    const prevScenarioRef = useRef(null)

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return

        // Clear everything when scene is null (director stopped)
        if (!scene) {
            _removeHandles(viewer, persistentRef.current)
            prevScenarioRef.current = null
            return
        }

        // Per-effect local tracking (scene-local only)
        const sceneLocal = []
        const animFrames = []
        const intervals  = []
        const timeouts   = []
        // Keyed registry (visuals format only) — lets a later hide_*/unhighlight_*/
        // remove_* action in this same scene find and remove exactly the entities
        // an earlier show_*/highlight_*/place_* action in the scene added. See
        // _registerKeyed/_removeKeyed above.
        const keyed   = new Map()
        const removed = new Set()
        let aborted = false
        const isAborted = () => aborted

        // Scenario change → clear persistent layers
        if (scene.scenario !== prevScenarioRef.current) {
            _removeHandles(viewer, persistentRef.current)
            prevScenarioRef.current = scene.scenario
        }

        // Determine format: scene_elements (DemoRunner) vs visuals (CommandRunner)
        const isVisualsFormat = Array.isArray(scene.visuals)
        console.log(`[Director3D] scene="${scene.id || scene.title}" format=${isVisualsFormat ? "visuals" : "scene_elements"} elements=${isVisualsFormat ? scene.visuals?.length : scene.scene_elements?.length}`)

        if (isVisualsFormat) {
            // CommandRunner format — extract camera from fly_to action
            _flyToFromVisuals(viewer, scene.visuals)
            const narText = scene.narration?.text || scene.narration || ""
            const wordCount = narText.split(/\s+/).filter(Boolean).length
            const animDurMs = Math.max((wordCount / 2.5) * 1_000, 6_000)
            for (const action of scene.visuals) {
                _renderVisualAction(action, viewer, sceneLocal, persistentRef.current, animFrames, intervals, timeouts, isAborted, keyed, removed)
            }
        } else {
            // DemoRunner / scene_elements format
            _flyTo(viewer, scene.center, scene.zoom)
            const wordCount = (scene.narration || "").split(/\s+/).filter(Boolean).length
            const animDurMs = Math.max((wordCount / 2.5) * 1_000, 6_000)
            for (const el of (scene.scene_elements || [])) {
                if (el.type === "data_callout" || el.type === "chart") continue
                _renderElement(el, animDurMs, viewer, sceneLocal, persistentRef.current, animFrames, intervals, timeouts, isAborted)
            }
        }

        return () => {
            aborted = true
            _cancelTimers(animFrames, intervals, timeouts)
            _removeHandles(viewer, sceneLocal)
        }
    }, [viewer, scene]) // eslint-disable-line react-hooks/exhaustive-deps

    return null
}
