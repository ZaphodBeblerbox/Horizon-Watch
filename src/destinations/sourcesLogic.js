// Pure, dependency-free helpers for Sources.jsx — kept free of React so
// they're directly unit-testable (see sourcesLogic.test.js).

// The 7 real rule_name values live detection code actually reads — mirrored
// verbatim from backend/main.py's WIRED_RULE_NAMES allowlist (~line 16500).
// POST/PUT /api/rules reject any trigger_type outside this list (or reject
// enabling one), so the create form only ever offers these 7 — never a
// rules.json-style open-ended type, which this product's own prior round
// explicitly retired.
export const RULE_TRIGGER_TYPES = [
    "AIS_LOITERING_NEAR_INFRA",
    "AIS_LOITERING_NEAR_CABLE",
    "AIS_CHOKEPOINT_ACTIVITY",
    "ADSB_LOITERING_NEAR_AIRPORT",
    "ADSB_LOITERING_NEAR_CHOKEPOINT",
    "AIS_DARK_SHIP",
    "NEWS_PATTERN",
]

// Per-trigger-type real param shape + sensible real defaults, sourced from
// backend/seed_rules.py's real seeded examples (AIS_LOITERING_NEAR_INFRA,
// AIS_CHOKEPOINT_ACTIVITY, AIS_DARK_SHIP) and backend/main.py's rule-handler
// docstrings for the ADSB pair (~line 18581, ~18729 — ADSB_LOITERING_NEAR_
// CHOKEPOINT reuses ADSBLoiterDetector.check() with the exact same param
// shape as ADSB_LOITERING_NEAR_AIRPORT) and NEWS_PATTERN (ForgePanel.jsx's
// existing rule-creation form, ~line 3258). `thresholdField`/`targetField`
// are the single most load-bearing numeric/scope param per type — the form
// exposes those directly; everything else in `defaultParams` is included as
// a real, sane default rather than fabricated.
export const TRIGGER_FIELD_SPECS = {
    AIS_LOITERING_NEAR_INFRA: {
        label: "AIS loitering near infrastructure",
        defaultParams: { infra_type: "Port", target: "ALL", proximity_km: 0.5, max_speed_knots: 2.0, min_duration_minutes: 30 },
        thresholdField: { key: "min_duration_minutes", label: "Min. loiter duration", unit: "minutes", default: 30 },
        targetField: { key: "target", label: "Target (AOI / region / \"ALL\")", default: "ALL" },
    },
    AIS_LOITERING_NEAR_CABLE: {
        label: "AIS loitering near submarine cable",
        defaultParams: { infra_type: "Submarine Cable", target: "ALL", proximity_km: 0.5, max_speed_knots: 0.5, min_duration_minutes: 60 },
        thresholdField: { key: "min_duration_minutes", label: "Min. loiter duration", unit: "minutes", default: 60 },
        targetField: { key: "target", label: "Target (AOI / region / \"ALL\")", default: "ALL" },
    },
    AIS_CHOKEPOINT_ACTIVITY: {
        label: "AIS chokepoint loitering/transit",
        defaultParams: { target: "ALL", monitor_transit: false, monitor_loitering: true, min_loiter_duration_minutes: 45, max_loiter_speed_knots: 1.0 },
        thresholdField: { key: "min_loiter_duration_minutes", label: "Min. loiter duration", unit: "minutes", default: 45 },
        targetField: { key: "target", label: "Target (chokepoint ID / \"ALL\")", default: "ALL" },
    },
    ADSB_LOITERING_NEAR_AIRPORT: {
        label: "ADS-B loitering near airport",
        defaultParams: { target: "ALL", airport_types: [], proximity_km: 5, min_duration_minutes: 20, max_speed_knots: 200 },
        thresholdField: { key: "min_duration_minutes", label: "Min. loiter duration", unit: "minutes", default: 20 },
        targetField: { key: "target", label: "Target (region / \"ALL\")", default: "ALL" },
    },
    ADSB_LOITERING_NEAR_CHOKEPOINT: {
        label: "ADS-B loitering near chokepoint",
        defaultParams: { target: "ALL", proximity_km: 5, min_duration_minutes: 20, max_speed_knots: 200 },
        thresholdField: { key: "min_duration_minutes", label: "Min. loiter duration", unit: "minutes", default: 20 },
        targetField: { key: "target", label: "Target (chokepoint ID / \"ALL\")", default: "ALL" },
    },
    AIS_DARK_SHIP: {
        label: "AIS dark-ship (AIS gap) detection",
        defaultParams: { target: "ALL", min_gap_minutes: 60, last_known_region: "ALL", min_speed_before_gap: 3.0 },
        thresholdField: { key: "min_gap_minutes", label: "Min. AIS gap", unit: "minutes", default: 60 },
        targetField: { key: "target", label: "Target (region / \"ALL\")", default: "ALL" },
    },
    NEWS_PATTERN: {
        label: "News pattern (article surge)",
        defaultParams: { pattern_type: "RISING_TENSIONS", article_count_threshold: 4, timeframe_hours: 24, min_relevance_score: 6.0, cooldown_hours: 6 },
        thresholdField: { key: "article_count_threshold", label: "Article count threshold", unit: "articles", default: 4 },
        targetField: { key: "location_scope", label: "Location scope (country code, optional)", default: "" },
    },
}

/**
 * Validate the rule-creation form. Returns {valid, errors} where `errors`
 * is a map of field name -> message, never thrown.
 */
export function validateRuleForm({ name, triggerType, threshold } = {}) {
    const errors = {}
    if (!name || !String(name).trim()) errors.name = "Rule name is required"
    if (!triggerType || !RULE_TRIGGER_TYPES.includes(triggerType)) {
        errors.triggerType = `trigger type must be one of ${RULE_TRIGGER_TYPES.join(", ")}`
    }
    if (threshold !== undefined && threshold !== "" && !Number.isFinite(Number(threshold))) {
        errors.threshold = "Threshold must be a number"
    }
    return { valid: Object.keys(errors).length === 0, errors }
}

/**
 * Build the real POST/PUT /api/rules request body from the form's flat
 * field state. `threshold`/`target` (single scalar UI fields) get written
 * into the correct real params key for the selected trigger type via
 * TRIGGER_FIELD_SPECS; every other real param for that type keeps its
 * spec'd default rather than being dropped.
 *
 * @param {{name, triggerType, severity, target, threshold, iconType, enabled}} form
 * @returns {?object} the request body, or null if triggerType is unrecognized
 */
export function buildRulePayload({ name, triggerType, severity = "medium", target, threshold, iconType, enabled = true } = {}) {
    const spec = TRIGGER_FIELD_SPECS[triggerType]
    if (!spec) return null

    const params = { ...spec.defaultParams }
    if (target !== undefined && target !== "") {
        params[spec.targetField.key] = target
    }
    if (threshold !== undefined && threshold !== "" && Number.isFinite(Number(threshold))) {
        params[spec.thresholdField.key] = Number(threshold)
    }

    return {
        name: (name || "").trim() || triggerType,
        trigger_type: triggerType,
        severity,
        ...(iconType ? { icon_type: iconType } : {}),
        enabled: !!enabled,
        params,
    }
}

/**
 * Convert a drawn rectangle's {north,south,east,west} bounds (real output of
 * the rectangle-draw interaction — see AoiMiniMap.jsx, adapted from
 * src/globe/GlobeOverwatchDrawLayer.jsx's rectangle mode) into the GeoJSON
 * Polygon shape POST /api/watch-zones expects for `polygon_geojson`
 * (backend/main.py's _derive_bbox() reads `.coordinates[0]` as a closed
 * ring of [lon, lat] pairs).
 *
 * @param {{north:number, south:number, east:number, west:number}} bounds
 * @returns {?object} GeoJSON Polygon, or null for invalid bounds
 */
export function boundsToPolygon(bounds) {
    if (!bounds) return null
    const { north, south, east, west } = bounds
    if (![north, south, east, west].every(Number.isFinite)) return null
    return {
        type: "Polygon",
        coordinates: [[
            [west, south], [east, south], [east, north], [west, north], [west, south],
        ]],
    }
}
