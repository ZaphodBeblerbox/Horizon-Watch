/**
 * trackLeaflet.js — the shown track on the phone's map (location/track.js):
 * the line in our blue, older parts fainter; an amber dot with its number at each stop of 10 minutes or more
 * (tap: arrived, left, how long); a hollow blue start and a filled blue end; while replaying, the line only up
 * to the scrubber with a ringed dot where they were then. Every dot is lib/mapIcons.js dotIcon (no green).
 */
import "../routes/routes.css"
import { ageSegments, upTo, positionAt, stopLabel, dayHm, tsOf } from "../location/track.js"
import { dotIcon as dot, OURS, PHONE_ICON_SCALE } from "../lib/mapIcons.js"

const dotIcon = (L, opts) => {
    const i = dot(opts), w = Math.round(i.w * PHONE_ICON_SCALE)
    return L.icon({ iconUrl: i.uri, iconSize: [w, w], iconAnchor: [w / 2, w / 2], className: `m2-track-${opts.role}` })
}

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
        L.polyline(s.coords, { color: OURS.blue, opacity: s.color.a, weight: 4, lineCap: "round",
                               lineJoin: "round", interactive: false, className: "m2-track-line" }).addTo(group)
    }
    for (const [i, st] of (data.stops || []).entries()) {
        if (scrubT != null && Date.parse(st.arrived) > scrubT) continue
        L.marker([st.lat, st.lon], {
            icon: dotIcon(L, { role: "stop", label: i + 1 }), zIndexOffset: 500, keyboard: false,
        }).bindPopup(`<b>Stop ${i + 1}</b><br>${stopLabel(st)}`).addTo(group)
    }
    const s0 = all[0], e = all[all.length - 1]
    L.marker([s0.lat, s0.lon], { icon: dotIcon(L, { role: "start" }), zIndexOffset: 600, keyboard: false })
        .bindPopup(`<b>Start</b><br>${dayHm(s0.at)}`).addTo(group)
    if (scrubT == null) {
        L.marker([e.lat, e.lon], { icon: dotIcon(L, { role: "end" }), zIndexOffset: 700, keyboard: false })
            .bindPopup(`<b>Latest</b><br>${dayHm(e.at)}`).addTo(group)
    } else {
        const p = positionAt(all, scrubT)
        if (p) L.marker([p.lat, p.lon], { icon: dotIcon(L, { role: "now" }), zIndexOffset: 800, keyboard: false, interactive: false }).addTo(group)
    }
    return L.latLngBounds(all.map((p) => [p.lat, p.lon]))
}
