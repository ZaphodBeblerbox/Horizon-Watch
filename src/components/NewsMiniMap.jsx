/**
 * NewsMiniMap.jsx — small persistent Cesium viewer for the NewsPage desktop
 * two-pane layout, plotting real story locations alongside the article list.
 *
 * Reuses the same lightweight embedded-Cesium pattern already established by
 * ForgePanel.jsx's DrawZoneGlobe (dynamic `import("cesium")`, identical
 * minimal-chrome Viewer options, the shared esriSatelliteProvider imagery)
 * rather than inventing a second mini-map approach or reaching for a
 * different mapping library — this keeps exactly one way lightweight
 * embedded globes get built in this codebase.
 *
 * Marker glyphs come from globe/entityIcons.js's "news_event" entity type
 * (the same glyph GlobeEventsLayer.jsx uses for news markers on the main
 * globe) — no new marker style is invented here. The selected marker is
 * drawn larger, in the Round 1 accent color (--accent, #22D3EE from
 * index.html :root), with a pulse ring, so selection is immediately visible.
 */
import { useEffect, useRef, useState } from "react"
import { esriSatelliteProvider } from "../globe/imageryProviders.js"
import { getEntityMarkerDataUri } from "../globe/entityIcons.js"
import ScaleBar from "./ScaleBar.jsx"
import CoordinateReadout from "./CoordinateReadout.jsx"

// Mirrors NewsPage.jsx's TIER_COLOR — duplicated here (not exported/shared)
// because NewsPage.jsx already duplicates these same literal hexes in more
// than one place (PanelFeaturedCard's tierBadgeColor); consistent with that
// existing pattern rather than introducing new cross-file coupling.
const TIER_COLOR = {
    critical:    "#ef4444",
    significant: "#f97316",
    elevated:    "#eab308",
    low:         "#0d9488",
}
const DEFAULT_COLOR  = "#38bdf8"
const SELECTED_COLOR = "#22D3EE" // Round 1 --accent (index.html :root)

export default function NewsMiniMap({ markers = [], selectedId = null, onSelectMarker }) {
    const containerRef  = useRef(null)
    const viewerRef     = useRef(null)
    const entitiesRef   = useRef(new Map())   // marker id -> Cesium Entity
    const onSelectRef   = useRef(onSelectMarker)
    const [ready, setReady] = useState(false)
    const [err,   setErr]   = useState(null)

    useEffect(() => { onSelectRef.current = onSelectMarker }, [onSelectMarker])

    // ── One-time viewer init ──────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return
        let viewer  = null
        let handler = null
        let cancelled = false

        import("cesium").then(C => {
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
            viewer.camera.setView({ destination: Cartesian3.fromDegrees(10, 20, 18_000_000) })

            handler = new SEH(viewer.scene.canvas)
            handler.setInputAction((evt) => {
                const picked = viewer.scene.pick(evt.position)
                const id = picked?.id?.id
                if (id && onSelectRef.current) onSelectRef.current(id)
            }, SET.LEFT_CLICK)

            setReady(true)
        }).catch(_e => setErr("Cesium load failed"))

        return () => {
            cancelled = true
            if (handler) { try { handler.destroy() } catch (_e) {} }
            entitiesRef.current.clear()
            if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.destroy()
                viewerRef.current = null
            }
        }
    }, [])

    // ── Sync marker entities whenever the plottable set or selection changes ─
    useEffect(() => {
        if (!ready) return
        const viewer = viewerRef.current
        if (!viewer || viewer.isDestroyed()) return

        import("cesium").then(({ Cartesian3 }) => {
            if (!viewer || viewer.isDestroyed()) return

            const nextIds = new Set(markers.map(m => m.id))
            for (const [id, ent] of entitiesRef.current) {
                if (!nextIds.has(id)) {
                    try { viewer.entities.remove(ent) } catch (_e) {}
                    entitiesRef.current.delete(id)
                }
            }

            for (const m of markers) {
                const isSelected = m.id === selectedId
                const hex = TIER_COLOR[m.article?.severity_tier] || DEFAULT_COLOR
                const size = isSelected ? 40 : 26
                const icon = getEntityMarkerDataUri({
                    entityType: "news_event",
                    color:      isSelected ? SELECTED_COLOR : hex,
                    size,
                    pulse:      isSelected,
                })

                let ent = entitiesRef.current.get(m.id)
                if (!ent) {
                    ent = viewer.entities.add({
                        id: m.id,
                        position: Cartesian3.fromDegrees(m.lon, m.lat, 0),
                        billboard: {
                            image: icon,
                            width: size,
                            height: size,
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                    })
                    entitiesRef.current.set(m.id, ent)
                } else {
                    ent.billboard.image  = icon
                    ent.billboard.width  = size
                    ent.billboard.height = size
                }
            }
        })
    }, [markers, selectedId, ready])

    return (
        <div style={{ position: "relative", width: "100%", height: "100%", background: "#050b1a" }}>
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
            {err && (
                <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "rgba(255,255,255,0.35)", fontSize: 11,
                    padding: 12, textAlign: "center",
                }}>{err}</div>
            )}
            {!err && ready && markers.length === 0 && (
                <div style={{
                    position: "absolute", top: 8, left: 8, right: 8,
                    color: "rgba(255,255,255,0.4)", fontSize: 10, pointerEvents: "none",
                }}>No geotagged stories in this list yet</div>
            )}
            {/* UI correction pass, Part 7.5: every real map instance needs the
                bottom-left scale bar + coordinate readout — this one was
                missing it. Both components take a plain `viewer` prop and
                don't need resium/useCesium() context. */}
            {ready && viewerRef.current && (
                <>
                    <ScaleBar viewer={viewerRef.current} />
                    <CoordinateReadout viewer={viewerRef.current} />
                </>
            )}
        </div>
    )
}
