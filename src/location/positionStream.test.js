import { describe, it, expect, vi } from "vitest"
import { createPositionStream, backoff, BACKOFF_MS, POLL_AFTER_FAILURES, POLL_MS, SILENCE_MS } from "./positionStream.js"

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

function fakeClock(start = 1_000_000) {
    let t = start, next = 1
    const due = new Map()
    const timers = {
        setTimeout: (f, ms) => { const id = next++; due.set(id, { at: t + (ms || 0), f }); return id },
        clearTimeout: (id) => { due.delete(id) },
        setInterval: (f, ms) => { const id = next++; due.set(id, { at: t + ms, f, every: ms }); return id },
        clearInterval: (id) => { due.delete(id) },
    }
    async function tick(ms) {
        const end = t + ms
        for (;;) {
            const [id, d] = [...due.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0] || []
            if (!d) break
            t = Math.max(t, d.at)
            if (d.every) d.at += d.every
            else due.delete(id)
            d.f()
            await flush()
        }
        t = end
    }
    return { timers, tick, now: () => t, pending: () => [...due.values()].map((d) => d.at - t) }
}

function setup({ tokenOk = true } = {}) {
    const clock = fakeClock()
    const sources = []
    class FakeES {
        constructor(url) { this.url = url; this.ls = {}; this.closed = false; sources.push(this) }
        addEventListener(t, f) { (this.ls[t] ||= []).push(f) }
        close() { this.closed = true }
        emit(t, data) { for (const f of this.ls[t] || []) f({ data: JSON.stringify(data) }) }
        fail() { this.onerror?.({}) }
    }
    const calls = []
    let people = []
    const doFetch = vi.fn(async (url, init) => {
        calls.push({ url, method: init?.method || "GET" })
        if (url.endsWith("/api/positions/stream-token")) return tokenOk ? { ok: true, json: async () => ({ token: `tok${calls.length}` }) } : { ok: false, status: 503 }
        if (url.includes("/api/my-assets/people")) return { ok: true, json: async () => ({ people }) }
        return { ok: false, status: 404 }
    })
    const ls = {}
    const doc = { hidden: false, addEventListener: (t, f) => { (ls[t] ||= []).push(f) }, fire: (t) => { for (const f of ls[t] || []) f() } }
    const s = createPositionStream({ apiBase: "https://api.test", doFetch, ES: FakeES, timers: clock.timers, now: clock.now, doc, win: undefined, random: () => 0.5 })
    return { s, clock, sources, calls, doFetch, doc, setPeople: (p) => { people = p } }
}

const P = (lat, at, extra = {}) => ({ type: "position", user_id: "anna", name: "Anna", lat, lon: 2.35, accuracy_m: 8, source: "gps", at, assets: [{ id: "OA-1" }], ...extra })

describe("the live position stream", () => {
    it("opens with a token from an authenticated POST, then EventSource with ?t=", async () => {
        const { s, sources, calls } = setup()
        s.subscribe(() => {})
        await flush()
        expect(calls[0]).toMatchObject({ url: "https://api.test/api/positions/stream-token", method: "POST" })
        expect(sources[0].url).toBe("https://api.test/api/positions/stream?t=tok1")
        expect(s.mode()).toBe("connecting")
        sources[0].emit("snapshot", { people: [P(48.85, "2026-10-12T09:00:00+00:00")], server_time: "2026-10-12T09:00:03+00:00" })
        expect(s.mode()).toBe("live")
        expect(s.findPerson("anna")).toMatchObject({ lat: 48.85, name: "Anna" })
        expect(s.asset("OA-1")).toMatchObject({ lat: 48.85, user_id: "anna" })
        expect(s.serverNow() - Date.parse("2026-10-12T09:00:03+00:00")).toBe(0)    // the server's clock, not this one
    })

    it("a passive listener never opens the stream, but hears warnings while it is open", async () => {
        const { s, sources, calls } = setup()
        const heard = []
        const off = s.listen((ev) => heard.push(ev))
        await flush()
        expect(calls).toEqual([])                                        // listening opens nothing
        s.subscribe(() => {})
        await flush()
        sources[0].emit("warning", { type: "warning", warning: { id: "W-1", message: "Turn back" } })
        sources[0].emit("warning_update", { type: "warning", warning: { id: "W-2", status: "acknowledged" } })
        expect(heard.filter((e) => e.type.startsWith("warning")).map((e) => [e.type, e.warning.id])).toEqual([["warning", "W-1"], ["warning_update", "W-2"]])
        off()
    })

    it("applies each pushed position; an older one never replaces a newer", async () => {
        const { s, sources } = setup()
        const seen = vi.fn()
        s.subscribe(seen)
        await flush()
        sources[0].emit("snapshot", { people: [], server_time: new Date().toISOString() })
        sources[0].emit("position", P(48.86, "2026-10-12T09:00:06+00:00"))
        sources[0].emit("position", P(48.80, "2026-10-12T09:00:01+00:00"))
        expect(s.findPerson("anna").lat).toBe(48.86)
        expect(s.findPerson("anna").prevAt).toBe(null)
        sources[0].emit("position", P(48.87, "2026-10-12T09:00:09+00:00"))
        expect(s.findPerson("anna")).toMatchObject({ lat: 48.87, prevAt: Date.parse("2026-10-12T09:00:06+00:00") })
        expect(seen).toHaveBeenCalledWith({ type: "position", user_id: "anna" })
    })

    it("reconnects after an error with a NEW token, backing off 1, 2 s…", async () => {
        const { s, sources, clock, calls } = setup()
        s.subscribe(() => {})
        await flush()
        sources[0].fail()
        expect(sources[0].closed).toBe(true)                          // not EventSource's own retry with an expired token
        await clock.tick(BACKOFF_MS[0] - 1)
        expect(sources).toHaveLength(1)
        await clock.tick(1)
        expect(sources).toHaveLength(2)
        expect(sources[1].url).toMatch(/t=tok\d+$/)
        expect(sources[1].url).not.toBe(sources[0].url)
        sources[1].fail()
        await clock.tick(BACKOFF_MS[1])
        expect(sources).toHaveLength(3)
        expect(calls.filter((c) => c.method === "POST")).toHaveLength(3)
    })

    it("backoff grows to 30 s with jitter", () => {
        expect(backoff(1, () => 0.5)).toBe(1_000)
        expect(backoff(3, () => 0.5)).toBe(4_000)
        expect(backoff(99, () => 0.5)).toBe(30_000)
        expect(backoff(99, () => 0)).toBe(22_500)
        expect(backoff(99, () => 1)).toBe(37_500)
    })

    it("after three failures it polls, keeps retrying the stream, and stops polling when the stream is back", async () => {
        const { s, sources, clock, calls, setPeople } = setup()
        setPeople([{ user_id: "anna", lat: 10, lon: 20, at: "2026-10-12T09:00:00+00:00", source: "gps", assets: ["OA-1"] }])
        s.subscribe(() => {})
        await flush()
        for (let i = 0; i < POLL_AFTER_FAILURES; i++) {
            sources.at(-1).fail()
            await clock.tick(30_000)
        }
        expect(calls.some((c) => c.url.includes("/api/my-assets/people"))).toBe(true)
        expect(s.findPerson("anna")).toMatchObject({ lat: 10, via: "poll" })
        const polls = () => calls.filter((c) => c.url.includes("/people")).length
        const before = polls()
        await clock.tick(POLL_MS)
        expect(polls()).toBeGreaterThan(before)
        // the stream comes back
        const last = sources.at(-1)
        last.emit("snapshot", { people: [], server_time: new Date().toISOString() })
        expect(s.mode()).toBe("live")
        const n = polls()
        await clock.tick(POLL_MS * 3)
        expect(polls()).toBe(n)
    })

    it("a silent connection (no event or ping for 40 s) is reopened", async () => {
        const { s, sources, clock } = setup()
        s.subscribe(() => {})
        await flush()
        sources[0].emit("snapshot", { people: [], server_time: new Date().toISOString() })
        await clock.tick(30_000)
        sources[0].emit("ping", {})
        await clock.tick(30_000)
        expect(sources).toHaveLength(1)                               // the ping kept it
        await clock.tick(SILENCE_MS + 5_000)
        expect(sources[0].closed).toBe(true)
        await clock.tick(2_000)
        expect(sources.length).toBeGreaterThan(1)
    })

    it("the server's goodbye reopens at once", async () => {
        const { s, sources, clock } = setup()
        s.subscribe(() => {})
        await flush()
        sources[0].emit("bye", { why: "reconnect" })
        await clock.tick(1_000)
        expect(sources).toHaveLength(2)
    })

    it("closes in the background and reopens in front; closes when nobody listens", async () => {
        const { s, sources, doc, clock } = setup()
        const off = s.subscribe(() => {})
        await flush()
        doc.hidden = true; doc.fire("visibilitychange")
        expect(sources[0].closed).toBe(true)
        expect(s.mode()).toBe("off")
        await clock.tick(60_000)
        expect(sources).toHaveLength(1)
        doc.hidden = false; doc.fire("visibilitychange")
        await flush()
        expect(sources).toHaveLength(2)
        off()
        expect(sources[1].closed).toBe(true)
        expect(s.mode()).toBe("off")
    })

    it("no EventSource at all: polls", async () => {
        const clock = fakeClock()
        const doFetch = vi.fn(async (url) => (url.includes("stream-token") ? { ok: true, json: async () => ({ token: "t" }) } : { ok: true, json: async () => ({ people: [] }) }))
        const s = createPositionStream({ apiBase: "https://api.test", doFetch, ES: undefined, timers: clock.timers, now: clock.now, doc: undefined })
        s.subscribe(() => {})
        await flush()
        expect(s.mode()).toBe("polling")
    })
})
