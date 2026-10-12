/**
 * airLayer.leaflet.js — a flight-route plan on a Leaflet map (the phone):
 * the hazard zones shaded by kind, every candidate path (the selected one on
 * top, thicker), the two ends. Returns the bounds to fit, or null.
 */
import { hazardColor, hazardAlpha, candidateColor } from "./airRoute.js"

/** Longitudes made continuous so a path across ±180 is not drawn round the world. */
export function continuous(coords) {
    let prev = null
    return (coords || []).map(([lat, lon]) => {
        let x = lon
        if (prev !== null) { while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360 }
        prev = x
        return [lat, x]
    })
}

export function drawAirPlan(L, group, plan, selected) {
    group.clearLayers()
    if (!plan?.candidates?.length) return null
    const touched = new Set(plan.candidates.flatMap((c) => (c.score?.crossings || []).map((x) => x.id)))
    for (const h of plan.hazards || []) {
        const col = hazardColor(h)
        for (const ring of h.rings || []) {
            L.polygon(ring, { color: col, weight: touched.has(h.id) ? 1.5 : 0.8, opacity: 0.8, fillColor: col, fillOpacity: hazardAlpha(h), interactive: true })
                .bindTooltip(`${h.name}${h.kind_label ? ` — ${h.kind_label}` : ""}`, { sticky: true })
                .addTo(group)
        }
    }
    const sel = selected || plan.recommended
    const order = [...plan.candidates].sort((a, b) => (a.key === sel) - (b.key === sel))
    let bounds = null
    for (const c of order) {
        const pts = continuous(c.coords)
        const on = c.key === sel
        const line = L.polyline(pts, { color: candidateColor(c), weight: on ? 5 : 3, opacity: on ? 1 : 0.65, dashArray: c.key === "direct" && !on ? "8 8" : null })
            .bindTooltip(c.label, { sticky: true }).addTo(group)
        bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds()
    }
    const first = plan.candidates[0].coords
    const a = first[0], b = first[first.length - 1]
    L.circleMarker(a, { radius: 6, color: "#fff", weight: 2, fillColor: "#3b8cff", fillOpacity: 1 }).bindTooltip(plan.origin?.code || plan.origin?.name || "From").addTo(group)
    L.circleMarker(b, { radius: 6, color: "#fff", weight: 2, fillColor: "#3ddc84", fillOpacity: 1 }).bindTooltip(plan.destination?.code || plan.destination?.name || "To").addTo(group)
    if (plan.flown?.length) L.polyline(continuous(plan.flown), { color: "#8fb4e8", weight: 2, opacity: 0.6, dashArray: "2 6" }).addTo(group)
    return bounds
}
