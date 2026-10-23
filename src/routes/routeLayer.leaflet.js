/**
 * routeLayer.leaflet.js — a route plan drawn on a Leaflet map: each hazard
 * as a red ring (its outer radius) around a darker core, labelled; the
 * fastest route grey and dashed; the safest blue over it (it was green,
 * which the owner found did not fit the phone, 2026-10-17); the start and
 * the safe point. Returns the bounds to fit.
 */
import { ringStyle } from "./view.js"
import { dotIcon, SIZE } from "../lib/mapIcons.js"
import { safeHouseIcon } from "../evacuation/safeHouseIcon.js"

// the route's points: the one typology's dots and pin (lib/mapIcons.js), a fifth larger on the phone like every marker
const SCALE = 1.2
const dotOf = (L, role) => { const i = dotIcon({ role }); const w = Math.round(i.w * SCALE); return L.icon({ iconUrl: i.uri, iconSize: [w, w], iconAnchor: [w / 2, w / 2] }) }
const houseOf = (L) => { const w = Math.round(SIZE.pin.w * SCALE), h = Math.round(SIZE.pin.h * SCALE); return L.icon({ iconUrl: safeHouseIcon(false), iconSize: [w, h], iconAnchor: [w / 2, h] }) }
const STOP_ROLE = { border: "stop", safe_point: "end" }
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
            const icon = st.kind === "safe_house" ? houseOf(L) : dotOf(L, STOP_ROLE[st.kind] || "endpoint")
            L.marker([st.lat, st.lon], { icon, keyboard: false, title: st.kind === "safe_house" ? "Safe house" : st.kind === "safe_point" ? "Safe point" : "" })
                .bindTooltip(esc(st.name || ""), { direction: "right", offset: [12, 0], permanent: st.kind !== "change" }).addTo(group)
            pts.push([st.lat, st.lon])
        }
        L.marker([plan.origin.lat, plan.origin.lon], { icon: dotOf(L, "me"),
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
        L.polyline(s.coords, { color: "#0b1d3a", weight: 9, opacity: 0.55, interactive: false }).addTo(group)
        L.polyline(s.coords, { color: "#3B8CFF", weight: 5.5, opacity: 1, interactive: false, className: "plx-route-safest" }).addTo(group)
        s.coords.forEach((c) => pts.push(c))
        const d = s.coords[s.coords.length - 1]
        L.marker(d, { icon: dotOf(L, "end"), keyboard: false, title: "Safe point" })
            .bindTooltip(esc(s.dest?.name || "Safe point"), { direction: "right", offset: [12, 0] }).addTo(group)
    }
    L.marker([plan.origin.lat, plan.origin.lon], { icon: dotOf(L, "me"),
                                                   zIndexOffset: 1000, keyboard: false, interactive: false }).addTo(group)
    return L.latLngBounds(pts)
}
