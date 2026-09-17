/**
 * reportDeepLink.js — Turn a report claim's citation into real map navigation.
 *
 * Roadmap Phase 3's own design note was that commandRunner.js's Director Mode
 * action handlers would be "reusable as-is for the mechanical map-driving
 * part." That turned out not to hold: CommandRunner's fly_to/show_event/
 * show_vessel/etc. handlers all read a Leaflet map off `this.mapRef.current`
 * (see commandRunner.js's `fly_to` — it calls `map.flyTo([lat, lon], zoom)`,
 * Leaflet's signature), but `mapInstanceRef` in app.jsx is a plain
 * `useRef(null)` that nothing in the app ever assigns — the live map
 * (GlobeView.jsx) is Cesium-based, not Leaflet. CommandRunner's map-driving
 * actions are dead code against today's map; Director Mode's narration/
 * sidebar still work (those don't touch mapRef), but the camera never
 * actually moves and no marker is ever placed by a Director sequence today.
 * Building this feature on top of that would mean a "Locate on Map" button
 * that opens a whole cinematic overlay and describes the claim without the
 * map doing anything — exactly the kind of UI-that-looks-real-but-isn't the
 * project's no-fake-functionality rule exists to catch. So this module does
 * NOT use CommandRunner. It reuses the two mechanisms that are genuinely
 * live today:
 *   - the "akili:fly-to" window event (real; GlobeView.jsx has listened to
 *     it since before this feature — used by TopBar/GlobalSearch)
 *   - each entity layer's own real click-popup state (GlobePopup.jsx's
 *     entityStore-backed popup; the strategic-zone and surge popups that
 *     also answered these have since been removed) — each layer answers a small
 *     new deep-link event that does exactly what a real click on that same
 *     entity would do, added alongside this module.
 *
 * A report claim cites a FROZEN snapshot item (see ReportSnapshot / Phase 1),
 * which may no longer be part of the live picture by the time someone reads
 * a published report — a fusion event expires, a surge subsides, an alert
 * ages out. When that's true, this deliberately still flies the camera to
 * the claim's real cited coordinates (honest — that location is still what
 * the claim is about) but doesn't fabricate a marker or popup that isn't
 * there live. Callers should treat `entityFound: false` as "arrived, but
 * nothing live to show," not as a failure.
 */

// Mirrors backend/report_council.py's _SNAPSHOT_SECTION_ID_FIELDS exactly —
// keep these two in sync if a new citable section is ever added.
const SECTION_ID_FIELDS = {
    ais_anomalies:       "signal_id",
    adsb_anomalies:      "signal_id",
    fusion_events:       "fusion_id",
    surge_events:        "surge_id",
    sentinel_detections: "detection_id",
    news_assessments:    "assessment_id",
    strategic_zones:     "zone_id",
    top_articles:        "url",
}

function findSnapshotItem(section, itemId, snapshotContent) {
    const idField = SECTION_ID_FIELDS[section]
    if (!idField) return null
    const items = (snapshotContent && snapshotContent[section]) || []
    return items.find(it => String(it?.[idField]) === String(itemId)) || null
}

/**
 * Resolve a report claim's citation and act on it: open an external URL for
 * an external/top_articles citation, or navigate the live map to a
 * snapshot_ref citation's real cited location (and its live marker, if one
 * still exists). Returns a small status object rather than throwing, so the
 * caller can show the user exactly what happened.
 */
export async function locateReportClaim(claim, snapshotContent) {
    const citation = claim?.citation || {}

    if (citation.type === "external") {
        if (!citation.url) return { kind: "error", reason: "external citation has no URL" }
        window.open(citation.url, "_blank", "noopener")
        return { kind: "external", opened: true }
    }

    if (citation.type !== "snapshot_ref") {
        return { kind: "error", reason: `unrecognized citation type '${citation.type}'` }
    }

    const item = findSnapshotItem(citation.section, citation.item_id, snapshotContent)
    if (!item) {
        return { kind: "error", reason: `${citation.item_id} not found in snapshot section ${citation.section}` }
    }

    if (citation.section === "top_articles") {
        if (!item.url) return { kind: "error", reason: "article has no URL" }
        window.open(item.url, "_blank", "noopener")
        return { kind: "external", opened: true }
    }

    window.dispatchEvent(new CustomEvent("akili:open-map"))

    // Strategic zones carry no lat/lon in the snapshot (briefing_prep.py never
    // put one there) — the zone layer itself holds the real live polygon, so
    // it owns both the fly-to and the tooltip for this one section.
    if (citation.section === "strategic_zones") {
        window.dispatchEvent(new CustomEvent("akili:show-zone", { detail: { zone_id: item.zone_id } }))
        return { kind: "map", located: true, entityFound: null }
    }

    const lat = item.lat
    const lon = item.lon ?? item.lng
    if (lat == null || lon == null) {
        return { kind: "error", reason: `${citation.item_id} has no coordinates in this snapshot` }
    }
    // Give the map tab a moment to mount (it may not exist yet) before
    // anything tries to act on it.
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 60000 } }))
    }, 50)

    if (citation.section === "surge_events") {
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:show-surge", { detail: { surge_id: item.surge_id } }))
        }, 400)
        return { kind: "map", located: true, entityFound: null }
    }

    // fusion_events, ais_anomalies, adsb_anomalies, news_assessments,
    // sentinel_detections all funnel through the entityStore-backed popup
    // (GlobePopup.jsx) — but only fusion_events' entityStore key is directly
    // derivable from the claim's own id (fusion-${fusion_id}). The others
    // are registered under a Forge alert's own id, unrelated to the domain
    // id the claim cites, so they have to be found by matching that domain
    // id against the live entity's own data (see entityStore.findEntityByField).
    let entityId = null
    if (citation.section === "fusion_events") {
        entityId = `fusion-${item.fusion_id}`
    } else if (citation.section === "ais_anomalies" || citation.section === "adsb_anomalies") {
        const { findEntityByField } = await import("../globe/entityStore.js")
        entityId = findEntityByField("alert", "id", item.signal_id)?.id || null
    } else if (citation.section === "news_assessments") {
        const { findEntityByField } = await import("../globe/entityStore.js")
        entityId = findEntityByField("assessment", "assessment_id", item.assessment_id)?.id || null
    }
    // sentinel_detections: no live map layer renders these today (a
    // pre-existing gap, not something this feature papers over) — fly-to
    // only, honestly.

    if (entityId) {
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { id: entityId } }))
        }, 400)
        return { kind: "map", located: true, entityFound: true }
    }
    return { kind: "map", located: true, entityFound: false }
}
