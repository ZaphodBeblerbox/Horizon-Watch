/**
 * pollGuard.js — a poll that never piles up (2026-10-19).
 *
 * With three phones open the server fell behind, and every poller kept
 * firing on its timer regardless: a request that took 60 s was asked again
 * at 20 s and 40 s, so a slow server received two and three copies of the
 * same work from each phone (Railway's edge saw 60-115 requests in flight
 * from four clients). A guarded poll skips its turn while its previous
 * request is still out, and while the page is hidden.
 *
 * guardPoll(load) → tick(): call tick() from the timer; `load` must return
 * a promise. `tick.force()` runs even when hidden (a pull to refresh, the
 * page coming back), still never twice at once.
 */
export function guardPoll(load, isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden") {
    let inFlight = false
    const run = (force) => {
        if (inFlight) return Promise.resolve(false)
        if (!force && isHidden()) return Promise.resolve(false)
        inFlight = true
        let p
        try { p = Promise.resolve(load()) } catch (e) { p = Promise.reject(e) }
        return p.then(() => true, () => true).finally(() => { inFlight = false })
    }
    const tick = () => run(false)
    tick.force = () => run(true)
    tick.busy = () => inFlight
    return tick
}
