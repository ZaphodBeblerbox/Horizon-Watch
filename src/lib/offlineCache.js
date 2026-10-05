/**
 * offlineCache.js — the app keeps working when the server does not.
 *
 * WHY THIS IS AN INTERCEPTOR AND NOT AN API CLIENT. There are 336 raw
 * fetch() calls across 87 files. Routing them through a helper would be a
 * refactor touching almost every screen, and any call that was missed
 * would fail silently and only offline — the worst place for a gap.
 * Patching window.fetch once covers all of them, including any added
 * later, and needs no discipline from the call sites.
 *
 * WHAT IT DOES. Every successful GET to our own API is written to a local
 * store. When a later GET cannot reach the server — offline, DNS gone,
 * Railway restarting, a request that times out — the last good response
 * for that exact URL is returned instead, tagged so the UI can say it is
 * showing something old rather than pretending it is live.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 * - It never caches anything but GET. A POST that failed did not happen,
 *   and replaying one from a cache would invent an action the user did
 *   not take.
 * - It never serves a cached body in place of a real error. A 500 or a
 *   403 from a server that answered is the truth and goes through
 *   untouched; only a request that reached nobody falls back.
 * - It never fabricates freshness. A served-from-cache response carries
 *   X-Parallax-Cache: hit and X-Parallax-Cached-At, and callers that care
 *   can read them.
 *
 * The store is behind an interface because the desktop build will move to
 * an encrypted SQLite file; IndexedDB is what works in every surface
 * today, including inside the Tauri webview, without a Rust dependency.
 */

const DB_NAME = "parallax-cache"
const STORE = "responses"
/** How long a cached body may still be served. Matches the 12-24h brief. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Give up on the network this fast before falling back to the cache. */
/**
 * How long to wait before falling back to cache.
 *
 * 30s, not 12. A MACHINE THAT IS ACTUALLY OFFLINE DOES NOT HIT THIS: the
 * connection fails immediately and fetch rejects, cache kicks in, nobody
 * waits. This deadline only applies to a server that accepted the
 * connection and then took its time — and one of this app's own endpoints
 * (/api/reports/tasks/snapshot) legitimately takes ten seconds, which at
 * 12s meant anything queued behind it on the browser's six connections
 * was killed mid-flight. Analytics failed to load for exactly that
 * reason, on a request the server answered in under two seconds.
 */
export const NETWORK_TIMEOUT_MS = 30000

export const CACHE_HEADER = "X-Parallax-Cache"
export const CACHED_AT_HEADER = "X-Parallax-Cached-At"

/** Fired whenever a response is served from the cache, or live again. */
export const CACHE_EVENT = "parallax:cache-state"

// ── storage ─────────────────────────────────────────────────────────────

/** IndexedDB-backed store. Swappable — see the module docstring. */
export function indexedDbStore(indexedDB) {
    let dbp = null
    const open = () => {
        if (dbp) return dbp
        dbp = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        return dbp
    }
    const tx = async (mode, fn) => {
        const db = await open()
        return new Promise((resolve, reject) => {
            const t = db.transaction(STORE, mode)
            const req = fn(t.objectStore(STORE))
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
    }
    return {
        get: (key) => tx("readonly", (s) => s.get(key)),
        set: (key, value) => tx("readwrite", (s) => s.put(value, key)),
        keys: () => tx("readonly", (s) => s.getAllKeys()),
        del: (key) => tx("readwrite", (s) => s.delete(key)),
    }
}

/** In-memory store — used by tests, and as the fallback when IndexedDB
 *  is unavailable (private windows, a webview with storage disabled). */
export function memoryStore() {
    const m = new Map()
    return {
        get: async (k) => m.get(k),
        set: async (k, v) => void m.set(k, v),
        keys: async () => [...m.keys()],
        del: async (k) => void m.delete(k),
    }
}

// ── policy ──────────────────────────────────────────────────────────────

/** Only our own API, only GET, and never a streaming or auth-changing one. */
export function isCacheable(method, url, apiBase) {
    if ((method || "GET").toUpperCase() !== "GET") return false
    if (!url || !apiBase) return false
    if (!String(url).startsWith(apiBase)) return false
    // Server-sent events and long-polls have no meaningful "last value",
    // and replaying one would hang a consumer waiting for a stream.
    if (/\/(stream|sse|events\/live|ws)(\/|\?|$)/.test(url)) return false
    return true
}

// ── the interceptor ─────────────────────────────────────────────────────

/**
 * Find a cached entry for this URL, falling back to a seeded copy of the
 * same whole-dataset path requested with different query params.
 *
 * WHY THE FALLBACK IS NARROW. The seed stores /api/airports?limit=9000;
 * a screen might ask for ?limit=5000. Refusing that would leave the layer
 * empty with 18 MB of airports sitting on disk. But the same reasoning
 * applied to a FILTERED endpoint would be a lie — answering
 * ?country=FR with every country is not "close enough", it is wrong. So
 * only paths explicitly declared whole datasets participate, and the
 * query string is ignored for those alone.
 */
export async function lookup(store, url, wholePaths = []) {
    let entry = null
    try { entry = await store.get(url) } catch { entry = null }
    if (entry) return entry
    const path = String(url).split("?")[0]
    if (!wholePaths.some((p) => path.endsWith(p))) return null
    let keys = []
    try { keys = await store.keys() } catch { return null }
    const sibling = keys.find((k) => String(k).split("?")[0] === path)
    if (!sibling) return null
    try { return (await store.get(sibling)) || null } catch { return null }
}

export function installOfflineCache({
    win = typeof window !== "undefined" ? window : undefined,
    apiBase,
    store,
    maxAgeMs = MAX_AGE_MS,
    timeoutMs = NETWORK_TIMEOUT_MS,
    wholePaths = [],
    now = () => Date.now(),
} = {}) {
    if (!win || typeof win.fetch !== "function" || !apiBase) return () => {}
    if (win.__parallaxCacheInstalled) return win.__parallaxCacheUninstall || (() => {})

    const backing = store
        || (win.indexedDB ? indexedDbStore(win.indexedDB) : memoryStore())
    const native = win.fetch.bind(win)
    let lastState = null

    /* Writes are fire-and-forget (see the success path below), which makes
       the cache eventually-consistent: a response is served to the caller
       before its copy has landed on disk. That is the right trade for a
       request, and it is a real part of the contract, so it is observable
       rather than implied — `whenCacheIdle()` resolves once every write
       issued so far has settled. Tests await it instead of sleeping, and
       anything that needs the cache durable before teardown can too. */
    const pending = new Set()
    const track = (promise) => {
        pending.add(promise)
        promise.finally(() => pending.delete(promise))
        return promise
    }
    const whenIdle = async () => {
        while (pending.size) await Promise.allSettled([...pending])
    }
    win.__parallaxCacheIdle = whenIdle

    const announce = (state, at) => {
        if (state === lastState) return
        lastState = state
        try {
            win.dispatchEvent(new CustomEvent(CACHE_EVENT, {
                detail: { state, cachedAt: at ?? null },
            }))
        } catch { /* a webview without CustomEvent must not break fetch */ }
    }

    const patched = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input?.url
        const method = init.method || (typeof input === "object" && input?.method) || "GET"

        if (!isCacheable(method, url, apiBase)) return native(input, init)

        // A request with no deadline cannot fall back: it just hangs, which
        // is what a dead server looks like from inside the app today.
        const ctl = typeof AbortController === "function" ? new AbortController() : null
        // Records that WE gave up, as distinct from the caller cancelling.
        // Without this the two are indistinguishable downstream, and the
        // only thing a caller can show is the browser's own wording.
        let timedOut = false
        const timer = ctl && timeoutMs
            ? setTimeout(() => { timedOut = true; try { ctl.abort() } catch { /* already gone */ } }, timeoutMs)
            : null
        try {
            const res = await native(input, ctl ? { ...init, signal: init.signal || ctl.signal } : init)
            if (timer) clearTimeout(timer)
            if (res.ok) {
                /* THE WRITE DOES NOT BLOCK THE RESPONSE.
                   This used to `await res.clone().text()` and `await
                   backing.set(...)` before returning, so every caller's
                   fetch was gated on an IndexedDB round-trip finishing.
                   When that write stalled — and under concurrent writes it
                   does — the response never reached the caller even though
                   it had arrived. Measured: /api/surface completed on the
                   wire at 13.3s and the Home screen's `.then` never ran at
                   all, which is why Home sat at zero signals with a healthy
                   200 in the network panel.

                   Caching is a side effect of the request, not a step in
                   it. The clone is taken synchronously (the body is a
                   one-shot stream, so it must be claimed before the caller
                   reads it) and drained on its own time. A cache that
                   fails to write costs a cache miss later; a cache that
                   hangs costs the feature. */
                const copy = res.clone()
                const contentType = res.headers.get("content-type") || "application/json"
                track((async () => {
                    try {
                        await backing.set(url, { body: await copy.text(), at: now(), contentType })
                    } catch { /* a full disk must not fail the request */ }
                })())
                announce("live")
            }
            return res
        } catch (err) {
            if (timer) clearTimeout(timer)
            const entry = await lookup(backing, url, wholePaths)
            if (!entry || (now() - entry.at) > maxAgeMs) {
                // Nothing usable. Re-throw rather than handing back an
                // empty 200, which would read to every caller as "the
                // server says there is nothing".
                announce("offline-empty")
                // BUT NOT THE RAW AbortError. Its message is "signal is
                // aborted without reason", which callers put straight on
                // screen — Analytics showed exactly that string to the
                // user. A timeout has a reason and can say it.
                if (timedOut) {
                    const e = new Error(`the server did not respond within ${Math.round(timeoutMs / 1000)}s`)
                    e.name = "TimeoutError"
                    e.cause = err
                    throw e
                }
                throw err
            }
            announce("cached", entry.at)
            return new Response(entry.body, {
                status: 200,
                headers: {
                    "Content-Type": entry.contentType || "application/json",
                    [CACHE_HEADER]: "hit",
                    [CACHED_AT_HEADER]: new Date(entry.at).toISOString(),
                },
            })
        }
    }

    win.fetch = patched
    win.__parallaxCacheInstalled = true
    const uninstall = () => {
        win.fetch = native
        win.__parallaxCacheInstalled = false
    }
    win.__parallaxCacheUninstall = uninstall
    uninstall.whenIdle = whenIdle
    return uninstall
}

/** Drop entries past their usable age. Called on launch. */
export async function pruneCache(store, { maxAgeMs = MAX_AGE_MS, now = () => Date.now() } = {}) {
    let keys = []
    try { keys = await store.keys() } catch { return 0 }
    let dropped = 0
    for (const k of keys) {
        try {
            const e = await store.get(k)
            if (!e || (now() - e.at) > maxAgeMs) { await store.del(k); dropped++ }
        } catch { /* one bad row must not stop the sweep */ }
    }
    return dropped
}
