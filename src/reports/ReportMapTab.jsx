import { useState } from "react"
import GlobeView from "../components/GlobeView.jsx"
import LayerRail from "../components/LayerRail.jsx"

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
 * GlobeView + LayerRail (NOT the old flat-SVG TaskMapTab this replaces, and
 * NOT a second/lighter Cesium instance). InspectorPanel is not wired here
 * separately: GlobeView already renders its own internal <GlobePopup> (see
 * GlobeView.jsx's JSX, ~line 463), which opens the real unified inspector on
 * entity click — re-rendering it here would double it up.
 *
 * Every layer key below is mapped to GlobeView's real prop name exactly as
 * src/app.jsx wires it (grepped there directly, not guessed) — e.g.
 * layers.aisVessels -> aisEnabled, layers.oim -> infraEnabled, etc.
 *
 * Props:
 *   center — [lat, lon], passed straight through to GlobeView.
 *   zoom   — passed straight through to GlobeView.
 *   task   — the selected ReportTask (currently used only to key/scope this
 *            view instance; not otherwise required by GlobeView itself).
 */
export default function ReportMapTab({ center, zoom, task }) {
    const [layers, setLayers] = useState(() => defaultReportMapLayers())

    const toggleLayer = (key) => setLayers(prev => ({ ...prev, [key]: !prev[key] }))
    const setLayer = (key, value) => setLayers(prev => ({ ...prev, [key]: value }))

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }} data-task-id={task?.task_id}>
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
            <LayerRail
                active={layers}
                onToggle={toggleLayer}
                onLayerSet={setLayer}
                style={{ position: "absolute", top: 0, maxHeight: "100%" }}
            />
        </div>
    )
}
