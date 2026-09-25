/**
 * offlineSeed.js — put the whole reference picture on the machine.
 *
 * WHY A CACHE WAS NOT ENOUGH. offlineCache.js keeps the last good response
 * for each URL the app has actually requested. That makes a screen you
 * visited while online work later, and does nothing at all for a screen
 * you did not. Opening the desktop app on a plane and finding no airports,
 * no ports and no cables — because you happened not to open those layers
 * before take-off — is indistinguishable from the app being broken.
 *
 * So the reference data is pulled deliberately, in full, whenever the app
 * is online, rather than as a side effect of browsing. It is written into
 * the same store under the same keys the interceptor reads, so nothing
 * else has to know this ran.
 *
 * WHAT IS SEEDED AND WHAT IS NOT. Reference data is stable, bounded and
 * worth ~23 MB on disk: airports, ports, cables, chokepoints, strategic
 * zones, the country risk index, and the recent signal and alert window.
 * Live tracks — aircraft and vessels — are deliberately excluded. A
 * position is only true for the minute it was observed, and a day-old
 * vessel track presented as the picture is worse than an empty layer,
 * because it invites a conclusion about where something is now.
 */

/**
 * The datasets, largest last so the cheap ones are available soonest.
 * `path` is stored exactly as the app requests it; `whole` marks a
 * dataset where the query string only ever narrows a complete set, which
 * is what makes the path-level fallback in offlineCache safe.
 */
export const SEED_SET = [
    { key: "signals",     path: "/api/signals/recent?limit=200", whole: false, approxKB: 11 },
    { key: "fusions",     path: "/api/fusions",                  whole: false, approxKB: 15 },
    { key: "zones",       path: "/api/strategic-zones",          whole: true,  approxKB: 18 },
    { key: "chokepoints", path: "/api/chokepoints",              whole: true,  approxKB: 18 },
    { key: "risk",        path: "/api/risk-index/countries",     whole: true,  approxKB: 67 },
    { key: "alerts",      path: "/api/alerts?limit=500",         whole: false, approxKB: 348 },
    { key: "cables",      path: "/api/cables",                   whole: true,  approxKB: 883 },
    { key: "ports",       path: "/api/ports",                    whole: true,  approxKB: 3113 },
    { key: "airports",    path: "/api/airports?limit=9000",      whole: true,  approxKB: 18649 },
]

/** Paths whose cached copy may answer a request with different query
 *  params. Only whole-dataset endpoints, where the query narrows rather
 *  than changes what is returned. */
export const WHOLE_DATASET_PATHS = SEED_SET
    .filter((d) => d.whole)
    .map((d) => d.path.split("?")[0])

export const SEED_EVENT = "parallax:seed"
const STAMP_KEY = "parallax.seed.stamp"
/** Re-seed at most this often; reference data does not move hourly. */
export const RESEED_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * Pull every dataset into `store`. Sequential on purpose: this competes
 * with the app's own startup requests, and firing 9 multi-megabyte
 * downloads at once makes the first screen slower for a benefit the user
 * cannot see yet.
 */
export async function seedOffline({
    apiBase, store, fetchImpl, now = () => Date.now(),
    emit = () => {}, force = false, reseedAfterMs = RESEED_AFTER_MS,
} = {}) {
    if (!apiBase || !store) return { ran: false, reason: "not configured" }
    const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null)
    if (!doFetch) return { ran: false, reason: "no fetch" }

    if (!force) {
        let stamp = null
        try { stamp = await store.get(STAMP_KEY) } catch { stamp = null }
        if (stamp?.at && (now() - stamp.at) < reseedAfterMs) {
            return { ran: false, reason: "recent", at: stamp.at }
        }
    }

    const done = [], failed = []
    for (const d of SEED_SET) {
        const url = `${apiBase}${d.path}`
        emit({ phase: "fetching", key: d.key, done: done.length, total: SEED_SET.length })
        try {
            const res = await doFetch(url, { credentials: "include" })
            if (!res.ok) { failed.push({ key: d.key, status: res.status }); continue }
            const body = await res.text()
            await store.set(url, {
                body, at: now(),
                contentType: res.headers.get("content-type") || "application/json",
            })
            done.push(d.key)
        } catch (e) {
            // One dataset failing must not abandon the rest — a machine
            // with airports but no cables is far better than neither.
            failed.push({ key: d.key, error: String(e?.message || e) })
        }
    }

    // Only stamp a run that achieved something, so a wholly failed attempt
    // is retried on the next launch rather than suppressed for six hours.
    if (done.length) {
        try { await store.set(STAMP_KEY, { at: now(), done, failed }) } catch { /* full disk */ }
    }
    emit({ phase: "done", done: done.length, total: SEED_SET.length, failed })
    return { ran: true, done, failed }
}

/** When the local copy was last refreshed, for the UI to show plainly. */
export async function seedStamp(store) {
    try { return (await store.get(STAMP_KEY)) || null } catch { return null }
}
