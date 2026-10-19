/**
 * demoLive.js — following protests in near real time on the desktop
 * (owner, 2026-10-19: "We also have to make sure that the protest movements
 * can be followed in near real time in the desktop version").
 *
 * While something is under way — a protest starting, ongoing or dispersing,
 * a crowd reported in the last hour, a street report still current — the
 * demonstration layers (GlobeDemonstrationsLayer, GlobePoliceActionsLayer)
 * and an open protest card (inspector/ProtestDetail.jsx) read again every
 * LIVE_MS; when nothing is, every IDLE_MS, which costs next to nothing. The
 * server memoises these answers for everyone (demonstrations 30 s, the
 * situation's routing per pass, street reports 15 s), so a faster poll
 * never means more work there than one build per memo.
 *
 * One layer seeing something live speeds up the others too (markLive): a
 * march under way makes its street reports worth reading as often.
 */
export const LIVE_MS = 15_000
export const IDLE_MS = 120_000
const LIVE_HOLD_MS = 3 * 60_000          // a layer that saw something live keeps the others fast this long
const CROWD_LIVE_MIN = 60
const SOON_MIN = 30
export const LIVE_KEYS = new Set(["starting", "ongoing", "dispersing"])

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }
const arr = (v) => (Array.isArray(v) ? v : [])

let liveSeenAt = 0
/** A layer saw something under way. */
export function markLive(now = Date.now()) { liveSeenAt = now }
/** Did any layer, lately? */
export function recentlyLive(now = Date.now()) { return now - liveSeenAt < LIVE_HOLD_MS }
/** For tests. */
export function _resetLive() { liveSeenAt = 0 }

/** Is a protest under way, or about to start? */
export function protestLive(p, now = Date.now()) {
    const key = p?.status?.key
    if (LIVE_KEYS.has(key)) return true
    const start = ms(p?.starts_utc)
    return key === "planned" && Number.isFinite(start) && start - now <= SOON_MIN * 60_000 && start - now > -60 * 60_000
}

/** Does this answer (any of /api/routes/demonstrations, …/situation, …/street) show something under way? */
export function anyLive(data, now = Date.now()) {
    if (!data || typeof data !== "object") return false
    if (arr(data.protests).some((p) => protestLive(p, now))) return true
    for (const c of arr(data.cities)) {
        if (arr(c.crowds).some((g) => { const t = ms(g.at); return Number.isFinite(t) ? now - t <= CROWD_LIVE_MIN * 60_000 : Number(g.age_min) <= CROWD_LIVE_MIN })) return true
    }
    if (arr(data.reports).some((r) => {
        const t = ms(r.at)
        return Number.isFinite(t) && now - t <= Math.max(1, Number(r.valid_min) || 60) * 60_000
    })) return true
    return false
}

/** How long until the next read. */
export function nextPollMs(data, now = Date.now()) {
    if (anyLive(data, now)) { markLive(now); return LIVE_MS }
    return recentlyLive(now) ? LIVE_MS : IDLE_MS
}

/**
 * Read `url` now and again after nextPollMs(answer); at once when the window
 * comes back; never while it is hidden. onData(answer). Returns stop().
 */
export function livePoll(url, onData, { fetchImpl = (u) => fetch(u, { credentials: "include" }), win = typeof window !== "undefined" ? window : null } = {}) {
    let stopped = false
    let timer = null
    let last = null
    let loadedAt = 0
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden"
    const schedule = (wait) => {
        clearTimeout(timer)
        if (!stopped) timer = setTimeout(load, wait)
    }
    async function load() {
        if (stopped) return
        if (hidden()) { schedule(IDLE_MS); return }
        loadedAt = Date.now()
        try {
            const r = await fetchImpl(url)
            const d = r && r.ok ? await r.json() : null
            if (stopped) return
            if (d) { last = d; onData(d) }
        } catch { /* a dropped poll keeps what is on the map */ }
        schedule(nextPollMs(last))
    }
    // back on the window: read at once (once, though focus and visibility both say so)
    const back = () => { if (!hidden() && Date.now() - loadedAt > 2_000) { clearTimeout(timer); load() } }
    win?.addEventListener?.("focus", back)
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", back)
    load()
    return () => {
        stopped = true
        clearTimeout(timer)
        win?.removeEventListener?.("focus", back)
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", back)
    }
}
