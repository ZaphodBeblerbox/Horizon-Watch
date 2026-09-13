// sw-recovery.js — real, one-time, version-gated recovery for browsers whose
// ALREADY-INSTALLED service worker predates the registerType:'prompt' fix
// (vite.config.js / src/main.jsx) and therefore has no client-side code
// capable of ever detecting or requesting an update on its own.
//
// Real root cause this fixes (Round 2 stale-registerSW.js investigation,
// confirmed via direct reproduction — install the pre-fix SW, ship the
// fixed build, observe): the OLD service worker precaches index.html via
// Workbox's NavigationRoute and serves it for every navigation straight
// from its own cache, never touching the network — so a plain reload of an
// already-open tab can NEVER see a new deploy. The browser's own
// registration.update() DOES correctly detect the new SW and puts it in
// "waiting" state, but with workbox.skipWaiting:false/clientsClaim:false
// (this app's real, deliberate config — see vite.config.js) nothing
// activates it, because the OLD tab is running OLD bundle JS with zero
// code to post the SKIP_WAITING message the new SW is waiting for. That
// old tab is stuck until every window/tab using it is closed — a real,
// non-trivial bar most users won't clear quickly, which is why the same
// startup failure recurred "every single time" rather than resolving.
//
// This file runs via workbox's own `importScripts` (vite.config.js) inside
// the SAME generated service worker, so it can act with zero cooperation
// from whatever JS the client's page happens to be running — reaching
// even a fully pre-fix tab that never loads this file's own containing
// bundle.
//
// Bounded, one-time, marker-gated — NOT a return to the original
// skipWaiting()/clientsClaim() race PR #58 moved away from:
//   - That race was "every future deploy's SW self-activates silently,
//     forever, so even a client that DOES try to detect and prompt for an
//     update can lose the race and never see its own onNeedRefresh fire."
//   - This code fires AT MOST ONCE per browser installation (persisted via
//     a dedicated Cache Storage marker, checked before doing anything),
//     and ONLY when self.registration.active was already truthy at
//     install time (i.e., a genuine previous worker is being replaced —
//     never on a real first-ever install, which has no previous worker to
//     race against and nothing to force-navigate away from). Once the
//     marker is set, every subsequent activation of every future SW is a
//     complete no-op here, permanently — control reverts entirely to the
//     existing, safe, visible, single-reload onNeedRefresh/postMessage/
//     controllerchange flow in src/main.jsx, exactly as PR #58 designed.
const RECOVERY_MARKER_CACHE = 'sw-recovery-v1'
const RECOVERY_MARKER_KEY = 'https://recovery.marker/done'

async function recoveryAlreadyDone() {
    try {
        const cache = await caches.open(RECOVERY_MARKER_CACHE)
        return !!(await cache.match(RECOVERY_MARKER_KEY))
    } catch {
        return true // fail safe: never force-navigate a real user's tab on an unexpected error
    }
}

async function markRecoveryDone() {
    try {
        const cache = await caches.open(RECOVERY_MARKER_CACHE)
        await cache.put(RECOVERY_MARKER_KEY, new Response('done'))
    } catch { /* best-effort — worst case this runs one extra time */ }
}

// A real previous worker exists only on a genuine update, never on this
// scope's first-ever install — the standard, documented signal for
// distinguishing the two from inside the service worker itself.
const isRealUpdate = !!self.registration.active

self.addEventListener('install', (event) => {
    if (!isRealUpdate) return
    event.waitUntil((async () => {
        if (await recoveryAlreadyDone()) return
        self.skipWaiting()
    })())
})

self.addEventListener('activate', (event) => {
    if (!isRealUpdate) return
    event.waitUntil((async () => {
        if (await recoveryAlreadyDone()) return
        await markRecoveryDone()
        await self.clients.claim()
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of allClients) {
            try { client.navigate(client.url) } catch { /* client may have closed mid-loop */ }
        }
    })())
})
