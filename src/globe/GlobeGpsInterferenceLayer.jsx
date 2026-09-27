/**
 * GlobeGpsInterferenceLayer.jsx — where satellite navigation is being denied.
 *
 * Backed by /api/gps-interference, which measures it from the navigation
 * integrity the aircraft themselves report. See backend/gps_interference.py
 * for what that measurement is and what it cannot tell you.
 *
 * CLEAR CELLS ARE DRAWN, and that is the point of this layer rather than an
 * oversight. A map that only paints trouble cannot tell you the difference
 * between "aircraft here are fine" and "nothing has flown here", and over
 * open sea that difference is the whole story. Clear reads as a barely-there
 * wash; only degraded and severe carry real colour.
 *
 * THE CELLS ARE HONEST ABOUT THEIR OWN SIZE. Each rectangle is drawn at the
 * full two degrees it was measured over, not as a point, because a point
 * would claim the interference was located far more precisely than aircraft
 * spaced tens of kilometres apart can support.
 */
import { useEffect, useState, useRef } from "react"
import { useCesium } from "resium"
import { Rectangle, Color, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"

/** Fallback only — each cell carries its own size, see below. */
const CELL_DEG = 0.5

/**
 * Severity reads through opacity on one hue, not through separate colours.
 *
 * This is a magnitude — the share of aircraft that lost their fix — so it
 * takes a sequential ramp rather than a categorical one. The hue is the
 * product's amber warning rather than the chart blue, because unlike the
 * density heatmaps this layer means something is wrong.
 */
function colorFor(level, pct) {
    if (level === "clear") return Color.fromCssColorString("#5c6b78").withAlpha(0.07)
    // 10% (the degraded floor) to 60% maps across the usable alpha range;
    // past 60% it is as loud as it gets rather than continuing to climb.
    const t = Math.max(0, Math.min(1, (pct - 10) / 50))
    if (level === "severe") {
        return Color.fromCssColorString("#c4453c").withAlpha(0.3 + 0.45 * t)
    }
    return Color.fromCssColorString("#b7822c").withAlpha(0.22 + 0.35 * t)
}

export default function GlobeGpsInterferenceLayer({
    enabled = false, bounds = null, affectedOnly = false,
}) {
    const { viewer } = useCesium()
    const [cells, setCells] = useState([])
    const entitiesRef = useRef([])

    useEffect(() => {
        if (!enabled) { setCells([]); return }
        let cancelled = false
        const ctrl = new AbortController()

        const load = () => {
            const q = new URLSearchParams()
            if (affectedOnly) q.set("level", "affected")
            if (bounds && bounds.south != null) {
                q.set("south", bounds.south); q.set("north", bounds.north)
                q.set("west", bounds.west);   q.set("east", bounds.east)
            }
            fetch(`${API_BASE}/api/gps-interference?${q}`, { signal: ctrl.signal })
                .then(r => (r.ok ? r.json() : null))
                .then(d => { if (!cancelled && d) setCells(safeArray(d.cells)) })
                .catch(err => {
                    if (err.name !== "AbortError") console.warn("[gps-interference]", err)
                })
        }
        load()
        // The grid behind this moves on the ADS-B poll's sixty-second
        // cadence, so polling faster would only re-fetch the same answer.
        const t = setInterval(load, 60000)
        return () => { cancelled = true; ctrl.abort(); clearInterval(t) }
    }, [enabled, affectedOnly,
        bounds?.south, bounds?.north, bounds?.west, bounds?.east])

    useEffect(() => {
        if (!viewer) return
        const cleanup = () => {
            entitiesRef.current.forEach(e => {
                if (viewer.entities.contains(e)) viewer.entities.remove(e)
                if (e.id) deleteEntity(e.id)
            })
            entitiesRef.current = []
        }
        cleanup()
        if (!enabled || !cells.length) return

        const added = []
        cells.forEach(c => {
            if (c.lat == null || c.lon == null) return
            // The server decides the tile size and says so per cell, so
            // changing it there does not silently leave the map drawing
            // squares of the wrong size over the right numbers.
            const half = (Number(c.cell_deg) || CELL_DEG) / 2
            const id = `gpsjam-${c.cell}`
            const entity = viewer.entities.add({
                id,
                rectangle: {
                    coordinates: Rectangle.fromDegrees(
                        c.lon - half, c.lat - half, c.lon + half, c.lat + half),
                    material: colorFor(c.level, c.pct),
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                },
            })
            // The inspector gets the denominator, always. "62% degraded"
            // over eight aircraft and over four hundred are different
            // claims, and only one of them is worth acting on.
            setEntity(id, "gps_interference", {
                lat: c.lat, lon: c.lon, cell: c.cell,
                aircraft: c.aircraft, degraded: c.degraded,
                pct: c.pct, level: c.level, last_seen: c.last_seen,
                cell_deg: c.cell_deg, radius_deg: c.radius_deg,
            })
            added.push(entity)
        })
        entitiesRef.current = added
        return cleanup
    }, [viewer, enabled, cells])

    return null
}
