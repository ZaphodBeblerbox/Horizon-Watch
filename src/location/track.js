/**
 * track.js — an asset's or a person's movements over a time range, drawn
 * on the map (owner, 2026-10-12: "I want a track to be displayable for the
 * movements of the asset").
 *
 * One track is shown at a time, on whichever map is in front (the phone's
 * Leaflet map, mobile/trackLeaflet.js; the desktop globe,
 * globe/GlobeAssetTrackLayer.jsx), from this store; the panel that picks the
 * range and replays it (TrackPanel.jsx) fetches it and keeps it growing as
 * positions stream in.
 *
 *   GET /api/my-assets/{id}/track/range?range=24h     an asset
 *   GET /api/my-assets/people/{user_id}/track?range=  a person
 *   -> {points (thinned server-side), stops (≥ 10 min), start, end, raw_count, kept, distance_m}
 *
 * Pure helpers below the store: the line coloured by age (older fades),
 * the position at a moment (the scrubber), a live point appended.
 */

export const TRACK_RANGES = [["1h", "1 h"], ["6h", "6 h"], ["24h", "24 h"], ["7d", "7 d"], ["30d", "30 d"]]
export const LIVE_MIN_MOVE_M = 10
export const LIVE_MIN_GAP_MS = 60_000

// ── the store ───────────────────────────────────────────────────────────────

let state = { target: null, range: "24h", data: null, loading: false, error: null, scrubT: null, playing: false }
const subs = new Set()

export function getTrack() { return state }
export function subscribeTrack(fn) { subs.add(fn); return () => subs.delete(fn) }
export function setTrack(patch) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
    subs.forEach((f) => { try { f(state) } catch { /* a listener's own trouble */ } })
}
/** target: {kind: "asset"|"person", id, name, userId?} */
export function showTrack(target, range) {
    setTrack({ target, range: range || state.range || "24h", data: null, error: null, scrubT: null, playing: false })
}
export function hideTrack() { setTrack({ target: null, data: null, scrubT: null, playing: false, error: null }) }

export function trackUrl(apiBase, target, range) {
    if (!target) return null
    const r = encodeURIComponent(range || "24h")
    return target.kind === "person"
        ? `${apiBase}/api/my-assets/people/${encodeURIComponent(target.id)}/track?range=${r}&max_points=600`
        : `${apiBase}/api/my-assets/${encodeURIComponent(target.id)}/track/range?range=${r}&max_points=600`
}

// ── pure helpers ───────────────────────────────────────────────────────────

export const tsOf = (p) => (typeof p?.at === "number" ? p.at : Date.parse(p?.at || "")) || 0

export function metres(a, b) {
    const R = 6371000, r = Math.PI / 180
    const dp = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r
    const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 0 (oldest) … 1 (newest) for a moment within [t0, t1]. */
export function ageFrac(t, t0, t1) {
    if (!(t1 > t0)) return 1
    return Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))
}

/** The line's colour at an age: blue, fading and paling the older it is. */
export function ageColor(frac) {
    const f = Math.max(0, Math.min(1, frac))
    const mix = (a, b) => Math.round(a + (b - a) * f)
    // old: a pale grey-blue, nearly transparent; new: the team's blue, solid
    return { r: mix(150, 59), g: mix(170, 140), b: mix(200, 255), a: +(0.18 + 0.82 * f).toFixed(3) }
}
export const cssColor = (c) => `rgba(${c.r},${c.g},${c.b},${c.a})`

/** The line cut into `n` runs by time, each with its colour (consecutive
 *  runs share their end point, so the line has no gaps). */
export function ageSegments(points, n = 12, range = null) {
    if (!points || points.length < 2) return []
    // range [t0, t1]: the whole track's, so a replay's partial line keeps its colours
    const t0 = range ? range[0] : tsOf(points[0]), t1 = range ? range[1] : tsOf(points[points.length - 1])
    const span = Math.max(1, t1 - t0)
    const out = []
    let cur = null
    for (let i = 0; i < points.length; i++) {
        const p = points[i]
        const k = Math.max(0, Math.min(n - 1, Math.floor(((tsOf(p) - t0) / span) * n)))
        if (!cur || k !== cur.k) {
            if (cur) cur.coords.push([p.lat, p.lon])                 // close the run at this point
            cur = { k, coords: [[p.lat, p.lon]], t: tsOf(p) }
            out.push(cur)
        } else cur.coords.push([p.lat, p.lon])
    }
    return out.filter((s) => s.coords.length > 1).map((s) => {
        const frac = (s.k + 0.5) / n
        const c = ageColor(frac)
        return { coords: s.coords, frac, color: c, css: cssColor(c) }
    })
}

/** Where they were at moment t (ms): interpolated between the two points around it. */
export function positionAt(points, t) {
    if (!points?.length) return null
    if (t <= tsOf(points[0])) return { lat: points[0].lat, lon: points[0].lon, at: tsOf(points[0]), i: 0 }
    const last = points[points.length - 1]
    if (t >= tsOf(last)) return { lat: last.lat, lon: last.lon, at: tsOf(last), i: points.length - 1 }
    let lo = 0, hi = points.length - 1
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (tsOf(points[mid]) <= t) lo = mid; else hi = mid
    }
    const a = points[lo], b = points[hi]
    const f = (t - tsOf(a)) / Math.max(1, tsOf(b) - tsOf(a))
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, at: t, i: lo }
}

/** The part of the track up to moment t (the replay draws only that). */
export function upTo(points, t) {
    if (t == null || !points?.length) return points || []
    const p = positionAt(points, t)
    const head = points.slice(0, p.i + 1)
    return tsOf(points[p.i]) < t ? [...head, { lat: p.lat, lon: p.lon, at: new Date(t).toISOString() }] : head
}

/** A live position appended to a track when it is newer and has moved
 *  (≥ 10 m) or a minute has passed — the server's own thinning rule. */
export function extendTrack(data, live) {
    if (!data || !live || !Number.isFinite(+live.lat) || !Number.isFinite(+live.lon)) return data
    const pts = data.points || []
    const at = typeof live.at === "number" ? live.at : Date.parse(live.at || "")
    if (!at) return data
    const last = pts[pts.length - 1]
    if (last) {
        const lt = tsOf(last)
        if (at <= lt) return data
        if (metres(last, live) < LIVE_MIN_MOVE_M && at - lt < LIVE_MIN_GAP_MS) return data
    }
    const p = { at: new Date(at).toISOString(), lat: +live.lat, lon: +live.lon, ...(live.accuracy_m != null ? { accuracy_m: live.accuracy_m } : {}), live: true }
    const add = last ? metres(last, p) : 0
    return { ...data, points: [...pts, p], end: p, start: data.start || p, kept: (data.kept || 0) + 1,
             distance_m: Math.round((data.distance_m || 0) + add) }
}

const hm = (iso) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
const dayHm = (iso, ref = Date.now()) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const same = new Date(ref).toDateString() === d.toDateString()
    return same ? hm(iso) : `${d.toLocaleDateString([], { weekday: "short", day: "numeric" })} ${hm(iso)}`
}
export function durationLabel(min) {
    const m = Math.round(min)
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`
}
/** "Stopped 14:02 – 14:31 · 29 min" */
export function stopLabel(s, ref) {
    return `Stopped ${dayHm(s.arrived, ref)} – ${dayHm(s.departed, ref)} · ${durationLabel(s.minutes)}`
}
export function distanceLabel(m) {
    if (!Number.isFinite(+m)) return ""
    return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`
}
export { hm as clock, dayHm }
