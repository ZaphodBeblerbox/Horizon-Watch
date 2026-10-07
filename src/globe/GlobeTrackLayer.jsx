import { useState, useEffect, useMemo } from "react"
import { usablePoints, vertexHeight } from "./trackPoints.js"
import { Entity } from "resium"
import { Cartesian3, Color, PolylineDashMaterialProperty, ColorMaterialProperty, CallbackProperty } from "cesium"
import { liveAt } from "./smoothMotion.js"
import API_BASE from "../apiBase.js"

// GlobeTrackLayer — real recent-position-history trails for AIS vessels and
// ADS-B aircraft. Never existed before (confirmed via a full git-log audit
// of GlobeAISLayer.jsx/GlobeADSBLayer.jsx: no `path`/PathGraphics/polyline
// track construct at any point in their history) — this is new, not a
// restoration of something the recent marker/icon rewrite dropped. The
// underlying position-history data and its real write path
// (_record_ais_history()/_record_adsb_history(), backend/main.py) were
// never touched and are confirmed live; only the rendering was missing.
//
// Styling: solid for AIS, dashed for ADS-B — the one existing "solid =
// actual/confirmed, dashed = predicted/derived" convention already used
// elsewhere in this codebase (backend/services/director_service.py,
// src/services/commandRunner.js, src/data/demoBriefing.js) for the same
// real/derived distinction, applied here as: AIS history is a direct
// per-fix recording (solid), while an ADS-B trail is built from
// intermittently-sampled fixes bridged by straight segments (dashed) —
// consistent rather than inventing a new rule.
//
// Gated on the same aisEnabled/adsbEnabled flags GlobeAISLayer/GlobeADSBLayer
// already use — a track is part of "showing AIS/ADS-B", not a separate
// layer-rail toggle.

const HOURS = 3          // recent-track window
export const MAX_POINTS = 30    // per-entity cap, most-recent-first before reversing
const POLL_MS = 120_000

export function groupByKey(positions, keyField) {
    const groups = new Map()
    for (const p of positions) {
        const key = p[keyField]
        if (!key || p.lat == null || p.lon == null) continue
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(p)
    }
    for (const arr of groups.values()) {
        arr.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS)
    }
    return groups
}

function usePositionHistory(enabled, path, keys) {
    const [groups, setGroups] = useState(new Map())
    useEffect(() => {
        if (!enabled) { setGroups(new Map()); return }
        let cancelled = false
        const load = () => {
            // ASKED PER VESSEL, because a global "newest N" cannot
            // contain a track: history is throttled to one row per ship
            // per five minutes and the feed writes ~24 rows a second, so
            // any recent slice holds one point per vessel. Measured:
            // 12,000 positions, 12,000 vessels, zero drawable tracks.
            // Naming the ships on screen gives 40 of 40 a real trail.
            if (!keys || !keys.length) { setGroups(new Map()); return }
            const param = path.includes("aircraft") ? "icaos" : "mmsis"
            const q = `&per_vessel=40&${param}=${keys.slice(0, 150).join(",")}`
            fetch(`${API_BASE}${path}?hours=${HOURS}${q}`)
                .then(r => r.ok ? r.json() : { positions: [] })
                .then(d => { if (!cancelled) setGroups(groupByKey(d.positions || [], path.includes("aircraft") ? "icao24" : "mmsi")) })
                .catch(() => {})
        }
        load()
        const iv = setInterval(load, POLL_MS)
        return () => { cancelled = true; clearInterval(iv) }
        // Joined so the effect re-runs when the set of visible ships
        // changes, not on every position update for the same ones.
    }, [enabled, path, (keys || []).join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
    return groups
}

const AIS_TRACK_COLOR  = Color.fromCssColorString("#5AC8FA").withAlpha(0.55)
const ADSB_TRACK_COLOR = Color.fromCssColorString("#FF9F0A").withAlpha(0.5)
// Made once: a new material each render made Resium swap the property and
// Cesium rebuild the line.
const AIS_MATERIAL = new ColorMaterialProperty(AIS_TRACK_COLOR)
const ADSB_MATERIAL = new PolylineDashMaterialProperty({ color: ADSB_TRACK_COLOR, dashLength: 12 })

/** Metres between two lon/lat points, roughly (for "is the head near the trail"). */
const near = (a, b, km) => Math.abs(a.lat - b.lat) * 111 < km && Math.abs(a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180) < km

/**
 * One trail: its stored history, ending where the contact is DRAWN now.
 *
 * The positions are a callback, so the line is drawn synchronously each
 * frame. A static line is rebuilt off the main thread whenever its
 * positions change, and vanishes while that happens — the trails blinked
 * at every poll. The history part is built once per poll; the head is the
 * contact's smoothed live position (smoothMotion.js), so the trail and the
 * model never part company.
 */
function trailCallback(kind, id, pts, heightOf) {
    const base = pts.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, heightOf(p)))
    const last = pts[pts.length - 1]
    let cache = null, cacheAt = 0
    return new CallbackProperty(() => {
        const now = Date.now()
        if (cache && now - cacheAt < 30) return cache
        const head = liveAt(kind, id, now)
        cache = head && near(head, last, 60)
            ? [...base, Cartesian3.fromDegrees(head.lon, head.lat, kind === "aircraft" ? (head.alt ?? 0) : 0)]
            : base
        cacheAt = now
        return cache
    }, false)
}

export default function GlobeTrackLayer({ aisEnabled = false, adsbEnabled = false,
                                         vessels = [], aircraft = [] }) {
    // The ships and airframes actually on screen. Tracks are drawn for
    // what the analyst can see, which is also the only set small enough
    // to fetch real history for.
    const vesselKeys = useMemo(
        () => (vessels || []).map((v) => String(v.mmsi)).filter(Boolean).slice(0, 150),
        [vessels])
    const aircraftKeys = useMemo(
        () => (aircraft || []).map((a) => String(a.icao24 || a.hex || "")).filter(Boolean).slice(0, 150),
        [aircraft])
    const vesselTracks  = usePositionHistory(aisEnabled,  "/api/history/vessels", vesselKeys)
    const aircraftTracks = usePositionHistory(adsbEnabled, "/api/history/aircraft", aircraftKeys)

    // Built when the history changes (a poll), not on every render of the
    // map — the parent re-renders with each feed refresh.
    const vesselLines = useMemo(() => [...vesselTracks.entries()].map(([mmsi, points]) => {
        const pts = usablePoints(points)
        // Vessels are at sea level: drawn at height 0 rather than clamped
        // to the ground, which a per-frame line cannot be cheaply.
        return pts.length >= 2 ? [mmsi, trailCallback("vessels", mmsi, pts, () => 0)] : null
    }).filter(Boolean), [vesselTracks])
    const aircraftLines = useMemo(() => [...aircraftTracks.entries()].map(([icao, points]) => {
        const pts = usablePoints(points)
        return pts.length >= 2 ? [icao, trailCallback("aircraft", icao, pts, (p) => vertexHeight(p.altitude))] : null
    }).filter(Boolean), [aircraftTracks])

    return (
        <>
            {vesselLines.map(([mmsi, positions]) => (
                <Entity key={`track-ais-${mmsi}`} id={`track-ais-${mmsi}`}
                        polyline={{ positions, width: 2, material: AIS_MATERIAL }} />
            ))}
            {aircraftLines.map(([icao, positions]) => (
                <Entity key={`track-adsb-${icao}`} id={`track-adsb-${icao}`}
                        polyline={{ positions, width: 2, material: ADSB_MATERIAL }} />
            ))}
        </>
    )
}
