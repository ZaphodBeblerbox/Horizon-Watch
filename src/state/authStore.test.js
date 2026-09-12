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
