/**
 * demonstrations.js — the route planner's demonstrations, for anything that
 * wants them outside a plan (the panel, a card, the map layers): every
 * current demonstration or happening the planner avoids, the world over, and
 * the crowds' movement reconstructed from Telegram reports.
 * GET /api/routes/demonstrations (backend/demonstrations.py).
 *
 *   const d = await getDemonstrations()          // {demonstrations, tracks, generated_at, note, linking}
 *   demonstrationsNear(d, lat, lon, 3)            // {demonstrations, tracks} within 3 km, nearest first
 *   const { data, near } = useDemonstrations({ lat, lon, km: 3 })   // re-read every minute
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { DEMOS_PATH, DEMOS_REFRESH_MS } from "../globe/demonstrations.js"

export function getDemonstrations(doFetch = fetch) {
    return doFetch(`${API_BASE}${DEMOS_PATH}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
}

function metres(aLat, aLon, bLat, bLon) {
    const p1 = (aLat * Math.PI) / 180, p2 = (bLat * Math.PI) / 180
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((((bLon - aLon) * Math.PI) / 180) / 2) ** 2
    return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** What is within `km` of a point: demonstrations by distance, tracks whose latest place is near. Pure. */
export function demonstrationsNear(data, lat, lon, km = 3) {
    if (!data || !Number.isFinite(+lat) || !Number.isFinite(+lon)) return { demonstrations: [], tracks: [] }
    const lim = km * 1000
    const demonstrations = (data.demonstrations || [])
        .map((h) => ({ ...h, distance_m: Math.round(metres(+lat, +lon, +h.lat, +h.lon)) }))
        .filter((h) => h.distance_m <= lim)
        .sort((a, b) => a.distance_m - b.distance_m)
    const tracks = (data.tracks || [])
        .map((t) => ({ ...t, distance_m: Math.round(metres(+lat, +lon, +t.last?.lat, +t.last?.lon)) }))
        .filter((t) => t.distance_m <= lim)
        .sort((a, b) => a.distance_m - b.distance_m)
    return { demonstrations, tracks }
}

/** The answer, read again every minute while mounted and enabled; `near` when a point is given. */
export function useDemonstrations({ enabled = true, lat = null, lon = null, km = 3 } = {}) {
    const [data, setData] = useState(null)
    useEffect(() => {
        if (!enabled) return undefined
        let live = true
        const load = () => getDemonstrations().then((d) => { if (live) setData(d) }).catch(() => { /* keep the last answer */ })
        load()
        const iv = setInterval(load, DEMOS_REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])
    return { data, near: lat != null && lon != null ? demonstrationsNear(data, lat, lon, km) : null }
}
