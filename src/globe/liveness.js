/**
 * liveness.js — making the map read as a living surface, honestly.
 *
 * THE PRINCIPLE. Motion is the scarcest attention resource on a screen:
 * the eye goes to whatever moves, so if everything moves nothing reads as
 * significant and the tool becomes a screensaver. Motion is spent here
 * only on CHANGE — the same rule the notification store already states
 * for cards, applied to the map.
 *
 * WHAT MAKES A MAP FEEL ALIVE IS NOT ANIMATION, IT IS RECENCY. A map
 * where a report from four minutes ago looks exactly like one from
 * yesterday is a map of an archive, however much it wiggles. Fading a
 * mark with its age costs no motion at all, works while the analyst is
 * reading rather than only at the moment of arrival, and answers the
 * question they actually have — "is this still happening?"
 *
 * The floor matters as much as the decay: an old mark dims but never
 * disappears, because "too old to highlight" is not "untrue".
 */

/** Below this, a mark is at full weight — it is happening now. */
export const FRESH_MINUTES = 30

/** Past this, a mark sits at the floor and dims no further. */
export const STALE_HOURS = 24

/** Never fade below this: dim is a statement about age, not about truth. */
export const MIN_ALPHA = 0.35


/**
 * How much weight a mark of this age deserves, 0.35 to 1.
 *
 * Linear in log time rather than in time: the difference between five
 * minutes and an hour matters enormously, and the difference between
 * eighteen hours and nineteen matters not at all, so a linear ramp
 * spends all its resolution in the wrong place.
 */
export function recencyAlpha(tsMs, nowMs = Date.now()) {
    if (!Number.isFinite(tsMs)) return 1          // unknown age is not old age
    const minutes = Math.max(0, (nowMs - tsMs) / 60000)
    if (minutes <= FRESH_MINUTES) return 1
    const staleMinutes = STALE_HOURS * 60
    if (minutes >= staleMinutes) return MIN_ALPHA
    const t = Math.log(minutes / FRESH_MINUTES) / Math.log(staleMinutes / FRESH_MINUTES)
    return Math.max(MIN_ALPHA, 1 - t * (1 - MIN_ALPHA))
}


/**
 * Did this arrive while the analyst was watching?
 *
 * The distinction the whole idea rests on. A mark that was already there
 * when the page opened is history and must not pulse — that is the
 * "shouts at every event" failure in visual form, and it trains people
 * to ignore the map. Only what lands during the session is an arrival.
 */
export function makeArrivalTracker() {
    let seeded = false
    const seen = new Set()
    return {
        /** Returns the ids that are NEW, and records everything. */
        arrivals(ids) {
            const fresh = []
            for (const id of ids) {
                if (!seen.has(id)) {
                    seen.add(id)
                    if (seeded) fresh.push(id)
                }
            }
            seeded = true
            return fresh
        },
        isSeeded() { return seeded },
    }
}


/** How long an arrival stays highlighted before settling in. */
export const ARRIVAL_MS = 20000

/**
 * A size multiplier for a mark that just arrived: brief, bounded, and
 * over. It decays to 1 rather than flashing on a timer, so the map
 * settles by itself and nothing is left permanently emphasised.
 */
export function arrivalScale(arrivedAtMs, nowMs = Date.now()) {
    if (!Number.isFinite(arrivedAtMs)) return 1
    const t = (nowMs - arrivedAtMs) / ARRIVAL_MS
    if (t <= 0) return 1.6
    if (t >= 1) return 1
    // Ease out: most of the emphasis is spent in the first few seconds,
    // which is when a person is most likely to still be looking.
    return 1 + 0.6 * (1 - t) ** 2
}
