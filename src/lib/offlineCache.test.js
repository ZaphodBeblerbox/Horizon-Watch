/**
 * The app has to keep working when the server does not.
 *
 * These pin the behaviour that is easy to get subtly wrong: a cached body
 * must never stand in for a real error, a POST must never be replayed,
 * and an empty cache must fail loudly rather than look like "the server
 * says there is nothing".
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
    installOfflineCache, memoryStore, isCacheable, pruneCache,
    CACHE_HEADER, MAX_AGE_MS,
} from "./offlineCache.js"

const API = "https://api.example.com"

function fakeWindow(fetchImpl) {
    return {
        fetch: fetchImpl,
        dispatchEvent: () => true,
        indexedDB: null,
    }
}

const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
        status, headers: { "Content-Type": "application/json" },
    })

describe("what is cacheable", () => {
    it("caches GETs to our own API", () => {
        expect(isCacheable("GET", `${API}/api/signals`, API)).toBe(true)
    })
    it("never caches a write", () => {
        expect(isCacheable("POST", `${API}/api/signals`, API)).toBe(false)
        expect(isCacheable("DELETE", `${API}/api/signals/1`, API)).toBe(false)
    })
    it("never caches somebody else's host", () => {
        expect(isCacheable("GET", "https://tiles.example.org/x.png", API)).toBe(false)
    })
    it("never caches a stream, which has no last value", () => {
        expect(isCacheable("GET", `${API}/api/stream`, API)).toBe(false)
    })
})

describe("serving from cache", () => {
    let store
    beforeEach(() => { store = memoryStore() })

    it("returns the last good body when the server cannot be reached", async () => {
        let online = true
        const win = fakeWindow(async () => {
            if (!online) throw new TypeError("Failed to fetch")
            return json({ signals: ["a", "b"] })
        })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })

        const live = await win.fetch(`${API}/api/signals`)
        expect((await live.json()).signals).toEqual(["a", "b"])
        expect(live.headers.get(CACHE_HEADER)).toBe(null)

        online = false
        const cached = await win.fetch(`${API}/api/signals`)
        expect(cached.headers.get(CACHE_HEADER)).toBe("hit")
        expect((await cached.json()).signals).toEqual(["a", "b"])
    })

    it("passes a real error response straight through", async () => {
        // A 403 from a server that answered is the truth. Replacing it
        // with a stale 200 would show data the user may no longer have
        // access to.
        const win = fakeWindow(async () => json({ detail: "forbidden" }, 403))
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        const res = await win.fetch(`${API}/api/signals`)
        expect(res.status).toBe(403)
        expect(res.headers.get(CACHE_HEADER)).toBe(null)
    })

    it("does not cache an error response for later", async () => {
        let mode = "error"
        const win = fakeWindow(async () => {
            if (mode === "error") return json({ detail: "boom" }, 500)
            throw new TypeError("Failed to fetch")
        })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        await win.fetch(`${API}/api/signals`)
        mode = "offline"
        await expect(win.fetch(`${API}/api/signals`)).rejects.toThrow()
    })

    it("fails loudly when there is nothing cached", async () => {
        // An empty 200 would read to every caller as "no results".
        const win = fakeWindow(async () => { throw new TypeError("Failed to fetch") })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        await expect(win.fetch(`${API}/api/never-seen`)).rejects.toThrow()
    })

    it("refuses a cached body that is older than the window", async () => {
        let t = 1_000_000
        let online = true
        const win = fakeWindow(async () => {
            if (!online) throw new TypeError("Failed to fetch")
            return json({ ok: true })
        })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0, now: () => t })
        await win.fetch(`${API}/api/signals`)
        online = false
        t += MAX_AGE_MS + 1
        await expect(win.fetch(`${API}/api/signals`)).rejects.toThrow()
    })

    it("never replays a write", async () => {
        let online = true
        const win = fakeWindow(async () => {
            if (!online) throw new TypeError("Failed to fetch")
            return json({ created: true })
        })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        await win.fetch(`${API}/api/scenarios`, { method: "POST" })
        online = false
        await expect(
            win.fetch(`${API}/api/scenarios`, { method: "POST" })
        ).rejects.toThrow()
    })

    it("keeps each URL separate", async () => {
        let online = true
        const win = fakeWindow(async (u) => {
            if (!online) throw new TypeError("Failed to fetch")
            return json({ which: String(u).endsWith("/a") ? "a" : "b" })
        })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        await win.fetch(`${API}/api/a`)
        await win.fetch(`${API}/api/b`)
        // The cache write no longer blocks the response — a stalled
        // IndexedDB write used to hang the caller's fetch forever. So wait
        // for the writes to settle rather than assuming they already have.
        await win.__parallaxCacheIdle()
        online = false
        expect((await (await win.fetch(`${API}/api/a`)).json()).which).toBe("a")
        expect((await (await win.fetch(`${API}/api/b`)).json()).which).toBe("b")
    })

    it("hands back the response without waiting for the cache write", async () => {
        /* THE REGRESSION THIS EXISTS FOR. The success path used to
           `await backing.set(...)` before returning, so every caller's
           fetch was gated on an IndexedDB round-trip. When a write stalled
           the response never reached the caller even though it had already
           arrived on the wire — measured in the running app as
           /api/surface completing in 3s while the Home screen's .then()
           never ran at all, leaving it reading "0 signals" against a
           healthy 200. It failed silently, with no error anywhere, which
           is exactly why it needs a test. */
        let release
        const stalled = new Promise((r) => { release = r })
        const slowStore = {
            get: async () => null,
            set: () => stalled,          // never settles until released
            keys: async () => [],
        }
        const win = fakeWindow(async () => json({ ok: true }))
        installOfflineCache({ win, apiBase: API, store: slowStore, timeoutMs: 0 })

        const res = await Promise.race([
            win.fetch(`${API}/api/slow`),
            new Promise((_, rej) => setTimeout(() => rej(new Error("fetch waited on the cache write")), 50)),
        ])
        expect((await res.json()).ok).toBe(true)
        release()
    })

    it("leaves other hosts alone entirely", async () => {
        const seen = []
        const win = fakeWindow(async (u) => { seen.push(u); return json({}) })
        installOfflineCache({ win, apiBase: API, store, timeoutMs: 0 })
        await win.fetch("https://tiles.example.org/1.png")
        expect(seen).toEqual(["https://tiles.example.org/1.png"])
    })

    it("installs only once", async () => {
        const win = fakeWindow(async () => json({}))
        const first = win.fetch
        installOfflineCache({ win, apiBase: API, store })
        const patched = win.fetch
        installOfflineCache({ win, apiBase: API, store })
        expect(win.fetch).toBe(patched)
        expect(win.fetch).not.toBe(first)
    })
})

describe("pruning", () => {
    it("drops only what is past the window", async () => {
        const store = memoryStore()
        await store.set("fresh", { body: "{}", at: 1000 })
        await store.set("stale", { body: "{}", at: 0 })
        const dropped = await pruneCache(store, { maxAgeMs: 500, now: () => 1200 })
        expect(dropped).toBe(1)
        expect(await store.get("fresh")).toBeTruthy()
        expect(await store.get("stale")).toBeUndefined()
    })
})
