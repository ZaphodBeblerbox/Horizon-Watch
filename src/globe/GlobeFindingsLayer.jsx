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
import { useCesium } from "resium"
import {
    Cartesian2, Cartesian3, Color, ColorMaterialProperty, PolygonHierarchy, LabelStyle,
    DistanceDisplayCondition, HorizontalOrigin, VerticalOrigin, ClassificationType, HeightReference, Math as CMath,
} from "cesium"
import { altitudeFor, findingsBounds, getShownFindings, labelRanks, mapCaption, MAP_LABELS, subscribeFindings, TONE } from "../lib/findings.js"

export default function GlobeFindingsLayer() {
    const { viewer } = useCesium()
    const [shown, setShown] = useState(() => getShownFindings())
    const added = useRef([])
    useEffect(() => subscribeFindings(setShown), [])

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
                viewer.camera.flyTo({
                    destination: Cartesian3.fromDegrees((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, altitudeFor(bb)),
                    orientation: { heading: 0, pitch: CMath.toRadians(-90), roll: 0 },
                    duration: 1.6,
                })
            }
        }
        viewer.scene.requestRender?.()
        return clear
    }, [viewer, shown])

    return null
}
