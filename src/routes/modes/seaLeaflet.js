/**
 * seaLeaflet.js — a sea-route plan on a Leaflet map: the hazard zones shaded
 * by kind (polygons; GPS-interference cells as faint circles), every
 * candidate (the recommended one thick, the others dashed), the start and
 * the destination. Returns the bounds to fit.
 */
import { hazardColor, ringLatLngs } from "./maritimeCore.js"

const esc = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]))

export function drawSeaPlan(L, group, plan) {
    group.clearLayers()
    if (!plan?.candidates?.length) return null
    const pts = []
    for (const h of plan.hazards || []) {
        const color = hazardColor(h)
        if (h.shape === "polygon") {
            L.polygon(ringLatLngs(h), { color, weight: 1.2, opacity: 0.8, fillColor: color, fillOpacity: 0.12 + 0.2 * Math.min(1, h.weight), interactive: true })
                .bindTooltip(`<b>${esc(h.name)}</b>`, { className: "plx-sea-label", sticky: true }).addTo(group)
        } else {
            L.circle([h.lat, h.lon], { radius: h.radius_km * 1000, color, weight: 0.5, opacity: 0.5, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(group)
        }
    }
    const sel = plan.selected || plan.recommended
    const ordered = [...plan.candidates].sort((a, b) => (a.key === sel) - (b.key === sel))
    for (const c of ordered) {
        const on = c.key === sel
        if (on) L.polyline(c.coords, { color: "#0b2d3d", weight: 8, opacity: 0.6, interactive: false }).addTo(group)
        L.polyline(c.coords, { color: c.recommended ? "#3ddc84" : on ? "#5cc8ff" : "#9aa3ad", weight: on ? 4.5 : 3, opacity: on ? 1 : 0.75,
                               dashArray: on ? null : "7 8", className: c.recommended ? "plx-sea-rec" : "plx-sea-alt" })
            .bindTooltip(`${esc(c.label)} · ${c.days} days`, { className: "plx-sea-label", sticky: true }).addTo(group)
        c.coords.forEach((p) => pts.push(p))
    }
    const o = plan.origin, d = plan.destination
    L.circleMarker([o.lat, o.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#3b8cff", fillOpacity: 1 }).bindTooltip(esc(o.name || "Start")).addTo(group)
    L.circleMarker([d.lat, d.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#3ddc84", fillOpacity: 1 }).bindTooltip(esc(d.name || "Destination")).addTo(group)
    return L.latLngBounds(pts)
}
