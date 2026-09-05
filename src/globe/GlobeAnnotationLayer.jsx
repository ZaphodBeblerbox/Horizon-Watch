import { useEffect, useRef, useState } from "react"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType, Cartesian2, Cartesian3,
    SceneTransforms, defined, Cartographic, Math as CesiumMath, Color, PolygonHierarchy,
} from "cesium"
import { useAnnotations, addAnnotation, renameAnnotation, removeAnnotation } from "../state/annotationStore.js"

// GlobeAnnotationLayer.jsx — real map annotation drawing (select/marker/
// route/area/measure), rendered as a plain component reading `viewerRef`
// directly (mirroring GlobePopup.jsx's exact real pattern) rather than a
// resium JSX layer, since it needs the raw Cesium viewer for
// ScreenSpaceEventHandler + a plain HTML inline-rename overlay positioned
// by real screen coordinates — resium's declarative <Entity> tree can't
// host that overlay.
//
// Gold #c8a04a is used for every annotation — the one color in the whole
// app never used for real data, so an analyst can never mistake a hand-
// drawn annotation for an actual finding.

const GOLD = Color.fromCssColorString("#c8a04a")
const KM_PER_NM = 1.852

function haversineKm(a, b) {
    const R = 6371
    const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180
    const dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
function pathLengthKm(points) {
    let total = 0
    for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i])
    return total
}

export default function GlobeAnnotationLayer({ viewerRef, tool, isVisible }) {
    const annotations = useAnnotations()
    const entitiesRef = useRef(new Map()) // annotation id -> Cesium entity/entities
    const draftPointsRef = useRef([])
    const draftEntityRef = useRef(null)
    const [renaming, setRenaming] = useState(null) // { id, x, y, value }
    const [measureReadout, setMeasureReadout] = useState(null) // { x, y, km, nm }
    const [selectedId, setSelectedId] = useState(null)

    // ── Sync real committed annotations onto the real Cesium scene ────────
    useEffect(() => {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const live = new Set(annotations.map((a) => a.id))
        for (const [id, ent] of entitiesRef.current) {
            if (!live.has(id)) { viewer.entities.remove(ent); entitiesRef.current.delete(id) }
        }
        for (const a of annotations) {
            if (entitiesRef.current.has(a.id)) {
                const ent = entitiesRef.current.get(a.id)
                if (ent.label) ent.label.text = a.name
                continue
            }
            const positions = a.points.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
            let ent
            if (a.type === "marker") {
                ent = viewer.entities.add({
                    id: `annotation-${a.id}`, position: positions[0],
                    point: { pixelSize: 9, color: GOLD, outlineColor: Color.BLACK.withAlpha(0.6), outlineWidth: 1.5 },
                    label: { text: a.name, font: "12px sans-serif", fillColor: GOLD, pixelOffset: new Cartesian2(0, -18), showBackground: true, backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8) },
                })
            } else if (a.type === "route") {
                ent = viewer.entities.add({
                    id: `annotation-${a.id}`, polyline: { positions, width: 2.5, material: GOLD, clampToGround: true },
                    position: positions[Math.floor(positions.length / 2)],
                    label: { text: a.name, font: "12px sans-serif", fillColor: GOLD, pixelOffset: new Cartesian2(0, -14), showBackground: true, backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8) },
                })
            } else if (a.type === "area") {
                ent = viewer.entities.add({
                    id: `annotation-${a.id}`,
                    polygon: { hierarchy: new PolygonHierarchy(positions), material: GOLD.withAlpha(0.10), outline: true, outlineColor: GOLD },
                    position: positions[0],
                    label: { text: a.name, font: "12px sans-serif", fillColor: GOLD, pixelOffset: new Cartesian2(0, -14), showBackground: true, backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8) },
                })
            }
            if (ent) entitiesRef.current.set(a.id, ent)
        }
    }, [annotations, viewerRef])

    function clearDraft() {
        const viewer = viewerRef.current?.cesiumElement
        if (draftEntityRef.current && viewer) viewer.entities.remove(draftEntityRef.current)
        draftEntityRef.current = null
        draftPointsRef.current = []
        setMeasureReadout(null)
    }

    function updateDraftShape(kind) {
        const viewer = viewerRef.current?.cesiumElement
        if (!viewer) return
        const points = draftPointsRef.current
        if (points.length < 1) return
        const positions = points.map((p) => Cartesian3.fromDegrees(p.lon, p.lat))
        if (draftEntityRef.current) viewer.entities.remove(draftEntityRef.current)
        if (kind === "area" && points.length >= 3) {
            draftEntityRef.current = viewer.entities.add({
                polygon: { hierarchy: new PolygonHierarchy(positions), material: GOLD.withAlpha(0.10), outline: true, outlineColor: GOLD },
            })
        } else if (positions.length >= 2) {
            draftEntityRef.current = viewer.entities.add({ polyline: { positions, width: 2, material: GOLD.withAlpha(0.85) } })
        } else {
            draftEntityRef.current = viewer.entities.add({ position: positions[0], point: { pixelSize: 7, color: GOLD } })
        }
    }

    function commitDraft(kind) {
        const points = draftPointsRef.current
        clearDraft()
        if (points.length === 0) return
        const provisionalName =
            kind === "marker" ? `Untitled marker` :
            kind === "route" ? `Route ${annotations.filter((a) => a.type === "route").length + 1}` :
            `Area ${annotations.filter((a) => a.type === "area").length + 1}`
        const id = addAnnotation(kind, points, provisionalName)
        const viewer = viewerRef.current?.cesiumElement
        if (viewer) {
            const anchor = Cartesian3.fromDegrees(points[0].lon, points[0].lat)
            const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, anchor)
            if (sp) setRenaming({ id, x: sp.x, y: sp.y, value: provisionalName })
        }
    }

    // ── Real ScreenSpaceEventHandler for tool-driven drawing + select ──────
    useEffect(() => {
        let handler = null
        let cancelled = false
        function tryMount() {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) { if (!cancelled) setTimeout(tryMount, 200); return }
            handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

            handler.setInputAction((click) => {
                if (tool === "select") {
                    const picked = viewer.scene.pick(click.position)
                    if (defined(picked) && picked.id?.id?.toString().startsWith("annotation-")) {
                        const id = picked.id.id.replace("annotation-", "")
                        setSelectedId(id)
                        const a = annotations.find((x) => x.id === id)
                        if (a) {
                            const anchor = Cartesian3.fromDegrees(a.points[0].lon, a.points[0].lat)
                            const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, anchor)
                            if (sp) setRenaming({ id, x: sp.x, y: sp.y, value: a.name })
                        }
                    } else {
                        setSelectedId(null)
                    }
                    return
                }
                const cartesian = viewer.camera.pickEllipsoid(click.position)
                if (!cartesian) return
                const carto = Cartographic.fromCartesian(cartesian)
                const point = { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude) }

                if (tool === "marker") {
                    draftPointsRef.current = [point]
                    commitDraft("marker")
                    return
                }
                draftPointsRef.current = [...draftPointsRef.current, point]
                updateDraftShape(tool === "measure" ? "route" : tool)
                if (tool === "measure") {
                    const km = pathLengthKm(draftPointsRef.current)
                    const sp = SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian)
                    setMeasureReadout({ x: sp?.x ?? click.position.x, y: sp?.y ?? click.position.y, km: km.toFixed(2), nm: (km / KM_PER_NM).toFixed(2) })
                }
            }, ScreenSpaceEventType.LEFT_CLICK)

            handler.setInputAction(() => {
                if (tool === "route" || tool === "area") commitDraft(tool)
                else if (tool === "measure") clearDraft()
            }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
        }
        tryMount()
        return () => { cancelled = true; handler?.destroy(); clearDraft() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tool, viewerRef])

    function commitRename() {
        if (!renaming) return
        const trimmed = renaming.value.trim()
        renameAnnotation(renaming.id, trimmed || renaming.value)
        setRenaming(null)
    }

    if (!isVisible) return null
    return (
        <>
            {measureReadout && (
                <div style={{
                    position: "absolute", left: measureReadout.x + 12, top: measureReadout.y - 10, zIndex: 45,
                    background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)",
                    padding: "4px 8px", font: "400 11px var(--mono)", color: "var(--txt)", pointerEvents: "none",
                }}>
                    {measureReadout.km} km · {measureReadout.nm} nm
                </div>
            )}
            {renaming && (
                <input
                    autoFocus
                    value={renaming.value}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setRenaming((p) => ({ ...p, value: e.target.value }))}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename()
                        if (e.key === "Escape") setRenaming(null)
                    }}
                    onBlur={commitRename}
                    style={{
                        position: "absolute", left: renaming.x - 60, top: renaming.y - 32, zIndex: 46,
                        width: 130, height: 22, padding: "0 6px", font: "400 12px var(--font)",
                        background: "var(--bg-0)", border: "1px solid var(--acc-hi)", borderRadius: "var(--r)", color: "var(--txt)",
                    }}
                />
            )}
        </>
    )
}
