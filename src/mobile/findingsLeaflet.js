/**
 * findingsLeaflet.js — the findings on show (lib/findings.js) as Leaflet
 * rectangles on the phone map, each labelled with what, how big and when,
 * and a small panel saying how many there are, with a way to clear them.
 *
 * attachFindings(L, map) subscribes to the store and returns the detach.
 */
import { getShownFindings, subscribeFindings, clearFindings, labelRanks, mapCaption, MAP_LABELS, TONE } from "../lib/findings.js"

/** Leaflet bounds [[s, w], [n, e]] for a box [w, s, e, n]. Pure. */
export const leafletBounds = (b) => [[b[1], b[0]], [b[3], b[2]]]

export function attachFindings(L, map) {
    if (!L || !map) return () => {}
    const layer = L.layerGroup().addTo(map)
    let panel = null
    const draw = (shown) => {
        layer.clearLayers()
        if (panel) { panel.remove(); panel = null }
        if (!shown?.findings?.length) return
        const all = []
        const ranks = labelRanks(shown.findings)
        for (const f of shown.findings) {
            if (!Array.isArray(f.box) || f.box.length !== 4) continue
            const col = TONE[f.tone] || TONE.amber
            const rb = leafletBounds(f.box)
            all.push(...rb)
            L.rectangle(rb, {
                color: col, weight: shown.focusId === f.id ? 3.5 : 2.5, opacity: 1,
                fillColor: col, fillOpacity: 0.18, dashArray: f.box_source === "area_estimate" ? "6 4" : null,
                className: "m2-finding",
            }).bindTooltip(mapCaption(f), {
                // the most telling few always captioned; the rest on tap
                permanent: (ranks.get(f.id) ?? 99) < MAP_LABELS || shown.focusId === f.id,
                direction: "top", offset: [0, -2], className: "m2-finding-label", opacity: 0.95,
            }).addTo(layer)
        }
        // Under the search bar, left; its own element over the map (the
        // corner controls are taken by the map's round buttons).
        const d = document.createElement("div")
        d.className = "m2-finding-panel"
        d.setAttribute("data-findings", String(shown.findings.length))
        d.style.cssText = "position:absolute;left:12px;top:84px;z-index:800;background:rgba(10,18,32,.9);color:#e8ecf2;padding:6px 10px;"
            + "border:1px solid rgba(255,255,255,.18);font:500 12px -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;"
            + "display:flex;gap:10px;align-items:center;max-width:calc(100% - 110px);box-sizing:border-box"
        const t = document.createElement("span")
        t.textContent = `${shown.findings.length} finding${shown.findings.length === 1 ? "" : "s"}${shown.title ? ` · ${shown.title}` : ""}`
        t.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1"
        const x = document.createElement("button")
        x.textContent = "Clear"
        x.setAttribute("aria-label", "Clear the findings from the map")
        x.style.cssText = "background:none;border:1px solid rgba(255,255,255,.3);color:inherit;font:inherit;padding:2px 8px;flex:none"
        d.append(t, x)
        L.DomEvent.disableClickPropagation(d)
        L.DomEvent.on(x, "click", () => clearFindings())
        map.getContainer().appendChild(d)
        panel = d
        if (shown.fit && all.length) {
            // after the tab switch has let Leaflet re-measure the map
            setTimeout(() => {
                try { map.invalidateSize(); map.stop(); map.fitBounds(all, { paddingTopLeft: [40, 130], paddingBottomRight: [40, 200], maxZoom: 16, animate: true }) } catch { /* map gone */ }
            }, 180)
        }
    }
    draw(getShownFindings())
    const off = subscribeFindings(draw)
    return () => { off(); layer.remove(); if (panel) panel.remove() }
}
