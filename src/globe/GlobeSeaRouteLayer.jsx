/**
 * GlobeSeaRouteLayer.jsx — the sea-route plan on the desktop globe
 * (routes/modes/maritimeCore.js publishSeaPlan, from MaritimeRoute.jsx;
 * mounted inside the Viewer): hazard zones shaded by kind with their names,
 * GPS-interference cells as faint discs, every candidate on the sea (the
 * recommended green, the others dashed grey, the selected one blue), the
 * start and the destination. Flies to the whole voyage when a plan arrives.
 */
import { useEffect, useMemo, useRef } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, LabelStyle, PolygonHierarchy, PolylineDashMaterialProperty, PolylineOutlineMaterialProperty, NearFarScalar } from "cesium"
import { useSeaRoute } from "../routes/modes/MaritimeRoute.jsx"
import { hazardColor, ringLatLngs } from "../routes/modes/maritimeCore.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

const line = (coords) => Cartesian3.fromDegreesArray(coords.flatMap(([lat, lon]) => [lon, lat]))
const css = (c) => Color.fromCssColorString(c)

function centroid(ring) {
    const n = ring.length - 1 || 1
    let a = 0, b = 0
    for (let i = 0; i < n; i++) { a += ring[i][0]; b += ring[i][1] }
    return [a / n, b / n]
}

export default function GlobeSeaRouteLayer() {
    const s = useSeaRoute()
    const { viewer } = useCesium() || {}
    const flown = useRef(null)
    const plan = s.open ? s.plan : null
    useEffect(() => { if (viewer && !viewer.isDestroyed?.()) viewer.scene?.requestRender?.() })
    useEffect(() => {
        if (!plan?.candidates?.length) return
        const key = `${plan.origin.lat},${plan.origin.lon}>${plan.destination.lat},${plan.destination.lon}`
        if (flown.current === key) return
        flown.current = key
        const all = plan.candidates.flatMap((c) => c.coords)
        const lats = all.map((p) => p[0]), lons = all.map((p) => p[1])
        const [s0, n0, w0, e0] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
        const spanKm = Math.max((n0 - s0) * 111, (e0 - w0) * 111 * Math.cos(((n0 + s0) / 2) * Math.PI / 180))
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 + (e0 - w0) * 0.12, altitude: Math.min(24_000_000, Math.max(2_000_000, spanKm * 1000 * 1.6)) } }))
    }, [plan])
    // Positions and materials made once per plan: new objects on every render
    // make Cesium rebuild the (asynchronous) ground polylines forever, and they never show.
    const sel = plan ? (plan.selected || plan.recommended) : null
    const routes = useMemo(() => {
        if (!plan?.candidates?.length) return []
        return [...plan.candidates].sort((a, b) => (a.key === sel) - (b.key === sel)).map((c) => {
            const on = c.key === sel
            const color = c.recommended ? "#3ddc84" : on ? "#5cc8ff" : "#b8c0c8"
            return { c, on, positions: line(c.coords),
                     material: on ? new PolylineOutlineMaterialProperty({ color: css(color), outlineColor: css("#0b2d3d"), outlineWidth: 2 })
                                  : new PolylineDashMaterialProperty({ color: css(color), dashLength: 20 }) }
        })
    }, [plan?.candidates, sel])                                            // eslint-disable-line react-hooks/exhaustive-deps
    const zones = useMemo(() => (plan?.hazards || []).map((h) => {
        const col = css(hazardColor(h))
        if (h.shape !== "polygon") return { h, col }
        const ring = ringLatLngs(h)
        return { h, col, hierarchy: new PolygonHierarchy(line(ring)), at: centroid(ring) }
    }), [plan?.hazards])                                                   // eslint-disable-line react-hooks/exhaustive-deps
    if (!plan?.candidates?.length) return null
    const ordered = routes.map((r) => r.c)
    return (
        <>
            {zones.map(({ h, col, hierarchy, at }) => {
                if (h.shape === "polygon") {
                    const [la, lo] = at
                    return [
                        <Entity key={`sz-${h.id}`} id={`sea-zone-${h.id}`} name={h.name} description={`${h.why}`}
                                polygon={{ hierarchy, material: col.withAlpha(0.14 + 0.22 * Math.min(1, h.weight)),
                                           outline: true, outlineColor: col.withAlpha(0.85), height: 0 }} />,
                        <Entity key={`szl-${h.id}`} id={`sea-zone-label-${h.id}`} position={Cartesian3.fromDegrees(lo, la)}
                                label={{ text: h.name, font: "600 12.5px -apple-system, 'Segoe UI', Roboto, sans-serif", fillColor: Color.WHITE,
                                         outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                                         pixelOffset: new Cartesian2(0, 0), 
                                         disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />,
                    ]
                }
                return null            // no fixed-ground-size disc (owner, 2026-10-23): the cell's name above is its mark
            })}
            {routes.map(({ c, on, positions, material }) => (
                <Entity key={`sr-${c.key}`} id={`sea-route-${c.recommended ? "recommended" : c.key}`} name={`${c.label} — ${c.days} days, ${c.distance_nm} nm`}
                        polyline={{ positions, width: on ? 6 : 3.5, clampToGround: true, material }} />
            ))}
            {ordered.map((c) => {
                const mid = c.coords[Math.floor(c.coords.length / 2)]
                return <Entity key={`srl-${c.key}`} id={`sea-route-label-${c.key}`} position={Cartesian3.fromDegrees(mid[1], mid[0])}
                               label={{ text: `${c.label}\n${c.days} days · ${c.distance_nm.toLocaleString("en-GB")} nm`, font: "600 13px -apple-system, 'Segoe UI', Roboto, sans-serif",
                                        fillColor: css(c.recommended ? "#3ddc84" : "#e6e9ee"), outlineColor: Color.BLACK, outlineWidth: 3,
                                        style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            })}
            <Entity id="sea-origin" name={plan.origin.name || "Start"} position={Cartesian3.fromDegrees(plan.origin.lon, plan.origin.lat)}
                    point={{ pixelSize: 13, color: css("#3b8cff"), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: MARKER_DEPTH_TEST_M }}
                    label={{ text: plan.origin.name || "Start", font: "600 12px -apple-system, 'Segoe UI', Roboto, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                             style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            <Entity id="sea-destination" name={plan.destination.name || "Destination"} position={Cartesian3.fromDegrees(plan.destination.lon, plan.destination.lat)}
                    point={{ pixelSize: 13, color: css("#3ddc84"), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: MARKER_DEPTH_TEST_M }}
                    label={{ text: plan.destination.name || "Destination", font: "600 12px -apple-system, 'Segoe UI', Roboto, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                             style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
        </>
    )
}
