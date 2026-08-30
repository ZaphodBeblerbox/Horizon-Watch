import "../cesiumConfig.js"
import { Component, useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer } from "resium"
import { Cartesian3, Math as CesiumMath, UrlTemplateImageryProvider, Credit, CesiumTerrainProvider, Color, Cartesian2, LabelStyle, VerticalOrigin, HeightReference } from "cesium"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriLabelsProvider, openSeaMapProvider, openInfraRasterProvider } from "../globe/imageryProviders.js"
import GlobeAISLayer            from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer           from "../globe/GlobeADSBLayer.jsx"
import GlobeEEZLayer            from "../globe/GlobeEEZLayer.jsx"
import GlobeCablesLayer         from "../globe/GlobeCablesLayer.jsx"
import GlobeChokepointsLayer    from "../globe/GlobeChokepointsLayer.jsx"
import GlobeEventsLayer         from "../globe/GlobeEventsLayer.jsx"
import GlobeHeatmapLayer        from "../globe/GlobeHeatmapLayer.jsx"
import GlobeOverwatchLayer      from "../globe/GlobeOverwatchLayer.jsx"
import GlobeOverwatchDrawLayer  from "../globe/GlobeOverwatchDrawLayer.jsx"
import GlobePopup               from "../globe/GlobePopup.jsx"
import GlobeDirectorLayer       from "../globe/GlobeDirectorLayer.jsx"
import GlobeAlertsLayer         from "../globe/GlobeAlertsLayer.jsx"
import GlobeThreatHeatmapLayer  from "../globe/GlobeThreatHeatmapLayer.jsx"
import GlobeAutoMode            from "../globe/GlobeAutoMode.jsx"
import GlobeAirportLayer        from "../globe/GlobeAirportLayer.jsx"
import GlobePortLayer           from "../globe/GlobePortLayer.jsx"
import GlobeStrategicZonesLayer from "../globe/GlobeStrategicZonesLayer.jsx"
import GlobeSurgeLayer          from "../globe/GlobeSurgeLayer.jsx"
import GlobeCameraLayer         from "../globe/GlobeCameraLayer.jsx"
import API_BASE from "../apiBase.js"
import { isMobile } from "../globe/isMobile.js"

const API = API_BASE

// Catches WebGL context loss and other Cesium render errors on mobile —
// returns a recovery UI instead of crashing the whole app.
class GlobeErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { crashed: false }
    }
    static getDerivedStateFromError() {
        return { crashed: true }
    }
    componentDidCatch(err) {
        console.error("[GlobeView] fatal render error:", err)
    }
    render() {
        if (this.state.crashed) {
            return (
                <div style={{
                    position: "absolute", inset: 0, background: "#050c1c",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 16, color: "rgba(148,163,184,0.7)",
                    fontFamily: "system-ui", fontSize: 13,
                }}>
                    <div style={{ fontSize: 28, opacity: 0.4 }}>⬡</div>
                    <div>3D globe failed to load</div>
                    <button
                        onClick={() => this.setState({ crashed: false })}
                        style={{
                            padding: "8px 20px", background: "rgba(45,143,232,0.15)",
                            border: "1px solid rgba(45,143,232,0.35)", borderRadius: 6,
                            color: "#2d8fe8", cursor: "pointer", fontSize: 12,
                            fontFamily: "inherit",
                        }}
                    >Retry</button>
                </div>
            )
        }
        return this.props.children
    }
}

function zoomToAlt(zoom) {
    return 38_000_000 / Math.pow(2, zoom || 3)
}

export default function GlobeView({
    center           = [20, 10],
    zoom             = 3,
    // Layer toggles — mirror workspace layer keys
    infraEnabled     = false,
    nauticalEnabled  = false,
    adsbEnabled      = false,
    aisEnabled       = false,
    eezEnabled       = false,
    cablesEnabled    = false,
    chokepointsEnabled = false,
    strategicZonesEnabled = false,
    eventsEnabled    = true,
    cityLabelsEnabled = false,
    aisHeatmapEnabled  = false,
    adsbHeatmapEnabled = false,
    heatmapHours     = 24,
    // Overwatch ML detections + draw mode
    overwatchEnabled    = false,
    overwatchDetections = [],
    overwatchDrawActive = false,
    overwatchDrawMode   = "rectangle",
    onOverwatchBounds   = null,
    onOverwatchPolygon  = null,
    overwatchSentinelOverlay = null,
    // Satellite imagery overlay (Sentinel-2)
    satelliteEnabled = false,
    satelliteOpacity = 0.9,
    // Live CCTV camera feeds (real public webcams + local YOLO detection server)
    cctvEnabled = false,
    // Infrastructure layers
    airportsEnabled = false,
    portsEnabled    = false,
    // Forge alerts/rules on the globe
    alertsEnabled = false,
    threatHeatmapEnabled = false,
    eventsMinRelevance = 4,
    precisionEventsEnabled = true,
    autoModeEnabled = false,
    // Director Mode scene (null when inactive)
    directorScene = null,
    // Data props (optional — GlobeView fetches internally when null)
    aisVessels:   externalAIS  = null,
    adsbAircraft: externalADSB = null,
}) {
    const viewerRef = useRef(null)
    const [vessels,  setVessels]  = useState([])
    const [aircraft, setAircraft] = useState([])
    const [viewBounds, setViewBounds] = useState(null)
    const [webglLost, setWebglLost] = useState(false)

    // AIS — use external prop if provided, otherwise fetch internally
    useEffect(() => {
        if (!aisEnabled) return
        if (externalAIS !== null) { setVessels(externalAIS); return }
        const load = () =>
            fetch(`${API}/api/ais/vessels`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d?.vessels) setVessels(d.vessels) })
                .catch(() => {})
        load()
        const t = setInterval(load, 60_000)
        return () => clearInterval(t)
    }, [aisEnabled, externalAIS])

    // ADSB — use external prop if provided, otherwise fetch internally
    useEffect(() => {
        if (!adsbEnabled) return
        if (externalADSB !== null) { setAircraft(externalADSB); return }
        const lat = center[0] ?? 20
        const lon = center[1] ?? 10
        const load = () =>
            fetch(`${API}/adsb?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&dist=2000`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setAircraft(d.aircraft || d.states || []) })
                .catch(() => {})
        load()
        const t = setInterval(load, 10_000)
        return () => clearInterval(t)
    }, [adsbEnabled, externalADSB]) // eslint-disable-line react-hooks/exhaustive-deps

    // akili:fly-to — triggered by GlobalSearch and other search components
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon, altitude = 100_000 } = e.detail || {}
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer || lat == null || lon == null) return
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, altitude),
                duration: 1.5,
            })
        }
        window.addEventListener("akili:fly-to", handler)
        return () => window.removeEventListener("akili:fly-to", handler)
    }, [])

    // akili:search-marker — temporary blue dot + label after a search fly-to
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon, name, osm_type, category } = e.detail || {}
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer || lat == null || lon == null) return

            const pos    = Cartesian3.fromDegrees(lon, lat)
            const dotCol = Color.fromCssColorString("#34AADC")
            const isArea = category === "country" || category === "boundary" || osm_type === "relation"

            const marker = viewer.entities.add({
                position: pos,
                point: {
                    pixelSize:                12,
                    color:                    dotCol,
                    outlineColor:             Color.WHITE,
                    outlineWidth:             2,
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: name ? {
                    text:                     name,
                    font:                     "13px sans-serif",
                    fillColor:                Color.WHITE,
                    outlineColor:             Color.BLACK,
                    outlineWidth:             2,
                    style:                    LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin:           VerticalOrigin.BOTTOM,
                    pixelOffset:              new Cartesian2(0, -16),
                    heightReference:          HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                } : undefined,
            })

            let circle = null
            if (isArea) {
                const radius = category === "country" ? 200_000 : 50_000
                circle = viewer.entities.add({
                    position: pos,
                    ellipse: {
                        semiMinorAxis: radius,
                        semiMajorAxis: radius,
                        material:      dotCol.withAlpha(0.15),
                        outline:       true,
                        outlineColor:  dotCol.withAlpha(0.6),
                        outlineWidth:  2,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    },
                })
            }

            setTimeout(() => {
                if (viewer.entities.contains(marker)) viewer.entities.remove(marker)
                if (circle && viewer.entities.contains(circle)) viewer.entities.remove(circle)
            }, 4000)
        }
        window.addEventListener("akili:search-marker", handler)
        return () => window.removeEventListener("akili:search-marker", handler)
    }, [])

    // Apply maximum rendering quality + WebGL context loss recovery
    useEffect(() => {
        let attempts = 0
        let canvas = null
        const onLost    = () => setWebglLost(true)
        const onRestored = () => setWebglLost(false)
        const tryApply = () => {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryApply, 250)
                return
            }
            viewer.resolutionScale = window.devicePixelRatio
            viewer.scene.globe.maximumScreenSpaceError = 1
            viewer.scene.postProcessStages.fxaa.enabled = true
            viewer.scene.highDynamicRange = false
            viewer.scene.fog.enabled = true
            viewer.scene.fog.density = 0.0003
            viewer.scene.globe.showGroundAtmosphere = true
            if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
            viewer.scene.globe.tileCacheSize = 1000
            viewer.targetFrameRate = 60
            viewer.scene.requestRenderMode = true
            viewer.scene.maximumRenderTimeChange = 0.05
            CesiumTerrainProvider.fromIonAssetId(1).then(tp => { viewer.terrainProvider = tp }).catch(() => {})
            // Listen for WebGL context loss on the Cesium canvas
            canvas = viewer.canvas
            canvas.addEventListener("webglcontextlost",     onLost)
            canvas.addEventListener("webglcontextrestored", onRestored)
        }
        tryApply()
        return () => {
            canvas?.removeEventListener("webglcontextlost",     onLost)
            canvas?.removeEventListener("webglcontextrestored", onRestored)
        }
    }, [])

    // Track camera viewport bounds for event layer scoping
    useEffect(() => {
        let cleanup = null
        let attempts = 0
        const tryAttach = () => {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 20) setTimeout(tryAttach, 300)
                return
            }
            const update = () => {
                const rect = viewer.camera.computeViewRectangle()
                if (!rect) return
                const w = CesiumMath.toDegrees(rect.west)
                const s = CesiumMath.toDegrees(rect.south)
                const e = CesiumMath.toDegrees(rect.east)
                const n = CesiumMath.toDegrees(rect.north)
                // Don't bother with bbox when nearly whole globe is visible
                if ((n - s) > 160 || (e - w) > 340) {
                    setViewBounds(null)
                } else {
                    setViewBounds({ south: s, north: n, west: w, east: e })
                }
            }
            update()
            viewer.camera.moveEnd.addEventListener(update)
            cleanup = () => viewer.camera.moveEnd.removeEventListener(update)
        }
        tryAttach()
        return () => { cleanup?.() }
    }, [])

    const aisData  = externalAIS  !== null ? externalAIS  : vessels
    const adsbData = externalADSB !== null ? externalADSB : aircraft

    const initialDestination = useMemo(() =>
        Cartesian3.fromDegrees(center[1] ?? 10, center[0] ?? 20, zoomToAlt(zoom))
    , []) // eslint-disable-line react-hooks/exhaustive-deps

    // Sentinel-2 imagery provider — recreated only when enabled (requires Copernicus credentials)
    const sentinelProvider = useMemo(() => {
        if (!satelliteEnabled) return null
        return new UrlTemplateImageryProvider({
            url:          `${API_BASE}/satellite/tile/{z}/{x}/{y}.png`,
            minimumLevel: 8,
            maximumLevel: 18,
            credit:       new Credit("Copernicus Sentinel-2", false),
        })
    }, [satelliteEnabled])

    // When any raster imagery overlay is active, swap from 3D photorealistic tiles to
    // flat ESRI satellite so ImageryLayers render on the ellipsoid unobstructed.

    if (webglLost) return (
        <div style={{
            position: "absolute", inset: 0, background: "#050c1c",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 16, color: "rgba(148,163,184,0.7)",
            fontFamily: "system-ui", fontSize: 13,
        }}>
            <div style={{ fontSize: 28, opacity: 0.4 }}>⬡</div>
            <div>WebGL context lost — recovering…</div>
            <button
                onClick={() => setWebglLost(false)}
                style={{
                    padding: "8px 20px", background: "rgba(45,143,232,0.15)",
                    border: "1px solid rgba(45,143,232,0.35)", borderRadius: 6,
                    color: "#2d8fe8", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                }}
            >Retry</button>
        </div>
    )

    return (
        <GlobeErrorBoundary>
        <div style={{ position: "absolute", inset: 0 }}>
            <style>{`
                /* Minimise Cesium branding — required by Ion ToS but can be shrunk */
                .cesium-viewer .cesium-widget-credits {
                    font-size: 8px !important;
                    opacity: 0.35 !important;
                    transform: scale(0.75);
                    transform-origin: bottom right;
                    right: 4px !important;
                    bottom: 4px !important;
                    left: auto !important;
                    position: absolute !important;
                }
                .cesium-viewer .cesium-credit-logoContainer img {
                    height: 12px !important;
                    opacity: 0.4;
                }
                .cesium-viewer .cesium-credit-textContainer {
                    font-size: 8px !important;
                    opacity: 0.3 !important;
                }
                .cesium-viewer-bottom { bottom: 0 !important; }
                /* Suppress the default selection indicator green ring */
                .cesium-selection-wrapper { display: none !important; }
            `}</style>
            <Viewer
                ref={viewerRef}
                style={{ width: "100%", height: "100%" }}
                timeline={false}
                animation={false}
                homeButton={false}
                geocoder={false}
                sceneModePicker={false}
                baseLayerPicker={false}
                navigationHelpButton={false}
                fullscreenButton={false}
                selectionIndicator={false}
                infoBox={false}
                scene3DOnly={true}
            >
                {/* Raster overlays — rendered on top of ESRI base when active */}
                {satelliteEnabled && sentinelProvider && (
                    <ImageryLayer imageryProvider={sentinelProvider} alpha={satelliteOpacity} maximumTerrainLevel={18} />
                )}
                {nauticalEnabled && (
                    <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} maximumTerrainLevel={18} />
                )}
                {infraEnabled && (
                    <ImageryLayer imageryProvider={openInfraRasterProvider} alpha={0.85} maximumTerrainLevel={18} />
                )}

                {/* ── GeoJSON line layers ─────────────────────────────────────── */}
                <GlobeEEZLayer            enabled={eezEnabled} />
                <GlobeCablesLayer         enabled={cablesEnabled} />

                {/* ── Point / entity layers ───────────────────────────────────── */}
                <GlobeStrategicZonesLayer enabled={strategicZonesEnabled} />
                <GlobeChokepointsLayer  enabled={chokepointsEnabled} />
                <GlobeEventsLayer       enabled={eventsEnabled} precisionEnabled={precisionEventsEnabled} bounds={viewBounds} minRelevance={eventsMinRelevance} />
                <GlobeSurgeLayer        enabled={eventsEnabled} />
                {cityLabelsEnabled && (
                    <ImageryLayer imageryProvider={esriLabelsProvider} alpha={1.0} maximumTerrainLevel={19} />
                )}

                {/* ── Heatmap overlays (rectangle entities, clamped to ground) ─ */}
                <GlobeHeatmapLayer enabled={aisHeatmapEnabled}  domain="ais"  hours={heatmapHours} bounds={viewBounds} />
                <GlobeHeatmapLayer enabled={adsbHeatmapEnabled} domain="adsb" hours={heatmapHours} bounds={viewBounds} />

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}   viewBounds={viewBounds} />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} viewBounds={viewBounds} />}

                {/* ── Overwatch ML detection boxes (portal sidebar already renders via document.body) ── */}
                <GlobeOverwatchLayer enabled={overwatchEnabled} detections={overwatchDetections} sentinelOverlay={overwatchSentinelOverlay} />

                {/* ── Overwatch draw mode: rectangle or polygon selection on globe ── */}
                <GlobeOverwatchDrawLayer
                    active={overwatchDrawActive}
                    drawMode={overwatchDrawMode}
                    onBounds={onOverwatchBounds}
                    onPolygon={onOverwatchPolygon}
                />

                {/* ── Infrastructure layers (viewport-culled) ─────────────────── */}
                <GlobeAirportLayer enabled={airportsEnabled} viewBounds={viewBounds} />
                <GlobePortLayer    enabled={portsEnabled}    viewBounds={viewBounds} />

                {/* ── Forge alerts layer ──────────────────────────────────────── */}
                <GlobeAlertsLayer enabled={alertsEnabled} />

                {/* ── Threat heatmap layer ─────────────────────────────────────── */}
                <GlobeThreatHeatmapLayer enabled={threatHeatmapEnabled} />

                {/* ── Live CCTV camera feeds ───────────────────────────────────── */}
                {cctvEnabled && <GlobeCameraLayer />}

                {/* ── Passive auto mode ────────────────────────────────────────── */}
                <GlobeAutoMode enabled={autoModeEnabled} isMobile={isMobile} />

                {/* ── Director Mode 3D rendering ──────────────────────────────── */}
                <GlobeDirectorLayer scene={directorScene} />

                <CameraFlyTo
                    destination={initialDestination}
                    duration={0}
                    once={true}
                />
            </Viewer>

            {/* Custom popup overlay — replaces Cesium's built-in infoBox */}
            <GlobePopup viewerRef={viewerRef} infraEnabled={infraEnabled} />

        </div>
        </GlobeErrorBoundary>
    )
}
