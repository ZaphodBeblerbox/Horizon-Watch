import "../cesiumConfig.js"
import { Component, useRef, useMemo, useState, useEffect } from "react"
import { Viewer, CameraFlyTo, ImageryLayer } from "resium"
import { Cartesian3, Math as CesiumMath, UrlTemplateImageryProvider, Credit, CesiumTerrainProvider, EllipsoidTerrainProvider, Color, Cartesian2, LabelStyle, VerticalOrigin, HeightReference, Cartographic, EllipsoidGeodesic, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium"
import { publishCameraState } from "../globe/cameraState.js"
import { publishCursor, publishScale, getScale, scaleFor, zoomLabelFor } from "../globe/mapReadout.js"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { esriLabelsProvider, esriSatelliteProvider, esriDarkProvider, openSeaMapProvider, openInfraRasterProvider } from "../globe/imageryProviders.js"
import GlobeAISLayer            from "../globe/GlobeAISLayer.jsx"
import GlobeADSBLayer           from "../globe/GlobeADSBLayer.jsx"
import GlobeTrackLayer          from "../globe/GlobeTrackLayer.jsx"
import GlobeRiskChoroplethLayer from "../globe/GlobeRiskChoroplethLayer.jsx"
import GlobeEEZLayer            from "../globe/GlobeEEZLayer.jsx"
import GlobeCablesLayer         from "../globe/GlobeCablesLayer.jsx"
import GlobeGraticuleLayer      from "../globe/GlobeGraticuleLayer.jsx"
import GlobeChokepointsLayer    from "../globe/GlobeChokepointsLayer.jsx"
import GlobeDerivedAlertsLayer  from "../globe/GlobeDerivedAlertsLayer.jsx"
import GlobeCoverageLayer       from "../globe/GlobeCoverageLayer.jsx"
import GlobeGeoConfirmedLayer    from "../globe/GlobeGeoConfirmedLayer.jsx"
import GlobeGdeltLayer           from "../globe/GlobeGdeltLayer.jsx"
import GlobeFrontlinesLayer      from "../globe/GlobeFrontlinesLayer.jsx"
import GlobeWarMapLayer          from "../globe/GlobeWarMapLayer.jsx"
import GlobeFacilitiesLayer      from "../globe/GlobeFacilitiesLayer.jsx"
import GlobeFiresLayer           from "../globe/GlobeFiresLayer.jsx"
import GlobeConnectorLinesLayer  from "../globe/GlobeConnectorLinesLayer.jsx"
import GlobeHeatmapLayer        from "../globe/GlobeHeatmapLayer.jsx"
import GlobeOverwatchLayer      from "../globe/GlobeOverwatchLayer.jsx"
import GlobeOverwatchDrawLayer  from "../globe/GlobeOverwatchDrawLayer.jsx"
import GlobePopup               from "../globe/GlobePopup.jsx"
import GlobeAnnotationLayer     from "../globe/GlobeAnnotationLayer.jsx"
import GlobeReplayLayer         from "../globe/GlobeReplayLayer.jsx"
import GlobeAutoMode            from "../globe/GlobeAutoMode.jsx"
import GlobeAirportLayer        from "../globe/GlobeAirportLayer.jsx"
import GlobePortLayer           from "../globe/GlobePortLayer.jsx"
import GlobeCameraLayer         from "../globe/GlobeCameraLayer.jsx"
import ScaleBar                 from "./ScaleBar.jsx"
import CoordinateReadout        from "./CoordinateReadout.jsx"
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
    gdeltTypes = null,
    frontlinesEnabled = false,
    warmapTheatres = [],
    frontlinesAt = null,
    facilityTypes = [],
    onFacilityStatus = null,
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
    const viewerRef = useRef(null)
    const baseLayerRef = useRef(null) // the one ImageryLayer this component manages imperatively for basemap swaps
    const [vessels,  setVessels]  = useState([])
    const [sanctionedMmsis, setSanctionedMmsis] = useState({ confirmed: new Set(), possible: new Set() })
    const [watchlistedIcaos, setWatchlistedIcaos] = useState(new Set())
    const [aircraft, setAircraft] = useState([])
    const [viewBounds, setViewBounds] = useState(null)
    const [webglLost, setWebglLost] = useState(false)
    const [cesiumViewer, setCesiumViewer] = useState(null)

    // Expose the live Cesium.Viewer once Resium has mounted it, for the
    // bottom-left map-chrome overlays (ScaleBar/CoordinateReadout) which
    // need a real viewer instance rather than the ref wrapper. UI correction
    // pass, Dashboard bug #3: this was a one-shot check with no retry, unlike
    // every other "wait for viewerRef.current.cesiumElement" spot in this
    // file (see the rendering-quality and viewport-bounds effects below,
    // both of which retry on a timer) — confirmed live that Resium's actual
    // Cesium.Viewer isn't always ready on the very first post-mount tick, so
    // the one-shot version could leave cesiumViewer null forever and
    // silently drop ScaleBar/CoordinateReadout. Now retries the same way.
    useEffect(() => {
        let attempts = 0
        let cancelled = false
        const tryExpose = () => {
            if (cancelled) return
            const v = viewerRef.current?.cesiumElement || null
            if (v) { setCesiumViewer(v); return }
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
            const provider = basemap === "dark" ? esriDarkProvider : esriSatelliteProvider
            baseLayerRef.current = viewer.imageryLayers.addImageryProvider(provider, 0)

            if (basemap === "terrain") {
                CesiumTerrainProvider.fromIonAssetId(1).then(tp => {
                    if (!cancelled) viewer.terrainProvider = tp
                }).catch(() => {})
            } else {
                viewer.terrainProvider = new EllipsoidTerrainProvider()
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
        return () => { cancelled = true; if (restoreId != null) clearTimeout(restoreId) }
    }, [basemap])

    // Track camera viewport bounds for event layer scoping
    useEffect(() => {
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
                    setViewBounds(null)
                } else {
                    const b = { south: s, north: n, west: w, east: e }
                    setViewBounds(b)
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
            // Real guard in the cleanup itself, not just at attach time —
            // this effect's cleanup can run well after tryAttach(), once the
            // viewer has since been destroyed by an unrelated render error
            // elsewhere in the tree (GlobeErrorBoundary unmounts the whole
            // Viewer subtree on any child render error); `.camera` on an
            // already-destroyed viewer throws the same class of error as
            // the `.scene` getter does.
            cleanup = () => { if (!viewer.isDestroyed?.()) viewer.camera.moveEnd.removeEventListener(update) }
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

                {aisEnabled  && <GlobeAISLayer  vessels={aisData}   viewBounds={viewBounds} sanctionedMmsis={sanctionedMmsis} />}
                {adsbEnabled && <GlobeADSBLayer aircraft={adsbData} viewBounds={viewBounds} watchlistedIcaos={watchlistedIcaos} />}
                <GlobeTrackLayer aisEnabled={aisEnabled} adsbEnabled={adsbEnabled}
                                 vessels={vessels} aircraft={aircraft} />

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
                {cctvEnabled && <GlobeCameraLayer />}

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
                dockExternally={dockExternally} onInspectorPopupChange={onInspectorPopupChange} />

            {/* Real annotation drawing (select/marker/route/area/measure) —
                same real viewerRef pattern as GlobePopup above. */}
            <GlobeAnnotationLayer viewerRef={viewerRef} tool={annotationTool} isVisible={isVisible} />

            {/* "Replay on map" flagship animation — see src/services/
                replayOnMap.js. Same real viewerRef pattern as above. */}
            <GlobeReplayLayer viewerRef={viewerRef} isVisible={isVisible} />

            {/* Bottom-left map chrome — real scale reference + live cursor coordinates */}
            {cesiumViewer && (
                <div data-testid="map-bottom-chrome" style={{ position: "absolute", left: 12 + mapChromeLeftInset, bottom: 12 + mapChromeBottomInset, zIndex: 40, display: "flex", flexDirection: "column", gap: 4, transition: "left 0.15s ease, bottom 0.15s ease" }}>
                    <ScaleBar viewer={cesiumViewer} />
                    <CoordinateReadout viewer={cesiumViewer} />
                </div>
            )}

        </div>
        </GlobeErrorBoundary>
    )
}
