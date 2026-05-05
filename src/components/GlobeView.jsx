import "../cesiumConfig.js"
import { useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer, Cesium3DTileset } from "resium"
import { Cartesian3, IonResource, Ion } from "cesium"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriSatelliteProvider, openSeaMapProvider } from "../globe/imageryProviders.js"
import GlobeAlertLayer from "../globe/GlobeAlertLayer.jsx"
import GlobeAISLayer   from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer  from "../globe/GlobeADSBLayer.jsx"
import API_BASE from "../apiBase.js"

const API = API_BASE

// NOTE: Cesium3DTileStyle is NOT used here.
// Google Photorealistic 3D Tiles (GLB/glTF content) do not support Cesium3DTileStyle —
// applying any style replaces the texture pipeline with flat geometry, causing the blue-grid
// artefact. Instead, when an imagery overlay is enabled we swap out the 3D tileset entirely
// and use ESRI satellite as the base so ImageryLayers can render on the ellipsoid surface.

function zoomToAlt(zoom) {
    return 38_000_000 / Math.pow(2, zoom || 3)
}

export default function GlobeView({
    center          = [20, 10],
    zoom            = 3,
    infraEnabled    = false,
    nauticalEnabled = false,
    adsbEnabled     = false,
    aisEnabled      = false,
    surfaceItems    = [],
    aisVessels:   externalAIS  = null,
    adsbAircraft: externalADSB = null,
}) {
    const viewerRef = useRef(null)

    const [vessels,  setVessels]  = useState([])
    const [aircraft, setAircraft] = useState([])

    // Diagnostic — logs to console so prop wiring can be verified in DevTools
    useEffect(() => {
        console.log("[GlobeView] props:", {
            infraEnabled, nauticalEnabled, adsbEnabled, aisEnabled,
            surfaceItems: surfaceItems.length,
            externalAIS:  externalAIS?.length  ?? "internal",
            externalADSB: externalADSB?.length ?? "internal",
            ionToken: !!Ion.defaultAccessToken,
        })
    })

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

    const aisData  = externalAIS  !== null ? externalAIS  : vessels
    const adsbData = externalADSB !== null ? externalADSB : aircraft

    const initialDestination = useMemo(() =>
        Cartesian3.fromDegrees(center[1] ?? 10, center[0] ?? 20, zoomToAlt(zoom))
    , []) // eslint-disable-line react-hooks/exhaustive-deps

    // Swap base layer when nautical overlay is active:
    //   - Default: Google Photorealistic 3D Tiles
    //   - Nautical active: ESRI satellite base + OpenSeaMap on top
    //   OIM infrastructure tiles are PBF vector — Cesium cannot render them, so infraEnabled
    //   has no effect in globe mode (it renders via InfrastructureLayer in Leaflet only).
    const overlayActive = nauticalEnabled

    return (
        <div style={{ position: "absolute", inset: 0 }}>
            <style>{`
                .cesium-viewer .cesium-widget-credits { font-size: 10px !important; opacity: 0.55; }
                .cesium-viewer-bottom { bottom: 0 !important; }
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
                scene3DOnly={true}
            >
                {!overlayActive ? (
                    <Cesium3DTileset
                        url={IonResource.fromAssetId(2275207)}
                        showCreditsOnScreen={true}
                        onReady={ts  => console.log("[GlobeView] 3D tileset ready, tiles:", ts.tilesLoaded)}
                        onError={err => console.error("[GlobeView] 3D tileset error:", err)}
                    />
                ) : (
                    <>
                        <ImageryLayer imageryProvider={esriSatelliteProvider} />
                        {nauticalEnabled && (
                            <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} />
                        )}
                    </>
                )}

                {/* Nautical can also overlay on top of the 3D tiles over water */}
                {!overlayActive && nauticalEnabled && (
                    <ImageryLayer imageryProvider={openSeaMapProvider} alpha={0.8} />
                )}

                {/* Intelligence surface events — always rendered, no toggle required */}
                <GlobeAlertLayer alerts={surfaceItems} />

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}  />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} />}

                <CameraFlyTo
                    destination={initialDestination}
                    duration={0}
                    once={true}
                />
            </Viewer>
        </div>
    )
}
