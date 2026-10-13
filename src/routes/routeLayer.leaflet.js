/**
 * routeLayer.leaflet.js — a route plan drawn on a Leaflet map: each hazard
 * as a red ring (its outer radius) around a darker core, labelled; the
 * fastest route grey and dashed; the safest green over it; the start and
 * the safe point. Returns the bounds to fit.
 */
import { ringStyle } from "./view.js"
import { isEvacuation, itineraryLines, itineraryStops } from "../evacuation/itinerary.js"

const esc = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]))

/** `sel`: the key of the candidate chosen in the panel (default: the safest). */
export function drawPlan(L, group, plan, sel = null) {
    group.clearLayers()
    if (!plan?.origin) return null
    const pts = [[plan.origin.lat, plan.origin.lon]]
    for (const h of plan.hazards || []) {
        L.circle([h.lat, h.lon], { radius: h.radius_m, ...ringStyle(h), interactive: false, className: "plx-hazard-ring" }).addTo(group)
        L.circle([h.lat, h.lon], { radius: h.core_m, color: "#E5484D", weight: 1, opacity: 0.9, fillColor: "#E5484D", fillOpacity: 0.35, interactive: false }).addTo(group)
        L.marker([h.lat, h.lon], { opacity: 0, interactive: false, keyboard: false,
                                   icon: L.divIcon({ className: "", iconSize: [1, 1], html: "" }) })
            .bindTooltip(`<b>${esc(h.label)}</b>${h.place ? `<br>${esc(String(h.place).split(",")[0])}` : ""}`,
                         { permanent: true, direction: "top", className: "plx-hazard-label", offset: [0, -6] }).addTo(group)
        const dLat = h.radius_m / 111_000, dLon = h.radius_m / (111_000 * Math.cos(h.lat * Math.PI / 180))
        if (h.distance_m == null || h.distance_m < 3000) pts.push([h.lat + dLat * 1.6, h.lon - dLon], [h.lat - dLat, h.lon + dLon * 1.4])     // the ring and its label in view
    }
    if (isEvacuation(plan)) {
        // AN EVACUATION: every leg of the chosen itinerary in its own colour (air and sea dashed),
        // the change points (airport, crossing) and the safe house
        for (const ln of itineraryLines(plan, sel)) {
            L.polyline(ln.coords, { color: "#0b1d2e", weight: 9, opacity: 0.45, interactive: false }).addTo(group)
            L.polyline(ln.coords, { color: ln.color, weight: 5.5, opacity: 1, dashArray: ln.dashed ? "10 8" : null, interactive: false,
                                    className: `plx-evac-leg plx-evac-${ln.kind}` }).addTo(group)
            ln.coords.forEach((c) => pts.push(c))
        }
        for (const st of itineraryStops(plan, sel)) {
            const html = st.kind === "safe_house" ? '<div class="plx-route-dest plx-safehouse-pin" title="Safe house">⌂</div>'
                : st.kind === "safe_point" ? '<div class="plx-route-dest" title="Safe point">✓</div>'
                : `<div class="plx-evac-stop ${st.kind}"></div>`
            L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html }), keyboard: false })
                .bindTooltip(esc(st.name || ""), { direction: "right", offset: [12, 0], permanent: st.kind !== "change" }).addTo(group)
            pts.push([st.lat, st.lon])
        }
        L.marker([plan.origin.lat, plan.origin.lon], { icon: L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10], html: '<div class="plx-route-origin"></div>' }),
                                                       zIndexOffset: 1000, keyboard: false, interactive: false }).addTo(group)
        return L.latLngBounds(pts)
    }
    const f = plan.fastest
    const s = (sel && (plan.candidates || []).find((c) => c.key === sel)) || plan.safest
    if (f && (!s || f.key !== s.key)) {
        L.polyline(f.coords, { color: "#9aa3ad", weight: 5, opacity: 0.85, dashArray: "8 9", interactive: false, className: "plx-route-fastest" }).addTo(group)
        f.coords.forEach((c) => pts.push(c))
    }
    if (s) {
        L.polyline(s.coords, { color: "#0b3d1f", weight: 9, opacity: 0.55, interactive: false }).addTo(group)
        L.polyline(s.coords, { color: "#3ddc84", weight: 5.5, opacity: 1, interactive: false, className: "plx-route-safest" }).addTo(group)
        s.coords.forEach((c) => pts.push(c))
        const d = s.coords[s.coords.length - 1]
        L.marker(d, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="plx-route-dest" title="Safe point">✓</div>' }), keyboard: false })
            .bindTooltip(esc(s.dest?.name || "Safe point"), { direction: "right", offset: [12, 0] }).addTo(group)
    }
    L.marker([plan.origin.lat, plan.origin.lon], { icon: L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10], html: '<div class="plx-route-origin"></div>' }),
                                                   zIndexOffset: 1000, keyboard: false, interactive: false }).addTo(group)
    return L.latLngBounds(pts)
}
