import { describe, it, expect, vi, beforeEach } from "vitest"
import { shouldSend, createLiveShare, MIN_MOVE_M, MAX_GAP_MS, MIN_GAP_MS, KEY } from "./liveShare.js"
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

function machine(over = {}) {
    let t = 1_000_000
    const geo = fakeGeo(), doc = fakeDoc(), storage = memStorage()
    const sent = []
    let reply = { ok: true, status: 200 }
    const doFetch = vi.fn(async (url, init) => {
        if (init?.method === "POST") { sent.push(JSON.parse(init.body)); return { ...reply, headers: { get: (h) => reply.headers?.[h] } } }
        return { ok: true, json: async () => ({ positions: [] }) }
    })
    const timers = { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), setTimeout: vi.fn(), clearTimeout: vi.fn() }
    const ls = createLiveShare({ geo, doFetch, storage, doc, win: undefined, now: () => t, desktop: () => false,
                                 plat: () => ({ ios: true, standalone: true }), apiBase: "https://api.test", timers, ...over })
    return { ls, geo, doc, storage, sent, doFetch, timers, tick: (ms) => { t += ms }, now: () => t, reply: (r) => { reply = r } }
}

// ── the send rule ─────────────────────────────────────────────────────────
describe("when a position goes to the server", () => {
    it("the first fix, a move of 50 m, or two minutes standing still — never more than once in ten seconds", () => {
        const t = 1_000_000
        expect(shouldSend(null, { lat: 48.85, lon: 2.35 }, t)).toBe(true)
        const prev = { lat: 48.85, lon: 2.35, at: t }
        expect(shouldSend(prev, { lat: 48.8502, lon: 2.35 }, t + 20_000)).toBe(false)     // ~22 m
        expect(shouldSend(prev, { lat: 48.8506, lon: 2.35 }, t + 20_000)).toBe(true)      // ~67 m
        expect(shouldSend(prev, { lat: 48.86, lon: 2.35 }, t + 3_000)).toBe(false)        // 1 km, but 3 s after the last
        expect(shouldSend(prev, { lat: 48.85, lon: 2.35 }, t + MAX_GAP_MS)).toBe(true)
        expect(MIN_MOVE_M).toBe(50); expect(MIN_GAP_MS).toBe(10_000)
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
        expect(e.message).toMatch(/Safari Websites \(or the Parallax app\) › While Using/)
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
        expect(m.geo.watch.opts.enableHighAccuracy).toBe(true)
        expect(m.storage.getItem(KEY)).toBe("on")
        expect(m.ls.status().state).toBe("starting")
    })

    it("sends the first fix, then only a 50 m move or every two minutes", async () => {
        m.ls.start()
        m.geo.fix(48.85, 2.35); await flush()
        expect(m.sent).toHaveLength(1)
        expect(m.sent[0]).toMatchObject({ lat: 48.85, lon: 2.35, accuracy: 10, source: "gps" })
        expect(m.ls.status().state).toBe("sharing")
        m.tick(15_000); m.geo.fix(48.8501, 2.35); await flush()     // 11 m: jitter
        expect(m.sent).toHaveLength(1)
        m.tick(15_000); m.geo.fix(48.851, 2.35); await flush()      // 111 m
        expect(m.sent).toHaveLength(2)
        m.tick(MAX_GAP_MS); m.geo.fix(48.851, 2.35); await flush()  // standing still, two minutes on
        expect(m.sent).toHaveLength(3)
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
        m.tick(MAX_GAP_MS); m.geo.fix(48.86, 2.35); await flush()
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

    it("says when the server refuses, and backs off after 429", async () => {
        m.ls.start()
        m.reply({ ok: false, status: 401 })
        m.geo.fix(48.85, 2.35); await flush()
        expect(m.ls.status()).toMatchObject({ state: "error" })
        expect(m.ls.status().message).toMatch(/signed out/)
        m.reply({ ok: false, status: 429, headers: { "retry-after": "30" } })
        m.tick(MIN_GAP_MS); m.geo.fix(48.851, 2.35); await flush()
        expect(m.sent).toHaveLength(2)
        m.tick(MIN_GAP_MS); m.geo.fix(48.852, 2.35); await flush()   // inside Retry-After: not sent
        expect(m.sent).toHaveLength(2)
        m.reply({ ok: true, status: 200 })
        m.tick(30_000); m.geo.fix(48.853, 2.35); await flush()
        expect(m.sent).toHaveLength(3)
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
        slow.tick(MIN_GAP_MS); slow.geo.fix(48.87, 2.35); await flush()
        expect(posts()).toBe(2)
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
