import "../cesiumConfig.js"
import { filterVessels, filterAircraft, facet, vesselFlag, vesselType, aircraftCountry, aircraftKind } from "../globe/trackFilters.js"
import { MARKER_DEPTH_TEST_M } from "../globe/entityIcons.js"
import { Component, useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer } from "resium"
import { Cartesian3, Math as CesiumMath, UrlTemplateImageryProvider, Credit, CesiumTerrainProvider, EllipsoidTerrainProvider, Cesium3DTileset, Color, Cartesian2, LabelStyle, VerticalOrigin, HeightReference, Cartographic, EllipsoidGeodesic, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium"
import { publishCameraState } from "../globe/cameraState.js"
import { publishCursor, publishScale, getScale, scaleFor, zoomLabelFor } from "../globe/mapReadout.js"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriLabelsProvider, esriSatelliteProvider, esriDarkProvider, esriLightProvider, openSeaMapProvider, openInfraRasterProvider, offlineBasemapProvider } from "../globe/imageryProviders.js"
import GlobeAISLayer            from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer           from "../globe/GlobeADSBLayer.jsx"
import GlobeTrackLayer          from "../globe/GlobeTrackLayer.jsx"
import GlobeSelectedTrackLayer  from "../globe/GlobeSelectedTrackLayer.jsx"
import GlobeFollowLayer         from "../globe/GlobeFollowLayer.jsx"
import GlobeGfwLayer            from "../globe/GlobeGfwLayer.jsx"
import GlobeAirspaceLayer       from "../globe/GlobeAirspaceLayer.jsx"
import GlobeFlowsLayer          from "../globe/GlobeFlowsLayer.jsx"
import { watchProvider, health } from "../globe/tileHealth.js"
import GlobeRiskChoroplethLayer from "../globe/GlobeRiskChoroplethLayer.jsx"
import GlobeEEZLayer            from "../globe/GlobeEEZLayer.jsx"
import GlobeCablesLayer         from "../globe/GlobeCablesLayer.jsx"
import GlobeGraticuleLayer      from "../globe/GlobeGraticuleLayer.jsx"
import GlobeChokepointsLayer    from "../globe/GlobeChokepointsLayer.jsx"
import GlobeDerivedAlertsLayer  from "../globe/GlobeDerivedAlertsLayer.jsx"
import GlobeCoverageLayer       from "../globe/GlobeCoverageLayer.jsx"
import GlobeGeoConfirmedLayer    from "../globe/GlobeGeoConfirmedLayer.jsx"
import GlobeTelegramLayer        from "../globe/GlobeTelegramLayer.jsx"
import GlobeGdeltLayer           from "../globe/GlobeGdeltLayer.jsx"
import GlobeFrontlinesLayer      from "../globe/GlobeFrontlinesLayer.jsx"
import GlobeWarMapLayer          from "../globe/GlobeWarMapLayer.jsx"
import GlobeFacilitiesLayer      from "../globe/GlobeFacilitiesLayer.jsx"
import GlobeFiresLayer           from "../globe/GlobeFiresLayer.jsx"
import GlobeConnectorLinesLayer  from "../globe/GlobeConnectorLinesLayer.jsx"
import GlobeHeatmapLayer        from "../globe/GlobeHeatmapLayer.jsx"
import GlobeGpsInterferenceLayer from "../globe/GlobeGpsInterferenceLayer.jsx"
import GlobeOverwatchLayer      from "../globe/GlobeOverwatchLayer.jsx"
import GlobeOverwatchDrawLayer  from "../globe/GlobeOverwatchDrawLayer.jsx"
import GlobePopup               from "../globe/GlobePopup.jsx"
import GlobeAnnotationLayer     from "../globe/GlobeAnnotationLayer.jsx"
import GlobeReplayLayer         from "../globe/GlobeReplayLayer.jsx"
import GlobeAutoMode            from "../globe/GlobeAutoMode.jsx"
import GlobeAirportLayer        from "../globe/GlobeAirportLayer.jsx"
import GlobePortLayer           from "../globe/GlobePortLayer.jsx"
import MapMeta                  from "./MapMeta.jsx"
import DrawModeBanner           from "./DrawModeBanner.jsx"
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
    // Whether the Globe/Maritime home screen is the currently-active
    // destination — GlobeView stays mounted (display:none) rather than
    // unmounting when it isn't, for render-performance reasons, so
    // GlobePopup needs this to know when to close its own open inspector
    // per the full-UI-rebuild spec's docked-inspector exclusivity rules.
    isVisible        = true,
    // Real callback, not a global event — see GlobePopup.jsx's own comment
    // on why: every destination that embeds a GlobeView keeps its own
    // persistently-mounted (display:none when inactive) instance, each
    // with an independent GlobePopup/inspector, so this must be scoped to
    // THIS GlobeView, not broadcast app-wide.
    onInspectorOpenChange = null,
    dockExternally = false,
    onInspectorPopupChange = null,
    // Layer toggles — mirror workspace layer keys
    infraEnabled     = false,
    nauticalEnabled  = false,
    adsbEnabled      = false,
    aisEnabled       = false,
    eezEnabled       = false,
    cablesEnabled    = false,
    riskEnabled      = false,
    chokepointsEnabled = false,
    eventsEnabled    = true,
    // GeoConfirmed conflict-event pins (GlobeGeoConfirmedLayer.jsx) — the
    // precise replacement for raw RSS/news map points now that
    // GlobeEventsLayer is no longer mounted below. A separate prop, not a
    // reuse of eventsEnabled/precisionEventsEnabled: those two remain wired
    // for callers that still pass them (Dashboard.jsx, MapTab.jsx) but no
    // longer drive any visible layer here: GlobeSurgeLayer, the last
    // consumer of eventsEnabled, has been removed along with the threat
    // heatmap — see the PARALLAX addendum, which replaces both with the
    // §A5/§A6 derived marks.
    geoConfirmedEnabled = false,
    // GDELT machine-coded news events — separate from geoConfirmedEnabled
    // on purpose, see GlobeGdeltLayer.jsx.
    gdeltEnabled = false,
    telegramEnabled = false,
    gdeltTypes = null,
    frontlinesEnabled = false,
    warmapTheatres = [],
    frontlinesAt = null,
    gfwKinds = [],
    gfwHeatmapEnabled = false,
    airspaceEnabled = false,
    facilityTypes = [],
    onFacilityStatus = null,
    onAirspaceStatus = null,
    flowsEnabled = false,
    onFlowsStatus = null,
    // Track filters (globe/trackFilters.js) and a callback that receives
    // what is present — flags, airlines, countries — for the controls.
    vesselFilter = null,
    aircraftFilter = null,
    onTrackFacets = null,
    onBasemapHealth = null,
    // NASA FIRMS thermal anomalies — the feed that already tasks imagery,
    // finally visible.
    firesEnabled = false,
    // PARALLAX addendum §A8 — the derived surge/fusion marks.
    derivedAlertsEnabled = false,
    // PARALLAX §13 — the gaps, not the coverage.
    coverageEnabled = false,
    // Historic-timeline round — the panel's real theatre multi-select and
    // scrub-slider position, forwarded straight through to
    // GlobeGeoConfirmedLayer's own fetch (which already owns all real
    // GeoConfirmed filtering server-side; see that file's own doc comment
    // for why this is a real, single, coherent extension rather than a
    // second parallel filter). null/[] means "no theatre filter" / "live,
    // anchored at now" — every existing caller that doesn't pass these
    // keeps current unfiltered/live behavior unchanged.
    geoConfirmedTheatres = null,
    geoConfirmedEndDate = null,
    // Round 3 fix — the GeoConfirmed timeline panel docks to the bottom of
    // the map, right where this real bottom-left scale-bar/coordinate
    // chrome already lives; that chrome is genuinely on top per z-index
    // (confirmed via elementsFromPoint) but visually OVERLAPS/interleaves
    // with the panel's own text at the same screen position, reading as
    // illegible garble to a human eye even though nothing is technically
    // hidden. Real fix: push this chrome up by the panel's own real
    // measured height (reported by Situation.jsx) rather than trying to
    // dodge it horizontally (the scale bar's width varies with zoom level,
    // so a fixed horizontal exclusion zone can't be sized reliably).
    mapChromeBottomInset = 0,
    // Round 4 layout fix — same real reason as MapControlStack's
    // rightInset: the map is now a real full-bleed canvas behind the
    // Layers/Inspector overlay panes, so this chrome's own left:12 would
    // otherwise fall underneath the Layers pane whenever it's open.
    mapChromeLeftInset = 0,
    // Real root-cause fix (Time-window-doesn't-filter-the-map bug) — the
    // same real time-window/severity-floor selector Situation.jsx's own
    // header/legend/histogram counts already use (src/lib/
    // signalVisibility.js), now forwarded to every real "signal" layer
    // below (GlobeGeoConfirmedLayer, GlobeDerivedAlertsLayer).
    // null (the default) means "no window/floor passed" — every existing
    // caller that doesn't pass these (Dashboard.jsx, MapTab.jsx) keeps its
    // current unfiltered behavior unchanged. Deliberately NOT applied to
    // AIS/ADS-B live track layers — those are real raw position rendering,
    // independent of the event-domain severity/window concept by design
    // (Situation.jsx's own comment on tracksOn).
    signalWindowHours = null,
    signalMaxRank = null,
    cityLabelsEnabled = false,
    // Fidelity pass, build spec v2 §4 — a real 10° graticule overlay
    // (GlobeGraticuleLayer.jsx — genuine polylines at exact 10-degree
    // increments), the one Layers-pane "context layer" that had no prior
    // GlobeView equivalent at all.
    graticuleEnabled = false,
    aisHeatmapEnabled  = false,
    adsbHeatmapEnabled = false,
    gpsInterferenceEnabled = false,
    heatmapHours     = 24,
    // Overwatch ML detections + draw mode
    overwatchEnabled    = false,
    overwatchDetections = [],
    overwatchDrawActive = false,
    onOverwatchDrawCancel = null,
    overwatchDrawMode   = "rectangle",
    onOverwatchBounds   = null,
    onOverwatchPolygon  = null,
    overwatchSentinelOverlay = null,
    // Satellite imagery overlay (Sentinel-2)
    satelliteEnabled = false,
    satelliteOpacity = 0.9,
    // Live CCTV camera feeds (real public webcams + local YOLO detection server)
    // Infrastructure layers
    airportsEnabled = false,
    portsEnabled    = false,
    // Forge alerts/rules on the globe
    eventsMinRelevance = 4,
    precisionEventsEnabled = true,
    autoModeEnabled = false,
    // Basemap preset — "dark" (default) | "satellite" | "terrain". Swaps the
    // one base ImageryLayer + terrainProvider on the existing viewer
    // instance (see the dedicated effect below) — never a teardown/remount.
    basemap = "dark",
    // Data props (optional — GlobeView fetches internally when null)
    aisVessels:   externalAIS  = null,
    adsbAircraft: externalADSB = null,
    // Real annotation drawing tool — "select"|"marker"|"route"|"area"|"measure"
    annotationTool = "select",
}) {
    /* The theme lives on <html data-theme>, not in React state, because a
       synchronous bootstrap applies it before first paint to avoid a flash.
       So to re-pick the basemap when it changes we have to watch the
       attribute. A MutationObserver on that one attribute is cheaper than
       threading a theme prop through every caller of this component. */
    const [themeTick, setThemeTick] = useState(0)
    useEffect(() => {
        const ob = new MutationObserver(() => setThemeTick((n) => n + 1))
        ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
        return () => ob.disconnect()
    }, [])
    const viewerRef = useRef(null)
    const baseLayerRef = useRef(null) // the one ImageryLayer this component manages imperatively for basemap swaps
    const offlineBaseRef = useRef(null) // the Natural Earth floor beneath it, added once
    const tileErrRef = useRef([])
    const offTileErrRef = useRef(null)
    // Cesium OSM Buildings, added only for the 3D basemap.
    const buildingsRef = useRef(null)
    const [vessels,  setVessels]  = useState([])
    const [sanctionedMmsis, setSanctionedMmsis] = useState({ confirmed: new Set(), possible: new Set() })
    const [watchlistedIcaos, setWatchlistedIcaos] = useState(new Set())
    const [aircraft, setAircraft] = useState([])
    const [viewBounds, setViewBounds] = useState(null)
    // How many aircraft the server may return for one viewport. The
    // point is not to draw every aircraft on earth, it is to draw what
    // is in front of you, immediately.
    const ADSB_VIEWPORT_LIMIT = 700
    // The one contact whose full track is drawn. Clicking a vessel or an
    // aircraft is a request to follow it, not just to read its card.
    const [selectedContact, setSelectedContact] = useState(null)

    // THE SELECTED CONTACT IS PINNED IN ITS LAYER. Both live layers cull
    // by viewport and by budget, and locking the camera onto a contact
    // shrinks the viewport around it — so the act of following something
    // could cull the very thing being followed. These ids tell the layers
    // which contact must survive that.
    const pinnedIcao = selectedContact?.kind === "aircraft" && selectedContact?.id
        ? String(selectedContact.id).replace(/^adsb-/i, "") : null
    const pinnedMmsi = selectedContact?.kind === "vessel" && selectedContact?.id
        ? String(selectedContact.id).replace(/^ais-/i, "") : null
    const [webglLost, setWebglLost] = useState(false)
    const [cesiumViewer, setCesiumViewer] = useState(null)

    // Expose the live Cesium.Viewer once Resium has mounted it, for the
    // bottom-left map-chrome overlay (MapMeta) which
    // need a real viewer instance rather than the ref wrapper. UI correction
    // pass, Dashboard bug #3: this was a one-shot check with no retry, unlike
    // every other "wait for viewerRef.current.cesiumElement" spot in this
    // file (see the rendering-quality and viewport-bounds effects below,
    // both of which retry on a timer) — confirmed live that Resium's actual
    // Cesium.Viewer isn't always ready on the very first post-mount tick, so
    // the one-shot version could leave cesiumViewer null forever and
    // silently drop MapMeta. Now retries the same way.
    useEffect(() => {
        let attempts = 0
        let cancelled = false
        const tryExpose = () => {
            if (cancelled) return
            const v = viewerRef.current?.cesiumElement || null
            if (v) {
                setCesiumViewer(v)
                // Dev-only handle. Verifying that a layer RENDERS means
                // clicking a specific contact, and without the viewer a
                // test can only stab blindly at the canvas and miss.
                if (import.meta.env.DEV) window.__viewer = v
                // NOT dev-only: screen capture needs Cesium's own buffer,
                // because a DOM rasteriser reads a WebGL canvas as black.
                // See capture/ScreenCapture.jsx.
                window.__parallaxViewer = v
                return
            }
            if (attempts++ < 20) setTimeout(tryExpose, 250)
        }
        tryExpose()
        return () => { cancelled = true }
    }, [])

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

    // Fidelity pass, build spec v2 §7 — real sanctioned-vessel status for
    // GlobeAISLayer's marker color, reusing the REAL existing screening
    // output rather than reimplementing it: backend/main.py's
    // _check_sanctions_on_update() writes a real alert (alert_type
    // "Sanctioned Vessel"/"Sanctioned Vessel (Possible)", a real `mmsi`
    // field) per hit — it does not set a field on the vessel/position
    // record itself, so this is the one real place to read that status
    // from. Only fetched while AIS rendering is actually on.
    useEffect(() => {
        if (!aisEnabled) return
        const load = () =>
            fetch(`${API}/api/forge/alerts?domain=AIS`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    const items = Array.isArray(d) ? d : (d?.alerts || d?.items || [])
                    const confirmed = new Set()
                    const possible = new Set()
                    for (const a of items) {
                        const mmsi = a?.mmsi != null ? String(a.mmsi) : null
                        if (!mmsi) continue
                        const type = String(a.alert_type || a.rule_name || "").toLowerCase()
                        if (!type.includes("sanction")) continue
                        if (type.includes("possible")) possible.add(mmsi)
                        else confirmed.add(mmsi)
                    }
                    setSanctionedMmsis({ confirmed, possible })
                })
                .catch(() => {})
        load()
        const t = setInterval(load, 60_000)
        return () => clearInterval(t)
    }, [aisEnabled])

    // ADSB — use external prop if provided, otherwise fetch internally
    useEffect(() => {
        if (!adsbEnabled) return
        if (externalADSB !== null) { setAircraft(externalADSB); return }
        // WHAT IS IN VIEW, THINNED, the way a flight tracker does it.
        //
        // Two earlier versions were each wrong in one direction. A
        // 2,000nm disc around the map centre meant the sky was busy over
        // Europe and empty everywhere else however far you travelled.
        // Asking for the whole world fixed the coverage and made the
        // globe slow, because ten thousand aircraft were shipped and
        // drawn so that a few hundred could be looked at.
        //
        // The backend now filters its in-memory worldwide cache to the
        // viewport and thins it to a bounded number, spread across the
        // view rather than clustered. No upstream call is involved, so
        // panning is answered from memory.
        const bbox = viewBounds
            ? `&west=${viewBounds.west.toFixed(3)}&south=${viewBounds.south.toFixed(3)}`
              + `&east=${viewBounds.east.toFixed(3)}&north=${viewBounds.north.toFixed(3)}`
            : ""
        const load = () =>
            fetch(`${API}/adsb?limit=${ADSB_VIEWPORT_LIMIT}${bbox}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setAircraft(d.aircraft || d.states || []) })
                .catch(() => {})
        // Debounced, so a drag across the map is one request at the end
        // of it rather than one per frame of the pan.
        const first = setTimeout(load, viewBounds ? 350 : 0)
        const t = setInterval(load, 10_000)
        return () => { clearTimeout(first); clearInterval(t) }
    }, [adsbEnabled, externalADSB, viewBounds]) // eslint-disable-line react-hooks/exhaustive-deps

    // Fidelity pass, build spec v2 §7 — real "watchlisted" aircraft status,
    // reusing the real existing Military Aircraft alert rule (rule_004)
    // rather than inventing a separate watchlist join.
    useEffect(() => {
        if (!adsbEnabled) return
        const load = () =>
            fetch(`${API}/api/forge/alerts?domain=ADSB`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    const items = Array.isArray(d) ? d : (d?.alerts || d?.items || [])
                    const icaos = new Set()
                    for (const a of items) {
                        const type = String(a.alert_type || a.rule_name || "").toLowerCase()
                        const icao = a.icao != null ? String(a.icao).toUpperCase() : null
                        if (icao && type.includes("military aircraft")) icaos.add(icao)
                    }
                    setWatchlistedIcaos(icaos)
                })
                .catch(() => {})
        load()
        const t = setInterval(load, 60_000)
        return () => clearInterval(t)
    }, [adsbEnabled])

    // akili:fly-to — triggered by GlobalSearch and other search components.
    //
    // Real bug found and fixed while wiring V3 Phase 1 §5.1 (session camera
    // capture/restore): this viewer runs Cesium's on-demand render mode
    // (viewer.scene.requestRenderMode, set true elsewhere in this file, with
    // an existing forced-continuous-rendering workaround for basemap swaps
    // just above). flyTo()'s animation is tick-driven — with no render loop
    // actually advancing frames, the flight never progresses: its own
    // `complete` callback never fires, camera.moveEnd never fires, and the
    // camera visually never moves at all. Confirmed live via a temporary
    // diagnostic log (removed) — the handler ran, flyTo() was called, but
    // `complete` never logged even 3s after a 1.5s-duration flight. This
    // predates this round's session work (akili:fly-to is used elsewhere,
    // e.g. GlobalSearch) — it just had nothing forcing a moveEnd-dependent
    // read of the result before now. Same real fix as the basemap-swap case:
    // force continuous rendering for the flight's duration, then restore
    // on-demand mode.
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon, altitude = 100_000 } = e.detail || {}
            const viewer = viewerRef.current?.cesiumElement
            // Real guard: this handler fires off a global window event and
            // could in principle run in the same tick a prior render error
            // has already torn the widget down (GlobeErrorBoundary unmounts
            // the whole Viewer subtree on any child render error) — Cesium's
            // own `scene` getter throws "this._cesiumWidget.scene" on an
            // already-destroyed viewer, so this must be checked before ANY
            // `.scene` access, not just in the later restore() callback.
            if (!viewer || viewer.isDestroyed() || lat == null || lon == null) return
            const wasRequestRenderMode = viewer.scene.requestRenderMode
            viewer.scene.requestRenderMode = false
            const restore = () => { if (!viewer.isDestroyed()) viewer.scene.requestRenderMode = wasRequestRenderMode }
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, altitude),
                duration: 1.5,
                complete: restore,
                cancel: restore,
            })
        }
        window.addEventListener("akili:fly-to", handler)
        return () => window.removeEventListener("akili:fly-to", handler)
    }, [])

    // akili:set-camera — V3 Phase 1, §5.1 real session restore. Instant
    // (setView, not flyTo): switching sessions resumes a desk, it doesn't
    // tour the globe to it. Real position + orientation, not just a
    // destination point. Cesium camera angles are always radians, never
    // degrees — the pitch default below is -Math.PI/2 (straight down), not
    // the literal -90 that would be nonsensical as radians.
    useEffect(() => {
        const handler = (e) => {
            const { lon, lat, height, heading = 0, pitch = -Math.PI / 2, roll = 0 } = e.detail || {}
            const viewer = viewerRef.current?.cesiumElement
            // Real guard — see the akili:fly-to handler above for why.
            if (!viewer || viewer.isDestroyed() || lon == null || lat == null || height == null) return
            viewer.camera.setView({
                destination: Cartesian3.fromDegrees(lon, lat, height),
                orientation: { heading, pitch, roll },
            })
            // setView is synchronous, but this viewer runs on-demand
            // rendering (requestRenderMode) — request a frame explicitly so
            // the change actually paints immediately rather than waiting for
            // some unrelated later trigger.
            viewer.scene.requestRender()
        }
        window.addEventListener("akili:set-camera", handler)
        return () => window.removeEventListener("akili:set-camera", handler)
    }, [])

    // Real map control stack (full UI rebuild spec section 4) — zoom in/out
    // and locate. Same dispatched-event integration pattern as akili:fly-to
    // above, since MapControlStack lives outside GlobeView (it's a sibling in
    // the map-tab's flex layout, not a child), so it can't reach viewerRef
    // directly.
    useEffect(() => {
        const zoomIn = () => viewerRef.current?.cesiumElement?.camera.zoomIn(viewerRef.current.cesiumElement.camera.positionCartographic.height * 0.4)
        const zoomOut = () => viewerRef.current?.cesiumElement?.camera.zoomOut(viewerRef.current.cesiumElement.camera.positionCartographic.height * 0.6)
        window.addEventListener("akili:zoom-in", zoomIn)
        window.addEventListener("akili:zoom-out", zoomOut)
        return () => {
            window.removeEventListener("akili:zoom-in", zoomIn)
            window.removeEventListener("akili:zoom-out", zoomOut)
        }
    }, [])

    // ── Map readout: cursor position and the MEASURED scale bar (§8) ──────
    // The scale bar is measured, not derived from a zoom level: it picks two
    // screen points 120px apart either side of centre, inverts both onto the
    // ellipsoid, and asks for the real geodesic distance between them. That
    // is the only way the bar stays honest on a globe, where a pixel is
    // worth different distances at the equator and near the poles, and where
    // an oblique camera makes the top of the screen further away than the
    // bottom.
    //
    // Per the spec's Cesium translation table: pickEllipsoid replaces
    // invertScreen and returns undefined off-globe, so both picks are
    // null-checked before use; EllipsoidGeodesic.surfaceDistance replaces
    // geoDistance and is already in metres, so there is no radius multiply.
    useEffect(() => {
        let handler = null
        let raf = 0
        let cleanup = null

        const attach = () => {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer || viewer.isDestroyed?.()) {
                raf = requestAnimationFrame(attach)
                return
            }

            const measure = () => {
                if (viewer.isDestroyed?.()) return
                const canvas = viewer.scene?.canvas
                if (!canvas) return
                // 0x0 is the normal resting state of an inactive tab: every
                // view root in this shell stays mounted and collapses when it
                // is not the active tab, so the Cesium canvas really is
                // zero-sized then and a pick would be meaningless.
                const w = canvas.clientWidth
                const h = canvas.clientHeight
                if (!w || !h) return

                const carto = viewer.camera.positionCartographic
                /* WHERE THE CAMERA IS, published for anything that needs to
                   capture it. The theater editor's "use the current map
                   view" is the caller: the only way anybody knows the
                   latitude that frames the Bab el-Mandeb is to fly there
                   and take the number. Written on the camera-change handler
                   that already runs, so it costs nothing extra. */
                window.__akiliCamera = {
                    lat: CesiumMath.toDegrees(carto.latitude),
                    lon: CesiumMath.toDegrees(carto.longitude),
                    height: carto.height,
                }
                const span = 120
                const a = viewer.camera.pickEllipsoid(new Cartesian2(w / 2 - span / 2, h / 2))
                const b = viewer.camera.pickEllipsoid(new Cartesian2(w / 2 + span / 2, h / 2))
                if (!a || !b) {
                    // Off-globe (looking past the limb). The zoom readout is
                    // still true — it is camera height, not a projection —
                    // so publish that and drop only the bar.
                    publishScale({ px: 0, label: "—", zoomLabel: zoomLabelFor(carto.height) })
                    return
                }
                const ca = Cartographic.fromCartesian(a)
                const cb = Cartographic.fromCartesian(b)
                const metres = new EllipsoidGeodesic(ca, cb).surfaceDistance
                const s = scaleFor(metres / span)
                publishScale({
                    px: s ? s.px : 0,
                    label: s ? s.label : "—",
                    zoomLabel: zoomLabelFor(carto.height),
                })
            }

            // Cursor. Throttled to one frame: a mousemove listener that sets
            // React state on every pointer event repaints the whole readout
            // hundreds of times a second for a four-decimal number nobody can
            // read that fast.
            let pending = null
            let tick = 0
            const flush = () => {
                tick = 0
                if (!pending || viewer.isDestroyed?.()) return
                const picked = viewer.camera.pickEllipsoid(pending)
                if (!picked) { publishCursor(null); return }
                const c = Cartographic.fromCartesian(picked)
                publishCursor({
                    lat: CesiumMath.toDegrees(c.latitude),
                    lon: CesiumMath.toDegrees(c.longitude),
                })
            }

            handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
            handler.setInputAction((movement) => {
                pending = movement.endPosition
                if (!tick) tick = requestAnimationFrame(flush)
            }, ScreenSpaceEventType.MOUSE_MOVE)

            // Keeping the readout current cannot depend on camera.moveEnd
            // here, and this is not a guess — the top of this file already
            // documents it: this viewer runs Cesium's on-demand render mode
            // (scene.requestRenderMode = true, set further down), and with no
            // render loop advancing frames, moveEnd does not reliably fire.
            // The existing akili:fly-to handler works around exactly this by
            // forcing continuous rendering for the duration of a flight.
            //
            // Measuring is far too cheap to need that treatment: two
            // pickEllipsoid calls and one geodesic, at 1Hz. So this polls on a
            // plain interval and additionally listens to moveEnd for the cases
            // where it does fire (a real drag, which renders). Earlier attempts
            // that relied on moveEnd alone, on scene.postRender (stops firing
            // once the scene settles), or on a bounded start-up poll (expired
            // while the canvas was still 0-sized on a cold load) each left the
            // scale bar reading "—" indefinitely.
            const poll = setInterval(measure, 1000)
            measure()
            viewer.camera.moveEnd.addEventListener(measure)
            const onResize = () => measure()
            window.addEventListener("resize", onResize)

            cleanup = () => {
                window.removeEventListener("resize", onResize)
                if (tick) cancelAnimationFrame(tick)
                clearInterval(poll)
                if (!viewer.isDestroyed?.()) viewer.camera.moveEnd.removeEventListener(measure)
                // Same destroyed-viewer guard the camera listener above uses:
                // this cleanup can run after an unrelated render error has
                // already torn the Viewer subtree down.
                if (handler && !handler.isDestroyed?.()) handler.destroy()
                handler = null
            }
        }

        attach()
        return () => {
            if (raf) cancelAnimationFrame(raf)
            cleanup?.()
        }
    }, [])

    // akili:search-marker — temporary blue dot + label after a search fly-to
    useEffect(() => {
        const handler = (e) => {
            const { lat, lon, name, osm_type, category } = e.detail || {}
            const viewer = viewerRef.current?.cesiumElement
            // Real guard — see the akili:fly-to handler above for why.
            if (!viewer || viewer.isDestroyed() || lat == null || lon == null) return

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
                    disableDepthTestDistance: MARKER_DEPTH_TEST_M,
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
                    disableDepthTestDistance: MARKER_DEPTH_TEST_M,
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
                // Real guard — this fires 4s after the handler ran, long
                // enough for the viewer to have since been destroyed by an
                // unrelated crash elsewhere in the tree.
                if (viewer.isDestroyed()) return
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
            // Real guard — a queued retry (setTimeout(tryApply, 250)) can
            // fire after this effect's own cleanup already removed the DOM
            // listeners but before viewerRef.current is cleared, if a prior
            // render error tore the widget down first (GlobeErrorBoundary
            // unmounts the whole Viewer subtree on any child render error);
            // touching `.scene` on it throws "this._cesiumWidget.scene".
            if (!viewer || viewer.isDestroyed?.()) {
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

    // Basemap preset — swaps only the one base ImageryLayer this component
    // owns (tracked in baseLayerRef) and the terrainProvider, on the SAME
    // existing viewer instance. Never viewer.imageryLayers.removeAll() —
    // that would also wipe the resium-managed overlay ImageryLayers below
    // (sentinel/openSeaMap/openInfra/esriLabels), which have no way to know
    // their underlying Cesium layer vanished out from under them.
    useEffect(() => {
        let attempts = 0
        let cancelled = false
        let restoreId = null
        const tryApply = () => {
            if (cancelled) return
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer || viewer.isDestroyed?.()) {
                if (attempts++ < 15) setTimeout(tryApply, 250)
                return
            }
            if (baseLayerRef.current && viewer.imageryLayers.contains(baseLayerRef.current)) {
                viewer.imageryLayers.remove(baseLayerRef.current, true)
            }

            // THE FLOOR GOES IN FIRST, AND STAYS. Natural Earth II from
            // Cesium's own bundled assets sits at index 0 for the life of
            // the viewer; the real basemap is added above it. Online you
            // never see it. Offline — or on a slow link, or when Esri is
            // having a day — the layer above simply has no tiles and this
            // shows through, so the globe is a coarse world map instead of
            // a blank sphere. Added once, and never removed by a basemap
            // swap, which is why it is not tracked in baseLayerRef.
            /* "dark" is the PLAIN CARTOGRAPHIC basemap, and plain
               follows the theme. It is not a colour the user picked —
               Satellite and Terrain are, and those are left alone. Since
               the map became the canvas behind every mode, a dark base
               under light-theme glass turned the whole app muddy grey. */
            const lightTheme = document.documentElement.dataset.theme === "light"
            const provider = basemap === "dark"
                ? (lightTheme ? esriLightProvider : esriDarkProvider)
                : esriSatelliteProvider
            // APPENDED, NOT INSERTED AT A FIXED INDEX. The offline floor
            // below resolves asynchronously, so "put the real basemap at
            // index 1" raced it: on a cold start the collection was still
            // empty and Cesium threw a DeveloperError for an index out of
            // range. Order is established by lowering the floor once it
            // arrives, which cannot race anything.
            baseLayerRef.current = viewer.imageryLayers.addImageryProvider(provider)

            if (!offlineBaseRef.current) {
                offlineBaseRef.current = true    // claim it before the await
                offlineBasemapProvider()
                    .then((prov) => {
                        const v = viewerRef.current?.cesiumElement
                        if (!v || v.isDestroyed?.()) return
                        const layer = v.imageryLayers.addImageryProvider(prov)
                        v.imageryLayers.lowerToBottom(layer)
                        offlineBaseRef.current = layer
                    })
                    .catch(() => {
                        // A missing floor must not take the globe with it.
                        offlineBaseRef.current = null
                        console.warn("[globe] offline basemap unavailable")
                    })
            } else if (offlineBaseRef.current !== true
                       && viewer.imageryLayers.contains(offlineBaseRef.current)) {
                // A basemap swap appended above it; put it back underneath.
                viewer.imageryLayers.lowerToBottom(offlineBaseRef.current)
            }

            // A BASEMAP THAT FAILS SHOULD SAY SO. Cesium retries a tile
            // a few times, gives up, and reports it nowhere a person can
            // see — so "tiles don't load at high zoom" is impossible to
            // act on, because a dead provider, a lost network, our own
            // tile proxy timing out and simply being below the deepest
            // level the provider publishes all look identical: blank.
            if (offTileErrRef.current) offTileErrRef.current()
            tileErrRef.current = []
            const name = basemap === "dark" ? "dark basemap" : "satellite basemap"
            const maxLevel = basemap === "dark" ? 16 : 19
            offTileErrRef.current = watchProvider(provider, () => {
                tileErrRef.current.push(Date.now())
                const lvl = (() => {
                    try {
                        // Rough zoom level from camera height, only to
                        // tell "too deep" apart from "broken".
                        const h = viewer.camera.positionCartographic?.height
                        return Number.isFinite(h)
                            ? Math.max(0, Math.round(Math.log2(40_075_017 / Math.max(1, h))) + 1)
                            : null
                    } catch { return null }
                })()
                onBasemapHealth?.(health(name, tileErrRef.current,
                                         { level: lvl, maxLevel }))
            })

            // The 3D preset is terrain AND buildings; the other two are a
            // smooth ellipsoid, because draping imagery on real terrain
            // costs tiles nobody asked for when the point is the map.
            const dropBuildings = () => {
                const ts = buildingsRef.current
                buildingsRef.current = null
                if (ts && !viewer.isDestroyed?.() && viewer.scene.primitives.contains(ts)) {
                    viewer.scene.primitives.remove(ts)
                }
            }

            if (basemap === "terrain") {
                CesiumTerrainProvider.fromIonAssetId(1).then(tp => {
                    if (!cancelled) viewer.terrainProvider = tp
                }).catch(() => {})
                // Cesium OSM Buildings — ion asset 96188, global building
                // footprints extruded to their OSM heights. Confirmed
                // reachable with this account's token before wiring it,
                // along with World Terrain (1) and Google Photorealistic
                // 3D Tiles (2275207). Google's would look better and is
                // deliberately not used: it replaces imagery and terrain
                // wholesale, carries its own attribution requirement, and
                // bills against the ion quota.
                if (!buildingsRef.current) {
                    Cesium3DTileset.fromIonAssetId(96188).then((ts) => {
                        if (cancelled || viewer.isDestroyed?.()) return
                        buildingsRef.current = ts
                        viewer.scene.primitives.add(ts)
                        viewer.scene.requestRender?.()
                    }).catch(() => { /* buildings are a garnish, not the map */ })
                }
            } else {
                viewer.terrainProvider = new EllipsoidTerrainProvider()
                dropBuildings()
            }
            // requestRenderMode (set in the effect above) means Cesium only
            // renders on a tracked property change or an explicit
            // requestRender() — and a single requestRender() call only
            // covers the FIRST frame (the one that runs tile *selection* and
            // fires the new requests); the newly-requested tiles still need
            // several more frames to actually arrive and get painted once
            // loaded. Confirmed live: a single requestRender() left the globe
            // frozen fully black even though the new layer/provider was
            // correctly configured — only a manual, repeated render() during
            // the load window actually painted the real tiles. Dropping to
            // continuous rendering for a few seconds after a basemap swap,
            // then restoring on-demand mode, is the real fix rather than
            // guessing at a single magic requestRender() call.
            viewer.scene.requestRenderMode = false
            restoreId = setTimeout(() => {
                if (!cancelled && !viewer.isDestroyed()) viewer.scene.requestRenderMode = true
            }, 3000)
        }
        tryApply()
        return () => {
            cancelled = true
            if (restoreId != null) clearTimeout(restoreId)
            const viewer = viewerRef.current?.cesiumElement
            const ts = buildingsRef.current
            if (ts && viewer && !viewer.isDestroyed?.() && viewer.scene.primitives.contains(ts)) {
                viewer.scene.primitives.remove(ts)
            }
            buildingsRef.current = null
            // Or the listener outlives the provider it was watching and
            // keeps counting errors against a basemap nobody is using.
            if (offTileErrRef.current) {
                offTileErrRef.current()
                offTileErrRef.current = null
            }
        }
    }, [basemap, themeTick])

    // Track camera viewport bounds for event layer scoping
    useEffect(() => {
        // Below this, the view has not meaningfully moved.
        const BOUNDS_EPSILON_DEG = 0.01
        let cleanup = null
        let attempts = 0
        const tryAttach = () => {
            const viewer = viewerRef.current?.cesiumElement
            // Real guard — see the akili:fly-to handler above for why.
            if (!viewer || viewer.isDestroyed?.()) {
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
                    setViewBounds((prev) => (prev === null ? prev : null))
                } else {
                    // ONLY WHEN IT ACTUALLY MOVED. A fresh object every
                    // call is a new reference, and layers keyed on
                    // viewBounds re-run their effects on each one — the
                    // aircraft fetch debounces on that effect, so a
                    // constantly-changing reference resets the debounce
                    // forever and the request never fires at all.
                    setViewBounds((prev) => {
                        if (prev
                            && Math.abs(prev.south - s) < BOUNDS_EPSILON_DEG
                            && Math.abs(prev.north - n) < BOUNDS_EPSILON_DEG
                            && Math.abs(prev.west  - w) < BOUNDS_EPSILON_DEG
                            && Math.abs(prev.east  - e) < BOUNDS_EPSILON_DEG) return prev
                        return { south: s, north: n, west: w, east: e }
                    })
                }
                // V3 Phase 1, §5.1 — real Cesium camera position + orientation,
                // published on every real move so a session-save action can
                // read the current desk's actual camera state.
                const carto = viewer.camera.positionCartographic
                publishCameraState({
                    lon: CesiumMath.toDegrees(carto.longitude),
                    lat: CesiumMath.toDegrees(carto.latitude),
                    height: carto.height,
                    heading: viewer.camera.heading,
                    pitch: viewer.camera.pitch,
                    roll: viewer.camera.roll,
                })
            }
            update()
            viewer.camera.moveEnd.addEventListener(update)
            // POLLED AS WELL AS EVENT-DRIVEN. moveEnd does not fire for a
            // programmatic setView, so a camera placed by code — a deep
            // link, "fly to this contact", a saved view — left the
            // viewport bounds describing wherever the camera used to be,
            // and the aircraft layer kept requesting that old box.
            // Cheap because the comparison above means most polls change
            // no state at all.
            const poll = setInterval(update, 500)
            // Real guard in the cleanup itself, not just at attach time —
            // this effect's cleanup can run well after tryAttach(), once the
            // viewer has since been destroyed by an unrelated render error
            // elsewhere in the tree (GlobeErrorBoundary unmounts the whole
            // Viewer subtree on any child render error); `.camera` on an
            // already-destroyed viewer throws the same class of error as
            // the `.scene` getter does.
            cleanup = () => {
                clearInterval(poll)
                if (!viewer.isDestroyed?.()) viewer.camera.moveEnd.removeEventListener(update)
            }
        }
        tryAttach()
        return () => { cleanup?.() }
    }, [])

    const aisAll  = externalAIS  !== null ? externalAIS  : vessels
    const adsbAll = externalADSB !== null ? externalADSB : aircraft
    const sanctionedSet = useMemo(() => new Set([...(sanctionedMmsis.confirmed || []), ...(sanctionedMmsis.possible || [])].map(String)), [sanctionedMmsis])
    const watchSet = useMemo(() => new Set([...(watchlistedIcaos || [])].map((x) => String(x).toLowerCase())), [watchlistedIcaos])
    const aisData  = useMemo(() => (vesselFilter ? filterVessels(aisAll, vesselFilter, sanctionedSet) : aisAll), [aisAll, vesselFilter, sanctionedSet])
    const adsbData = useMemo(() => (aircraftFilter ? filterAircraft(adsbAll, aircraftFilter, watchSet) : adsbAll), [adsbAll, aircraftFilter, watchSet])
    useEffect(() => {
        if (!onTrackFacets) return
        onTrackFacets({
            vessels: { total: aisAll?.length || 0, shown: aisData.length, flags: facet(aisAll, vesselFlag), types: facet(aisAll, vesselType),
                       sanctioned: (aisAll || []).filter((v) => sanctionedSet.has(String(v.mmsi))).length },
            aircraft: { total: adsbAll?.length || 0, shown: adsbData.length, airlines: facet(adsbAll, (a) => a.airline),
                        countries: facet(adsbAll, aircraftCountry), kinds: facet(adsbAll, aircraftKind) },
        })
    }, [aisAll, adsbAll, aisData.length, adsbData.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div data-basemap={basemap} style={{ position: "absolute", inset: 0 }}>
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
                /* Cesium hardcodes these to white, which was invisible on
                   the light basemap — the one real contrast failure a
                   sweep of every text node on this screen turned up. Esri's
                   terms require the attribution to stay VISIBLE, so it is
                   recoloured rather than hidden. */
                :root[data-theme="light"] .cesium-viewer .cesium-credit-textContainer,
                :root[data-theme="light"] .cesium-viewer .cesium-credit-textContainer *,
                :root[data-theme="light"] .cesium-viewer .cesium-credit-expand-link {
                    color: var(--txt3) !important;
                }
                /* Suppress the default selection indicator green ring */
                .cesium-selection-wrapper { display: none !important; }
                /* Esri's usage terms require VISIBLE attribution — the
                   minimised/near-invisible credit styling above (real for
                   Cesium's own Ion ToS) does not apply while Esri World
                   Imagery is the active base layer (Satellite/Terrain). */
                [data-basemap="satellite"] .cesium-viewer .cesium-widget-credits,
                [data-basemap="terrain"] .cesium-viewer .cesium-widget-credits {
                    opacity: 0.85 !important;
                    transform: scale(1);
                }
                [data-basemap="satellite"] .cesium-viewer .cesium-credit-textContainer,
                [data-basemap="terrain"] .cesium-viewer .cesium-credit-textContainer {
                    font-size: 10px !important;
                    opacity: 0.85 !important;
                }
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
                baseLayer={false}
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
                {/* Country risk, filled by severity — see riskChoropleth.js */}
                <GlobeRiskChoroplethLayer enabled={riskEnabled} />
                <GlobeEEZLayer            enabled={eezEnabled} />
                <GlobeCablesLayer         enabled={cablesEnabled} />
                <GlobeGraticuleLayer      enabled={graticuleEnabled} />

                {/* ── Point / entity layers ───────────────────────────────────── */}
                <GlobeChokepointsLayer  enabled={chokepointsEnabled} />
                <GlobeGeoConfirmedLayer
                    enabled={geoConfirmedEnabled}
                    {...(signalWindowHours != null ? { maxAgeDays: Math.max(1, Math.ceil(signalWindowHours / 24)) } : {})}
                    theatres={geoConfirmedTheatres}
                    endDate={geoConfirmedEndDate}
                />
                <GlobeConnectorLinesLayer enabled={geoConfirmedEnabled} />
                <GlobeGdeltLayer enabled={gdeltEnabled} types={gdeltTypes} />
                <GlobeTelegramLayer enabled={telegramEnabled} hours={24} />
                <GlobeFrontlinesLayer enabled={frontlinesEnabled} at={frontlinesAt} />
                <GlobeFacilitiesLayer types={facilityTypes} viewBounds={viewBounds}
                                      onStatus={onFacilityStatus} />
                {warmapTheatres.map((t) => (
                    <GlobeWarMapLayer key={t.key ?? t} theatre={t.key ?? t}
                                      revid={t.revid ?? null} enabled />
                ))}
                <GlobeFiresLayer enabled={firesEnabled} />
                {/* §A8 — surge and fusion, evaluated at the same playhead the
                    archive pins use (§A7). */}
                <GlobeCoverageLayer enabled={coverageEnabled} />
                <GlobeDerivedAlertsLayer
                    enabled={derivedAlertsEnabled}
                    at={geoConfirmedEndDate}
                    theatres={geoConfirmedTheatres}
                />
                {cityLabelsEnabled && (
                    <ImageryLayer imageryProvider={esriLabelsProvider} alpha={1.0} maximumTerrainLevel={19} />
                )}

                {/* ── Heatmap overlays (rectangle entities, clamped to ground) ─ */}
                <GlobeHeatmapLayer enabled={aisHeatmapEnabled}  domain="ais"  hours={heatmapHours} bounds={viewBounds} />
                <GlobeHeatmapLayer enabled={adsbHeatmapEnabled} domain="adsb" hours={heatmapHours} bounds={viewBounds} />
                {/* Not viewport-bounded on purpose: interference is a
                    continental-scale fact and the cells are cheap, so the
                    reader can see the Baltic lit up while looking at the
                    Mediterranean rather than discovering it by panning. */}
                <GlobeGpsInterferenceLayer enabled={gpsInterferenceEnabled} />

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}   viewBounds={viewBounds} sanctionedMmsis={sanctionedMmsis} pinnedMmsi={pinnedMmsi} />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} viewBounds={viewBounds} watchlistedIcaos={watchlistedIcaos} pinnedIcao={pinnedIcao} />}
                <GlobeTrackLayer aisEnabled={aisEnabled} adsbEnabled={adsbEnabled}
                                 vessels={vessels} aircraft={aircraft} />
                {/* The clicked contact's whole recent path — aircraft at
                    their real altitude, which is where the shape of a
                    hold or a descent actually lives. */}
                <GlobeSelectedTrackLayer selected={selectedContact} />
                {/* Double-click an aircraft or vessel to lock on and orbit it. */}
                <GlobeFollowLayer />
                {/* Satellite-AIS events — drawn hollow, because they are
                    records of something days old, not live contacts. */}
                <GlobeGfwLayer enabled={gfwKinds.length > 0} kinds={gfwKinds} />
                {/* Worldwide rather than viewport-bounded: GFW publishes days
                    behind real time and the value of the layer is the global
                    pattern. See gfw.density(). */}
                <GlobeHeatmapLayer enabled={gfwHeatmapEnabled} source="gfw"
                                   gfwKind="encounters" days={30} />
                {/* Controlled airspace as real volumes — floor to ceiling. */}
                <GlobeAirspaceLayer enabled={airspaceEnabled} viewBounds={viewBounds}
                                    onStatus={onAirspaceStatus} />
                {/* The "Trade & energy flows" toggle has existed in the
                    Layers rail this whole time, wired to state that was
                    never passed to the globe. */}
                <GlobeFlowsLayer enabled={flowsEnabled} onStatus={onFlowsStatus} />

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

                {/* ── Live CCTV camera feeds ───────────────────────────────────── */}

                {/* ── Passive auto mode ────────────────────────────────────────── */}
                <GlobeAutoMode enabled={autoModeEnabled} isMobile={isMobile} />

                <CameraFlyTo
                    destination={initialDestination}
                    duration={0}
                    once={true}
                />
            </Viewer>

            {/* Custom popup overlay — replaces Cesium's built-in infoBox */}
            <GlobePopup viewerRef={viewerRef} infraEnabled={infraEnabled} isVisible={isVisible} onInspectorOpenChange={onInspectorOpenChange}
                dockExternally={dockExternally} onInspectorPopupChange={onInspectorPopupChange}
                onSelectionChange={setSelectedContact} />

            {/* Real annotation drawing (select/marker/route/area/measure) —
                same real viewerRef pattern as GlobePopup above. */}
            <GlobeAnnotationLayer viewerRef={viewerRef} tool={annotationTool} isVisible={isVisible} />

            {/* "Replay on map" flagship animation — see src/services/
                replayOnMap.js. Same real viewerRef pattern as above. */}
            <GlobeReplayLayer viewerRef={viewerRef} isVisible={isVisible} />

            {/* Bottom-left map chrome — real scale reference + live cursor coordinates */}
            {/* SAY THAT THE MAP IS LISTENING. Arming area selection changed
                nothing visible except the pointer, and only after the first
                click — so a click about to define a corner looked exactly
                like a click that pans the globe. */}
            <DrawModeBanner
                active={overwatchDrawActive}
                drawMode={overwatchDrawMode}
                onCancel={onOverwatchDrawCancel}
            />

            {cesiumViewer && (
                <MapMeta
                    data-testid="map-bottom-chrome"
                    style={{
                        left: 12 + mapChromeLeftInset,
                        /* THE TIMELINE FLOATS NOW, so the readout has to
                           clear it. This was a flat 12px off the bottom,
                           which put the coordinates directly underneath
                           the drawer the moment the drawer stopped being
                           an in-flow footer — and being an inline style it
                           beat the stylesheet rule that tried to fix it.
                           max() rather than a var fallback because
                           --strip-h is declared (0px at :root), so a
                           fallback would never apply; 30px is the drawer
                           collapsed to its head. */
                        bottom: `calc(var(--pane-bottom) + ${mapChromeBottomInset}px)`,
                        zIndex: 40, transition: "left 0.15s ease, bottom 0.15s ease",
                    }}
                />
            )}

        </div>
        </GlobeErrorBoundary>
    )
}
