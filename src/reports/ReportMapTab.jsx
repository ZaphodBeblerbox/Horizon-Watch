import { useRef, useState } from "react"
import GlobeView from "../components/GlobeView.jsx"
import Icon from "../ui/Icon.jsx"

/**
 * Default layer state for a task's embedded review globe — sensible for
 * intelligence review: the layers most likely to carry the task's own
 * collected signals (AIS vessels, ADS-B aircraft, unified/precision news
 * events, forge alerts) start on; imagery/zone/heatmap overlays start off
 * since they're supplementary context an analyst opts into. Keyed exactly
 * like the real layer keys LayerRail/GlobeView use elsewhere in this app
 * (see src/components/layerRailConfig.js LAYER_GROUPS and src/app.jsx's
 * GlobeView wiring) — not arbitrary/new keys.
 */
export function defaultReportMapLayers() {
    return {
        aisVessels: true,
        adsb: true,
        unifiedEvents: true,
        precisionEvents: true,
        forgeAlerts: true,
        // off by default — supplementary overlays, not core review signals
        ports: false,
        cables: false,
        chokepoints: false,
        aisHeatmap: false,
        airports: false,
        adsbHeatmap: false,
        satellite: false,
        shippingLanes: false,
        oim: false,
        cctvFeeds: false,
        eez: false,
        showStrategicZones: false,
        threatHeatmap: false,
        cityLabels: false,
        eventsMinRelevance: 0,
        satelliteOpacity: 0.9,
    }
}

/**
 * Real embedded 3D globe for a task's region — reuses Round 2's actual
 * GlobeView (NOT the old flat-SVG TaskMapTab this replaces, and NOT a
 * second/lighter Cesium instance). InspectorPanel is not wired here
 * separately: GlobeView already renders its own internal <GlobePopup> (see
 * GlobeView.jsx's JSX, ~line 463), which opens the real unified inspector on
 * entity click — re-rendering it here would double it up.
 *
 * UI correction pass, Part 10.1/10.2: the old always-docked LayerRail has
 * been removed entirely — this minimap illustrates an already-fixed,
 * already-collected snapshot (the ReportTask's Original Data Package), not
 * a live layer-togglable workspace, so a layers control doesn't belong
 * here (per the correction brief, this is NOT replaced with the new
 * LayersFlyout either — the minimap intentionally gets no layers control
 * at all). Removing the rail's ~240px docked width lets GlobeView fill the
 * full container instead of sharing it.
 *
 * Every layer key below is mapped to GlobeView's real prop name exactly as
 * src/app.jsx wires it (grepped there directly, not guessed) — e.g.
 * layers.aisVessels -> aisEnabled, layers.oim -> infraEnabled, etc. The
 * layer *state* (defaultReportMapLayers) is kept even though there's no UI
 * to change it anymore — it still sets which signals this fixed snapshot
 * view renders by default.
 *
 * Props:
 *   center — [lat, lon], passed straight through to GlobeView.
 *   zoom   — passed straight through to GlobeView.
 *   task   — the selected ReportTask (used to key/scope this view instance
 *            and to name the exported screenshot file).
 */
export default function ReportMapTab({ center, zoom, task }) {
    const [layers] = useState(() => defaultReportMapLayers())
    const containerRef = useRef(null)
    const [captureError, setCaptureError] = useState("")

    // Real screenshot export (UI correction pass, Part 10.3): captures the
    // actual live Cesium canvas for THIS ReportMapTab instance — scoped to
    // this component's own container via containerRef.current.querySelector
    // rather than a bare document.querySelector("canvas") (the technique
    // src/app.jsx's home-screen "Export View" button uses), because that
    // home-screen GlobeView instance stays mounted (display:none) even
    // while Reports is active (see GlobeView.jsx's `isVisible` prop docs),
    // so an unscoped query could grab the wrong canvas.
    //
    // No real backend field exists to attach an image to a Report —
    // checked backend/main.py's PATCH /api/reports/{id} (only accepts
    // title/classification/key_judgments/claims) and the Report model in
    // backend/database.py (no images/attachments column at all). Rather
    // than fake "inserted into the report," this triggers a real client-side
    // PNG download of the captured view, mirroring reportApi.js's real
    // downloadReportPdf() pattern (blob/data URL -> temporary <a download>
    // -> click -> remove). An analyst gets a real file they can attach to
    // the report by hand (e.g. via the PDF's own external-asset workflow);
    // this is documented here and in the commit message as a known gap,
    // not silently pretended-persisted.
    const handleExportScreenshot = () => {
        setCaptureError("")
        const canvas = containerRef.current?.querySelector("canvas")
        if (!canvas) { setCaptureError("Map view isn't ready yet."); return }
        try {
            const dataUrl = canvas.toDataURL("image/png")
            const a = document.createElement("a")
            a.href = dataUrl
            a.download = `${task?.task_id || "report-map"}-view-${Date.now()}.png`
            document.body.appendChild(a)
            a.click()
            a.remove()
        } catch (e) {
            setCaptureError(e?.message || "Screenshot capture failed")
        }
    }

    return (
        <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }} data-task-id={task?.task_id}>
            <GlobeView
                center={center}
                zoom={zoom}
                aisEnabled={layers.aisVessels}
                adsbEnabled={layers.adsb}
                eventsEnabled={layers.unifiedEvents}
                precisionEventsEnabled={layers.precisionEvents}
                eventsMinRelevance={layers.eventsMinRelevance}
                alertsEnabled={layers.forgeAlerts}
                portsEnabled={layers.ports}
                cablesEnabled={layers.cables}
                chokepointsEnabled={layers.chokepoints}
                aisHeatmapEnabled={layers.aisHeatmap}
                airportsEnabled={layers.airports}
                adsbHeatmapEnabled={layers.adsbHeatmap}
                satelliteEnabled={layers.satellite}
                satelliteOpacity={layers.satelliteOpacity}
                nauticalEnabled={layers.shippingLanes}
                infraEnabled={layers.oim}
                cctvEnabled={layers.cctvFeeds}
                eezEnabled={layers.eez}
                strategicZonesEnabled={layers.showStrategicZones}
                threatHeatmapEnabled={layers.threatHeatmap}
                cityLabelsEnabled={layers.cityLabels}
            />
            <button
                onClick={handleExportScreenshot}
                title="Capture this map view as a PNG"
                aria-label="Capture this map view as a PNG"
                style={{
                    position: "absolute", top: "var(--space-2)", right: "var(--space-2)", zIndex: 30,
                    width: 32, height: 32, borderRadius: "var(--radius-md)",
                    background: "var(--bg-card-translucent)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "var(--text-secondary)",
                }}
            >
                <Icon name="camera" size={16} />
            </button>
            {captureError && (
                <div style={{
                    position: "absolute", top: "calc(var(--space-2) + 38px)", right: "var(--space-2)", zIndex: 30,
                    background: "var(--bg-card-translucent)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    padding: "4px 8px", color: "var(--danger)", fontSize: "var(--text-xs)", maxWidth: 220,
                }}>
                    {captureError}
                </div>
            )}
        </div>
    )
}
