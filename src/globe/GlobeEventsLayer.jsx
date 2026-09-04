import { useState, useEffect, useRef } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getEntityMarkerDataUri } from "./entityIcons.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, EVENTS_CAP } from "./isMobile.js"

// Colours for legacy event_type classifier (keyword-based)
const TYPE_HEX = {
    missile:      "#ef4444",
    airstrike:    "#ef4444",
    assassination:"#ef4444",
    explosion:    "#f97316",
    armed_clash:  "#f97316",
    fight:        "#f97316",
    fire:         "#f97316",
    maritime:     "#3b82f6",
    protest:      "#eab308",
    earthquake:   "#a855f7",
    aviation:     "#38bdf8",
    energy:       "#facc15",
    medical:      "#22c55e",
}
const DEFAULT_HEX = "#64748b"

// Colours for LLM-extracted article_type / icon_type
const ARTICLE_TYPE_HEX = {
    conflict:       "#FF3B30",
    maritime:       "#34AADC",
    aviation:       "#5856D6",
    infrastructure: "#FF9500",
    energy:         "#FFCC00",
    cyber:          "#FF2D55",
    disaster:       "#FF6B35",
    political:      "#8E8E93",
    local_incident: "#30D158",
    economic:       "#636366",
    other:          "#636366",
}

function hexForEvent(ev) {
    const it = (ev.icon_type || ev.article_type || "").toLowerCase()
    if (it && ARTICLE_TYPE_HEX[it]) return ARTICLE_TYPE_HEX[it]
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_HEX[t] || DEFAULT_HEX
}

const ICON_CACHE = {}

function _hexToRgbArr(hex) {
    const n = parseInt(hex.replace("#", ""), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// entityIcons.js only hands back an SVG string/data URI (no synchronously-
// available pixels), unlike the old markerRenderer.js's getMarkerCanvas()
// which returned an already-drawn <canvas>. Decorating a tier-1 (breaking)
// icon with a glow ring + badge needs real pixels to compositie onto, so the
// base glyph has to be decoded through a real <img> first — that decode is
// inherently async. _loadedImage() caches the <img> per data URI so this
// only ever decodes once per (hex, tier, breaking) combination.
const _decodedImageCache = new Map()
function _loadedImage(dataUri) {
    let img = _decodedImageCache.get(dataUri)
    if (!img) {
        img = new Image()
        img.decoding = "async"
        img.src = dataUri
        _decodedImageCache.set(dataUri, img)
    }
    return img
}

function decorateTier1Icon(baseImg, hex, isBreaking) {
    const dpr  = Math.max(window.devicePixelRatio || 2, 2)
    const ring = isBreaking ? 14 : 10
    const bw   = baseImg.naturalWidth  || baseImg.width
    const bh   = baseImg.naturalHeight || baseImg.height
    const w    = bw + ring * 2
    const h    = bh + ring * 2 + (isBreaking ? 14 : 0)
    const canvas = document.createElement("canvas")
    canvas.width  = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)
    const cx = w / 2
    const cy = (bh + ring * 2) / 2
    const [r, g, b] = _hexToRgbArr(hex)
    // Outer glow ring
    ctx.beginPath()
    ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`
    ctx.lineWidth = 2
    ctx.stroke()
    // Inner pulse ring
    ctx.beginPath()
    ctx.arc(cx, cy, cx - 6, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`
    ctx.lineWidth = 1
    ctx.stroke()
    // Base icon
    ctx.drawImage(baseImg, ring, ring, bw, bh)
    // BREAKING badge
    if (isBreaking) {
        const by = bh + ring * 2 + 1
        ctx.fillStyle = "#FF3B30"
        ctx.beginPath()
        ctx.roundRect(cx - 18, by, 36, 12, 3)
        ctx.fill()
        ctx.fillStyle = "#fff"
        ctx.font = "bold 8px system-ui"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText("BREAKING", cx, by + 6)
    }
    return canvas
}

// News/event entity type is one glyph regardless of article sub-type (this
// product's real data doesn't distinguish sub-types finely enough to
// justify more than one glyph); sub-type is still conveyed via the accent
// colour (hexForEvent) exactly as before.
function getIcon(hex, tier, isBreaking) {
    const key = `${hex}-t${tier}-b${isBreaking ? 1 : 0}`
    if (ICON_CACHE[key]) return ICON_CACHE[key]

    const baseUri = getEntityMarkerDataUri({ entityType: "news_event", color: hex, size: 32 })
    if (tier !== 1) {
        ICON_CACHE[key] = baseUri
        return baseUri
    }

    // Tier-1 decoration needs the base glyph decoded to real pixels first
    // (see _loadedImage() above) — that's async, so the very first render
    // for a given (hex, tier, breaking) combination falls back to the plain
    // undecorated glyph for a frame or two; the decorated ring+badge version
    // gets cached and used automatically as soon as the image finishes
    // decoding and this component's next poll-driven re-render calls
    // getIcon() again (same fetch-then-swap pattern GlobeDirectorLayer's
    // async Wikipedia image already uses elsewhere in this codebase).
    const img = _loadedImage(baseUri)
    if (img.complete && img.naturalWidth > 0) {
        ICON_CACHE[key] = decorateTier1Icon(img, hex, !!isBreaking)
        return ICON_CACHE[key]
    }
    return baseUri
}

// Muted hex for low-relevance events (desaturate toward grey)
function mutedHex(hex) {
    try {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const grey = Math.round(r * 0.3 + g * 0.59 + b * 0.11)
        const mr = Math.round(r * 0.5 + grey * 0.5)
        const mg = Math.round(g * 0.5 + grey * 0.5)
        const mb = Math.round(b * 0.5 + grey * 0.5)
        return `#${mr.toString(16).padStart(2, "0")}${mg.toString(16).padStart(2, "0")}${mb.toString(16).padStart(2, "0")}`
    } catch (_) { return hex }
}

// Precision criteria: event_type or article_type matches conflict/maritime/aviation,
// or relevance_score >= 8.0
const PRECISION_EVENT_TYPES = new Set([
    "airstrike", "missile", "armed_clash", "explosion", "maritime",
    "chemical", "assassination",
])
const PRECISION_ARTICLE_TYPES = new Set(["conflict", "maritime", "aviation"])

function isPrecision(ev) {
    if (ev.tier === 1) return true
    const et = (ev.event_type || ev.type || "").toLowerCase()
    const at = (ev.icon_type || ev.article_type || "").toLowerCase()
    const rs = ev.relevance_score ?? 0
    return PRECISION_EVENT_TYPES.has(et) || PRECISION_ARTICLE_TYPES.has(at) || rs >= 8.0
}

export default function GlobeEventsLayer({
    enabled = true,
    precisionEnabled = true,
    bounds = null,
    minRelevance = 4,
}) {
    const [events, setEvents] = useState([])
    const anyEnabled = enabled || precisionEnabled

    useEffect(() => {
        if (!anyEnabled) { setEvents([]); return }
        let cancelled = false
        const load = () => {
            let url = `${API_BASE}/api/v2/events?mode=threads&max_age_hours=72&limit=500`
            if (bounds && bounds.south != null) {
                url += `&south=${bounds.south.toFixed(3)}&north=${bounds.north.toFixed(3)}&west=${bounds.west.toFixed(3)}&east=${bounds.east.toFixed(3)}`
            }
            return fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (!cancelled) setEvents(safeArray(d?.events)) })
                .catch(() => {})
        }
        load()
        const iv = setInterval(load, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [anyEnabled, bounds?.south, bounds?.north, bounds?.west, bounds?.east]) // eslint-disable-line react-hooks/exhaustive-deps

    // Register in entityStore so GlobePopup can render GlobeEventPopup
    useEffect(() => {
        if (!events.length) return
        const ids = []
        events.forEach(ev => {
            const id = `event-${ev.thread_id || ev.id}`
            setEntity(id, "event", ev)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [events])

    if (!anyEnabled || !events.length) return null

    // Determine which events to show:
    // - precisionEnabled only → precision events at full opacity, no relevance filter
    // - enabled only (or both) → apply minRelevance filter; precision events always pass
    const filtered = events.filter(ev => {
        // Never show country-level or unknown geocodes on the map
        if (ev.show_on_map === false) return false
        const prec = isPrecision(ev)
        if (precisionEnabled && prec) return true      // always show precision events
        if (!enabled) return false                      // general layer off
        // Numeric tier: tier 3 never shown; tier 1-2 pass through
        if (typeof ev.tier === "number") {
            if (ev.tier >= 3) return false
            return true
        }
        return (ev.relevance_score ?? 5) >= minRelevance
    })

    // Mobile: cap rendered events to prevent crash.
    const visible = isMobile ? filtered.slice(0, EVENTS_CAP) : filtered

    return (
        <>
            {visible.map(ev => {
                if (!ev.lat || !ev.lon || !isFinite(ev.lat) || !isFinite(ev.lon)) return null

                // Numeric tier (1=breaking, 2=significant, 3=local); fall back to
                // legacy relevance_tier string for articles ingested before the overhaul
                const numTier = typeof ev.tier === "number" ? ev.tier
                    : ev.relevance_tier === "high" ? 1
                    : ev.relevance_tier === "medium" ? 2 : 3
                const prec    = isPrecision(ev)
                const baseHex = hexForEvent(ev)
                const hex     = (!prec && numTier >= 3) ? mutedHex(baseHex) : baseHex
                const icon    = getIcon(hex, numTier, !!ev.is_breaking)
                if (!icon || icon.width === 0 || icon.height === 0) return null

                // Base icon size from location confidence
                const approxConf = ev.location_confidence || ""
                const isApprox = approxConf === "fallback_region" || approxConf === "relaxed" || approxConf === "fallback_country"
                const baseSize = isApprox ? 32 : 44

                // Tier-based scale and opacity
                let iconSize = baseSize
                let alpha    = 1.0
                if (!prec) {
                    if (numTier === 2) { iconSize = Math.round(baseSize * 0.8);  alpha = 0.85 }
                    if (numTier >= 3)  { iconSize = Math.round(baseSize * 0.55); alpha = 0.50 }
                }
                // Tier 1 icons get extra canvas space for the ring — account for it
                if (numTier === 1) {
                    const ring = ev.is_breaking ? 14 : 10
                    iconSize = baseSize + ring * 2
                }

                const cesiumColor = (isApprox || (numTier >= 2 && !prec))
                    ? Color.fromAlpha(Color.WHITE, Math.min(alpha, isApprox ? 0.6 : 1.0) * alpha)
                    : undefined

                // Tier 2 events hidden below 200km camera altitude (reduces clutter at street level)
                const ddc = numTier >= 2
                    ? new DistanceDisplayCondition(200_000, 15_000_000)
                    : new DistanceDisplayCondition(0, 15_000_000)

                return (
                    <Entity
                        id={`event-${ev.thread_id || ev.id}`}
                        key={ev.thread_id || ev.id}
                        position={Cartesian3.fromDegrees(ev.lon, ev.lat, 0)}
                        billboard={{
                            image:      icon,
                            width:      iconSize,
                            height:     iconSize,
                            color:      cesiumColor,
                            heightReference:          HeightReference.CLAMP_TO_GROUND,
                                                        distanceDisplayCondition: ddc,
                            eyeOffset:  new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
