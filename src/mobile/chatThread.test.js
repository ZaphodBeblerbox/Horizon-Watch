import { describe, expect, it, vi } from "vitest"
import { dayKey, deliveryState, mergeMessages, parseTs, threadItems, GROUP_GAP_MS } from "./chatThread.js"
import { createTypingPinger, typingLabel } from "../lib/chatTyping.js"

const msg = (id, sender, at, extra = {}) => ({ id, sender_id: sender, kind: "text", body: id, created_at: at, ...extra })

describe("threadItems", () => {
    it("puts a day separator where the date changes and groups one person's run", () => {
        // naive UTC, as the backend sends; noon keeps every timezone on the same day
        const items = threadItems([
            msg("b", "ana", "2026-10-16T12:01:00"),
            msg("a", "ana", "2026-10-16T12:00:00"),     // out of order on purpose
            msg("c", "me", "2026-10-16T12:02:00"),
            msg("d", "me", "2026-10-17T12:00:00"),
        ], "me")
        expect(items.map((i) => i.type)).toEqual(["day", "msg", "msg", "msg", "day", "msg"])
        const [, a, b, c, , d] = items
        expect([a.m.id, b.m.id, c.m.id, d.m.id]).toEqual(["a", "b", "c", "d"])
        expect([a.first, a.last, b.first, b.last]).toEqual([true, false, false, true])
        expect(c.mine && c.first && c.last).toBe(true)
        // the same sender across midnight is two groups
        expect(d.first).toBe(true)
    })

    it("breaks a group after a long pause and around system lines", () => {
        const t0 = Date.parse("2026-10-16T12:00:00Z")
        const iso = (ms) => new Date(ms).toISOString()
        const items = threadItems([
            msg("a", "ana", iso(t0)),
            msg("b", "ana", iso(t0 + GROUP_GAP_MS + 1000)),
            { id: "s", kind: "system", body: "Ana added Ben", created_at: iso(t0 + GROUP_GAP_MS + 2000) },
            msg("c", "ana", iso(t0 + GROUP_GAP_MS + 3000)),
        ], "me").filter((i) => i.type !== "day")
        expect(items.map((i) => [i.m.id, i.first, i.last])).toEqual([
            ["a", true, true], ["b", true, true], ["s", undefined, undefined], ["c", true, true],
        ])
    })

    it("keys a confirmed message by its local key so it does not pop in twice", () => {
        const [, it0] = threadItems([msg("srv1", "me", "2026-10-16T12:00:00", { _key: "local-1" })], "me")
        expect(it0.key).toBe("local-1")
    })
})

describe("helpers", () => {
    it("reads naive timestamps as UTC", () => {
        expect(parseTs("2026-10-16T12:00:00").toISOString()).toBe("2026-10-16T12:00:00.000Z")
        expect(parseTs("nonsense")).toBeNull()
        expect(dayKey(null)).toBe("")
    })

    it("marks what the others have read", () => {
        expect(deliveryState(msg("a", "me", "2026-10-16T12:00:00"), "2026-10-16T12:05:00")).toBe("read")
        expect(deliveryState(msg("a", "me", "2026-10-16T12:10:00"), "2026-10-16T12:05:00")).toBe("sent")
        expect(deliveryState(msg("a", "me", "2026-10-16T12:10:00"), null)).toBe("sent")
        expect(deliveryState({ _pending: true })).toBe("sending")
    })

    it("keeps an unconfirmed send through a poll, and drops it once the server has it", () => {
        const pending = { id: "local-1", _pending: true }
        expect(mergeMessages([{ id: "x" }], [pending]).map((m) => m.id)).toEqual(["x", "local-1"])
        expect(mergeMessages([{ id: "x" }], [{ id: "x" }]).map((m) => m.id)).toEqual(["x"])
    })

    it("names who is typing", () => {
        expect(typingLabel([])).toBe("")
        expect(typingLabel([{ name: "Ana Lima" }])).toBe("Ana is typing")
        expect(typingLabel([{ name: "Ana" }, { name: "Ben" }])).toBe("Ana and Ben are typing")
        expect(typingLabel([{ name: "A" }, { name: "B" }, { name: "C" }])).toBe("3 people are typing")
    })
})

describe("createTypingPinger", () => {
    it("pings at most once every 3 s while typing, and says stopped once", async () => {
        let t = 0
        const send = vi.fn(() => Promise.resolve())
        const p = createTypingPinger(send, { every: 3000, now: () => t })
        p.changed("h"); t = 1000; p.changed("he"); t = 2999; p.changed("hel")
        t = 3000; p.changed("hell")
        await Promise.resolve(); await Promise.resolve()
        expect(send.mock.calls).toEqual([[true], [true]])
        p.changed("")                  // cleared the box
        p.stop()                       // and then sent: no second "stopped"
        await Promise.resolve(); await Promise.resolve()
        expect(send.mock.calls).toEqual([[true], [true], [false]])
        p.changed("x")                 // typing again pings at once
        await Promise.resolve(); await Promise.resolve()
        expect(send.mock.calls.at(-1)).toEqual([true])
    })
})
