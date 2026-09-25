/**
 * The machine has to hold the whole reference picture, not just the parts
 * the user happened to open while online.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { seedOffline, seedStamp, SEED_SET, WHOLE_DATASET_PATHS, RESEED_AFTER_MS } from "./offlineSeed.js"
import { memoryStore, lookup } from "./offlineCache.js"

const API = "https://api.example.com"
const ok = (body) => new Response(body, {
    status: 200, headers: { "Content-Type": "application/json" },
})

describe("the seed set", () => {
    it("covers the reference layers a user expects offline", () => {
        const keys = SEED_SET.map((d) => d.key)
        for (const k of ["airports", "ports", "cables", "chokepoints", "zones", "alerts", "signals"]) {
            expect(keys).toContain(k)
        }
    })

    it("does not seed live tracks, which would be stale and misleading", () => {
        const paths = SEED_SET.map((d) => d.path).join(" ")
        expect(paths).not.toMatch(/aircraft|adsb|vessels|ais/i)
    })

    it("fetches the cheap datasets before the expensive ones", () => {
        const sizes = SEED_SET.map((d) => d.approxKB)
        expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    })
})

describe("seeding", () => {
    let store
    beforeEach(() => { store = memoryStore() })

    it("stores every dataset under the URL the app will ask for", async () => {
        const r = await seedOffline({
            apiBase: API, store, fetchImpl: async () => ok('{"ok":true}'),
        })
        expect(r.ran).toBe(true)
        expect(r.failed).toEqual([])
        for (const d of SEED_SET) {
            expect(await store.get(`${API}${d.path}`)).toBeTruthy()
        }
    })

    it("keeps going when one dataset fails", async () => {
        // A machine with airports but no cables beats one with neither.
        const r = await seedOffline({
            apiBase: API, store,
            fetchImpl: async (u) => {
                if (u.includes("/api/cables")) throw new TypeError("Failed to fetch")
                return ok("{}")
            },
        })
        expect(r.done.length).toBe(SEED_SET.length - 1)
        expect(r.failed).toHaveLength(1)
        expect(r.failed[0].key).toBe("cables")
    })

    it("does not store an error response as if it were data", async () => {
        const r = await seedOffline({
            apiBase: API, store,
            fetchImpl: async () => new Response("nope", { status: 500 }),
        })
        expect(r.done).toEqual([])
        expect(await store.get(`${API}/api/cables`)).toBeUndefined()
    })

    it("does not re-download on every launch", async () => {
        let calls = 0
        const f = async () => { calls++; return ok("{}") }
        await seedOffline({ apiBase: API, store, fetchImpl: f, now: () => 1000 })
        const first = calls
        await seedOffline({ apiBase: API, store, fetchImpl: f, now: () => 1000 + 60_000 })
        expect(calls).toBe(first)
    })

    it("re-seeds once the data is old enough", async () => {
        let calls = 0
        const f = async () => { calls++; return ok("{}") }
        await seedOffline({ apiBase: API, store, fetchImpl: f, now: () => 1000 })
        const first = calls
        await seedOffline({ apiBase: API, store, fetchImpl: f, now: () => 1000 + RESEED_AFTER_MS + 1 })
        expect(calls).toBeGreaterThan(first)
    })

    it("retries next launch when the whole attempt failed", async () => {
        // A totally failed run must not suppress retries for six hours.
        let calls = 0
        const bad = async () => { calls++; throw new TypeError("offline") }
        await seedOffline({ apiBase: API, store, fetchImpl: bad, now: () => 1000 })
        expect(await seedStamp(store)).toBe(null)
        const before = calls
        await seedOffline({ apiBase: API, store, fetchImpl: bad, now: () => 1000 })
        expect(calls).toBeGreaterThan(before)
    })
})

describe("serving a seeded dataset for a different query", () => {
    it("answers ?limit=5000 from the seeded ?limit=9000 airports", async () => {
        const store = memoryStore()
        await store.set(`${API}/api/airports?limit=9000`, { body: '{"features":[1]}', at: 1 })
        const hit = await lookup(store, `${API}/api/airports?limit=5000`, WHOLE_DATASET_PATHS)
        expect(hit?.body).toBe('{"features":[1]}')
    })

    it("refuses to answer a filtered endpoint with the whole set", async () => {
        // Answering ?country=FR with every country is not close enough,
        // it is wrong. Only declared whole datasets take part.
        const store = memoryStore()
        await store.set(`${API}/api/alerts?limit=500`, { body: "[]", at: 1 })
        const hit = await lookup(store, `${API}/api/alerts?country=FR`, WHOLE_DATASET_PATHS)
        expect(hit).toBe(null)
    })

    it("prefers an exact match over a sibling", async () => {
        const store = memoryStore()
        await store.set(`${API}/api/ports?x=1`, { body: '"sibling"', at: 1 })
        await store.set(`${API}/api/ports`, { body: '"exact"', at: 1 })
        const hit = await lookup(store, `${API}/api/ports`, WHOLE_DATASET_PATHS)
        expect(hit.body).toBe('"exact"')
    })
})

describe("where the seed is allowed to run", () => {
    it("is gated to the desktop build in main.jsx", async () => {
        // A browser tab is online by definition; if it were not, the page
        // would not have loaded. Seeding there only cost the server 23 MB
        // and 49,000 serialised airports per visitor.
        const { readFileSync } = await import("node:fs")
        const src = readFileSync("src/main.jsx", "utf8")
        const call = src.slice(src.indexOf("seedOffline"))
        expect(src).toMatch(/if \(isDesktop\(\)\) \{/)
        // The guard must come before the call, not after it.
        expect(src.indexOf("if (isDesktop()) {")).toBeLessThan(src.indexOf("seedOffline({"))
        expect(call).toBeTruthy()
    })
})
