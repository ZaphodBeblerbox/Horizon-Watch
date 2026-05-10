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
    PolylineDashMaterialProperty,
    ColorMaterialProperty,
    CallbackProperty,
    PolygonHierarchy,
    Math as CesiumMath,
} from "cesium"
import API_BASE from "../apiBase.js"

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
    // Default: always top-down. Oblique only when scene explicitly requests it.
    const pitch   = opts.camera_pitch   != null ? CesiumMath.toRadians(opts.camera_pitch)   : CesiumMath.toRadians(-90)
    const heading = opts.camera_heading != null ? CesiumMath.toRadians(opts.camera_heading) : CesiumMath.toRadians(0)
    viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(center[1], center[0], height),
        orientation: { heading, pitch, roll: 0 },
        duration: opts.duration != null ? opts.duration / 1000 : 2.5,
    })
}

// Extract fly_to from a visuals scene and fly — reads camera_heading/pitch
function _flyToFromVisuals(viewer, visuals) {
    const ft = (visuals || []).find(v => v.action === "fly_to")
    if (!ft) return
    _flyTo(viewer, [ft.lat, ft.lon], ft.zoom, {
        camera_heading: ft.camera_heading,
        camera_pitch:   ft.camera_pitch,
        duration:       ft.duration,
    })
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
        } catch (_) {}
    }
    handles.length = 0
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

function _renderFacilityMarker(el, viewer, sceneLocal, isAborted) {
    const c = Color.fromCssColorString(el.color || "#f59e0b")
    const e = viewer.entities.add({
        position: Cartesian3.fromDegrees(el.lng, el.lat, 0),
        point: {
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
            pixelOffset:              new Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference:          HeightReference.CLAMP_TO_GROUND,
        } : undefined,
    })
    sceneLocal.push({ type: "entity", ref: e })

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
    // Use slight altitude so PolylineDashMaterialProperty renders (not clampToGround)
    const positions = pts.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat, 50))
    const e = viewer.entities.add({
        polyline: {
            positions,
            width:    el.weight || 2,
            material: el.dashed !== false
                ? new PolylineDashMaterialProperty({ color: color.withAlpha(0.9), dashLength: 12 })
                : new ColorMaterialProperty(color.withAlpha(0.9)),
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
            material: el.dashed
                ? new PolylineDashMaterialProperty({ color: color.withAlpha(0.8), dashLength: 12 })
                : new ColorMaterialProperty(color.withAlpha(0.8)),
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
                material: new PolylineDashMaterialProperty({ color: c.withAlpha(0.75), dashLength: 16 }),
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
            material: new PolylineDashMaterialProperty({ color: c.withAlpha(0.6), dashLength: 8 }),
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

async function _renderCountryHighlight(el, viewer, sceneLocal, isAborted) {
    const geo = await _getCountries()
    if (!geo || isAborted() || viewer.isDestroyed()) return
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
    if (isAborted() || viewer.isDestroyed()) return
    if (fillDs) { viewer.dataSources.add(fillDs); sceneLocal.push({ type: "ds", ref: fillDs }) }

    // Outline — converted to LineStrings so clampToGround works
    const outlineDs = await GeoJsonDataSource.load(_polygonsToLines(fc), {
        stroke:        c.withAlpha(0.9),
        strokeWidth:   2,
        clampToGround: true,
    }).catch(() => null)
    if (isAborted() || viewer.isDestroyed()) return
    if (outlineDs) { viewer.dataSources.add(outlineDs); sceneLocal.push({ type: "ds", ref: outlineDs }) }
}

async function _renderChokepointFromDB(el, viewer, sceneLocal, isAborted) {
    const rawName = (el.name || el.chokepoint_name || "").toLowerCase().trim()
    try {
        const r = await fetch(`${API_BASE}/api/infrastructure/chokepoints?name=${encodeURIComponent(rawName)}`)
        if (!r.ok || isAborted() || viewer.isDestroyed()) return
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

        if (!feature || isAborted()) return
        const fc = { type: "FeatureCollection", features: [feature] }

        const fillDs = await GeoJsonDataSource.load(fc, {
            stroke: Color.TRANSPARENT, fill: c.withAlpha(0.08), strokeWidth: 0, clampToGround: true,
        }).catch(() => null)
        if (!isAborted() && fillDs && !viewer.isDestroyed()) {
            viewer.dataSources.add(fillDs); sceneLocal.push({ type: "ds", ref: fillDs })
        }

        const outlineDs = await GeoJsonDataSource.load(_polygonsToLines(fc), {
            stroke: c.withAlpha(0.75), strokeWidth: 2, clampToGround: true,
        }).catch(() => null)
        if (!isAborted() && outlineDs && !viewer.isDestroyed()) {
            viewer.dataSources.add(outlineDs); sceneLocal.push({ type: "ds", ref: outlineDs })
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
            _renderOverwatchScan(el, viewer, sceneLocal, intervals, isAborted)
            break

        case "detection_boxes":
            _renderDetectionBoxes(el, viewer, sceneLocal, timeouts, isAborted)
            break

        case "troop_deploy_interactive":
            _renderDeployZones(el, viewer, sceneLocal)
            break

        case "ship_animation":
            for (const v of (el.vessels || []))
                _spawnVessel(v, animDurMs, viewer, persistent, animFrames, isAborted)
            break

        case "flight_animation":
            for (const ac of (el.aircraft || []))
                _spawnVessel(ac, animDurMs, viewer, persistent, animFrames, isAborted)
            break

        case "troop_movement":
            _renderTroopMovement(el, animDurMs, viewer, persistent, animFrames, isAborted)
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

function _renderVisualAction(action, viewer, sceneLocal, persistent, animFrames, intervals, timeouts, isAborted) {
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
        case "click_event":
        case "click_location":
        case "click_vessel":
        case "click_aircraft":
        case "click_chokepoint":
        case "click_country":
        case "click_infrastructure":
        case "remove_event":
        case "remove_location":
        case "hide_vessel":
        case "hide_aircraft":
        case "hide_chokepoint":
        case "hide_satellite":
        case "hide_infrastructure":
        case "unhighlight_country":
        case "clear_country_highlights":
        case "clear_drawings":
        case "clear_all":
            // These are narration/UI/cleanup-only actions — no Cesium primitives needed
            break

        case "highlight_country": {
            const color = _CONTEXT_COLORS[action.context] || "#38bdf8"
            _renderCountryHighlight(
                { name: action.name, color },
                viewer, sceneLocal, isAborted
            )
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
                    material: action.dashed
                        ? new PolylineDashMaterialProperty({ color: c.withAlpha(0.85), dashLength: 12 })
                        : new ColorMaterialProperty(c.withAlpha(0.85)),
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
            const typeColors = {
                conflict: "#ef4444", maritime: "#3b82f6", political: "#8b5cf6",
                humanitarian: "#f59e0b", infrastructure: "#6366f1",
                economic: "#22c55e", military: "#ef4444",
            }
            _renderFacilityMarker({
                lat:   action.lat,
                lng:   action.lon,
                name:  action.title || "",
                color: typeColors[action.type] || "#f59e0b",
            }, viewer, sceneLocal, isAborted)
            break
        }

        case "place_location": {
            const locColors = {
                city: "#e2e8f0", base: "#ef4444", port: "#3b82f6",
                facility: "#f59e0b", landmark: "#a78bfa", target: "#ef4444",
            }
            _renderFacilityMarker({
                lat:   action.lat,
                lng:   action.lon,
                name:  action.name || "",
                color: locColors[action.type] || "#e2e8f0",
            }, viewer, sceneLocal, isAborted)
            break
        }

        case "place_image_marker": {
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
            }, viewer, sceneLocal, isAborted)
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
            }, viewer, sceneLocal, isAborted)
            break
        }

        case "show_chokepoint": {
            _renderChokepointFromDB(
                { name: action.name, color: "#f59e0b" },
                viewer, sceneLocal, isAborted
            )
            break
        }

        case "show_infrastructure": {
            _renderFacilityMarker({
                lat:   action.lat,
                lng:   action.lon,
                name:  action.name || "",
                color: "#6366f1",
            }, viewer, sceneLocal, isAborted)
            break
        }

        case "troop_movement": {
            // CommandRunner troop_movement uses same schema as scene_elements
            _renderTroopMovement(action, 15_000, viewer, persistent, animFrames, isAborted)
            break
        }

        case "formation": {
            for (const unit of (action.units || [])) {
                const color    = _VESSEL_FACTION_COLORS[unit.faction] || "#94a3b8"
                const iconType = unit.type === "ship" ? "destroyer" : unit.type === "aircraft" ? "fighter" : "infantry"
                // Place marker at unit's starting position
                const [w, h] = ICON_SIZES[iconType] || ICON_SIZES.default
                const billUrl = _makeBillboardUrl(iconType, color)
                const marker  = viewer.entities.add({
                    position: Cartesian3.fromDegrees(unit.lon ?? unit.lng ?? 0, unit.lat, unit.type === "aircraft" ? 8_000 : 0),
                    billboard: {
                        image:  billUrl, width: w, height: h,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: unit.type === "aircraft" ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
                    },
                    label: unit.label ? {
                        text: unit.label, font: "9px system-ui,sans-serif",
                        fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 2,
                        style: LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: VerticalOrigin.BOTTOM,
                        pixelOffset: new Cartesian2(0, -(h / 2) - 2),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        heightReference: unit.type === "aircraft" ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
                    } : undefined,
                })
                // Animate toward target if action.target exists
                if (action.target) {
                    const startLat = unit.lat, startLng = unit.lon ?? unit.lng ?? 0
                    const endLat   = action.target[0], endLng = action.target[1]
                    const dur      = 12_000
                    const start    = performance.now()
                    const isAir    = unit.type === "aircraft"
                    const alt      = isAir ? 8_000 : 0
                    function step() {
                        if (isAborted() || viewer.isDestroyed()) return
                        const p = Math.min((performance.now() - start) / dur, 1)
                        const lat = startLat + (endLat - startLat) * p
                        const lng = startLng + (endLng - startLng) * p
                        marker.position = Cartesian3.fromDegrees(lng, lat, alt)
                        if (p < 1) animFrames.push(requestAnimationFrame(step))
                    }
                    animFrames.push(requestAnimationFrame(step))
                }
                sceneLocal.push({ type: "entity", ref: marker })
            }
            // Pulsing target circle
            if (action.target) {
                _renderSpotlight({
                    lat: action.target[0], lng: action.target[1],
                    radius: 15_000, color: "#ef4444",
                }, viewer, sceneLocal)
            }
            break
        }

        case "show_satellite":
        case "analyse_satellite":
            // Satellite imagery handled separately by GlobeView satellite toggle
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
                _renderVisualAction(action, viewer, sceneLocal, persistentRef.current, animFrames, intervals, timeouts, isAborted)
            }
        } else {
            // DemoRunner / scene_elements format
            _flyTo(viewer, scene.center, scene.zoom, {
                camera_heading: scene.camera_heading,
                camera_pitch:   scene.camera_pitch,
            })
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
