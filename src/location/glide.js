/**
 * glide.js — a marker that moves, not jumps, and says how fresh it is.
 *
 * REAL TIME (2026-10-12). Positions arrive every few seconds while someone
 * moves (location/positionStream.js). Drawn as they come, a marker would
 * teleport from fix to fix; instead it glides from where it is drawn now to
 * the new fix over about the time between fixes, so it is always moving
 * toward the latest known position and never behind it by more than one
 * interval. A jump of more than JUMP_M (a first fix after a long gap, a
 * city-level fix replaced by a GPS one) is drawn at once: gliding across a
 * country would draw a journey that never happened.
 *
 * Freshness is said in words beside every live marker: "live · 3 s ago"
 * while positions are coming (within LIVE_MS), "last seen 4 min ago" after.
 */

export const LIVE_MS = 90_000
export const JUMP_M = 5_000
export const MIN_GLIDE_MS = 400
export const MAX_GLIDE_MS = 3_000

const R = 6_371_000
export function metresBetween(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const ease = (t) => 1 - (1 - t) ** 3                           // fast start, gentle arrival

/** The point a fraction t (0..1) of the way from a to b, the short way round
 *  the antimeridian. Pure. */
export function between(a, b, t) {
    const k = ease(Math.max(0, Math.min(1, t)))
    let dl = b.lon - a.lon
    if (dl > 180) dl -= 360
    else if (dl < -180) dl += 360
    let lon = a.lon + dl * k
    if (lon > 180) lon -= 360
    else if (lon < -180) lon += 360
    return { lat: a.lat + (b.lat - a.lat) * k, lon }
}

/**
 * One gliding marker. set(target) starts a glide from where it is drawn now;
 * onFrame(pos) is called every animation frame while it moves (and once for
 * a jump). Everything it touches is passed in, so tests drive the clock.
 */
export function createGlide({
    onFrame = () => {},
    now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    raf = (f) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(f) : setTimeout(() => f(now()), 16)),
    caf = (id) => (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(id) : clearTimeout(id)),
} = {}) {
    let cur = null, from = null, to = null, t0 = 0, dur = 0, frame = null, lastSetAt = null

    function step() {
        frame = null
        if (!to) return
        const t = dur ? (now() - t0) / dur : 1
        cur = t >= 1 ? { ...to } : between(from, to, t)
        onFrame(cur)
        if (t < 1) frame = raf(step)
    }

    return {
        /** Move toward this point; `gapMs` — the time since the last fix — sets the pace. */
        set(target, gapMs) {
            if (!target || !Number.isFinite(+target.lat) || !Number.isFinite(+target.lon)) return
            const tg = { lat: +target.lat, lon: +target.lon }
            const t = now()
            const gap = gapMs ?? (lastSetAt == null ? MAX_GLIDE_MS : t - lastSetAt)
            lastSetAt = t
            if (!cur || metresBetween(cur, tg) > JUMP_M) {
                if (frame != null) { caf(frame); frame = null }
                cur = tg; from = tg; to = tg; dur = 0
                onFrame(cur)
                return
            }
            from = { ...cur }
            to = tg
            t0 = t
            dur = Math.max(MIN_GLIDE_MS, Math.min(MAX_GLIDE_MS, gap))
            if (frame == null) frame = raf(step)
        },
        position() { return cur },
        target() { return to },
        moving() { return frame != null },
        stop() { if (frame != null) caf(frame); frame = null },
    }
}

/** On a marker, under a name: just "live", or "last seen 4 min ago" —
 *  nothing more (owner, 2026-10-12: three lines under a name was too much). */
export function presence(atMs, nowMs = Date.now(), liveMs = LIVE_MS) {
    const f = freshness(atMs, nowMs, liveMs)
    return f.live ? "live" : f.label
}

/** "live · 3 s ago" / "last seen 4 min ago". atMs and nowMs in ms. */
export function freshness(atMs, nowMs = Date.now(), liveMs = LIVE_MS) {
    if (!Number.isFinite(atMs)) return { live: false, label: "no position yet", ageS: null }
    const age = Math.max(0, nowMs - atMs)
    const s = Math.round(age / 1000)
    const ago = s < 60 ? `${s} s ago`
        : s < 3600 ? `${Math.floor(s / 60)} min ago`
        : s < 86_400 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`
        : `${Math.floor(s / 86_400)} d ago`
    const live = age <= liveMs
    return { live, label: live ? `live · ${ago}` : `last seen ${ago}`, ageS: s }
}
