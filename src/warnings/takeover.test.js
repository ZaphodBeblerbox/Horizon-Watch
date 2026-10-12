import { describe, expect, it, vi } from "vitest"
import { alarming, deviceNote, initialTakeover, reduceTakeover, takeoverEffects } from "./takeover.js"
import { createAlarm, VIBRATE_PATTERN, primeAlarm } from "./alarm.js"
import { warningStatus } from "./api.js"

const W = (id, extra = {}) => ({ id, message: `m ${id}`, status: "sent", created_at: "2026-10-12T14:31:00Z", ...extra })
const DND = { dnd: true, soundMuted: true, soundCritical: false }

describe("the warning takeover", () => {
    it("a warning takes the screen and sounds even with Do Not Disturb and muted sounds", () => {
        const s0 = initialTakeover()
        const s1 = reduceTakeover(s0, { type: "arrive", warning: W("a") })
        expect(alarming(s1, DND)).toBe(true)
        const fx = takeoverEffects(s0, s1, DND)
        expect(fx.start).toBe(true)
        expect(fx.stop).toBe(false)
        expect(fx.fresh.map((w) => w.id)).toEqual(["a"])
    })

    it("keeps sounding until every warning is acknowledged", () => {
        let s = reduceTakeover(initialTakeover(), { type: "inbox", warnings: [W("a"), W("b")] })
        const s1 = reduceTakeover(s, { type: "ack", id: "a" })
        expect(alarming(s1, DND)).toBe(true)
        expect(takeoverEffects(s, s1).stop).toBe(false)
        const s2 = reduceTakeover(s1, { type: "ack", id: "b" })
        expect(alarming(s2, {})).toBe(false)
        expect(takeoverEffects(s1, s2).stop).toBe(true)
        s = s2
        // a poll answered before the server heard the acknowledgement cannot bring it back
        s = reduceTakeover(s, { type: "inbox", warnings: [W("a")] })
        expect(s.active).toEqual([])
    })

    it("an acknowledgement the server did not get comes back with the next poll", () => {
        let s = reduceTakeover(initialTakeover(), { type: "arrive", warning: W("a") })
        s = reduceTakeover(s, { type: "ack", id: "a" })
        s = reduceTakeover(s, { type: "ack_failed", id: "a" })
        s = reduceTakeover(s, { type: "inbox", warnings: [W("a")] })
        expect(s.active.map((w) => w.id)).toEqual(["a"])
    })

    it("leaves the screen when acknowledged elsewhere or withdrawn", () => {
        let s = reduceTakeover(initialTakeover(), { type: "inbox", warnings: [W("a"), W("b")] })
        s = reduceTakeover(s, { type: "arrive", warning: W("a", { status: "cancelled", cancelled_at: "x" }) })
        expect(s.active.map((w) => w.id)).toEqual(["b"])
        s = reduceTakeover(s, { type: "inbox", warnings: [] })            // acknowledged on the other phone
        expect(alarming(s)).toBe(false)
    })

    it("the same warning twice (stream and poll) is one, and only the new one is fresh", () => {
        const s1 = reduceTakeover(initialTakeover(), { type: "arrive", warning: W("a") })
        const s2 = reduceTakeover(s1, { type: "inbox", warnings: [W("a"), W("b")] })
        expect(s2.active.map((w) => w.id)).toEqual(["a", "b"])
        expect(takeoverEffects(s1, s2).fresh.map((w) => w.id)).toEqual(["b"])
        expect(takeoverEffects(s1, s2).start).toBe(false)                // already sounding
        expect(reduceTakeover(s2, { type: "inbox", warnings: [W("a"), W("b")] })).toBe(s2)
    })

    it("says honestly what an iPhone cannot do", () => {
        expect(deviceNote({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toMatch(/silent switch and Focus.*cannot make an iPhone vibrate/)
        expect(deviceNote({ ua: "Android", canVibrate: true })).toBe("")
        expect(deviceNote({ desktop: true })).toBe("")
    })
})

function fakeAudio({ allowed = true } = {}) {
    return {
        loop: false, muted: false, volume: 0.5, currentTime: 3, paused: true,
        play: vi.fn(function () { if (!allowed) return Promise.reject(new Error("NotAllowedError")); this.paused = false; return Promise.resolve() }),
        pause: vi.fn(function () { this.paused = true }),
    }
}
const fakeTimers = () => {
    const t = { fns: [], setInterval: vi.fn((fn) => { t.fns.push(fn); return t.fns.length }), clearInterval: vi.fn() }
    return t
}

describe("the alarm", () => {
    it("plays its own sound loud and looping, vibrates long, repeats, and stops", async () => {
        const a = fakeAudio()
        const nav = { vibrate: vi.fn() }
        const timers = fakeTimers()
        const al = createAlarm({ audio: () => a, nav, timers })
        al.start()
        await new Promise((r) => setTimeout(r, 0))
        expect(a.play).toHaveBeenCalledTimes(1)
        expect(a.loop).toBe(true)
        expect(a.volume).toBe(1)
        expect(nav.vibrate).toHaveBeenCalledWith(VIBRATE_PATTERN)
        expect(al.state()).toMatchObject({ running: true, audible: true, canVibrate: true })
        timers.fns[0]()                                     // every few seconds: buzz again
        expect(nav.vibrate).toHaveBeenCalledTimes(2)
        al.start()                                          // a second warning: still one alarm
        expect(a.play).toHaveBeenCalledTimes(1)
        al.stop()
        expect(a.pause).toHaveBeenCalled()
        expect(a.currentTime).toBe(0)
        expect(nav.vibrate).toHaveBeenLastCalledWith(0)
        expect(timers.clearInterval).toHaveBeenCalled()
        expect(al.state().running).toBe(false)
    })

    it("before any tap it says so, and a tap sounds it", async () => {
        const a = fakeAudio({ allowed: false })
        const synth = { start: vi.fn(async () => false), stop: vi.fn() }
        const al = createAlarm({ audio: () => a, nav: {}, timers: fakeTimers(), makeSynth: () => synth })
        al.start()
        await new Promise((r) => setTimeout(r, 0))
        expect(al.state()).toMatchObject({ running: true, audible: false, blocked: true, canVibrate: false })
        a.play = vi.fn(() => Promise.resolve())             // the tap
        al.unlock()
        await new Promise((r) => setTimeout(r, 0))
        expect(al.state()).toMatchObject({ audible: true, blocked: false })
    })

    it("falls back to the synthesised two-tone when the file cannot play", async () => {
        const synth = { start: vi.fn(async () => true), stop: vi.fn() }
        const al = createAlarm({ audio: () => null, nav: {}, timers: fakeTimers(), makeSynth: () => synth })
        al.start()
        await new Promise((r) => setTimeout(r, 0))
        expect(synth.start).toHaveBeenCalled()
        expect(al.state().audible).toBe(true)
        al.stop()
        expect(synth.stop).toHaveBeenCalled()
    })

    it("priming plays it silently once on the first tap", async () => {
        const a = fakeAudio()
        primeAlarm(a)
        await new Promise((r) => setTimeout(r, 0))
        expect(a.play).toHaveBeenCalled()
        expect(a.pause).toHaveBeenCalled()
        expect(a.muted).toBe(false)
        expect(a.__primed).toBe(true)
    })
})

describe("what the sender sees", () => {
    const fmt = (iso) => iso.slice(11, 16)
    it("acknowledged, seen, or not yet seen", () => {
        expect(warningStatus({ acked_at: "2026-10-12T14:32:00Z", seen_at: "x" }, fmt)).toBe("acknowledged 14:32")
        expect(warningStatus({ seen_at: "2026-10-12T14:31:00Z", sends: 1 }, fmt)).toBe("seen 14:31, not acknowledged")
        expect(warningStatus({ sends: 3 }, fmt)).toBe("not yet seen · sent 3×")
        expect(warningStatus({ status: "cancelled" }, fmt)).toBe("withdrawn")
    })
})
