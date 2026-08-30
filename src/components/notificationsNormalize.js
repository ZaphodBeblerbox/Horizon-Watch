// Pure normalizer — turns raw `/api/fusions` FusionEvent rows into the
// NotificationsDrawer's merged-item shape so they can sit in the same
// time/relevance-sorted list as existing alert/surface-pool items.
//
// Real /api/fusions field names (backend/main.py ~line 19541-19609), no
// invented fields on the input side:
//   fusion_id, title, subtitle, narrative, severity, confidence (0-1 float),
//   domain_count, domains (array of domain name strings), location_name,
//   location_country, region_id, lat, lon, signal_count, key_signals,
//   recommended_actions, threat_indicators, created_at, updated_at,
//   expires_at, status
//
// This module does NOT fetch — the integrator calls GET /api/fusions
// themselves, then passes the JSON array through normalizeFusionEvents()
// and merges the result into whatever alert/surface-pool items array they
// already build, before passing the combined array to
// <NotificationsDrawer items={...} />.

/**
 * Coerce a possibly-string/undefined confidence value to a 0-1 float.
 */
function toConfidence(value) {
    const n = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(n)) return 0
    return Math.min(1, Math.max(0, n))
}

/**
 * Normalize one raw FusionEvent row (as returned by GET /api/fusions) into
 * the drawer's internal merged-item shape.
 *
 * @param {object} fusion - raw FusionEvent JSON object
 * @returns {object} merged item — `kind: "fusion"`, plus `published_at` /
 *   `relevance_score` so it sorts correctly alongside existing alert items
 *   without any change to the drawer's existing sort logic.
 */
export function normalizeFusionEvent(fusion = {}) {
    const confidence = toConfidence(fusion.confidence)
    const domains    = Array.isArray(fusion.domains) ? fusion.domains : []
    const timestamp  = fusion.created_at || fusion.updated_at || null

    return {
        id:                   fusion.fusion_id,
        kind:                 "fusion",
        title:                fusion.title || "Intelligence Fusion Event",
        subtitle:             fusion.subtitle || "",
        narrative:            fusion.narrative || "",
        severity:             fusion.severity || "medium",
        confidence,
        domain_count:         typeof fusion.domain_count === "number" ? fusion.domain_count : domains.length,
        domains,
        location_name:        fusion.location_name || "",
        location_country:     fusion.location_country || "",
        region_id:            fusion.region_id ?? null,
        lat:                  fusion.lat ?? null,
        lon:                  fusion.lon ?? null,
        signal_count:         fusion.signal_count ?? 0,
        key_signals:          Array.isArray(fusion.key_signals) ? fusion.key_signals : [],
        recommended_actions:  Array.isArray(fusion.recommended_actions) ? fusion.recommended_actions : [],
        threat_indicators:    Array.isArray(fusion.threat_indicators) ? fusion.threat_indicators : [],
        status:               fusion.status || "active",
        expires_at:           fusion.expires_at || null,

        // Alias fields so the fusion item slots into the drawer's EXISTING
        // sort code (`published_at` for time mode, `relevance_score` for
        // relevance mode) without the drawer needing per-kind sort branches.
        // `timestamp` is kept too as the plain, kind-agnostic name.
        timestamp,
        published_at:         timestamp,
        relevance_score:      confidence * 10, // alert items' relevance_score is on a 0-10 scale

        raw: fusion,
    }
}

/**
 * Normalize a raw `/api/fusions` array response into an array of merged
 * items ready to concat with existing alert/surface-pool items.
 *
 * @param {object[]} fusions - raw array from GET /api/fusions
 * @returns {object[]}
 */
export function normalizeFusionEvents(fusions) {
    if (!Array.isArray(fusions)) return []
    return fusions.map(normalizeFusionEvent)
}

/**
 * Convenience helper for integrators: concatenate existing alert/surface-pool
 * items with normalized fusion items into one array suitable for
 * <NotificationsDrawer items={...} />. The drawer itself does the sorting;
 * this just merges the two arrays. Purely additive — does not mutate either
 * input array.
 *
 * @param {object[]} alertItems - existing alert/surface-pool items (unchanged shape)
 * @param {object[]} rawFusions - raw array from GET /api/fusions
 * @returns {object[]}
 */
export function mergeNotificationItems(alertItems = [], rawFusions = []) {
    return [...(alertItems || []), ...normalizeFusionEvents(rawFusions)]
}
