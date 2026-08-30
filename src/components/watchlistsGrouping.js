// Pure grouping / color-mapping / formatting helpers for the Watchlists
// destination (full UI rebuild spec) — the full-screen 3-column alert
// console that replaces NotificationsDrawer.jsx's slide-in panel. Kept
// dependency-free (no React import) so this is directly unit-testable in
// plain Node, matching the existing pattern in
// src/components/notificationsNormalize.js and src/ui/styleHelpers.js.
//
// Operates on the SAME merged-item shape notificationsNormalize.js already
// produces (see that file): a plain alert/surface-pool item (fields
// id, headline, location, published_at, severity_tier, type, auto_brief,
// relevance_score) or, when item.kind === "fusion", a normalized
// correlation-engine hit (id, kind:"fusion", title, subtitle, narrative,
// severity, confidence, domain_count, domains, location_name,
// location_country, region_id, lat, lon, signal_count, key_signals,
// recommended_actions, threat_indicators, status, expires_at, timestamp,
// published_at, relevance_score, raw).

// ── Domain-derived grouping ─────────────────────────────────────────────
// There is no `RuleConfig`-backed "watchlist" grouping concept wired into
// this merged item shape (verified: neither notificationsNormalize.js's
// output nor backend/main.py's /api/alerts*/​/api/fusions* payloads carry a
// rule_id/watchlist_id on these items, despite RuleConfig existing as a
// separate backend concept — see backend/database.py's RuleConfig model).
// So group by the real domain each item already carries instead of
// inventing a fake watchlist concept.
export const MULTI_DOMAIN_GROUP = "Multi-Domain"
export const UNCATEGORIZED_GROUP = "Uncategorized"

/**
 * Resolve the group name a single merged notification item belongs to.
 * - fusion item: first entry of its real `domains` array, or
 *   MULTI_DOMAIN_GROUP when more than one domain corroborated the hit, or
 *   UNCATEGORIZED_GROUP when the array is empty.
 * - plain alert item: its real `type` field, or UNCATEGORIZED_GROUP when
 *   absent.
 * @param {object} item
 * @returns {string}
 */
export function groupNameForItem(item = {}) {
    if (item.kind === "fusion") {
        const domains = Array.isArray(item.domains) ? item.domains : []
        if (domains.length > 1) return MULTI_DOMAIN_GROUP
        if (domains.length === 1) return domains[0]
        return UNCATEGORIZED_GROUP
    }
    return item.type || UNCATEGORIZED_GROUP
}

/**
 * Group a merged notification item list (see notificationsNormalize.js's
 * mergeNotificationItems) by real domain, per groupNameForItem. Preserves
 * each item's original relative order within its group; does not sort or
 * mutate the input array.
 * @param {object[]} items
 * @returns {Object<string, object[]>}
 */
export function groupItemsByDomain(items = []) {
    const groups = {}
    for (const item of (items || [])) {
        const name = groupNameForItem(item)
        if (!groups[name]) groups[name] = []
        groups[name].push(item)
    }
    return groups
}

// ── Severity -> design-token color mapping ─────────────────────────────
// Two real severity vocabularies exist across the merged item shape's two
// kinds:
//   - alert/surface-pool items' `severity_tier`: critical/significant/
//     elevated/low — the GDELT Goldstein-derived 4-tier scale (see
//     backend/main.py ~L588 and the TIER_COLOR maps duplicated across
//     NotificationsDrawer.jsx/NewsPage.jsx/SurfaceFeed.jsx/
//     NotificationBar.jsx/ToastSystem.jsx).
//   - fusion items' `severity`: critical/high/medium/low (see
//     notificationsNormalize.js and NotificationsDrawer.jsx's SEV_TOKEN/
//     sevToken).
// index.html's legacy --sev-high/--sev-medium aliases collapse both onto
// --warn (documented there as "new palette has no 4th stop"). This mapping
// keeps the real 4-tier distinction instead, resolving straight to the
// literal --danger/--warn/--live tokens the spec names:
//   critical, high       -> --danger  (top tier)
//   significant, medium  -> --warn    ("significant" already renders amber
//                                       in every existing TIER_COLOR map)
//   elevated             -> --warn    (existing precedent, e.g. ToastSystem.jsx)
//   low                  -> --live
// Unrecognized/missing values fall back to --warn — never a false "all
// clear" (--live) or a false "critical" (--danger) for data we don't
// actually understand.
const SEVERITY_TOKEN_MAP = {
    critical: "var(--danger)",
    high: "var(--danger)",
    significant: "var(--warn)",
    medium: "var(--warn)",
    elevated: "var(--warn)",
    low: "var(--live)",
}

/**
 * Resolve the severity-pip color token for a merged notification item.
 * Fusion items use their real `severity`; plain alert items use their real
 * `severity_tier`. Falls back to --warn for unrecognized/missing values.
 * @param {object} item
 * @returns {string} a CSS var() token string, e.g. "var(--danger)"
 */
export function severityColorToken(item = {}) {
    const raw = item.kind === "fusion" ? item.severity : item.severity_tier
    const key = typeof raw === "string" ? raw.toLowerCase() : ""
    return SEVERITY_TOKEN_MAP[key] || "var(--warn)"
}

// Fusion severity -> the alert severity_tier vocabulary, so a fusion item's
// marker can reuse NewsMiniMap.jsx's existing TIER_COLOR map (which is
// keyed on severity_tier's critical/significant/elevated/low, not fusion's
// critical/high/medium/low) without modifying that shared component.
const FUSION_TO_ALERT_TIER = {
    critical: "critical",
    high: "significant",
    medium: "elevated",
    low: "low",
}

/**
 * Map a fusion item's real `severity` value onto the closest
 * severity_tier-vocabulary equivalent, for feeding NewsMiniMap's existing
 * TIER_COLOR map. Falls back to "elevated" (amber, mid-tier) for
 * unrecognized values.
 * @param {string} severity
 * @returns {string}
 */
export function fusionSeverityToAlertTier(severity) {
    const key = typeof severity === "string" ? severity.toLowerCase() : ""
    return FUSION_TO_ALERT_TIER[key] || "elevated"
}

// ── Row display helpers ─────────────────────────────────────────────────

/**
 * The rule/detector name label for a merged notification item's row:
 * a fusion item's real `title`, or a plain alert item's real `type`.
 * @param {object} item
 * @returns {string}
 */
export function itemPrimaryLabel(item = {}) {
    if (item.kind === "fusion") return item.title || ""
    return item.type || ""
}

/**
 * The real entity/domain chip labels for a merged notification item's row:
 * one chip per fusion domain, or a single chip for a plain alert's `type`
 * (when present). Never fabricates a chip for missing data.
 * @param {object} item
 * @returns {string[]}
 */
export function itemChips(item = {}) {
    if (item.kind === "fusion") {
        return Array.isArray(item.domains) ? item.domains : []
    }
    return item.type ? [item.type] : []
}

/**
 * Format a merged item's real timestamp (published_at, falling back to
 * timestamp) for display in JetBrains Mono. Returns "" — never a fabricated
 * placeholder — when no valid timestamp is present.
 * @param {object} item
 * @returns {string}
 */
export function formatItemTimestamp(item = {}) {
    const iso = item.published_at || item.timestamp || null
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    return d.toLocaleString(undefined, {
        month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })
}

/**
 * Sort group-name entries for the left column: highest item count first,
 * ties broken alphabetically for stable, deterministic ordering.
 * @param {Object<string, object[]>} groups
 * @returns {[string, object[]][]}
 */
export function sortedGroupEntries(groups = {}) {
    return Object.entries(groups).sort((a, b) => {
        const byCount = b[1].length - a[1].length
        if (byCount !== 0) return byCount
        return a[0].localeCompare(b[0])
    })
}
