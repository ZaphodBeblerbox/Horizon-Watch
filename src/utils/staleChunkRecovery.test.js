/**
 * The recovery that production proved was not recovering.
 *
 * The field report was "failed to load even after a reload", which is
 * the signature of a service worker answering the reload with the same
 * stale precached shell. These tests pin the behaviour that actually
 * clears it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { isStaleChunkError, purgeCachesAndWorkers } from "./staleChunkRecovery.js"

describe("isStaleChunkError", () => {
    it("recognises the messages bundlers really emit", () => {
        for (const m of [
            "Failed to fetch dynamically imported module: https://x/assets/index-6w3TKMYA.js",
            "error loading dynamically imported module",
            "Importing a module script failed.",
            "Loading chunk vendor-abc failed",
        ]) expect(isStaleChunkError(m)).toBe(true)
    })

    it("does not fire on unrelated errors", () => {
        for (const m of ["TypeError: x is not a function", "NetworkError", "", null, undefined])
            expect(isStaleChunkError(m)).toBe(false)
    })
})

describe("purgeCachesAndWorkers", () => {
    beforeEach(() => {
        vi.unstubAllGlobals()
    })

    it("deletes every cache and unregisters every worker", async () => {
        const deleted = []
        const unregistered = []
        vi.stubGlobal("caches", {
            keys: async () => ["precache-v1", "static-api-cache"],
            delete: async (k) => { deleted.push(k); return true },
        })
        vi.stubGlobal("navigator", {
            serviceWorker: {
                getRegistrations: async () => [
                    { unregister: async () => { unregistered.push(1); return true } },
                    { unregister: async () => { unregistered.push(2); return true } },
                ],
            },
        })
        const done = await purgeCachesAndWorkers()
        expect(deleted).toEqual(["precache-v1", "static-api-cache"])
        expect(unregistered).toHaveLength(2)
        expect(done).toEqual({ caches: 2, workers: 2 })
    })

    it("still unregisters workers when cache storage is blocked", async () => {
        // Private mode and locked-down enterprise profiles throw here,
        // and the worker is the half that actually holds the stale shell.
        let unregistered = 0
        vi.stubGlobal("caches", { keys: async () => { throw new Error("blocked") } })
        vi.stubGlobal("navigator", {
            serviceWorker: {
                getRegistrations: async () => [{ unregister: async () => { unregistered++; return true } }],
            },
        })
        const done = await purgeCachesAndWorkers()
        expect(unregistered).toBe(1)
        expect(done.workers).toBe(1)
    })

    it("resolves rather than throwing when neither API exists", async () => {
        // It is called on a page that is already failing to start; it
        // must never be the thing that throws.
        vi.stubGlobal("caches", undefined)
        vi.stubGlobal("navigator", {})
        await expect(purgeCachesAndWorkers()).resolves.toEqual({ caches: 0, workers: 0 })
    })
})
