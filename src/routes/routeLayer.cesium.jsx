/**
 * routeLayer.cesium.jsx — the route plan on the desktop globe (store.js
 * publishPlan, from RoutePanel.jsx; mounted inside the Viewer): each danger as
 * a red ring (outer radius) around a darker core, labelled; the fastest
 * route grey and dashed; the safest green; the start and the safe point.
 * Flies there when a plan first arrives.
 */
import { useEffect, useRef } from "react"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, Color, HeightReference, LabelStyle, PolylineDashMaterialProperty, PolylineOutlineMaterialProperty } from "cesium"
import { useRoutePanel } from "./usePlan.js"
import { useRenderTick } from "../globe/useGlidingPosition.js"
import { isEvacuation, itineraryLines, itineraryStops } from "../evacuation/itinerary.js"

// LINES A FEW METRES UP, NOT CLAMPED: a ground polyline needs GPU support some
// machines (and headless checks) lack, and then draws nothing; with a
// depth-fail material the line still shows where terrain rises over it.
const flat = (coords) => Cartesian3.fromDegreesArrayHeights(coords.flatMap(([lat, lon]) => [lon, lat, 4]))
const RED = Color.fromCssColorString("#E5484D")

export default function GlobeRouteLayer() {
    const v = useRoutePanel()
    const { viewer } = useCesium() || {}
    const flown = useRef(null)
    const plan = v.open ? v.plan : null
    useEffect(() => { if (viewer && !viewer.isDestroyed?.()) viewer.scene?.requestRender?.() })
    // the rings and lines are built off the main thread; the scene renders on request only,
    // so keep asking while a plan is on show or they appear only at the next camera move
    useRenderTick(!!plan?.origin, 1000)
    useEffect(() => {
        if (!plan?.origin) return
        const key = `${plan.origin.lat},${plan.origin.lon}`
        if (flown.current === key) return
        flown.current = key
        const far = isEvacuation(plan)
            ? Math.max(1500, ...itineraryStops(plan).map((p) => Math.hypot((p.lat - plan.origin.lat) * 111_000, (p.lon - plan.origin.lon) * 111_000 * Math.cos(plan.origin.lat * Math.PI / 180))))
            : Math.max(1500, ...[plan.safest, plan.fastest].filter(Boolean).map((r) => r.distance_m))
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: plan.origin.lat, lon: plan.origin.lon, altitude: Math.min(isEvacuation(plan) ? 2_500_000 : 25_000, far * 2.4) } }))
    }, [plan])
    if (!plan?.origin) return null
    if (isEvacuation(plan)) return <EvacuationLegs plan={plan} />
    const f = plan.fastest
    const s = (plan.selected && (plan.candidates || []).find((c) => c.key === plan.selected)) || plan.safest
    return (
        <>
            {(plan.hazards || []).map((h) => {
                const w = Math.max(0.1, Math.min(1, h.weight || 0.5))
                return [
                    <Entity key={`hz-${h.id}`} id={`hazard-ring-${h.id}`} name={h.label} description={`${h.what || ""} — ${h.source?.label || ""}`}
                            position={Cartesian3.fromDegrees(h.lon, h.lat)}
                            ellipse={{ semiMajorAxis: h.radius_m, semiMinorAxis: h.radius_m, material: RED.withAlpha(0.08 + 0.18 * w),
                                       outline: true, outlineColor: RED.withAlpha(0.6 + 0.4 * w), outlineWidth: 2, height: 0 }}   /* unclamped: Cesium drops a clamped ellipse's outline */
                            label={{ text: `${h.label}${h.place ? `\n${String(h.place).split(",")[0]}` : ""}`, font: "600 12.5px sans-serif",
                                     fillColor: Color.WHITE, outlineColor: Color.fromCssColorString("#5a0d10"), outlineWidth: 4,
                                     style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -12),
                                     heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }} />,
                    <Entity key={`hc-${h.id}`} id={`hazard-core-${h.id}`} position={Cartesian3.fromDegrees(h.lon, h.lat)}
                            ellipse={{ semiMajorAxis: h.core_m, semiMinorAxis: h.core_m, material: RED.withAlpha(0.38), height: 0 }} />,
                ]
            })}
            {f && (!s || f.key !== s.key) && (
                <Entity id="route-fastest" name="Fastest route" polyline={{ positions: flat(f.coords), width: 5, clampToGround: false,
                    material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#9aa3ad"), dashLength: 18 }), depthFailMaterial: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#9aa3ad"), dashLength: 18 }) }} />
            )}
            {s && (
                <Entity id="route-safest" name="Safest route" polyline={{ positions: flat(s.coords), width: 7, clampToGround: false,
                    material: new PolylineOutlineMaterialProperty({ color: Color.fromCssColorString("#3ddc84"), outlineColor: Color.fromCssColorString("#0b3d1f"), outlineWidth: 2 }), depthFailMaterial: new PolylineOutlineMaterialProperty({ color: Color.fromCssColorString("#3ddc84"), outlineColor: Color.fromCssColorString("#0b3d1f"), outlineWidth: 2 }) }} />
            )}
            {s && (
                <Entity id="route-dest" name={s.dest?.name || "Safe point"} position={Cartesian3.fromDegrees(s.coords[s.coords.length - 1][1], s.coords[s.coords.length - 1][0])}
                        point={{ pixelSize: 15, color: Color.fromCssColorString("#3ddc84"), outlineColor: Color.WHITE, outlineWidth: 2,
                                 heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }}
                        label={{ text: "Safe point", font: "600 12px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                                 style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -18),
                                 heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }} />
            )}
            <Entity id="route-origin" name="Start" position={Cartesian3.fromDegrees(plan.origin.lon, plan.origin.lat)}
                    point={{ pixelSize: 14, color: Color.fromCssColorString("#3b8cff"), outlineColor: Color.WHITE, outlineWidth: 3,
                             heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }} />
        </>
    )
}

/** AN EVACUATION (evacuation.py): each leg of the chosen itinerary in its colour (air and
 *  sea dashed), the change points, the safe house, the start. */
function EvacuationLegs({ plan }) {
    const lines = itineraryLines(plan, plan.selected)
    const stops = itineraryStops(plan, plan.selected)
    const label = { font: "600 12.5px sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cartesian2(0, -18), heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }
    return (
        <>
            {(plan.hazards || []).slice(0, 40).map((h) => (
                <Entity key={`hz-${h.id}`} id={`hazard-ring-${h.id}`} name={h.label} position={Cartesian3.fromDegrees(h.lon, h.lat)}
                        ellipse={{ semiMajorAxis: h.radius_m, semiMinorAxis: h.radius_m, material: RED.withAlpha(0.18), outline: true, outlineColor: RED, outlineWidth: 2, height: 0 }} />
            ))}
            {lines.map((ln, i) => {
                const c = Color.fromCssColorString(ln.color)
                const mat = ln.dashed ? new PolylineDashMaterialProperty({ color: c, dashLength: 22 })
                    : new PolylineOutlineMaterialProperty({ color: c, outlineColor: Color.fromCssColorString("#0b1d2e"), outlineWidth: 2 })
                return <Entity key={`leg-${i}`} id={`evac-leg-${i}`} name={`Evacuation leg ${i + 1}`}
                               polyline={{ positions: ln.kind === "air" ? Cartesian3.fromDegreesArrayHeights(ln.coords.flatMap(([lat, lon]) => [lon, lat, 9000])) : flat(ln.coords),
                                           width: 7, clampToGround: false, material: mat, depthFailMaterial: mat }} />
            })}
            {stops.map((st, i) => (
                <Entity key={`st-${i}`} id={`evac-stop-${i}`} name={st.name} position={Cartesian3.fromDegrees(st.lon, st.lat)}
                        point={{ pixelSize: st.kind === "safe_house" ? 16 : 11, color: Color.fromCssColorString(st.kind === "safe_house" ? "#2E9E5B" : st.kind === "border" ? "#F5A524" : "#8fb4e8"),
                                 outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }}
                        label={{ ...label, text: st.name || "" }} />
            ))}
            <Entity id="route-origin" name="Start" position={Cartesian3.fromDegrees(plan.origin.lon, plan.origin.lat)}
                    point={{ pixelSize: 14, color: Color.fromCssColorString("#3b8cff"), outlineColor: Color.WHITE, outlineWidth: 3,
                             heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }} />
        </>
    )
}
