// staleChunkRecovery.js — real resilience for the stale-chunk-404 class of
// bug (a deploy replaces this app's hashed JS/CSS files while a user's
// browser still holds an older index.html/service-worker cache
// referencing an old hash that no longer exists on the server). The real
// root cause is fixed in main.jsx (real SW update-check wiring) and
// vite.config.js (injectRegister:false) — this is the safety net for
// everything in between: any dynamic import() (React.lazy chunks) or
// script/link tag that still fails despite that fix, or during the window
// before it does. Real, single, shared guard — used by main.jsx's
// window.onerror/onunhandledrejection AND the capture-phase resource
// error listener below, never a second parallel implementation.
const FLAG = 'hw-stale-chunk-reload-attempted'

// Real, distinct error-message patterns bundlers/browsers actually use for
// this failure class — not a guess. Vite/Rollup's dynamic-import failure
// message; the message Firefox/Safari/Chromium use for a failed static
// import; and a bare 404 message some environments surface for the
// underlying network request.
const STALE_CHUNK_PATTERNS = [
    /failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /importing a module script failed/i,
    /Loading chunk [\w-]+ failed/i,
]

export function isStaleChunkError(message) {
    if (!message) return false
    return STALE_CHUNK_PATTERNS.some((re) => re.test(message))
}

/**
 * Drop every cache and service worker this origin holds.
 *
 * A PLAIN RELOAD CANNOT FIX THIS and shipping one that tried was the
 * bug. When a service worker is serving a precached index.html, the
 * reload is answered by that same worker with that same HTML, pointing
 * at the same hashed bundle the deploy no longer has — which is exactly
 * what production reported: "failed to load even after a reload".
 *
 * Unregistering the worker and emptying the caches is the only thing
 * that makes the next navigation reach the network. It costs a cold
 * load, which is the correct price for a page that currently cannot
 * start at all.
 */
export async function purgeCachesAndWorkers() {
    const done = { caches: 0, workers: 0 }
    try {
        if (typeof caches !== 'undefined') {
            const keys = await caches.keys()
            await Promise.all(keys.map((k) => caches.delete(k)))
            done.caches = keys.length
        }
    } catch { /* storage blocked — the unregister below may still help */ }
    try {
        if (navigator.serviceWorker?.getRegistrations) {
            const regs = await navigator.serviceWorker.getRegistrations()
            await Promise.all(regs.map((r) => r.unregister()))
            done.workers = regs.length
        }
    } catch { /* nothing more to try */ }
    return done
}

/** Guarded one-time recovery — never a loop.
 *
 * The first failure purges the worker and caches and then reloads,
 * because the overwhelmingly likely cause is a stale precached shell
 * and a bare reload demonstrably does not clear it. If the failure
 * recurs after that, the deploy itself is broken and no amount of
 * reloading is going to help, so it says so and stops.
 *
 * Returns true if it handled the error, so callers can suppress their
 * own further handling. */
export function reloadOnceForStaleChunk(message) {
    if (!isStaleChunkError(message)) return false
    let alreadyAttempted = false
    try { alreadyAttempted = sessionStorage.getItem(FLAG) === '1' } catch { /* private mode */ }
    if (alreadyAttempted) {
        console.error('[stale-chunk] already purged caches and reloaded this session and the failure recurred — this is a broken deploy, not staleness; not retrying again.')
        return true
    }
    try { sessionStorage.setItem(FLAG, '1') } catch { /* private mode — recovery still proceeds, just without the loop guard */ }
    console.warn('[stale-chunk] detected a stale hashed-asset load failure — clearing service workers and caches, then reloading.')
    purgeCachesAndWorkers()
        .then((done) => console.warn(`[stale-chunk] cleared ${done.caches} cache(s) and ${done.workers} worker(s)`))
        .finally(() => window.location.reload())
    return true
}

// Note: a failed STATIC <script src="..."> tag (e.g. this app's own entry
// bundle 404ing because index.html itself was served stale) fires a DOM
// `error` EVENT on that element, not a JS runtime error or a rejected
// promise — window.onerror/onunhandledrejection above never see it. That
// case is handled by a small, deliberately-duplicated inline script in
// index.html itself (same sessionStorage key, same one-time-reload guard,
// kept in sync rather than genuinely parallel) — it has to be inline and
// dependency-free, since if the entry bundle that contains THIS file never
// loads, none of this module's code runs either. This file only ever
// needs to handle failures from code that's already running (a rejected
// dynamic import() from React.lazy, surfaced as an unhandled rejection).
