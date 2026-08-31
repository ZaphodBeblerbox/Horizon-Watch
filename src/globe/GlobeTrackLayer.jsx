import { useState, useEffect } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, PolylineDashMaterialProperty, ColorMaterialProperty } from "cesium"
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

function usePositionHistory(enabled, path) {
    const [groups, setGroups] = useState(new Map())
    useEffect(() => {
        if (!enabled) { setGroups(new Map()); return }
        let cancelled = false
        const load = () =>
            fetch(`${API_BASE}${path}?hours=${HOURS}`)
                .then(r => r.ok ? r.json() : { positions: [] })
                .then(d => { if (!cancelled) setGroups(groupByKey(d.positions || [], path.includes("aircraft") ? "icao24" : "mmsi")) })
                .catch(() => {})
        load()
        const iv = setInterval(load, POLL_MS)
        return () => { cancelled = true; clearInterval(iv) }
    }, [enabled, path])
    return groups
}

const AIS_TRACK_COLOR  = Color.fromCssColorString("#5AC8FA").withAlpha(0.55)
const ADSB_TRACK_COLOR = Color.fromCssColorString("#FF9F0A").withAlpha(0.5)

export default function GlobeTrackLayer({ aisEnabled = false, adsbEnabled = false }) {
    const vesselTracks  = usePositionHistory(aisEnabled,  "/api/history/vessels")
    const aircraftTracks = usePositionHistory(adsbEnabled, "/api/history/aircraft")

    return (
        <>
            {[...vesselTracks.entries()].map(([mmsi, points]) => {
                if (points.length < 2) return null
                const positions = Cartesian3.fromDegreesArray(points.flatMap(p => [p.lon, p.lat]))
                return (
                    <Entity
                        key={`track-ais-${mmsi}`}
                        id={`track-ais-${mmsi}`}
                        polyline={{
                            positions,
                            width: 2,
                            material: new ColorMaterialProperty(AIS_TRACK_COLOR),
                            clampToGround: true,
                        }}
                    />
                )
            })}
            {[...aircraftTracks.entries()].map(([icao, points]) => {
                if (points.length < 2) return null
                const positions = Cartesian3.fromDegreesArrayHeights(
                    points.flatMap(p => [p.lon, p.lat, (isFinite(Number(p.altitude)) ? Number(p.altitude) : 0) * 0.3048]),
                )
                return (
                    <Entity
                        key={`track-adsb-${icao}`}
                        id={`track-adsb-${icao}`}
                        polyline={{
                            positions,
                            width: 2,
                            material: new PolylineDashMaterialProperty({ color: ADSB_TRACK_COLOR, dashLength: 12 }),
                        }}
                    />
                )
            })}
        </>
    )
}
