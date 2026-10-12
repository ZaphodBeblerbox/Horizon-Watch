import { describe, it, expect, vi, beforeEach } from "vitest"
import { shouldSend, reasonToSend, createLiveShare, MIN_MOVE_M, MAX_GAP_MS, MIN_GAP_MS, HEARTBEAT_MS, KEY, WATCH } from "./liveShare.js"
import { locate, getFix, messageFor, platformOf, DENIED, TIMEOUT, UNAVAILABLE } from "./geo.js"

// ── a fake device ─────────────────────────────────────────────────────────
function fakeGeo() {
    const g = {
        calls: [], watches: new Map(), next: 1,
        getCurrentPosition: vi.fn((ok, err, opts) => { g.calls.push({ ok, err, opts }) }),
        watchPosition: vi.fn((ok, err, opts) => { const id = g.next++; g.watches.set(id, { ok, err, opts }); return id }),
        clearWatch: vi.fn((id) => { g.watches.delete(id) }),
        // drive it
        fix(lat, lon, accuracy = 10, timestamp = 0) { for (const w of [...g.watches.values()]) w.ok({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp }) },
        fail(code) { for (const w of [...g.watches.values()]) w.err({ code }) },
        get watch() { return [...g.watches.values()].at(-1) },
    }
    return g
}
const pos = (lat, lon, accuracy = 10) => ({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp: 1 })
function memStorage() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
function fakeDoc() {
    const ls = {}
    return { hidden: false, addEventListener: (t, f) => { (ls[t] ||= []).push(f) }, fire(t) { for (const f of ls[t] || []) f() } }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

/** A clock and timers the test drives: tick(ms) runs what falls due. */
function fakeClock(start = 1_000_000) {
    let t = start, next = 1
    const due = new Map()          // id -> {at, f, every}
    const timers = {
        setTimeout: vi.fn((f, ms) => { const id = next++; due.set(id, { at: t + (ms || 0), f }); return id }),
        clearTimeout: vi.fn((id) => { due.delete(id) }),
        setInterval: vi.fn((f, ms) => { const id = next++; due.set(id, { at: t + ms, f, every: ms }); return id }),
        clearInterval: vi.fn((id) => { due.delete(id) }),
    }
    function tick(ms) {
        const end = t + ms
        for (;;) {
            const [id, d] = [...due.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0] || []
            if (!d) break
            t = Math.max(t, d.at)
            if (d.every) d.at += d.every
            else due.delete(id)
            d.f()
        }
        t = end
    }
    return { timers, tick, now: () => t }
}

function machine(over = {}) {
    const clock = fakeClock()
    const geo = fakeGeo(), doc = fakeDoc(), storage = memStorage()
    const sent = []
    let reply = { ok: true, status: 200 }
    const doFetch = vi.fn(async (url, init) => {
        if (init?.method === "POST") { sent.push({ ...JSON.parse(init.body), t: clock.now() }); return { ...reply, headers: { get: (h) => reply.headers?.[h] } } }
        return { ok: true, json: async () => ({ positions: [] }) }
    })
    const ls = createLiveShare({ geo, doFetch, storage, doc, win: undefined, now: clock.now, desktop: () => false,
                                 plat: () => ({ ios: true, standalone: true }), apiBase: "https://api.test", timers: clock.timers, ...over })
    return { ls, geo, doc, storage, sent, doFetch, timers: clock.timers, tick: clock.tick, now: clock.now, reply: (r) => { reply = r } }
}

// ── the send rule ─────────────────────────────────────────────────────────
describe("when a position goes to the server (real time)", () => {
    const t = 1_000_000
    const prev = { lat: 48.85, lon: 2.35, accuracy: 10, at: t }
    it("the first fix; a move of 10 m; never more than once in 3 s", () => {
        expect(shouldSend(null, { lat: 48.85, lon: 2.35 }, t)).toBe(true)
        expect(shouldSend(prev, { lat: 48.85005, lon: 2.35, accuracy: 10 }, t + 5_000)).toBe(false)    // ~6 m: jitter
        expect(shouldSend(prev, { lat: 48.85012, lon: 2.35, accuracy: 10 }, t + 5_000)).toBe(true)     // ~13 m
        expect(shouldSend(prev, { lat: 48.86, lon: 2.35 }, t + 2_000)).toBe(false)                     // 1 km, but 2 s after the last
        expect(shouldSend(prev, { lat: 48.86, lon: 2.35 }, t + MIN_GAP_MS)).toBe(true)
        expect(MIN_MOVE_M).toBe(10); expect(MIN_GAP_MS).toBe(3_000)
    })
    it("a heartbeat every 30 s standing still", () => {
        expect(shouldSend(prev, { ...prev }, t + HEARTBEAT_MS - 1)).toBe(false)
        expect(reasonToSend(prev, { ...prev }, t + HEARTBEAT_MS)).toBe("heartbeat")
        expect(MAX_GAP_MS).toBe(30_000)
    })
    it("an accuracy much better than the last one sent", () => {
        expect(reasonToSend({ ...prev, accuracy: 65 }, { lat: 48.85, lon: 2.35, accuracy: 12 }, t + 4_000)).toBe("sharper")
        expect(reasonToSend({ ...prev, accuracy: 20 }, { lat: 48.85, lon: 2.35, accuracy: 12 }, t + 4_000)).toBe(null)   // a little better: no
    })
})

// ── asking once (geo.js) ──────────────────────────────────────────────────
describe("asking the device", () => {
    it("asks synchronously — inside the tap — at high accuracy", () => {
        const geo = fakeGeo()
        locate({ geo })
        expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)
        expect(geo.calls[0].opts.enableHighAccuracy).toBe(true)
    })
    it("a refusal is final and says how to allow it on an iPhone", async () => {
        const geo = fakeGeo()
        const p = locate({ geo, plat: { ios: true, standalone: true } })
        geo.calls[0].err({ code: 1 })
        const e = await p.catch((x) => x)
        expect(e.kind).toBe(DENIED)
        expect(e.message).toMatch(/Settings › Privacy & Security › Location Services/)
        expect(e.message).toMatch(/Safari Websites is set to While Using the App/)
        expect(e.message).toMatch(/Settings › Apps › Safari › Location/)
        expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)          // no second prompt
    })
    it("a timeout or no fix is retried once at low accuracy", async () => {
        const geo = fakeGeo()
        const retried = vi.fn()
        const p = locate({ geo, onRetry: retried })
        geo.calls[0].err({ code: 3 })
        await flush()
        expect(retried).toHaveBeenCalled()
        expect(geo.calls[1].opts.enableHighAccuracy).toBe(false)
        geo.calls[1].ok(pos(48.85, 2.35, 900))
        expect(await p).toMatchObject({ lat: 48.85, lon: 2.35, lowAccuracy: true })
    })
    it("both attempts failing says so", async () => {
        const geo = fakeGeo()
        const p = locate({ geo })
        geo.calls[0].err({ code: 2 }); await flush()
        geo.calls[1].err({ code: 3 })
        const e = await p.catch((x) => x)
        expect(e.kind).toBe(TIMEOUT)
        expect(messageFor(UNAVAILABLE, { ios: false })).toMatch(/lower accuracy/)
    })
    it("no geolocation at all is said, not hung", async () => {
        await expect(getFix(undefined, { geo: {} })).rejects.toMatchObject({ kind: "unsupported" })
    })
    it("knows an iPhone Home Screen app", () => {
        const p = platformOf({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)", standalone: true }, {})
        expect(p).toMatchObject({ ios: true, standalone: true })
    })
})

// ── sharing live: the state machine ───────────────────────────────────────
describe("sharing live", () => {
    let m
    beforeEach(() => { m = machine() })

    it("starts from the tap with watchPosition, and the switch is remembered on this device", () => {
        m.ls.start()
        expect(m.geo.watchPosition).toHaveBeenCalledTimes(1)
        expect(m.geo.watch.opts).toMatchObject({ enableHighAccuracy: true, maximumAge: WATCH.maximumAge })
        expect(WATCH.maximumAge).toBeLessThanOrEqual(2_000)
        expect(m.storage.getItem(KEY)).toBe("on")
        expect(m.ls.status().state).toBe("starting")
    })

    it("sends the first fix, then every 10 m moved, and a heartbeat standing still", async () => {
        m.ls.start()
        m.geo.fix(48.85, 2.35); await flush()
        expect(m.sent).toHaveLength(1)
        expect(m.sent[0]).toMatchObject({ lat: 48.85, lon: 2.35, accuracy: 10, source: "gps" })
        expect(m.ls.status().state).toBe("sharing")
        m.tick(4_000); m.geo.fix(48.85003, 2.35); await flush()     // 3 m: jitter
        expect(m.sent).toHaveLength(1)
        m.tick(4_000); m.geo.fix(48.8502, 2.35); await flush()      // 22 m
        expect(m.sent).toHaveLength(2)
        m.tick(HEARTBEAT_MS + 5_000); await flush()                  // standing still: the watch is quiet, the heartbeat is not
        expect(m.sent).toHaveLength(3)
        expect(m.sent[2]).toMatchObject({ lat: 48.8502 })
    })

    it("walking: at most one every 3 s, and the last move of a burst is sent when the 3 s are up", async () => {
        m.ls.start()
        m.geo.fix(48.85, 2.35); await flush()
        for (let i = 1; i <= 5; i++) { m.tick(1_000); m.geo.fix(48.85 + i * 0.0002, 2.35); await flush() }   // 22 m a second
        // 5 s of walking: the first fix, one at 3 s, and the latest queued
        const at = m.sent.map((x) => x.t - m.sent[0].t)
        for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS)
        m.tick(3_000); await flush()
        expect(m.sent.at(-1).lat).toBeCloseTo(48.851, 6)             // the latest, not a stale one in between
        expect(m.sent.length).toBeLessThanOrEqual(3)
    })

    it("coalesces: one request in flight, and only the latest waiting fix goes after it", async () => {
        let release
        const doFetch = vi.fn((url, init) => init?.method === "POST"
            ? new Promise((r) => { release = () => r({ ok: true, status: 200, headers: { get: () => null } }) })
            : Promise.resolve({ ok: true, json: async () => ({ positions: [] }) }))
        const slow = machine({ doFetch })
        slow.ls.start()
        slow.geo.fix(48.85, 2.35)
        const bodies = () => doFetch.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(i.body))
        for (let i = 1; i <= 4; i++) { slow.tick(3_500); slow.geo.fix(48.85 + i * 0.001, 2.35) }
        expect(bodies()).toHaveLength(1)
        expect(slow.ls.status().queued).toBe(true)
        release(); await flush(); await flush()
        expect(bodies()).toHaveLength(2)
        expect(bodies()[1].lat).toBeCloseTo(48.854, 6)              // latest wins; the three in between never go
    })

    it("back in front, the next fix goes at once", async () => {
        m.ls.start()
        m.geo.fix(48.85, 2.35); await flush()
        m.doc.hidden = true; m.doc.fire("visibilitychange")
        m.tick(1_000)
        m.doc.hidden = false; m.doc.fire("visibilitychange")
        expect(m.geo.getCurrentPosition).toHaveBeenCalled()          // asked at once, not at the first move
        m.tick(500)
        m.geo.calls.at(-1).ok(pos(48.85, 2.35))                       // the same place, 1.5 s after the last send
        await flush()
        expect(m.sent).toHaveLength(2)
    })

    it("the fix the tap obtained goes at once, and a fix is asked for as sharing starts", async () => {
        m.ls.start({ lat: 48.85, lon: 2.35, accuracy: 9, at: 1 })
        await flush()
        expect(m.sent[0]).toMatchObject({ lat: 48.85, lon: 2.35, accuracy: 9 })
        expect(m.geo.getCurrentPosition).toHaveBeenCalledTimes(1)
    })

    it("a refusal stops the watch and says how to allow it; Try again asks again", () => {
        m.ls.start()
        m.geo.fail(1)
        const st = m.ls.status()
        expect(st.state).toBe("denied")
        expect(st.message).toMatch(/Location Services/)
        expect(m.geo.watches.size).toBe(0)
        expect(st.on).toBe(true)                                    // still the user's choice
        m.ls.retry()
        expect(m.geo.watchPosition).toHaveBeenCalledTimes(2)
    })

    it("no fix at high accuracy falls back to low accuracy, then says it is unavailable", () => {
        m.ls.start()
        m.geo.fail(3)
        expect(m.geo.watch.opts.enableHighAccuracy).toBe(false)
        expect(m.ls.status()).toMatchObject({ state: "starting", lowAccuracy: true })
        m.geo.fail(2)
        expect(m.ls.status().state).toBe("unavailable")
        m.geo.fix(48.85, 2.35)                                       // a fix later still counts
        expect(m.ls.live()).toMatchObject({ lat: 48.85 })
    })

    it("pauses in the background — an iPhone web app cannot share then — and resumes in front", async () => {
        m.ls.start()
        m.geo.fix(48.85, 2.35); await flush()
        m.doc.hidden = true; m.doc.fire("visibilitychange")
        expect(m.geo.watches.size).toBe(0)
        expect(m.ls.status().state).toBe("paused")
        expect(m.ls.status().message).toMatch(/cannot share location in the background/)
        m.doc.hidden = false; m.doc.fire("visibilitychange")
        expect(m.geo.watches.size).toBe(1)
        m.tick(MIN_GAP_MS); m.geo.fix(48.86, 2.35); await flush()
        expect(m.sent).toHaveLength(2)
        expect(m.ls.status().state).toBe("sharing")
    })

    it("resumes on launch only if this device was sharing", () => {
        m.ls.resume()
        expect(m.geo.watchPosition).not.toHaveBeenCalled()
        m.storage.setItem(KEY, "on")
        m.ls.resume()
        expect(m.geo.watchPosition).toHaveBeenCalledTimes(1)
    })

    it("says when the server refuses, and backs off after 429 — the position goes when allowed", async () => {
        m.ls.start()
        m.reply({ ok: false, status: 401 })
        m.geo.fix(48.85, 2.35); await flush()
        expect(m.ls.status()).toMatchObject({ state: "error" })
        expect(m.ls.status().message).toMatch(/signed out/)
        m.reply({ ok: false, status: 429, headers: { "retry-after": "30" } })
        m.tick(MIN_GAP_MS); m.geo.fix(48.851, 2.35); await flush()
        expect(m.sent).toHaveLength(2)
        m.reply({ ok: true, status: 200 })
        m.tick(MIN_GAP_MS); m.geo.fix(48.852, 2.35); await flush()   // inside Retry-After: waits
        expect(m.sent).toHaveLength(2)
        m.tick(30_000); await flush()                                 // allowed again: the latest goes by itself
        expect(m.sent).toHaveLength(3)
        expect(m.sent[2].lat).toBe(48.852)
        expect(m.ls.status().state).toBe("sharing")
    })

    it("no connection: kept, and sent again a few seconds later", async () => {
        m.ls.start()
        const failing = vi.fn(async () => { throw new TypeError("offline") })
        m.doFetch.mockImplementationOnce(failing)
        m.geo.fix(48.85, 2.35); await flush()
        expect(m.ls.status().state).toBe("error")
        m.tick(5_000); await flush()
        expect(m.sent.at(-1)).toMatchObject({ lat: 48.85 })
        expect(m.ls.status().state).toBe("sharing")
    })

    it("one request at a time — two in flight made two assets", async () => {
        let release
        const doFetch = vi.fn((url, init) => init?.method === "POST"
            ? new Promise((r) => { release = () => r({ ok: true, status: 200, headers: { get: () => null } }) })
            : Promise.resolve({ ok: true, json: async () => ({ positions: [] }) }))
        const slow = machine({ doFetch })
        slow.ls.start()
        slow.geo.fix(48.85, 2.35)
        slow.tick(MIN_GAP_MS); slow.geo.fix(48.86, 2.35)              // arrives before the first answer
        const posts = () => doFetch.mock.calls.filter(([, i]) => i?.method === "POST").length
        expect(posts()).toBe(1)
        release(); await flush()
        expect(posts()).toBe(2)                                       // the waiting one, after the first answer
    })

    it("refused precise location: approximate only when chosen, labelled, marked ip, and a GPS fix replaces it", async () => {
        const a = machine({ connection: async () => ({ lat: 47.37, lon: 8.55, label: "Zurich, Switzerland" }) })
        a.ls.start()
        a.geo.fail(1)
        expect(a.ls.status()).toMatchObject({ state: "denied", canApproximate: true })
        expect(a.sent).toHaveLength(0)                                // nothing sent by itself
        await a.ls.approximate(); await flush()
        expect(a.sent[0]).toMatchObject({ lat: 47.37, lon: 8.55, accuracy: 5000, source: "ip" })
        expect(a.ls.status()).toMatchObject({ state: "approximate", approximate: true })
        expect(a.ls.status().message).toMatch(/Approximate location — from your connection, city level \(Zurich, Switzerland\)/)
        expect(a.geo.watches.size).toBe(0)                            // precise is not asked again by itself
        a.ls.retry()                                                  // a tap: ask for precise again
        expect(a.geo.watches.size).toBe(1)
        a.tick(MIN_GAP_MS); a.geo.fix(48.85, 2.35, 8); await flush()
        expect(a.sent.at(-1)).toMatchObject({ lat: 48.85, source: "gps" })
        expect(a.ls.approx()).toBe(null)
        expect(a.ls.status().state).toBe("sharing")
    })

    it("stop clears the watch and the switch", () => {
        m.ls.start()
        m.ls.stop()
        expect(m.geo.watches.size).toBe(0)
        expect(m.storage.getItem(KEY)).toBe(null)
        expect(m.ls.status().state).toBe("off")
    })

    it("the desktop app shares its connection, marked ip, every ten minutes", async () => {
        const d = machine({ desktop: () => true, connection: async () => ({ lat: 47.37, lon: 8.55 }) })
        d.ls.start(); await flush(); await flush()
        expect(d.geo.watchPosition).not.toHaveBeenCalled()
        expect(d.sent[0]).toMatchObject({ lat: 47.37, lon: 8.55, accuracy: 5000, source: "ip" })
        expect(d.timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 10 * 60_000)
    })
})
