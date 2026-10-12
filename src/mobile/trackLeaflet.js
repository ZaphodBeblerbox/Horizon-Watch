/**
 * trackLeaflet.js — the shown track on the phone's map (location/track.js):
 * the line coloured by age (older fades), an amber dot at each stop of 10
 * minutes or more (tap: arrived, left, how long), a green start and a
 * ringed end, and — while replaying — the line only up to the scrubber with
 * a marker where they were then.
 */
import "../routes/routes.css"
import { ageSegments, upTo, positionAt, stopLabel, dayHm, tsOf } from "../location/track.js"

const dotIcon = (L, html, size = 18) => L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html })

/** Draw into `group` (cleared first). Returns the track's bounds, or null. */
export function drawTrack(L, group, data, scrubT) {
    group.clearLayers()
    const all = data?.points || []
    if (!all.length) return null
    const pts = scrubT != null ? upTo(all, scrubT) : all
    // the whole line, faint, under the replay; then the age-coloured part
    if (scrubT != null) L.polyline(all.map((p) => [p.lat, p.lon]), { color: "#8fa3c4", weight: 2, opacity: 0.25, dashArray: "4 6", interactive: false }).addTo(group)
    const range = [tsOf(all[0]), tsOf(all[all.length - 1])]
    for (const s of ageSegments(pts, 14, range)) {
        L.polyline(s.coords, { color: `rgb(${s.color.r},${s.color.g},${s.color.b})`, opacity: s.color.a, weight: 4, lineCap: "round",
                               lineJoin: "round", interactive: false, className: "m2-track-line" }).addTo(group)
    }
    for (const [i, st] of (data.stops || []).entries()) {
        if (scrubT != null && Date.parse(st.arrived) > scrubT) continue
        L.marker([st.lat, st.lon], {
            icon: dotIcon(L, `<div class="m2-track-stop" data-testid="track-stop">${i + 1}</div>`, 20), zIndexOffset: 500, keyboard: false,
        }).bindPopup(`<b>Stop ${i + 1}</b><br>${stopLabel(st)}`).addTo(group)
    }
    const s0 = all[0], e = all[all.length - 1]
    L.marker([s0.lat, s0.lon], { icon: dotIcon(L, `<div class="m2-track-start" title="Start">S</div>`, 20), zIndexOffset: 600, keyboard: false })
        .bindPopup(`<b>Start</b><br>${dayHm(s0.at)}`).addTo(group)
    if (scrubT == null) {
        L.marker([e.lat, e.lon], { icon: dotIcon(L, `<div class="m2-track-end" title="Latest"></div>`, 22), zIndexOffset: 700, keyboard: false })
            .bindPopup(`<b>Latest</b><br>${dayHm(e.at)}`).addTo(group)
    } else {
        const p = positionAt(all, scrubT)
        if (p) L.marker([p.lat, p.lon], { icon: dotIcon(L, `<div class="m2-track-now" data-testid="track-now"></div>`, 22), zIndexOffset: 800, keyboard: false, interactive: false }).addTo(group)
    }
    return L.latLngBounds(all.map((p) => [p.lat, p.lon]))
}
