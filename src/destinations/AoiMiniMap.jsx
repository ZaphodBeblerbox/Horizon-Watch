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
 *
 * Two additive, opt-in-only features (UI correction pass Part 11.4, added
 * for Sources.jsx/Intel's new "inspect" interaction — Dashboard.jsx's own
 * usage of this file passes neither prop, so its behavior is byte-for-byte
 * unchanged):
 *   - `flyToZoneId` — when set (and changes), flies this map's own live
 *     camera to frame that zone's real bbox. Real Cesium `camera.flyTo`,
 *     not a fabricated animation.
 *   - `lockActive`/`lockBounds` — forwarded directly to the real
 *     AoiLockDimming (src/globe/AoiLockDimming.jsx), threading this map's
 *     own live viewer instance through once it's ready.
 */
import { useEffect, useRef, useState } from "react"
import { esriSatelliteProvider } from "../globe/imageryProviders.js"
import MapMeta from "../components/MapMeta.jsx"
import AoiLockDimming from "../globe/AoiLockDimming.jsx"
import { useUserLocation } from "../globe/useUserLocation.js"

// Real "zoomed in" altitude for the no-real-data default view (vs.
// zonesCenter()'s 15,000km world-ish fallback) — a genuine device location
// deserves a real close-in view, not the same generic full-world framing.
const USER_LOCATION_ZOOM_HEIGHT = 300_000

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
 * @param {?string} [flyToZoneId] - system_id to fly this map's own camera to
 *   (real bbox-framing flyTo) whenever it changes; opt-in, default off
 * @param {boolean} [lockActive] - forwarded to AoiLockDimming
 * @param {?{north,south,east,west}} [lockBounds] - forwarded to AoiLockDimming
 */
export default function AoiMiniMap({
    zones = [], selectedZoneId = null, onSelectZone,
    pulsingIds = null, drawActive = false, onDrawComplete,
    flyToZoneId = null, lockActive = false, lockBounds = null,
    // Opt-in (Imagery page): plot individual detections as points.
    //
    // This is what a scan LEAVES BEHIND once its image has aged out. A
    // scene is megabytes and only the newest two per region keep their
    // pixels; the detections survive for ever as a type, a confidence and
    // a coordinate. Without somewhere to draw them, an older scan would
    // read as "nothing was found" when in fact it found plenty and we
    // simply stopped keeping the picture. Callers that pass neither prop
    // (Dashboard, Sources) are unaffected.
    detections = null, selectedDetectionId = null, onSelectDetection,
}) {
    const containerRef = useRef(null)
    const viewerRef     = useRef(null)
    const entitiesRef   = useRef(new Map())   // system_id -> Cesium Entity
    const drawStateRef  = useRef({ handler: null, firstPoint: null, preview: null })
    const onSelectRef   = useRef(onSelectZone)
    const onDrawRef     = useRef(onDrawComplete)
    const [ready, setReady] = useState(false)
    const [err, setErr]     = useState(null)
    const userLoc = useUserLocation()

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

    // ── Detection points (opt-in — see the `detections` prop) ───────────
    const detEntitiesRef = useRef(new Map())
    useEffect(() => {
        if (!ready) return
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return

        import("cesium").then(({ Cartesian3, Color, NearFarScalar }) => {
            if (!viewerRef.current || viewerRef.current.isDestroyed()) return
            const live = new Set()

            // Colour carries the finding, not the object: what matters about
            // a detection on a repeat scan is whether it is new, gone or
            // simply still there.
            const COLOUR = {
                new: "#f5d98f", gone: "#f46043", moved: "#a0b2d2",
                persisted: "#6f8fa8", baseline: "#6f8fa8", unconfirmed: "#4a5a66",
            }

            for (const d of (detections || [])) {
                const id = d.detection_id || d.id
                if (id == null || d.centroid_lat == null || d.centroid_lon == null) continue
                live.add(id)
                const kind = d.change_type || "persisted"
                const isSel = id === selectedDetectionId
                const col = Color.fromCssColorString(COLOUR[kind] || COLOUR.persisted)
                let ent = detEntitiesRef.current.get(id)
                const pos = Cartesian3.fromDegrees(d.centroid_lon, d.centroid_lat)
                if (!ent) {
                    ent = viewer.entities.add({
                        id: `det:${id}`,
                        position: pos,
                        point: {
                            pixelSize: isSel ? 11 : 7,
                            color: col.withAlpha(kind === "unconfirmed" ? 0.45 : 0.95),
                            outlineColor: isSel ? Color.WHITE : col.withAlpha(0.5),
                            outlineWidth: isSel ? 2 : 1,
                            // Points must not swell into blobs when the
                            // camera comes in close.
                            scaleByDistance: new NearFarScalar(1.0e3, 1.0, 8.0e6, 0.4),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                        // The hover text is the sentence the product promises:
                        // never a bare identifier, always what and where.
                        name: `${(d.object_type || "object").replace(/_/g, " ")} at `
                              + `${Number(d.centroid_lat).toFixed(4)}, ${Number(d.centroid_lon).toFixed(4)}`
                              + (d.confidence != null ? ` · ${Math.round(d.confidence * 100)}%` : "")
                              + (d.change_type ? ` · ${d.change_type}` : ""),
                    })
                    detEntitiesRef.current.set(id, ent)
                } else {
                    ent.position = pos
                    ent.point.pixelSize = isSel ? 11 : 7
                    ent.point.color = col.withAlpha(kind === "unconfirmed" ? 0.45 : 0.95)
                    ent.point.outlineColor = isSel ? Color.WHITE : col.withAlpha(0.5)
                    ent.point.outlineWidth = isSel ? 2 : 1
                }
            }

            // Drop points for detections no longer in the set, or a scan
            // switch would leave the previous scan's objects on the map and
            // silently overstate what is there.
            for (const [id, ent] of detEntitiesRef.current.entries()) {
                if (!live.has(id)) {
                    try { viewer.entities.remove(ent) } catch (_e) {}
                    detEntitiesRef.current.delete(id)
                }
            }
        })
    }, [detections, selectedDetectionId, ready])

    // ── Fly-to-zone (opt-in — see file header comment) ──────────────────
    useEffect(() => {
        if (!ready || !flyToZoneId) return
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return
        const zone = zones.find(z => z.system_id === flyToZoneId)
        if (!zone?.bbox) return

        let cancelled = false
        import("cesium").then(({ Rectangle }) => {
            if (cancelled || viewer.isDestroyed()) return
            const { min_lon, min_lat, max_lon, max_lat } = zone.bbox
            viewer.camera.flyTo({
                destination: Rectangle.fromDegrees(min_lon, min_lat, max_lon, max_lat),
                duration: 1.2,
            })
        })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flyToZoneId, ready])

    // ── Default view: zoomed to the real user location ──────────────────
    // zonesCenter()'s fallback (no real zone bbox to frame) is a generic
    // 15,000km world view — once the real device location resolves, and
    // there's still no real zone data to frame instead, fly there zoomed in
    // rather than leaving the generic world default. Never fabricated: no
    // real location resolved (denied/unavailable) means this simply never
    // fires and the existing honest fallback view stands.
    useEffect(() => {
        if (!ready || !userLoc) return
        if (zones.some(z => z.bbox)) return // real zone data takes priority
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return
        let cancelled = false
        import("cesium").then(({ Cartesian3 }) => {
            if (cancelled || viewer.isDestroyed()) return
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(userLoc.lon, userLoc.lat, USER_LOCATION_ZOOM_HEIGHT),
                duration: 1,
            })
        })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, userLoc])

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
            {ready && <AoiLockDimming viewer={viewerRef.current} bounds={lockBounds} active={lockActive} />}
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
            {/* Every real map instance needs the bottom-left readout — and
                it is the same component the main globe uses, measuring this
                viewer instead of the published one. */}
            {ready && viewerRef.current && <MapMeta viewer={viewerRef.current} />}
        </div>
    )
}
