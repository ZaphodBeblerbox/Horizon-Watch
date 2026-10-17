/**
 * findingsLeaflet.js — the findings on show (lib/findings.js) as Leaflet
 * rectangles on the phone map, each labelled with what, how big and when,
 * and a small panel saying how many there are, with a way to clear them.
 *
 * attachFindings(L, map) subscribes to the store and returns the detach.
 */
import { getShownFindings, subscribeFindings, clearFindings, labelRanks, mapCaption, MAP_LABELS, TONE } from "../lib/findings.js"
import { leafletImageBounds, loadOverlayRadar, overlayUrl, retryOverlay, setOverlayOpacity, setOverlayView, subscribeOverlay, viewsFor } from "../lib/findingOverlay.js"
import { subscribeSignalPin } from "../lib/signalPin.js"
import { getShapeMarkerDataUri, MARK_SIZE } from "../globe/entityIcons.js"

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
                try { map.invalidateSize(); map.stop(); map.fitBounds(all, { paddingTopLeft: [40, 130], paddingBottomRight: [40, Math.max(200, Math.round(window.innerHeight * 0.46) + 20)], maxZoom: 16, animate: true }) } catch { /* map gone */ }
            }, 180)
        }
    }
    draw(getShownFindings())
    const off = subscribeFindings(draw)
    const offImage = attachFindingImage(L, map)
    const offPin = attachSignalPin(L, map)
    return () => { off(); offImage(); offPin(); layer.remove(); if (panel) panel.remove() }
}

const FONT = "500 12px -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif"

/**
 * THE IMAGE THE FINDING WAS NOTICED IN, under its boxes (lib/findingOverlay.js):
 * an L.imageOverlay on the image's own bounds, in a pane between the map
 * tiles and the boxes, with After / Before / Change and an opacity slider —
 * or, when the radar images were not kept, "Load the radar images".
 * (The image is an EPSG:4326 grid stretched to the bounds; over a zone of a
 * few km the difference from Web Mercator is well under a pixel.)
 */
export function attachFindingImage(L, map) {
    if (!map.getPane("plxFindingImage")) {
        const p = map.createPane("plxFindingImage")
        p.style.zIndex = "350"          // above the tiles (200), under the boxes (overlayPane 400)
        p.style.pointerEvents = "none"
    }
    let img = null, imgKey = null, box = null
    const remove = () => { if (img) { img.remove(); img = null; imgKey = null } }
    const draw = (ov) => {
        if (!ov) { remove(); if (box) { box.remove(); box = null }; return }
        const b = ov.status === "ready" ? leafletImageBounds(ov.bounds) : null
        const url = b ? overlayUrl(ov.view) : null
        if (url) {
            const k = `${ov.key}|${ov.view}`
            if (imgKey !== k) {
                remove()
                img = L.imageOverlay(url, b, { pane: "plxFindingImage", opacity: ov.opacity, interactive: false, className: "m2-finding-image" }).addTo(map)
                imgKey = k
            } else img.setOpacity(ov.opacity)
        } else remove()
        // the controls, under the findings panel
        if (!box) {
            box = document.createElement("div")
            box.className = "m2-finding-image-ctl"
            box.style.cssText = "position:absolute;left:12px;top:118px;z-index:800;background:rgba(10,18,32,.9);color:#e8ecf2;padding:6px 8px;"
                + `border:1px solid rgba(255,255,255,.18);font:${FONT};display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:calc(100% - 110px);box-sizing:border-box`
            L.DomEvent.disableClickPropagation(box)
            L.DomEvent.disableScrollPropagation(box)
            map.getContainer().appendChild(box)
        }
        box.setAttribute("data-status", ov.status)
        box.setAttribute("data-view", ov.view || "")
        box.replaceChildren()
        const btn = (label, on, fn, testid) => {
            const x = document.createElement("button")
            x.textContent = label
            if (testid) x.setAttribute("data-testid", testid)
            x.style.cssText = `background:${on ? "rgba(255,255,255,.18)" : "none"};border:1px solid rgba(255,255,255,.3);color:inherit;font:inherit;padding:3px 8px`
            L.DomEvent.on(x, "click", fn)
            return x
        }
        const note = (t) => { const s = document.createElement("span"); s.textContent = t; s.style.cssText = "opacity:.8;white-space:normal"; return s }
        if (ov.status === "ready") {
            for (const [label, k] of viewsFor(ov)) box.append(btn(label, ov.view === k, () => setOverlayView(k), `finding-image-${k}`))
            const r = document.createElement("input")
            r.type = "range"; r.min = "0"; r.max = "100"; r.value = String(Math.round(ov.opacity * 100))
            r.setAttribute("aria-label", "Image opacity")
            r.style.cssText = "width:84px;accent-color:#e8ecf2"
            L.DomEvent.on(r, "input", () => setOverlayOpacity(+r.value / 100))
            box.append(r)
        } else if (ov.status === "loading") box.append(note("Loading the image…"))
        else if (ov.status === "running") box.append(note(`Fetching the radar images${ov.total ? ` (${ov.done || 0}/${ov.total})` : ""}…`))
        else if ((ov.status === "missing" || ov.status === "error") && ov.regenerable !== false && ov.kind === "radar") {
            box.append(btn(`Load the radar images${ov.requests ? ` (${ov.requests} requests)` : ""}`, false, () => loadOverlayRadar(), "finding-image-load"))
            if (ov.status === "error" && ov.why) box.append(note(ov.why))
        } else {
            box.append(note(ov.why || "No image of this finding is held."))
            if (ov.status === "failed") box.append(btn("Try again", false, () => retryOverlay(), "finding-image-retry"))
        }
    }
    const off = subscribeOverlay(draw)
    return () => { off(); remove(); if (box) box.remove() }
}

/** The signal a notification opened (lib/signalPin.js), as the fusion mark. */
export function attachSignalPin(L, map) {
    let m = null
    const off = subscribeSignalPin((p) => {
        if (m) { m.remove(); m = null }
        if (!p) return
        // the map's own fusion mark, as on the desktop globe — no standing headline
        const px = MARK_SIZE.alert
        m = L.marker([p.lat, p.lon], {
            icon: L.icon({ iconUrl: getShapeMarkerDataUri({ shape: "triangle", color: "#c4453c", size: px, strokeWidth: 1.5 }),
                           iconSize: [px, px], iconAnchor: [px / 2, px / 2] }),
            keyboard: false, zIndexOffset: 2000, interactive: false,
        })
        m.addTo(map)
    })
    return () => { off(); if (m) m.remove() }
}
