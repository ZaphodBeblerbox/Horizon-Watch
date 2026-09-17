import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian2, Cartesian3, Color, HeightReference, NearFarScalar, DistanceDisplayCondition } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { getEntityMarkerDataUri, getNewsMarkerDataUri, NEWS_MARKER_SIZE, resolveSanctionsStatus } from "./entityIcons.js"
import { alertEntityTypeAndSubtype } from "../inspector/adapters.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { ALERT_ICONS } from "../constants/alertIcons.js"
import { clusterTracks } from "./trackClustering.js"
import { isSignalVisible, ageHoursSince, rankForRawSeverity } from "../lib/signalVisibility.js"

// Same real per-viewport render cap GlobeAISLayer/GlobeADSBLayer already use.
// Forge's alert feed is a running history (hundreds of sanctioned-vessel
// hits alone), not a live-only snapshot — with no cap, every alert ever
// returned by /api/forge/alerts got its own always-on billboard + text
// label, which is what produced the unreadable stacked-label mess over
// dense shipping lanes. Above the cap, dense grid cells collapse into one
// real count-cluster via the same clusterTracks() utility, instead of
// flooding the globe with overlapping individual labels.
const DESKTOP_ALERTS_CAP = 200
const alertLat = (a) => Number(a.lat)
const alertLon = (a) => Number(a.lng ?? a.lon)

function forgeHeaders() {
    return {
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
    }
}

function alertIcon(a) {
    const iconType = a.icon_type || ""
    // Same real domain-based classification InspectorPanel already uses
    // (src/inspector/adapters.js's alertEntityTypeAndSubtype) — AIS -> vessel
    // glyph, ADS-B -> aircraft glyph with a real military/general sub-type
    // badge, everything else (including NEWS assessments) -> the generic
    // alert glyph. One shared source of truth, not a second copy of the
    // same real logic.
    const { entityType, subtype } = alertEntityTypeAndSubtype(a)
    const sanctionsStatus = resolveSanctionsStatus(a)

    // News assessment — pattern-specific accent colour carried over from
    // ALERT_ICONS (real, still-used table — see src/constants/alertIcons.js).
    // Design update: every news marker (here and in GlobeEventsLayer.jsx) is
    // now the same solid diamond at NEWS_MARKER_SIZE, replacing the generic
    // alert triangle at a severity-scaled size.
    const isAssessment = a.domain === "NEWS" && !!(iconType && ALERT_ICONS[iconType])
    if (isAssessment) {
        const color = ALERT_ICONS[iconType]?.color || "#FF6B35"
        return getNewsMarkerDataUri({ color })
    }

    return getEntityMarkerDataUri({ entityType, subtype, sanctionsStatus, size: 38 })
}

function isSanctioned(a) {
    return (a.alert_type || a.rule_name || "").toLowerCase().includes("sanctioned vessel")
}
function isSts(a) {
    return (a.alert_type || a.rule_name || "").toLowerCase().includes("ship-to-ship")
}

// Visual hierarchy scale based on alert type / severity / relevance
function getMarkerScale(a) {
    if (isSanctioned(a))                                       return 2.0
    if (isSts(a))                                              return 1.6
    const sev = (a.severity || "").toLowerCase()
    const rel = a.relevance_score ?? 0
    if (sev === "critical" || rel >= 80)                       return 1.6
    if (sev === "high"     || rel >= 50)                       return 1.2
    if (sev === "low"      || (rel > 0 && rel < 30))           return 0.8
    return 1.0
}

function getMarkerOpacity(a) {
    if (isSanctioned(a) || isSts(a)) return 1.0
    const sev = (a.severity || "").toLowerCase()
    if (sev === "critical" || sev === "high") return 1.0
    if (sev === "medium")                     return 0.85
    return 0.5
}


function isDarkShip(a) {
    return a.alert_category === "AIS_DARK_SHIP" ||
           a.alert_category === "DARK_SHIP" ||
           a.type === "dark_ship" ||
           (a.title || "").toLowerCase().includes("dark ship")
}

const _INLAND_BBOXES = [
    { latMin: 47.0, latMax: 51.9, lonMin:   6.0, lonMax:   8.5 }, // Rhine
    { latMin: 44.5, latMax: 48.5, lonMin:  13.5, lonMax:  29.5 }, // Danube
    { latMin: 41.5, latMax: 49.0, lonMin: -93.0, lonMax: -75.0 }, // Great Lakes
    { latMin: 29.0, latMax: 48.0, lonMin: -97.0, lonMax: -88.0 }, // Mississippi
    { latMin: 22.0, latMax: 32.0, lonMin: 105.0, lonMax: 122.0 }, // Yangtze
]

function _isInland(lat, lon) {
    return _INLAND_BBOXES.some(b =>
        lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax
    )
}

function filterAlert(a, sanctionedMmsiSet) {
    if (!isDarkShip(a)) return true

    const lat = Number(a.lat)
    const lon = Number(a.lng ?? a.lon)

    // Gate A — inland waterway suppression
    if (_isInland(lat, lon)) return false

    // Gate B — sanctions list (skip if set is empty: fetch pending or failed)
    if (sanctionedMmsiSet.size > 0) {
        const mmsiA = String(a.mmsi          || "")
        const mmsiB = String(a.metadata?.mmsi || "")
        if (!sanctionedMmsiSet.has(mmsiA) &&
            !sanctionedMmsiSet.has(mmsiB) &&
            a.sanctions_hit          !== true &&
            a.on_sanctions_list      !== true &&
            a.metadata?.sanctions_hit !== true) {
            return false
        }
    }

    return true
}

// The fusion-event markers this layer used to draw (#BF5AF2 sparkle glyphs
// fetched from /api/fusions) have been removed. Fusion is now a derived
// finding computed at the playhead — see backend/alerts_derived.py and the
// PARALLAX addendum §A6 — rather than a marker per stored fusion_events row.

export default function GlobeAlertsLayer({ enabled, viewBounds, windowHours = null, maxRank = null }) {
    const [alerts,           setAlerts]           = useState([])
    const [sanctionedMmsiSet, setSanctionedMmsiSet] = useState(new Set())

    // Fetch cycle runs on mount and never stops — decoupled from enabled.
    // Toggling enabled only shows/hides markers; it never wipes state or
    // restarts the interval, so alerts survive layer-toggle flickers.
    useEffect(() => {
        let cancelled = false

        const loadAlerts = () =>
            fetch(`${API_BASE}/api/forge/alerts`, { headers: forgeHeaders() })
                .then(r => r.ok ? r.json() : [])
                .then(d => { if (!cancelled) setAlerts(safeArray(d)) })
                .catch(() => {})

        // Sanctions MMSI set — fetched once on mount, never on interval ticks
        fetch(`${API_BASE}/api/sanctions/mmsi-list`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(list => {
                if (!cancelled)
                    setSanctionedMmsiSet(new Set(safeArray(list).map(String)))
            })
            .catch(() => console.warn("[GlobeAlertsLayer] sanctions mmsi-list fetch failed"))

        loadAlerts()
        const iv = setInterval(loadAlerts, 30_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!alerts.length) return
        const ids = []
        alerts.forEach((a, i) => {
            const id = `alert-forge-${a.id || i}`
            const isMilitaryAdsb = (a.domain || a.source || "").toUpperCase() === "ADSB" &&
                (a.alert_category === "MILITARY_AIRCRAFT" ||
                 a.alert_type === "military_aircraft" ||
                 a.rule_name === "Military Squawk" ||
                 a.aircraft_military)
            let entityType
            if (isMilitaryAdsb) {
                entityType = "aircraft"
            } else if (a.source === "SENTINEL") {
                entityType = "sentinel_detection"
            } else if (a.domain === "NEWS" && a.icon_type && ALERT_ICONS[a.icon_type]) {
                entityType = "assessment"
            } else {
                entityType = "alert"
            }
            const entityData = isMilitaryAdsb ? {
                icao:       a.icao_hex || a.icao || a.entity_id || "",
                icao24:     a.icao_hex || a.icao || a.entity_id || "",
                flight:     a.callsign || a.aircraft || a.entity_name || "",
                lat:        a.lat,
                lon:        a.lon ?? a.lng,
                alt_baro:   a.altitude ?? a.altitude_ft ?? null,
                gs:         a.speed ?? null,
                track:      a.heading ?? null,
                squawk:     a.squawk ?? null,
                military:   true,
                from_alert: true,
            } : {
                ...a,
                _idx:           i,
                detection_type:            a.detection_type || a.rule_type,
                confidence:                a.confidence,
                claude_severity:           a.severity,
                claude_vision_analysis:    a.claude_analysis || a.description,
                centroid_lat:              a.lat,
                centroid_lon:              a.lng ?? a.lon,
                nearest_asset_name:        a.nearest_asset_name,
                nearest_asset_distance_km: a.nearest_asset_distance_km,
                in_strategic_zone:         a.in_strategic_zone,
                created_at:                a.timestamp,
            }
            setEntity(id, entityType, entityData)
            ids.push(id)
        })
        return () => ids.forEach(deleteEntity)
    }, [alerts])

    // enabled controls visibility only — fetch cycle runs regardless.
    // Real root-cause fix: the Time window/severity-floor selector never
    // reached this layer before — it now applies the exact same real
    // signalVisibility.js decision Situation.jsx's own header/legend/
    // histogram counts use, so the map can't disagree with them again.
    const _nowMs = Date.now()
    const _seenIds = new Set()
    const filteredAlerts = (enabled ? alerts : []).filter(a => {
        if (a.lat == null || (a.lng ?? a.lon) == null || !isFinite(Number(a.lat))) return false
        const id = a.id || a.alert_id
        if (!id || _seenIds.has(id)) return false
        _seenIds.add(id)
        if (!filterAlert(a, sanctionedMmsiSet)) return false
        return isSignalVisible(
            { ageHours: ageHoursSince(a.timestamp, _nowMs), severityRank: rankForRawSeverity(a.severity) },
            { windowHours, maxRank },
        )
    })
    const { individual: visibleAlerts, clusters: alertClusters } = clusterTracks(filteredAlerts, {
        getLat: alertLat, getLon: alertLon, viewBounds, maxIndividual: DESKTOP_ALERTS_CAP,
        // Lower than AIS/ADS-B's default (4) — alert labels are always-on,
        // backgrounded text boxes (heavier than a plain vessel/aircraft
        // label), so even 2-3 close together still visually stack.
        clusterMinSize: 2,
    })

    return (
        <>
            {alertClusters.map((c, i) => (
                <Entity
                    key={`alert-cluster-${i}`}
                    position={Cartesian3.fromDegrees(c.lon, c.lat, 0)}
                    point={{ pixelSize: 16, color: Color.fromCssColorString("#FF3B30").withAlpha(0.55), outlineColor: Color.WHITE, outlineWidth: 1, heightReference: HeightReference.CLAMP_TO_GROUND }}
                    label={{
                        text: String(c.count),
                        font: "11px Arial", fillColor: Color.WHITE,
                        outlineColor: Color.fromCssColorString("#0F1721"), outlineWidth: 2, style: 2,
                        distanceDisplayCondition: new DistanceDisplayCondition(0, 15_000_000),
                    }}
                />
            ))}
            {visibleAlerts.map((a, i) => {
                // Real bug fix: Number(null) is 0 (a real, finite but
                // fabricated-looking coordinate — the equator/prime
                // meridian), so converting through Number() before the
                // null check let a real missing lat/lon silently plot at
                // (0,0) instead of being skipped. Null-check first (same
                // safe order already used above at line 248 and in
                // GlobeADSBLayer.jsx/GlobeAISLayer.jsx).
                const rawLat = a.lat, rawLon = a.lng ?? a.lon
                if (rawLat == null || rawLon == null) return null
                const lat = Number(rawLat)
                const lon = Number(rawLon)
                if (!isFinite(lat) || !isFinite(lon)) return null
                const icon  = alertIcon(a)
                if (!icon) return null
                const isAssessment = a.domain === "NEWS" && !!(a.icon_type && ALERT_ICONS[a.icon_type])
                // News assessments are now the same fixed-size diamond
                // regardless of severity — no more severityScale variance.
                const baseSize = isAssessment ? NEWS_MARKER_SIZE : 38
                const hierScale   = getMarkerScale(a)
                const finalScale  = isAssessment ? 1.0 : hierScale
                // News assessments are also full opacity always — no
                // severity-based dimming, matching the fixed size/shape.
                const opacity     = isAssessment ? 1.0 : getMarkerOpacity(a)
                const billColor   = opacity < 1.0 ? Color.WHITE.withAlpha(opacity) : undefined

                const sanctioned = isSanctioned(a)
                const sts        = isSts(a)
                const sanctionsStatus = resolveSanctionsStatus(a)
                // "possible" means the backend's confirmed/possible
                // corroboration downgraded this sanctions hit — label it
                // distinctly rather than showing the same "SANCTIONED" text
                // a "confirmed" hit gets. See resolveSanctionsStatus() in
                // src/globe/entityIcons.js for the real backend fields this
                // reads (same fields the old resolveAlertAffiliation() did).
                const labelText  = sanctioned
                    ? (sanctionsStatus === "possible" ? "⚠ POSSIBLE MATCH — REVIEW" : "⚠ SANCTIONED")
                    : sts ? "STS DETECTED"
                    : null

                return (
                    <Entity
                        id={`alert-forge-${a.id || i}`}
                        key={a.id || i}
                        position={Cartesian3.fromDegrees(lon, lat, 0)}
                        billboard={{
                            image:           icon,
                            width:           Math.round(baseSize * finalScale),
                            height:          Math.round(baseSize * finalScale),
                            color:           billColor,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                                                        distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
                            eyeOffset: isAssessment ? new (Cartesian3)(0, 0, -60) : undefined,
                        }}
                        label={labelText ? {
                            text:            labelText,
                            font:            "bold 9px Arial",
                            fillColor:       (sanctioned && sanctionsStatus !== "possible")
                                                 ? Color.fromCssColorString("#FF3B30")
                                                 : Color.fromCssColorString("#FF9500"),
                            outlineColor:    Color.fromCssColorString("#0F1721"),
                            outlineWidth:    2,
                            style:           2,
                            showBackground:  true,
                            backgroundColor: Color.fromCssColorString("#0F1721").withAlpha(0.85),
                            pixelOffset:     new Cartesian2(0, -(Math.round(baseSize * finalScale) / 2 + 8)),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 8_000_000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        } : undefined}
                    />
                )
            })}
        </>
    )
}
