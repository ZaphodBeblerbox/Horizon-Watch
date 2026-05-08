import "../cesiumConfig.js"
import { Component, useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer, Cesium3DTileset } from "resium"
import { Cartesian3, IonResource, Math as CesiumMath, UrlTemplateImageryProvider, Credit } from "cesium"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriSatelliteProvider, openSeaMapProvider, openInfraRasterProvider } from "../globe/imageryProviders.js"
import GlobeAISLayer            from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer           from "../globe/GlobeADSBLayer.jsx"
import GlobeEEZLayer            from "../globe/GlobeEEZLayer.jsx"
import GlobeCountryBordersLayer from "../globe/GlobeCountryBordersLayer.jsx"
import GlobeCablesLayer         from "../globe/GlobeCablesLayer.jsx"
import GlobeChokepointsLayer    from "../globe/GlobeChokepointsLayer.jsx"
import GlobePOILayer            from "../globe/GlobePOILayer.jsx"
import GlobeEventsLayer         from "../globe/GlobeEventsLayer.jsx"
import GlobeHeatmapLayer        from "../globe/GlobeHeatmapLayer.jsx"
import GlobeOverwatchLayer      from "../globe/GlobeOverwatchLayer.jsx"
import GlobeCityLabelsLayer     from "../globe/GlobeCityLabelsLayer.jsx"
import GlobePopup               from "../globe/GlobePopup.jsx"
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
    bordersEnabled   = false,
    cablesEnabled    = false,
    chokepointsEnabled = false,
    poiEnabled       = false,
    eventsEnabled    = true,
    cityLabelsEnabled = false,
    aisHeatmapEnabled  = false,
    adsbHeatmapEnabled = false,
    heatmapHours     = 24,
    // Overwatch ML detections
    overwatchEnabled    = false,
    overwatchDetections = [],
    // Satellite imagery overlay (Sentinel-2)
    satelliteEnabled = false,
    // Data props (optional — GlobeView fetches internally when null)
    aisVessels:   externalAIS  = null,
    adsbAircraft: externalADSB = null,
}) {
    const viewerRef = useRef(null)
    const [vessels,  setVessels]  = useState([])
    const [aircraft, setAircraft] = useState([])
    const [viewBounds, setViewBounds] = useState(null)

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

    // Apply maximum rendering quality — same settings for all devices
    useEffect(() => {
        let attempts = 0
        const tryApply = () => {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryApply, 250)
                return
            }
            viewer.resolutionScale = window.devicePixelRatio || 2.0
            viewer.scene.globe.maximumScreenSpaceError = 1.0
            viewer.scene.postProcessStages.fxaa.enabled = true
            viewer.scene.highDynamicRange = false
            viewer.scene.fog.enabled = true
            viewer.scene.fog.density = 0.0002
            viewer.scene.globe.showGroundAtmosphere = true
            if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
            viewer.scene.globe.tileCacheSize = 1000
            viewer.targetFrameRate = 60
            viewer.scene.requestRenderMode = false
        }
        tryApply()
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
    const overlayActive = nauticalEnabled || infraEnabled || satelliteEnabled

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
                {/* ── Base layer ─────────────────────────────────────────────── */}
                {!overlayActive ? (
                    <Cesium3DTileset
                        url={IonResource.fromAssetId(2275207)}
                        showCreditsOnScreen={true}
                        maximumScreenSpaceError={4}
                        maximumMemoryUsage={2048}
                        preloadWhenHidden={false}
                        skipLevelOfDetail={false}
                        dynamicScreenSpaceError={true}
                        dynamicScreenSpaceErrorDensity={0.00278}
                        dynamicScreenSpaceErrorFactor={4.0}
                        preferLeaves={true}
                        onReady={ts  => console.log("[GlobeView] tileset ready, tiles:", ts.tilesLoaded)}
                        onError={err => console.error("[GlobeView] tileset error:", err)}
                    />
                ) : (
                    <ImageryLayer imageryProvider={esriSatelliteProvider} maximumTerrainLevel={20} />
                )}

                {/* Raster overlays — rendered on top of ESRI base when active */}
                {satelliteEnabled && sentinelProvider && (
                    <ImageryLayer imageryProvider={sentinelProvider} alpha={0.9} maximumTerrainLevel={18} />
                )}
                {nauticalEnabled && (
                    <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} maximumTerrainLevel={18} />
                )}
                {infraEnabled && (
                    <ImageryLayer imageryProvider={openInfraRasterProvider} alpha={0.85} maximumTerrainLevel={18} />
                )}

                {/* ── GeoJSON line layers ─────────────────────────────────────── */}
                <GlobeEEZLayer            enabled={eezEnabled} />
                <GlobeCountryBordersLayer enabled={bordersEnabled} />
                <GlobeCablesLayer         enabled={cablesEnabled} />

                {/* ── Point / entity layers ───────────────────────────────────── */}
                <GlobeChokepointsLayer  enabled={chokepointsEnabled} />
                <GlobePOILayer          enabled={poiEnabled} />
                <GlobeEventsLayer       enabled={eventsEnabled} bounds={viewBounds} />
                <GlobeCityLabelsLayer   enabled={cityLabelsEnabled} />

                {/* ── Heatmap overlays (rectangle entities, clamped to ground) ─ */}
                <GlobeHeatmapLayer enabled={aisHeatmapEnabled}  domain="ais"  hours={heatmapHours} bounds={viewBounds} />
                <GlobeHeatmapLayer enabled={adsbHeatmapEnabled} domain="adsb" hours={heatmapHours} bounds={viewBounds} />

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}  />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} />}

                {/* ── Overwatch ML detection boxes (portal sidebar already renders via document.body) ── */}
                <GlobeOverwatchLayer enabled={overwatchEnabled} detections={overwatchDetections} />

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
