import { describe, it, expect, vi } from "vitest"
import {
    deviceOffline, classifyFailure, connectionCopy, retryDelayMs, probeServer, bootGate,
} from "./connectivity.js"
import { isCacheable, installOfflineCache, memoryStore } from "./offlineCache.js"
import { nextConnection, connectionLine } from "./useConnection.js"

// Android, 2026-10-18: a second user was told "offline" while their phone
// had a network and Railway was up — the server was merely slow. Only a
// device with no network is offline; everything else is the server's
// problem and is said to be.

describe("offline means the device has no network", () => {
    it("only navigator.onLine === false is offline", () => {
        expect(deviceOffline({ onLine: false })).toBe(true)
        expect(deviceOffline({ onLine: true })).toBe(false)
        expect(deviceOffline(undefined)).toBe(false)
        expect(deviceOffline({})).toBe(false)
    })

    it("a timeout on a device with a network is a slow server", () => {
        expect(classifyFailure({ online: true, timedOut: true, error: new DOMException("x", "AbortError") })).toBe("slow")
        const te = new Error("the server did not respond within 30s"); te.name = "TimeoutError"
        expect(classifyFailure({ online: true, error: te })).toBe("slow")
    })

    it("a 5xx is the server having trouble", () => {
        expect(classifyFailure({ online: true, status: 502 })).toBe("server-error")
        expect(classifyFailure({ online: true, status: 503 })).toBe("server-error")
    })

    it("a request that reached nobody, on a device with a network, is unreachable — not offline", () => {
        // An edge 502 has no CORS header and arrives as exactly this.
        expect(classifyFailure({ online: true, error: new TypeError("Failed to fetch") })).toBe("unreachable")
    })

    it("any failure with no network on the device is offline", () => {
        expect(classifyFailure({ online: false, error: new TypeError("Failed to fetch") })).toBe("offline")
        expect(classifyFailure({ online: false, timedOut: true })).toBe("offline")
    })

    it("only the offline copy says offline", () => {
        for (const r of ["slow", "server-error", "unreachable"]) {
            const c = connectionCopy(r)
            expect(`${c.title} ${c.body}`).not.toMatch(/offline/i)
            expect(c.title).toMatch(/reconnecting/i)
        }
        expect(connectionCopy("offline").title).toMatch(/offline/i)
        expect(connectionCopy("nonsense")).toEqual(connectionCopy("unreachable"))
    })
})

describe("reconnecting backs off", () => {
    it("5 s, 10 s, 20 s, then every 30 s", () => {
        expect([0, 1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([5000, 10000, 20000, 30000, 30000, 30000])
        expect(retryDelayMs(-1)).toBe(5000)
    })
})

describe("probeServer asks whether anything answers at the API", () => {
    it("an opaque answer (even an edge 502) means the server is there", async () => {
        const f = vi.fn().mockResolvedValue({ type: "opaque", status: 0 })
        expect(await probeServer({ apiBase: "https://api.example", fetchImpl: f })).toBe(true)
        const [url, init] = f.mock.calls[0]
        expect(url).toMatch(/^https:\/\/api\.example\/api\/health\/live\?probe=/)
        expect(init.mode).toBe("no-cors")
        expect(init.cache).toBe("no-store")
    })

    it("nothing answering means it is not", async () => {
        const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
        expect(await probeServer({ apiBase: "https://api.example", fetchImpl: f })).toBe(false)
    })

    it("gives up after its own deadline", async () => {
        vi.useFakeTimers()
        try {
            const f = vi.fn((_u, init) => new Promise((_res, rej) => {
                init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
            }))
            const p = probeServer({ apiBase: "https://api.example", fetchImpl: f, timeoutMs: 1000 })
            await vi.advanceTimersByTimeAsync(1001)
            expect(await p).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it("the probe is never answered from the offline cache", () => {
        // A stored health answer would report a dead server as alive.
        const api = "https://api.example"
        expect(isCacheable("GET", `${api}/api/health/live?probe=1`, api)).toBe(false)
        expect(isCacheable("GET", `${api}/api/health/live`, api)).toBe(false)
        // the detailed health still has a last good value for offline screens
        expect(isCacheable("GET", `${api}/api/health/detailed`, api)).toBe(true)
    })
})

describe("the phone's connection line", () => {
    it("a failed request with the device online blames the server, not the phone", () => {
        let s = "ok"
        s = nextConnection(s, { type: "cache", detail: { state: "offline-empty", reason: "slow" } })
        expect(s).toBe("slow")
        expect(connectionLine(s)).toMatch(/Server slow/)
        expect(connectionLine(s)).not.toMatch(/offline/i)
        s = nextConnection(s, { type: "cache", detail: { state: "live" } })
        expect(s).toBe("ok")
        expect(connectionLine(s)).toBe(null)
    })

    it("only the device's own offline event says offline, and its return clears it", () => {
        let s = nextConnection("ok", { type: "offline" })
        expect(connectionLine(s)).toMatch(/offline/i)
        s = nextConnection(s, { type: "online" })
        expect(s).toBe("ok")
        // coming back online says nothing about a server that was slow
        expect(nextConnection("slow", { type: "online" })).toBe("slow")
    })
})

describe("offlineCache says why a request failed", () => {
    function harness({ onLine = true, fetchImpl }) {
        const events = []
        const win = {
            fetch: fetchImpl,
            navigator: { onLine },
            dispatchEvent: (e) => events.push(e.detail),
        }
        installOfflineCache({ win, apiBase: "https://api.example", store: memoryStore(), timeoutMs: 50 })
        return { win, events }
    }

    it("a timeout on a phone with a network is 'slow'", async () => {
        const { win, events } = harness({ fetchImpl: (_u, init) => new Promise((_r, rej) => {
            init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
        }) })
        await expect(win.fetch("https://api.example/api/general")).rejects.toThrow(/did not respond/)
        expect(events.at(-1)).toMatchObject({ state: "offline-empty", reason: "slow" })
    })

    it("a request that reached nobody with no network is 'offline'", async () => {
        const { win, events } = harness({ onLine: false, fetchImpl: async () => { throw new TypeError("Failed to fetch") } })
        await expect(win.fetch("https://api.example/api/general")).rejects.toThrow()
        expect(events.at(-1)).toMatchObject({ reason: "offline" })
    })

    it("a screen cancelling its own request says nothing about the connection", async () => {
        const { win, events } = harness({ fetchImpl: (_u, init) => new Promise((_r, rej) => {
            init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
        }) })
        const ctl = new AbortController()
        const p = win.fetch("https://api.example/api/general", { signal: ctl.signal })
        ctl.abort()
        await expect(p).rejects.toThrow()
        expect(events).toEqual([])
    })
})

describe("the boot gate", () => {
    const base = { authUser: null, transient: true, offlineLoginAvailable: true }

    it("signed in is the app, a real 401 is the login form", () => {
        expect(bootGate({ ...base, authUser: { id: 1 } })).toBe("app")
        expect(bootGate({ ...base, transient: false })).toBe("login")
    })

    it("a slow or restarting server is 'reconnecting', never the offline sign-in", () => {
        for (const reason of ["slow", "server-error", "unreachable", null]) {
            expect(bootGate({ ...base, reason })).toBe("reconnecting")
        }
    })

    it("no network on the device goes to the offline sign-in when one is possible", () => {
        expect(bootGate({ ...base, reason: "offline" })).toBe("login-offline")
        expect(bootGate({ ...base, reason: "offline", offlineLoginAvailable: false })).toBe("reconnecting")
    })

    it("the reader can choose the local data while the server is slow", () => {
        expect(bootGate({ ...base, reason: "slow", useLocalData: true })).toBe("login-offline")
        expect(bootGate({ ...base, reason: "slow", useLocalData: true, offlineLoginAvailable: false })).toBe("reconnecting")
    })
})

describe("confirmFailure — one slow request is not a slow server", () => {
    it("keeps ok when the health probe answers", async () => {
        const { confirmFailure } = await import("./useConnection.js")
        expect(await confirmFailure("slow", async () => true)).toBe(null)
        expect(await confirmFailure("server-error", async () => true)).toBe(null)
    })
    it("believes the failure when the probe fails too", async () => {
        const { confirmFailure } = await import("./useConnection.js")
        expect(await confirmFailure("slow", async () => false)).toBe("unreachable")
    })
    it("never second-guesses the device being offline", async () => {
        const { confirmFailure } = await import("./useConnection.js")
        expect(await confirmFailure("offline", async () => true)).toBe("offline")
    })
})
