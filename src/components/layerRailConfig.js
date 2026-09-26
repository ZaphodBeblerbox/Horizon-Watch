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

/**
 * THE OTHER THREE TOGGLE GROUPS, in the one place layer keys live.
 *
 * Situation.jsx held these as inline arrays, so nothing else could render
 * them — which is why the Settings "default view" control could only offer
 * to clear the saved state, never to choose it. Worse, the lists overlap:
 * `cables`, `chokepoints` and `ports` are also LAYER_GROUPS keys, and
 * `vessels`/`aircraft` are the same switches as `aisVessels`/`adsb` under
 * different names. That overlap is real and predates this; naming the
 * groups here at least makes it visible rather than hidden in one file's
 * JSX.
 *
 * `note` marks the ones that are genuinely a second control over the same
 * data, so a settings screen can say so instead of appearing to offer two
 * independent switches.
 */
export const CONTEXT_TOGGLES = [
    { key: "risk",       label: "Country risk index" },
    { key: "graticule",  label: "Graticule 10°" },
    { key: "flows",      label: "Trade & energy flows" },
    { key: "aois",       label: "Areas of interest" },
    { key: "labels",     label: "Marker labels" },
    { key: "frontlines", label: "Frontlines" },
    { key: "coverage",   label: "Coverage" },
]

export const INFRA_TOGGLES = [
    { key: "chokepoints", label: "Chokepoints", note: "also a map layer" },
    { key: "ports",       label: "Ports & terminals", note: "also a map layer" },
    { key: "airfields",   label: "Airports & airfields" },
    { key: "cables",      label: "Submarine cables", note: "also a map layer" },
    { key: "power",       label: "Power grid" },
    { key: "nautical",    label: "Nautical chart" },
    { key: "facMilitary", label: "Military facilities" },
    { key: "facMedical",  label: "Medical facilities" },
    { key: "facSecurity", label: "Security facilities" },
]

export const TRACK_TOGGLES = [
    { key: "vessels",        label: "Vessels" },
    { key: "aircraft",       label: "Aircraft" },
    { key: "sanctionedOnly", label: "Sanctioned/watchlisted only" },
]

/** The four groups a saved launch state covers, in display order. */
export const STARTUP_GROUPS = [
    { id: "groups",  title: "Map layers",     items: LAYER_GROUPS.flatMap((g) => g.layers || [g]) },
    { id: "context", title: "Context",        items: CONTEXT_TOGGLES },
    { id: "infra",   title: "Infrastructure", items: INFRA_TOGGLES },
    { id: "tracks",  title: "Live tracks",    items: TRACK_TOGGLES },
]
