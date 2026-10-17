/**
 * GlobeFindingsLayer.jsx — what the automatic watch found, as red and amber
 * boxes on the globe with what, how big and when beside each.
 *
 * Drawn from the findings store (lib/findings.js): a notification opened, or
 * a zone's findings asked for in Imagery, puts them on show; the camera
 * flies to them when asked (`fit`). Rectangles at height 0 with a ground
 * polyline edge — the pattern GlobeOverwatchLayer proved renders reliably.
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useCesium } from "resium"
import {
    Cartesian2, Cartesian3, Color, ColorMaterialProperty, PolygonHierarchy, LabelStyle,
    DistanceDisplayCondition, HorizontalOrigin, VerticalOrigin, ClassificationType, HeightReference, Math as CMath,
    Rectangle, SingleTileImageryProvider,
} from "cesium"
import { altitudeFor, findingsBounds, getShownFindings, labelRanks, mapCaption, MAP_LABELS, subscribeFindings, TONE, clearFindings } from "../lib/findings.js"
import { cesiumRectDegrees, loadOverlayRadar, overlayUrl, retryOverlay, setOverlayOpacity, setOverlayView, subscribeOverlay, viewsFor } from "../lib/findingOverlay.js"
import { subscribeSignalPin } from "../lib/signalPin.js"
import { renderDuringFlight } from "./flightRender.js"
import { getShapeMarkerDataUri, MARK_SIZE } from "./entityIcons.js"

// The opened signal is a fusion signal: drawn as the map's own fusion mark
// (GlobeDerivedAlertsLayer's triangle), never a ringed dot with its headline
// left standing on the map — the headline is in the sheet that opened it.
const FUSION_MARK = () => getShapeMarkerDataUri({ shape: "triangle", color: "#c4453c", size: MARK_SIZE.alert, strokeWidth: 1.5 })

export default function GlobeFindingsLayer() {
    const { viewer } = useCesium()
    const [shown, setShown] = useState(() => getShownFindings())
    const added = useRef([])
    useEffect(() => subscribeFindings(setShown), [])
    const [ov, setOv] = useState(null)
    useEffect(() => subscribeOverlay(setOv), [])
    useSceneImage(viewer, ov)
    useSignalPin(viewer)

    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return undefined
        const clear = () => {
            for (const e of added.current) { try { if (viewer.entities.contains(e)) viewer.entities.remove(e) } catch { /* gone */ } }
            added.current = []
        }
        clear()
        if (!shown?.findings?.length) { viewer.scene.requestRender?.(); return clear }
        const ranks = labelRanks(shown.findings)
        for (const f of shown.findings) {
            const b = f.box
            if (!Array.isArray(b) || b.length !== 4) continue
            const [w, s, e, n] = b
            const col = Color.fromCssColorString(TONE[f.tone] || TONE.amber)
            const focus = shown.focusId && shown.focusId === f.id
            const corners = [[w, s], [e, s], [e, n], [w, n]].map(([lo, la]) => Cartesian3.fromDegrees(lo, la))
            added.current.push(viewer.entities.add({
                id: `finding-${f.id}-${Math.random().toString(36).slice(2, 7)}`,
                name: f.label,
                // ON THE GROUND, fill and edge alike: a fill at height 0 over
                // terrain at 200 m sat visibly off its ground-clamped edge
                // (seen in the first render) — both are draped now.
                polygon: {
                    hierarchy: new PolygonHierarchy(corners),
                    material: new ColorMaterialProperty(col.withAlpha(focus ? 0.32 : 0.2)),
                    classificationType: ClassificationType.BOTH,
                },
                properties: { finding: f, zoneId: shown.zoneId },
            }))
            added.current.push(viewer.entities.add({
                id: `finding-edge-${f.id}-${Math.random().toString(36).slice(2, 7)}`,
                polyline: {
                    positions: [...corners, corners[0]], width: focus ? 4 : 3,
                    material: new ColorMaterialProperty(col.withAlpha(0.98)),
                    clampToGround: true, classificationType: ClassificationType.BOTH,
                },
            }))
            added.current.push(viewer.entities.add({
                id: `finding-label-${f.id}-${Math.random().toString(36).slice(2, 7)}`,
                position: Cartesian3.fromDegrees(w, n),
                label: {
                    text: mapCaption(f) + (f.box_source === "area_estimate" ? " (size estimated)" : ""),
                    font: "600 12px -apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif",
                    fillColor: col, outlineColor: Color.BLACK.withAlpha(0.9), outlineWidth: 3,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.BOTTOM,
                    pixelOffset: new Cartesian2(0, -4),
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    // the most telling few from afar; the rest once close in
                    distanceDisplayCondition: new DistanceDisplayCondition(0, (ranks.get(f.id) ?? 99) < MAP_LABELS || focus ? 250000 : 2500),
                },
            }))
        }
        if (shown.fit) {
            const bb = findingsBounds(shown.findings)
            if (bb) {
                // The viewer renders on demand (GlobeView): a flight is tick-driven
                // and never moves unless rendering runs for its duration — the
                // same fix as GlobeView's akili:fly-to. (Without it the camera
                // stayed where it was and the boxes and image were never seen.)
                const restore = renderDuringFlight(viewer)
                viewer.camera.flyTo({
                    destination: Cartesian3.fromDegrees((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, altitudeFor(bb)),
                    orientation: { heading: 0, pitch: CMath.toRadians(-90), roll: 0 },
                    duration: 1.6,
                    complete: restore, cancel: restore,
                })
            }
        }
        viewer.scene.requestRender?.()
        return clear
    }, [viewer, shown])

    if (!viewer || viewer.isDestroyed() || !shown?.findings?.length || !ov) return null
    return createPortal(<SceneImageControls ov={ov} count={shown.findings.length} title={shown.title} />, viewer.container)
}

/**
 * THE IMAGE THE FINDING WAS NOTICED IN, draped on the ground under its boxes
 * (lib/findingOverlay.js): a SingleTileImageryProvider on the image's own
 * bounds (an EPSG:4326 grid, which is what a geographic rectangle is), the
 * view chosen (After / Before / Change) and its opacity. Gone with the findings.
 */
function useSceneImage(viewer, ov) {
    const layer = useRef(null)
    const url = ov?.status === "ready" ? overlayUrl(ov.view) : null
    const rect = ov?.status === "ready" ? cesiumRectDegrees(ov.bounds) : null
    const rectKey = rect ? `${rect.west},${rect.south},${rect.east},${rect.north}` : null
    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !url || !rect) return undefined
        let cancelled = false
        SingleTileImageryProvider.fromUrl(url, { rectangle: Rectangle.fromDegrees(rect.west, rect.south, rect.east, rect.north) })
            .then((provider) => {
                if (cancelled || viewer.isDestroyed()) return
                const l = viewer.imageryLayers.addImageryProvider(provider)
                l.alpha = ov?.opacity ?? 0.85
                layer.current = l
                if (typeof window !== "undefined") window.__plxGlobeSceneImage = { url, rect, alpha: l.alpha }
                viewer.scene.requestRender?.()
            })
            .catch(() => { /* undecodable — the boxes alone */ })
        return () => {
            cancelled = true
            if (layer.current && !viewer.isDestroyed()) { try { viewer.imageryLayers.remove(layer.current, true) } catch { /* gone */ } }
            layer.current = null
            if (typeof window !== "undefined") window.__plxGlobeSceneImage = null
            if (!viewer.isDestroyed()) viewer.scene.requestRender?.()
        }
    }, [viewer, url, rectKey]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (layer.current) { layer.current.alpha = ov?.opacity ?? 0.85; viewer?.scene?.requestRender?.() }
    }, [ov?.opacity]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The signal a notification opened (lib/signalPin.js): the fusion mark, no headline on the map. */
function useSignalPin(viewer) {
    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return undefined
        let ent = null
        const off = subscribeSignalPin((p) => {
            if (viewer.isDestroyed()) return
            if (ent) { try { viewer.entities.remove(ent) } catch { /* gone */ } ent = null }
            if (p) {
                ent = viewer.entities.add({
                    id: `signal-pin-${Math.random().toString(36).slice(2, 8)}`,
                    position: Cartesian3.fromDegrees(p.lon, p.lat),
                    billboard: { image: FUSION_MARK(), width: MARK_SIZE.alert, height: MARK_SIZE.alert,
                                 heightReference: HeightReference.CLAMP_TO_GROUND,
                                 disableDepthTestDistance: Number.POSITIVE_INFINITY },
                    properties: { signalPin: p },
                })
            }
            viewer.scene.requestRender?.()
        })
        return () => { off(); if (ent && !viewer.isDestroyed()) { try { viewer.entities.remove(ent) } catch { /* gone */ } } }
    }, [viewer])
}

const BTN = { height: 26, padding: "0 10px", border: "1px solid var(--gline2, rgba(255,255,255,.25))", background: "transparent",
              color: "inherit", font: "inherit", fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" }

/** After / Before / Change, the opacity, and "Load the radar images" when they were not kept. */
function SceneImageControls({ ov, count, title }) {
    const views = viewsFor(ov)
    return (
        <div data-testid="finding-image-controls" data-status={ov.status} data-view={ov.view}
             style={{ position: "absolute", left: "50%", top: 64, transform: "translateX(-50%)", zIndex: 20, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
                      maxWidth: 520, padding: "8px 10px", background: "var(--panel, rgba(10,18,32,.92))", color: "var(--txt, #e8ecf2)",
                      border: "1px solid var(--gline2, rgba(255,255,255,.18))", fontSize: 12,
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif", pointerEvents: "auto" }}>
            <span style={{ fontWeight: 600, marginRight: 4, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {count} finding{count === 1 ? "" : "s"}{title ? ` · ${title}` : ""}
            </span>
            {ov.status === "ready" && <>
                <span style={{ opacity: 0.7 }}>{ov.kind === "radar" ? "Radar image" : "Satellite image"}</span>
                {views.map(([label, k]) => (
                    <button key={k} data-testid={`finding-image-${k}`} onClick={() => setOverlayView(k)}
                            style={{ ...BTN, background: ov.view === k ? "var(--accdim, rgba(255,255,255,.18))" : "transparent" }}>{label}</button>
                ))}
                <input type="range" min="0" max="100" value={Math.round(ov.opacity * 100)} aria-label="Image opacity"
                       onChange={(e) => setOverlayOpacity(+e.target.value / 100)} style={{ width: 90 }} />
            </>}
            {ov.status === "loading" && <span style={{ opacity: 0.8 }}>Loading the image…</span>}
            {ov.status === "running" && <span style={{ opacity: 0.8 }}>Fetching the radar images{ov.total ? ` (${ov.done || 0}/${ov.total})` : ""}…</span>}
            {(ov.status === "missing" || ov.status === "error") && ov.kind === "radar" && ov.regenerable !== false
                ? <button data-testid="finding-image-load" onClick={() => loadOverlayRadar()} style={BTN}>
                    Load the radar images{ov.requests ? ` (${ov.requests} requests)` : ""}</button>
                : !["ready", "loading", "running"].includes(ov.status) && <span style={{ opacity: 0.8 }}>{ov.why || "No image of this finding is held."}</span>}
            {ov.status === "failed" && <button data-testid="finding-image-retry" onClick={() => retryOverlay()} style={BTN}>Try again</button>}
            <button aria-label="Clear the findings from the map" onClick={() => clearFindings()} style={{ ...BTN, marginLeft: "auto" }}>Clear</button>
        </div>
    )
}
