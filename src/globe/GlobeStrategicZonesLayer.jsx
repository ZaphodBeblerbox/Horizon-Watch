import { useState, useEffect, useCallback, useRef } from "react"
import { Entity } from "resium"
import { useCesium } from "resium"
import {
    Cartesian3, Color,
    PolygonHierarchy, NearFarScalar,
    DistanceDisplayCondition, SceneTransforms,
} from "cesium"
import API_BASE from "../apiBase.js"
import GlobeStrategicZoneTooltip from "./GlobeStrategicZoneTooltip.jsx"

const ALPHA_FILL      = 0.12
const ALPHA_FILL_SEL  = 0.25
const ALPHA_OUTLINE   = 0.85
const ALPHA_LABEL     = 0.9
const TW = 320  // tooltip width
const TH = 420  // tooltip approximate height

function parseColour(hex, alpha) {
    try {
        return Color.fromCssColorString(hex || "#FF9500").withAlpha(alpha)
    } catch {
        return Color.fromCssColorString("#FF9500").withAlpha(alpha)
    }
}

function zoneCentroid(zone) {
    const coords = zone.coordinates || []
    if (!coords.length) return { lon: zone.lon, lat: zone.lat }
    const lons = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    return {
        lon: lons.reduce((a, b) => a + b, 0) / lons.length,
        lat: lats.reduce((a, b) => a + b, 0) / lats.length,
    }
}

function clamp(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight
    return {
        x: Math.min(Math.max(x, 10), vw - TW - 10),
        y: Math.min(Math.max(y, 10), vh - TH - 10),
    }
}

export default function GlobeStrategicZonesLayer({ enabled }) {
    const { viewer }       = useCesium()
    const [zones,          setZones]          = useState([])
    const [selectedZone,   setSelectedZone]   = useState(null)
    const [tooltipPos,     setTooltipPos]     = useState({ x: 0, y: 0 })
    const [tooltipVisible, setTooltipVisible] = useState(false)
    const centroidRef = useRef(null)  // Cartesian3 of selected zone centroid

    const load = useCallback(() => {
        fetch(`${API_BASE}/api/strategic-zones?enabled_only=true`)
            .then(r => r.ok ? r.json() : [])
            .then(setZones)
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (!enabled) return
        load()
        const id = setInterval(load, 120_000)
        return () => clearInterval(id)
    }, [enabled, load])

    // postRender: reproject zone centroid to screen every frame
    useEffect(() => {
        if (!viewer || !selectedZone) return

        const scene = viewer.scene
        const handler = () => {
            const c = centroidRef.current
            if (!c) return
            const sp = SceneTransforms.worldToWindowCoordinates(scene, c)
            const vw = window.innerWidth, vh = window.innerHeight
            const vis = sp && sp.x > 0 && sp.x < vw && sp.y > 0 && sp.y < vh
            if (vis) {
                const clamped = clamp(sp.x + 20, sp.y - 160)
                setTooltipPos(clamped)
                setTooltipVisible(true)
            } else {
                setTooltipVisible(false)
            }
        }

        const remove = scene.postRender.addEventListener(handler)
        return () => { remove() }
    }, [viewer, selectedZone])

    const handleZoneClick = useCallback((zone, clickX, clickY) => {
        if (selectedZone?.zone_id === zone.zone_id) {
            setSelectedZone(null)
            centroidRef.current = null
            setTooltipVisible(false)
            return
        }
        const { lon, lat } = zoneCentroid(zone)
        centroidRef.current = Cartesian3.fromDegrees(lon, lat)
        setSelectedZone(zone)
        setTooltipPos(clamp(clickX + 20, clickY - 160))
        setTooltipVisible(true)
    }, [selectedZone])

    const handleClose = useCallback(() => {
        setSelectedZone(null)
        centroidRef.current = null
        setTooltipVisible(false)
    }, [])

    // Deep-link entry point: a report claim citing this zone. Unlike other
    // snapshot sections, a strategic_zones snapshot item carries no lat/lon
    // (see briefing_prep.py) — this layer already holds the real live
    // polygon, so it (not the deep-link resolver) is the one real source for
    // both the camera fly-to and the tooltip. Dispatched by
    // src/services/reportDeepLink.js.
    useEffect(() => {
        const handler = (e) => {
            const zoneId = e.detail?.zone_id
            if (!zoneId) return
            const zone = zones.find(z => String(z.zone_id) === String(zoneId))
            if (!zone) return  // zone no longer enabled/live — honest no-op
            const { lon, lat } = zoneCentroid(zone)
            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 300000 } }))
            handleZoneClick(zone, window.innerWidth / 2, window.innerHeight / 2)
        }
        window.addEventListener("akili:show-zone", handler)
        return () => window.removeEventListener("akili:show-zone", handler)
    }, [zones, handleZoneClick])

    if (!enabled || !zones.length) return null

    return (
        <>
            {zones.map(z => {
                const coords = z.coordinates || []
                if (coords.length < 3) return null

                const positions = coords
                    .filter(c => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]))
                    .map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, 0))

                if (positions.length < 3) return null

                const isSel   = selectedZone?.zone_id === z.zone_id
                const fill    = parseColour(z.colour, isSel ? ALPHA_FILL_SEL : ALPHA_FILL)
                const outline = parseColour(z.colour, ALPHA_OUTLINE)

                return (
                    <Entity
                        key={z.zone_id}
                        id={`szone-${z.zone_id}`}
                        name={z.name}
                        polygon={{
                            hierarchy:    new PolygonHierarchy(positions),
                            material:     fill,
                            outline:      true,
                            outlineColor: outline,
                            outlineWidth: isSel ? 3.0 : 1.5,
                            height:       0,
                            classificationType: 0,
                        }}
                        label={{
                            text:               z.name,
                            font:               "500 11px Inter, sans-serif",
                            fillColor:          Color.WHITE.withAlpha(ALPHA_LABEL),
                            outlineColor:       Color.BLACK.withAlpha(0.6),
                            outlineWidth:       2,
                            style:              2,
                            pixelOffset:        { x: 0, y: 0 },
                            scaleByDistance:    new NearFarScalar(500_000, 1.0, 4_000_000, 0.55),
                            translucencyByDistance: new NearFarScalar(500_000, 1.0, 5_000_000, 0.0),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 5_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                            showBackground:     true,
                            backgroundColor:    parseColour(z.colour, 0.22),
                            backgroundPadding:  { x: 6, y: 3 },
                        }}
                        position={Cartesian3.fromDegrees(z.lon, z.lat, 0)}
                        onClick={(movement) => {
                            const pos = movement?.position
                            handleZoneClick(
                                z,
                                pos?.x ?? window.innerWidth  / 2,
                                pos?.y ?? window.innerHeight / 2,
                            )
                        }}
                    />
                )
            })}

            {selectedZone && (
                <GlobeStrategicZoneTooltip
                    zone={selectedZone}
                    x={tooltipPos.x}
                    y={tooltipPos.y}
                    visible={tooltipVisible}
                    onClose={handleClose}
                />
            )}
        </>
    )
}
