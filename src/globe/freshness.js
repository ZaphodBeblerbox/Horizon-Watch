/**
 * freshness.js — how old a demonstration's mark may look, and when it goes.
 * One rule for the globe and the phone (policeActions.js, demoSituation.js,
 * demonstrations.js, mobile/mapLayers.js) and the lists (Desk, Home,
 * notifications), the clients' guard behind backend/demo_freshness.py.
 *
 * The owner, 2026-10-19:
 *   "the police interventions at Châtelet were dimmer than the other icons,
 *    although they happened literally 1 hour ago. That shouldn't happen."
 *     → a mark of the last FRESH_MIN is never dimmed: full strength, like
 *       every other icon on the map. Only after that does it ease, never
 *       below FLOOR, so a mark of this morning still reads.
 *   "I don't want to know about demonstrations that happened 24 hours ago
 *    unless it's in a statistic."
 *     → a demonstration's item whose LAST ACTIVITY is over MAX_AGE_H old is
 *       gone from the map, the lists and the cards (counts and trends are
 *       the server's statistics and keep it).
 *
 * Keep demoStale() the same as backend/demo_freshness.py stale().
 */
export const FRESH_MIN = 180           // the last three hours: never dimmed
export const MAX_AGE_H = 24            // older: not on the map, in a list or a card
export const FLOOR = 0.55              // the faintest a mark gets before it goes

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** A mark's strength by age (minutes): 1 for the last FRESH_MIN, then down to FLOOR at `maxMin`; 0 past it. */
export function freshAlpha(ageMin, maxMin = MAX_AGE_H * 60) {
    const a = Number(ageMin)
    if (!Number.isFinite(a) || a <= FRESH_MIN) return 1
    if (a > maxMin) return 0
    const span = Math.max(1, maxMin - FRESH_MIN)
    return Math.max(FLOOR, 1 - ((1 - FLOOR) * (a - FRESH_MIN)) / span)
}

const DEMO_KINDS = new Set(["street_report", "protest", "demonstration", "police_action", "demo_crowd", "protest_track",
                            "intent", "at", "announcement"])
const DEMO_SIGNAL_KINDS = new Set(["street_report", "intent", "at"])
const TIME_KEYS = ["last_at", "at", "last_report_at", "posted_at", "until", "starts_utc", "starts_at", "created_at", "published_at"]

/** A demonstration's item: unrest, a street report, a protest, a call or a position, a crowd, footage from the ground. */
export function isDemoItem(x) {
    if (!x || typeof x !== "object") return false
    if (String(x.category || "").toLowerCase() === "unrest" || String(x.event_type || "").toLowerCase() === "unrest") return true
    if (x.street_report || x.on_ground) return true
    if (DEMO_SIGNAL_KINDS.has(String(x.signal_kind || ""))) return true
    return DEMO_KINDS.has(String(x.kind || ""))
}

/** The newest of the item's own times (its status's and its call's too), ms, or NaN. */
export function lastActivity(x) {
    const ts = TIME_KEYS.map((k) => ms(x?.[k]))
    for (const s of [x?.status, x?.protest_status]) {
        if (s && typeof s === "object") ts.push(...["last_report_at", "until", "since", "starts_utc"].map((k) => ms(s[k])))
    }
    if (x?.intent && typeof x.intent === "object") ts.push(ms(x.intent.starts_utc))
    const ok = ts.filter(Number.isFinite)
    return ok.length ? Math.max(...ok) : NaN
}

/** Is this a demonstration's item whose last activity is over MAX_AGE_H old? No time at all: kept. */
export function demoStale(x, now = Date.now(), maxAgeH = MAX_AGE_H) {
    if (!isDemoItem(x)) return false
    const t = lastActivity(x)
    return Number.isFinite(t) && now - t > maxAgeH * 3_600_000
}

/** The items still worth showing. */
export function dropStaleDemos(list, now = Date.now()) {
    return (Array.isArray(list) ? list : []).filter((x) => !demoStale(x, now))
}
