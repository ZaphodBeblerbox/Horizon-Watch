// Pure config + helpers for LayerRail — kept dependency-free so the grouping
// and opacity logic can be unit-tested without mounting the component.
//
// The prompt for this rail asked for exactly 5 domain groups (Maritime, Air,
// News, Imagery, Zones). The real current layer set doesn't cleanly fit that:
// Forge Alerts is a rule-engine output that fires from AIS, ADS-B, *and* News
// domains at once — it isn't "a Maritime layer" or "a News layer", forcing it
// into either would misrepresent what it actually is. It gets its own
// `crossDomain: true` group instead of being wedged into one of the five.

export const LAYER_GROUPS = [
    {
        key: "maritime",
        label: "Maritime",
        layers: [
            { key: "aisVessels", label: "AIS Vessels", hint: "Maritime transponder positions" },
            { key: "ports", label: "Ports", hint: "11k maritime ports — viewport-culled" },
            { key: "cables", label: "Submarine Cables", hint: "Global undersea fibre routes" },
            { key: "chokepoints", label: "Chokepoints", hint: "Strategic maritime passages" },
            { key: "aisHeatmap", label: "AIS Density", hint: "Vessel track density over time" },
        ],
    },
    {
        key: "air",
        label: "Air",
        layers: [
            { key: "adsb", label: "ADS-B Aircraft", hint: "Real-time transponder positions" },
            { key: "airports", label: "Airports", hint: "49k airports — viewport-culled, large first" },
            { key: "adsbHeatmap", label: "ADS-B Density", hint: "Aircraft track density over time" },
        ],
    },
    {
        key: "news",
        label: "News",
        layers: [
            { key: "unifiedEvents", label: "Intelligence Events", hint: "All news & city events", defaultOn: true, hasRelevanceFilter: true },
            { key: "precisionEvents", label: "Precision Intelligence", hint: "Conflict · maritime · aviation · score ≥ 8", defaultOn: true },
            // Its own row, not folded into the others: a GDELT pin is a
            // machine that read a wire story, a GeoConfirmed pin is a human
            // who found the building in the video. The reader has to be able
            // to turn one off without the other.
            { key: "gdeltEvents", label: "GDELT Events", hint: "Machine-coded from news wire · city-level · cites its article" },
        ],
    },
    {
        key: "imagery",
        label: "Imagery",
        layers: [
            { key: "satellite", label: "Sentinel-2 Satellite", hint: "Copernicus true-colour imagery", hasOpacity: true },
            { key: "shippingLanes", label: "Nautical Chart", hint: "OpenSeaMap vector overlay" },
            { key: "oim", label: "Infrastructure", hint: "OpenInfraMap — power, telecoms, pipelines" },
            { key: "cctvFeeds", label: "CCTV Feeds", hint: "2 real public webcams + local detection" },
            // Thermal anomalies belong with the sensors, not with reporting:
            // FIRMS is an instrument reading, and it is what tasks imagery.
            { key: "fires", label: "Thermal Anomalies", hint: "NASA FIRMS VIIRS/MODIS — a flare, stubble and a strike look identical" },
        ],
    },
    {
        key: "zones",
        label: "Zones",
        layers: [
            { key: "eez", label: "Exclusive Economic Zones", hint: "200 nm maritime boundaries" },
            { key: "cityLabels", label: "City Labels", hint: null },
        ],
    },
    {
        key: "alerts",
        label: "Alerts",
        crossDomain: true,
        layers: [
            // "Forge Alerts" used to be the only entry here and drew a marker
            // per row of the alerts table — in practice several thousand
            // sanctioned-vessel dots. It is replaced by the two DERIVED
            // findings, which is the whole point of the addendum: an arrival
            // is a fact and belongs in the tray, a surge and a fusion point
            // are statements that something changed and belong on the map.
            { key: "derivedAlerts", label: "Surge & fusion", hint: "Derived findings — evaluated at the playhead", defaultOn: true },
        ],
    },
]

export function isLayerOn(active, layerDef) {
    const v = active?.[layerDef.key]
    if (v === undefined || v === null) return !!layerDef.defaultOn
    return !!v
}

export function countActive(active, group) {
    return group.layers.filter(l => isLayerOn(active, l)).length
}

export function clampOpacity(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return 0.9
    return Math.min(1, Math.max(0, value))
}
