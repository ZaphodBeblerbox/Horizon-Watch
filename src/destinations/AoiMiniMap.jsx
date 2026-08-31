/**
 * AoiMiniMap.jsx — small embedded Cesium viewer plotting real WatchZone AOI
 * boxes, shared by Dashboard.jsx (read-only overview) and Sources.jsx
 * (adds rectangle-draw for "New Watch Area").
 *
 * Reuses the exact lightweight-embedded-Cesium pattern already established
 * by src/components/NewsMiniMap.jsx (dynamic `import("cesium")`, identical
 * minimal-chrome Viewer options, the shared esriSatelliteProvider imagery) —
 * this keeps exactly one way lightweight embedded globes get built in this
 * codebase, rather than inventing a second approach. NewsMiniMap.jsx itself
 * plots point billboards for news markers, which isn't the right shape for
 * AOI boundaries, so this is a sibling component (rectangle entities) built
 * on the identical viewer-lifecycle pattern rather than a fork of that file.
 *
 * The rectangle-draw interaction (two-click: first corner, then opposite
 * corner) is adapted from src/globe/GlobeOverwatchDrawLayer.jsx's rectangle
 * mode — that component is resium-specific (`useCesium()` from resium,
 * requires a <Viewer> ancestor), which this raw-Cesium mini-map doesn't use,
 * so the actual ScreenSpaceEventHandler logic is re-implemented here against
 * the raw viewer instance rather than imported, but it is the same real
 * two-click rectangle algorithm, not a new one.
 */
import { useEffect, useRef, useState } from "react"
import { esriSatelliteProvider } from "../globe/imageryProviders.js"
import ScaleBar from "../components/ScaleBar.jsx"
import CoordinateReadout from "../components/CoordinateReadout.jsx"

const PRIORITY_COLOR = {
    critical: "#EF4444", // --danger
    high:     "#F5A524", // --warn
    medium:   "#F5A524",
    low:      "#22C55E", // --live
}
const DRAW_COLOR   = "#4CC9F0" // --accent-cyan
const PULSE_COLOR  = "#3D8BFF" // --accent-blue

function zonesCenter(zones) {
    const valid = zones.filter(z => z.bbox)
    if (valid.length === 0) return { lon: 20, lat: 15, height: 15_000_000 }
    const lons = valid.flatMap(z => [z.bbox.min_lon, z.bbox.max_lon])
    const lats = valid.flatMap(z => [z.bbox.min_lat, z.bbox.max_lat])
    return {
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        height: 12_000_000,
    }
}

/**
 * @param {object[]} zones - real WatchZone dicts (GET /api/watch-zones shape: system_id, name, priority, bbox, enabled)
 * @param {?string} selectedZoneId - system_id of the currently-selected zone
 * @param {(systemId:string)=>void} [onSelectZone]
 * @param {Set<string>} [pulsingIds] - system_ids whose real recent-activity trend exceeds baseline (see dashboardLogic.js's zoneExceedsBaseline)
 * @param {boolean} [drawActive] - when true, arms the rectangle-draw interaction
 * @param {(bounds:{north,south,east,west})=>void} [onDrawComplete]
 */
export default function AoiMiniMap({
    zones = [], selectedZoneId = null, onSelectZone,
    pulsingIds = null, drawActive = false, onDrawComplete,
}) {
    const containerRef = useRef(null)
    const viewerRef     = useRef(null)
    const entitiesRef   = useRef(new Map())   // system_id -> Cesium Entity
    const drawStateRef  = useRef({ handler: null, firstPoint: null, preview: null })
    const onSelectRef   = useRef(onSelectZone)
    const onDrawRef     = useRef(onDrawComplete)
    const [ready, setReady] = useState(false)
    const [err, setErr]     = useState(null)

    useEffect(() => { onSelectRef.current = onSelectZone }, [onSelectZone])
    useEffect(() => { onDrawRef.current = onDrawComplete }, [onDrawComplete])

    // ── One-time viewer init ──────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return
        let viewer = null
        let clickHandler = null
        let cancelled = false

        import("cesium").then((C) => {
            if (cancelled || !containerRef.current) return
            const { Viewer: CV, Cartesian3, ScreenSpaceEventHandler: SEH, ScreenSpaceEventType: SET } = C

            try {
                viewer = new CV(containerRef.current, {
                    animation: false, timeline: false, baseLayerPicker: false,
                    navigationHelpButton: false, homeButton: false,
                    sceneModePicker: false, geocoder: false,
                    fullscreenButton: false, selectionIndicator: false,
                    infoBox: false, shadows: false,
                    creditContainer: document.createElement("div"),
                    shouldAnimate: false,
                })
            } catch (_e) {
                setErr("Globe init failed")
                return
            }
            viewerRef.current = viewer
            viewer.imageryLayers.removeAll()
            viewer.imageryLayers.addImageryProvider(esriSatelliteProvider)
            const c = zonesCenter(zones)
            viewer.camera.setView({ destination: Cartesian3.fromDegrees(c.lon, c.lat, c.height) })

            clickHandler = new SEH(viewer.scene.canvas)
            clickHandler.setInputAction((evt) => {
                if (drawStateRef.current.drawing) return // draw mode owns clicks while active
                const picked = viewer.scene.pick(evt.position)
                const id = picked?.id?.id
                if (id && onSelectRef.current) onSelectRef.current(id)
            }, SET.LEFT_CLICK)

            setReady(true)
        }).catch(() => setErr("Cesium load failed"))

        return () => {
            cancelled = true
            if (clickHandler) { try { clickHandler.destroy() } catch (_e) {} }
            entitiesRef.current.clear()
            if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.destroy()
                viewerRef.current = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Sync AOI rectangle entities whenever zones/selection/pulse changes ──
    useEffect(() => {
        if (!ready) return
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return

        import("cesium").then(({ Rectangle, Color, CallbackProperty, ColorMaterialProperty }) => {
            if (!viewer || viewer.isDestroyed()) return

            const nextIds = new Set(zones.map(z => z.system_id))
            for (const [id, ent] of entitiesRef.current) {
                if (!nextIds.has(id)) {
                    try { viewer.entities.remove(ent) } catch (_e) {}
                    entitiesRef.current.delete(id)
                }
            }

            // HOTFIX: a `.material` field's outer value must implement
            // MaterialProperty's getType() — a bare CallbackProperty only
            // implements getValue(), so assigning one directly to
            // rectangle.material crashed Cesium's per-frame update loop with
            // "TypeError: t.getType is not a function" the moment a real
            // pulsing zone (zoneExceedsBaseline() true) reached the screen,
            // stopping the whole viewer's rendering. Real ColorMaterialProperty
            // outer wrapper, plain CallbackProperty inner color value — same
            // pattern src/globe/GlobeDirectorLayer.jsx's
            // _renderHighlightBorder() already uses correctly.
            const materialFor = (baseColor, isSelected, shouldPulse) => {
                if (shouldPulse) {
                    return new ColorMaterialProperty(new CallbackProperty(() => {
                        const t = (Date.now() % 2000) / 2000
                        return baseColor.withAlpha(0.08 + 0.18 * Math.abs(Math.sin(t * Math.PI)))
                    }, false))
                }
                return baseColor.withAlpha(isSelected ? 0.22 : 0.08)
            }

            for (const zone of zones) {
                if (!zone.bbox) continue
                const isSelected = zone.system_id === selectedZoneId
                const shouldPulse = pulsingIds instanceof Set && pulsingIds.has(zone.system_id)
                const baseColor = Color.fromCssColorString(PRIORITY_COLOR[zone.priority] || PRIORITY_COLOR.medium)
                const rect = Rectangle.fromDegrees(zone.bbox.min_lon, zone.bbox.min_lat, zone.bbox.max_lon, zone.bbox.max_lat)
                const outlineColor = isSelected ? Color.WHITE : baseColor.withAlpha(0.9)

                let ent = entitiesRef.current.get(zone.system_id)
                if (!ent) {
                    ent = viewer.entities.add({
                        id: zone.system_id,
                        rectangle: {
                            coordinates: rect,
                            material: materialFor(baseColor, isSelected, shouldPulse),
                            outline: true,
                            outlineColor,
                            outlineWidth: isSelected ? 2 : 1,
                            height: 0,
                        },
                        name: zone.name,
                    })
                    entitiesRef.current.set(zone.system_id, ent)
                } else {
                    ent.rectangle.coordinates = rect
                    ent.rectangle.outlineColor = outlineColor
                    ent.rectangle.outlineWidth = isSelected ? 2 : 1
                    ent.rectangle.material = materialFor(baseColor, isSelected, shouldPulse)
                }
            }
        })
    }, [zones, selectedZoneId, pulsingIds, ready])

    // ── Rectangle draw mode ──────────────────────────────────────────────
    useEffect(() => {
        if (!ready) return
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return

        let cancelled = false
        import("cesium").then((C) => {
            if (cancelled || !viewer || viewer.isDestroyed()) return
            const { ScreenSpaceEventHandler: SEH, ScreenSpaceEventType: SET, Cartographic, Math: CesiumMath, Color, CallbackProperty, Rectangle } = C

            // Tear down any previous draw handler/preview first
            const st = drawStateRef.current
            if (st.handler) { try { st.handler.destroy() } catch (_e) {} st.handler = null }
            if (st.preview) { try { viewer.entities.remove(st.preview) } catch (_e) {} st.preview = null }
            st.firstPoint = null
            st.drawing = false

            if (!drawActive) return

            const corners = { a: null, b: null }
            const previewColor = Color.fromCssColorString(DRAW_COLOR)
            const preview = viewer.entities.add({
                rectangle: {
                    coordinates: new CallbackProperty(() => {
                        if (!corners.a || !corners.b) return null
                        return Rectangle.fromDegrees(
                            Math.min(corners.a.lng, corners.b.lng), Math.min(corners.a.lat, corners.b.lat),
                            Math.max(corners.a.lng, corners.b.lng), Math.max(corners.a.lat, corners.b.lat),
                        )
                    }, false),
                    material: previewColor.withAlpha(0.1),
                    outline: true, outlineColor: previewColor.withAlpha(0.85), outlineWidth: 2, height: 0,
                },
            })
            st.preview = preview
            viewer.scene.canvas.style.cursor = "crosshair"

            const pickLatLng = (windowPos) => {
                const cart = viewer.camera.pickEllipsoid(windowPos)
                if (!cart) return null
                const carto = Cartographic.fromCartesian(cart)
                return { lat: CesiumMath.toDegrees(carto.latitude), lng: CesiumMath.toDegrees(carto.longitude) }
            }

            const handler = new SEH(viewer.scene.canvas)
            st.handler = handler

            handler.setInputAction((move) => {
                if (st.firstPoint) {
                    const pt = pickLatLng(move.endPosition)
                    if (pt) corners.b = pt
                }
            }, SET.MOUSE_MOVE)

            handler.setInputAction((click) => {
                const pt = pickLatLng(click.position)
                if (!pt) return
                if (!st.firstPoint) {
                    st.firstPoint = pt
                    st.drawing = true
                    corners.a = pt
                    corners.b = pt
                } else {
                    const a = st.firstPoint
                    const bounds = {
                        north: Math.max(a.lat, pt.lat), south: Math.min(a.lat, pt.lat),
                        east: Math.max(a.lng, pt.lng), west: Math.min(a.lng, pt.lng),
                    }
                    st.firstPoint = null
                    st.drawing = false
                    viewer.scene.canvas.style.cursor = "default"
                    if (onDrawRef.current) onDrawRef.current(bounds)
                }
            }, SET.LEFT_CLICK)

            handler.setInputAction(() => {
                st.firstPoint = null
                st.drawing = false
                corners.a = null; corners.b = null
            }, SET.RIGHT_CLICK)
        })

        return () => {
            cancelled = true
            const st = drawStateRef.current
            if (st.handler) { try { st.handler.destroy() } catch (_e) {} st.handler = null }
            if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                if (st.preview) { try { viewerRef.current.entities.remove(st.preview) } catch (_e) {} }
                viewerRef.current.scene.canvas.style.cursor = "default"
            }
            st.preview = null
            st.firstPoint = null
            st.drawing = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawActive, ready])

    return (
        <div style={{ position: "relative", width: "100%", height: "100%", background: "#050b1a" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
            {err && (
                <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "var(--text-muted)", fontSize: 11,
                    padding: 12, textAlign: "center",
                }}>{err}</div>
            )}
            {!err && ready && zones.length === 0 && !drawActive && (
                <div style={{
                    position: "absolute", top: 8, left: 8, right: 8,
                    color: "var(--text-muted)", fontSize: 10, pointerEvents: "none",
                }}>No watch areas defined yet</div>
            )}
            {drawActive && (
                <div style={{
                    position: "absolute", top: 8, left: 8, right: 8, textAlign: "center",
                    color: "var(--accent-cyan)", fontSize: 10, pointerEvents: "none",
                    fontFamily: "var(--font-sans)",
                }}>Click two opposite corners to draw a watch area · right-click to cancel</div>
            )}
            {/* UI correction pass, Part 7.5: every real map instance needs the
                bottom-left scale bar + coordinate readout. */}
            {ready && viewerRef.current && (
                <>
                    <ScaleBar viewer={viewerRef.current} />
                    <CoordinateReadout viewer={viewerRef.current} />
                </>
            )}
        </div>
    )
}
