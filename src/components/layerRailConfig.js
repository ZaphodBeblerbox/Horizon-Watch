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
            { key: "aisVessels", label: "Vessels", hint: "Maritime transponder positions" },
            { key: "ports", label: "Ports", hint: "11k maritime ports — viewport-culled" },
            { key: "cables", label: "Submarine Cables", hint: "Global undersea fibre routes" },
            { key: "chokepoints", label: "Chokepoints", hint: "Strategic maritime passages" },
            { key: "aisHeatmap", label: "Sea Density", hint: "Vessel track density over time" },
        ],
    },
    {
        key: "air",
        label: "Air",
        layers: [
            { key: "adsb", label: "Aircraft", hint: "Real-time transponder positions" },
            { key: "airports", label: "Airports", hint: "49k airports — viewport-culled, large first" },
            { key: "adsbHeatmap", label: "Air Density", hint: "Aircraft track density over time" },
            // Its own switch rather than folded into Air: this is not
            // where aircraft are, it is where they are losing their
            // satellite fix, and a reader has to be able to see one
            // without the other.
            { key: "gpsInterference", label: "Nav Interference",
              hint: "Where aircraft are losing their satellite fix — measured from their own reported integrity" },
        ],
    },
    {
        key: "news",
        label: "News",
        layers: [
            { key: "unifiedEvents", label: "Intelligence Events", hint: "All news & city events", defaultOn: true, hasRelevanceFilter: true },
            { key: "precisionEvents", label: "Verified Events", hint: "Conflict · maritime · aviation · score ≥ 8", defaultOn: true },
            // Its own row, not folded into the others: a GDELT pin is a
            // machine that read a wire story, a GeoConfirmed pin is a human
            // who found the building in the video. The reader has to be able
            // to turn one off without the other.
            { key: "gdeltEvents", label: "Wire Reports", hint: "Machine-coded from news wire · city-level · cites its article" },
        ],
    },
    {
        key: "imagery",
        label: "Imagery",
        layers: [
            { key: "satellite", label: "Satellite", hint: "true-colour imagery", hasOpacity: true },
            { key: "shippingLanes", label: "Nautical Chart", hint: "nautical vector overlay" },
            { key: "oim", label: "Infrastructure", hint: "power, telecoms and pipelines" },
            // Thermal anomalies belong with the sensors, not with reporting:
            // FIRMS is an instrument reading, and it is what tasks imagery.
            { key: "fires", label: "Thermal Anomalies", hint: "thermal detection — a flare, stubble and a strike look identical" },
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

/**
 * THE SWITCHES INSIDE A GROUP. Situation.jsx keeps each as its own state
 * (firesOn, telegramOn, …), so nothing outside it could name them: a saved
 * default view and a theater both carried the group switches only, and
 * every sub-layer fell back to its built-in value on the next launch or
 * theater change. One list here lets Situation, the theater editor and the
 * Settings editor speak about the same keys.
 *
 * `parent` is the LAYER_GROUPS key the switch lives under (drawn only when
 * that group is on), or null for one that stands on its own.
 * `gfw:<kind>` is one Global Fishing Watch event kind.
 */
export const SUB_LAYERS = [
    { key: "assets",          label: "Our assets",               parent: null },
    { key: "imagerySignals",  label: "Imagery signals",          parent: "imagery" },
    { key: "fires",           label: "Heat (thermal anomalies)", parent: "imagery" },
    { key: "satImage",        label: "Satellite base image",     parent: "imagery" },
    { key: "gpsInterference", label: "Nav interference",         parent: "air" },
    { key: "geoConfirmed",    label: "Confirmed",                parent: "news" },
    { key: "gdelt",           label: "Unconfirmed (wire)",       parent: "news" },
    { key: "telegram",        label: "Telegram",                 parent: "news" },
    { key: "unrest",          label: "Unrest & protests",        parent: "news" },
    { key: "airspace",        label: "Controlled airspace",      parent: null },
    { key: "gfw:encounters",  label: "Vessel encounters",        parent: null },
    { key: "gfw:gaps",        label: "AIS gaps",                 parent: null },
    { key: "gfw:loitering",   label: "Loitering",                parent: null },
    { key: "gfw:port-visits", label: "Port visits",              parent: null },
    { key: "gfwHeat",         label: "Encounter density",        parent: null },
]

/** The sub-layers a group brings with it when it is first chosen. */
export const DEFAULT_SUBS = {
    imagery: ["imagerySignals"],
    news: ["geoConfirmed", "gdelt", "telegram", "unrest"],
    air: [],
}

/**
 * The four groups a saved launch state covers, in display order.
 *
 * "Map layers" lists the GROUPS, not the layers inside them, because a
 * group is what the map actually switches. Situation keeps one flag per
 * group (`groupsOn`), so the editor used to flatten this to the eighteen
 * per-layer keys and offer switches that nothing read — you could set
 * "Sea Density" as a launch default, save it, and the map would ignore it,
 * because no state of that name exists. Offering a control that does
 * nothing is worse than not offering it.
 */
export const STARTUP_GROUPS = [
    { id: "groups",  title: "Map layers",     items: LAYER_GROUPS.map((g) => ({ key: g.key, label: g.label })) },
    { id: "context", title: "Context",        items: CONTEXT_TOGGLES },
    { id: "infra",   title: "Infrastructure", items: INFRA_TOGGLES },
    { id: "tracks",  title: "Live tracks",    items: TRACK_TOGGLES },
    { id: "subs",    title: "Inside the groups", items: SUB_LAYERS },
]

/* The map's chip choices, here so the theater editor can offer them
   without importing the globe. GDELT_EVENT_TYPES is re-exported by
   globe/GlobeGdeltLayer.jsx, which filters by it. */
export const GDELT_EVENT_TYPES = [
    { key: "Fight", label: "Fight / armed clash" },
    { key: "Assault", label: "Assault" },
    { key: "Coerce", label: "Coerce" },
    { key: "Protest", label: "Protest" },
    { key: "Threaten", label: "Threaten" },
    { key: "Reduce relations", label: "Reduce relations" },
]

export const SEVERITY_FLOORS = [
    { key: "critical", label: "Critical+", maxRank: 0 },
    { key: "high",     label: "High+",     maxRank: 1 },
    { key: "moderate", label: "Moderate+", maxRank: 2 },
    { key: "low",      label: "Low+",      maxRank: 3 },
]
export const TIME_WINDOWS = [
    { key: "24h", label: "24h", hours: 24 },
    { key: "48h", label: "48h", hours: 48 },
    { key: "72h", label: "72h", hours: 72 },
    { key: "7d",  label: "7d",  hours: 24 * 7 },
    { key: "30d", label: "30d", hours: 24 * 30 },
]
