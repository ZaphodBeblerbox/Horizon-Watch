// replayOnMap.js — the ONE shared "Replay on map" animation trigger.
// Reused verbatim by Replay.jsx's own flagship playback, Briefings' xref
// actions, and any signal row elsewhere in the app that wants to show a
// signal's real recent context on the one real globe — never
// reimplemented per caller, so the walk's real 420ms cadence and real
// <=36h/1600km context window can't drift between call sites.
//
// GlobeReplayLayer.jsx (mounted once, inside GlobeView.jsx, mirroring
// GlobeAnnotationLayer.jsx's real viewerRef architecture) is the only thing
// that listens for the "akili:replay-on-map" event this dispatches and
// actually draws the walk on the real Cesium globe.
import API_BASE from "../apiBase.js"

const API = API_BASE
const CONTEXT_HOURS = 36
const CONTEXT_KM = 1600
const FLY_ALTITUDE_BASE = 460_000 // real akili:fly-to altitude, tightened 4.6x below

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371
    const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180
    const dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lon2 - lon1) * Math.PI) / 180
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Switch to Situation, fly the one real globe to `target` at a tightened
 * (4.6x) zoom, select it, then walk up to 36h/1600km of the target's real
 * preceding signals chronologically as dashed converging lines + expanding
 * rings, 420ms apart, then clear. Every context signal is fetched fresh from
 * GET /api/analytics/timeline — never fabricated, never randomized; a
 * fetch failure or an isolated target (no real context within the window)
 * plays an honest target-only ping rather than inventing neighbors.
 *
 * @param {{lat:number, lon:number, publishedAt?:string, created_at?:string, title?:string, severity?:string, severityToken?:string}} target
 */
export async function replayOnMap(target) {
    if (target?.lat == null || target?.lon == null) return
    const targetTime = target.publishedAt || target.created_at
    const targetMs = targetTime ? new Date(targetTime).getTime() : NaN

    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    window.dispatchEvent(new CustomEvent("akili:open-map"))
    await new Promise((r) => setTimeout(r, 60))
    window.dispatchEvent(new CustomEvent("akili:fly-to", {
        detail: { lat: target.lat, lon: target.lon, altitude: FLY_ALTITUDE_BASE / 4.6 },
    }))

    let context = []
    if (Number.isFinite(targetMs)) {
        try {
            const hoursSinceTarget = Math.ceil((Date.now() - targetMs) / 3600000)
            const hours = Math.min(24 * 90, Math.max(CONTEXT_HOURS, hoursSinceTarget + CONTEXT_HOURS))
            // the server keeps only what is near the target and before it
            const until = new Date(targetMs).toISOString()
            const r = await fetch(`${API}/api/analytics/timeline?hours=${hours}&lat=${target.lat}&lon=${target.lon}&km=${CONTEXT_KM}&until=${encodeURIComponent(until)}&limit=2000`)
            const d = r.ok ? await r.json() : null
            if (Array.isArray(d?.signals)) {
                context = d.signals
                    .filter((s) => {
                        if (s.lat == null || s.lon == null) return false
                        const t = new Date(s.created_at).getTime()
                        if (!Number.isFinite(t) || t > targetMs) return false
                        if ((targetMs - t) / 3600000 > CONTEXT_HOURS) return false
                        return haversineKm(target.lat, target.lon, s.lat, s.lon) <= CONTEXT_KM
                    })
                    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            }
        } catch {
            context = [] // honest empty context on a real fetch failure — never a fabricated fallback
        }
    }

    // Let the 1.5s real camera flyTo settle before the ping/walk begins.
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent("akili:replay-on-map", { detail: { target, context } }))
    }, 900)
}
