import { describe, it, expect } from "vitest"
import { guardPoll } from "./pollGuard.js"

const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r }); return { p, resolve } }

describe("guardPoll", () => {
    it("skips a tick while the previous request is still out", async () => {
        const d = deferred()
        let calls = 0
        const tick = guardPoll(() => { calls++; return d.p }, () => false)
        const first = tick(); tick(); tick()
        expect(calls).toBe(1)
        d.resolve()
        await first
        await tick()
        expect(calls).toBe(2)
    })

    it("does not poll a hidden page, unless forced", async () => {
        let calls = 0
        const tick = guardPoll(() => { calls++; return Promise.resolve() }, () => true)
        await tick()
        expect(calls).toBe(0)
        await tick.force()
        expect(calls).toBe(1)
    })

    it("a failed request frees the next tick", async () => {
        let calls = 0
        const tick = guardPoll(() => { calls++; return Promise.reject(new Error("502")) }, () => false)
        await tick()
        await tick()
        expect(calls).toBe(2)
    })
})
