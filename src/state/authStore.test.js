import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Real regression test for the confirmed root cause of "closing the tab
// forces a re-login": checkSession() used to catch EVERY failure of
// GET /api/auth/me (a genuine 401, but also a network error/timeout/5xx)
// in one catch block and clear the session in every case. These tests
// exercise the real fixed logic directly against a mocked fetch, using
// vitest's fake timers so the real backoff delays don't make this suite
// slow. A fresh module instance is imported per test (vi.resetModules())
// since authStore.js keeps its real state at module scope.
describe("authStore.checkSession() — genuine 401 vs. transient failure", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    async function runWithFakeTimers(promiseFactory) {
        const p = promiseFactory()
        // Drain every real setTimeout the retry backoff schedules.
        for (let i = 0; i < 10; i++) {
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(60000)
        }
        return p
    }

    it("a genuine 401 clears the session immediately — no retry", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 401, ok: false })
        vi.stubGlobal("fetch", fetchMock)
        const { checkSession, isAuthTransientError, getCurrentUser } = await import("./authStore.js")

        const user = await runWithFakeTimers(() => checkSession())

        expect(user).toBeNull()
        expect(getCurrentUser()).toBeNull()
        expect(isAuthTransientError()).toBe(false)
        expect(fetchMock).toHaveBeenCalledTimes(1) // never retried a real 401
    })

    it("a real network error retries, then succeeds once the connection recovers", async () => {
        const realUser = { id: "u1", name: "Real User" }
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => realUser })
        vi.stubGlobal("fetch", fetchMock)
        const { checkSession, isAuthTransientError, getCurrentUser } = await import("./authStore.js")

        const user = await runWithFakeTimers(() => checkSession())

        expect(user).toEqual(realUser)
        expect(getCurrentUser()).toEqual(realUser)
        expect(isAuthTransientError()).toBe(false)
        expect(fetchMock.mock.calls.length).toBe(3) // 2 real transient failures, then real success
    })

    it("a real 5xx (e.g. a cold-starting backend) retries the same as a network error, not treated as a 401", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ status: 502, ok: false })
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ id: "u2" }) })
        vi.stubGlobal("fetch", fetchMock)
        const { checkSession, getCurrentUser } = await import("./authStore.js")

        const user = await runWithFakeTimers(() => checkSession())

        expect(user).toEqual({ id: "u2" })
        expect(getCurrentUser()).toEqual({ id: "u2" })
    })

    it("exhausting every retry on transient failures never clears a previously-valid session, and sets the real transient-error flag", async () => {
        // First call: establishes a real logged-in session.
        const realUser = { id: "u3", name: "Still Logged In" }
        const fetchMock = vi.fn().mockResolvedValueOnce({ status: 200, ok: true, json: async () => realUser })
        vi.stubGlobal("fetch", fetchMock)
        const { checkSession, isAuthTransientError, getCurrentUser } = await import("./authStore.js")
        await runWithFakeTimers(() => checkSession())
        expect(getCurrentUser()).toEqual(realUser)

        // Second call (e.g. the periodic re-validation ping): every attempt
        // fails transiently — the real, previously-valid session must NOT
        // be cleared just because the network/backend is having a moment.
        fetchMock.mockReset()
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
        const result = await runWithFakeTimers(() => checkSession())

        expect(result).toEqual(realUser) // real session left standing, never assumed logged-out
        expect(getCurrentUser()).toEqual(realUser)
        expect(isAuthTransientError()).toBe(true) // but honestly flagged as unresolved this time
    })
})

// Android, 2026-10-18: a slow server was reported to the user as "offline".
// The reason a check failed is now settled, and only a device with no
// network is offline.
describe("authStore — why the server could not be asked", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    async function drain(p) {
        for (let i = 0; i < 12; i++) {
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(60000)
        }
        return p
    }

    const isMe = (url) => String(url).includes("/api/auth/me")
    const isProbe = (url) => String(url).includes("/api/health/live")

    it("a server that never answers in time is 'slow', not offline", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn((url, init) => new Promise((_res, rej) => {
            init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
        })))
        const { checkSession, isAuthTransientError, authTransientReason } = await import("./authStore.js")
        await drain(checkSession())
        expect(isAuthTransientError()).toBe(true)
        expect(authTransientReason()).toBe("slow")
    })

    it("an edge 502 that reaches the page as a TypeError, with the server reachable, is 'slow'", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn(async (url) => {
            if (isProbe(url)) return { type: "opaque", status: 0 }
            throw new TypeError("Failed to fetch")
        }))
        const { checkSession, authTransientReason } = await import("./authStore.js")
        await drain(checkSession())
        expect(authTransientReason()).toBe("slow")
    })

    it("nothing answering at all, on a device with a network, is 'unreachable'", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
        const { checkSession, authTransientReason } = await import("./authStore.js")
        await drain(checkSession())
        expect(authTransientReason()).toBe("unreachable")
    })

    it("a 5xx is the server having trouble", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn(async () => ({ status: 503, ok: false })))
        const { checkSession, authTransientReason } = await import("./authStore.js")
        await drain(checkSession())
        expect(authTransientReason()).toBe("server-error")
    })

    it("only a device with no network is offline, and it does not hammer retries", async () => {
        vi.stubGlobal("navigator", { onLine: false })
        const f = vi.fn(async () => { throw new TypeError("Failed to fetch") })
        vi.stubGlobal("fetch", f)
        const { checkSession, authTransientReason } = await import("./authStore.js")
        await drain(checkSession())
        expect(authTransientReason()).toBe("offline")
        expect(f.mock.calls.filter(([u]) => isMe(u)).length).toBe(1)
    })

    it("a success clears the reason", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn()
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValue({ status: 200, ok: true, json: async () => ({ id: "u9" }) }))
        const { checkSession, authTransientReason, isAuthTransientError } = await import("./authStore.js")
        await drain(checkSession())
        expect(isAuthTransientError()).toBe(false)
        expect(authTransientReason()).toBe(null)
    })

    it("signing in while the server is up but slow says so, instead of signing in 'offline'", async () => {
        vi.stubGlobal("navigator", { onLine: true })
        vi.stubGlobal("fetch", vi.fn(async (url) => {
            if (isProbe(url)) return { type: "opaque", status: 0 }
            throw new TypeError("Failed to fetch")
        }))
        const { login, isOfflineSession } = await import("./authStore.js")
        const outcome = login("a@b.c", "pw").then(() => null, (e) => e)
        const err = await drain(outcome)
        expect(err?.message).toMatch(/server/i)
        expect(err?.message).not.toMatch(/offline/i)
        expect(isOfflineSession()).toBe(false)
    })
})
