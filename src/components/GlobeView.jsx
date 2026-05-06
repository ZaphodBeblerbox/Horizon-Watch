import "../cesiumConfig.js"
import { useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer, Cesium3DTileset } from "resium"
import { Cartesian3, IonResource } from "cesium"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriSatelliteProvider, openSeaMapProvider } from "../globe/imageryProviders.js"
import GlobeAlertLayer          from "../globe/GlobeAlertLayer.jsx"
import GlobeAISLayer            from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer           from "../globe/GlobeADSBLayer.jsx"
import GlobeEEZLayer            from "../globe/GlobeEEZLayer.jsx"
import GlobeCountryBordersLayer from "../globe/GlobeCountryBordersLayer.jsx"
import GlobeCablesLayer         from "../globe/GlobeCablesLayer.jsx"
import GlobeChokepointsLayer    from "../globe/GlobeChokepointsLayer.jsx"
import GlobePOILayer            from "../globe/GlobePOILayer.jsx"
import GlobeEventsLayer         from "../globe/GlobeEventsLayer.jsx"
import GlobePopup               from "../globe/GlobePopup.jsx"
import API_BASE from "../apiBase.js"

const API = API_BASE

function zoomToAlt(zoom) {
    return 38_000_000 / Math.pow(2, zoom || 3)
}

const isMobile = /iPhone|iPad|Android/i.test(
    typeof navigator !== "undefined" ? navigator.userAgent : ""
) || (typeof window !== "undefined" && window.innerWidth < 1024)

export default function GlobeView({
    center           = [20, 10],
    zoom             = 3,
    // Layer toggles — mirror workspace layer keys
    infraEnabled     = false,   // OIM — PBF tiles, 2D-only; accepted but not rendered
    nauticalEnabled  = false,
    adsbEnabled      = false,
    aisEnabled       = false,
    eezEnabled       = false,
    bordersEnabled   = false,
    cablesEnabled    = false,
    chokepointsEnabled = false,
    poiEnabled       = false,
    eventsEnabled    = true,
    // Data props (optional — GlobeView fetches internally when null)
    surfaceItems     = [],
    aisVessels:   externalAIS  = null,
    adsbAircraft: externalADSB = null,
}) {
    const viewerRef = useRef(null)
    const [vessels,  setVessels]  = useState([])
    const [aircraft, setAircraft] = useState([])

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

    // Apply adaptive rendering quality once viewer is ready
    useEffect(() => {
        let attempts = 0
        const tryApply = () => {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) {
                if (attempts++ < 15) setTimeout(tryApply, 250)
                return
            }
            viewer.resolutionScale = isMobile ? 1.0 : (window.devicePixelRatio || 1.0)
            viewer.scene.globe.maximumScreenSpaceError = isMobile ? 4.0 : 1.5
            viewer.scene.postProcessStages.fxaa.enabled = !isMobile
            viewer.scene.highDynamicRange = false
            viewer.scene.globe.tileCacheSize = isMobile ? 200 : 1000
        }
        tryApply()
    }, [])

    const aisData  = externalAIS  !== null ? externalAIS  : vessels
    const adsbData = externalADSB !== null ? externalADSB : aircraft

    const initialDestination = useMemo(() =>
        Cartesian3.fromDegrees(center[1] ?? 10, center[0] ?? 20, zoomToAlt(zoom))
    , []) // eslint-disable-line react-hooks/exhaustive-deps

    // When any tile overlay layer is active, swap from 3D photorealistic tiles to
    // ESRI satellite so ImageryLayers render on the ellipsoid surface unobstructed.
    const overlayActive = nauticalEnabled

    return (
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
                        maximumScreenSpaceError={isMobile ? 16 : 8}
                        maximumMemoryUsage={isMobile ? 256 : 1024}
                        dynamicScreenSpaceError={true}
                        dynamicScreenSpaceErrorDensity={0.00278}
                        dynamicScreenSpaceErrorFactor={4.0}
                        preferLeaves={true}
                        onReady={ts  => console.log("[GlobeView] tileset ready, tiles:", ts.tilesLoaded)}
                        onError={err => console.error("[GlobeView] tileset error:", err)}
                    />
                ) : (
                    <>
                        <ImageryLayer imageryProvider={esriSatelliteProvider} maximumTerrainLevel={20} />
                        <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} maximumTerrainLevel={18} />
                    </>
                )}

                {/* Nautical seamark overlay on top of 3D tiles */}
                {!overlayActive && nauticalEnabled && (
                    <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} maximumTerrainLevel={18} />
                )}

                {/* ── GeoJSON line layers ─────────────────────────────────────── */}
                <GlobeEEZLayer            enabled={eezEnabled} />
                <GlobeCountryBordersLayer enabled={bordersEnabled} />
                <GlobeCablesLayer         enabled={cablesEnabled} />

                {/* ── Point / entity layers ───────────────────────────────────── */}
                <GlobeChokepointsLayer enabled={chokepointsEnabled} />
                <GlobePOILayer         enabled={poiEnabled} />
                <GlobeEventsLayer      enabled={eventsEnabled} />

                {/* Intelligence surface events — severity-ringed alert markers */}
                <GlobeAlertLayer alerts={surfaceItems} />

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}  />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} />}

                <CameraFlyTo
                    destination={initialDestination}
                    duration={0}
                    once={true}
                />
            </Viewer>

            {/* Custom popup overlay — replaces Cesium's built-in infoBox */}
            <GlobePopup viewerRef={viewerRef} />
        </div>
    )
}
