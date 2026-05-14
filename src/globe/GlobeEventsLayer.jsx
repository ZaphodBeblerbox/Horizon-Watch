import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { makeTypedEventCanvas } from "./iconUtils.js"
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

// Colours for LLM-extracted article_type
const ARTICLE_TYPE_HEX = {
    conflict:       "#FF3B30",
    maritime:       "#34AADC",
    aviation:       "#5856D6",
    infrastructure: "#FF9500",
    energy:         "#FFCC00",
    political:      "#8E8E93",
    economic:       "#30D158",
    cyber:          "#FF2D55",
    disaster:       "#FF6B35",
    other:          "#8E8E93",
}

const TYPE_MAP = {
    missile:      "missile",
    airstrike:    "explosion",
    explosion:    "explosion",
    armed_clash:  "armed_clash",
    fight:        "armed_clash",
    maritime:     "maritime",
    protest:      "protest",
    earthquake:   "earthquake",
    fire:         "fire",
    aviation:     "aviation",
    energy:       "energy",
    medical:      "medical",
}

function hexForEvent(ev) {
    // Prefer LLM article_type colour if available
    const at = (ev.article_type || "").toLowerCase()
    if (at && ARTICLE_TYPE_HEX[at]) return ARTICLE_TYPE_HEX[at]
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_HEX[t] || DEFAULT_HEX
}

function typeForEvent(ev) {
    const t = (ev.event_type || ev.type || "").toLowerCase()
    return TYPE_MAP[t] || "general"
}

const ICON_CACHE = {}
function getIcon(type, hex) {
    const key = `${type}-${hex}`
    if (!ICON_CACHE[key]) ICON_CACHE[key] = makeTypedEventCanvas(type, hex)
    return ICON_CACHE[key]
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
    const et = (ev.event_type || ev.type || "").toLowerCase()
    const at = (ev.article_type || "").toLowerCase()
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
                .then(d => { if (!cancelled) setEvents(d?.events || []) })
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
        const prec = isPrecision(ev)
        if (precisionEnabled && prec) return true      // always show precision events
        if (!enabled) return false                      // general layer off
        return (ev.relevance_score ?? 5) >= minRelevance
    })

    // Mobile: cap rendered events to prevent crash.
    const visible = isMobile ? filtered.slice(0, EVENTS_CAP) : filtered

    return (
        <>
            {visible.map(ev => {
                if (!ev.lat || !ev.lon || !isFinite(ev.lat) || !isFinite(ev.lon)) return null

                const tier = (ev.relevance_tier || "medium").toLowerCase()
                const prec    = isPrecision(ev)
                const baseHex = hexForEvent(ev)
                const hex   = (!prec && tier === "low") ? mutedHex(baseHex) : baseHex
                const type  = typeForEvent(ev)
                const icon  = getIcon(type, hex)
                if (!icon || icon.width === 0 || icon.height === 0) return null

                // Base icon size from location confidence
                const approxConf = ev.location_confidence || ""
                const isApprox = approxConf === "fallback_region" || approxConf === "relaxed" || approxConf === "fallback_country"
                const baseSize = isApprox ? 32 : 44

                // Precision events always render at full size/opacity
                let iconSize = baseSize
                let alpha    = 1.0
                if (!prec) {
                    if (tier === "medium") { iconSize = Math.round(baseSize * 0.7); alpha = 0.75 }
                    if (tier === "low")    { iconSize = Math.round(baseSize * 0.5); alpha = 0.45 }
                }

                const cesiumColor = (isApprox || (tier !== "high" && !prec))
                    ? Color.fromAlpha(Color.WHITE, Math.min(alpha, isApprox ? 0.6 : 1.0) * alpha)
                    : undefined

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
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 8_000_000, 0.25),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                            eyeOffset:  new Cartesian3(0, 0, -50),
                        }}
                    />
                )
            })}
        </>
    )
}
