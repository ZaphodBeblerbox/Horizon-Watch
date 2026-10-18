/**
 * airLayer.cesium.jsx — a flight-route plan on the desktop globe (from the
 * Flights panel, airRoute.js publishAirPlan; mounted inside the Viewer):
 * the hazard zones shaded by kind (conflict-zone bulletins red, GPS
 * interference amber, strikes orange-red), each candidate as a great-circle
 * arc lifted above the ground (climb, cruise, descent — NOT to scale, so it
 * reads at continental zoom), the selected one bright and on top; the two
 * ends. Flies to frame the paths when a plan first arrives.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian2, Cartesian3, Color, LabelStyle, PolygonHierarchy, PolylineDashMaterialProperty, PolylineGlowMaterialProperty, ArcType,
    NearFarScalar,
} from "cesium"
import { getAirRoute, subscribeAirRoute, hazardColor, hazardAlpha, candidateColor, arcDegreesHeights, arcPeak, planView } from "./airRoute.js"
import { MARKER_DEPTH_TEST_M } from "../../globe/entityIcons.js"

function useAir() {
    const [s, setS] = useState(getAirRoute())
    useEffect(() => subscribeAirRoute(setS), [])
    return s
}

const ringCentre = (ring) => {
    const n = ring.length
    return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n]
}

export default function GlobeAirRouteLayer() {
    const s = useAir()
    const { viewer } = useCesium() || {}
    const flown = useRef(null)
    const plan = s.plan       // from the Flights panel, or the shared route panel's Flights mode
    useEffect(() => { if (viewer && !viewer.isDestroyed?.()) viewer.scene?.requestRender?.() })
    useEffect(() => {
        if (!plan?.candidates?.length) return
        const key = plan.generated_at
        if (flown.current === key) return
        flown.current = key
        const v = planView(plan)
        if (v) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: v }))
    }, [plan])
    const touched = useMemo(() => new Set((plan?.candidates || []).flatMap((c) => (c.score?.crossings || []).map((x) => x.id))), [plan])
    if (!plan?.candidates?.length) return null
    const sel = plan.selected || s.selected || plan.recommended
    const order = [...plan.candidates].sort((a, b) => (a.key === sel) - (b.key === sel))
    const first = plan.candidates[0].coords
    const ends = [[first[0], plan.origin?.code || plan.origin?.name || "From", "#3b8cff"],
                  [first[first.length - 1], plan.destination?.code || plan.destination?.name || "To", "#3ddc84"]]
    return (
        <>
            {(plan.hazards || []).flatMap((h) => (h.rings || []).map((ring, i) => {
                const col = Color.fromCssColorString(hazardColor(h))
                return (
                    <Entity key={`air-hz-${h.id}-${i}`} id={`air-hazard-${h.id}-${i}`} name={h.name} description={`${h.kind_label || ""} — ${h.why || ""}`}
                            polygon={{ hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring.flatMap(([la, lo]) => [lo, la]))),
                                       material: col.withAlpha(hazardAlpha(h)), height: 0, outline: true,
                                       outlineColor: col.withAlpha(touched.has(h.id) ? 0.95 : 0.5), arcType: ArcType.RHUMB }} />
                )
            }))}
            {(plan.hazards || []).filter((h) => touched.has(h.id) && h.rings?.length).slice(0, 10).map((h) => {
                const big = h.rings.reduce((a, r) => (r.length > a.length ? r : a), h.rings[0])
                const [la, lo] = ringCentre(big)
                return (
                    <Entity key={`air-hl-${h.id}`} id={`air-hazard-label-${h.id}`} position={Cartesian3.fromDegrees(lo, la, 2000)}
                            label={{ text: h.name.replace(/ \(.*\)$/, ""), font: "600 13px -apple-system, 'Segoe UI', Roboto, sans-serif", fillColor: Color.WHITE,
                                     outlineColor: Color.fromCssColorString("#3a0a0c"), outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
                                     pixelOffset: new Cartesian2(0, 0), disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                                     translucencyByDistance: new NearFarScalar(2e6, 1, 2.5e7, 0.6) }} />
                )
            })}
            {order.map((c) => {
                const on = c.key === sel
                const col = Color.fromCssColorString(candidateColor(c))
                const positions = Cartesian3.fromDegreesArrayHeights(arcDegreesHeights(c.coords, arcPeak(c.score?.distance_km)))
                return (
                    <Entity key={`air-c-${c.key}`} id={`air-route-${c.key}`} name={c.label}
                            polyline={{ positions, width: on ? 9 : 4, arcType: ArcType.NONE,
                                        material: on ? new PolylineGlowMaterialProperty({ color: col, glowPower: 0.22 })
                                            : c.key === "direct" ? new PolylineDashMaterialProperty({ color: col.withAlpha(0.85), dashLength: 20 }) : col.withAlpha(0.8) }} />
                )
            })}
            {plan.flown?.length > 1 && (
                <Entity id="air-flown" name="Flown so far" polyline={{ positions: Cartesian3.fromDegreesArrayHeights(arcDegreesHeights(plan.flown, 0)), width: 3, arcType: ArcType.GEODESIC,
                                                                        material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#8fb4e8"), dashLength: 10 }) }} />
            )}
            {ends.map(([p, name, css], i) => (
                <Entity key={`air-end-${i}`} id={`air-end-${i}`} name={name} position={Cartesian3.fromDegrees(p[1], p[0], 0)}
                        point={{ pixelSize: 13, color: Color.fromCssColorString(css), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: MARKER_DEPTH_TEST_M }}
                        label={{ text: name, font: "700 13px -apple-system, 'Segoe UI', Roboto, sans-serif", fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
                                 style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -18), disableDepthTestDistance: MARKER_DEPTH_TEST_M }} />
            ))}
        </>
    )
}
