/**
 * GlobeSelectedTrackLayer.jsx — the full track of the one thing you clicked.
 *
 * WHY THIS IS SEPARATE FROM GlobeTrackLayer. That layer draws short
 * trails for everything visible, which is context. This draws the WHOLE
 * recent history of a single contact, which is an investigation — and
 * the two want opposite things: the first has to stay faint enough to
 * ignore, the second has to be the most legible line on the screen.
 *
 * AIRCRAFT ARE DRAWN AT ALTITUDE. A flight path flattened onto the
 * ground is a different claim from the one the data makes: a hold, a
 * descent and an overflight all look identical from above and are
 * obvious in profile. Altitude is present on 2,278,707 of 2,282,834
 * stored rows, so the information was there and was being thrown away.
 *
 * Vessels stay at sea level, which is not a simplification — it is where
 * they are.
 *
 * The arithmetic lives in selectedTrack.js so the parts that can be
 * wrong in silence — the unit conversion, the altitude that is the
 * string "ground" — are tested without a globe.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, PolylineOutlineMaterialProperty } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { altitudeMetres, chronological, dedupe, isDrawable } from "./selectedTrack.js"

const HOURS = 12

// Bright, and outlined so it survives over both bright terrain and the
// faint trails of everything else.
const AIS_COLOR  = Color.fromCssColorString("#5AC8FA")
const ADSB_COLOR = Color.fromCssColorString("#FF9F0A")

export default function GlobeSelectedTrackLayer({ selected = null }) {
    const [track, setTrack] = useState(null)

    useEffect(() => {
        setTrack(null)
        if (!selected?.id) return
        const isAir = selected.kind === "aircraft"
        const key = String(selected.id).replace(/^(ais|adsb)-/i, "")
        if (!key) return

        let cancelled = false
        const path = isAir ? "aircraft" : "vessels"
        const param = isAir ? "icaos" : "mmsis"
        fetch(`${API_BASE}/api/history/${path}?hours=${HOURS}&per_vessel=400&${param}=${encodeURIComponent(key)}`,
              { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled) return
                // Deduplicated as well as ordered: a moored ship or a
                // parked aircraft repeats one coordinate for hours, and
                // Cesium cannot build a line out of a point repeated.
                const pts = dedupe(chronological(safeArray(d?.positions)))
                // The id is carried WITH the track. Reading it off the
                // `selected` prop during render crashed the globe: when a
                // contact is deselected, React renders with selected=null
                // before the effect that clears this state has run, so
                // `selected.id` was read off null.
                if (isDrawable(pts)) setTrack({ isAir, pts, id: selected.id })
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [selected?.id, selected?.kind])

    if (!track) return null
    const { isAir, pts, id } = track

    // Per-vertex height in metres, ground for anything a vessel or an
    // aircraft on the surface.
    const heights = pts.map((p) => (isAir ? altitudeMetres(p.altitude) : 0))
    const positions = pts.map((p, i) => Cartesian3.fromDegrees(p.lon, p.lat, heights[i]))
    const colour = isAir ? ADSB_COLOR : AIS_COLOR

    return (
        <>
            <Entity
                id={`selected-track-${id}`}
                name={`${HOURS}h track`}
                polyline={{
                    positions,
                    width: 3,
                    material: new PolylineOutlineMaterialProperty({
                        color: colour.withAlpha(0.95),
                        outlineColor: Color.BLACK.withAlpha(0.65),
                        outlineWidth: 1.5,
                    }),
                    // Aircraft keep their altitude; a vessel track is on
                    // the water and follows the terrain.
                    clampToGround: !isAir,
                }}
            />
            {/* A CURTAIN DOWN TO THE GROUND. Depth alone does not read as
                position on a globe — a path drawn in the air could be
                anywhere along the line of sight, and a single dropline
                only fixes one end of it. A wall under the whole track
                fixes every point of it at once, and the shape of its top
                edge IS the altitude profile: a climb, a hold and an
                overflight are three obviously different silhouettes. */}
            {isAir && positions.length >= 2 ? (
                <Entity
                    id={`selected-track-wall-${id}`}
                    name="Altitude profile"
                    wall={{
                        positions,
                        minimumHeights: heights.map(() => 0),
                        maximumHeights: heights,
                        material: colour.withAlpha(0.18),
                        outline: true,
                        outlineColor: colour.withAlpha(0.35),
                        outlineWidth: 1,
                    }}
                />
            ) : null}
        </>
    )
}
