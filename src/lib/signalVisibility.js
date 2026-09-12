// signalVisibility.js — the one real shared time-window/severity-floor
// visibility decision, per the Build Specification's §9.5/§4.1 "one real
// visible()-equivalent selector" requirement.
//
// Real bug this fixes: Situation.jsx's own windowRows/visibleRows already
// applied a real ageHours<=windowHours + severityRank<=maxRank filter, but
// that logic lived inline in a useMemo — nothing else read it. The map's
// own "signal" layers (GlobeAlertsLayer, GlobeSurgeLayer,
// GlobeGeoConfirmedLayer) each independently fetch and poll their OWN raw
// data with zero reference to the Time window control or the severity
// floor at all — not a second, drifted copy of the filter, but a complete
// absence of one on the map side. This module is the real, single,
// reusable decision function every one of those places (Situation's own
// rows AND the map layers) now calls, so they can't disagree again.
//
// Two real severity vocabularies exist in this codebase (a pre-existing
// condition, not introduced here): normalized Watch Queue rows carry a
// severity_tier-derived rank (critical/significant/elevated/low, via
// dashboardLogic.js's severityRank()); raw Alert/Surge records carry
// Alert.severity directly (critical/high/medium/low). Both are 4-tier
// 0-3 scales where 0 is most severe, so they compare correctly against
// the same numeric maxRank even though the tier NAMES differ — this
// module's rankForRawSeverity() is the real, explicit conversion for the
// raw vocabulary specifically, kept separate from dashboardLogic.js's
// severityRank() rather than overloading one function for two shapes.

// Real rank (0 = most severe) per raw Alert/Surge `.severity` string.
// "medium" and "moderate" are the same real tier under two spellings used
// in different parts of this backend's own data — mapped explicitly by
// name rather than by array index, so this can't silently misrank a tier
// that comes after them (a real bug this exact table caught in its own
// test: an index-range clamp meant to catch only "medium"/"moderate" was
// also catching "low", ranking it 2 instead of 3).
const RAW_SEVERITY_RANK = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3 }

/** Real rank (0 = most severe) for a raw Alert/Surge `.severity` string
 * ("critical"/"high"/"medium" or "moderate"/"low"). Unrecognized or
 * missing values rank last — never assumed more urgent than a real
 * recognized tier. */
export function rankForRawSeverity(severity) {
    const s = (severity || "").toLowerCase()
    return s in RAW_SEVERITY_RANK ? RAW_SEVERITY_RANK[s] : 3
}

/** Real age in hours since `timestamp` (Date, ISO string, or epoch ms), or
 * null if `timestamp` is missing/unparseable — never assumed in-window. */
export function ageHoursSince(timestamp, nowMs = Date.now()) {
    if (!timestamp) return null
    const t = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime()
    if (Number.isNaN(t)) return null
    return (nowMs - t) / 3600000
}

/**
 * The one real shared decision: is this item visible under the current
 * time-window + severity-floor selector? `ageHours`/`severityRank` are
 * null-safe — a missing real value never counts against visibility (an
 * item with no known timestamp is never assumed stale; one with no known
 * severity is never assumed to fail a floor it can't be checked against).
 */
export function isSignalVisible({ ageHours = null, severityRank = null }, { windowHours = null, maxRank = null } = {}) {
    if (severityRank != null && maxRank != null && severityRank > maxRank) return false
    if (ageHours != null && windowHours != null && ageHours > windowHours) return false
    return true
}
