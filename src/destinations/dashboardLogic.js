// Pure, dependency-free helpers for Dashboard.jsx — kept free of React so
// they're directly unit-testable (see dashboardLogic.test.js), following the
// src/reports/taskDisplay.js / src/globe/markerRenderer.js precedent.
//
// Dashboard's Watch Queue merges two genuinely different real item shapes via
// notificationsNormalize.js's mergeNotificationItems(surfaceItems, fusions):
//   - plain surface-pool / alert items (GET /api/surface -> .items, real
//     fields per backend/main.py's _build_surface_pool(): id, headline,
//     location, severity_tier ("critical"|"significant"|"elevated"|"low"),
//     published_at, context, confidence (0-1 float, from classifier.py))
//   - normalized fusion items (kind:"fusion", real fields per
//     notificationsNormalize.js: title, narrative, subtitle, location_name,
//     severity ("critical"|"high"|"medium"|"low"), published_at/timestamp,
//     confidence (0-1 float))
// buildWatchQueueRow() below reads only fields that are actually real on
// whichever shape a given item is, never inventing a field neither shape has.

// Severity/priority token map — covers every real value seen across surface
// items (severity_tier), fusion items (severity), and WatchZone.priority
// (which already literally uses critical/high/medium/low, no mapping needed).
const SEV_TOKEN = {
    critical:    "var(--danger)",
    significant: "var(--warn)",
    high:        "var(--warn)",
    elevated:    "var(--warn)",
    medium:      "var(--warn)",
    low:         "var(--live)",
}

/**
 * Resolve a severity/priority string (whichever real vocabulary it comes
 * from) to a design-token color, defaulting to the "medium" look for any
 * unrecognized value rather than rendering unstyled.
 */
export function severityColorToken(value) {
    return SEV_TOKEN[value] || "var(--warn)"
}

/**
 * Coerce a possibly-string/undefined 0-1 confidence value to a whole-number
 * percentage. Returns null (not 0) when there's no real confidence value to
 * show, so callers can render an honest "—" instead of a fabricated 0%.
 */
export function confidencePct(confidence) {
    if (confidence === null || confidence === undefined || confidence === "") return null
    const n = typeof confidence === "number" ? confidence : Number(confidence)
    if (!Number.isFinite(n)) return null
    return Math.round(Math.min(1, Math.max(0, n)) * 100)
}

/**
 * "3m ago" / "2h ago" / "5d ago" — same convention as
 * NotificationsDrawer.jsx's timeAgo(), made pure/testable via an injectable
 * `nowMs` instead of reading Date.now() internally.
 */
export function timeAgoLabel(iso, nowMs = Date.now()) {
    if (!iso) return ""
    const diffMs = nowMs - new Date(iso).getTime()
    if (!Number.isFinite(diffMs)) return ""
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    return `${Math.floor(diffH / 24)}d ago`
}

/**
 * Normalize one merged Watch Queue item (either shape — see module docblock)
 * into the row shape the Watch Queue list actually renders. Every field read
 * here is real on at least one of the two input shapes; absent fields render
 * as "" / null rather than a fabricated placeholder.
 *
 * @param {object} item - one entry from mergeNotificationItems()'s output
 * @returns {{id, severityToken:string, title:string, description:string, aoi:string, publishedAt:?string, confidencePct:?number}}
 */
export function buildWatchQueueRow(item = {}) {
    const isFusion = item.kind === "fusion"
    const publishedAt = item.published_at || item.timestamp || null
    return {
        id:            item.id,
        severityToken: severityColorToken(isFusion ? item.severity : item.severity_tier),
        title:         (isFusion ? item.title : item.headline) || "(untitled)",
        description:   (isFusion ? (item.narrative || item.subtitle) : item.context) || "",
        aoi:           (isFusion ? item.location_name : item.location) || "",
        publishedAt,
        confidencePct: confidencePct(item.confidence),
    }
}

/**
 * @param {object[]} items - merged Watch Queue items
 * @returns {object[]} row-shaped items, ready to render
 */
export function buildWatchQueueRows(items) {
    if (!Array.isArray(items)) return []
    return items.map(buildWatchQueueRow)
}

/**
 * Real "watchlist hits in the last N hours" filter — items whose real
 * published_at/timestamp falls within the window ending at `nowMs`. Items
 * with no real timestamp are excluded (never assumed "recent").
 *
 * @param {object[]} items - merged Watch Queue items
 * @param {number} hours - window size, e.g. 4
 * @param {number} [nowMs] - injectable "now" for testability
 * @returns {object[]}
 */
export function filterWithinHours(items, hours, nowMs = Date.now()) {
    if (!Array.isArray(items)) return []
    const windowMs = hours * 3600 * 1000
    return items.filter((item) => {
        const iso = item.published_at || item.timestamp
        if (!iso) return false
        const t = new Date(iso).getTime()
        if (!Number.isFinite(t)) return false
        const age = nowMs - t
        return age >= 0 && age <= windowMs
    })
}

/**
 * Real baseline-comparison trigger for pulsing an AOI box on the overview
 * map. Backed by GET /api/watch-zones/{id}/analytics's genuinely-computed
 * `vessel_activity_trend` field (backend/main.py ~line 17318-17329: compares
 * first-half vs second-half vessel-detection counts over the last 30 days) —
 * not a fabricated client-side threshold. A zone with no analytics yet (e.g.
 * a brand-new zone with no scans) never pulses.
 *
 * @param {?object} analytics - GET /api/watch-zones/{id}/analytics response, or null/undefined
 * @returns {boolean}
 */
export function zoneExceedsBaseline(analytics) {
    return !!analytics && analytics.vessel_activity_trend === "increasing"
}
